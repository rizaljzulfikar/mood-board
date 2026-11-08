import { afterEach, describe, it, expect, vi } from "vitest";
import {
  VIEWPORT_SAVE_INTERVAL_MS,
  createViewportSaver,
  getLocalStorage,
  loadViewport,
  parseViewport,
  sanitizeViewport,
  saveViewport,
  viewportStorageKey,
  type StorageLike,
} from "@/lib/viewport-storage";

function memoryStorage(
  initial: Record<string, string> = {}
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("viewportStorageKey", () => {
  it("namespaces the viewport by project", () => {
    expect(viewportStorageKey("abc")).toBe("moodboard:viewport:abc");
  });
});

describe("sanitizeViewport", () => {
  it("accepts a valid viewport", () => {
    expect(sanitizeViewport({ x: 10, y: -20, scale: 1.5 })).toEqual({
      x: 10,
      y: -20,
      scale: 1.5,
    });
  });

  it("clamps the scale into the supported range", () => {
    expect(sanitizeViewport({ x: 0, y: 0, scale: 100 })?.scale).toBe(4);
    expect(sanitizeViewport({ x: 0, y: 0, scale: 0.001 })?.scale).toBe(0.1);
  });

  it("rejects non-objects, missing fields, and non-finite numbers", () => {
    expect(sanitizeViewport(null)).toBeNull();
    expect(sanitizeViewport("nope")).toBeNull();
    expect(sanitizeViewport({ x: 1, y: 2 })).toBeNull();
    expect(sanitizeViewport({ x: Number.NaN, y: 0, scale: 1 })).toBeNull();
    expect(sanitizeViewport({ x: 0, y: 0, scale: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("parseViewport", () => {
  it("parses stored JSON", () => {
    expect(parseViewport('{"x":5,"y":6,"scale":2}')).toEqual({ x: 5, y: 6, scale: 2 });
  });

  it("returns null for missing or malformed data", () => {
    expect(parseViewport(null)).toBeNull();
    expect(parseViewport("not json")).toBeNull();
  });
});

describe("load / save", () => {
  it("round-trips a viewport through storage", () => {
    const storage = memoryStorage();
    saveViewport(storage, "p1", { x: 12, y: -8, scale: 0.75 });
    expect(loadViewport(storage, "p1")).toEqual({ x: 12, y: -8, scale: 0.75 });
  });

  it("returns null for a project that has no saved viewport", () => {
    expect(loadViewport(memoryStorage(), "missing")).toBeNull();
  });

  it("survives storage that throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadViewport(broken, "p1")).toBeNull();
    expect(() => saveViewport(broken, "p1", { x: 0, y: 0, scale: 1 })).not.toThrow();
  });

  it("does nothing without a storage backend", () => {
    expect(loadViewport(null, "p1")).toBeNull();
    expect(() => saveViewport(null, "p1", { x: 0, y: 0, scale: 1 })).not.toThrow();
  });
});

describe("getLocalStorage", () => {
  it("returns null when there is no browser window", () => {
    expect(getLocalStorage()).toBeNull();
  });
});

describe("createViewportSaver", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid updates into one write of the latest position", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const saver = createViewportSaver(storage, "p1", 250);
    const key = viewportStorageKey("p1");

    saver.schedule({ x: 1, y: 1, scale: 1 });
    saver.schedule({ x: 20, y: 30, scale: 1.5 });
    saver.schedule({ x: 40, y: 50, scale: 2 });

    expect(storage.data[key]).toBeUndefined();
    vi.advanceTimersByTime(249);
    expect(storage.data[key]).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(storage.data[key])).toEqual({ x: 40, y: 50, scale: 2 });
  });

  it("starts a fresh throttle window after each write", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const saver = createViewportSaver(storage, "p1", 100);
    const key = viewportStorageKey("p1");

    saver.schedule({ x: 1, y: 0, scale: 1 });
    vi.advanceTimersByTime(100);
    saver.schedule({ x: 2, y: 0, scale: 1 });
    vi.advanceTimersByTime(100);

    expect(JSON.parse(storage.data[key])).toEqual({ x: 2, y: 0, scale: 1 });
  });

  it("flush writes the pending viewport immediately", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const saver = createViewportSaver(storage, "p1", 500);
    const key = viewportStorageKey("p1");

    saver.schedule({ x: 7, y: 8, scale: 1.25 });
    saver.flush();

    expect(JSON.parse(storage.data[key])).toEqual({ x: 7, y: 8, scale: 1.25 });
    // The timer was cleared, so no second write happens later.
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(storage.data[key])).toEqual({ x: 7, y: 8, scale: 1.25 });
  });

  it("does not write when nothing is pending", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const saver = createViewportSaver(storage, "p1", 100);

    saver.flush();

    expect(storage.data).toEqual({});
  });

  it("uses a short default throttle window", () => {
    expect(VIEWPORT_SAVE_INTERVAL_MS).toBeGreaterThan(0);
    expect(VIEWPORT_SAVE_INTERVAL_MS).toBeLessThanOrEqual(1000);
  });
});
