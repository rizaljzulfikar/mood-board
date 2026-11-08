import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth (next/headers cookies() has no scope under vitest); Mongo and the
// real membership logic stay live.
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
}));

import { POST as createGroup, GET as listGroups } from "@/app/api/projects/[id]/groups/route";
import { PATCH as patchGroup, DELETE as deleteGroup } from "@/app/api/groups/[id]/route";
import {
  POST as createConnection,
  GET as listConnections,
} from "@/app/api/projects/[id]/connections/route";
import { PATCH as patchConnection, DELETE as deleteConnection } from "@/app/api/connections/[id]/route";
import { POST as sync } from "@/app/api/projects/[id]/sync/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Group } from "@/lib/models/Group";
import { Connection } from "@/lib/models/Connection";

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function createFixture() {
  await connectDB();
  const user = await User.create({
    email: `gc-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    name: "Group Tester",
    passwordHash: "x",
  });
  const project = await Project.create({ name: "Groups test", owner: user._id, members: [] });
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: "user",
    mustChangePassword: false,
  });
  return { user, project };
}

describe("group + connection API", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(getCurrentUser).mockImplementation(async () => null);
  });

  it("creates, lists, and patches a group", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);

    const created = await createGroup(
      jsonReq(`http://localhost/api/projects/${pid}/groups`, "POST", {
        x: 10,
        y: 20,
        width: 360,
        height: 240,
        label: "Material mood",
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(created.status).toBe(201);
    const { group } = (await created.json()) as { group: { id: string; label: string } };
    expect(group.label).toBe("Material mood");

    const listed = await listGroups(new Request(`http://localhost/api/projects/${pid}/groups`), {
      params: Promise.resolve({ id: pid }),
    });
    const { groups } = (await listed.json()) as { groups: unknown[] };
    expect(groups).toHaveLength(1);

    const patched = await patchGroup(
      jsonReq(`http://localhost/api/groups/${group.id}`, "PATCH", { label: "Colors", x: -5 }),
      { params: Promise.resolve({ id: group.id }) }
    );
    expect(patched.status).toBe(200);
    const { group: patchedGroup } = (await patched.json()) as {
      group: { label: string; x: number };
    };
    expect(patchedGroup.label).toBe("Colors");
    expect(patchedGroup.x).toBe(-5);
  });

  it("rejects non-finite geometry with sensible fallbacks instead of a 500", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);
    const res = await createGroup(
      jsonReq(`http://localhost/api/projects/${pid}/groups`, "POST", {
        x: "not-a-number",
        width: Number.NaN,
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(res.status).toBe(201);
    const { group } = (await res.json()) as { group: { x: number; width: number } };
    expect(group.x).toBe(0); // fallback for non-finite coordinate
    expect(group.width).toBe(360); // fallback default size
  });

  it("creates a connection between two groups and rejects invalid ones", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);

    const a = await (
      await createGroup(
        jsonReq(`http://localhost/api/projects/${pid}/groups`, "POST", { x: 0, y: 0 }),
        { params: Promise.resolve({ id: pid }) }
      )
    ).json();
    const b = await (
      await createGroup(
        jsonReq(`http://localhost/api/projects/${pid}/groups`, "POST", { x: 400, y: 0 }),
        { params: Promise.resolve({ id: pid }) }
      )
    ).json();
    const aId = (a as { group: { id: string } }).group.id;
    const bId = (b as { group: { id: string } }).group.id;

    const ok = await createConnection(
      jsonReq(`http://localhost/api/projects/${pid}/connections`, "POST", {
        fromId: aId,
        toId: bId,
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(ok.status).toBe(201);
    const { connection } = (await ok.json()) as {
      connection: { id: string; from: string; to: string; style: string };
    };
    expect(connection.from).toBe(aId);
    expect(connection.to).toBe(bId);
    expect(connection.style).toBe("arrow"); // default

    // Self-connection is rejected.
    const self = await createConnection(
      jsonReq(`http://localhost/api/projects/${pid}/connections`, "POST", {
        fromId: aId,
        toId: aId,
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(self.status).toBe(400);

    // Unknown endpoint group is rejected.
    const missing = await createConnection(
      jsonReq(`http://localhost/api/projects/${pid}/connections`, "POST", {
        fromId: aId,
        toId: "507f1f77bcf86cd799439011",
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    expect(missing.status).toBe(404);

    // Style can be toggled arrow ↔ line.
    const toggled = await patchConnection(
      jsonReq(`http://localhost/api/connections/${connection.id}`, "PATCH", { style: "line" }),
      { params: Promise.resolve({ id: connection.id }) }
    );
    const { connection: toggledConnection } = (await toggled.json()) as {
      connection: { style: string };
    };
    expect(toggledConnection.style).toBe("line");
  });

  it("deleting a group soft-deletes its connections (cascade)", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);

    const make = async (x: number) => {
      const res = await createGroup(
        jsonReq(`http://localhost/api/projects/${pid}/groups`, "POST", { x, y: 0 }),
        { params: Promise.resolve({ id: pid }) }
      );
      return ((await res.json()) as { group: { id: string } }).group.id;
    };
    const aId = await make(0);
    const bId = await make(400);

    const connRes = await createConnection(
      jsonReq(`http://localhost/api/projects/${pid}/connections`, "POST", {
        fromId: aId,
        toId: bId,
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    const { connection } = (await connRes.json()) as { connection: { id: string } };

    const del = await deleteGroup(new Request(`http://localhost/api/groups/${aId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: aId }),
    });
    expect(del.status).toBe(200);

    const liveConnections = await Connection.countDocuments({ project: project._id, deletedAt: null });
    expect(liveConnections).toBe(0);
    const stillThere = await Connection.findById(connection.id);
    expect(stillThere?.deletedAt).not.toBeNull(); // soft, so sync can tell other clients

    const liveGroups = await Group.countDocuments({ project: project._id, deletedAt: null });
    expect(liveGroups).toBe(1); // b survives
  });

  it("sync returns group/connection deltas including deletions", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);

    const first = await sync(
      jsonReq(`http://localhost/api/projects/${pid}/sync`, "POST", { since: null }),
      { params: Promise.resolve({ id: pid }) }
    );
    const baseline = (await first.json()) as {
      groups: unknown[];
      connections: unknown[];
      now: string;
    };
    expect(baseline.groups).toHaveLength(0);
    expect(baseline.connections).toHaveLength(0);

    const make = async (x: number) => {
      const res = await createGroup(
        jsonReq(`http://localhost/api/projects/${pid}/groups`, "POST", { x, y: 0 }),
        { params: Promise.resolve({ id: pid }) }
      );
      return ((await res.json()) as { group: { id: string } }).group.id;
    };
    const aId = await make(0);
    const bId = await make(400);
    const connRes = await createConnection(
      jsonReq(`http://localhost/api/projects/${pid}/connections`, "POST", {
        fromId: aId,
        toId: bId,
      }),
      { params: Promise.resolve({ id: pid }) }
    );
    const { connection } = (await connRes.json()) as { connection: { id: string } };

    const delta = await sync(
      jsonReq(`http://localhost/api/projects/${pid}/sync`, "POST", { since: baseline.now }),
      { params: Promise.resolve({ id: pid }) }
    );
    const deltaData = (await delta.json()) as {
      groups: Array<{ id: string }>;
      connections: Array<{ id: string }>;
      now: string;
    };
    expect(deltaData.groups.map((g) => g.id)).toEqual(expect.arrayContaining([aId, bId]));
    expect(deltaData.connections.map((c) => c.id)).toContain(connection.id);

    await deleteConnection(
      new Request(`http://localhost/api/connections/${connection.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: connection.id }) }
    );

    const afterDelete = await sync(
      jsonReq(`http://localhost/api/projects/${pid}/sync`, "POST", { since: deltaData.now }),
      { params: Promise.resolve({ id: pid }) }
    );
    const afterData = (await afterDelete.json()) as { deletedConnectionIds: string[] };
    expect(afterData.deletedConnectionIds).toContain(connection.id);
  });

  it("lists connections for a project", async () => {
    const { project } = await createFixture();
    const pid = String(project._id);
    const res = await listConnections(new Request(`http://localhost/api/projects/${pid}/connections`), {
      params: Promise.resolve({ id: pid }),
    });
    const { connections } = (await res.json()) as { connections: unknown[] };
    expect(Array.isArray(connections)).toBe(true);
  });
});
