import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Isolated test database — never touch the dev `moodboard` database.
process.env.MONGODB_URI = "mongodb://localhost:27030/moodboard-test";

// Mock auth (next/headers cookies() has no scope under vitest).
vi.mock("@/lib/auth", async () => ({
  getCurrentUser: vi.fn(async () => null),
  startSession: vi.fn(async () => {}),
}));

import mongoose from "mongoose";
import { POST, DELETE } from "@/app/api/projects/[id]/members/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { setPublishTransportForTest } from "@/lib/realtime-publish";
import type { PublishMessage, ServerMessage } from "@/lib/realtime-protocol";

const frames: PublishMessage[] = [];

function post(pid: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/projects/${pid}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: pid }) }
  );
}

function del(pid: string, email: string): Promise<Response> {
  return DELETE(
    new Request(`http://localhost/api/projects/${pid}/members?email=${encodeURIComponent(email)}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: pid }) }
  );
}

async function seed() {
  const [owner, alice, bob] = await User.create([
    { email: "owner@test.local", name: "Owner", passwordHash: "x" },
    { email: "alice@test.local", name: "Alice", passwordHash: "x" },
    { email: "bob@test.local", name: "Bob", passwordHash: "x" },
  ]);
  const project = await Project.create({ name: "P", owner: owner._id, members: [alice._id] });
  const session = (u: { _id: mongoose.Types.ObjectId; email: string; name: string }) => ({
    id: String(u._id),
    email: u.email,
    name: u.name,
    role: "user" as const,
    mustChangePassword: false,
  });
  return {
    pid: String(project._id),
    owner: session(owner),
    alice: session(alice),
    aliceId: String(alice._id),
    bobEmail: "bob@test.local",
  };
}

describe("project members API", () => {
  let pid: string;
  let owner: Awaited<ReturnType<typeof seed>>["owner"];
  let alice: Awaited<ReturnType<typeof seed>>["alice"];
  let aliceId: string;
  let bobEmail: string;

  beforeEach(async () => {
    await connectDB();
    await User.deleteMany({});
    await Project.deleteMany({});
    frames.length = 0;
    setPublishTransportForTest((msg) => frames.push(msg));
    const s = await seed();
    pid = s.pid;
    owner = s.owner;
    alice = s.alice;
    aliceId = s.aliceId;
    bobEmail = s.bobEmail;
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Project.deleteMany({});
    await mongoose.disconnect();
  });

  it("owner invite returns ok and broadcasts project:members with the fresh list", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    const res = await post(pid, { email: bobEmail });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.type).toBe("publish");
    expect(frame.projectId).toBe(pid);
    const event = frame.event as Extract<ServerMessage, { type: "project:members" }>;
    expect(event.type).toBe("project:members");
    expect(event.removedUserIds).toEqual([]);
    expect(event.members.map((m) => m.email).sort()).toEqual(["alice@test.local", "bob@test.local"]);
    expect(event.members.every((m) => typeof m.id === "string" && m.name.length > 0)).toBe(true);
  });

  it("non-owner invite is 403 and broadcasts nothing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(alice);
    const res = await post(pid, { email: bobEmail });
    expect(res.status).toBe(403);
    expect(frames).toHaveLength(0);
  });

  it("inviting an email without an account is 404", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    const res = await post(pid, { email: "ghost@test.local" });
    expect(res.status).toBe(404);
    expect(frames).toHaveLength(0);
  });

  it("inviting an existing member is 409", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    const res = await post(pid, { email: "alice@test.local" });
    expect(res.status).toBe(409);
    expect(frames).toHaveLength(0);
  });

  it("owner remove broadcasts project:members with removedUserIds", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    const res = await del(pid, "alice@test.local");
    expect(res.status).toBe(200);
    expect(frames).toHaveLength(1);
    const event = frames[0].event as Extract<ServerMessage, { type: "project:members" }>;
    expect(event.removedUserIds).toEqual([aliceId]);
    expect(event.members).toEqual([]);
  });

  it("a member can remove themselves (leave) and it broadcasts", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(alice);
    const res = await del(pid, "alice@test.local");
    expect(res.status).toBe(200);
    expect(frames).toHaveLength(1);
    const event = frames[0].event as Extract<ServerMessage, { type: "project:members" }>;
    expect(event.removedUserIds).toEqual([aliceId]);
  });

  it("a member cannot remove someone else", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(alice);
    const res = await del(pid, bobEmail);
    expect(res.status).toBe(403);
    expect(frames).toHaveLength(0);
  });

  it("the owner cannot be removed", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    const res = await del(pid, "owner@test.local");
    expect(res.status).toBe(400);
    expect(frames).toHaveLength(0);
  });
});
