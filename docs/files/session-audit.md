# `lib/session-audit.ts` — the REQ-02 session audit trail (raw SQL)

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/session-audit.ts` and `admin_athena/lib/session-audit.ts`) —
> **near-identical copies; the Admin copy adds one function. See the Both-apps note.** ·
> Review priority: **High** ·
> Catalog row: [01 — File catalog §A / §B](../01-file-catalog.md) · Hotspot: [03 §1 row 4](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Maintains the REQ-02 session audit table (`user_session_logs`): one row per session
lifecycle, from login to logout/eviction/expiry, with a single interaction clock
(`last_activity_at`) and a JSONB history of idle episodes (any gap > 60 s). The same
clock drives Fab's 30-minute idle eviction. Everything is **raw SQL** via
`$queryRawUnsafe`/`$executeRawUnsafe` — the header comment says the Prisma client could
not be regenerated under the local Node 20.11 toolchain, so `user_session_logs` is not a
Prisma model. Sessions are identified by **sha256 hash of the plaintext token**
(`hashToken`), never the token itself — except in one place (see the reconciler).

## Depends on / consumed by

**Depends on:** `prisma` from `./db` (raw SQL only), `node:crypto`
(`createHash('sha256')`, `randomUUID`). Tables: `user_session_logs` (not in
`schema.prisma` — raw-SQL-only, see [hotspot row 25](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)),
`users` (join + `is_admin` filter), and the live `sessions` table (**deleted from**, by
the reconciler).

**Consumed by** (verified by import grep at the pinned commit):
- *Fab:* `lib/auth-middleware.ts` (`checkAndRecordActivity`, `recordExpired`),
  `app/api/auth/login/route.ts` (`recordLogin`), `app/api/auth/logout/route.ts`
  (`recordLogout`), `app/api/chat/route.ts` (`bumpActivityIfActive`).
- *Admin:* `lib/auth-middleware.ts` (`recordActivityWithoutEviction`, `recordExpired`),
  `app/api/auth/login|logout/route.ts` (`recordLogin`/`recordLogout`),
  `app/api/admin/chat/route.ts` (`bumpActivityIfActive`), `lib/admin-tools.ts`
  (`querySessionLogs`, dynamic import — the `query_user_sessions` chat tool),
  `lib/services/admin-user-service.ts` (`closeAllUserSessions`, dynamic import — inside
  `forceLogoutUser`, see [scenario 05](../scenarios/05-admin-force-logout.md)),
  `lib/session-retention-worker.ts` (`purgeOldSessionLogs`).

Notably **unconsumed**: in Fab, the entire admin-query half (`querySessionLogs`,
`reconcileStaleActiveSessions`, `purgeOldSessionLogs`) and `closeAllUserSessions` have
**no callers** — Fab carries them but never runs them. `recordAdminForce` has no callers
in **either** app (force-logout uses `closeAllUserSessions` instead).

Nearly every consumer calls fire-and-forget: `recordLogin`/`recordLogout` with
`.catch(e => logger.fabOrchError(...))` (logged), `bumpActivityIfActive` with
`.catch(() => {})` (**silently swallowed**), `closeAllUserSessions` with
`.catch(() => 0)` (swallowed). Only Fab's `checkAndRecordActivity` (in
`validateSession`) is awaited on the request path.

## Function-by-function

### `hashToken(token): string` — both apps

sha256 hex of the plaintext token. Every audit row stores this hash
(`session_token_hash`), so the audit table never holds usable tokens.

### `recordLogin({userId, sessionToken, loginIp?, loginUserAgent?}): Promise<string>` — both apps

Raw-SQL `INSERT` of a fresh `ACTIVE` row (`login_time = last_activity_at = NOW()`, empty
idle episodes); returns the new row id. Throws on DB failure — but both login routes call
it fire-and-forget with a logging `.catch`, so a failed insert means **the user logs in
with no audit row** (later repaired by the lazy-create path in the activity functions).

### `closeActiveSession({sessionToken, status, reason?, logoutTime?}): Promise<boolean>` — both apps

Raw-SQL `UPDATE` closing the ACTIVE row matching the token hash: sets `session_status`,
`logout_time` (`COALESCE` of the passed time or `NOW()`), `closed_reason`. Returns
whether a row was actually closed; idempotent (already-closed → `false`). Three thin
wrappers preset the status:
- `recordLogout(token)` → `CLOSED_LOGOUT` / `'logout'` — called by both logout routes.
- `recordAdminForce(token)` → `CLOSED_ADMIN` / `'admin_force'` — **dead export, no
  callers in either app** (force-logout closes by user id via `closeAllUserSessions`).
- `recordExpired(token, expiresAt?)` → `CLOSED_EXPIRED` / `'absolute_expiry'`, backdating
  `logout_time` to the expiry — called fire-and-forget from both auth-middlewares when a
  token fails the 30-day absolute check.

### `closeAllUserSessions({userId, status, reason?}): Promise<number>` — both apps (used in Admin only)

Closes **every** ACTIVE row for a user id in one `UPDATE`; returns the count. Admin's
`forceLogoutUser` calls it (status `CLOSED_ADMIN`) right before deleting the user's live
`sessions` rows — with `.catch(() => 0)`, so an audit failure doesn't block the logout.

### `checkAndRecordActivity(sessionToken, ctx?): Promise<ActivityResult>` — both apps (hot path in Fab)

The per-request activity bump plus (in Fab's usage) the 30-minute idle eviction. Two
raw-SQL round-trips — the docblock says "atomically," but it is really SELECT-then-UPDATE
guarded by `WHERE id = $1 AND session_status = 'ACTIVE'`, so concurrent requests race
benignly (only one UPDATE wins):
1. **Lookup** the ACTIVE row by token hash, computing the gap since `last_activity_at`
   in SQL.
2. **No row + `ctx.userId` present:** lazy-creates a fresh ACTIVE row (valid session
   whose earlier audit row was already closed — stale localStorage token) and returns
   `'active'`. The INSERT's `catch {}` swallows **all** errors (intended for the
   duplicate-race) and still returns `'active'`. No row and no ctx → `'not_found'`
   (legacy behavior; middleware lets the request through).
3. **Gap > 1800 s:** closes the row — `CLOSED_IDLE`, `logout_time = last_activity +
   30 min`, appends a final 1800 s idle episode — and returns
   `{status:'evicted', logoutTime}`. Fab's middleware then deletes the live session and
   401s; if the closing UPDATE raced to zero rows it returns `'not_found'`.
4. **Otherwise:** bumps `last_activity_at = NOW()` and, when the gap exceeded 60 s,
   appends an idle episode and increments `idle_episode_count`/`idle_seconds` — all in
   one UPDATE with `CASE` expressions.

`IDLE_TIMEOUT_SEC`/threshold constants are string-interpolated into the SQL (internal
numbers — see [03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface)); the token
hash and ctx values are parameterized.

### `bumpActivityIfActive(sessionToken): Promise<void>` — both apps

Post-stream bump: both chat routes call it in `onFinish` so a multi-minute streamed
response counts as activity at its end, not just its start. It simply calls
`checkAndRecordActivity` (no ctx) and discards the result — meaning it **can** close the
row as `CLOSED_IDLE` if the stream outlasted 30 minutes, without anyone deleting the live
session. In Admin this delegates to the *evicting* variant, not
`recordActivityWithoutEviction` (see open question 4). Called `.catch(() => {})` at both
call sites — failures vanish.

### `recordActivityWithoutEviction(sessionToken, ctx?): Promise<void>` — **Admin only**

The Admin middleware's replacement for `checkAndRecordActivity`: one UPDATE that bumps
the clock and records idle episodes **but never changes `session_status`** — the
docblock's stated intent is that admins running long operations must never be idle-kicked;
only explicit logout, admin-force, or the 30-day absolute expiry ends an admin session.
If the UPDATE hits zero rows and `ctx.userId` is present, lazy-creates an ACTIVE row
(same repair as `checkAndRecordActivity`, `catch {}` swallowed). Fire-and-forget from
Admin's `validateSession`.

### `reconcileStaleActiveSessions(): Promise<{idle: number}>` — both copies (reachable in Admin only)

The lazy reconciler, run at the top of every `querySessionLogs` so admin answers about
"who is logged in" are honest even when no request from the user has arrived to trigger
eviction. Two passes:
1. `UPDATE ... FROM "users"` closing every ACTIVE audit row with
   `last_activity_at` older than 30 min **and `u.is_admin = false`** as
   `CLOSED_IDLE` / `'idle_timeout (lazy reconcile)'`, `RETURNING` the token hashes.
2. **`DELETE FROM "sessions" WHERE encode(sha256(token::bytea),'hex') = ANY($1)`** — it
   deletes the **live sessions** matching those hashes, so the evicted user's browser
   really gets 401 next request instead of the audit table lying. This is the only place
   that relies on `sessions.token` being **plaintext** (it is, statically:
   `storage.createSession` and Admin's login store the raw hex token, and Admin's logout
   deletes by raw token equality).

Returns the evicted count. Because both apps share one DB, this Admin-triggered call
evicts **Fab end-users'** live sessions; the `is_admin = false` filter is what keeps
admins exempt.

### `querySessionLogs(filters): Promise<SessionQueryRow[]>` — both copies (Admin chat tool)

The admin-side query behind the `query_user_sessions` chat tool. First runs the
reconciler (**`.catch(() => {})` — a reconcile failure is silent and the results may then
overstate who is "active"**). Then builds a WHERE clause from optional filters (user id,
exact email, name ILIKE, `userKey` OR-match across name/email/email local-part, login
date range, active/closed, "idle more than N minutes") — user values are parameterized;
`limit` is clamped `1..1000` and `idleMinutesGt` passes through `Math.floor` before
interpolation. Joins `users`, computes duration/current-idle in SQL, and maps rows to
`SessionQueryRow` including `activeSeconds = duration − idle`, `isIdleNow`
(ACTIVE + idle > 60 s), and a human `engagementLabel` (built by internal helpers
`humanGap`/`buildEngagementLabel`, e.g. "Idle right now (last interaction ~5 min ago)").

### `purgeOldSessionLogs(): Promise<number>` — both copies (scheduled in Admin only)

`DELETE FROM user_session_logs WHERE login_time < NOW() - 90 days`; returns the count.
Only caller is Admin's `session-retention-worker.ts` — whose starter
(`instrumentation.ts`) is a no-op per [03 §6](../03-review-hotspots.md#un-scheduled-retention),
so what actually runs it is an open question. Fab has no caller at all.

### Types & constants

`SessionStatus` (`ACTIVE` | `CLOSED_LOGOUT` | `CLOSED_IDLE` | `CLOSED_ADMIN` |
`CLOSED_EXPIRED`), `IdleEpisode`, `UserSessionLogRow`, `ActivityResult`,
`SessionQueryFilters`, `SessionQueryRow`, `SESSION_IDLE_TIMEOUT_MS` (30 min),
`SESSION_IDLE_EPISODE_THRESHOLD_SEC` (60 s).

## Failure modes & gotchas

- **The reconciler deletes live sessions (shared table).** An Admin chat question
  ("who's logged in?") can log Fab end-users out for real. If activity bumps have been
  silently failing (they're fire-and-forget almost everywhere), `last_activity_at` goes
  stale and the reconciler will evict a user who is **actively using the app**.
- **Plaintext-token coupling.** The `DELETE ... sha256(token::bytea)` match only works
  while `sessions.token` stays plaintext. If token storage is ever hashed/encrypted, the
  reconciler silently stops deleting live sessions — audit says "logged out," token still
  works (the exact lie the in-code comment warns about).
- **Fire-and-forget everywhere:** `recordLogin`/`recordLogout` failures are logged;
  `bumpActivityIfActive` (`.catch(() => {})`) and `closeAllUserSessions`
  (`.catch(() => 0)`) failures are **swallowed silently**; `querySessionLogs` swallows
  reconcile failures. Audit outages are invisible except (sometimes) in logs — see
  [03 §6 silent-failure hazards](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors).
- **Lazy-create `catch {}` swallows everything**, not just the duplicate-key race it is
  written for, and returns `'active'` — a broken `user_session_logs` table means every
  request looks active and Fab's idle eviction quietly never fires.
- **"Atomically" is aspirational:** `checkAndRecordActivity` is two round-trips guarded
  by `WHERE id + ACTIVE`. The guard makes races benign, but the docblock overstates it.
- **Admin's `bumpActivityIfActive` can idle-close an admin row.** It reuses the evicting
  `checkAndRecordActivity`, so a >30-min admin chat stream would mark the admin's audit
  row `CLOSED_IDLE` despite the no-eviction policy (the live session survives; the
  middleware then lazy-creates a fresh row). Bounded today by `maxDuration` (120 s Admin,
  300 s Fab), so theoretical — but it contradicts the stated policy.
- **Interpolated numeric constants** (`INTERVAL '${IDLE_TIMEOUT_SEC} seconds'`,
  `LIMIT ${limit}`) are safe today; any future filter routing user text there would be an
  injection ([03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface)).
- **Dead code drift hazard:** Fab ships the reconciler/query/purge half with no callers,
  and `recordAdminForce` is unused in both apps. The two copies are hand-synchronized —
  a fix landing in one copy only would diverge silently.

## Open questions for the code owner

1. **Is "admin query deletes live sessions" the intended design?** (Hotspot row 4.)
   `reconcileStaleActiveSessions` closes stale audit rows *and* deletes matching live
   `sessions` rows as a side effect of a read (`querySessionLogs`). Confirm (a)
   `sessions.token` really is stored plaintext everywhere, so the
   `sha256(token::bytea)` match works; (b) the `is_admin = false` filter cannot be
   bypassed — i.e. there is no other path into the DELETE that could mass-log-out admins.
2. Is the near-universal fire-and-forget pattern acceptable — specifically the fully
   silent `.catch(() => {})` on `bumpActivityIfActive` and `.catch(() => 0)` on
   `closeAllUserSessions`, versus the logged catches on login/logout?
3. Should the lazy-create `catch {}` distinguish the duplicate-key race from real DB
   failures instead of reporting `'active'` for both?
4. Admin's `bumpActivityIfActive` delegates to the evicting `checkAndRecordActivity`
   rather than `recordActivityWithoutEviction` — intended, or an oversight bounded only
   by `maxDuration`?
5. What actually runs `purgeOldSessionLogs`? Admin's retention worker exists but its
   `instrumentation.ts` starter is a no-op, and Fab never calls it — does
   `user_session_logs` grow unbounded? ([03 §6](../03-review-hotspots.md#un-scheduled-retention).)
6. Can the dead exports (`recordAdminForce`; Fab's query/reconcile/purge half) be
   removed, or are they kept deliberately to keep the two copies diffable?

## Both-apps note

Same file duplicated, not shared — one functional addition and cosmetic comment drift:

| Aspect | Fab (`claudeai_athena`) | Admin (`admin_athena`) |
|---|---|---|
| `recordActivityWithoutEviction` | **Absent** | Present — the no-eviction bump Admin's middleware uses |
| Middleware activity call | `checkAndRecordActivity` (awaited; can evict) | `recordActivityWithoutEviction` (fire-and-forget; never evicts) |
| Everything else (`recordLogin` … `purgeOldSessionLogs`) | Identical logic and SQL | Identical logic and SQL |
| Which exports actually run | Login/logout/activity/expiry only — query/reconcile/purge half is **dead code** | All except `recordAdminForce` |
| Comments | Longer docblocks on `checkAndRecordActivity` ctx + reconciler | Abbreviated ctx comment; reconciler comment adds "Admin sessions are never auto-evicted" |

Because both copies write the **same shared tables**, behavior differences come from
which functions each app's middleware calls — not from the SQL, which is byte-equivalent
between copies.
