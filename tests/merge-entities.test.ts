import { describe, it, expect } from "vitest";
import { mergeRemoteEntities, type ConnectionState, type GroupState } from "@/lib/merge";

function group(partial: Partial<GroupState> & { id: string }): GroupState {
  return {
    label: "Group",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    z: 1,
    updatedAt: "2026-11-08T00:00:00.000Z",
    ...partial,
  };
}

function connection(partial: Partial<ConnectionState> & { id: string }): ConnectionState {
  return {
    from: "g1",
    to: "g2",
    style: "arrow",
    updatedAt: "2026-11-08T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeRemoteEntities (groups)", () => {
  it("applies remote label/geometry updates", () => {
    const local = [group({ id: "g1", label: "old" })];
    const result = mergeRemoteEntities(local, [group({ id: "g1", label: "Mood", x: 9 })], [], []);
    expect(result[0].label).toBe("Mood");
    expect(result[0].x).toBe(9);
  });

  it("keeps the local geometry of a group the user is dragging", () => {
    const local = [group({ id: "g1", x: 5 })];
    const result = mergeRemoteEntities(local, [group({ id: "g1", x: 999 })], [], ["g1"]);
    expect(result[0].x).toBe(5);
  });

  it("adds groups created by other users and removes deleted ones", () => {
    const local = [group({ id: "g1" })];
    const merged = mergeRemoteEntities(local, [group({ id: "g1" }), group({ id: "g2" })], [], []);
    expect(merged.map((g) => g.id)).toEqual(["g1", "g2"]);
    const removed = mergeRemoteEntities(local, [], ["g1"], []);
    expect(removed).toEqual([]);
  });

  it("keeps a locked group even if another user deleted it", () => {
    const local = [group({ id: "g1", x: 5 })];
    const result = mergeRemoteEntities(local, [], ["g1"], ["g1"]);
    expect(result.map((g) => g.id)).toEqual(["g1"]);
  });
});

describe("mergeRemoteEntities (connections)", () => {
  it("applies remote style toggles", () => {
    const local = [connection({ id: "c1", style: "arrow" })];
    const result = mergeRemoteEntities(local, [connection({ id: "c1", style: "line" })], [], []);
    expect(result[0].style).toBe("line");
  });

  it("removes connections deleted by other users", () => {
    const local = [connection({ id: "c1" }), connection({ id: "c2", from: "g2", to: "g3" })];
    const result = mergeRemoteEntities(local, [], ["c1"], []);
    expect(result.map((c) => c.id)).toEqual(["c2"]);
  });
});
