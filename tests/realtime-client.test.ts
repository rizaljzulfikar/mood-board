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
  it("merges a group upsert and applies a group delete", () => {
    const group = { id: "g1", label: "G", x: 0, y: 0, width: 10, height: 10, z: 1, updatedAt: "2026-01-01T00:00:00.000Z" };
    const withGroup = applyRealtimeEvent(base, { type: "group:upsert", data: group }, []);
    expect(withGroup.groups).toEqual([group]);
    expect(applyRealtimeEvent(withGroup, { type: "group:delete", id: "g1" }, []).groups).toHaveLength(0);
  });
  it("merges a connection upsert and applies a connection delete", () => {
    const connection = { id: "c1", from: "i1", to: "i1", style: "line" as const, updatedAt: "2026-01-01T00:00:00.000Z" };
    const withConnection = applyRealtimeEvent(base, { type: "connection:upsert", data: connection }, []);
    expect(withConnection.connections).toEqual([connection]);
    expect(applyRealtimeEvent(withConnection, { type: "connection:delete", id: "c1" }, []).connections).toHaveLength(0);
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
