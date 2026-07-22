# `lib/services/admin-user-service.ts` — the shared user-management core (Admin)

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Admin** (`admin_athena/lib/services/admin-user-service.ts`) · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 21](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The single business-logic module behind every administrative change to a `User`: list,
create, suspend/activate, change role, rename, promote/demote admin, soft-delete, force a
password reset, and force logout. Each mutating function performs its DB write **and**
writes the matching `audit_logs` row **inside one Prisma transaction**, so a change can
never commit without recording who made it. Because both the REST routes under
`/api/admin/users/*` and the Admin AI chat tools ([`./admin-tools.md`](./admin-tools.md))
call these same functions, this file — not the routes — is where the actual guards and
side effects live. It is Admin's equivalent of Fab's storage layer (see the Both-apps note).

## Depends on / consumed by

**Depends on:**
- `@/lib/db` — the shared Prisma client (`prisma`), and `prisma.$transaction`.
- `@/lib/encryption` — `hashPassword` (new-user password) and, via dynamic `import`,
  `generateToken` for the reset-token (see [`./encryption.md`](./encryption.md)).
- `./audit-service` — `recordAuditLog(tx, entry)`, which does `tx.auditLog.create(...)`
  into the `audit_logs` table.
- `../session-audit` — dynamically imported `closeAllUserSessions` (raw SQL) in
  `forceLogoutUser` (see [`./session-audit.md`](./session-audit.md)).
- `@/lib/email/smtp` (`sendSmtpEmail`) + `@/lib/email/password-reset-template`
  (`buildPasswordResetEmailHtml`) — dynamically imported inside `forcePasswordReset`
  (see [`./email.md`](./email.md)).
- Env: `ATHENA_URL` (reset-link base; falls back to a hardcoded CloudFront URL).
- Tables written: `users`, `sessions`, `password_reset_tokens`, `audit_logs`, plus
  `user_session_logs` (indirectly, via `closeAllUserSessions`).

**Consumed by** (verified by import grep at the pinned commit):
- REST routes:
  - `app/api/admin/users/route.ts` → `listUsers`, `createUser`
  - `app/api/admin/users/[id]/route.ts` → `updateUserStatus`, `changeUserRole`,
    `updateUserName`, `toggleUserAdmin`, `deleteUser`
  - `app/api/admin/users/[id]/force-reset/route.ts` → `forcePasswordReset`
  - `app/api/admin/users/[id]/force-logout/route.ts` → `forceLogoutUser`
- Admin AI chat tools: `lib/admin-tools.ts` → `listUsers`, `updateUserStatus`,
  `changeUserRole`, `forcePasswordReset`, `deleteUser` (**note:** it does **not** import
  `forceLogoutUser`, `createUser`, `updateUserName`, or `toggleUserAdmin` — see Failure
  modes).

Every route above wraps `requireAdmin` first ([`./auth-middleware.md`](./auth-middleware.md));
the chat tools trust that `/api/admin/chat` already did. Neither the routes nor this
service re-check admin identity per call.

## Function-by-function

Function names differ slightly from the task's role labels: role assignment is
`changeUserRole` (not `assignRole`); there is no combined "status/role" export — status is
`updateUserStatus`, admin flag is `toggleUserAdmin`.

### `listUsers(params): Promise<{ users, total, page, pageSize, totalPages }>`

Read-only. Builds a Prisma `where` from optional `search` (case-insensitive `contains`
across `name` + `email`), `roleId`, and `status`. **Default filter:** when no `status` is
given it excludes `DELETED` users (`status: { not: 'DELETED' }`); passing an explicit
`status` overrides that, so a caller *can* list soft-deleted users. Runs `findMany` +
`count` in `Promise.all`, paginates (default `pageSize` 50), and maps to a projected DTO.
No writes, no audit row, no email. `where` is typed `any` (lint-suppressed).

### `createUser(data): Promise<{ id, email, name, status, role, createdAt }>`

Hashes `data.password` via `hashPassword` **before** opening the transaction, then in one
`$transaction`: `user.create` (`status: 'ACTIVE'`, `roleId` or `null`) → `recordAuditLog`
(`user.created`, metadata `{ email, name, roleId }`). **No email is sent here** — direct
creation does not notify the user; account-invite emails are the separate
[`./invitation-service.md`](./invitation-service.md) path. No uniqueness/last-admin logic;
a duplicate email surfaces as a Prisma error that the route turns into a 400/500.

### `updateUserStatus(userId, status: 'ACTIVE' | 'SUSPENDED', adminUserId, ipAddress)`

One `$transaction`: `user.update({ data: { status } })` → **if suspending**,
`session.deleteMany({ where: { userId } })` (kills all live sessions, so the user is
logged out of **both apps** on their next request) → `recordAuditLog`
(`user.suspended` / `user.activated`). No guard against suspending the last admin or
oneself. Activating does not touch sessions.

### `changeUserRole(userId, roleId, adminUserId, ipAddress)`

One `$transaction`: `user.update({ data: { roleId } })` (role included in result) →
`recordAuditLog` (`user.role_changed`, metadata `{ email, newRoleId, newRoleName }`).
No validation that `roleId` exists (relies on the FK); no last-admin logic — role changes
are independent of the `isAdmin` boolean.

### `updateUserName(userId, name, adminUserId, ipAddress)`

One `$transaction`: `user.update({ data: { name } })` → `recordAuditLog`
(`user.name_updated`, metadata `{ email, newName }`). Cosmetic; no sessions/email.

### `toggleUserAdmin(userId, isAdmin, adminUserId, ipAddress)`

One `$transaction`: `user.update({ data: { isAdmin } })` → `recordAuditLog
(`user.promoted_admin` / `user.demoted_admin`). The caller decides the target value —
the route reads the current user and passes `!user.isAdmin`. **No guard prevents demoting
the last remaining admin**, and it does not block self-demotion.

### `deleteUser(userId, adminUserId, ipAddress)` — soft delete

One `$transaction` with the only pre-checks in the file:
1. `user.findUnique` → throw `'User not found'` if missing.
2. throw `'User is already deleted'` if `status === 'DELETED'`.
3. **`if (userId === adminUserId) throw 'Cannot delete yourself'`** — the *only* identity
   guard anywhere in this service.

Then: `user.update` sets `status: 'DELETED'`, overwrites `passwordHash` with
`'DELETED_' + Date.now()` (login becomes impossible — not a real hash), and clears
`roleId`. `session.deleteMany` force-logs-out the target. `recordAuditLog`
(`user.deleted`, metadata `{ email, name, type: 'soft_delete' }`). Data (conversations,
messages, usage, audit) is intentionally preserved for later re-invite. Thrown errors
become a 400 at the route.

### `forcePasswordReset(userId, adminUserId, ipAddress): Promise<user>`

Two phases. **Phase 1 — `$transaction` (commits first):** `user.update` sets
`forcePasswordChange: true` → `session.deleteMany` (force re-login) → dynamically imports
`generateToken`, mints a 32-byte token, and `passwordResetToken.create` with a **7-day**
expiry → `recordAuditLog` (`user.force_password_reset`). **Phase 2 — email, *outside* and
*after* the committed transaction:** builds `${ATHENA_URL}/reset-password?token=...` and
calls `sendSmtpEmail`; the whole block is wrapped in `try/catch` that only
`console.error`s on failure. If `sendSmtpEmail` returns `false` (SMTP unconfigured) it
`console.log`s the raw reset link. Returns the updated user regardless of email outcome.
`ATHENA_URL` defaults to a hardcoded `https://d7y8a8whrch88.cloudfront.net`.

### `forceLogoutUser(userId, adminUserId, ipAddress): Promise<{ sessionsDeleted, sessionLogsClosed }>`

Two phases, deliberately split because the audit-log close uses raw SQL. **Phase 1 —
before the tx:** dynamically imports `closeAllUserSessions` and marks every `ACTIVE`
`user_session_logs` row for the user `CLOSED_ADMIN` (`reason: 'admin_force'`), guarded by
`.catch(() => 0)` so a raw-SQL failure yields `0` and does not block. **Phase 2 —
`$transaction`:** `session.deleteMany({ where: { userId } })` (the live logout) →
`recordAuditLog` (`user.force_logout`, metadata `{ sessionsDeleted, sessionLogsClosed }`).
It targets by `userId` via Prisma — it does **not** use the `sha256(token)` matching that
`session-audit.ts::reconcileStaleActiveSessions` uses, and it applies **no `is_admin`
filter**, so an admin *can* be force-logged-out through this path. Full end-to-end trace:
[scenario 05](../scenarios/05-admin-force-logout.md).

## Failure modes & gotchas

- **No last-admin protection exists anywhere in this file.** Suspending
  (`updateUserStatus`), demoting (`toggleUserAdmin`), or deleting (`deleteUser`) the last
  remaining admin all succeed. The **only** identity guard is `deleteUser`'s self-delete
  block; suspend/demote/force-reset/force-logout have **no self- or last-admin check at
  all**. An admin can suspend or force-logout themselves and lock the console. This matches
  hotspot row 21 and contradicts the *system prompt* claim (see [`./admin-tools.md`](./admin-tools.md),
  hotspot row 20) that the last admin is protected — that claim is not backed by code here.
- **Force-logout / suspend / delete / force-reset all delete `sessions` rows, and the DB
  is shared** — so the target is logged out of **both** the Admin console and the Fab app.
  This cross-app eviction is a feature, but worth stating explicitly.
- **Email failure never rolls back the mutation.** In `forcePasswordReset` the DB
  transaction (flag + session purge + token + audit) commits **before** the email is
  attempted, and the email is best-effort in a swallowing `try/catch`. Result: a user can
  be flagged `forcePasswordChange` and have all sessions killed yet **never receive the
  reset link** — with the only trace a `console.error`/`console.log` (the link itself is
  logged to stdout when SMTP is unset; see hotspot §6 and [`./email.md`](./email.md)).
- **`closeAllUserSessions` failure is swallowed** (`.catch(() => 0)`); the live-session
  deletion and audit still commit, but the audit-trail rows may not be marked
  `CLOSED_ADMIN` — `sessionLogsClosed: 0` is the only signal.
- **Chat-initiated actions record `ipAddress: 'chat-admin'`.** `admin-tools.ts` passes the
  literal string `'chat-admin'` where routes pass a real IP, so `audit_logs.ip_address`
  distinguishes UI vs. AI origin but is not a real address for chat actions.
- **`forceLogoutUser` is not exposed to the AI chat.** `admin-tools.ts` imports only
  `listUsers, updateUserStatus, changeUserRole, forcePasswordReset, deleteUser` — see the
  discrepancy note below.
- **`createUser` sends no notification;** an operator expecting the new user to be emailed
  will be surprised — that flow lives in the invitation service.

## Open questions for the code owner

1. Should suspend, demote (`toggleUserAdmin`), delete, force-reset, and force-logout refuse the last `isAdmin && ACTIVE` user and the acting admin themselves? (Hotspot row 21 / §4;
   [§8.7](../03-review-hotspots.md#8-open-questions-for-code-owners-consolidated); scenario 05.)
2. Is "commit the mutation, then best-effort email" intended for `forcePasswordReset`, given a failed email leaves the user locked out with no reset link?
3. Is it intended that an explicit `status` filter in `listUsers` exposes `DELETED` users while the default hides them?
4. Should chat-origin actions record something more useful than the literal `'chat-admin'` in `audit_logs.ip_address`?

## Both-apps note

This file is **Admin-only**. It is the administrative counterpart to Fab's data-access
layer `claudeai_athena/lib/storage.ts` ([`./storage.md`](./storage.md)): where Fab's
`storage.ts` is the end-user-facing persistence helper, this service is the privileged,
audit-wrapped mutation layer that only the Admin app exposes. The two are not copies and
do not share code — they meet only through the shared PostgreSQL database (Admin writes
`users.status` / `forcePasswordChange`; Fab reads them via `auth-middleware.ts`).

---

**Sibling pages:** [`./session-audit.md`](./session-audit.md) ·
[`./encryption.md`](./encryption.md) · [`./email.md`](./email.md) ·
[`./invitation-service.md`](./invitation-service.md) · [`./admin-tools.md`](./admin-tools.md)
