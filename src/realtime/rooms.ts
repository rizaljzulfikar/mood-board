/**
 * In-memory socket registry for the realtime hub.
 *
 * Presence is socket-based: a user is present while at least one of their
 * sockets is open. There is deliberately no TTL — an idle-but-connected user
 * stays present until their last socket closes.
 */

import { presenceColor } from "../lib/presence";
import type { Cursor, PresenceUser, ServerMessage } from "../lib/realtime-protocol";

export type RoomClient = {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  send: (message: string) => void;
};

type PresenceEntry = { name: string; cursor: Cursor };

/** Key format shared by the presence map: `${projectId}:${userId}`. */
function presenceKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

export class RoomRegistry {
  private readonly clients = new Map<string, RoomClient>(); // key: clientId
  private readonly rooms = new Map<string, Set<string>>(); // key: projectId, value: clientIds
  private readonly presence = new Map<string, PresenceEntry>(); // key: `${projectId}:${userId}`

  /** Registers a socket; reports whether it is this user's first one in the room. */
  add(client: RoomClient): { firstForUser: boolean } {
    const key = presenceKey(client.projectId, client.userId);
    this.clients.set(client.id, client);

    let room = this.rooms.get(client.projectId);
    if (!room) {
      room = new Set<string>();
      this.rooms.set(client.projectId, room);
    }
    room.add(client.id);

    const firstForUser = !this.presence.has(key);
    if (firstForUser) {
      this.presence.set(key, { name: client.name, cursor: null });
    }
    return { firstForUser };
  }

  /**
   * Unregisters a socket. Returns the room/user it belonged to, or `null` for
   * an unknown id.
   */
  remove(clientId: string): { projectId: string; userId: string; lastForUser: boolean } | null {
    const client = this.clients.get(clientId);
    if (!client) return null;

    this.clients.delete(clientId);
    const room = this.rooms.get(client.projectId);
    room?.delete(clientId);

    let stillPresent = false;
    if (room) {
      for (const id of room) {
        if (this.clients.get(id)?.userId === client.userId) {
          stillPresent = true;
          break;
        }
      }
    }

    const lastForUser = !stillPresent;
    if (lastForUser) {
      this.presence.delete(presenceKey(client.projectId, client.userId));
    }
    if (room && room.size === 0) {
      this.rooms.delete(client.projectId);
    }

    return { projectId: client.projectId, userId: client.userId, lastForUser };
  }

  /** Serializes once and sends to every socket in the room, optionally skipping one. */
  broadcast(projectId: string, message: ServerMessage, exceptClientId?: string): void {
    const room = this.rooms.get(projectId);
    if (!room) return;

    const payload = JSON.stringify(message);
    for (const clientId of room) {
      if (clientId === exceptClientId) continue;
      const client = this.clients.get(clientId);
      if (!client) continue;
      try {
        client.send(payload);
      } catch {
        // A dead socket must not break the broadcast for everyone else.
      }
    }
  }

  /** Stores the last cursor for a user in a room. */
  updateCursor(projectId: string, userId: string, cursor: { x: number; y: number }): void {
    const key = presenceKey(projectId, userId);
    const entry = this.presence.get(key);
    if (entry) {
      entry.cursor = cursor;
      return;
    }
    this.presence.set(key, { name: this.nameForUser(projectId, userId), cursor });
  }

  /** Deduplicated presence list for a room, one entry per user. */
  snapshot(projectId: string): PresenceUser[] {
    const room = this.rooms.get(projectId);
    if (!room) return [];

    const users: PresenceUser[] = [];
    const seen = new Set<string>();
    for (const clientId of room) {
      const client = this.clients.get(clientId);
      if (!client || seen.has(client.userId)) continue;
      seen.add(client.userId);
      users.push({
        userId: client.userId,
        name: client.name,
        color: presenceColor(client.userId),
        cursor: this.presence.get(presenceKey(projectId, client.userId))?.cursor ?? null,
      });
    }
    return users;
  }

  hasUser(projectId: string, userId: string): boolean {
    const room = this.rooms.get(projectId);
    if (!room) return false;
    for (const clientId of room) {
      if (this.clients.get(clientId)?.userId === userId) return true;
    }
    return false;
  }

  private nameForUser(projectId: string, userId: string): string {
    const room = this.rooms.get(projectId);
    if (room) {
      for (const clientId of room) {
        const client = this.clients.get(clientId);
        if (client?.userId === userId) return client.name;
      }
    }
    return "";
  }
}
