# Invitation-only auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove open registration; first run creates a superadmin via `/setup`; superadmin invites users with a server-generated temp password; invited users must change it before using the app.

**Architecture:** Extend the `User` model with `role` and `mustChangePassword`. Gate all data APIs through `requireUser()`, which rejects must-change users. New routes: `/api/auth/setup`, `/api/invitations`, `/api/auth/change-password`. New pages: `/setup`, `/change-password`; registration page/API deleted.

**Tech Stack:** Next.js 15 App Router, Mongoose, bcryptjs + jose JWT cookie sessions, vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-invitation-only-auth-design.md`

## Global Constraints

- Setup endpoint must only create a superadmin when **zero** users exist (409 otherwise).
- New passwords: minimum 8 characters (existing rule).
- Temp passwords: generated server-side, ~16 chars, unambiguous alphabet, shown to the admin exactly once.
- Cookie/session behavior unchanged (`mb_token`, httpOnly, `secure: false`).
- All API JSON uses `id` (not `_id`).
- Never run the full test suite; run targeted vitest files only (global AGENTS.md rule).

## Review Focus

- Setup race/hijack: two concurrent setups, or setup on an instance that already has users → only one superadmin, second request 409. (Pinned by Task 3 route logic; unique email index maps 11000 → 409 via `apiError`.)
- Must-change user bypassing the UI with direct API calls (projects/sync/items/storage) → 403 "Password change required". (Pinned by Task 2 `requireUser` guard.)
- Non-superadmin calling invitations → 403; duplicate email invite → 409. (Task 4.)
- Temp password charset/length/uniqueness. (Task 1 tests.)
- `/register` fully gone: no page, no API, no middleware reference, no links. (Task 6 grep check.)

---

### Task 1: `generateTempPassword()` (TDD)

**Files:**
- Modify: `src/lib/session.ts`
- Test: `tests/temp-password.test.ts`

**Interfaces:**
- Produces: `generateTempPassword(): string` — 16 chars from `abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `l I L O 0 1`), using `crypto.randomInt`.

- [ ] **Step 1: Write failing test** — `tests/temp-password.test.ts`: asserts length 16, every char in the alphabet, and that two calls differ (retry 10 times before failing to avoid flake).
- [ ] **Step 2: Run** `npx vitest run tests/temp-password.test.ts` → FAIL (export missing).
- [ ] **Step 3: Implement** in `src/lib/session.ts` with `randomInt` over the alphabet.
- [ ] **Step 4: Run again** → PASS. Commit: `feat: generateTempPassword for invitation flow`.

### Task 2: User model fields, SessionUser, requireUser guard

**Files:**
- Modify: `src/lib/models/User.ts`, `src/lib/auth.ts`, `src/lib/api.ts`

**Interfaces:**
- Produces: `UserDoc.role: "superadmin" | "user"` (default `"user"`), `UserDoc.mustChangePassword: boolean` (default `false`).
- Produces: `SessionUser = { id, email, name, role, mustChangePassword }`; `getCurrentUser()` fills the new fields.
- Produces: `requireUser()` throws `ApiError(403, "Password change required")` when `mustChangePassword` (callers needing to bypass — change-password route — use `getCurrentUser()` directly).

- [ ] **Step 1: Add schema fields with defaults; extend `SessionUser` and `getCurrentUser`; add the guard in `requireUser`.**
- [ ] **Step 2: Run** `npx vitest run tests/auth.test.ts` and `npm run typecheck` → PASS (guard has no test; DB-coupled, verified in Task 3/5 flows).
- [ ] **Step 3: Commit:** `feat: user roles + mustChangePassword flag, API guard`.

### Task 3: Setup flow (`/setup` + `POST /api/auth/setup`)

