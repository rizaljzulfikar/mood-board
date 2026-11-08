import { describe, it, expect } from "vitest";

import {
  FULL_CROP,
  LINK_FOOTER_HEIGHT,
  MIN_CROP_FRACTION,
  cropEdgeGeometry,
  cropImageStyle,
  isFullCrop,
  normalizeCrop,
  type CropGeometry,
} from "@/lib/crop";

// 400x300 source shown fully at 400x300 world units.
function geometry(overrides: Partial<CropGeometry> = {}): CropGeometry {
  return {
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    crop: { ...FULL_CROP },
    ...overrides,
  };
}

describe("normalizeCrop", () => {
  it("defaults to the full image", () => {
    expect(normalizeCrop(undefined)).toEqual(FULL_CROP);
    expect(normalizeCrop(null)).toEqual(FULL_CROP);
    expect(normalizeCrop("nonsense")).toEqual(FULL_CROP);
    expect(isFullCrop(FULL_CROP)).toBe(true);
  });

  it("clamps fractions into the image", () => {
    const clamped = normalizeCrop({ x: -1, y: 2, w: 0.5, h: 0.1 });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBeCloseTo(0.98);
    expect(clamped.w).toBe(0.5);
    expect(clamped.h).toBeCloseTo(MIN_CROP_FRACTION);
    expect(normalizeCrop({ x: 0.5, y: 0.5, w: 0.9, h: 0.9 })).toEqual({
      x: 0.5,
      y: 0.5,
      w: 0.5,
      h: 0.5,
    });
  });
});

describe("cropImageStyle", () => {
  it("leaves an uncropped image at its natural size", () => {
    expect(cropImageStyle(FULL_CROP)).toEqual({
      position: "absolute",
      width: "100%",
      height: "100%",
      left: "0%",
      top: "0%",
    });
  });

  it("scales and offsets the image so the crop fills the box", () => {
    expect(cropImageStyle({ x: 0.25, y: 0.1, w: 0.5, h: 0.8 })).toEqual({
      position: "absolute",
      width: "200%",
      height: "125%",
      left: "-50%",
      top: "-12.5%",
    });
  });
});

describe("cropEdgeGeometry", () => {
  const trimmed = geometry({
    width: 320,
    height: 240,
    crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  }); // 320x240 box
  // The full source occupies 400x300 world units at this crop.

  it("trims the right edge without moving the left one", () => {
    const next = cropEdgeGeometry(trimmed, "right", 40, 0, 24);
    expect(next.x).toBe(100);
    expect(next.width).toBe(360);
    expect(next.crop).toEqual({ x: 0.1, y: 0.1, w: 0.9, h: 0.8 });
  });

  it("trims the left edge, moving the card with it", () => {
    const next = cropEdgeGeometry(trimmed, "left", 40, 0, 24);
    expect(next.x).toBe(140);
    expect(next.width).toBe(280);
    expect(next.crop).toEqual({ x: 0.2, y: 0.1, w: 0.7, h: 0.8 });
  });

  it("trims the bottom and top edges", () => {
    const bottom = cropEdgeGeometry(trimmed, "bottom", 0, 30, 24);
    expect(bottom.y).toBe(200);
    expect(bottom.height).toBe(270);
    expect(bottom.crop).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.9 });

    const top = cropEdgeGeometry(trimmed, "top", 0, 30, 24);
    expect(top.y).toBe(230);
    expect(top.height).toBe(210);
    expect(top.crop).toEqual({ x: 0.1, y: 0.2, w: 0.8, h: 0.7 });
  });

  it("expands back towards the full image when dragged outward", () => {
    const next = cropEdgeGeometry(trimmed, "left", -40, 0, 24);
    expect(next.x).toBe(60);
    expect(next.width).toBe(360);
    expect(next.crop).toEqual({ x: 0, y: 0.1, w: 0.9, h: 0.8 });
  });

  it("never shrinks past the minimum item size", () => {
    const next = cropEdgeGeometry(trimmed, "right", -10000, 0, 24);
    expect(next.width).toBe(24);
    expect(next.crop.w).toBeCloseTo(24 / 400);

    const top = cropEdgeGeometry(trimmed, "top", 0, 10000, 24);
    expect(top.height).toBeCloseTo(24);
    expect(top.crop.h).toBeCloseTo(24 / 300);
  });

  it("ignores the unrelated axis", () => {
    const next = cropEdgeGeometry(trimmed, "right", 40, 999, 24);
    expect(next.y).toBe(200);
    expect(next.height).toBe(240);
  });

  it("returns the geometry unchanged when the delta is zero", () => {
    expect(cropEdgeGeometry(geometry(), "right", 0, 0, 24)).toEqual(geometry());
    expect(cropEdgeGeometry(geometry(), "left", 0, 0, 24)).toEqual(geometry());
    expect(cropEdgeGeometry(geometry(), "top", 0, 0, 24)).toEqual(geometry());
    expect(cropEdgeGeometry(geometry(), "bottom", 0, 0, 24)).toEqual(geometry());
  });

  describe("with a link-card footer", () => {
    // 320x240 image area + 52px footer = 292 total; full image 400x300.
    const link = geometry({
      width: 320,
      height: 292,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    });

    it("trims the bottom image edge and keeps the footer height", () => {
      const next = cropEdgeGeometry(link, "bottom", 0, 30, 24, LINK_FOOTER_HEIGHT);
      expect(next.y).toBe(200);
      expect(next.height).toBe(322); // 270px image + 52px footer
      expect(next.crop.h).toBeCloseTo(0.9);
    });

    it("trims the top image edge, moving the card down", () => {
      const next = cropEdgeGeometry(link, "top", 0, 30, 24, LINK_FOOTER_HEIGHT);
      expect(next.y).toBe(230);
      expect(next.height).toBe(262); // 210px image + 52px footer
      expect(next.crop.y).toBeCloseTo(0.2);
      expect(next.crop.h).toBeCloseTo(0.7);
    });

    it("stops at the minimum image height, not the minimum total height", () => {
      const next = cropEdgeGeometry(link, "bottom", 0, -10000, 24, LINK_FOOTER_HEIGHT);
      expect(next.height).toBeCloseTo(24 + LINK_FOOTER_HEIGHT);
    });
  });
});
