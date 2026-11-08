# Real-time WebSocket Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-second polling sync as the primary collaboration path with event-driven WebSocket push from a standalone hub, keeping the existing poll as a reconnect fallback.

**Architecture:** A small Node `ws` hub runs as its own process (docker-compose service) with in-memory project rooms and socket-based presence. Next.js mutation routes publish entity changes to the hub over a persistent server-side WS client; browsers subscribe to `project:{id}` rooms using a short-lived signed ticket and apply pushes through the existing `mergeRemote*` logic. The HTTP `/sync` poll stays as a fallback while the WS is closed and for reconnect reconciliation.

**Tech Stack:** Node.js 22, Next.js 15 (App Router), React 19, TypeScript (strict), `ws`, `jose`, MongoDB 7 + Mongoose 8, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-11-08-realtime-websocket-design.md`

## Global Constraints

- Do **not** run the full test suite. Run only the named test files, e.g. `npx vitest run tests/realtime-rooms.test.ts`. (Repo rule: full runs OOM the machine.)
- The developer runs their own `next dev` on :3000. Never start a second Next instance.
- The hub must never access MongoDB; a valid signed room ticket is the proof of membership.
- Self-hosted plain HTTP only: no TLS requirements, `secure: false` session cookies are deliberate.
- MongoDB is a single node — no replica set, no change streams.
- All API JSON uses string `id`, never Mongo `_id`.
- Soft-delete via `deletedAt`; mongoose `updatedAt` drives any delta reconciliation.
- Env names are fixed: `REALTIME_URL` (server→hub), `NEXT_PUBLIC_REALTIME_URL` (browser→hub), `REALTIME_SECRET` (ticket + publisher auth), `REALTIME_PORT` (hub listen port, default 4000).
- Preserve existing behaviour for `mergeRemoteItems`, `mergeRemoteEntities`, undo/redo, and the `deleted` PATCH flag.

## Review Focus

These are the failure modes most likely to bite a real user. Each has a test in the owning task.

1. **Edit while reconnecting:** a change committed while the browser WS is closed must survive; reconnect reconcile (`/sync since=<last>`) plus the poll fallback must fill the gap. (Task 7)
2. **Same user, two tabs:** presence must dedupe — `presence:leave` only when the last socket for that user closes; snapshots contain one entry per user. (Task 1)
3. **Group delete with connections:** remote clients must remove dangling connections immediately, not wait for a poll. (Task 6)
4. **Mutation while the hub is down:** the HTTP mutation must still return success; the dropped event is recovered by reconnect reconcile. (Task 3)
5. **Forged/expired ticket:** the hub must reject the connection (close 4001) and send no room data. (Task 2, Task 4)

---

### Task 1: Shared protocol types + RoomRegistry

**Files:**
- Create: `src/lib/realtime-protocol.ts`
- Create: `src/realtime/rooms.ts`
- Test: `tests/realtime-rooms.test.ts`

**Interfaces:**
- Produces (from `src/lib/realtime-protocol.ts`):
  ```ts
  export type EntityKind = "item" | "group" | "connection";
  export type Cursor = { x: number; y: number } | null;
  export type PresenceUser = { userId: string; name: string; color: string; cursor: Cursor };

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
  ```
- Produces (from `src/realtime/rooms.ts`):
  ```ts
  export type RoomClient = {
    id: string;
    projectId: string;
    userId: string;
    name: string;
    send: (message: string) => void;
  };

  export class RoomRegistry {
    add(client: RoomClient): { firstForUser: boolean };
    remove(clientId: string): { projectId: string; userId: string; lastForUser: boolean } | null;
    broadcast(projectId: string, message: ServerMessage, exceptClientId?: string): void;
    updateCursor(projectId: string, userId: string, cursor: { x: number; y: number }): void;
    snapshot(projectId: string): PresenceUser[];
    hasUser(projectId: string, userId: string): boolean;
  }
  ```
  Presence is socket-based (liveness = an open socket). `presenceColor` is reused from `src/lib/presence.ts`; do **not** add a TTL — an idle-but-connected user stays present.

- [ ] **Step 1: Write the failing test**

Create `tests/realtime-rooms.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RoomRegistry, type RoomClient } from "../src/realtime/rooms";

function client(id: string, projectId: string, userId: string): RoomClient & { sent: string[] } {
  const sent: string[] = [];
  return { id, projectId, userId, name: userId, sent, send: (m) => sent.push(m) };
}

