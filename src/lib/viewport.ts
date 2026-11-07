/**
 * Pure viewport math for the infinite canvas.
 * Screen position = world position * scale + pan.
 */
export type Viewport = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export function toScreen(wx: number, wy: number, v: Viewport): { x: number; y: number } {
  return { x: wx * v.scale + v.x, y: wy * v.scale + v.y };
}

export function toWorld(sx: number, sy: number, v: Viewport): { x: number; y: number } {
  return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
}

/** Zoom by `factor` around a screen point; the world point under it stays fixed. */
export function zoomAt(
  v: Viewport,
  sx: number,
  sy: number,
  factor: number,
  min: number = MIN_SCALE,
  max: number = MAX_SCALE
): Viewport {
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const applied = scale / v.scale;
  return { scale, x: sx - applied * (sx - v.x), y: sy - applied * (sy - v.y) };
}

export type FitItem = { x: number; y: number; width: number; height: number };

const FIT_PADDING = 80;
const FIT_MAX_SCALE = 1.5;

/** Compute a viewport that centers the bounding box of all items. */
export function fitViewport(
  items: FitItem[],
  viewWidth: number,
  viewHeight: number
): Viewport {
  if (items.length === 0) return { x: 0, y: 0, scale: 1 };

  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const maxY = Math.max(...items.map((i) => i.y + i.height));

  const availableW = Math.max(1, viewWidth - FIT_PADDING * 2);
  const availableH = Math.max(1, viewHeight - FIT_PADDING * 2);
  const scale = Math.min(
    FIT_MAX_SCALE,
    availableW / Math.max(1, maxX - minX),
    availableH / Math.max(1, maxY - minY)
  );

  const padX = (viewWidth - (maxX - minX) * scale) / 2;
  const padY = (viewHeight - (maxY - minY) * scale) / 2;
  return { scale, x: padX - minX * scale, y: padY - minY * scale };
}
