import { describe, it, expect } from "vitest";
import { DRAG_THRESHOLD_PX, movedPastDragThreshold } from "@/lib/drag";

describe("movedPastDragThreshold", () => {
  it("treats a still pointer as a click", () => {
    expect(movedPastDragThreshold({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it("ignores movement below the threshold", () => {
    expect(movedPastDragThreshold({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
  });

  it("activates once the pointer travels the threshold distance", () => {
    expect(movedPastDragThreshold({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
  });

  it("measures diagonal travel, not per-axis travel", () => {
    // 3px on each axis is ~4.24px overall — past a 4px threshold.
    expect(movedPastDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    // 2px on each axis is ~2.83px overall — still a click.
    expect(movedPastDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(movedPastDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBe(false);
    expect(movedPastDragThreshold({ x: 0, y: 0 }, { x: 10, y: 0 }, 10)).toBe(true);
  });

  it("uses a small default so clicks stay clicks", () => {
    expect(DRAG_THRESHOLD_PX).toBeLessThanOrEqual(6);
  });
});
