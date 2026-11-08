/**
 * Client-side undo/redo history for the board.
 *
 * Every user gesture commits a snapshot of the board ({items, groups,
 * connections}) via commitHistory; undo/redo swap snapshots and hand back a
 * replay plan for the server (planServerOps). Snapshots are normalized before
 * comparison: the server legitimately echoes entities with a fresh
 * `updatedAt`, and that must never look like a change.
 */
import type { ConnectionState, GroupState, ItemState } from "@/lib/merge";

export type Snapshot = {
  items: ItemState[];
  groups: GroupState[];
  connections: ConnectionState[];
};

export const MAX_HISTORY = 10;

/** A snapshot with `updatedAt` stripped — the comparable form. */
export type NormalizedSnapshot = {
  items: Omit<ItemState, "updatedAt">[];
  groups: Omit<GroupState, "updatedAt">[];
  connections: Omit<ConnectionState, "updatedAt">[];
};

/** Oldest-first stacks; `settled` is the last committed board state. */
export type HistoryStack = {
  past: Snapshot[];
  future: Snapshot[];
  settled: Snapshot;
};

export type EntityKind = "item" | "group" | "connection";

export type ServerOp = {
  kind: EntityKind;
  id: string;
  body: Record<string, unknown>;
};

/** Keep the newest MAX_HISTORY entries, dropping from the front. */
function capEnd<T>(arr: T[]): T[] {
  return arr.length > MAX_HISTORY ? arr.slice(arr.length - MAX_HISTORY) : arr;
}

function normalizeItems(items: ItemState[]): NormalizedSnapshot["items"] {
  return [...items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ updatedAt: _, ...rest }) => rest);
}

function normalizeGroups(groups: GroupState[]): NormalizedSnapshot["groups"] {
  return [...groups]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ updatedAt: _, ...rest }) => rest);
}

function normalizeConnections(connections: ConnectionState[]): NormalizedSnapshot["connections"] {
  return [...connections]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ updatedAt: _, ...rest }) => rest);
}

export function normalizeSnapshot(snapshot: Snapshot): NormalizedSnapshot {
  return {
    items: normalizeItems(snapshot.items),
    groups: normalizeGroups(snapshot.groups),
    connections: normalizeConnections(snapshot.connections),
  };
}

export function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  const na = normalizeSnapshot(a);
  const nb = normalizeSnapshot(b);
  return (
    JSON.stringify(na.items) === JSON.stringify(nb.items) &&
    JSON.stringify(na.groups) === JSON.stringify(nb.groups) &&
    JSON.stringify(na.connections) === JSON.stringify(nb.connections)
  );
}

export function initHistory(settled: Snapshot): HistoryStack {
  return { past: [], future: [], settled };
}

export function commitHistory(h: HistoryStack, next: Snapshot): HistoryStack {
  if (snapshotsEqual(h.settled, next)) return h;
  return {
    past: capEnd([...h.past, h.settled]),
    future: [],
    settled: next,
  };
}

export function undoHistory(
  h: HistoryStack,
  current: Snapshot
): { stack: HistoryStack; target: Snapshot } | null {
  if (h.past.length === 0) return null;
  const target = h.past[h.past.length - 1];
  return {
    stack: {
      past: h.past.slice(0, -1),
      future: capEnd([...h.future, current]),
      settled: target,
    },
    target,
  };
}

export function redoHistory(
  h: HistoryStack,
  current: Snapshot
): { stack: HistoryStack; target: Snapshot } | null {
  if (h.future.length === 0) return null;
  const target = h.future[h.future.length - 1];
  return {
    stack: {
      past: capEnd([...h.past, current]),
      future: h.future.slice(0, -1),
      settled: target,
    },
    target,
  };
}

/**
 * Serializes undo/redo server replays: each enqueued task runs only after the
 * previous one settled, so two rapid undos replay in gesture order. A failed
 * task never breaks the chain.
 */
export class ReplayQueue {
  private chain: Promise<void> = Promise.resolve();

  enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.catch(() => {}).then(task);
  }

  /** Resolves once every enqueued task so far has settled. */
  whenSettled(): Promise<void> {
    return this.chain.then(
      () => {},
      () => {}
    );
  }
}

/**
 * Resolves once every promise currently in the set has settled — including
 * ones added while waiting (an earlier write may register more work, e.g. a
 * cascade of PATCHes). Terminates on its own: promises are tracked as seen,
 * so callers never need to prune the set for the drain to finish.
 */
