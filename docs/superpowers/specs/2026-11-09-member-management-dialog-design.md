# Member Management Dialog — Design

Date: 2026-11-09
Status: draft (pending builder check + approval)

## Intent and why

The board toolbar currently shows a member count and — for owners only — a
bare inline "Invite by email" form. There is no way to see who the members
are, and the only removal path is a raw `DELETE` API call. This change adds a
**member management dialog** opened from the toolbar: a member list with an
invite control for owners and a self-serve "Leave project" action for members.

## Goals

- A "Members" trigger in the toolbar, visible to **all** roles, opening a
  dialog that lists owner + members (name, email, role badge).
- Owner: invite by email inside the dialog (moves the existing inline form),
  remove any member (with a confirm step).
- Member: read-only list, plus "Leave project" on their own row (with
  confirm) — self-removal, already supported by the DELETE API.
- Other open boards stay in sync live: a new `project:members` realtime event
  updates every connected client's member list.
- A removed member's open socket is closed by the hub (kick), so they stop
  receiving board events and their presence chip disappears.

## Non-goals

- No new roles or per-member permissions (schema `owner` + `members[]`
  stays as is).
- No invite-by-token / signup flow; membership remains limited to existing
  MoodBoard accounts.
- No email notifications, no member-count pagination.
- No changes to invite/remove permission rules beyond what exists
  (POST owner-only; DELETE owner or self; owner irremovable).

## Anti-goals

- Keeping the inline invite form alongside the dialog (duplicate paths).
- A removed user silently keeping a live board feed until reload.

## Constraints

- Follow existing patterns: hand-rolled dialogs on the `.link-dialog*` CSS
  classes (template: `ActionBar.tsx`), manual validation, `requireMember`
  guard, fire-and-forget realtime publishing, vitest with the
  `invitations.test.ts` auth-mock pattern and `renderToStaticMarkup` UI tests.
- Realtime publishing must never fail the HTTP mutation.
- The protocol file (`src/lib/realtime-protocol.ts`) stays pure types.

## Approaches considered

1. **Toolbar-mounted dialog replacing the inline form (chosen).** Sharing
   already lives in the toolbar; one trigger consolidates list + invite +
   remove; reuses the established dialog CSS. Cost: a new client component.
2. **Dedicated `/projects/[id]/members` page.** Rejected: leaves the board
   context, heavier navigation for a small list, and the board toolbar is
   where sharing UI lives today.
3. **Member chips on the Projects list cards.** Rejected: that page is a
   list/archive surface; management actions belong at board level where the
   current invite form already is.

## The decided how

### Data & API (mostly existing)

- `POST /api/projects/[id]/members` — unchanged behavior (owner-only, by
  email, 404 unknown account, 409 already-member). **Add:** after the write,
  broadcast the fresh member list (`removedUserIds: []`).
- `DELETE /api/projects/[id]/members?email=` — unchanged behavior (owner may
  remove others; a member may remove only themselves; owner irremovable).
  **Add:** after the write, broadcast the remaining list plus the removed
  user's id.
- Shared helper in the route file loads member summaries via
  `User.find({ _id: { $in: members } }).select("email name")` mapped to
  `{ id, email, name }`.
- Response bodies unchanged (`{ ok, memberCount }`).

### Realtime protocol (`src/lib/realtime-protocol.ts`)

- New exported type `MemberSummary = { id: string; email: string; name: string }`.
- New `ServerMessage` variant:
  `{ type: "project:members"; members: MemberSummary[]; removedUserIds: string[] }`.
- `Toolbar.tsx`'s `MemberInfo` becomes an alias of `MemberSummary` (single
  definition; protocol must not import client code).

### Publishing (`src/lib/realtime-publish.ts`)

- New `broadcastMembers(projectId, members, removedUserIds)` following the
  `broadcastProjectDeleted` template: try/catch, fire-and-forget via
  `transport({ type: "publish", projectId, event: { type: "project:members", ... } })`.

### Hub kick (`src/realtime/hub.ts`, `src/realtime/rooms.ts`)

- `RoomClient` gains `close: (code: number) => void`.
- `RoomRegistry.closeUser(projectId, userId)` closes every socket that user
  holds in the room (code `4002`); registry cleanup and the resulting
  `presence:leave` flow through the existing socket-close path.
