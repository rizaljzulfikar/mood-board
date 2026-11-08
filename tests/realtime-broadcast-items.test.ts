import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/realtime-publish", () => ({ broadcastUpsert: vi.fn(), broadcastDelete: vi.fn() }));
vi.mock("@/lib/items", async () => {
  const actual = await vi.importActual<typeof import("@/lib/items")>("@/lib/items");
  return { ...actual, createItemWithObject: vi.fn() };
});
vi.mock("@/lib/url-fetch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-fetch")>("@/lib/url-fetch");
  return { ...actual, fetchRemote: vi.fn() };
});

import { PATCH, DELETE } from "@/app/api/items/[id]/route";
import { POST as uploadPOST } from "@/app/api/projects/[id]/items/route";
import { POST as fromUrlPOST } from "@/app/api/projects/[id]/items/from-url/route";
import { broadcastUpsert, broadcastDelete } from "@/lib/realtime-publish";
import { getCurrentUser } from "@/lib/auth";
import { createItemWithObject } from "@/lib/items";
import { fetchRemote } from "@/lib/url-fetch";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

let projectId: string;
let userId: string;

beforeEach(async () => {
  await connectDB();
  const user = await User.create({ email: `b-${Date.now()}-${Math.random()}@test.local`, name: "B", passwordHash: "x" });
  const project = await Project.create({ name: "B", owner: user._id, members: [] });
  userId = String(user._id);
  projectId = String(project._id);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: user.email, name: user.name, role: "user", mustChangePassword: false });
  vi.clearAllMocks();
});

function makeItem() {
  return Item.create({ project: projectId, kind: "image", objectKey: `${projectId}/${Date.now()}-${Math.random()}.png`, originalName: "p.png", mime: "image/png", size: 1, width: 10, height: 10, x: 0, y: 0, rotation: 0, z: 1, addedBy: userId });
}

async function patchItem(id: string, body: unknown) {
  return PATCH(new Request(`http://x/api/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("item broadcasts", () => {
  it("upserts after a field patch", async () => {
    const item = await makeItem();
    await patchItem(String(item._id), { x: 42 });
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "item", expect.objectContaining({ id: String(item._id) }));
  });

  it("deletes after the deleted:true patch", async () => {
    const item = await makeItem();
    await patchItem(String(item._id), { deleted: true });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "item", String(item._id));
  });

  it("deletes after DELETE", async () => {
    const item = await makeItem();
    await DELETE(new Request(`http://x/api/items/${item._id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(item._id) }) });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "item", String(item._id));
  });

  it("upserts after an upload", async () => {
    const item = await makeItem();
    vi.mocked(createItemWithObject).mockResolvedValue(item);
    const form = new FormData();
    form.set("file", new File([png], "p.png", { type: "image/png" }));
    const res = await uploadPOST(new Request(`http://x/api/projects/${projectId}/items`, { method: "POST", body: form }), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(201);
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "item", expect.objectContaining({ id: String(item._id) }));
  });

  it("upserts after a URL import", async () => {
    const item = await makeItem();
    vi.mocked(createItemWithObject).mockResolvedValue(item);
    vi.mocked(fetchRemote).mockResolvedValue({ finalUrl: "https://example.com/p.png", buffer: png, contentType: "image/png" });
    const res = await fromUrlPOST(new Request(`http://x/api/projects/${projectId}/items/from-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com/p.png" }) }), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(201);
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "item", expect.objectContaining({ id: String(item._id) }));
  });
});
