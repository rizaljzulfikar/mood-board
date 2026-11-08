import { MAX_SCALE, MIN_SCALE, type Viewport } from "./viewport";

/** One saved viewport per project, kept in localStorage. */
const STORAGE_PREFIX = "moodboard:viewport:";

/**
 * Minimum time between localStorage writes. Rapid pan/zoom events are
 * coalesced: at most one write per interval, always with the newest viewport.
 * A trailing write plus `flush()` on page hide means a gesture that ends
 * between intervals is still persisted.
 */
export const VIEWPORT_SAVE_INTERVAL_MS = 250;

/** The subset of Storage this module needs, so tests can use a plain object. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function viewportStorageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

/** Coerce stored data into a usable viewport, discarding anything malformed. */
export function sanitizeViewport(value: unknown): Viewport | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, scale } = value as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof scale !== "number" ||
    !Number.isFinite(scale)
  ) {
    return null;
  }
  return {
    x,
    y,
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
  };
}

/** Parse a raw localStorage value; null when absent or corrupt. */
export function parseViewport(raw: string | null): Viewport | null {
  if (!raw) return null;
  try {
    return sanitizeViewport(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Browser localStorage, or null during SSR / when storage is blocked. */
export function getLocalStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Access can throw in privacy modes or with restrictive policies.
    return null;
  }
}

export function loadViewport(
  storage: StorageLike | null | undefined,
  projectId: string
): Viewport | null {
  if (!storage) return null;
  try {
    return parseViewport(storage.getItem(viewportStorageKey(projectId)));
  } catch {
    return null;
  }
}

export function saveViewport(
  storage: StorageLike | null | undefined,
  projectId: string,
  viewport: Viewport
): void {
  if (!storage) return;
  const clean = sanitizeViewport(viewport);
  if (!clean) return;
  try {
    storage.setItem(viewportStorageKey(projectId), JSON.stringify(clean));
  } catch {
    // Quota exceeded or storage disabled: persistence is best-effort.
  }
}

export type ViewportSaver = {
  /** Remember the latest viewport; it is written after the throttle window. */
  schedule: (viewport: Viewport) => void;
  /** Write any pending viewport now (page hide / unmount). */
  flush: () => void;
};

/**
 * Throttling writer: the first `schedule` arms a timer, later calls only
 * replace the pending value, so a long drag produces one write per interval
 * carrying the final position.
 */
export function createViewportSaver(
  storage: StorageLike | null | undefined,
  projectId: string,
  intervalMs: number = VIEWPORT_SAVE_INTERVAL_MS
): ViewportSaver {
  let pending: Viewport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      saveViewport(storage, projectId, pending);
      pending = null;
    }
  };

  const schedule = (viewport: Viewport) => {
    pending = viewport;
    if (timer === null) timer = setTimeout(flush, intervalMs);
  };

  return { schedule, flush };
}
