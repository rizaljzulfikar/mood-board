/**
 * Pointer travel, in CSS pixels, before a press becomes a drag.
 *
 * Capture is only taken once this threshold is crossed, so a plain click keeps
 * its normal target and the browser still dispatches `click`/`dblclick` on the
 * element under the pointer (inline label editing depends on that).
 */
export const DRAG_THRESHOLD_PX = 4;

/** True once the pointer has moved at least `threshold` px from the press. */
export function movedPastDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = DRAG_THRESHOLD_PX
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy >= threshold * threshold;
}
