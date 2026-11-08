import { describe, it, expect } from "vitest";
import { RoomRegistry, type RoomClient } from "../src/realtime/rooms";

function client(id: string, projectId: string, userId: string): RoomClient & { sent: string[] } {
  const sent: string[] = [];
  return { id, projectId, userId, name: userId, sent, send: (m) => sent.push(m) };
}

describe("RoomRegistry", () => {
  it("broadcasts only to the target room and can skip one client", () => {
    const r = new RoomRegistry();
    const a = client("a", "p1", "u1");
    const b = client("b", "p1", "u2");
    const c = client("c", "p2", "u3");
    r.add(a); r.add(b); r.add(c);
    r.broadcast("p1", { type: "item:delete", id: "x" }, "a");
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
    expect(c.sent).toHaveLength(0);
  });

  it("reports firstForUser and lastForUser across two sockets of one user", () => {
    const r = new RoomRegistry();
    const a1 = client("a1", "p1", "u1");
    const a2 = client("a2", "p1", "u1");
    expect(r.add(a1).firstForUser).toBe(true);
    expect(r.add(a2).firstForUser).toBe(false);
    expect(r.remove("a1")?.lastForUser).toBe(false);
    expect(r.remove("a2")?.lastForUser).toBe(true);
  });

  it("snapshot dedupes per user and carries the last cursor", () => {
    const r = new RoomRegistry();
    r.add(client("a1", "p1", "u1"));
    r.add(client("a2", "p1", "u1"));
    r.add(client("b", "p1", "u2"));
    r.updateCursor("p1", "u1", { x: 4, y: 5 });
    const snap = r.snapshot("p1");
    expect(snap).toHaveLength(2);
    expect(snap.find((u) => u.userId === "u1")?.cursor).toEqual({ x: 4, y: 5 });
  });

  it("removing the last socket drops the user from presence", () => {
    const r = new RoomRegistry();
    r.add(client("a", "p1", "u1"));
    r.remove("a");
    expect(r.hasUser("p1", "u1")).toBe(false);
    expect(r.snapshot("p1")).toHaveLength(0);
  });

  it("swallows send errors so one dead socket cannot break a broadcast", () => {
    const r = new RoomRegistry();
    const bad: RoomClient = { id: "bad", projectId: "p1", userId: "u1", name: "u1", send: () => { throw new Error("boom"); } };
    r.add(bad);
    r.add(client("ok", "p1", "u2"));
    expect(() => r.broadcast("p1", { type: "item:delete", id: "x" })).not.toThrow();
  });
});
