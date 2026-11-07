/**
 * Client-side merge of remote canvas state into local state.
 * Items the local user is actively dragging ("locked") never take remote
 * positions — their positions land via PATCH when the drag ends.
 */
export type ItemState = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  objectKey: string;
  originalName: string;
  mime: string;
  addedBy: string;
  updatedAt: string;
};

export function mergeRemoteItems(
  local: ItemState[],
  incoming: ItemState[],
  deletedIds: string[],
  lockedIds: string[]
): ItemState[] {
  const deleted = new Set(deletedIds);
  const locked = new Set(lockedIds);
  const byId = new Map(local.map((i) => [i.id, i]));
  const result: ItemState[] = [];

  for (const item of local) {
    if (deleted.has(item.id) && !locked.has(item.id)) continue;
    result.push(item);
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