describe("RoomRegistry", () => {
  it("broadcasts only to the target room and can skip one client", () => {
    const r = new RoomRegistry();
    const a = client("a", "p1", "u1");
    const b = client("b", "p1", "u2");
    const c = client("c", "p2", "u3");
    r.add(a); r.add(b); r.add(c);
    r.broadcast("p1", { type: "item:delete", id: "x" }, "a");
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
    expect(c.sent).toHaveLength(0);
  });

  it("reports firstForUser and lastForUser across two sockets of one user", () => {
    const r = new RoomRegistry();
    const a1 = client("a1", "p1", "u1");
    const a2 = client("a2", "p1", "u1");
    expect(r.add(a1).firstForUser).toBe(true);
    expect(r.add(a2).firstForUser).toBe(false);
    expect(r.remove("a1")?.lastForUser).toBe(false);
    expect(r.remove("a2")?.lastForUser).toBe(true);
  });

  it("snapshot dedupes per user and carries the last cursor", () => {
    const r = new RoomRegistry();
    r.add(client("a1", "p1", "u1"));
    r.add(client("a2", "p1", "u1"));
    r.add(client("b", "p1", "u2"));
    r.updateCursor("p1", "u1", { x: 4, y: 5 });
    const snap = r.snapshot("p1");
    expect(snap).toHaveLength(2);
    expect(snap.find((u) => u.userId === "u1")?.cursor).toEqual({ x: 4, y: 5 });
  });

  it("removing the last socket drops the user from presence", () => {
    const r = new RoomRegistry();
    r.add(client("a", "p1", "u1"));
    r.remove("a");
    expect(r.hasUser("p1", "u1")).toBe(false);
    expect(r.snapshot("p1")).toHaveLength(0);
  });

  it("swallows send errors so one dead socket cannot break a broadcast", () => {
    const r = new RoomRegistry();
    const bad: RoomClient = { id: "bad", projectId: "p1", userId: "u1", name: "u1", send: () => { throw new Error("boom"); } };
    r.add(bad);
    r.add(client("ok", "p1", "u2"));
    expect(() => r.broadcast("p1", { type: "item:delete", id: "x" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/realtime-rooms.test.ts`
Expected: FAIL — cannot resolve `../src/realtime/rooms`.

- [ ] **Step 3: Implement the protocol module and RoomRegistry**

`src/lib/realtime-protocol.ts`: the type declarations from the Interfaces block.

`src/realtime/rooms.ts`: keep three maps — `clients: Map<clientId, RoomClient>`, `rooms: Map<projectId, Set<clientId>>`, `presence: Map<`${projectId}:${userId}`, { name, cursor }>`.
- `add`: insert into both maps; if the presence entry is new, return `{ firstForUser: true }`.
- `remove`: look up the client, remove it; if no other client in that room has the same `userId`, delete the presence entry and return `lastForUser: true`; otherwise `false`. Return `null` for an unknown id.
- `broadcast`: JSON-stringify `message` once and `send` it to every room client except `exceptClientId`; wrap each `send` in try/catch.
- `updateCursor`: set `presence` cursor (create the entry if needed).
- `snapshot`: for each room client, dedupe by `userId`, using `presenceColor(userId)` for `color` and the stored cursor.
- `hasUser`: any room client with matching `projectId` + `userId`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/realtime-rooms.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime-protocol.ts src/realtime/rooms.ts tests/realtime-rooms.test.ts
git commit -m "feat: realtime protocol types and room registry"
```

---

### Task 2: Room tickets + issue endpoint

**Files:**
- Create: `src/lib/realtime-ticket.ts`
- Create: `src/app/api/projects/[id]/realtime-ticket/route.ts`
- Modify: `vitest.config.ts` (add `REALTIME_SECRET`, `REALTIME_URL` test env)
- Test: `tests/realtime-ticket.test.ts`

**Interfaces:**
- Produces (from `src/lib/realtime-ticket.ts`):
  ```ts
  export type RoomTicketClaims = { projectId: string; userId: string; name: string };
  export function signRoomTicket(projectId: string, userId: string, name: string, ttlMs?: number): Promise<string>;
  export function verifyRoomTicket(ticket: string, secret?: string): Promise<RoomTicketClaims | null>;
  ```
  JWT payload `{ projectId, name }`, subject `userId`, HS256, default `ttlMs = 30_000`, key from `REALTIME_SECRET` when `secret` is omitted.
- Consumes: `requireMember` from `@/lib/api`, `json`/`apiError`.

- [ ] **Step 1: Write the failing test**

Create `tests/realtime-ticket.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", async () => ({ getCurrentUser: vi.fn(async () => null) }));

import { signRoomTicket, verifyRoomTicket } from "@/lib/realtime-ticket";
import { GET } from "@/app/api/projects/[id]/realtime-ticket/route";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";

const SECRET = "test-realtime-secret";

describe("room tickets", () => {
  it("round-trips project, user and name", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", 60_000);
    expect(await verifyRoomTicket(t, SECRET)).toEqual({ projectId: "p1", userId: "u1", name: "Alice" });
  });
  it("rejects an expired ticket", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", -1_000);
    expect(await verifyRoomTicket(t, SECRET)).toBeNull();
  });
  it("rejects a tampered ticket", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", 60_000);
    expect(await verifyRoomTicket(t.slice(0, -2) + "xx", SECRET)).toBeNull();
  });
  it("rejects a ticket signed with another secret", async () => {
    const t = await signRoomTicket("p1", "u1", "Alice", 60_000);
    expect(await verifyRoomTicket(t, "other-secret")).toBeNull();
  });
});

describe("GET /api/projects/:id/realtime-ticket", () => {
  beforeEach(async () => {
    await connectDB();
    const user = await User.create({ email: `rt-${Date.now()}-${Math.random()}@test.local`, name: "R", passwordHash: "x" });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: String(user._id), email: user.email, name: user.name, role: "user", mustChangePassword: false });
  });

  it("returns a verifiable ticket for a member", async () => {
    const user = await getCurrentUser();
    const project = await Project.create({ name: "P", owner: user!.id, members: [] });
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: String(project._id) }) });
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    const claims = await verifyRoomTicket(ticket, SECRET);
    expect(claims?.projectId).toBe(String(project._id));
    expect(claims?.userId).toBe(user!.id);
  });
});
```

Add to `vitest.config.ts` `test.env`: `REALTIME_SECRET: "test-realtime-secret"`, `REALTIME_URL: "ws://localhost:4999"`. The route signs with the ambient `REALTIME_SECRET`, matching the test's `SECRET`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/realtime-ticket.test.ts`
Expected: FAIL — missing modules.

- [ ] **Step 3: Implement**

`src/lib/realtime-ticket.ts`: mirror the `jose` usage in `src/lib/session.ts` (`SignJWT`/`jwtVerify`, HS256). `verifyRoomTicket` returns `null` on any thrown error or when `projectId`/`sub`/`name` are not strings.

`src/app/api/projects/[id]/realtime-ticket/route.ts`:
```ts
export const runtime = "nodejs";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { user } = await requireMember(id);
    return json({ ticket: await signRoomTicket(id, user.id, user.name) });
  } catch (e) {
    return apiError(e);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/realtime-ticket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime-ticket.ts "src/app/api/projects/[id]/realtime-ticket/route.ts" vitest.config.ts tests/realtime-ticket.test.ts
git commit -m "feat: signed room tickets and issue endpoint"
```

---

### Task 3: Server→hub publisher

**Files:**
- Create: `src/lib/realtime-publish.ts`
- Test: `tests/realtime-publish.test.ts`
- Modify: `package.json` / `package-lock.json` (add `ws`, `@types/ws`, `tsx`)

**Interfaces:**
- Produces:
  ```ts
  export function buildPublishMessage(
    projectId: string, kind: EntityKind, op: "upsert" | "delete", payload: unknown
  ): PublishMessage;
  export function broadcastUpsert(projectId: string, kind: EntityKind, data: unknown): void;
  export function broadcastDelete(projectId: string, kind: EntityKind, id: string): void;
  export function setPublishTransportForTest(fn: ((msg: PublishMessage) => void) | null): void;
  ```
- Behaviour: a module-level transport sends over a lazily-created singleton `ws` client to `${REALTIME_URL}` with header `Authorization: Bearer ${REALTIME_SECRET}`. If the socket is not `OPEN`, drop the message (no throw, no buffer). Every send is wrapped in try/catch so a hub outage never fails the HTTP mutation.

- [ ] **Step 1: Install dependencies**

```bash
npm install ws
npm install -D @types/ws tsx
```
`tsx` runs the TypeScript hub entrypoint (Task 4); `ws` is used by both the publisher and the hub; the browser uses the native `WebSocket`.

- [ ] **Step 2: Write the failing test**

Create `tests/realtime-publish.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { broadcastUpsert, broadcastDelete, buildPublishMessage, setPublishTransportForTest } from "@/lib/realtime-publish";

const sent: unknown[] = [];
setPublishTransportForTest((m) => sent.push(m));
afterEach(() => { sent.length = 0; });

describe("buildPublishMessage", () => {
  it("builds an upsert event", () => {
    expect(buildPublishMessage("p1", "item", "upsert", { id: "i1" }))
      .toEqual({ type: "publish", projectId: "p1", event: { type: "item:upsert", data: { id: "i1" } } });
  });
  it("builds a delete event", () => {
    expect(buildPublishMessage("p1", "group", "delete", "g1"))
      .toEqual({ type: "publish", projectId: "p1", event: { type: "group:delete", id: "g1" } });
  });
});

describe("broadcast helpers", () => {
  it("forwards to the transport", () => {
    broadcastUpsert("p1", "connection", { id: "c1" });
    broadcastDelete("p1", "item", "i1");
    expect(sent).toHaveLength(2);
  });
  it("never throws when the transport throws", () => {
    setPublishTransportForTest(() => { throw new Error("hub down"); });
    expect(() => broadcastUpsert("p1", "item", { id: "i1" })).not.toThrow();
    setPublishTransportForTest((m) => sent.push(m));
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/realtime-publish.test.ts`
Expected: FAIL — missing module.

- [ ] **Step 4: Implement `src/lib/realtime-publish.ts`**

- Start the module with `import WebSocket from "ws";`.
- `buildPublishMessage`: `{ type: "publish", projectId, event: op === "upsert" ? { type: `${kind}:upsert`, data: payload } : { type: `${kind}:delete`, id: payload } }` (cast to `ServerMessage`).
- Module state: `let transport = defaultTransport; let socket: WebSocket | null = null;`.
- `defaultTransport(msg)`: `ensureSocket()`; if `socket?.readyState === WebSocket.OPEN`, `socket.send(JSON.stringify(msg))`; else return.
- `ensureSocket()`: if an open/connecting socket exists, reuse it; otherwise create `new WebSocket(env("REALTIME_URL"), { headers: { Authorization: `Bearer ${env("REALTIME_SECRET")}` } })`, set `socket` on `open`, clear it on `close`/`error`.
- `broadcastUpsert`/`broadcastDelete` call `transport(buildPublishMessage(...))` inside try/catch.
- `setPublishTransportForTest(fn)`: `transport = fn ?? defaultTransport`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/realtime-publish.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/realtime-publish.ts tests/realtime-publish.test.ts
git commit -m "feat: publish board changes to the realtime hub"
```

---

### Task 4: Hub server, entrypoint, and local infra

**Files:**
- Create: `src/realtime/hub.ts`
- Create: `src/realtime/server.ts`
- Modify: `package.json` (add `"realtime": "tsx src/realtime/server.ts"` script)
- Modify: `.env.local.example`
- Modify: `.env.local`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Test: `tests/realtime-hub.test.ts`

**Interfaces:**
- Produces: `export async function startHub(options: { port: number; secret: string }): Promise<import("node:http").Server>;`
  Resolves once the server is listening (so callers can read `server.address()` immediately). Resolves `http://localhost:{port}/health` → `200 ok`. Accepts websocket upgrades on the same server. Publisher connections authenticate via `Authorization: Bearer <secret>`; browser connections via `?ticket=<signed>` verified with `verifyRoomTicket(ticket, secret)`. Clients join `project:{projectId}`. `publish` messages are broadcast to that room. `cursor` messages update presence and fan out `presence:cursor`.
- Consumes: `RoomRegistry` (Task 1), `verifyRoomTicket` (Task 2), `ws` (Task 3).
- Imports inside `src/realtime/*` must be **relative** (`../lib/...`) so `tsx` runs without tsconfig path aliases.

- [ ] **Step 1: Write the failing integration test**

Create `tests/realtime-hub.test.ts` (uses `ws` client; start on port 0):
```ts
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import WebSocket from "ws";
import { startHub } from "../src/realtime/hub";
import { signRoomTicket } from "@/lib/realtime-ticket";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/realtime-hub.test.ts`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement `src/realtime/hub.ts`**

Create `http.createServer` (answer `/health`, else 404) and `new WebSocketServer({ server: http })`. Return a promise that resolves on the server's `listening` event (call `http.listen(port)` first). On each connection:
- Parse `new URL(req.url ?? "/", "http://localhost")`.
- If `req.headers.authorization === `Bearer ${secret}``, treat as publisher: on `message`, parse JSON; when `type === "publish"` and `projectId` is a string, `registry.broadcast(projectId, msg.event)`.
- Otherwise require `?ticket=`; `const claims = await verifyRoomTicket(ticket, secret)` (wrap in try/catch; close `4001` on failure). Generate a unique `client.id` (e.g. `crypto.randomUUID()`), `registry.add({ id, projectId, userId, name, send })` where `send` is `(m) => socket.send(m)` guarded by `socket.readyState === WebSocket.OPEN`. Send `{ type: "presence:snapshot", users: registry.snapshot(projectId) }`. If `add().firstForUser`, `registry.broadcast(projectId, { type: "presence:join", user: ... }, client.id)`.
- On `cursor` messages with finite `x`/`y`: `registry.updateCursor(...)` then `registry.broadcast(projectId, { type: "presence:cursor", userId, cursor }, client.id)`.
- On `close`: `const r = registry.remove(id)`; if `r?.lastForUser`, broadcast `{ type: "presence:leave", userId }`.

Do not leave an unhandled rejected promise from the async connection handler — wrap the body in try/catch and `socket.close(1011)` on unexpected errors.

- [ ] **Step 4: Implement `src/realtime/server.ts`**

```ts
import { startHub } from "./hub";

const port = Number(process.env.REALTIME_PORT ?? 4000);
const secret = process.env.REALTIME_SECRET;
if (!secret) {
  console.error("[realtime] REALTIME_SECRET is required");
  process.exit(1);
}
void startHub({ port, secret }).then(() => {
  console.log(`[realtime] listening on :${port}`);
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/realtime-hub.test.ts`
Expected: PASS (3 tests). If the forged-ticket close assertion races, await the `close` event instead of asserting `readyState` directly.

- [ ] **Step 6: Wire scripts, env, compose, docs**

`package.json` scripts: add `"realtime": "tsx src/realtime/server.ts"`.

`.env.local.example` and `.env.local` (append; keep the example secret non-production):
```bash
# Real-time collaboration hub
REALTIME_URL=ws://localhost:4000
NEXT_PUBLIC_REALTIME_URL=ws://localhost:4000
REALTIME_SECRET=change-me-to-a-long-random-string
REALTIME_PORT=4000
```

`docker-compose.yml` — add:
```yaml
  realtime:
    image: node:22-alpine
    container_name: moodboard-realtime
    working_dir: /app
    command: npx tsx src/realtime/server.ts
    env_file: .env.local
    environment:
      REALTIME_PORT: "4000"
    ports:
      - "4000:4000"
    volumes:
      - .:/app
    depends_on:
      - mongo
```
(The repo, including its `node_modules`, is bind-mounted so `npx tsx` runs offline.)

`README.md`: change the Collaboration stack line to "live WebSocket push (2 s polling fallback)" and add `npm run realtime` / `docker compose up -d realtime` to Quickstart and the Scripts table.

- [ ] **Step 7: Commit**

```bash
# NOTE: .env.local is gitignored — append REALTIME_* to it for local runs,
# but never stage it.
git add src/realtime/hub.ts src/realtime/server.ts tests/realtime-hub.test.ts package.json .env.local.example docker-compose.yml README.md
git commit -m "feat: standalone realtime hub and local infra"
```

---

### Task 5: Broadcast item mutations

**Files:**
- Modify: `src/app/api/items/[id]/route.ts`
- Modify: `src/app/api/projects/[id]/items/route.ts`
- Modify: `src/app/api/projects/[id]/items/from-url/route.ts`
- Test: `tests/realtime-broadcast-items.test.ts`

**Interfaces:**
- Consumes: `broadcastUpsert(projectId, "item", itemJSON(item))`, `broadcastDelete(projectId, "item", String(item._id))` from `@/lib/realtime-publish`.

- [ ] **Step 1: Write the failing test**

Create `tests/realtime-broadcast-items.test.ts`. Mock auth and the publisher, follow the DB setup pattern in `tests/item-label.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/auth", async () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/realtime-publish", () => ({ broadcastUpsert: vi.fn(), broadcastDelete: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/items/[id]/route";
import { broadcastUpsert, broadcastDelete } from "@/lib/realtime-publish";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Project } from "@/lib/models/Project";
import { Item } from "@/lib/models/Item";

let projectId: string;
beforeEach(async () => {
  await connectDB();
  const user = await User.create({ email: `b-${Date.now()}-${Math.random()}@test.local`, name: "B", passwordHash: "x" });
  const project = await Project.create({ name: "B", owner: user._id, members: [] });
  projectId = String(project._id);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: String(user._id), email: user.email, name: user.name, role: "user", mustChangePassword: false });
  vi.clearAllMocks();
});

function makeItem() {
  return Item.create({ project: projectId, kind: "image", objectKey: `${projectId}/${Date.now()}-${Math.random()}.png`, originalName: "p.png", mime: "image/png", size: 1, width: 10, height: 10, x: 0, y: 0, rotation: 0, z: 1, addedBy: "000000000000000000000001" });
}
async function patchItem(id: string, body: unknown) {
  return PATCH(new Request(`http://x/api/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

describe("item broadcasts", () => {
  it("upserts after a field patch", async () => {
    const item = await makeItem();
    await patchItem(String(item._id), { x: 42 });
    expect(vi.mocked(broadcastUpsert)).toHaveBeenCalledWith(projectId, "item", expect.objectContaining({ id: String(item._id) }));
  });
  it("deletes after the deleted:true patch", async () => {
    const item = await makeItem();
    await patchItem(String(item._id), { deleted: true });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "item", String(item._id));
  });
  it("deletes after DELETE", async () => {
    const item = await makeItem();
    await DELETE(new Request(`http://x/api/items/${item._id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(item._id) }) });
    expect(vi.mocked(broadcastDelete)).toHaveBeenCalledWith(projectId, "item", String(item._id));
  });
});
```

Add create-path coverage by mocking `@/lib/items` while preserving `itemJSON` (`vi.importActual`) so the upload/from-url POSTs broadcast `broadcastUpsert`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/realtime-broadcast-items.test.ts`
Expected: FAIL — broadcasts not called.

- [ ] **Step 3: Implement the broadcasts**

- `items/[id]/route.ts`: in the `deleted:true` branch call `broadcastDelete(String(item.project), "item", String(item._id))` before returning; after the final `save()` call `broadcastUpsert(String(item.project), "item", itemJSON(item))`. Same split in `DELETE`.
- `items/route.ts` POST: after `createItemWithObject` returns, `broadcastUpsert(String(project._id), "item", itemJSON(item))`.
- `items/from-url/route.ts`: in `importImage`, after creating the item, `broadcastUpsert(String(args.projectId), "item", itemJSON(item))`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/realtime-broadcast-items.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/items/[id]/route.ts" "src/app/api/projects/[id]/items/route.ts" "src/app/api/projects/[id]/items/from-url/route.ts" tests/realtime-broadcast-items.test.ts
git commit -m "feat: broadcast item mutations to the realtime hub"
```

---

### Task 6: Broadcast group and connection mutations (incl. cascade)

**Files:**
- Modify: `src/app/api/groups/[id]/route.ts`
- Modify: `src/app/api/projects/[id]/groups/route.ts`
- Modify: `src/app/api/connections/[id]/route.ts`
- Modify: `src/app/api/projects/[id]/connections/route.ts`
- Test: `tests/realtime-broadcast-groups.test.ts`

**Interfaces:**
- Consumes: `broadcastUpsert` / `broadcastDelete` from `@/lib/realtime-publish`.

- [ ] **Step 1: Write the failing test**

Create `tests/realtime-broadcast-groups.test.ts` with the same mock pattern as Task 5. Cover:
- group PATCH `{ x }` → `broadcastUpsert(projectId, "group", expect.objectContaining({ id }))`.
- group PATCH `{ deleted: true }` → `broadcastDelete(projectId, "group", id)`.
- group DELETE with two connections attached → `broadcastDelete` called for the group id **and** for both connection ids (Review Focus #3).
- connection PATCH `{ style: "line" }` → `broadcastUpsert(projectId, "connection", ...)`; connection DELETE → `broadcastDelete(projectId, "connection", id)`.
- POST group / POST connection → `broadcastUpsert` for the new record.

Use `Group.create` / `Connection.create` directly in `beforeEach`, matching the field shapes in `tests/groups-connections.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/realtime-broadcast-groups.test.ts`
Expected: FAIL — broadcasts not called.

- [ ] **Step 3: Implement**

- `groups/[id]/route.ts` PATCH: `deleted:true` → `broadcastDelete(String(group.project), "group", String(group._id))` before returning; else after `save()` → `broadcastUpsert(String(group.project), "group", groupJSON(group))`.
- `groups/[id]/route.ts` DELETE: before `updateMany`, fetch the affected connection ids:
  ```ts
  const affected = await Connection.find({ project: group.project, deletedAt: null, $or: [{ from: group._id }, { to: group._id }] }).select("_id");
  ```
  after `save()`/`updateMany`, `broadcastDelete(projectId, "group", String(group._id))` and `for (const c of affected) broadcastDelete(projectId, "connection", String(c._id))`.
- `groups/route.ts` POST: after `Group.create`, `broadcastUpsert(String(project._id), "group", groupJSON(group))`.
- `connections/[id]/route.ts` PATCH: `deleted:true` → delete broadcast; else after `save()` → `broadcastUpsert(String(connection.project), "connection", connectionJSON(connection))`.
- `connections/[id]/route.ts` DELETE: `broadcastDelete(String(connection.project), "connection", String(connection._id))`.
- `connections/route.ts` POST: after `Connection.create`, `broadcastUpsert(String(project._id), "connection", connectionJSON(connection))`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/realtime-broadcast-groups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/groups/[id]/route.ts" "src/app/api/projects/[id]/groups/route.ts" "src/app/api/connections/[id]/route.ts" "src/app/api/projects/[id]/connections/route.ts" tests/realtime-broadcast-groups.test.ts
git commit -m "feat: broadcast group and connection mutations"
```

---

### Task 7: Client integration (WS primary + poll fallback)

**Files:**
- Create: `src/lib/realtime-client.ts`
- Modify: `src/components/Board.tsx`
- Test: `tests/realtime-client.test.ts`

**Interfaces:**
- Produces (from `src/lib/realtime-client.ts`):
  ```ts
  export type BoardState = { items: ItemState[]; groups: GroupState[]; connections: ConnectionState[] };

  export function applyRealtimeEvent(state: BoardState, event: ServerMessage, locked: string[]): BoardState;
  export function applyPresenceEvent(users: PresenceUser[], event: ServerMessage, selfUserId: string): PresenceUser[];
  ```
  `applyRealtimeEvent` routes each entity message through `mergeRemoteItems` / `mergeRemoteEntities` with a single-element delta; presence messages return `state` unchanged. `applyPresenceEvent` handles `snapshot` (filter self), `join` (upsert, ignore self), `leave`, `cursor`.

- [ ] **Step 1: Write the failing test**

Create `tests/realtime-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyRealtimeEvent, applyPresenceEvent, type BoardState } from "@/lib/realtime-client";

const base: BoardState = {
  items: [{ id: "i1", kind: "image", x: 0, y: 0, width: 1, height: 1, rotation: 0, z: 1, objectKey: "k", originalName: "n", mime: "image/png", sourceUrl: null, title: null, siteName: null, label: "", addedBy: "u", updatedAt: "2026-01-01T00:00:00.000Z" }],
  groups: [],
  connections: [],
};

describe("applyRealtimeEvent", () => {
  it("merges an item upsert", () => {
    const next = applyRealtimeEvent(base, { type: "item:upsert", data: { ...base.items[0], x: 99 } }, []);
    expect(next.items[0].x).toBe(99);
  });
  it("applies an item delete", () => {
    expect(applyRealtimeEvent(base, { type: "item:delete", id: "i1" }, []).items).toHaveLength(0);
  });
  it("keeps a locked item during delete", () => {
    expect(applyRealtimeEvent(base, { type: "item:delete", id: "i1" }, ["i1"]).items).toHaveLength(1);
  });
  it("ignores presence messages", () => {
    expect(applyRealtimeEvent(base, { type: "presence:leave", userId: "u" }, [])).toBe(base);
  });
});

describe("applyPresenceEvent", () => {
  const self = "me";
  it("filters self from a snapshot", () => {
    const users = applyPresenceEvent([], { type: "presence:snapshot", users: [{ userId: "me", name: "M", color: "c", cursor: null }, { userId: "u", name: "U", color: "c", cursor: null }] }, self);
    expect(users.map((u) => u.userId)).toEqual(["u"]);
  });
  it("upserts a join and removes a leave", () => {
    const joined = applyPresenceEvent([], { type: "presence:join", user: { userId: "u", name: "U", color: "c", cursor: null } }, self);
    expect(joined).toHaveLength(1);
    expect(applyPresenceEvent(joined, { type: "presence:leave", userId: "u" }, self)).toHaveLength(0);
  });
  it("updates a cursor", () => {
    const users = applyPresenceEvent([{ userId: "u", name: "U", color: "c", cursor: null }], { type: "presence:cursor", userId: "u", cursor: { x: 1, y: 2 } }, self);
    expect(users[0].cursor).toEqual({ x: 1, y: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/realtime-client.test.ts`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement `src/lib/realtime-client.ts`**

Straight `switch` on `event.type`; for entity messages call the merge helpers from `@/lib/merge`; return the same `state` object for presence messages. `applyPresenceEvent` mirrors the semantics in the test. Import `PresenceUser`, `ServerMessage` from `@/lib/realtime-protocol` and the state types from `@/lib/merge`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/realtime-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `src/components/Board.tsx`**

- Import `applyRealtimeEvent`, `applyPresenceEvent`, `PresenceUser`, `ServerMessage`; delete the local `PresenceUser` type.
- Keep `SYNC_INTERVAL_MS = 2000`; add `const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL;` and a `CURSOR_THROTTLE_MS = 50`.
- Extract the old `tick` body into `const applySync = useCallback((data: SyncPayload) => { ... })` that runs the same merges + `setUsers`, and a `const poll = useCallback(() => fetch('/api/projects/'+projectId+'/sync', ...).then(applySync))`.
- Replace the polling effect with:
  - `connect()`: `fetch('/api/projects/'+projectId+'/realtime-ticket')` → `{ ticket }`; open `new WebSocket(`${REALTIME_URL}?ticket=${encodeURIComponent(ticket)}`)`.
  - `onopen`: clear the fallback interval; call `poll()` once to reconcile (Review Focus #1).
  - `onmessage`: parse `ServerMessage`; entity messages → `applyRealtimeEvent({items:itemsRef.current, groups:groupsRef.current, connections:connectionsRef.current}, msg, [...lockedRef.current])` then write back via `setItemsBoth`/`setGroupsBoth`/`setConnectionsBoth`; presence messages → `setUsers(applyPresenceEvent(...))`.
  - `onclose`/`onerror`: start `setInterval(poll, SYNC_INTERVAL_MS)` and schedule `connect()` with exponential backoff (cap ~10 s).
  - Cleanup: close the socket, clear timers.
- Cursor: add `const sendCursor = useThrottle(...)` or a timestamp ref; at the two `cursorRef.current = world` sites (in `onPointerMove`), also send `{ type: "cursor", cursor: world }` when the socket is open, throttled to `CURSOR_THROTTLE_MS`.

- [ ] **Step 6: Typecheck and targeted tests**

Run: `npx tsc --noEmit`
Run: `npx vitest run tests/realtime-client.test.ts tests/merge.test.ts tests/merge-entities.test.ts tests/history.test.ts`
Expected: no type errors; PASS.

- [ ] **Step 7: Manual two-window verification**

1. Start the hub (`npm run realtime` or `docker compose up -d realtime`) and the developer's existing `next dev`.
2. Open the same board in two browser windows; move/drag an item in one — it appears in the other in well under 2 s, and cursors move live.
3. Delete a group that has connections — the connections disappear in the other window immediately.
4. Stop the hub; edits still work and the 2 s poll keeps both windows in sync; restart the hub — the WS reconnects and presence returns.

- [ ] **Step 8: Commit**

```bash
git add src/lib/realtime-client.ts src/components/Board.tsx tests/realtime-client.test.ts
git commit -m "feat: consume realtime pushes in the board with poll fallback"
```

---

## Self-Review Notes

- **Spec coverage:** hub topology (Tasks 1/4), ticket auth (Task 2), publisher (Task 3), publish from every mutation route (Tasks 5/6), presence/cursors over WS (Task 1 + Task 7), initial load + reconnect reconcile + poll fallback (Task 7), env/compose/docs (Task 4).
- **Type consistency:** `PresenceUser`, `ServerMessage`, `PublishMessage` are defined once in `src/lib/realtime-protocol.ts` and imported everywhere; `RoomRegistry` method names match the hub usage; `EntityKind` flows into `buildPublishMessage`.
- **Review Focus tests:** #1 reconcile/poll (Task 7 effect + manual), #2 presence dedupe (Task 1), #3 cascade (Task 6), #4 no-throw publish (Task 3), #5 forged ticket (Tasks 2, 4).
- **Builder calls left open:** exact backoff schedule and cursor throttle are constants in `Board.tsx`; presence is socket-based (no TTL) — the design's TTL was a polling artifact.