**Files:**
- Create: `src/app/api/auth/setup/route.ts`, `src/app/setup/page.tsx`, `src/components/SetupForm.tsx`
- Modify: `src/app/page.tsx`, `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `hashPassword`, `startSession`, `User`, `getCurrentUser`.
- Produces: `POST /api/auth/setup` `{ name, email, password }` → 201 `{ user }` (superadmin, session started); 409 `"Setup already completed"` if any user exists; 400 validation errors. `SetupForm` posts and redirects to `/projects`.

- [ ] **Step 1: Route** — same validation as the old register route (`EMAIL_RE`, name required, password ≥ 8); `User.exists({})` check before create; create with `role: "superadmin"`.
- [ ] **Step 2: SetupForm** (client) — name, email, password, confirm password (client-checked match), posts to `/api/auth/setup`, success → `router.push("/projects"); router.refresh()`.
- [ ] **Step 3: `/setup` page** — `force-dynamic`; if `getCurrentUser()` → redirect `/projects`; if `await User.exists({})` → redirect `/login`; renders `SetupForm` in `auth-page`/`auth-card` styles.
- [ ] **Step 4: `/` and `/login`** — when `!(await User.exists({}))` redirect `/setup` (before the logged-in check).
- [ ] **Step 5:** `npm run typecheck` → PASS. Commit: `feat: first-run superadmin setup`.

### Task 4: Invitations (`POST /api/invitations` + superadmin invite card)

**Files:**
- Create: `src/app/api/invitations/route.ts`, `src/components/InviteUserForm.tsx`
- Modify: `src/app/projects/page.tsx`

**Interfaces:**
- Consumes: `generateTempPassword`, `hashPassword`, `requireUser`, `SessionUser.role`.
- Produces: `POST /api/invitations` `{ name, email }` → 201 `{ user: { id, email, name }, temporaryPassword }` (user created with `role: "user"`, `mustChangePassword: true`); 403 non-superadmin; 409 email exists. `InviteUserForm` shows the temp password once, prominently, with a "share it now" hint.

- [ ] **Step 1: Route** — requireUser → role check 403 `"Only the superadmin can invite users"`; validation as Task 3; duplicate → 409 `"An account with this email already exists"`; create + return temp password in response.
- [ ] **Step 2: InviteUserForm** (client) — name + email inputs; on success displays `temporaryPassword` in a highlighted box (state, not a link — refresh clears it); invite another → clears it.
- [ ] **Step 3: Projects page** — pass `role` through; render `InviteUserForm` under the create-project form when `user.role === "superadmin"`.
- [ ] **Step 4:** `npm run typecheck` → PASS. Commit: `feat: superadmin invites users with generated temp password`.

### Task 5: Forced password change (`/change-password` + API, login redirect)

**Files:**
- Create: `src/app/api/auth/change-password/route.ts`, `src/app/change-password/page.tsx`, `src/components/ChangePasswordForm.tsx`
- Modify: `src/app/api/auth/login/route.ts`, `src/components/AuthForm.tsx`, `src/app/projects/page.tsx`, `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (bypasses the requireUser guard), `verifyPassword`, `hashPassword`.
- Produces: login response gains `mustChangePassword: boolean`; `POST /api/auth/change-password` `{ currentPassword, newPassword }` → 200 `ok`, clears `mustChangePassword`; wrong current → 400 `"Current password is incorrect"`; new < 8 → 400. `AuthForm` (login) redirects to `/change-password` when the flag is set.

- [ ] **Step 1: Login route** — add `mustChangePassword: user.mustChangePassword` to the JSON response (session still starts).
- [ ] **Step 2: AuthForm** — on login success, `data.mustChangePassword ? router.push("/change-password") : router.push("/projects")`.
- [ ] **Step 3: ChangePasswordForm** (client) — current (temporary) password, new password ≥ 8, confirm; posts; success → `router.push("/projects"); router.refresh()`.
- [ ] **Step 4: `/change-password` page** — `force-dynamic`; no session → `/login`; `!mustChangePassword` → `/projects`; renders form in auth-card style.
- [ ] **Step 5: Change-password route** — `getCurrentUser()` → 401; load `User.findById`; verify current; validate new; `$set` hash + `mustChangePassword: false`.
- [ ] **Step 6: Pages** — projects pages redirect to `/change-password` when `user.mustChangePassword` (right after the `!user` check).
- [ ] **Step 7:** `npm run typecheck` → PASS. Commit: `feat: forced temp-password rotation on first login`.

### Task 6: Remove registration, middleware, README

**Files:**
- Delete: `src/app/register/page.tsx`, `src/app/api/auth/register/route.ts`
- Modify: `src/middleware.ts`, `src/components/AuthForm.tsx` (drop `mode` prop / register branch / `/register` link), `src/app/login/page.tsx` (update usage), `README.md` (Flow: setup → login; superadmin invites with temp password; manual superadmin promotion note for existing DBs; invited users must rotate at first login)

**Interfaces:**
- Produces: middleware `AUTH_PAGES = /^\/(login|setup)$/`, `PROTECTED` includes `/change-password`, matcher `["/projects/:path*", "/login", "/setup", "/change-password"]`; `AuthForm` takes no props.

- [ ] **Step 1: Delete register page + API.**
- [ ] **Step 2: Middleware + AuthForm + login page** as specified.
- [ ] **Step 3: Grep** `grep -rn "register" src/` → no matches outside unrelated words (e.g. none expected).
- [ ] **Step 4: README** Flow + Notes updates.
- [ ] **Step 5: Verify** `npm run typecheck` PASS; `npx vitest run tests/auth.test.ts tests/temp-password.test.ts` PASS. Commit: `feat: invitation-only auth — remove open registration`.
