import { describe, it, expect } from "vitest";
import { heartbeat, listActive, presenceColor } from "@/lib/presence";

const NOW = 1_700_000_000_000;

describe("presence", () => {
  it("returns a heartbeat while it is fresh", () => {
    heartbeat("proj1", "user1", "Alice", { x: 10, y: 20 }, NOW);
    const active = listActive("proj1", NOW + 1000);
    const alice = active.find((u) => u.userId === "user1");
    expect(alice).toBeDefined();
    expect(alice?.name).toBe("Alice");
    expect(alice?.cursor).toEqual({ x: 10, y: 20 });
  });

  it("expires heartbeats after the TTL", () => {
    heartbeat("proj2", "user2", "Bob", null, NOW);
    const fresh = listActive("proj2", NOW + 9000);
    expect(fresh.find((u) => u.userId === "user2")).toBeDefined();
    const expired = listActive("proj2", NOW + 10001);
    expect(expired.find((u) => u.userId === "user2")).toBeUndefined();
  });

  it("updates the cursor on a repeated heartbeat and refreshes the TTL", () => {
    heartbeat("proj3", "user3", "Carol", { x: 1, y: 2 }, NOW);
    heartbeat("proj3", "user3", "Carol", { x: 3, y: 4 }, NOW + 5000);
    const active = listActive("proj3", NOW + 9000);
    expect(active.find((u) => u.userId === "user3")?.cursor).toEqual({ x: 3, y: 4 });
  });

  it("separates projects", () => {
    heartbeat("projA", "u1", "A", null, NOW);
    heartbeat("projB", "u2", "B", null, NOW);
    expect(listActive("projA", NOW + 1).map((u) => u.userId)).toEqual(["u1"]);
  });

  it("derives a stable color per user", () => {
    expect(presenceColor("abc")).toBe(presenceColor("abc"));
    expect(presenceColor("abc")).not.toBe(presenceColor("abd"));
  });
});
