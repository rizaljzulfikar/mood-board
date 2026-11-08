import { describe, it, expect } from "vitest";
import { applyRealtimeEvent, applyPresenceEvent, type BoardState } from "@/lib/realtime-client";

const base: BoardState = {
  items: [{ id: "i1", kind: "image", x: 0, y: 0, width: 1, height: 1, rotation: 0, z: 1, objectKey: "k", originalName: "n", mime: "image/png", sourceUrl: null, title: null, siteName: null, label: "", addedBy: "u", updatedAt: "2026-01-01T00:00:00.000Z" }],
  groups: [],
  connections: [],
};

describe("applyRealtimeEvent", () => {
  it("merges an item upsert", () => {
    const next = applyRealtimeEvent(base, { type: "item:upsert", data: { ...base.items[0], x: 99 } }, []);
    expect(next.items[0].x).toBe(99);
  });
  it("applies an item delete", () => {
    expect(applyRealtimeEvent(base, { type: "item:delete", id: "i1" }, []).items).toHaveLength(0);
  });
  it("keeps a locked item during delete", () => {
    expect(applyRealtimeEvent(base, { type: "item:delete", id: "i1" }, ["i1"]).items).toHaveLength(1);
  });
  it("ignores presence messages", () => {
    expect(applyRealtimeEvent(base, { type: "presence:leave", userId: "u" }, [])).toBe(base);
  });
});

describe("applyPresenceEvent", () => {
  const self = "me";
  it("filters self from a snapshot", () => {
    const users = applyPresenceEvent([], { type: "presence:snapshot", users: [{ userId: "me", name: "M", color: "c", cursor: null }, { userId: "u", name: "U", color: "c", cursor: null }] }, self);
    expect(users.map((u) => u.userId)).toEqual(["u"]);
  });
  it("upserts a join and removes a leave", () => {
    const joined = applyPresenceEvent([], { type: "presence:join", user: { userId: "u", name: "U", color: "c", cursor: null } }, self);
    expect(joined).toHaveLength(1);
    expect(applyPresenceEvent(joined, { type: "presence:leave", userId: "u" }, self)).toHaveLength(0);
  });
  it("updates a cursor", () => {
    const users = applyPresenceEvent([{ userId: "u", name: "U", color: "c", cursor: null }], { type: "presence:cursor", userId: "u", cursor: { x: 1, y: 2 } }, self);
    expect(users[0].cursor).toEqual({ x: 1, y: 2 });
  });
});
