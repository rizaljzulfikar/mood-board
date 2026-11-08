/**
 * Wire protocol shared by the realtime hub (server) and the browser client.
 * Pure type declarations only — no runtime code, so both sides can import it.
 */

import type { Cursor } from "./presence";

export type { Cursor };

export type EntityKind = "item" | "group" | "connection";

export type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  cursor: Cursor;
};

export type ServerMessage =
  | { type: "presence:snapshot"; users: PresenceUser[] }
  | { type: "presence:join"; user: PresenceUser }
  | { type: "presence:leave"; userId: string }
  | { type: "presence:cursor"; userId: string; cursor: { x: number; y: number } }
  | { type: "item:upsert"; data: unknown }
  | { type: "item:delete"; id: string }
  | { type: "group:upsert"; data: unknown }
  | { type: "group:delete"; id: string }
  | { type: "connection:upsert"; data: unknown }
  | { type: "connection:delete"; id: string };

export type ClientMessage = { type: "cursor"; cursor: { x: number; y: number } };

export type PublishMessage = { type: "publish"; projectId: string; event: ServerMessage };
