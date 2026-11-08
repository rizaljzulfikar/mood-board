# Real-time collaboration via standalone WebSocket hub — Design

Date: 2026-11-08

## Intent & why

Collaboration currently rides a 2 s poll: `Board.tsx` runs
`setInterval(tick, 2000)` and POSTs to `src/app/api/projects/[id]/sync`,
which doubles as a presence heartbeat and a `updatedAt $gt` delta query.
Polling adds latency (up to 2 s) and wasted requests, and folds cursor
presence into the same round-trip.

We want event-driven push: when a mutation commits, other clients receive
it immediately over a WebSocket. The WS server is hosted as its own small
Node service so the developer's manual `next dev` workflow stays untouched.

## Goals

- Replace the 2 s poll as the primary sync path with live push for items,
  groups, connections, presence, and cursors.
- Keep the existing HTTP mutation routes, `mergeRemoteItems` /
  `mergeRemoteEntities` logic, soft-delete + `updatedAt` reconciliation,
  and undo/redo working unchanged.
- Authenticate the WS connection; a user must not subscribe to a project
  they are not a member of.
- Graceful degradation: when WS is down/unavailable, fall back to the
  existing HTTP `/sync` poll and reconcile on reconnect.

## Non-goals / anti-goals

- No horizontal scaling of the hub. Single-box self-host; rooms and
  presence are in-memory. Redis pub/sub is explicitly out of scope.
- No MongoDB change streams. The single `mongo:7` node has no oplog
  stream, and change streams do not capture presence/who.
- No schema changes. Soft-delete (`deletedAt`) and mongoose `updatedAt`
  semantics are unchanged.
- No change to the undo/redo model (client-owned history, replayed as
  PATCHes).

## Constraints

- The developer runs `next dev` manually on :3000 and the assistant must
  not start a second instance. A custom Next server (`server.ts`) is ruled
  out because it would change that workflow and break `next dev --turbopack`.
- Mutations are optimistic-local + REST. Sync propagates via `updatedAt`
  (mongoose timestamps); restores/re-deletes must go through `save()`.
- Server merge rules (deleted ids win locally, locked entries protected)
  must remain identical on the WS path.
- The hub must not need database access; membership is checked by the Next
  app when it issues the connection credential.

## Approaches considered

1. **Standalone WS hub + app-level publish (chosen).** A small `ws`
   service in docker-compose. Next mutation routes publish events to it
   after commit; browsers subscribe to `project:{id}` rooms. Zero
   disruption to `next dev`.
2. **Custom Next `server.ts` hosting `next()` + `ws`.** Rejected: changes
   the launch command, breaks `next dev --turbopack`, and complicates the
   manual-run workflow.
3. **MongoDB change streams.** Rejected: requires a replica set (the
   single `mongo:7` node has no oplog stream) and does not capture
   presence/who.

## How it works

### Topology

```
browser ──ws──▶ realtime hub (Node `ws`, port 4000)
next dev ──ws──▶ realtime hub   (publisher connection)

browser ──http──▶ next (existing mutation + sync routes, unchanged)
```

- **Hub** (`realtime/server.mjs` or `src/realtime/`): in-memory
  `Map<projectId, Set<socket>>` room registry plus a presence map with a
  ~10 s TTL (mirrors `src/lib/presence.ts`). Verifies a signed **room
  ticket** on connect; routes `publish` (from the Next publisher) and
  `cursor` (from browsers) into the correct room.
- **Publisher** (`src/lib/realtime.ts`): a singleton WS client from the
  Next process to the hub, authenticated with `REALTIME_SECRET`. Exposes
  `broadcastChange(projectId, kind, op, payload)` which the mutation
  routes call after committing to Mongo. Fire-and-forget; dropped events
  are filled by the client's reconnect reconcile.
- **Client** (`Board.tsx` + `src/lib/useRealtime.ts`): opens the WS,
  performs one initial HTTP load + reconcile, then applies pushes through
  the existing merge path. The 2 s interval is kept only as a fallback,
  enabled while the WS is closed and disabled once it opens.

### Connection & auth

1. Client loads the board through existing HTTP routes (membership already
   enforced by `requireMember`). A lightweight endpoint also returns a
   short-lived **room ticket**: signed JWT `{ projectId, userId }`, ~30 s
   TTL, `REALTIME_SECRET` key.
2. Client connects `ws://<REALTIME_URL>?ticket=<ticket>`.
3. Hub verifies the ticket signature/expiry, joins the socket to
   `project:{projectId}`, and sends `presence:snapshot`.
4. The hub never touches Mongo; a valid ticket is the proof of membership.

### Protocol

Client → hub:
- `cursor { x, y }` — throttled (~50 ms) world coordinates.

Hub → client:
- `presence:snapshot [{ userId, name, color, cursor }]`
- `presence:join { userId, name, color, cursor }`
- `presence:leave { userId }`
- `presence:cursor { userId, x, y }`
- `item:upsert { data }` / `item:delete { id }`
- `group:upsert { data }` / `group:delete { id }`
- `connection:upsert { data }` / `connection:delete { id }`

Payloads reuse `itemJSON`, `groupJSON`, `connectionJSON`, so the client
merge code is reused verbatim.

### Initial load & reconnect

- On mount: open WS → on open, run one HTTP reconcile (existing `/sync`
  POST with the last `since`) to fill any gap → resume live pushes.
- On WS close: enable the 2 s poll fallback, reconnect with exponential
  backoff; on reconnect, reconcile via `/sync since=<lastNow>` and disable
  the poll again.
- `sinceRef` / `cursorRef` semantics are unchanged.

### Publishing from mutation routes

After a successful DB commit in:
- `src/app/api/items/[id]/route.ts` (PATCH/POST/DELETE, incl. `deleted`
  flag),
- `src/app/api/projects/[id]/items/route.ts`, `.../items/from-url`,
- `src/app/api/groups/[id]/route.ts`, `.../groups/route.ts`,
- `src/app/api/connections/[id]/route.ts`, `.../connections/route.ts`,
- and the project delete path as needed,

call `broadcastChange(projectId, kind, op, payload)`. The publisher is a
no-op when the hub is unreachable; the client reconcile covers gaps.

### Presence & cursors

Presence and cursor tracking move into the hub (in-memory, TTL). The
existing `src/lib/presence.ts` can be retired or kept as a shared helper
for color hashing; `listActive` semantics move to the hub. The `/sync`
route keeps its presence path during the fallback window.

## Builder calls (made during design)

- Transport: raw `ws` (no socket.io) plus a small hand-rolled room/
  pub-sub layer.
- Publish transport: one persistent WS client from Next to the hub, not a
  per-mutation HTTP call.
- Auth: room ticket signed by Next, verified by the hub (hub stays
  DB-free).
- Env: add `REALTIME_URL` (`ws://localhost:4000`) and `REALTIME_SECRET` to
  `.env.local` / `.env.local.example`; add a `realtime` service to
  `docker-compose.yml`.

## Tests

- Hub: room join/broadcast isolation, ticket verification (valid/expired/
  wrong secret), presence TTL, cursor fan-out.
- Publisher: marries correctly to hub; no-op on unreachable hub.
- Client: verify merge path receives both poll (fallback) and WS events
  identically; reuse existing merge tests.
- Keep `tests/sync-cursor.test.ts`.

## Left to the builder

- Confirm where the current full-state initial load lives in `Board.tsx`
  and wire the reconcile accordingly.
- Exact cursor throttle constant.
- Whether to keep or retire `src/lib/presence.ts`.
