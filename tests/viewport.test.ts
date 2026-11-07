import { describe, it, expect } from "vitest";
import {
  toWorld,
  toScreen,
  zoomAt,
  fitViewport,
  type Viewport,
  type FitItem,
} from "@/lib/viewport";

describe("toWorld / toScreen", () => {
  const v: Viewport = { x: 300, y: -120, scale: 1.5 };

  it("inverts the screen transform", () => {
    const world = toWorld(900, 300, v);
    expect(world.x).toBe(400); // (900 - 300) / 1.5
    expect(world.y).toBe(280); // (300 - -120) / 1.5
  });

  it("round-trips a screen point", () => {
    const screen = { x: 123, y: 456 };
    const world = toWorld(screen.x, screen.y, v);
    const back = toScreen(world.x, world.y, v);
    expect(back.x).toBeCloseTo(screen.x, 6);
    expect(back.y).toBeCloseTo(screen.y, 6);
  });
});

describe("zoomAt", () => {
  it("zooms around the cursor: the world point under it stays put", () => {
    const v: Viewport = { x: 0, y: 0, scale: 1 };
    const sx = 500;
    const sy = 400;
    const worldBefore = toWorld(sx, sy, v);
    const zoomed = zoomAt(v, sx, sy, 1.2);
    const worldAfter = toWorld(sx, sy, zoomed);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(zoomed.scale).toBeCloseTo(1.2, 6);
  });

  it("clamps scale to the min and max", () => {
    const v: Viewport = { x: 0, y: 0, scale: 1 };
    expect(zoomAt(v, 0, 0, 100, 0.1, 4).scale).toBe(4);
    expect(zoomAt(v, 0, 0, 0.0001, 0.1, 4).scale).toBe(0.1);
  });
});

describe("fitViewport", () => {
  const items: FitItem[] = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 300, y: 200, width: 100, height: 100 },
  ];

  it("centers the item bounding box with padding", () => {
    const v = fitViewport(items, 1000, 800);
    const left = toScreen(0, 0, v);
    const right = toScreen(400, 300, v);
    expect(left.x).toBeGreaterThan(0);
    expect(left.y).toBeGreaterThan(0);
    expect(right.x).toBeLessThan(1000);
    expect(right.y).toBeLessThan(800);
    // equal margins left/right
    expect(left.x).toBeCloseTo(1000 - right.x, 6);
    expect(left.y).toBeCloseTo(800 - right.y, 6);
  });

  it("falls back to identity for an empty board", () => {
    expect(fitViewport([], 1000, 800)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
