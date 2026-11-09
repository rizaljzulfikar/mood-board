/**
 * Isomorphic note constants and validators — safe to import from client and
 * server code (no sanitizer dependency here).
 */

export const NOTE_DEFAULT_COLOR = "#f6d660";
export const NOTE_MAX_CONTENT_LENGTH = 20_000;
export const NOTE_MIN_DIM = 16;
export const NOTE_MAX_DIM = 8000;
export const NOTE_DEFAULT_WIDTH = 240;
export const NOTE_DEFAULT_HEIGHT = 180;

/** Tags a note may contain — the exact set the note toolbar produces. */
export const NOTE_ALLOWED_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "ol",
  "ul",
  "li",
  "br",
  "p",
  "div",
] as const;

/** Sticky-note palette shown in the note editor toolbar. */
export const NOTE_PALETTE = [
  "#f6d660",
  "#f2a45c",
  "#ef8a80",
  "#f2a7c3",
  "#b6dfb0",
  "#9fd8cb",
  "#aecbfa",
  "#cda9f2",
] as const;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Accepts only strict `#rrggbb` colors; anything else is rejected. */
export function cleanNoteColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) return undefined;
  return value.toLowerCase();
}

/** Clamp server-side: non-finite falls back to `fallback`, bounded to note dims. */
export function clampNoteDim(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(NOTE_MAX_DIM, Math.max(NOTE_MIN_DIM, Math.round(n)));
}

export function clampNoteCoord(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
