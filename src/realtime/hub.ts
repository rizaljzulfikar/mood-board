import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { verifyRoomTicket } from "../lib/realtime-ticket";
import type { PublishMessage, ServerMessage } from "../lib/realtime-protocol";
import { RoomRegistry } from "./rooms";

export async function startHub(options: { port: number; secret: string }): Promise<Server> {
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

  wss.on("connection", (socket, req) => {
    void handleConnection(socket, req, options.secret, registry);
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, resolve);
  });
  return http;
}

async function handleConnection(
  socket: WebSocket,
  req: IncomingMessage,
  secret: string,
  registry: RoomRegistry
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.headers.authorization === `Bearer ${secret}`) {
      socket.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data)) as Partial<PublishMessage>;
          if (msg.type === "publish" && typeof msg.projectId === "string") {
            registry.broadcast(msg.projectId, msg.event as ServerMessage);
          }
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
    const claims = await verifyRoomTicket(ticket, secret);
    if (!claims) {
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
    };
    const { firstForUser } = registry.add(client);
    socket.send(JSON.stringify({ type: "presence:snapshot", users: registry.snapshot(claims.projectId) }));
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
    socket.on("close", () => {
      const result = registry.remove(id);
      if (result?.lastForUser) {
        registry.broadcast(result.projectId, { type: "presence:leave", userId: result.userId });
      }
    });
  } catch {
    socket.close(1011);
  }
}
