import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({ getCurrentUser: vi.fn(async () => null) }));

import { signRoomTicket, verifyRoomTicket } from "@/lib/realtime-ticket";
import { GET } from "@/app/api/projects/[id]/realtime-ticket/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";

const SECRET = "test-realtime-secret";

describe("room tickets", () => {
  it("round-trips project, user and name", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", 60_000);
    expect(await verifyRoomTicket(t, SECRET)).toEqual({ projectId: "p1", userId: "u1", name: "Alice" });
  });
  it("rejects an expired ticket", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", -1_000);
    expect(await verifyRoomTicket(t, SECRET)).toBeNull();
  });
  it("rejects a tampered ticket", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", 60_000);
    const [header, payload, signature] = t.split(".");
    const last = payload.at(-1);
    const tamperedPayload = payload.slice(0, -1) + (last === "a" ? "b" : "a");
    expect(await verifyRoomTicket(`${header}.${tamperedPayload}.${signature}`, SECRET)).toBeNull();
  });
  it("rejects a ticket signed with another secret", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", 60_000);
    expect(await verifyRoomTicket(t, "other-secret")).toBeNull();
  });
});

describe("GET /api/projects/:id/realtime-ticket", () => {
  beforeEach(async () => {
    await connectDB();
    const user = await User.create({ email: `rt-${Date.now()}-${Math.random()}@test.local`, name: "R", passwordHash: "x" });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: String(user._id), email: user.email, name: user.name, role: "user", mustChangePassword: false });
  });

  it("returns a verifiable ticket for a member", async () => {
    const user = await getCurrentUser();
    const project = await Project.create({ name: "P", owner: user!.id, members: [] });
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: String(project._id) }) });
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    const claims = await verifyRoomTicket(ticket, SECRET);
    expect(claims?.projectId).toBe(String(project._id));
    expect(claims?.userId).toBe(user!.id);
  });
});
