/** Pure canvas geometry for group boxes: containment and edge-to-edge anchors. */

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Inclusive point-in-rect test. */
export function pointInRect(p: Point, r: Rect): boolean {
  return (
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  );
}

/**
 * Grouping rule: an image belongs to the group whose rectangle contains the
 * image's center point (PureRef-style visual containment).
 */
export function rectContainsItemCenter(r: Rect, item: Rect): boolean {
  return pointInRect(rectCenter(item), r);
}

/**
 * Anchors for a connection between two rects: the segment between the two
 * centers, clipped where it leaves `from` and where it enters `to`, so the
 * line starts and ends exactly on the box edges.
 */
export function edgeAnchors(
  from: Rect,
  to: Rect
): { start: Point; end: Point } {
  const a = rectCenter(from);
  const b = rectCenter(to);
  const dir = { x: b.x - a.x, y: b.y - a.y };

  // Degenerate: identical centers — just return the centers.
  if (dir.x === 0 && dir.y === 0) return { start: a, end: b };

  // Overlapping boxes have no clean edge crossing between the centers —
  // draw center-to-center rather than a backwards or zero-length segment.
  if (pointInRect(a, to) || pointInRect(b, from)) return { start: a, end: b };

  const exitT = exitTFromInside(a, dir, from);
  const start = { x: a.x + dir.x * exitT, y: a.y + dir.y * exitT };

  const entryT = entryTFromOutside(a, dir, to);
  const end = { x: a.x + dir.x * entryT, y: a.y + dir.y * entryT };

  return { start, end };
}

/**
 * Smallest t ≥ 0 where the ray from an interior point along `dir` leaves the
 * rect (slab method). The point is assumed inside the rect.
 */
function exitTFromInside(p: Point, dir: Point, r: Rect): number {
  let t = Infinity;
  if (dir.x > 0) t = Math.min(t, (r.x + r.width - p.x) / dir.x);
  else if (dir.x < 0) t = Math.min(t, (r.x - p.x) / dir.x);
  if (dir.y > 0) t = Math.min(t, (r.y + r.height - p.y) / dir.y);
  else if (dir.y < 0) t = Math.min(t, (r.y - p.y) / dir.y);
  return Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
}

/**
 * Smallest t in [0, 1] where the segment from `p` along `dir` enters the
 * rect; 0 if `p` is already inside. Falls back to 1 (the segment end) when
 * the segment does not intersect the rect.
 */
function entryTFromOutside(p: Point, dir: Point, r: Rect): number {
  let tEnter = 0;
  let tExit = 1;

  for (const [pos, d, lo, hi] of [
    [p.x, dir.x, r.x, r.x + r.width],
    [p.y, dir.y, r.y, r.y + r.height],
  ] as const) {
    if (Math.abs(d) < Number.EPSILON) {
      if (pos < lo || pos > hi) return 1; // parallel, outside the slab
      continue;
    }
    const t0 = (lo - pos) / d;
    const t1 = (hi - pos) / d;
    tEnter = Math.max(tEnter, Math.min(t0, t1), 0);
    tExit = Math.min(tExit, Math.max(t0, t1));
  }

  return tEnter <= tExit ? tEnter : 1;
}