export async function waitForSettled(promises: Set<Promise<unknown>>): Promise<void> {
  const seen = new Set<Promise<unknown>>();
  for (;;) {
    const fresh = [...promises].filter((p) => !seen.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) seen.add(p);
    await Promise.allSettled(fresh);
  }
}

/** Fields compared per kind; `updatedAt` is excluded everywhere. */
const ITEM_FIELDS = ["x", "y", "width", "height", "z", "rotation", "label", "crop"] as const;
const GROUP_FIELDS = ["x", "y", "width", "height", "z", "label"] as const;
const CONNECTION_FIELDS = ["style"] as const;

function diffFields<T extends Record<string, unknown>>(
  target: T,
  current: T,
  fields: readonly string[]
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    // Objects (crop) compare by value; primitives keep identity semantics.
    const a = target[field];
    const b = current[field];
    if (typeof a === "object" || typeof b === "object") {
      if (JSON.stringify(a) !== JSON.stringify(b)) body[field] = a;
    } else if (a !== b) {
      body[field] = a;
    }
  }
  return body;
}

/** Full field set of an entity, for restore bodies. */
function allFields(entity: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, entity[field]]));
}

/**
 * Diff the undo target against the live board and return the PATCH bodies
 * that make the server match the target. Restores (`deleted: false`) carry
 * the entity's full fields; re-deletes (`deleted: true`) stand alone; live
 * entities only get their changed fields. Ops are ordered items → groups →
 * connections, re-deletes last within each kind.
 */
export function planServerOps(target: Snapshot, current: Snapshot): ServerOp[] {
  const ops: ServerOp[] = [];

  const targetItems = new Map(target.items.map((i) => [i.id, i]));
  const currentItems = new Map(current.items.map((i) => [i.id, i]));
  for (const item of target.items) {
    const live = currentItems.get(item.id);
    if (!live) {
      ops.push({
        kind: "item",
        id: item.id,
        body: { deleted: false, ...allFields(item as unknown as Record<string, unknown>, ITEM_FIELDS) },
      });
    } else {
      const body = diffFields(
        item as unknown as Record<string, unknown>,
        live as unknown as Record<string, unknown>,
        ITEM_FIELDS
      );
      if (Object.keys(body).length > 0) {
        ops.push({ kind: "item", id: item.id, body });
      }
    }
  }
  for (const item of current.items) {
    if (!targetItems.has(item.id)) {
      ops.push({ kind: "item", id: item.id, body: { deleted: true } });
    }
  }

  const targetGroups = new Map(target.groups.map((g) => [g.id, g]));
  const currentGroups = new Map(current.groups.map((g) => [g.id, g]));
  for (const group of target.groups) {
    const live = currentGroups.get(group.id);
    if (!live) {
      ops.push({
        kind: "group",
        id: group.id,
        body: { deleted: false, ...allFields(group as unknown as Record<string, unknown>, GROUP_FIELDS) },
      });
    } else {
      const body = diffFields(
        group as unknown as Record<string, unknown>,
        live as unknown as Record<string, unknown>,
        GROUP_FIELDS
      );
      if (Object.keys(body).length > 0) {
        ops.push({ kind: "group", id: group.id, body });
      }
    }
  }
  for (const group of current.groups) {
    if (!targetGroups.has(group.id)) {
      ops.push({ kind: "group", id: group.id, body: { deleted: true } });
    }
  }

  const targetConnections = new Map(target.connections.map((c) => [c.id, c]));
  const currentConnections = new Map(current.connections.map((c) => [c.id, c]));
  for (const connection of target.connections) {
    const live = currentConnections.get(connection.id);
    if (!live) {
      ops.push({
        kind: "connection",
        id: connection.id,
        body: {
          deleted: false,
          ...allFields(connection as unknown as Record<string, unknown>, CONNECTION_FIELDS),
        },
      });
    } else {
      const body = diffFields(
        connection as unknown as Record<string, unknown>,
        live as unknown as Record<string, unknown>,
        CONNECTION_FIELDS
      );
      if (Object.keys(body).length > 0) {
        ops.push({ kind: "connection", id: connection.id, body });
      }
    }
  }
  for (const connection of current.connections) {
    if (!targetConnections.has(connection.id)) {
      ops.push({ kind: "connection", id: connection.id, body: { deleted: true } });
    }
  }

  return ops;
}
