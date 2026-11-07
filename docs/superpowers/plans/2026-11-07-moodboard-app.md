# MoodBoard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js 15 + TypeScript multi-user moodboard (PureRef-like): accounts, projects, infinite canvas, images in local MinIO, data in local MongoDB via Mongoose.

**Architecture:** App Router app with custom JWT-cookie auth; Mongoose models User/Project/Item; private MinIO bucket served through a membership-checked proxy route; clients poll `/sync` for near-real-time collaboration (items delta + presence cursors).

**Tech Stack:** Next 15, React 19, TS strict, Mongoose 8, bcryptjs 3, jose, @aws-sdk/client-s3, image-size, vitest, Docker Compose (mongo:7 @27030, minio @9100/9101, mc bucket init).

**Spec:** `docs/superpowers/specs/2026-11-07-moodboard-design.md`

## Global Constraints

- Ports: Mongo `27030`, MinIO API `9100`, MinIO console `9101`, app `3000`. Never touch existing stacks on 27017/9000.
- Uploads: mime `image/*` only, ≤ 20 MB, bucket `moodboard`, object key `"{projectId}/{itemId}.{ext}"`.
- Session cookie: name `mb_token`, httpOnly, sameSite `lax`, path `/`, 7 days, HS256 `JWT_SECRET`.
- All API routes `runtime = 'nodejs'`; membership (owner ∪ members) required for project data; 401 unauthenticated, 403 non-member, 404 missing.
- Sync poll interval 2000 ms client-side; presence TTL 10 s in memory.

## Review Focus

1. Non-member/unauthenticated access to project data, items, and storage proxy → expect 401/403, zero bytes leaked. (Pinned: Task 5 curl negatives.)
2. Upload of non-image / oversize file → expect 415/413, nothing written to MinIO. (Pinned: Task 5.)
3. Concurrent multi-user edits — remote item updates must not clobber a locally-dragged item. (Pinned: Task 6 `mergeRemoteItems` unit test.)
4. Deleted-by-another-user items must disappear locally. (Pinned: Task 6 `mergeRemoteItems` unit test.)
5. Move/resize math under zoom — world coordinates vs screen coordinates conversion. (Pinned: Task 7 `toWorld` unit test.)

---

### Task 1: Scaffold + Docker stack

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `docker-compose.yml`, `.env.local`, `.env.local.example`, `.gitignore`, `README.md`.
**Interfaces:** Produces runnable `npm run dev/build/start`, `npm test`; `docker compose up -d` gives Mongo @27030 + MinIO @9100 with bucket `moodboard`.

