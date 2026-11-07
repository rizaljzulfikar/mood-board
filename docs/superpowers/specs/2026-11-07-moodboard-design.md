# MoodBoard — Collaborative Infinite-Canvas Moodboard Design

**Date:** 2026-11-07
**Status:** Approved by directive (user opted out of brainstorming questions: "Start now… do not stop to ask")

## Intent & Why

A self-hosted, multi-user moodboard web app in the spirit of PureRef: users create accounts, log in,
create projects, and arrange reference images on a shared infinite canvas by drag-and-drop or upload.
Images live on this machine in a MinIO container; application data lives on this machine in a MongoDB
container accessed with Mongoose.

## Goals

- Account flow: register → login → logout; sessions via httpOnly JWT cookie.
- Projects: user-owned; owner can invite collaborators by email; collaborators can view/edit.
- Infinite canvas: pan (drag empty space / middle-mouse), zoom-to-cursor (wheel, 0.1×–4×), drag images,
  resize (corner handle, proportional), delete, bring-to-front on select, zoom-to-fit.
- Image input: OS drag-and-drop onto the canvas (placed at drop point) and a toolbar upload button.
- Images stored in MinIO (private bucket), served only to project members through an authenticated
  Next.js proxy route.
- Collaboration: near-real-time sync — clients poll a lightweight sync endpoint (2 s) that returns
  changed items since last poll plus live presence (names, colors, cursors) of other members.
- Everything runs from one `docker compose up -d` + `npm install && npm run dev` on this machine.

## Non-Goals / Anti-Goals

- No real-time websocket transport (polling is deliberate: simple, robust, good enough locally).
- No comments, versioning, cropping, vector tools, public share links, OAuth providers, email flows.
- No cloud services — everything local containers.
- No UI framework dependency; hand-rolled dark PureRef-like styling with plain CSS.

## Constraints

- Node 22, Next.js 15 App Router, TypeScript strict, React 19.
- Ports must not clash with the machine's existing stacks: Mongo on **27030**, MinIO on **9100/9101**,
  app on **3000** (free).
- Dedicated containers/volumes prefixed `moodboard-*`; must not touch the existing mongo/minio stacks.
- Password hashing: bcryptjs (pure JS, no native build). JWT: `jose` (HS256, 7-day expiry).
- S3 client: `@aws-sdk/client-s3`. Image dimensions read server-side with `image-size`.
- Upload limits: images only (`image/*`), ≤ 20 MB.

## Approaches Considered

1. **NextAuth.js for auth** — rejected: adds provider/config surface for what is one credentials form.
2. **Realtime over WebSockets (custom server / SSE + change streams)** — rejected for v1: needs a
   custom Node server or Mongo replica set and connection lifecycle management; polling achieves
   visible collaboration with far less moving parts. SSE is the upgrade path.
3. **Presigned public image URLs** — rejected: private bucket + authenticated proxy route keeps
   membership enforcement server-side per request.
4. **Chosen: custom JWT-cookie auth + polling sync + authenticated storage proxy** (above).

## Data Model (Mongoose)

- `User { email (unique, lowercase), name, passwordHash, createdAt }`
- `Project { name, owner→User, members:[User], createdAt, updatedAt }` — membership = owner or in members.
- `Item { project→Project, objectKey (unique), originalName, mime, size, width, height,
   x, y, width, height, rotation, z, addedBy→User, deletedAt?, createdAt, updatedAt }`
  Soft-delete (`deletedAt`) so sync can communicate deletions to other clients.
- In-memory presence map keyed by session id, 10 s TTL (no persistence needed).

## API Surface

- `POST /api/auth/register | login | logout`, `GET /api/auth/me`
- `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/:id`,
  `POST /api/projects/:id/members`, `DELETE /api/projects/:id/members?email=`
- `GET /api/projects/:id/items` (initial), `POST /api/projects/:id/items` (multipart upload, x/y)
- `PATCH /api/items/:id` (move/resize/z), `DELETE /api/items/:id` (soft)
- `POST /api/projects/:id/sync { since, cursor } → { items, deletedIds, users }` (heartbeat + poll)
- `GET /api/storage/[...key]` → MinIO object stream, membership-checked, immutable cache headers

## Left to the Builder

Exact CSS look, copy, minor UX polish, code-level structure within the file map of the plan.
