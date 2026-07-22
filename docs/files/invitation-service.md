# `lib/services/invitation-service.ts` — the invite lifecycle, and how accepting one mints a logged-in session

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Admin** (`admin_athena/lib/services/invitation-service.ts`) · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 22](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The single place where new Admin-console accounts are born. It creates invitations (with a
tokenized accept link), validates and revokes them, resends them, and — critically —
processes acceptance: it **creates (or reactivates) the `User` row, marks the invitation
accepted, and mints a live `Session` in one transaction**, handing back a 30-day session
token. So accepting an invite is *also* a login: there is no separate sign-in step after
registration. Every mutation writes an audit-log entry; invite/resend also send email.

## Depends on / consumed by

**Depends on:**
- `@/lib/db` (Prisma client) — `invitation`, `user`, `role`, `session` models, all mutations
  wrapped in `prisma.$transaction`.
- [`@/lib/encryption`](./encryption.md) — `generateToken()` (invite tokens **and** session
  tokens) and `hashPassword()` (the new user's password).
- [`@/lib/email/smtp`](./email.md) `sendSmtpEmail` + `@/lib/email/invitation-template`
  `buildInvitationEmailHtml` — the invite/resend emails.
- `./audit-service` `recordAuditLog` — audit rows, always passed the transaction handle.
- Env `APP_URL` (default `http://localhost:3001`) — base of the accept link
  `${APP_URL}/register?token=<token>`.

**Consumed by** (verified by import grep at the pinned commit):
- **Admin REST routes:**
  - `app/api/admin/invitations/route.ts` — `GET` → `listInvitations`, `POST` → `createInvitation` (wrapped by `requireAdmin`).
  - `app/api/admin/invitations/[id]/revoke/route.ts` — `POST` → `revokeInvitation`.
  - `app/api/auth/validate-invitation/route.ts` — **public** `POST` → `validateInvitationToken`.
  - `app/api/auth/accept-invitation/route.ts` — **public** `POST` → `acceptInvitation`; returns the service result (**including the minted session token**) as `201`.
- **Admin chat tools** ([`lib/admin-tools.ts`](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)): the `invite_user` tool → `createInvitation`; also `listInvitations`, `revokeInvitation`, `resendInvitation`. These pass the sentinel string `'chat-admin'` as `ipAddress`.

> Note: there is **no `inviteUser` export** — the chat tool is *named* `invite_user` but calls
> `createInvitation`. `resendInvitation` is reachable **only** via the chat tool, not via any REST route at this commit.

## Function-by-function

### `createInvitation({ email, roleId, adminUserId, ipAddress }): Promise<{ id, email, role, status, expiresAt, acceptUrl }>`

Issues a new pending invitation. Steps:
1. Lower-cases/trims the email.
2. Loads the role by id; **throws `Role not found`** if absent.
3. Loads any existing user by email. Throws `An active user with this email already exists`
   **only if `status === 'ACTIVE'`** — a `DELETED` or `SUSPENDED` user can still be invited
   (see gotchas for what happens to each on accept).
4. Throws `An invitation is already pending for this email` if a `PENDING` invitation exists.
5. Generates the token with [`generateToken()`](./encryption.md) (64-char random hex, same
   generator as session tokens) and, **inside a transaction**, creates the `Invitation`
   (`status: 'PENDING'`, `expiresAt = now + 7 days`, token stored **plaintext**) and writes an
   `invitation.created` audit row.
6. **After** the transaction commits, sends the invite email (see [email](./email.md)). Email
   is best-effort: any throw is caught and logged; if `sendSmtpEmail` returns falsy, the accept
   URL is `console.log`-ed as a dev fallback. **Email failure never rolls back the invitation.**

Returns the invite summary including `acceptUrl` (exposed "for dev convenience" — and surfaced
by the chat tool's response).

### `validateInvitationToken(token): Promise<{ valid, ... }>` — public

Read-mostly check used by the public register page. Returns `{ valid: false, error }` for
not-found / already `ACCEPTED` / `REVOKED` / expired / non-`PENDING`; `{ valid: true, email,
roleName }` otherwise. Side effect: if a `PENDING` invite is past `expiresAt`, it **writes**
`status: 'EXPIRED'` before returning invalid. Does not throw for the not-found case.

### `acceptInvitation({ token, name, password, ipAddress, userAgent }): Promise<{ user, token, expiresAt, roleName }>` — public — **mints a session**

The hot path. Order of operations:
1. Loads the invitation by token; **throws** if not found, if `status !== 'PENDING'`, or if
   past `expiresAt`. (These re-checks happen *before* the transaction — see the race note in gotchas.)
2. Loads any existing user by the invitation's email; **throws** if that user is `ACTIVE`.
3. Requires `password.length >= 8` (throws otherwise), then `hashPassword(password)`.
4. **Pre-generates the session token and 30-day expiry** (`generateToken()`;
   `sessionExpiry = now + 30 days`) *before* opening the transaction.
5. **One `prisma.$transaction`** does all of:
   - **User:** if the existing user is `DELETED`, it **updates that same row in place** —
     `name`, `passwordHash`, `roleId` (from the invite), `status: 'ACTIVE'`,
     `forcePasswordChange: false` (the reactivation branch; see gotchas). Otherwise it
     **creates** a new `User` (`status: 'ACTIVE'`, `roleId` from the invite).
   - **Invitation:** `status: 'ACCEPTED'`, `acceptedAt: now`.
   - **Session — this is the mint:** `tx.session.create({ userId, token: sessionToken,
     expiresAt: sessionExpiry, userAgent, ipAddress })`. The token is stored **plaintext**,
     exactly the pattern documented for Fab's [`storage.createSession`](./storage.md) and read
     back by [`auth-middleware`'s Admin `validateSession`](./auth-middleware.md) via
     `session.findUnique`. (Admin uses Prisma directly here rather than the `storage.ts`
     helper, but the resulting row and its plaintext-token contract are identical.)
   - **Audit:** `user.registered_via_invitation`.
6. Returns `{ user: {id,email,name}, token: sessionToken, expiresAt, roleName }`. The
   `accept-invitation` route passes this straight back to the browser as `201`.

**What the mint means for auth:** the returned `token` is a fully valid 30-day Admin session
the instant the transaction commits — the accepting client is logged in with no separate login,
no email-confirmation step, and no `forcePasswordChange`. Anyone who possesses a valid invite
link and submits a name + 8-char password receives a live session for whatever role the invite
carried. The 30-day `expiresAt` matches the login-issued session policy documented in
[`auth-middleware`](./auth-middleware.md); auth accepts it because it is ≥32 chars and present
in `sessions`.

### `listInvitations(): Promise<Invitation[]>`

Side effect first: `updateMany` flips every overdue `PENDING` invite to `EXPIRED` (lazy
expiry). Then returns all invitations with `role` and `invitedBy` included, ordered by status
then `createdAt desc`.

### `revokeInvitation(invitationId, adminUserId, ipAddress): Promise<Invitation>`

Throws if not found or if `status !== 'PENDING'` (only pending invites are revocable). In a
transaction, sets `status: 'REVOKED'` and writes an `invitation.revoked` audit row.

### `resendInvitation(invitationId, adminUserId, ipAddress): Promise<Invitation>`

Throws if not found, or if already `ACCEPTED`/`REVOKED`. **Generates a brand-new token**,
and in a transaction sets `token: newToken`, `status: 'PENDING'`, `expiresAt = now + 7 days`
(re-declares its own `INVITATION_EXPIRY_DAYS`/`APP_URL` locals rather than reusing the
module constants) plus an `invitation.resent` audit row. Sends a fresh email **after** the
transaction, with the same best-effort/swallow-on-failure handling as `createInvitation`.
Note: an `EXPIRED` invite *can* be resent (it becomes `PENDING` again with a new token); the
old token is overwritten and stops working.

## Failure modes & gotchas

- **Accepting = an immediate, unverified login.** The session is valid the moment the
  transaction commits and is returned to the browser in the `201` body. There is no
  email-verification round-trip beyond possessing the link, and the account is created
  `ACTIVE` with `forcePasswordChange` never set. Treat the invite token as a bearer credential
  for whatever role it grants.
- **Soft-deleted reactivation reuses the old identity and its data.** When the email matches a
  `DELETED` user, accept **updates that user row** (same `id`) rather than creating a new one —
  the code comment states it "preserves old data (conversations, usage)." So all rows
  foreign-keyed to that user id (conversations, usage, prior audit) reattach to the reactivated
  account. The **role does not carry over** (it is overwritten with the invite's `roleId`) and
  `forcePasswordChange` is reset to `false`, but the historical data association does. Whether
  reattaching a deleted user's history to a re-invited person is intended is a real
  privilege/data question (hotspot row 22).
- **`SUSPENDED` re-invite silently breaks at accept.** `createInvitation` blocks only `ACTIVE`
  users, so a `SUSPENDED` user can be invited. But `acceptInvitation` only special-cases
  `DELETED` — a `SUSPENDED` existing user is neither `ACTIVE` (so not rejected up front) nor
  `DELETED` (so not reactivated), and falls into the **create** branch, which then violates the
  unique-email constraint and throws a raw DB error the client sees as a `400`. There is no
  clean "you are suspended" path.
- **Invites are single-use — by status, not by token deletion.** After accept the invitation is
  `ACCEPTED`, and both `acceptInvitation` and `validateInvitationToken` reject non-`PENDING`
  status, so the same token cannot be redeemed twice. The plaintext token stays in the row.
- **Accept re-validation happens *before* the transaction, not with a row lock.** Two
  concurrent accepts on the same still-`PENDING` token both pass the pre-checks. For a new user
  the second `user.create` fails on unique email; for a `DELETED` reactivation both could run
  the update and **each create a session**. Not obviously guarded against a double-mint.
- **Email failures are swallowed everywhere.** Both create and resend catch send errors and
  `console.error`; a falsy send result just logs the accept URL to the server console. An invite
  can therefore exist (and be acceptable) while no email ever reached the recipient.
- **Email HTML is built from `inviterName`/`roleName` unescaped** — see [email](./email.md) and
  hotspot row 23 (HTML-injection surface); those values flow from this service into the template.
- **`ipAddress: 'chat-admin'` sentinel.** Invites/revokes/resends triggered from the admin chat
  store the literal string `'chat-admin'` in the audit `ipAddress` field instead of a real IP.
- **Role grant is not privilege-checked here.** `createInvitation` only checks the role exists;
  it does not verify the inviting admin may grant that role (the REST route's `requireAdmin` is
  the only gate, and the chat tool trusts the route — consistent with the admin-authZ assumption
  in [03 §2](../03-review-hotspots.md#2-security--authorization)).

## Open questions for the code owner

1. Is reattaching a `DELETED` user's history to a re-invited email, overwriting only the role, the intended reactivation behavior? (Row 22.)
2. Is minting a live 30-day session on accept — no separate sign-in or verification beyond the link — the intended posture?
3. Should `SUSPENDED` users be invitable, given accept throws a raw unique-key error for them?
4. Are invite tokens meant to stay plaintext in `invitations.token` (same trade-off as [`sessions.token`](./storage.md))?
5. Should the concurrent-accept race be closed (e.g. `SELECT ... FOR UPDATE`) to prevent a double session mint?
6. Is silent email failure (invite minted, never delivered) acceptable, or should the chat/REST caller surface it?

## Both-apps note

**Admin-only.** No equivalent file exists in Fab (`claudeai_athena`) — Fab has no invitation or
self-registration flow; its users are provisioned here in the Admin app and read across the
shared database. The parallel Admin services are [`admin-user-service.ts`](./admin-user-service.md)
(delete/suspend/force-logout/reset) and the [email](./email.md) layer.
