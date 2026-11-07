import { describe, it, expect } from "vitest";
import { buildObjectKey, parseStorageKey } from "@/lib/storage-key";

describe("buildObjectKey", () => {
  it("builds projectId/itemId.ext", () => {
    expect(buildObjectKey("a1b2", "c3d4", "png")).toBe("a1b2/c3d4.png");
  });
});

describe("parseStorageKey", () => {
  it("parses a valid two-segment key", () => {
    expect(parseStorageKey(["a1b2", "c3d4.png"])).toEqual({
      projectId: "a1b2",
      filename: "c3d4.png",
    });
  });

  it("rejects wrong segment counts", () => {
    expect(parseStorageKey(["a1b2"])).toBeNull();
    expect(parseStorageKey(["a1b2", "c3d4.png", "extra"])).toBeNull();
    expect(parseStorageKey([])).toBeNull();
  });

  it("rejects path traversal segments", () => {
    expect(parseStorageKey(["..", "c3d4.png"])).toBeNull();
    expect(parseStorageKey(["a1b2", ".."])).toBeNull();
    expect(parseStorageKey([".", "c3d4.png"])).toBeNull();
  });

  it("rejects segments with unsafe characters", () => {
    expect(parseStorageKey(["a1b2", "sub/dir.png"])).toBeNull();
    expect(parseStorageKey(["a1b2", "note space.png"])).toBeNull();
    expect(parseStorageKey(["a b", "c3d4.png"])).toBeNull();
  });
});
