import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { PATCH as patchItemRoute, DELETE as deleteItemRoute } from "@/app/api/items/[id]/route";
import { PATCH as patchGroupRoute, DELETE as deleteGroupRoute } from "@/app/api/groups/[id]/route";
import { PATCH as patchConnectionRoute } from "@/app/api/connections/[id]/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";
import { Group } from "@/lib/models/Group";
import { Connection } from "@/lib/models/Connection";

let ownerId: string;
let projectId: string;

beforeEach(async () => {
  await connectDB();
  const user = await User.create({
    email: `undo-${Date.now()}-${Math.random()}@test.local`,
    name: "Undoer",
    passwordHash: "x",
  });
  ownerId = String(user._id);
  const project = await Project.create({ name: "Undo test", owner: user._id, members: [] });
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

function makeGroup(overrides: Record<string, unknown> = {}) {
  return Group.create({
    project: projectId,
    label: "",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z: 1,
    addedBy: ownerId,
    ...overrides,
  });
}

async function makeConnection(style: "arrow" | "line" = "line") {
  const a = await makeGroup();
  const b = await makeGroup({ z: 2 });
  return Connection.create({
    project: projectId,
    from: a._id,
    to: b._id,
    style,
    addedBy: ownerId,
  });
}

function patchRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function softDelete(doc: { deletedAt: Date | null; save: () => Promise<unknown> }) {
  doc.deletedAt = new Date();
  await doc.save();
}

describe("authorization", () => {
  it("rejects deleted-flag patches from a non-member without mutating the doc", async () => {
    const outsider = await User.create({
      email: `outside-${Date.now()}-${Math.random()}@test.local`,
      name: "Outsider",
      passwordHash: "x",
    });
    const item = await makeItem();
    const group = await makeGroup();
    const connection = await makeConnection();

    vi.mocked(getCurrentUser).mockResolvedValue({
      id: String(outsider._id),
      email: outsider.email,
      name: outsider.name,
      role: "user",
      mustChangePassword: false,
    });

    const itemRes = await patchItemRoute(
      patchRequest(`http://localhost/api/items/${item._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(item._id) }) }
    );
    const groupRes = await patchGroupRoute(
      patchRequest(`http://localhost/api/groups/${group._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(group._id) }) }
    );
    const connectionRes = await patchConnectionRoute(
      patchRequest(`http://localhost/api/connections/${connection._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(connection._id) }) }
    );

    expect(itemRes.status).toBe(403);
    expect(groupRes.status).toBe(403);
    expect(connectionRes.status).toBe(403);
    expect((await Item.findById(item._id))?.deletedAt).toBeNull();
    expect((await Group.findById(group._id))?.deletedAt).toBeNull();
    expect((await Connection.findById(connection._id))?.deletedAt).toBeNull();
  });
});

describe("PATCH /api/items/:id deleted flag", () => {
  it("restores a soft-deleted item and applies fields in the same call", async () => {
    const item = await makeItem();
    await softDelete(item);
    const deletedAt = item.deletedAt as Date;

    const res = await patchItemRoute(
      patchRequest(`http://localhost/api/items/${item._id}`, {
        deleted: false,
        x: 42,
        label: "back",
      }),
      { params: Promise.resolve({ id: String(item._id) }) }
    );
    expect(res.status).toBe(200);

    const restored = await Item.findById(item._id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.x).toBe(42);
    expect(restored?.label).toBe("back");
    expect(restored!.updatedAt > deletedAt).toBe(true);
  });

  it("re-deletes a live item and rejects re-deleting a deleted one", async () => {
    const item = await makeItem();
    const res = await patchItemRoute(
      patchRequest(`http://localhost/api/items/${item._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(item._id) }) }
    );
    expect(res.status).toBe(200);
    expect((await Item.findById(item._id))?.deletedAt).not.toBeNull();

    const again = await patchItemRoute(
      patchRequest(`http://localhost/api/items/${item._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(item._id) }) }
    );
    expect(again.status).toBe(404);
  });

  it("keeps 404 for a plain patch on a soft-deleted item", async () => {
    const item = await makeItem();
    await softDelete(item);
    const res = await patchItemRoute(
      patchRequest(`http://localhost/api/items/${item._id}`, { label: "x" }),
      { params: Promise.resolve({ id: String(item._id) }) }
    );
    expect(res.status).toBe(404);
  });

  it("still supports the DELETE route alongside the flag", async () => {
    const item = await makeItem();
    const res = await deleteItemRoute(
      new Request(`http://localhost/api/items/${item._id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: String(item._id) }) }
    );
    expect(res.status).toBe(200);
    expect((await Item.findById(item._id))?.deletedAt).not.toBeNull();
  });
});

describe("PATCH /api/groups/:id deleted flag", () => {
  it("restores a soft-deleted group and applies fields", async () => {
    const group = await makeGroup();
    await softDelete(group);

    const res = await patchGroupRoute(
      patchRequest(`http://localhost/api/groups/${group._id}`, {
        deleted: false,
        x: 7,
        label: "g",
      }),
      { params: Promise.resolve({ id: String(group._id) }) }
    );
    expect(res.status).toBe(200);

    const restored = await Group.findById(group._id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.x).toBe(7);
    expect(restored?.label).toBe("g");
    // The restore must bump updatedAt so other clients' next sync sees it.
    expect(restored!.updatedAt > (group.deletedAt as Date)).toBe(true);
  });

  it("re-deletes a live group and rejects re-deleting a deleted one", async () => {
    const group = await makeGroup();
    const res = await patchGroupRoute(
      patchRequest(`http://localhost/api/groups/${group._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(group._id) }) }
    );
    expect(res.status).toBe(200);
    expect((await Group.findById(group._id))?.deletedAt).not.toBeNull();

    const again = await patchGroupRoute(
      patchRequest(`http://localhost/api/groups/${group._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(group._id) }) }
    );
    expect(again.status).toBe(404);
  });

  it("keeps 404 for a plain patch on a soft-deleted group", async () => {
    const group = await makeGroup();
    await softDelete(group);
    const res = await patchGroupRoute(
      patchRequest(`http://localhost/api/groups/${group._id}`, { label: "x" }),
      { params: Promise.resolve({ id: String(group._id) }) }
    );
    expect(res.status).toBe(404);
  });

  it("still supports the DELETE route alongside the flag", async () => {
    const group = await makeGroup();
    const res = await deleteGroupRoute(
      new Request(`http://localhost/api/groups/${group._id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: String(group._id) }) }
    );
    expect(res.status).toBe(200);
    expect((await Group.findById(group._id))?.deletedAt).not.toBeNull();
  });
});

describe("PATCH /api/connections/:id deleted flag", () => {
  it("restores a soft-deleted connection and applies style", async () => {
    const connection = await makeConnection("line");
    await softDelete(connection);

    const res = await patchConnectionRoute(
      patchRequest(`http://localhost/api/connections/${connection._id}`, {
        deleted: false,
        style: "arrow",
      }),
      { params: Promise.resolve({ id: String(connection._id) }) }
    );
    expect(res.status).toBe(200);

    const restored = await Connection.findById(connection._id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.style).toBe("arrow");
    // The restore must bump updatedAt so other clients' next sync sees it.
    expect(restored!.updatedAt > (connection.deletedAt as Date)).toBe(true);
  });

  it("keeps 404 for a plain patch on a soft-deleted connection", async () => {
    const connection = await makeConnection();
    await softDelete(connection);
    const res = await patchConnectionRoute(
      patchRequest(`http://localhost/api/connections/${connection._id}`, { style: "line" }),
      { params: Promise.resolve({ id: String(connection._id) }) }
    );
    expect(res.status).toBe(404);
  });

  it("re-deletes a live connection and rejects re-deleting a deleted one", async () => {
    const connection = await makeConnection();
    const res = await patchConnectionRoute(
      patchRequest(`http://localhost/api/connections/${connection._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(connection._id) }) }
    );
    expect(res.status).toBe(200);
    expect((await Connection.findById(connection._id))?.deletedAt).not.toBeNull();

    const again = await patchConnectionRoute(
      patchRequest(`http://localhost/api/connections/${connection._id}`, { deleted: true }),
      { params: Promise.resolve({ id: String(connection._id) }) }
    );
    expect(again.status).toBe(404);
  });
});
