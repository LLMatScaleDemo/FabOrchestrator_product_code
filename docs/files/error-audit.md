# `lib/errors/error-audit.ts` — REQ-03 error persistence and the human-readable ERR ids

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/errors/error-audit.ts` and `admin_athena/lib/errors/error-audit.ts`) —
> **the two copies are byte-identical; see the Both-apps note.** · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.2 / §B.2](../01-file-catalog.md) · Hotspot: [03 §1 row 6](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance),
> [03 §5 raw SQL](../03-review-hotspots.md#5-raw-sql--injection-surface), [03 §6 un-scheduled retention](../03-review-hotspots.md#un-scheduled-retention)

## Purpose

Implements REQ-03: every `FabOrchError` that reaches `handleApiError()` (or one of the
manual call sites) is persisted to the `error_audit_logs` table with a human-friendly,
sequential id of the form `ERR-YYYYMMDD-NNNN`, so an admin can say "look up
ERR-20260505-0007". The same file also provides the admin-side helpers the NexusOps chat
tools use to query, resolve, and purge those rows. Everything is **raw SQL** via
`$queryRawUnsafe`/`$executeRawUnsafe` — the header comment explains the Prisma client
could not be regenerated under the local Node 20.11 + Prisma 7 toolchain, so the audit
tables have no typed client (and are not in `schema.prisma` at all).

## Depends on / consumed by

**Depends on:**
- `prisma` from `../db` (raw SQL only — no generated model is used).
- `errors/faborch-errors.ts` — `FabOrchError` / `FabOrchErrorEnvelope` types and the
  `FabOrchErrorType` enum (for the SESSION_TIMEOUT skip).
- `node:crypto` `randomUUID` for the row PK.
- **DB objects that exist only if created out-of-band:** `error_audit_logs`,
  `error_audit_daily_counter` (needs a unique/PK constraint on `counter_date` for the
  `ON CONFLICT` upsert), the `error_audit_status` enum, and the `users` table (joined
  for names/emails). ⚠️ **No DDL for any of the three audit objects exists anywhere in
  this repo** — see Failure modes.

**Consumed by** (verified by import grep at the pinned commit):
- *Both apps:* `lib/errors/api-error-handler.ts` — the only static import. `handleApiError`
  calls `recordError(...).catch(() => {})` fire-and-forget on every classified error.
- *Fab:* `lib/mcp-client.ts` (3 dynamic imports — `recordError` on MCP HTTP failure,
  JSON-RPC error, and tool-execution exception) and `app/api/chat/route.ts` (dynamic
  import — persists stream-time errors that occur after headers are sent).
- *Admin:* `app/api/admin/chat/route.ts` (dynamic import — stream-time errors) and
  `lib/admin-tools.ts` (dynamic imports inside three chat tools: `view_error_audit` →
  `queryErrorAudit`, `mark_error_resolved` → `markErrorResolved`, `purge_old_errors` →
  `purgeOldErrors`, the last gated by `confirm=true` and mirrored into `auditLog`).
- `countErrorAudit` has **no callers in either app** — a dead export at this commit.
- *Adjacent, not a consumer:* `admin_athena/app/api/admin/dashboard/route.ts` runs its
  own raw `COUNT(*)` queries against `error_audit_logs` directly, bypassing this module.

## Function-by-function

### `shouldPersist(envelope, ctx): boolean` — internal

Deliberate noise filter (documented in-code as REQ-01 #8): a `SESSION_TIMEOUT` envelope
with **no `userId`** is *not* persisted, because every page load by a logged-out user
fires one; CloudWatch keeps the full record. Authenticated SESSION_TIMEOUT (idle eviction
mid-flight) *is* persisted. Everything else persists.

### `nextErrorId(): Promise<string>` — internal, the atomicity mechanism

One statement does the whole job:
```sql
INSERT INTO error_audit_daily_counter (counter_date, last_seq)
VALUES (CURRENT_DATE, 1)
ON CONFLICT (counter_date)
  DO UPDATE SET last_seq = error_audit_daily_counter.last_seq + 1
