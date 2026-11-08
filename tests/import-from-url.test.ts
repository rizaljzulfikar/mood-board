import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DNS: pretend every host resolves to a public address (localhost is still
// rejected earlier, by name). Fetch: queued canned responses per test.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "157.240.1.35", family: 4 }]),
}));
vi.mock("@/lib/minio", () => ({
  putObjectBuffer: vi.fn(async () => {}),
  getObject: vi.fn(),
  ensureBucket: vi.fn(async () => {}),
  getS3Client: vi.fn(),
  bucketName: vi.fn(() => "moodboard"),
}));
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { POST } from "@/app/api/projects/[id]/items/from-url/route";
import { putObjectBuffer } from "@/lib/minio";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function imageResponse(buffer: Buffer, type = "image/png") {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: { "content-type": type },
  });
}

let user: { _id: { toString(): string } };
let project: { _id: { toString(): string } };

async function importUrl(url: string, x = 100, y = 200) {
  const req = new Request(`http://localhost/api/projects/${project._id}/items/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, x, y }),
  });
  return POST(req, { params: Promise.resolve({ id: String(project._id) }) });
}

beforeEach(async () => {
  await connectDB();
  const created = await User.create({
    email: `url-${Date.now()}-${Math.random()}@test.local`,
    name: "Linker",
    passwordHash: "x",
  });
  user = created;
  project = await Project.create({ name: "Link import test", owner: created._id, members: [] });
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: String(created._id),
    email: created.email,
    name: created.name,
    role: "user",
    mustChangePassword: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/projects/:id/items/from-url", () => {
  it("imports a direct image link into storage as an image item", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse(PNG_1X1))
    );

    const res = await importUrl("https://pics.example.net/photo.png");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("image");
    expect(item.mime).toBe("image/png");
    expect(item.width).toBe(1);
    expect(item.height).toBe(1);
    expect(item.sourceUrl).toBe("https://pics.example.net/photo.png");
    expect(item.x).toBe(99.5); // centered on the requested point
    expect(item.y).toBe(199.5);
    expect(item.objectKey).toMatch(new RegExp(`^${project._id}/[a-f0-9]+\\.png$`));
    expect(putObjectBuffer).toHaveBeenCalledWith(item.objectKey, PNG_1X1, "image/png");

    const persisted = await Item.findById(item.id);
    expect(persisted?.kind).toBe("image");
    expect(persisted?.sourceUrl).toBe("https://pics.example.net/photo.png");
  });

  it("creates a link card from an OG page and stores its thumbnail", async () => {
    const page = `<html><head>
      <meta property="og:title" content="Golden hour shot">
      <meta property="og:site_name" content="Instagram">
      <meta property="og:image" content="https://cdn.instagram.example/s/photo.jpg">
    </head></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(page))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await importUrl("https://www.instagram.com/p/abc123/");
    expect(res.status).toBe(201);

    const { item } = (await res.json()) as { item: Record<string, unknown> };
    expect(item.kind).toBe("link");
    expect(item.title).toBe("Golden hour shot");
    expect(item.siteName).toBe("Instagram");
    expect(item.sourceUrl).toBe("https://www.instagram.com/p/abc123/");
    expect(item.label).toBe("");
    // Card height = thumbnail + footer strip; image area keeps the aspect.
    expect(item.width).toBe(1);
    expect(item.height).toBe(1 + 52);
    expect(item.objectKey).toMatch(/\.jpg$/);
    expect(putObjectBuffer).toHaveBeenCalledWith(item.objectKey, PNG_1X1, "image/jpeg");
    // Second fetch hit the resolved og:image URL.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://cdn.instagram.example/s/photo.jpg");
  });

  it("rejects a page without og:image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("<html><head><title>hi</title></head></html>")));

    const res = await importUrl("https://example.net/no-image");
    expect(res.status).toBe(422);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toMatch(/no preview image/i);
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("rejects private/loopback URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://localhost:9100/minio",
      "http://127.0.0.1/x.png",
      "http://169.254.169.254/meta",
      "file:///etc/passwd",
      "not a url",
    ]) {
      const res = await importUrl(url);
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("maps fetch failures to a 502 with a readable message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    const res = await importUrl("https://example.net/missing");
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error?: string };
    expect(typeof data.error).toBe("string");
    expect(await Item.countDocuments({ project: project._id })).toBe(0);
  });

  it("rejects non-image non-html content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } })
      )
    );

    const res = await importUrl("https://example.net/blob.bin");
    expect(res.status).toBe(415);
  });
});
