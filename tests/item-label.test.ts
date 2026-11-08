import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { PATCH } from "@/app/api/items/[id]/route";
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
    email: `label-${Date.now()}-${Math.random()}@test.local`,
    name: "Labeler",
    passwordHash: "x",
  });
  ownerId = String(user._id);
  const project = await Project.create({ name: "Label test", owner: user._id, members: [] });
  projectId = String(project._id);
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: "user",
    mustChangePassword: false,
  });
});

function makeItem() {
  return Item.create({
    project: projectId,
    kind: "image",
    objectKey: `${projectId}/${Date.now()}-${Math.random()}.png`,
    originalName: "photo.png",
    mime: "image/png",
    size: 123,
    width: 400,
    height: 300,
    x: 0,
    y: 0,
    rotation: 0,
    z: 1,
    addedBy: ownerId,
  });
}

async function patchItem(id: string, body: Record<string, unknown>) {
  const req = new Request(`http://localhost/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe("PATCH /api/items/:id label", () => {
  it("sets a label and returns it in the item JSON", async () => {
    const item = await makeItem();

    const res = await patchItem(String(item._id), { label: "  Summer mood  " });
    expect(res.status).toBe(200);
    const { item: out } = (await res.json()) as { item: { label: string; kind: string; sourceUrl: string | null } };
    expect(out.label).toBe("Summer mood");
    expect(out.kind).toBe("image");
    expect(out.sourceUrl).toBeNull();

    const persisted = await Item.findById(item._id);
    expect(persisted?.label).toBe("Summer mood");
  });

  it("clears a label with an empty string and clamps to 120 chars", async () => {
    const item = await makeItem();

    await patchItem(String(item._id), { label: "x".repeat(150) });
    const clamped = await Item.findById(item._id);
    expect(clamped?.label).toHaveLength(120);

    await patchItem(String(item._id), { label: "" });
    expect((await Item.findById(item._id))?.label).toBe("");
  });

  it("ignores non-string labels", async () => {
    const item = await makeItem();

    const res = await patchItem(String(item._id), { label: 42 });
    expect(res.status).toBe(200);
    expect((await Item.findById(item._id))?.label).toBe("");
  });
});
