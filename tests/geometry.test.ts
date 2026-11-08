import { describe, it, expect } from "vitest";
import {
  edgeAnchors,
  pointInRect,
  rectCenter,
  rectContainsItemCenter,
  type Rect,
} from "@/lib/geometry";

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, width: w, height: h };
}

describe("pointInRect", () => {
  it("is inclusive of edges", () => {
    const r = rect(0, 0, 10, 10);
    expect(pointInRect({ x: 0, y: 5 }, r)).toBe(true);
    expect(pointInRect({ x: 10, y: 5 }, r)).toBe(true);
    expect(pointInRect({ x: 10.1, y: 5 }, r)).toBe(false);
  });
});

describe("rectContainsItemCenter", () => {
  it("groups an image whose center is inside the box", () => {
    const group = rect(0, 0, 100, 100);
    const inside = rect(40, 40, 100, 80); // center (90, 80)
    const outside = rect(150, 150, 100, 80); // center (200, 190)
    expect(rectContainsItemCenter(group, inside)).toBe(true);
    expect(rectContainsItemCenter(group, outside)).toBe(false);
  });

  it("does not group an image that merely overlaps the box edge", () => {
    const group = rect(0, 0, 100, 100);
    // Image spans from x=-80 to x=20 → center x=-30, outside the box.
    const straddling = rect(-80, 10, 100, 50);
    expect(rectContainsItemCenter(group, straddling)).toBe(false);
  });
});

describe("rectCenter", () => {
  it("returns the midpoint", () => {
    expect(rectCenter(rect(10, 20, 100, 60))).toEqual({ x: 60, y: 50 });
  });
});

describe("edgeAnchors", () => {
  it("anchors a rightward connection on the facing edges", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 0, 100, 100);
    const { start, end } = edgeAnchors(a, b);
    expect(start).toEqual({ x: 100, y: 50 });
    expect(end).toEqual({ x: 300, y: 50 });
  });

  it("anchors a leftward connection on the facing edges", () => {
    const a = rect(300, 0, 100, 100);
    const b = rect(0, 0, 100, 100);
    const { start, end } = edgeAnchors(a, b);
    expect(start).toEqual({ x: 300, y: 50 });
    expect(end).toEqual({ x: 100, y: 50 });
  });

  it("anchors a diagonal connection where the center segment crosses each edge", () => {
    const a = rect(0, 0, 100, 100); // center (50, 50)
    const b = rect(300, 300, 100, 100); // center (350, 350)
    const { start, end } = edgeAnchors(a, b);
    // The 45° segment leaves a at (100, 100) and enters b at (300, 300).
    expect(start).toEqual({ x: 100, y: 100 });
    expect(end).toEqual({ x: 300, y: 300 });
  });

  it("keeps anchors on the rect boundary when boxes touch", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(100, 0, 100, 100); // shares the x=100 edge
    const { start, end } = edgeAnchors(a, b);
    expect(start).toEqual({ x: 100, y: 50 });
    expect(end).toEqual({ x: 100, y: 50 });
  });

  it("falls back to centers when one box contains the other", () => {
    const a = rect(0, 0, 200, 200); // center (100, 100)
    const b = rect(50, 50, 50, 50); // center (75, 75), inside a
    const { start, end } = edgeAnchors(a, b);
    expect(start).toEqual({ x: 100, y: 100 });
    expect(end).toEqual({ x: 75, y: 75 });
  });

  it("degenerates to centers when both centers coincide", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(-50, -50, 200, 200); // same center (50, 50)
    const { start, end } = edgeAnchors(a, b);
    expect(start).toEqual({ x: 50, y: 50 });
    expect(end).toEqual({ x: 50, y: 50 });
  });
});
