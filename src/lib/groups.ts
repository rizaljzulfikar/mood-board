import type { ConnectionDoc } from "./models/Connection";
import type { GroupDoc } from "./models/Group";

export const MAX_LABEL_LENGTH = 120;

export const GROUP_MIN_DIM = 16;
export const GROUP_MAX_DIM = 8000;

export function groupJSON(group: GroupDoc) {
  return {
    id: String(group._id),
    label: group.label,
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
    z: group.z,
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function connectionJSON(connection: ConnectionDoc) {
  return {
    id: String(connection._id),
    from: String(connection.from),
    to: String(connection.to),
    style: connection.style,
    updatedAt: connection.updatedAt.toISOString(),
  };
}

/** Server-side clamp for group geometry: non-finite values fall back to `fallback`. */
export function clampDim(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(GROUP_MAX_DIM, Math.max(GROUP_MIN_DIM, Math.round(n)));
}

export function clampCoord(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, MAX_LABEL_LENGTH);
}