- Hub publisher handler: on a `project:members` event, broadcast it, then
  `closeUser` each id in `removedUserIds`.

### Board state (`src/components/Board.tsx`)

- Hold `ProjectInfo` in local state (`projectInfo`), initialized from the
  `project` prop, passed to `Toolbar`.
- Server-refreshed props are authoritative: when a re-render brings a new
  `project` prop (identity change after `router.refresh()`), `projectInfo`
  resets to it, using React's adjust-state-on-prop-change pattern
  (track the previous prop; if it changed during render, reset the state).
  This keeps the dialog correct even if the realtime event is delayed or
  the hub is down. Refreshed SSR data is fetched after the mutation, so
  overwriting a racing WS update with it is safe (same post-mutation data).
- WS handler: on `project:members`, if `user.id` is in `removedUserIds`,
  `window.location.assign("/projects")` (same as `project:deleted`);
  otherwise replace `projectInfo.members` with the event payload.
- Entity events untouched; `applyRealtimeEvent` unchanged.

### Current user email threading

`MemberDialog` needs the current user's email for self-leave. Extend the
Board `user` prop with `email` in `src/app/projects/[id]/page.tsx`
(`{ id, name, email }`) and pass it down through `Board → Toolbar → MemberDialog`.

### Toolbar (`src/components/Toolbar.tsx`)

- Delete the inline invite form block and its state (`email`, `shareError`,
  `inviting`, `invite`).
- Turn the member-count span into a button (Users icon + count) that opens
  the dialog; visible to all roles.
- Render `MemberDialog` when open.

### MemberDialog (`src/components/MemberDialog.tsx`, new)

- Structure mirrors `ActionBar`'s dialog: `.link-dialog-backdrop`
  (pointerdown on backdrop closes), `.link-dialog` panel with
  `role="dialog" aria-modal="true"`, head with title + X close.
- Owner row first: name, email, "Owner" badge. Then members in stored order;
  current user's row gets a "You" badge.
- Owner-only controls:
  - Invite form at the top of the dialog (email input + Invite button, busy
    spinner, inline `.link-dialog-error`); POSTs to the existing endpoint;
    on success clears the input and `router.refresh()`.
  - "Remove" on every member row except their own, with a two-step inline
    confirm (Remove → Confirm) before DELETE; errors inline;
    `router.refresh()` on success.
- Member-only control: "Leave" on their own row (two-step confirm), DELETE
  with their own email, then `window.location.assign("/projects")`; errors
  inline.
- Esc-to-close follows the existing dialog conventions (match `ActionBar`;
  if it doesn't handle Esc, don't add it here — consistency over features).

### CSS (`src/app/globals.css`)

- Reuse `.link-dialog*` classes; add only what the list needs (row layout,
  badges) as a small, clearly-commented block consistent with existing
  section comments.

### Tests

- **`tests/project-members.test.ts`** (new; `invitations.test.ts` pattern:
  mock `@/lib/auth`, seed Mongo, call route handlers directly):
  - POST as owner → 200 and a `project:members` frame captured via
    `setPublishTransportForTest`.
  - POST as non-owner → 403; unknown email → 404; duplicate → 409.
  - DELETE by owner → 200 + frame with `removedUserIds` containing the
    target; DELETE self by member → 200; DELETE other by member → 403;
    DELETE owner → 400.
- **`tests/realtime-rooms.test.ts`**: `closeUser` closes only that user's
  sockets and returns the count.
- **`tests/realtime-hub.test.ts`**: a `project:members` publish broadcasts
  to the room and kicks removed users' sockets (close code 4002) while
  others stay connected.
- **Publish transport test**: `broadcastMembers` emits the correct frame
  (extend the existing publish/transport test file).
- **UI render test** (`board-ui-render.test.ts` pattern):
  `renderToStaticMarkup` on Toolbar (trigger visible for member role,
  invite form gone) and MemberDialog (owner sees invite + remove; member
  sees Leave; badges render).

## What's left to the builder

- Exact confirm-step interaction details within the two-step inline pattern.
- Minor CSS naming/structure within the constraints above.
- Whether `closeUser` removes registry entries directly or relies solely on
  the socket close cleanup — pick whichever matches the hub's existing
  cleanup wiring and is testable.
