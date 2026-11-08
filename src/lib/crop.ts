/**
 * Non-destructive crop geometry for image items.
 *
 * A crop is stored as fractions of the original image ({ x, y, w, h } in
 * 0..1). The item's world box always shows exactly that region, so cropping
 * an edge both updates the fraction and shrinks/moves the box; the stored
 * image file is never rewritten.
 */
export type CropRect = { x: number; y: number; w: number; h: number };

export type CropEdge = "top" | "right" | "bottom" | "left";

/** Smallest allowed crop fraction (keeps handles grabbable). */
export const MIN_CROP_FRACTION = 0.02;

/** Fixed footer strip below a link card's thumbnail (matches .link-footer). */
export const LINK_FOOTER_HEIGHT = 52;

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Coerce anything into a valid crop rectangle inside the source image. */
export function normalizeCrop(value: unknown): CropRect {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const num = (key: string, fallback: number) => {
    const raw = v[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  };

  const x = clamp(num("x", 0), 0, 1 - MIN_CROP_FRACTION);
  const y = clamp(num("y", 0), 0, 1 - MIN_CROP_FRACTION);
  return {
    x,
    y,
    w: clamp(num("w", 1), MIN_CROP_FRACTION, 1 - x),
    h: clamp(num("h", 1), MIN_CROP_FRACTION, 1 - y),
  };
}

export function isFullCrop(crop: CropRect): boolean {
  const c = normalizeCrop(crop);
  return c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

/**
 * CSS for an image rendered inside a box that represents the crop region.
 * The image is scaled up so the cropped window fills the box.
 */
export function cropImageStyle(crop: CropRect): {
  position: "absolute";
  width: string;
  height: string;
  left: string;
  top: string;
} {
  const c = normalizeCrop(crop);
  return {
    position: "absolute",
    width: `${100 / c.w}%`,
    height: `${100 / c.h}%`,
    left: `${(-c.x * 100) / c.w}%`,
    top: `${(-c.y * 100) / c.h}%`,
  };
}

export type CropGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  crop: CropRect;
};

/**
 * Move one crop edge by a world-space delta. The opposite edge stays put, so
 * dragging outward widens the card again (up to the full source image).
 *
 * `bottomInset` is world-space chrome below the image that must not be
 * cropped (the fixed footer of a link card); pass 0 for plain images.
 */
export function cropEdgeGeometry(
  item: CropGeometry,
  edge: CropEdge,
  dx: number,
  dy: number,
  minDim: number,
  bottomInset = 0
): CropGeometry {
  const crop = normalizeCrop(item.crop);
  // World size the full, uncropped image would occupy at the current scale.
  const fullW = item.width / crop.w;
  const imageH = Math.max(1, item.height - bottomInset);
  const fullH = imageH / crop.h;

  if (edge === "left" || edge === "right") {
    const available = edge === "right" ? 1 - crop.x : crop.x + crop.w;
    const minFraction = Math.min(
      available,
      Math.max(MIN_CROP_FRACTION, Math.min(0.99, minDim / Math.max(1, fullW)))
    );

    if (edge === "right") {
      const w = clamp(crop.w + dx / fullW, minFraction, available);
      return {
        ...item,
        width: w * fullW,
        crop: { ...crop, w },
      };
    }

    const x = clamp(crop.x + dx / fullW, 0, crop.x + crop.w - minFraction);
    const w = crop.x + crop.w - x;
    return {
      ...item,
      x: item.x + (x - crop.x) * fullW,
      width: w * fullW,
      crop: { ...crop, x, w },
    };
  }

  const available = edge === "bottom" ? 1 - crop.y : crop.y + crop.h;
  const minFraction = Math.min(
    available,
    Math.max(MIN_CROP_FRACTION, Math.min(0.99, minDim / Math.max(1, fullH)))
  );

  if (edge === "bottom") {
    const h = clamp(crop.h + dy / fullH, minFraction, available);
    return {
      ...item,
      height: h * fullH + bottomInset,
      crop: { ...crop, h },
    };
  }

  const y = clamp(crop.y + dy / fullH, 0, crop.y + crop.h - minFraction);
  const h = crop.y + crop.h - y;
  return {
    ...item,
    y: item.y + (y - crop.y) * fullH,
    height: h * fullH + bottomInset,
    crop: { ...crop, y, h },
  };
}
