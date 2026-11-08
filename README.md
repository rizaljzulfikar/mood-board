# MoodBoard

Multi-user moodboards on an infinite canvas — PureRef, but in the browser.
Images are stored in a local MinIO container, application data in a local
MongoDB container (via Mongoose).

## Stack

- Next.js 15 (App Router) + TypeScript + React 19
- MongoDB 7 (container, port **27030**) + Mongoose 8
- MinIO (containers, API **9100**, console **9101**) + AWS SDK v3
- Auth: bcryptjs + JWT (`jose`) in an httpOnly cookie
- Collaboration: 2 s polling sync (item deltas + live cursors)

## Quickstart

```bash
docker compose up -d        # mongo + minio + bucket init
npm install
npm run dev                 # http://localhost:3000
```

`.env.local` is already provided for the local stack (see
`.env.local.example` for the variable list).

## Flow

1. First run: open the app — you are redirected to `/setup` to create the
   **superadmin** account (only possible while no users exist).
2. Log in, create a project from the projects page.
3. Drag & drop images onto the canvas (or use the upload button).
4. Pan (drag empty space / middle mouse), zoom (wheel), move, resize
   (corner handle), delete (Del).
5. **Groups**: “+ Group” in the toolbar adds a labeled box — double-click it to
   rename. Images whose center is inside the box move with it. A selected
   group shows a → handle on its right edge: drag it onto another group to
   connect them (arrow). Click a connection to select it, Del to remove it,
   double-click to toggle arrow ↔ plain line.
6. Manage accounts (superadmin, on the `/users` page): see all users, invite
   teammates by name + email, **reset a password** (generates a new temporary
   password to share with them), or **delete** a user — projects they owned
   transfer to you, and they are removed from every project. MoodBoard creates
   accounts with a generated **temporary password**; share it with them; they
   must set their own password at first login. There is no registration page —
   accounts are invite-only.
7. Share a project: paste a teammate's email in the toolbar to add them —
   their cursor and edits appear within ~2 seconds.

## Scripts

| Command         | What                       |
| --------------- | -------------------------- |
| `npm run dev`   | dev server on :3000        |
| `npm run build` | production build           |
| `npm start`     | serve production build     |
| `npm test`      | vitest unit tests          |

## Notes

- All API JSON uses `id` for document identifiers (not Mongo's `_id`).
- Items are soft-deleted so other clients learn about removals on their next
  2-second sync; project deletion hard-deletes items and their MinIO objects.
- Sessions are cookie-based (`mb_token`, httpOnly, SameSite=Lax). The app is
  designed for local/plain-HTTP self-hosting; `secure: false` is deliberate.
- Accounts are invite-only. The superadmin is created through `/setup` while
  no users exist; every other account is created via the superadmin
  user-management page (`/users`) with a temporary password that must be
  rotated at first login (data APIs reject the user until they do). The same
  page resets forgotten passwords and deletes accounts; the superadmin
  account itself can be neither deleted nor have its password reset there.
- Existing installs from before invitations: promote one account manually,
  e.g.
  `docker compose exec mongo mongosh moodboard --eval 'db.users.updateOne({ email: "you@example.com" }, { $set: { role: "superadmin" } })'`

