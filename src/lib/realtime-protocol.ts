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

/** Member identity as it travels over the wire (page.tsx populates owner/members with these fields). */
export type MemberSummary = { id: string; email: string; name: string };

export type ServerMessage =
  | { type: "project:deleted" }
  | { type: "project:members"; members: MemberSummary[]; removedUserIds: string[] }
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
