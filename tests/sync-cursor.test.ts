import { describe, it, expect } from "vitest";
import { syncCursor } from "@/lib/sync";

describe("syncCursor", () => {
  // Regression: the cursor handed to clients must be a snapshot taken strictly
  // BEFORE the delta query runs. If it is generated after the query, a change
  // landing in between is skipped by the next poll's `$gt` and lost forever.
  it("returns a timestamp strictly earlier than the snapshot", () => {
    const now = new Date("2026-11-08T12:00:00.000Z");
    expect(new Date(syncCursor(now)).getTime()).toBeLessThan(now.getTime());
  });

  it("keeps ISO string format so `$gt` casting is unchanged", () => {
    const cursor = syncCursor(new Date());
    expect(() => new Date(cursor)).not.toThrow();
    expect(Number.isNaN(new Date(cursor).getTime())).toBe(false);
  });

  it("one-millisecond overlap is safe for client deduplication", () => {
    const now = new Date("2026-11-08T12:00:00.000Z");
    expect(new Date(syncCursor(now)).getTime()).toBe(now.getTime() - 1);
  });
});
