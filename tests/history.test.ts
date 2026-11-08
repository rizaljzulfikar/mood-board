import { describe, it, expect } from "vitest";
import {
  MAX_HISTORY,
  ReplayQueue,
  commitHistory,
  initHistory,
  normalizeSnapshot,
  planServerOps,
  redoHistory,
  snapshotsEqual,
  undoHistory,
  waitForSettled,
  type Snapshot,
} from "@/lib/history";
import type { ConnectionState, GroupState, ItemState } from "@/lib/merge";

function makeItem(id: string, overrides: Partial<ItemState> = {}): ItemState {
  return {
    id,
    kind: "image",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    objectKey: "",
    originalName: "",
    mime: "image/png",
    sourceUrl: null,
    title: null,
    siteName: null,
    label: "",
    addedBy: "u",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGroup(id: string, overrides: Partial<GroupState> = {}): GroupState {
  return {
    id,
    label: "",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    z: 0,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConnection(
  id: string,
  overrides: Partial<ConnectionState> = {}
): ConnectionState {
  return {
    id,
    from: "g1",
    to: "g2",
    style: "arrow",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function snap(
  items: ItemState[] = [],
  groups: GroupState[] = [],
  connections: ConnectionState[] = []
): Snapshot {
  return { items, groups, connections };
}

describe("normalizeSnapshot", () => {
  it("strips updatedAt and sorts each array by id", () => {
    const input = snap(
      [makeItem("b", { updatedAt: "2026-02-01T00:00:00Z" }), makeItem("a")],
      [makeGroup("y"), makeGroup("x")],
      [makeConnection("d"), makeConnection("c")]
    );
    const result = normalizeSnapshot(input);
    expect(result.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(result.items[0]).not.toHaveProperty("updatedAt");
    expect(result.groups.map((g) => g.id)).toEqual(["x", "y"]);
    expect(result.connections.map((c) => c.id)).toEqual(["c", "d"]);
    expect(result.groups[0]).not.toHaveProperty("updatedAt");
    expect(result.connections[0]).not.toHaveProperty("updatedAt");
  });
});

describe("snapshotsEqual", () => {
  it("ignores updatedAt and entity order", () => {
    const a = snap([makeItem("a"), makeItem("b")]);
    const b = snap([
      makeItem("b", { updatedAt: "2026-09-09T00:00:00Z" }),
      makeItem("a", { updatedAt: "2026-09-09T00:00:00Z" }),
    ]);
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("detects field differences", () => {
    const a = snap([makeItem("a", { x: 0 })]);
    const b = snap([makeItem("a", { x: 5 })]);
    expect(snapshotsEqual(a, b)).toBe(false);
  });
});

describe("commitHistory", () => {
  it("pushes settled onto past and clears future", () => {
    const s0 = snap([makeItem("a")]);
    const s1 = snap([makeItem("a", { x: 5 })]);
    const h0 = initHistory(s0);
    const h1 = commitHistory({ ...h0, future: [snap([makeItem("ghost")])] }, s1);
    expect(h1.past).toHaveLength(1);
    expect(h1.past[0]).toBe(s0);
    expect(h1.future).toEqual([]);
    expect(h1.settled).toBe(s1);
  });

  it("is a no-op when next equals settled ignoring updatedAt", () => {
    const s0 = snap([makeItem("a")]);
    const h0 = initHistory(s0);
    const echoed = snap([makeItem("a", { updatedAt: "2026-03-03T00:00:00Z" })]);
    expect(commitHistory(h0, echoed)).toBe(h0);
  });

  it("caps past at MAX_HISTORY, dropping the oldest", () => {
    let h = initHistory(snap([makeItem("s")]));
    for (let i = 0; i < 12; i++) {
      h = commitHistory(h, snap([makeItem("s", { x: i })]));
    }
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(MAX_HISTORY).toBe(10);
    // Oldest entries dropped: first kept settled is the one pushed at commit 3.
    expect(h.past[0]).toEqual(snap([makeItem("s", { x: 1 })]));
    expect(h.past[MAX_HISTORY - 1]).toEqual(snap([makeItem("s", { x: 10 })]));
    expect(h.settled).toEqual(snap([makeItem("s", { x: 11 })]));
  });
});

describe("undoHistory / redoHistory", () => {
  const sA = snap([makeItem("a", { x: 0 })]);
  const sB = snap([makeItem("a", { x: 5 })]);
  const sC = snap([makeItem("a", { x: 9 })]);

  it("returns null on an empty past stack", () => {
    expect(undoHistory(initHistory(sA), sA)).toBeNull();
    expect(redoHistory(initHistory(sA), sA)).toBeNull();
  });

  it("undo returns the previous settled state and moves current to future", () => {
    let h = initHistory(sA);
    h = commitHistory(h, sB);
    h = commitHistory(h, sC);

    const stepBack = undoHistory(h, sC);
    expect(stepBack).not.toBeNull();
    expect(stepBack!.target).toEqual(sB);
    expect(stepBack!.stack.settled).toEqual(sB);
    expect(stepBack!.stack.past).toEqual([sA]);
    expect(stepBack!.stack.future).toEqual([sC]);

    const stepBack2 = undoHistory(stepBack!.stack, sB);
    expect(stepBack2!.target).toEqual(sA);
    expect(stepBack2!.stack.past).toEqual([]);
    // Oldest-first: redo replays the most recent undo first.
    expect(stepBack2!.stack.future).toEqual([sC, sB]);
  });

  it("redo mirrors undo back to B", () => {
    let h = initHistory(sA);
    h = commitHistory(h, sB);
    const back = undoHistory(h, sB)!;
    const fwd = redoHistory(back.stack, back.target);
    expect(fwd).not.toBeNull();
    expect(fwd!.target).toEqual(sB);
    expect(fwd!.stack.settled).toEqual(sB);
    expect(fwd!.stack.future).toEqual([]);
    expect(fwd!.stack.past).toEqual([sA]);
  });

  it("caps the future stack at MAX_HISTORY", () => {
    let h = initHistory(sA);
    for (let i = 0; i < 12; i++) {
      h = commitHistory(h, snap([makeItem("a", { x: i })]));
    }
    let current = h.settled;
    for (let i = 0; i < 12; i++) {
      const back = undoHistory(h, current);
      if (!back) break;
      h = back.stack;
      current = back.target;
    }
    expect(h.future).toHaveLength(MAX_HISTORY);
  });
});

describe("ReplayQueue", () => {
  it("runs enqueued tasks strictly in enqueue order, regardless of resolve speed", async () => {
    const queue = new ReplayQueue();
    const order: string[] = [];
    queue.enqueue(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push("slow-first");
            resolve();
          }, 15)
        )
    );
    queue.enqueue(async () => {
      order.push("fast-second");
    });
    await queue.whenSettled();
    expect(order).toEqual(["slow-first", "fast-second"]);
  });

  it("keeps the chain alive when a task rejects", async () => {
    const queue = new ReplayQueue();
    const order: string[] = [];
    queue.enqueue(async () => {
      throw new Error("replay failed");
    });
    queue.enqueue(async () => {
      order.push("still-runs");
    });
    await queue.whenSettled();
    expect(order).toEqual(["still-runs"]);
  });
});

describe("waitForSettled", () => {
  it("drains a set that keeps growing while it waits", async () => {
    const set = new Set<Promise<unknown>>();
    let resolveFirst!: () => void;
    set.add(new Promise<void>((resolve) => { resolveFirst = resolve; }));

    let secondDone = false;
    const drained = waitForSettled(set);
    // Registered while the first promise is still pending: the drain must
    // not finish before this one settles too.
    setTimeout(() => {
      set.add(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            secondDone = true;
            resolve();
          }, 10)
        )
      );
      resolveFirst();
    }, 5);

    await drained;
    expect(secondDone).toBe(true);
  });

  it("resolves immediately for an empty set", async () => {
    await waitForSettled(new Set());
  });
});

describe("planServerOps", () => {
  it("returns [] for identical snapshots", () => {
    const s = snap([makeItem("a")], [makeGroup("g")], [makeConnection("c")]);
    expect(planServerOps(s, s)).toEqual([]);
  });

  it("returns [] when only updatedAt differs", () => {
    const target = snap([makeItem("a")]);
    const current = snap([makeItem("a", { updatedAt: "2026-05-05T00:00:00Z" })]);
    expect(planServerOps(target, current)).toEqual([]);
  });

  it("emits a patch with only the changed fields for a moved item", () => {
    const target = snap([makeItem("a", { x: 42, y: 7, z: 3 })]);
    const current = snap([makeItem("a", { x: 0, y: 0, z: 3 })]);
    expect(planServerOps(target, current)).toEqual([
      { kind: "item", id: "a", body: { x: 42, y: 7 } },
    ]);
  });

  it("emits an un-delete restore with all item fields for a target-only item", () => {
    const target = snap([makeItem("a", { x: 4, y: 5, z: 2, label: "hi" })]);
    const current = snap([]);
    expect(planServerOps(target, current)).toEqual([
      {
        kind: "item",
        id: "a",
        body: {
          deleted: false,
          x: 4,
          y: 5,
          width: 10,
          height: 10,
          rotation: 0,
          z: 2,
          label: "hi",
          crop: { x: 0, y: 0, w: 1, h: 1 },
        },
      },
    ]);
  });

  it("emits a re-delete for a current-only item", () => {
    const target = snap([]);
    const current = snap([makeItem("a")]);
    expect(planServerOps(target, current)).toEqual([
      { kind: "item", id: "a", body: { deleted: true } },
    ]);
  });

  it("emits group label patches and connection style patches", () => {
    const target = snap([], [makeGroup("g", { label: "renamed" })], [
      makeConnection("c", { style: "line" }),
    ]);
    const current = snap([], [makeGroup("g", { label: "old" })], [
      makeConnection("c", { style: "arrow" }),
    ]);
    expect(planServerOps(target, current)).toEqual([
      { kind: "group", id: "g", body: { label: "renamed" } },
      { kind: "connection", id: "c", body: { style: "line" } },
    ]);
  });

  it("orders ops items, groups, connections and re-deletes last per kind", () => {
    const target = snap(
      [makeItem("keep", { x: 1 })],
      [makeGroup("gkeep", { x: 1 })],
      [makeConnection("ckeep", { style: "line" })]
    );
    const current = snap(
      [makeItem("keep", { x: 2 }), makeItem("extra")],
      [makeGroup("gkeep", { x: 2 }), makeGroup("gextra")],
      [makeConnection("ckeep", { style: "arrow" }), makeConnection("cextra")]
    );
    expect(planServerOps(target, current)).toEqual([
      { kind: "item", id: "keep", body: { x: 1 } },
      { kind: "item", id: "extra", body: { deleted: true } },
      { kind: "group", id: "gkeep", body: { x: 1 } },
      { kind: "group", id: "gextra", body: { deleted: true } },
      { kind: "connection", id: "ckeep", body: { style: "line" } },
      { kind: "connection", id: "cextra", body: { deleted: true } },
    ]);
  });
});
