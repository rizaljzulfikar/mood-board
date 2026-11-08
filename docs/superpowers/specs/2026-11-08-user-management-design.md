# User management and password reset — Design

Date: 2026-11-08

## Intent and why

The invitation-only auth design explicitly listed "no user management beyond
inviting" as a non-goal. That leaves two gaps: the superadmin has no overview
of existing accounts, and a user who forgets their password is locked out
forever (no email infra, so no self-service reset). This adds a superadmin
user-management page with password reset.

## Goals

- `/users` page, superadmin-only: list all accounts (name, email, role,
  status), invite users, reset a user's password, delete a user.
- Password reset: admin generates a new temporary password, shown once, and
  the user must rotate it at next login (`mustChangePassword: true`) —
  reusing the existing temp-password flow end to end.
- Delete: user is pulled from all project member lists; projects they own
  transfer to the acting superadmin (non-destructive — nothing is orphaned,
  nothing is lost). The superadmin account itself cannot be deleted.

## Non-goals

- Self-service "forgot password" page on the login screen — impossible to
  verify identity without email infrastructure (stays a non-goal).
- Editing names/emails, role management (single superadmin invariant), or
  disabling accounts.
- Session invalidation on reset — consistent with the existing change-
  password flow; the next data API call already rejects must-change users.

## Approaches considered

1. **One management page, admin-issued temp passwords (chosen).** Reuses
   `generateTempPassword` / `mustChangePassword` / `/change-password`
   unchanged; one place where accounts are managed; the reset fits the same
   share-out-of-band flow as invitations.
2. **Separate reset-password page per user flow.** Rejected: same machinery,
   split across two surfaces.
3. **Cascade-delete owned projects with the user.** Rejected: silently
   destroys boards and images; transferring them to the superadmin is
   reversible (admin can delete the projects themselves).

## Decided how-it-works

- `requireSuperadmin()` added to `src/lib/api.ts`; used by the new routes and
  the existing `POST /api/invitations`.
- `POST /api/users/[id]/reset-password` — superadmin only; sets a new temp
  hash + `mustChangePassword`, returns `{ temporaryPassword }` once.
- `DELETE /api/users/[id]` — superadmin only; refuses the superadmin target;
  transfers owned projects to the actor (pulling the actor out of those
  members arrays in the same update — an owner must never also be a member),
  `$pull`s the target from all remaining memberships, deletes the user.
- Self-reset is rejected (route + hidden button): resetting your own password
  would bounce you to `/change-password` before the one-time temp password is
  shown — an unrecoverable lockout for the only superadmin.
- The list itself is fetched by the `/users` server component (no GET API);
  the client component renders it as derived data plus a local deletion set,
  so `router.refresh()` (new invites, reset status) updates the list live.
- Test-suite note: DB-backed test files share `moodboard-test` and clean it
  with `deleteMany({})`, so vitest runs files sequentially
  (`fileParallelism: false`) — parallel files raced each other's cleanups.
- `InviteUserForm` moves from `/projects` to `/users`; projects header gains
  a "Users" link for the superadmin only.
- Middleware protects `/users`.
- Status badge ("Temp password") rendered in red — a signal that the account
  is waiting on its first rotation.

## Left to the builder

- Exact row layout and copy (reuse project-card / invite-result styling).
