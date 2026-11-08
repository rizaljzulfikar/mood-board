# Invitation-only auth with superadmin setup — Design

Date: 2026-11-08

## Intent and why

Open registration (`/register` + `POST /api/auth/register`) lets anyone with
network access to this self-hosted app create an account. The owner wants a
closed system: the very first run creates a **superadmin** through a one-time
setup page, and afterwards only the superadmin can create accounts, by
**invitation**, issuing a server-generated **temporary password**. Invited
users must change that password at first login before they can use the app.

## Goals

- Remove the register page and registration API entirely.
- First-run setup: when zero users exist, `/setup` creates the superadmin
  (role `superadmin`) and signs them in.
- Invitations: superadmin enters a person's name + email; the server creates
  the user with a random temporary password and `mustChangePassword: true`,
  and shows the temp password to the admin exactly once (no email infra in
  this app — the admin shares it out-of-band).
- Forced password update: invited users who log in with a temp password are
  redirected to `/change-password`; data APIs reject them until they change
  it.

## Non-goals

- No email delivery (none exists in the stack).
- No invitation-token links / accept-invite pages.
- No user management beyond inviting (no delete/disable user UI).
- No change to the existing project-member invite flow (it already requires
  the invited person to have an account — with invitation-only accounts the
  superadmin first invites them as a user, then the project owner adds them
  to the project).

## Anti-goals

- Do not weaken setup: `POST /api/auth/setup` must only work when **zero**
  users exist, so an instance with existing accounts can never be hijacked
  through the setup page.

## Constraints

- Local, plain-HTTP self-hosted app (cookie `secure: false` stays).
- Same stack: Next.js App Router, Mongoose, bcryptjs + JWT cookie sessions.
- Existing DBs: schema defaults (`role: "user"`, `mustChangePassword: false`)
  apply to old documents. Promoting an existing account to superadmin is a
  manual one-line mongo operation, documented in the README. Setup itself
  only ever runs on an empty users collection, which is safe.

## Approaches considered

1. **Server-generated temp password, shown once to the admin (chosen).**
   Matches the requested flow exactly; needs no email infra; the admin shares
   the password out-of-band; `mustChangePassword` forces the update on first
   login.
2. **Invitation token links.** Admin sends (or hands over) a URL with a
   one-time token; the user sets their own password. Rejected: requires a
   token model with expiry, an accept-invite page, and still needs manual
   link sharing since there is no mailer — more machinery for the same
   out-of-band step.
3. **Admin chooses the user's password.** Rejected: the admin would know the
   user's password, which is a worse practice than a generated temp secret the
   user must rotate.

## Decided how-it-works

- `User` model gains `role: "superadmin" | "user"` (default `user`) and
  `mustChangePassword` (default `false`).
- `SessionUser` gains `role` and `mustChangePassword`; `requireUser()` returns
  `403 Password change required` for users with `mustChangePassword`, so all
  data APIs (projects, sync, items, storage) are closed until rotation.
- `generateTempPassword()` in `src/lib/session.ts`: pure generator,
  ~16 chars from an unambiguous alphabet, via `crypto.randomInt`.
- Routes: `POST /api/auth/setup`, `POST /api/invitations` (superadmin only),
  `POST /api/auth/change-password` (verifies current password, sets new hash,
  clears `mustChangePassword`).
- Pages: `/setup`, `/change-password`; login flow redirects must-change users
  there; `/` and `/login` redirect to `/setup` when no users exist.
- Middleware: `/register` removed; `/setup` treated like other auth pages;
  `/change-password` protected (session required).

## Left to the builder

- Exact UI copy and placement of the superadmin invite card on the projects
  page (reuse existing auth-card / form styles).
- Test placement: unit tests for `generateTempPassword` in `tests/`.
