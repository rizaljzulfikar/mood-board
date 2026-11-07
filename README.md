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

1. Register an account, log in.
2. Create a project from the projects page.
3. Drag & drop images onto the canvas (or use the upload button).
4. Pan (drag empty space / middle mouse), zoom (wheel), move, resize
   (corner handle), delete (Del).
5. Share: paste a teammate's email in the toolbar to invite them —
   their cursor and edits appear within ~2 seconds.

## Scripts

| Command         | What                       |
| --------------- | -------------------------- |
| `npm run dev`   | dev server on :3000        |
| `npm run build` | production build           |
| `npm start`     | serve production build     |
| `npm test`      | vitest unit tests          |