- [ ] Scaffold files; deps: next@15 react@19 react-dom@19 mongoose@8 bcryptjs@3 jose @aws-sdk/client-s3 image-size; dev: typescript @types/* vitest.
- [ ] `docker compose up -d`; `docker compose ps` shows mongo healthy, mc init exited 0, minio healthy.
- [ ] `npm install`; `npm run build` passes with placeholder page; commit.

### Task 2: Lib + models + unit tests (TDD)

**Files:** Create `src/lib/db.ts`, `src/lib/auth.ts` (pure: `hashPassword`, `verifyPassword`, `signSessionToken`, `verifySessionToken`; cookie helpers `setSessionCookie/clearSessionCookie/getSessionUser` via next/headers), `src/lib/minio.ts` (`getS3`, `ensureBucket`, `putObjectBuffer`, `getObjectStream`), `src/lib/models/User.ts`, `Project.ts`, `Item.ts`, `src/lib/api.ts` (`json`, `requireUser`, `requireMember(projectId)`), `src/lib/storage-key.ts` (`buildObjectKey`, `parseStorageKey`), `tests/auth.test.ts`, `tests/storage-key.test.ts`.
**Interfaces:** `verifySessionToken(token): {sub} | null`; `requireUser(): {user}` throws `ApiError(401)`; `requireMember(projectId): {user, project}` throws 401/403/404.

- [ ] Write failing tests: password round-trip + wrong-password reject; token round-trip + garbage-token reject; key build/parse valid + rejects traversal (`..`, extra segments).
- [ ] `npx vitest run tests/auth.test.ts tests/storage-key.test.ts` → fail; implement; → pass. Commit.

### Task 3: Auth routes + pages + middleware

**Files:** Create `src/app/api/auth/{register,login,logout,me}/route.ts`, `src/app/{login,register}/page.tsx` (+ shared `AuthForm` inline), `src/middleware.ts`, update `src/app/page.tsx` (landing: redirect `/projects` if session else `/login`).
**Interfaces:** register `{email,name,password}` → 201 `{user}`; login → sets `mb_token`; me → `{user}`; logout → clears cookie. Validation: email format, password ≥ 8, unique email (409).

- [ ] Implement; `npm run build`; `npm start` background; curl: register 201, dup 409, weak pw 400, login sets cookie, me returns user, logout clears, me unauth → 401. Commit.

### Task 4: Projects API + projects page

**Files:** Create `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/members/route.ts`, `src/app/projects/page.tsx` (+ `CreateProjectForm` client comp).
**Interfaces:** `GET /api/projects` → `{projects:[{_id,name,role,memberCount,updatedAt}]}` (owned ∪ member); `POST {name}` → 201; `POST /:id/members {email}` → 200 `{project}` (owner only); member must exist (404), not duplicate (409). Server page redirects to `/login` if unauthenticated.

- [ ] Implement; curl: create, list shows role owner, second user sees shared project after add, non-owner add-member → 403. Commit.

### Task 5: Items API + storage proxy

**Files:** Create `src/app/api/projects/[id]/items/route.ts` (GET initial, POST upload multipart: `file`, optional `x`,`y`), `src/app/api/items/[id]/route.ts` (PATCH `{x?,y?,width?,height?,rotation?,z?}`, DELETE soft), `src/app/api/storage/[...key]/route.ts`.
**Interfaces:** item JSON `{_id,objectKey,originalName,mime,size,width,height,x,y,rotation,z,addedBy,createdAt,updatedAt}`. Upload centers image on (x,y), `z = maxZ+1`; returns item. Storage route: membership check → stream `Content-Type: mime`, `Cache-Control: public, max-age=31536000, immutable`.

- [ ] Implement; curl E2E with a generated PNG: upload → item JSON sane (w/h>0, z=1); GET storage bytes `cmp`-identical; PATCH moves; DELETE soft-deletes; negatives: unauth 401, non-member 403, `.txt` 415, >20MB 413, storage key of other project 403. Commit.

### Task 6: Sync + presence

**Files:** Create `src/lib/presence.ts` (in-memory Map, `heartbeat(projectId,userId,{name,cursor})`, `listActive(projectId)`, TTL 10s), `src/app/api/projects/[id]/sync/route.ts` (POST `{since?,cursor?}` → `{items, deletedIds, users, now}`), `src/lib/merge.ts` (pure `mergeRemoteItems(local, incoming, deletedIds, lockedIds)`), `tests/merge.test.ts`.
**Interfaces:** `mergeRemoteItems` replaces/updates non-locked items, adds new, removes deleted, leaves `lockedIds` (locally dragged) untouched. Colors derived from user id hash.

- [ ] Failing test: incoming update ignored for locked id, applied for unlocked; new added; deleted removed; → implement → pass. Curl: poll with `since` returns only changed items; users list shows heartbeat. Commit.

### Task 7: Canvas UI

**Files:** Create `src/components/Board.tsx`, `src/components/BoardItem.tsx`, `src/components/Toolbar.tsx`, `src/lib/viewport.ts` (pure `toWorld`, `zoomAt`), `tests/viewport.test.ts`, `src/app/projects/[id]/page.tsx`, `ShareForm` in Toolbar, update `globals.css`.
**Interfaces:** `toWorld(screen, viewport) => {x,y}`; `zoomAt(viewport, wheelAt, factor, min, max) => viewport`. Board: wheel zoom-to-cursor; background/middle drag pan; item pointer-drag move (patch on pointerup, z-bump); corner-handle proportional resize; Delete key; drop files → POST items at drop point; poll sync 2 s; presence cursors + name tags; toolbar: upload (input[multiple]), zoom out/in/fit/%, share (add member by email), logout.

- [ ] Failing viewport tests (zoom clamps, stays anchored at cursor point) → implement → pass; `npm run build` passes; project page HTML renders with `data-board` mount. Commit.

### Task 8: Full E2E verification + review

- [ ] Fresh `docker compose down -v && up -d`; `npm run build && npm start`; scripted curl of the whole user flow: register A, register B, A login, create project, upload 2 images at positions, B login, A adds B, B lists items, B PATCH item, A sync-poll sees B's move + B's cursor, B fetch image bytes, logout; all negatives from Review Focus re-run.
- [ ] README quickstart matches reality. Final commit. Dispatch review subagent (`openai/gpt-5.6-terra`), fix findings.
