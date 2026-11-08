/**
 * Server → hub publisher.
 *
 * Next mutation routes call these helpers after a successful Mongo write so
 * every connected client sees the change. Publishing is strictly
 * fire-and-forget: if the hub is unreachable or the socket is not open the
 * message is dropped. A realtime outage must never fail the HTTP mutation.
 */
import WebSocket from "ws";
import type { EntityKind, PublishMessage, ServerMessage } from "./realtime-protocol";
import { env } from "./env";

export function buildPublishMessage(
  projectId: string,
  kind: EntityKind,
  op: "upsert" | "delete",
  payload: unknown
): PublishMessage {
  const event = (
    op === "upsert"
      ? { type: `${kind}:upsert`, data: payload }
      : { type: `${kind}:delete`, id: payload }
  ) as ServerMessage;
  return { type: "publish", projectId, event };
}

let socket: WebSocket | null = null;
let connecting = false;
// Frames produced while the socket is still connecting (or reconnecting) are
// held until `open`. Without this the very first mutation after a cold start
// is silently dropped.
let pending: string[] = [];

const MAX_PENDING = 100;

function flushPending(ws: WebSocket): void {
  const queued = pending;
  pending = [];
  for (const payload of queued) {
    try {
      ws.send(payload);
    } catch {
      // A broken publish socket must never affect the mutation that queued it.
    }
  }
}

function ensureSocket(): void {
  if (connecting) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  connecting = true;
  const ws = new WebSocket(env("REALTIME_URL"), {
    headers: { Authorization: `Bearer ${env("REALTIME_SECRET")}` },
  });

  ws.on("open", () => {
    connecting = false;
    socket = ws;
    flushPending(ws);
  });
  ws.on("close", () => {
    connecting = false;
    if (socket === ws) socket = null;
  });
  ws.on("error", () => {
    connecting = false;
    if (socket === ws) socket = null;
  });
}

function defaultTransport(msg: PublishMessage): void {
  ensureSocket();
  const payload = JSON.stringify(msg);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(payload);
    return;
  }
  pending.push(payload);
  if (pending.length > MAX_PENDING) pending.shift();
}

let transport: (msg: PublishMessage) => void = defaultTransport;

export function broadcastUpsert(projectId: string, kind: EntityKind, data: unknown): void {
  try {
    transport(buildPublishMessage(projectId, kind, "upsert", data));
  } catch {
    // The hub is best-effort: never fail the mutation that triggered this.
  }
}

export function broadcastDelete(projectId: string, kind: EntityKind, id: string): void {
  try {
    transport(buildPublishMessage(projectId, kind, "delete", id));
  } catch {
    // The hub is best-effort: never fail the mutation that triggered this.
  }
}

export function broadcastProjectDeleted(projectId: string): void {
  try {
    transport({ type: "publish", projectId, event: { type: "project:deleted" } });
  } catch {
    // The hub is best-effort: never fail the mutation that triggered this.
  }
}

export function setPublishTransportForTest(fn: ((msg: PublishMessage) => void) | null): void {
  transport = fn ?? defaultTransport;
}
