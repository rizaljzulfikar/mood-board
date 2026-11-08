import {
  mergeRemoteEntities,
  mergeRemoteItems,
  type ConnectionState,
  type GroupState,
  type ItemState,
} from "@/lib/merge";
import type { PresenceUser, ServerMessage } from "@/lib/realtime-protocol";

export type BoardState = {
  items: ItemState[];
  groups: GroupState[];
  connections: ConnectionState[];
};

export function presenceFromHttp(
  currentUsers: PresenceUser[],
  httpUsers: PresenceUser[],
  wsOpen: boolean
): PresenceUser[] {
  return wsOpen ? currentUsers : httpUsers;
}

export function applyRealtimeEvent(
  state: BoardState,
  event: ServerMessage,
  locked: string[]
): BoardState {
  switch (event.type) {
    case "item:upsert":
      return { ...state, items: mergeRemoteItems(state.items, [event.data as ItemState], [], locked) };
    case "item:delete":
      return { ...state, items: mergeRemoteItems(state.items, [], [event.id], locked) };
    case "group:upsert":
      return { ...state, groups: mergeRemoteEntities(state.groups, [event.data as GroupState], [], locked) };
    case "group:delete":
      return { ...state, groups: mergeRemoteEntities(state.groups, [], [event.id], locked) };
    case "connection:upsert":
      return {
        ...state,
        connections: mergeRemoteEntities(state.connections, [event.data as ConnectionState], [], locked),
      };
    case "connection:delete":
      return { ...state, connections: mergeRemoteEntities(state.connections, [], [event.id], locked) };
    case "project:deleted":
      return state;
    default:
      return state;
  }
}

export function applyPresenceEvent(
  users: PresenceUser[],
  event: ServerMessage,
  selfUserId: string
): PresenceUser[] {
  switch (event.type) {
    case "presence:snapshot":
      return event.users.filter((user) => user.userId !== selfUserId);
    case "presence:join":
      if (event.user.userId === selfUserId) return users;
      return [...users.filter((user) => user.userId !== event.user.userId), event.user];
    case "presence:leave":
      return users.filter((user) => user.userId !== event.userId);
    case "presence:cursor":
      return users.map((user) =>
        user.userId === event.userId ? { ...user, cursor: event.cursor } : user
      );
    default:
      return users;
  }
}
