import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { verifyRoomTicket, type RoomTicketClaims } from "../lib/realtime-ticket";
import type { PublishMessage, ServerMessage } from "../lib/realtime-protocol";
import { RoomRegistry } from "./rooms";

type HubOptions = {
  port: number;
  secret: string;
  verifyTicket?: (ticket: string) => Promise<RoomTicketClaims | null>;
};

export async function startHub(options: HubOptions): Promise<Server> {
  const registry = new RoomRegistry();
  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http });
  const verifyTicket = options.verifyTicket ?? ((ticket: string) => verifyRoomTicket(ticket, options.secret));

  wss.on("connection", (socket, req) => {
    socket.on("error", () => {
      try {
        socket.terminate();
      } catch {
        // Error handling must never become an additional hub failure.
      }
    });
    void handleConnection(socket, req, options.secret, registry, verifyTicket);
  });

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      http.removeListener("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      http.removeListener("listening", onListening);
      reject(error);
    };
    http.once("listening", onListening);
    http.once("error", onError);
    http.listen(options.port);
  });
  return http;
}

/**
 * Broadcasts a published event to its room. A `project:members` event also
 * kicks removed users' sockets (code 4002) so revoked members stop receiving
 * board events; their presence leave flows through the regular close path.
 */
function applyPublish(registry: RoomRegistry, msg: Partial<PublishMessage>): void {
  if (msg.type !== "publish" || typeof msg.projectId !== "string") return;
  const event = msg.event as ServerMessage | undefined;
  if (!event || typeof event.type !== "string") return;
  registry.broadcast(msg.projectId, event);
  if (event.type === "project:members") {
    for (const userId of event.removedUserIds) {
      registry.closeUser(msg.projectId, userId);
    }
  }
}

async function handleConnection(
  socket: WebSocket,
  req: IncomingMessage,
  secret: string,
  registry: RoomRegistry,
  verifyTicket: (ticket: string) => Promise<RoomTicketClaims | null>
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.headers.authorization === `Bearer ${secret}`) {
      socket.on("message", (data) => {
        try {
          applyPublish(registry, JSON.parse(String(data)) as Partial<PublishMessage>);
        } catch {
          // Ignore malformed publisher messages.
        }
      });
      return;
    }

    const ticket = url.searchParams.get("ticket");
    if (!ticket) {
      socket.close(4001);
      return;
    }
    const claims = await verifyTicket(ticket);
    if (!claims || socket.readyState !== WebSocket.OPEN) {
      socket.close(4001);
      return;
    }

    const id = randomUUID();
    const client = {
      id,
      projectId: claims.projectId,
      userId: claims.userId,
      name: claims.name,
      send: (message: string) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
      },
      close: (code: number) => {
        try {
          socket.close(code);
        } catch {
          // A half-open socket must not break the kick.
        }
      },
    };
    const { firstForUser } = registry.add(client);
    let registered = true;
    const cleanup = () => {
      if (!registered) return;
      registered = false;
      const result = registry.remove(id);
      if (result?.lastForUser) {
        registry.broadcast(result.projectId, { type: "presence:leave", userId: result.userId });
      }
    };
    socket.once("close", cleanup);
    try {
      socket.send(JSON.stringify({ type: "presence:snapshot", users: registry.snapshot(claims.projectId) }));
    } catch {
      cleanup();
      socket.close(1011);
      return;
    }
    if (firstForUser) {
      const user = registry.snapshot(claims.projectId).find((entry) => entry.userId === claims.userId);
      if (user) registry.broadcast(claims.projectId, { type: "presence:join", user }, id);
    }

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (
          msg.type === "cursor" &&
          Number.isFinite(msg.cursor?.x) &&
          Number.isFinite(msg.cursor?.y)
        ) {
          const cursor = { x: msg.cursor.x, y: msg.cursor.y };
          registry.updateCursor(claims.projectId, claims.userId, cursor);
          registry.broadcast(
            claims.projectId,
            { type: "presence:cursor", userId: claims.userId, cursor },
            id
          );
        }
      } catch {
        // Ignore malformed browser messages.
      }
    });
  } catch {
    socket.close(1011);
  }
}
