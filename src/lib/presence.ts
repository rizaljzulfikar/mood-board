/**
 * In-memory presence for live collaboration (cursors + "who's here").
 * Deliberately not persisted: a server restart just clears presence.
 */

export type Cursor = { x: number; y: number } | null;

export type PresenceEntry = {
  userId: string;
  name: string;
  color: string;
  cursor: Cursor;
  lastSeen: number;
};

const TTL_MS = 10_000;

const map = new Map<string, PresenceEntry>(); // key: `${projectId}:${userId}`

export function presenceColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 60%)`;
}

export function heartbeat(
  projectId: string,
  userId: string,
  name: string,
  cursor: Cursor,
  now: number = Date.now()
): void {
  map.set(`${projectId}:${userId}`, {
    userId,
    name,
    color: presenceColor(userId),
    cursor,
    lastSeen: now,
  });
}

export function listActive(
  projectId: string,
  now: number = Date.now()
): Array<{ userId: string; name: string; color: string; cursor: Cursor }> {
  const active: Array<{ userId: string; name: string; color: string; cursor: Cursor }> = [];
  for (const [key, entry] of map) {
    if (now - entry.lastSeen > TTL_MS) {
      map.delete(key);
      continue;
    }
    if (key.startsWith(`${projectId}:`)) {
      active.push({ userId: entry.userId, name: entry.name, color: entry.color, cursor: entry.cursor });
    }
  }
  return active;
}