RETURNING last_seq, to_char(counter_date, 'YYYYMMDD') AS day
```
Postgres serializes the upsert, so concurrent inserts get distinct sequence numbers with
no read-then-write race — **provided a unique/PK constraint on `counter_date` exists**
(without it, `ON CONFLICT (counter_date)` errors at execution time). The result is
formatted `ERR-<day>-<seq padded to 4>`. Two details: (a) the comment says "for the given
**UTC** date" but the SQL uses `CURRENT_DATE`, which is the DB session's timezone, not
necessarily UTC; (b) `padStart(4, '0')` does not cap the sequence — error #10000 on one
day would produce a 5-digit suffix (still unique, just off-pattern).

### `recordError(err, ctx?): Promise<string | null>` — the write path

Builds the envelope, applies `shouldPersist`, generates the ERR id, then a single
parameterized `INSERT INTO "error_audit_logs"` (16 columns: `randomUUID()` PK, human
`error_id`, the envelope's internal `error_uuid`, type, user, messages, priority,
`'OPEN'::"error_audit_status"`, route/method/http_status, stack truncated to **2000
chars**, `request_context` cast to jsonb). Technical message falls back to
`err.cause.message`; request context falls back to `envelope.context`.

**The entire body is wrapped in a bare `try/catch` that returns `null`** — this function
can never throw. That is the intended contract ("persistence must never break the request
path"), but note the catch block does **not log anything**, and the doc comment's claim
that a failure "is itself logged via the caller" is not true of any current caller —
every call site is `recordError(...).catch(() => {})` (redundant, since it never
rejects) or fire-and-forget with an empty catch. A dead audit table is completely silent
except in CloudWatch.

### `queryErrorAudit(filters): Promise<{ rows, truncated }>` — Admin chat tool backend

Dynamic WHERE builder: each user-supplied filter value is **parameterized** (`$1…$n` via
a `push('sql $?', value)` helper); `userKey` matches `u.name`/`u.email`/email local-part
with `ILIKE %…%`; `errorIdLike` is a substring match on the human id; `status` is cast to
the `error_audit_status` enum. Joins `users` twice (reporter `u`, resolver `ru`) to
return names/emails. `limit` is clamped `Math.min(Math.max(1, limit ?? 100), 1000)` and
then **string-interpolated** as `LIMIT ${limit + 1}` — the `+1` is a sentinel row used
only to set `truncated`; the extra row is sliced off. Ordered `datetime DESC`. Throws on
DB failure (no swallow here — callers are the admin tools, which surface errors).

### `countErrorAudit(filters): Promise<number>`

Same WHERE builder over `COUNT(*)` (single `users` join, no limit). **Exported but
never imported anywhere in either app at this commit.**

### `markErrorResolved({ errorId, adminUserId, note? }): Promise<boolean>`

Parameterized `UPDATE … SET status='RESOLVED', resolved_by, resolved_at=NOW(),
resolution_note WHERE error_id = $1 AND status = 'OPEN'`. Keyed on the **human** ERR id,
not the row UUID. Returns `true` iff a row changed — so `false` means "doesn't exist
*or* already resolved" (the admin tool reports exactly that ambiguity). No un-resolve
helper exists. Throws on DB failure.

### `purgeOldErrors(): Promise<number>`

`DELETE FROM "error_audit_logs" WHERE datetime < NOW() - INTERVAL '90 days'` (the
interval is a literal, not interpolated); returns the deleted-row count. **Nothing
schedules this in either app**: Fab has no scheduler at all, and Admin's
`session-retention-worker.ts` only calls `purgeOldSessionLogs` — never `purgeOldErrors`
— and is itself dead because `instrumentation.ts` is a no-op
([03 §6](../03-review-hotspots.md#un-scheduled-retention)). The only invocation path at
this commit is the Admin chat tool `purge_old_errors` (LLM-reachable, `confirm=true`
required), i.e. retention runs only when an admin explicitly asks for it. Note
`error_audit_daily_counter` rows are never purged by anything (one tiny row per day).

## Failure modes & gotchas

- **The audit tables have no DDL in this repo.** `error_audit_logs`,
  `error_audit_daily_counter`, and the `error_audit_status` enum are not in
  `schema.prisma`, and — contrary to the file catalog's Part C note that raw-SQL tables
  live in `admin_athena/prisma/*.sql` — **none of those five SQL files creates them**
  (they cover `platform_settings`, `model_registry`, an `mcp_registry` alter, the CMF
  tables, and a `prompt_audit_logs` ALTER only). The tables must have been created
  out-of-band against RDS. A fresh environment built from this repo would run with
  error persistence **silently disabled** (next bullet).
- **Missing table/constraint ⇒ silent no-op on the write path.** If
  `error_audit_daily_counter` is missing, or lacks the unique constraint `ON CONFLICT`
  needs, or `error_audit_logs`/the enum is missing, `nextErrorId`/the INSERT throw —
  and `recordError`'s bare catch turns that into `return null`. No log line, ever
  (the in-code claim that the caller logs it is not backed by any call site). The
  *read* paths are the opposite: `queryErrorAudit`/`markErrorResolved`/`purgeOldErrors`
  throw, so an admin asking "show me the error log" is the first place a missing table
  becomes visible.
- **Retention is manual-only** — see `purgeOldErrors` above; without an admin
  periodically invoking the chat tool, `error_audit_logs` grows unbounded.
- **Unauthenticated SESSION_TIMEOUT is never persisted** by design; don't expect
  logged-out 401 noise in the table when reconciling against CloudWatch.
- **`LIMIT ${limit + 1}` interpolation** is the file's only non-parameterized SQL piece;
  safe today because of the 1–1000 clamp, but any future filter must keep user text out
  of it ([03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface)). (§5 also
  mentions interpolated `INTERVAL` constants for the audit trio — in *this* file the
  interval is a hardcoded literal; that item applies to the session/prompt audit files.)
- **`CURRENT_DATE` vs "UTC"** — the day embedded in the ERR id follows the DB session
  timezone, despite the comment saying UTC. If the DB isn't UTC, ids near midnight may
  disagree with CloudWatch timestamps.
- **Two id systems coexist:** the envelope's internal `errorId` (a UUID, stored as
  `error_uuid`, and what the *user* sees in `(errorId=…)` messages from Fab's MCP paths)
  vs. the human `ERR-…` id generated here. Support flows must know which one they hold —
  `markErrorResolved` only accepts the ERR form.
- **`countErrorAudit` is dead code** at this commit; the catalog row also omits it from
  the exports list.

## Open questions for the code owner

1. **Where is the DDL** for `error_audit_logs`, `error_audit_daily_counter`, and the
   `error_audit_status` enum? It is not in `schema.prisma` nor in any
   `admin_athena/prisma/*.sql` file — was it applied by hand to RDS, and does
   `error_audit_daily_counter.counter_date` definitely carry the unique/PK constraint the
   `ON CONFLICT` upsert requires? (Hotspot row 6's core question.)
2. Is "persistence failure ⇒ silent `null`, no log line" acceptable, given the in-code
   comment promises the caller logs it and no caller does? (Also [03 §6 silent-failure
   hazards](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors).)
3. What is supposed to run the 90-day `purgeOldErrors` sweep? Nothing schedules it in
   Fab **or** Admin (the retention worker only purges session logs, and is dead anyway) —
   is admin-chat-on-demand the intended retention mechanism?
4. Is the ERR-id day meant to be UTC (comment) or DB-local (`CURRENT_DATE`)? What is the
   RDS timezone?
5. `countErrorAudit` has no callers — planned feature or removable?
6. The header says switching to typed `prisma.errorAuditLog.*` is "a one-line change once
   the client is regenerated" — but the models aren't in `schema.prisma`, so it would
   first need the schema added. Is that migration planned?

## Both-apps note

**Byte-identical** at commit `7976c78` (verified by diff/checksum) — same file duplicated
into `claudeai_athena/lib/errors/` and `admin_athena/lib/errors/`, both talking to the
same shared tables. The divergence is entirely in *usage*, not code:

| Aspect | Fab (`claudeai_athena`) | Admin (`admin_athena`) |
|---|---|---|
| Writes (`recordError`) | `api-error-handler`, `mcp-client` (×3 sites), chat-stream errors | `api-error-handler`, admin-chat-stream errors |
| Reads/resolve/purge | **Never called** | Admin chat tools `view_error_audit`, `mark_error_resolved`, `purge_old_errors` |
| Retention trigger | None | Manual only (chat tool, `confirm=true`) |

Because the copies are identical, any future edit must be applied to both or the shared
`error_audit_daily_counter` upsert semantics could drift between the two writers.
