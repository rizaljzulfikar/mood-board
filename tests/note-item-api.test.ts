import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { POST as createNote } from "@/app/api/projects/[id]/items/notes/route";
import { GET as listItems } from "@/app/api/projects/[id]/items/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

let ownerId: string;
let projectId: string;

beforeEach(async () => {
  await connectDB();
  const user = await User.create({
    email: `note-${Date.now()}-${Math.random()}@test.local`,
    name: "Notetaker",
    passwordHash: "x",
  });
  ownerId = String(user._id);
  const project = await Project.create({ name: "Note test", owner: user._id, members: [] });
  projectId = String(project._id);
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: "user",
    mustChangePassword: false,
  });
});

function postNote(body: Record<string, unknown>) {
  const req = new Request(`http://localhost/api/projects/${projectId}/items/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return createNote(req, { params: Promise.resolve({ id: projectId }) });
}

async function patchNote(id: string, body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/items/[id]/route");
  const req = new Request(`http://localhost/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe("POST /api/projects/:id/items/notes", () => {
  it("creates a note with defaults", async () => {
    const res = await postNote({ x: 10, y: 20 });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as {
      item: {
        kind: string;
        content: string;
        color: string;
        width: number;
        height: number;
        x: number;
        y: number;
        objectKey: string;
      };
    };
    expect(item.kind).toBe("note");
    expect(item.content).toBe("");
    expect(item.color).toBe("#f6d660");
    expect(item.width).toBe(240);
    expect(item.height).toBe(180);
    expect(item.x).toBe(10);
    expect(item.y).toBe(20);
    // Placeholder key (unique per item); notes have no storage object.
    expect(item.objectKey).toMatch(/^notes\/[0-9a-f]{24}$/);
  });

  it("sanitizes initial content and validates the color", async () => {
    const res = await postNote({
      x: 0,
      y: 0,
      content: '<b>Hi</b><script>alert(1)</script><img src=x onerror="x">',
      color: "#AECBFA",
    });
    const { item } = (await res.json()) as { item: { content: string; color: string } };
    expect(item.content).toBe("<b>Hi</b>");
    expect(item.color).toBe("#aecbfa");
  });

  it("falls back to the default color for invalid input", async () => {
    const res = await postNote({ x: 0, y: 0, color: "red" });
    const { item } = (await res.json()) as { item: { color: string } };
    expect(item.color).toBe("#f6d660");
  });
});

describe("note items in the shared pipelines", () => {
  it("lists notes alongside image/link items", async () => {
    await postNote({ x: 5, y: 6, content: "<i>hello</i>" });
    const res = await listItems(undefined as unknown as Request, {
      params: Promise.resolve({ id: projectId }),
    });
    const { items } = (await res.json()) as {
      items: Array<{ kind: string; content: string; color: string }>;
    };
    const note = items.find((i) => i.kind === "note");
    expect(note).toBeDefined();
    expect(note!.content).toBe("<i>hello</i>");
    expect(note!.color).toBe("#f6d660");
  });

  it("patches content with sanitization", async () => {
    const { item } = (await (await postNote({ x: 0, y: 0 })).json()) as {
      item: { id: string };
    };
    const res = await patchNote(item.id, {
      content: '<ul><li>a</li></ul><script>bad()</script>',
    });
    expect(res.status).toBe(200);
    const { item: out } = (await res.json()) as { item: { content: string } };
    expect(out.content).toBe("<ul><li>a</li></ul>");
    expect((await Item.findById(item.id))?.content).toBe("<ul><li>a</li></ul>");
  });

  it("patches color and ignores invalid colors", async () => {
    const { item } = (await (await postNote({ x: 0, y: 0 })).json()) as {
      item: { id: string; color: string };
    };
    const ok = await patchNote(item.id, { color: "#EF8A80" });
    expect(((await ok.json()) as { item: { color: string } }).item.color).toBe("#ef8a80");

    const bad = await patchNote(item.id, { color: "javascript:alert(1)" });
    expect(((await bad.json()) as { item: { color: string } }).item.color).toBe("#ef8a80");
  });

  it("ignores content/color patches on non-note items", async () => {
    const image = await Item.create({
      project: projectId,
      kind: "image",
      objectKey: `${projectId}/${Date.now()}-img.png`,
      originalName: "photo.png",
      mime: "image/png",
      size: 123,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      z: 1,
      addedBy: ownerId,
    });
    const res = await patchNote(String(image._id), { content: "<b>x</b>", color: "#aecbfa" });
    expect(res.status).toBe(200);
    const persisted = await Item.findById(image._id);
    // Content applies (harmless, unused by image rendering); color stays default.
    expect(persisted?.color).toBe("#f6d660");
  });
});
