# Undo / Redo (max 10 each) — Design

Date: 2026-11-08

## Intent & why

Board edits are destructive and there is no way back: a mis-drag, an accidental
`Delete`, or a wrong link import are all permanent. Undo/redo (10 steps each
direction) makes experimentation safe without touching the server-first data
model's guarantees.

## Goals

- `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo on the board.
- Undo/redo buttons in the toolbar, disabled when the respective stack is empty.
- 10-entry cap on each stack (oldest dropped).
- Restores survive the 2s sync loop and reach other clients.
- Full scope undoable: add/delete of items, groups, connections; item & group
  moves/resizes (incl. group-member moves and bucket grow); label edits;
  z-order changes; connection style toggles. One history entry per gesture
  (a whole drag is one entry; an upload batch is one entry).
- No-ops don't create entries.

## Non-goals / anti-goals

- No undo of teammates' changes (only your own gestures are recorded).
- No undo of pan/zoom, selection, or cursor.
- No cross-session history (page reload clears stacks).
- No server-side history ledger — the client owns the stacks.

## Constraints

- Every mutation is optimistic-local + REST; a 2s sync merges remote state and
  **deleted ids always win locally** (unless locked). A client-only undo would
  be clobbered within one tick → undo must replay the restored state to the
  server.
- All deletes are soft (`deletedAt`), so no entity ever needs re-creating:
  undo-of-delete = un-delete (`PATCH deleted:false`), undo-of-add =
  re-delete (`PATCH deleted:true`).
- Sync propagates via `updatedAt` (mongoose timestamps) — restore/re-delete
  must go through `save()` so other clients pick the change up.
- Snapshot comparisons must ignore `updatedAt` (server echoes legitimately
  differ from optimistic local state).

## Approaches considered

1. **Snapshot history + server reconcile (chosen).** Each gesture ends by
   committing a normalized snapshot of `{items, groups, connections}` into a
   capped stack. Undo/redo swap snapshots and replay the diff to the server as
   PATCHes: un-delete, re-delete, or field patches. Minimal new concepts; one
   diff engine reused for all ~12 mutation paths.
2. **Command-pattern inverses** — an inverse operation per mutation path.
   Rejected: far more code across many call sites, same observable result.
3. **Client-only undo** — rejected: the sync merge clobbers restored state on
   the next tick.

## How it works

### History module (`src/lib/history.ts`, pure + tested)

- `type Snapshot = { items: ItemState[]; groups: GroupState[]; connections: ConnectionState[] }`
- `normalizeSnapshot`: strips `updatedAt`, sorts by id — makes snapshots
  comparable.
- `HistoryStack` (plain object + pure functions): `past: Snapshot[]`,
  `future: Snapshot[]`, `settled: Snapshot`.
  - `commit(next)`: if `normalize(next)` equals `normalize(settled)` → no-op;
    else push `settled` onto `past` (cap 10, drop oldest), clear `future`,
    `settled = next`.
  - `undo(current)`: if `past` empty → null; push `current` onto `future`
    (cap 10, drop oldest); return `past.pop()` as the target snapshot.
  - `redo(current)`: symmetric with `future`/`past`.
  - `canUndo` / `canRedo` derived from stack lengths.
- `planServerOps(target, current)`: pure diff between the undo target and live
  state (normalized). Per entity kind returns ops:
  - in target, absent from current → `{ id, deleted: false, ...all fields }`
    (restore).
  - in target, present in current, differing fields → `{ id, ...changed fields }`
    (patch; `updatedAt` ignored).
  - absent from target, present in current → `{ id, deleted: true }`
    (re-delete).
  - identical → no op.

### Server change (3 PATCH routes)

`src/app/api/items/[id]`, `groups/[id]`, `connections/[id]` PATCH accept an
optional `deleted: boolean`:
- `deleted === true` → soft-delete path (sets `deletedAt`, saves; group DELETE
  keeps its existing connection-cascade when called via the DELETE route, while
  the `deleted:true` patch soft-deletes just the group — connections are
  handled explicitly by the reconciler).
- `deleted === false` → un-delete (`deletedAt = null`) + apply any other fields
  in the same body, even when the doc is currently soft-deleted (today's routes
  404 in that case).
- Omitted → existing behavior untouched.

### Board integration (`src/components/Board.tsx`)

- `historyRef` holds the `HistoryStack`; a `histTick` state re-renders for
  button disabled states.
- `snapshotBoard()` builds a Snapshot from the three refs.
- `commitSettled()` is called at gesture end: `finishDrag` (non-pan),
  after delete/add of each entity kind, after `commitLabelEdit` applies,
  after `toggleConnectionStyle`, after upload/link-import appends items,
  after `createConnection`, after `addGroup`.
- Undo/redo: take `snapshotBoard()` as `current`, get target from the stack,
  apply target to the three setters, then fire-and-forget the ops from
  `planServerOps(target, current)`. Selection survives if the selected entity
  exists in the target, else cleared. Skipped while a drag is active.
- Keyboard handler extends the existing one (same input/textarea guard) with
  `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`.
- Toolbar gets `canUndo/canRedo/onUndo/onRedo` props; two icon buttons
  (`ArrowUUpLeft` / `ArrowUUpRight`) join the zoom group.

### Known trade-offs (accepted)

- A teammate's change landing between your gesture and your undo gets reverted
  by the undo (same-class behavior as Figma); rare at this scale.
- History is per-tab, cleared on reload.

## Tests (`tests/history.test.ts`, pure — no DB)

- commit/no-op dedupe (updatedAt ignored), 10-cap on past and future,
  future cleared on new commit, undo/redo round-trips.
- `planServerOps`: field patch, restore (un-delete + full fields), re-delete,
  identical → empty; all three entity kinds.
- Route tests for the `deleted` flag on the three PATCH routes follow the
  existing route-test pattern (DB-backed).

## Left to the builder

- Exact prop wiring of disabled states; icon sizing consistent with existing
  `ICON` constant in Toolbar.
