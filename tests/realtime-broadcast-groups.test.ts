import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/realtime-publish", () => ({ broadcastUpsert: vi.fn(), broadcastDelete: vi.fn() }));

import { PATCH as patchGroup, DELETE as deleteGroup } from "@/app/api/groups/[id]/route";
import { POST as createGroup } from "@/app/api/projects/[id]/groups/route";
import { PATCH as patchConnection, DELETE as deleteConnection } from "@/app/api/connections/[id]/route";
import { POST as createConnection } from "@/app/api/projects/[id]/connections/route";
import { broadcastUpsert, broadcastDelete } from "@/lib/realtime-publish";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Group } from "@/lib/models/Group";
import { Connection } from "@/lib/models/Connection";

const req = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("group and connection broadcasts", () => {
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    await connectDB();
    const user = await User.create({ email: `rb-${Date.now()}-${Math.random()}@test.local`, name: "B", passwordHash: "x" });
    const project = await Project.create({ name: "Broadcasts", owner: user._id, members: [] });
    userId = String(user._id);
    projectId = String(project._id);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: user.email, name: user.name, role: "user", mustChangePassword: false });
    vi.clearAllMocks();
  });

  const makeGroup = () => Group.create({ project: projectId, label: "Group", x: 0, y: 0, width: 360, height: 240, z: 1, addedBy: userId, deletedAt: null });
  const makeConnection = (from: string, to: string) => Connection.create({ project: projectId, from, to, style: "arrow", addedBy: userId, deletedAt: null });

  it("broadcasts a group upsert after PATCH", async () => {
    const group = await makeGroup();
    await patchGroup(req(`http://x/api/groups/${group._id}`, "PATCH", { x: 42 }), { params: Promise.resolve({ id: String(group._id) }) });
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "group", expect.objectContaining({ id: String(group._id) }));
  });

  it("broadcasts a group delete after deleted:true PATCH", async () => {
    const group = await makeGroup();
    await patchGroup(req(`http://x/api/groups/${group._id}`, "PATCH", { deleted: true }), { params: Promise.resolve({ id: String(group._id) }) });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "group", String(group._id));
  });

  it("broadcasts group and attached connection deletes on group DELETE", async () => {
    const a = await makeGroup();
    const b = await makeGroup();
    const c = await makeGroup();
    const first = await makeConnection(String(a._id), String(b._id));
    const second = await makeConnection(String(c._id), String(a._id));
    await deleteGroup(req(`http://x/api/groups/${a._id}`, "DELETE"), { params: Promise.resolve({ id: String(a._id) }) });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "group", String(a._id));
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "connection", String(first._id));
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "connection", String(second._id));
  });

  it("broadcasts connection upsert and deletes", async () => {
    const a = await makeGroup();
    const b = await makeGroup();
    const connection = await makeConnection(String(a._id), String(b._id));
    await patchConnection(req(`http://x/api/connections/${connection._id}`, "PATCH", { style: "line" }), { params: Promise.resolve({ id: String(connection._id) }) });
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "connection", expect.objectContaining({ id: String(connection._id) }));
    await deleteConnection(req(`http://x/api/connections/${connection._id}`, "DELETE"), { params: Promise.resolve({ id: String(connection._id) }) });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "connection", String(connection._id));
  });

  it("broadcasts newly created groups and connections", async () => {
    const groupResponse = await createGroup(req(`http://x/api/projects/${projectId}/groups`, "POST", { x: 0, y: 0 }), { params: Promise.resolve({ id: projectId }) });
    const { group } = (await groupResponse.json()) as { group: { id: string } };
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "group", expect.objectContaining({ id: group.id }));
    const other = await makeGroup();
    const connectionResponse = await createConnection(req(`http://x/api/projects/${projectId}/connections`, "POST", { fromId: group.id, toId: String(other._id) }), { params: Promise.resolve({ id: projectId }) });
    const { connection } = (await connectionResponse.json()) as { connection: { id: string } };
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "connection", expect.objectContaining({ id: connection.id }));
  });
});
