# `lib/auth-middleware.ts` — the authentication gate on every API route

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/auth-middleware.ts` and `admin_athena/lib/auth-middleware.ts`) —
> **the two copies have diverged on purpose; see the Both-apps note.** · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.1 / §B.1](../01-file-catalog.md) · Hotspot: [03 §1 row 3](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Turns a Bearer token in the `Authorization` header into an authenticated user — or a
401/403 response. Nearly every API route in both apps calls one of these helpers first,
so this file *is* the platform's authentication and (in Admin) authorization boundary.
It also feeds the REQ-02 session audit trail on every request and, in Fab only, enforces
the 30-minute idle timeout.

## Depends on / consumed by

**Depends on:**
- *Fab:* `storage.getSessionByToken` (session + user lookup), `session-audit.ts`
  (`checkAndRecordActivity`, `recordExpired`), `errors/faborch-errors.ts` +
  `errors/api-error-handler.ts` (canonical 401 envelope), `logger.ts`.
- *Admin:* Prisma directly (`session.findUnique`, `user.findUnique`), `session-audit.ts`
  (`recordActivityWithoutEviction`, `recordExpired`), same error/logger modules.

**Consumed by** (verified by import grep at the pinned commit): ~28 Fab files and ~24
Admin files — effectively every `app/api/**/route.ts` except the public auth endpoints
(login, password-reset request/confirm), plus `lib/cmf/session.ts` (Fab).

## Function-by-function

### `validateSession(req): Promise<AuthResult>` — both apps

The core check, in order:
1. **Header shape:** requires `Authorization: Bearer <token>`; rejects missing/malformed
   headers with 401.
2. **Token shape:** rejects tokens shorter than **32 characters**. (Real tokens are
   64-char hex from [`generateToken`](./encryption.md) — but *any* ≥32-char string
   proceeds to lookup; there is no format/entropy check.)
3. **Session lookup:** Fab via `getSessionByToken` (returns session + user), Admin via
   `prisma.session.findUnique({ include: { user } })`. Unknown token → 401.
4. **Absolute expiry:** `session.expiresAt < now` → 401. The expiry is also recorded to
   the audit log fire-and-forget (`recordExpired(...).catch(log)`), so an audit-write
   failure cannot block the response.
5. **Activity recording — where the apps diverge:**
   - *Fab:* `checkAndRecordActivity` **atomically** bumps `last_activity_at`, records
     idle episodes (gap > 60 s), lazy-creates an ACTIVE audit row for valid tokens that
     lack one, and returns `'evicted'` if the gap exceeded **30 minutes**. On eviction,
     Fab **deletes the live session row** (dynamic import of `storage.deleteSession`) and
     returns 401 "Your session has expired." The activity call is awaited; if it throws,
     the error is logged and treated as `not_found` — **authentication still succeeds**.
   - *Admin:* `recordActivityWithoutEviction` — records the same audit trail but **never
     evicts**; the call is fire-and-forget (not awaited). An in-code comment documents
     the intent: admins running long operations must not be kicked out; only the 30-day
     absolute expiry ends an admin session involuntarily.
6. Any unexpected exception → `console.error` + generic 500 result.

Returns `{ authenticated, user?, error?, status? }`; the Admin variant also returns
`sessionId`.

### `requireAuth(req): Promise<{ user } | NextResponse>` — both apps

Wrapper most routes use. On any 401 from `validateSession` it responds with the canonical
REQ-01 error envelope via `FabOrchError.sessionTimeout` + `handleApiError` — i.e. **every
401 reason (missing header, malformed token, unknown session, idle-evicted) is reported
to the client as `SESSION_TIMEOUT`**. Non-401 failures pass through as plain JSON errors.

The Fab copy then adds two checks the Admin copy does not have:
- **Suspend/delete check:** reads `user.status` via an `as User & { status?: string }`
  cast; `SUSPENDED`/`DELETED` → 403 "Account is no longer active."
- **Forced password change:** reads `forcePasswordChange` via the same cast pattern; if
  set and the path is not `/change-password` or `/logout`, returns 403 with
  `code: 'FORCE_PASSWORD_CHANGE'` and `redirectTo: '/force-password-change'`.

Both flags are *written* by the Admin app — this is the cross-app suspend/force-reset
mechanism working through the shared DB.

### `requireAdmin(req): Promise<AdminAuthContext | NextResponse>` — Admin only

The admin authorization gate: `validateSession` → `user.isAdmin` or 403 → `user.status !== 'ACTIVE'`
→ 403 → re-fetches the user with `role` included (404 if gone) → returns
`{ user: userWithRole }`. Note the admin **chat tools** (`admin-tools.ts`) do *not*
re-check admin status themselves — they trust that `/api/admin/chat` called `requireAdmin`
(see [03 §2](../03-review-hotspots.md#2-security--authorization)).

### `withAuth(handler)` — Fab only

Higher-order wrapper: runs `validateSession`, 401s on failure, otherwise calls
`handler(req, user)`. Plain-JSON errors (no FabOrch envelope) — an older pattern than
`requireAuth`. Note it also skips `requireAuth`'s status/forcePasswordChange checks, so
routes using `withAuth` don't enforce suspend/force-reset.

### `getUserFromRequest(req): Promise<User | null>` — Fab only

Optional-auth helper: user or `null`, never an error response.

### Small helpers

`unauthorizedResponse(msg?)` / `forbiddenResponse(msg?)` (both apps) — canned 401/403
JSON responses. `getIpAddress(req)` (Admin only) — first `x-forwarded-for` entry, falling
back to `x-real-ip`, else `null`.

## Failure modes & gotchas

- **Schema-drift blind spot (Fab):** `status` and `forcePasswordChange` are read through
  `as`-casts because Fab's generated Prisma types may predate the columns (they're owned
  by Admin's schema). If a column is renamed or dropped, the casts make the checks
  **silently evaluate to `undefined`** — suspend/force-reset simply stops working, with
  no error anywhere. (Admin's copy reads `status`/`isAdmin` as typed fields, so the same
  drift would at least be a compile error there.)
- **Audit failure fails open (Fab):** if `checkAndRecordActivity` throws, the request is
  still authenticated (logged, treated as `not_found`). Availability-over-audit is likely
  intentional, but it means idle eviction silently stops working if the audit table has
  problems.
- **All 401s are reported as `SESSION_TIMEOUT`** — including "you never sent a token."
  Clients can't distinguish a timed-out session from a malformed request; fine for the UI
  banner, confusing when debugging API calls.
- **Token acceptance is minimal:** any ≥32-char string is looked up; no rotation, and a
  30-day absolute lifetime (set at login, not here).
- **Two wrapper generations coexist (Fab):** `withAuth` (plain errors, **no
  status/force-password checks**) vs `requireAuth` (canonical envelope, full checks).
  Which routes use which determines whether a suspended user is actually locked out of
  that route.

## Open questions for the code owner

1. Can the `as`-cast reads of `status`/`forcePasswordChange` be replaced with typed
   fields (regenerate Fab's Prisma client from the shared schema) so drift becomes a
   compile error? (Hotspot row 3's core question.)
2. Is "audit failure ⇒ authenticate anyway" the intended trade-off in Fab's
   `validateSession`?
3. Is the ≥32-char/30-day/no-rotation token policy the intended session policy
   ([03 §2](../03-review-hotspots.md#2-security--authorization))?
4. Which Fab routes still use `withAuth`, and is it acceptable that those routes skip the
   suspend/force-password checks?
5. Confirm every `/api/admin/*` route wraps `requireAdmin` (the chat tools assume it).

## Both-apps note

Deliberately diverged — same skeleton, three real differences:

| Aspect | Fab (`claudeai_athena`) | Admin (`admin_athena`) |
|---|---|---|
| Idle eviction | Yes — 30 min gap → audit row closed + **session deleted** | **Never** — activity recorded, no eviction (commented intent) |
| Activity call | Awaited; failure logged, auth continues | Fire-and-forget |
| Extra checks | `status` + `forcePasswordChange` (via casts) in `requireAuth` | `isAdmin` + `status === 'ACTIVE'` (typed) in `requireAdmin` |
| Extras | `withAuth`, `getUserFromRequest` | `requireAdmin`, `getIpAddress`, returns `sessionId` |
