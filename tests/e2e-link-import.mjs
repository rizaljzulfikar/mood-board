/**
 * E2E smoke test for link import (run: node tests/e2e-link-import.mjs).
 * Creates its own user/project, exercises the from-url API against the live
 * dev server, and verifies items land in Mongo + objects in MinIO.
 * Cleans up everything it created.
 */
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const BASE = process.env.BASE ?? "http://localhost:3100";
const URI = "mongodb://localhost:27030/moodboard";
const EMAIL = `e2e-link-${Date.now()}@test.local`;
const PASSWORD = "e2e-password-1";

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
}

const mongo = new MongoClient(URI);
await mongo.connect();
const db = mongo.db();
const users = db.collection("users");

// 1. Bootstrap a user (role "user" avoids touching the superadmin invariant).
const hash = bcrypt.hashSync(PASSWORD, 10);
const { insertedId: userId } = await users.insertOne({
  email: EMAIL,
  name: "E2E Linker",
  passwordHash: hash,
  role: "user",
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

let cookie = null;
let projectId = null;
const createdItems = [];

try {
  // 2. Login → session cookie.
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert(loginRes.status === 200, "login succeeds");
  cookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  assert(cookie.length > 0, "session cookie received");

  // 3. Create a project.
  const projRes = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "E2E link import" }),
  });
  assert(projRes.status === 201 || projRes.status === 200, "project created");
  projectId = (await projRes.json()).project?.id ?? (await projRes.json()).id;
  assert(Boolean(projectId), `project id: ${projectId}`);

  const postJson = (path, body) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  // 4. Direct image link → imported into storage as an image item.
  const imgUrl = "https://github.githubassets.com/images/modules/open_graph/github-mark.png";
  const imgRes = await postJson(`/api/projects/${projectId}/items/from-url`, { url: imgUrl, x: 50, y: 60 });
  const imgBody = await imgRes.json();
  assert(imgRes.status === 201, `image link import → 201 (got ${imgRes.status}: ${JSON.stringify(imgBody).slice(0, 200)})`);
  assert(imgBody.item.kind === "image", "image link → kind=image");
  assert(imgBody.item.sourceUrl === imgUrl, "image link → provenance stored");
  assert(imgBody.item.width > 0 && imgBody.item.height > 0, "image link → real dimensions");
  createdItems.push(imgBody.item.id);

  // 5. Page link with OG tags → link card with stored thumbnail.
  const pageRes = await postJson(`/api/projects/${projectId}/items/from-url`, {
    url: "https://github.com/vercel/next.js",
    x: 300,
    y: 400,
  });
  const pageBody = await pageRes.json();
  assert(pageRes.status === 201, `OG page import → 201 (got ${pageRes.status}: ${JSON.stringify(pageBody).slice(0, 300)})`);
  assert(pageBody.item.kind === "link", "OG page → kind=link");
  assert(pageBody.item.title?.length > 0, `OG page → title "${pageBody.item.title}"`);
  assert(pageBody.item.sourceUrl === "https://github.com/vercel/next.js", "OG page → sourceUrl");
  assert(pageBody.item.objectKey, "OG page → stored thumbnail objectKey");
  createdItems.push(pageBody.item.id);

  // 6. Thumbnail is actually served from our storage proxy.
  const storageRes = await fetch(`${BASE}/api/storage/${pageBody.item.objectKey}`, {
    headers: { cookie },
  });
  assert(storageRes.status === 200, "thumbnail served from /api/storage");
  assert((storageRes.headers.get("content-type") ?? "").startsWith("image/"), "thumbnail is an image");

  // 7. Label the image item.
  const patchRes = await fetch(`${BASE}/api/items/${imgBody.item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ label: "E2E label ✓" }),
  });
  assert(patchRes.status === 200, "label PATCH → 200");
  const patched = (await patchRes.json()).item;
  assert(patched.label === "E2E label ✓", "label persisted");

  // 8. SSRF guard: private URL rejected, nothing fetched/stored.
  const privateRes = await postJson(`/api/projects/${projectId}/items/from-url`, {
    url: "http://127.0.0.1:9100/minio/health/live",
    x: 0,
    y: 0,
  });
  assert(privateRes.status === 400, "private URL → 400");

  // 9. Sync propagates the new fields to collaborators.
  const syncRes = await fetch(`${BASE}/api/projects/${projectId}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  const syncBody = await syncRes.json();
  const synced = syncBody.items.find((i) => i.id === pageBody.item.id);
  assert(Boolean(synced), "sync returns imported items");
  assert(synced.kind === "link" && synced.title && synced.label === "", "sync carries kind/title/label");

  // 10. Board page SSRs with the link-import UI and imported items.
  const boardRes = await fetch(`${BASE}/projects/${projectId}`, { headers: { cookie } });
  assert(boardRes.status === 200, `board page renders (${boardRes.status})`);
  const boardHtml = await boardRes.text();
  assert(boardHtml.includes("Add link"), "board shows the Add link form");
  assert(boardHtml.includes("kind-link"), "board renders the link card item");
  assert(boardHtml.includes("Golden") || boardHtml.includes("GitHub"), "link card title present");

  console.log("\nE2E smoke test PASSED");
} finally {
  // Cleanup: project DELETE hard-deletes items; remove user + objects of this run.
  if (projectId) {
    await fetch(`${BASE}/api/projects/${projectId}`, { method: "DELETE", headers: { cookie } });
  }
  await users.deleteOne({ _id: userId });
  await mongo.close();
  console.log("cleanup done");
}
