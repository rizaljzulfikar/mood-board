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
    email: `crop-${Date.now()}-${Math.random()}@test.local`,
    name: "Cropper",
    passwordHash: "x",
  });
  ownerId = String(user._id);
  const project = await Project.create({ name: "Crop test", owner: user._id, members: [] });
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
    x: 10,
    y: 20,
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

describe("PATCH /api/items/:id crop", () => {
  it("defaults new items to a full crop", async () => {
    const item = await makeItem();
    const res = await patchItem(String(item._id), { z: 2 });
    const { item: out } = (await res.json()) as { item: { crop: unknown } };
    expect(out.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("persists a crop rectangle and returns it with the geometry", async () => {
    const item = await makeItem();
    const crop = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };

    const res = await patchItem(String(item._id), {
      x: 50,
      y: 60,
      width: 240,
      height: 150,
      crop,
    });
    expect(res.status).toBe(200);

    const { item: out } = (await res.json()) as {
      item: { crop: unknown; x: number; width: number };
    };
    expect(out.crop).toEqual(crop);
    expect(out.x).toBe(50);
    expect(out.width).toBe(240);

    const persisted = await Item.findById(item._id);
    expect(persisted?.crop.toObject()).toEqual(crop);
  });

  it("clamps crops to the image bounds", async () => {
    const item = await makeItem();
    await patchItem(String(item._id), {
      crop: { x: 1.5, y: -2, w: 4, h: 0 },
    });

    const persisted = await Item.findById(item._id);
    const crop = persisted?.crop.toObject();
    expect(crop?.x).toBeCloseTo(0.98);
    expect(crop?.y).toBe(0);
    expect(crop?.w).toBeCloseTo(0.02);
    expect(crop?.h).toBeCloseTo(0.02);
  });

  it("ignores non-object crops", async () => {
    const item = await makeItem();
    await patchItem(String(item._id), { crop: "nope" });
    expect((await Item.findById(item._id))?.crop.toObject()).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});
