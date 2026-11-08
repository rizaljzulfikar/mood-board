import { describe, it, expect } from "vitest";
import { mergeRemoteItems, type ItemState } from "@/lib/merge";

function item(partial: Partial<ItemState> & { id: string }): ItemState {
  return {
    kind: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    z: 1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    objectKey: `${partial.id}.png`,
    originalName: "img.png",
    mime: "image/png",
    sourceUrl: null,
    title: null,
    siteName: null,
    label: "",
    addedBy: "userA",
    updatedAt: "2026-11-07T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeRemoteItems", () => {
  it("applies remote updates to unlocked items", () => {
    const local = [item({ id: "a" })];
    const incoming = [item({ id: "a", x: 42, y: -7 })];
    const result = mergeRemoteItems(local, incoming, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(42);
    expect(result[0].y).toBe(-7);
  });

  it("keeps the local position of an item the user is dragging", () => {
    const local = [item({ id: "a", x: 10, y: 20 })];
    const incoming = [item({ id: "a", x: 999, y: 999 })];
    const result = mergeRemoteItems(local, incoming, [], ["a"]);
    expect(result[0].x).toBe(10);
    expect(result[0].y).toBe(20);
  });

  it("adds items created by other users", () => {
    const local = [item({ id: "a" })];
    const incoming = [item({ id: "a" }), item({ id: "b", z: 2 })];
    const result = mergeRemoteItems(local, incoming, [], []);
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("removes items deleted by other users", () => {
    const local = [item({ id: "a" }), item({ id: "b" })];
    const incoming: ItemState[] = [];
    const result = mergeRemoteItems(local, incoming, ["b"], []);
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("keeps a locked item even if another user deleted it (deletion lands after drag ends)", () => {
    const local = [item({ id: "a", x: 5 })];
    const result = mergeRemoteItems(local, [], ["a"], ["a"]);
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("preserves local order of untouched items", () => {
    const local = [item({ id: "c" }), item({ id: "a" }), item({ id: "b" })];
    const incoming = [item({ id: "a", x: 7 })];
    const result = mergeRemoteItems(local, incoming, [], []);
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(result[1].x).toBe(7);
  });
});
