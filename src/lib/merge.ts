/**
 * Client-side merge of remote canvas state into local state.
 * Entities the local user is actively dragging ("locked") never take remote
 * positions — their positions land via PATCH when the drag ends.
 */
export type ItemState = {
  id: string;
  kind: "image" | "link";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  objectKey: string;
  originalName: string;
  mime: string;
  sourceUrl: string | null;
  title: string | null;
  siteName: string | null;
  label: string;
  addedBy: string;
  updatedAt: string;
};

export type GroupState = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  updatedAt: string;
};

export type ConnectionState = {
  id: string;
  from: string;
  to: string;
  style: "arrow" | "line";
  updatedAt: string;
};

type Entity = { id: string };

/**
 * Merge remote entity deltas into local state, preserving local order.
 * Deletions win unless the entity is locked (local user is dragging it);
 * remote updates win unless locked; new entities are appended.
 */
export function mergeRemoteEntities<T extends Entity>(
  local: T[],
  incoming: T[],
  deletedIds: string[],
  lockedIds: string[]
): T[] {
  const deleted = new Set(deletedIds);
  const locked = new Set(lockedIds);
  const byId = new Map(local.map((e) => [e.id, e]));
  const result: T[] = [];

  for (const entity of local) {
    if (deleted.has(entity.id) && !locked.has(entity.id)) continue;
    result.push(entity);
  }

  for (const remote of incoming) {
    if (deleted.has(remote.id)) continue;
    const existing = byId.get(remote.id);
    if (existing) {
      if (locked.has(remote.id)) continue;
      result[result.indexOf(existing)] = remote;
    } else {
      result.push(remote);
    }
  }

  return result;
}

export function mergeRemoteItems(
  local: ItemState[],
  incoming: ItemState[],
  deletedIds: string[],
  lockedIds: string[]
): ItemState[] {
  return mergeRemoteEntities(local, incoming, deletedIds, lockedIds);
}
