import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import WebSocket from "ws";
import { startHub } from "../src/realtime/hub";
import { signRoomTicket, type RoomTicketClaims } from "@/lib/realtime-ticket";

const SECRET = "test-realtime-secret";
let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

function portOf(s: Server): number {
  const a = s.address();
  if (!a || typeof a === "string") throw new Error("no port");
  return a.port;
}
function next(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (d) => resolve(JSON.parse(String(d))));
    ws.once("error", reject);
  });
}

describe("realtime hub", () => {
  it("rejects a forged ticket and accepts a valid one", async () => {
    server = await startHub({ port: 0, secret: SECRET });
    const port = portOf(server);
    const bad = new WebSocket(`ws://localhost:${port}?ticket=garbage`);
    await new Promise((r) => bad.once("close", r));
    expect(bad.readyState).toBe(WebSocket.CLOSED);

    const good = new WebSocket(`ws://localhost:${port}?ticket=${await signRoomTicket("p1", "u1", "Alice", 60_000)}`);
    const msg = await next(good);
    expect(msg.type).toBe("presence:snapshot");
    good.close();
  });

  it("does not retain a socket closed during ticket verification", async () => {
    let releaseVerification!: (claims: RoomTicketClaims) => void;
    let markVerificationStarted!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    const verification = new Promise<RoomTicketClaims>((resolve) => {
      releaseVerification = resolve;
    });
    server = await startHub({
      port: 0,
      secret: SECRET,
      verifyTicket: async (ticket) => {
        if (ticket === "blocked-ticket") {
          markVerificationStarted();
          return verification;
        }
        return { projectId: "p1", userId: "live-user", name: "Live" };
      },
    });
    const port = portOf(server);
    const closed = new WebSocket(`ws://localhost:${port}?ticket=blocked-ticket`);
    closed.on("error", () => undefined);
    await new Promise<void>((resolve) => closed.once("open", () => resolve()));
    await verificationStarted;
    const closedEvent = new Promise<void>((resolve) => closed.once("close", () => resolve()));
    closed.close();
    await closedEvent;
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseVerification({ projectId: "p1", userId: "closed-user", name: "Closed" });

    const good = new WebSocket(
      `ws://localhost:${port}?ticket=live-ticket`
    );
    const msg = await next(good);
    expect(msg.users).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "live-user" })]));
    expect(msg.users).not.toEqual(expect.arrayContaining([expect.objectContaining({ userId: "closed-user" })]));
    good.close();
  });

  it("broadcasts a published event to the room", async () => {
    server = await startHub({ port: 0, secret: SECRET });
    const port = portOf(server);
    const a = new WebSocket(`ws://localhost:${port}?ticket=${await signRoomTicket("p1", "u1", "A", 60_000)}`);
    const b = new WebSocket(`ws://localhost:${port}?ticket=${await signRoomTicket("p1", "u2", "B", 60_000)}`);
    await next(a); await next(b);
    const pub = new WebSocket(`ws://localhost:${port}`, { headers: { Authorization: `Bearer ${SECRET}` } });
    await new Promise((r) => pub.once("open", r));
    const got = next(b);
    pub.send(JSON.stringify({ type: "publish", projectId: "p1", event: { type: "item:delete", id: "i1" } }));
    expect((await got).type).toBe("item:delete");
    a.close(); b.close(); pub.close();
  });

  it("serves /health", async () => {
    server = await startHub({ port: 0, secret: SECRET });
    const res = await fetch(`http://localhost:${portOf(server)}/health`);
    expect(res.status).toBe(200);
  });
});
