# `lib/errors/api-error-handler.ts` — anything thrown → the canonical REQ-01 error envelope

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/errors/api-error-handler.ts` and
> `admin_athena/lib/errors/api-error-handler.ts`) — **functionally identical; only comments
> differ. See the Both-apps note.** · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 8](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The funnel at the bottom of every handled API error: take *anything* thrown (a
`FabOrchError`, a Zod failure, a Prisma error, a random `TypeError`, even a string),
classify it into one of the 10 canonical REQ-01 error types, log it structurally,
fire-and-forget persist it to `error_audit_logs` (REQ-03), and answer the client with the
canonical JSON envelope `{ error: { errorId, type, priority, message } }` at the
catalog-defined HTTP status. It is how "unknown exception" becomes "user-facing message +
audit row" in both apps.

## Depends on / consumed by

**Depends on:**
- `errors/faborch-errors.ts` — the `FabOrchError` class it normalizes everything into.
  Each instance carries `errorId` (UUID), `type`, `priority` (HIGH/MEDIUM), `userMessage`,
  and `httpStatus`, all pulled from the REQ-01 catalog entry for its type (e.g.
  `SESSION_TIMEOUT` → 401, `SQL_CALL_FAILURE` → 503, `LAMBDA_MCP_CRASH` → 500).
- `errors/error-audit.ts` (`recordError`) — the raw-SQL insert into `error_audit_logs`
  (hotspot [03 §1 row 6](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)).
- `logger.ts` (`logger.fabOrchError`) and `zod` (`ZodError` detection).

**Consumed by** (verified by import grep at the pinned commit) — **fewer callers than the
"wrap every route" design implies**:
- *Fab:* `lib/auth-middleware.ts` (the canonical 401 envelope in `requireAuth` — see
  [auth-middleware](./auth-middleware.md)) plus 4 routes: `app/api/chat/route.ts`,
  `app/api/conversations/route.ts`, `app/api/conversations/[id]/route.ts`,
  `app/api/mcp/connections/route.ts`. All import **only `handleApiError`**.
- *Admin:* `lib/auth-middleware.ts` plus 5 routes: `app/api/admin/chat`, `/users`,
  `/roles`, `/usage`, `/audit-logs`. Again only `handleApiError`.
- Tests (`__tests__/errors/faborch-errors.test.ts`, both apps) import `classifyError`.
- **`withErrorHandling`, `buildErrorBody`, and `toFabOrchError` have zero importers in
  either app** at this commit — see gotchas.

## Function-by-function

### `classifyError(error): FabOrchErrorType` — the heuristic

Best-effort mapping of an unknown thrown value to a REQ-01 type. The checks run **in this
exact order; first match wins**:

1. Already a `FabOrchError` (via `isFabOrchError`) → its own `type`, untouched.
2. `ZodError` → `INVALID_PARAMETER`.
3. Otherwise, only if `error instanceof Error`, match on `error.name` and the
   **lower-cased message substring**:
   1. name `AbortError`, or message contains `timeout` / `timed out` → `RESPONSE_TIMEOUT`
   2. name `PrismaClientKnownRequestError` / `PrismaClientUnknownRequestError` →
      Prisma code `P2025` ("record not found") → `NO_ROWS_RETURNED`, else `SQL_CALL_FAILURE`
   3. name `PrismaClientInitializationError` / `PrismaClientRustPanicError` → `SQL_CALL_FAILURE`
   4. message contains `econnrefused` / `enotfound` / `database` → `SQL_CALL_FAILURE`
   5. message contains `rate_limit` / `rate limit` → `LAMBDA_MCP_CRASH`
   6. message contains `unauthorized` / `session` → `SESSION_TIMEOUT`
4. Anything else — including non-`Error` throws (strings, objects) — → `LAMBDA_MCP_CRASH`.

**Concrete misclassification examples** (the hotspot-row-8 concern, confirmed in code):
- `new Error("Failed to fetch user database export from S3")` — an S3/network failure —
  contains "database" → reported as `SQL_CALL_FAILURE` (503, "database" user message).
- An MCP server throwing `"session expired on remote server"` contains "session" →
  `SESSION_TIMEOUT` → the client receives a **401 session-timeout envelope for a non-auth
  failure**, which the UI may treat as "log the user out."
- Order matters: `"Connection to database timed out"` hits rule 3.1 first →
  `RESPONSE_TIMEOUT` (504), not `SQL_CALL_FAILURE`.
- Note the comment says "one of the 10 REQ-01 types," but the heuristics can only *produce*
  6 of them (`INVALID_PARAMETER`, `RESPONSE_TIMEOUT`, `NO_ROWS_RETURNED`,
  `SQL_CALL_FAILURE`, `LAMBDA_MCP_CRASH`, `SESSION_TIMEOUT`); the other 4
  (`MISSING_FILTER`, `DDL_DML_REJECTED`, `ROW_CAP_EXCEEDED`, `UNLISTED_STORED_PROC`) are
  reachable only when code throws an explicit `FabOrchError`.

No side effects; never throws.

### `toFabOrchError(error, context?): FabOrchError`

Pass-through if already a `FabOrchError`; otherwise `classifyError` + wrap in a new
`FabOrchError` with `cause` and `context` attached. The constructor mints a fresh UUID
`errorId` and pulls `userMessage`/`priority`/`httpStatus` from the catalog entry. Exported
but has no importers outside this file.

### `handleApiError(error, request?, contextOverrides?): NextResponse<ApiErrorBody>`

The main entry point, and the only export other files actually use.

1. `deriveContext` (private): if a `NextRequest` is given, fills `route` (URL pathname) and
   `method` unless the caller's `contextOverrides` already set them.
2. `toFabOrchError` → structured log via `logger.fabOrchError(fabErr)`.
3. **REQ-03 persistence — fire-and-forget:** `recordError(fabErr, {...}).catch(() => {})`.
   The response is **not** awaited on the DB write, and its failure is **double-swallowed**:
   the `.catch(() => {})` here is empty (no log), and `recordError` itself wraps its insert
   in `try { … } catch { return null; }` (its comment defers to CloudWatch). A dead
   `error_audit_logs` / `error_audit_daily_counter` table is therefore invisible from the
   request path — exactly the [03 §6 silent-failure hazard](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors).
4. Responds `NextResponse.json({ error: { errorId, type, priority, message } })` at
   `fabErr.httpStatus`.

Note the `errorId` sent to the client is the **UUID**, not the human `ERR-YYYYMMDD-NNNN`
id that `recordError` mints during (async) persistence — the two are linked only through
the `error_uuid` column in `error_audit_logs`.

### `withErrorHandling(handler): RouteHandler`

Higher-order wrapper: `try { handler(...) } catch → handleApiError(error, request)`. The
Fab file header says "Wrap your route handlers in withErrorHandling()," **but no route in
either app imports it** at this commit — routes call `handleApiError` inside their own
`catch` blocks instead. Dead export / aspirational comment.

### `buildErrorBody(error, context?): ApiErrorBody`

Builds the envelope JSON without a `NextResponse`, per its comment "used by streaming
routes that need to inject the envelope into an SSE stream." **Also has zero importers** —
Fab's `app/api/chat/route.ts` builds its SSE error payload inline (≈ lines 1134–1141)
rather than calling this.

### `ApiErrorBody` (interface)

The wire shape: `{ error: { errorId: string; type: FabOrchErrorType; priority: 'HIGH' |
'MEDIUM'; message: string } }`. Imported nowhere else, but is the de-facto REQ-01
client contract.

## Failure modes & gotchas

- **Substring classification misfires** (hotspot row 8, confirmed): any message containing
  "database", "econnrefused", or "enotfound" → `SQL_CALL_FAILURE`; "session" or
  "unauthorized" → `SESSION_TIMEOUT` (a 401 that can look like a logout to the client);
  "timeout" anywhere wins over everything after it. Classification quality depends
  entirely on upstream error-message wording.
- **Everything unrecognized is "LAMBDA_MCP_CRASH."** A plain `TypeError` in route code, a
  thrown string, an Anthropic API error with no matching substring — all surface to the
  user and the audit table as a Lambda/MCP backend crash (HTTP 500). Convenient fallback,
  misleading taxonomy.
- **Audit persistence failure is silently swallowed twice** (empty `.catch(() => {})` here
  + internal `catch` in `recordError`). Resilient by design, but there is no
  application-side signal if REQ-03 persistence stops working.
- **Unauthenticated `SESSION_TIMEOUT`s are deliberately never persisted** —
  `error-audit.ts::shouldPersist` skips `SESSION_TIMEOUT` without a `userId` (anti-noise),
  so most 401s exist only in CloudWatch logs, not in `error_audit_logs`.
- **Two exports are dead and their comments are misleading** (`withErrorHandling`,
  `buildErrorBody` — see above). The [01 file-catalog row](../01-file-catalog.md) lists
  `withErrorHandling` among the key exports; at this commit nothing calls it.
- **The funnel is not actually on every route.** Only ~4 Fab and ~5 Admin routes (plus
  `requireAuth` in both auth-middlewares) route errors through `handleApiError`; other
  routes still return ad-hoc plain-JSON errors that never hit classification or REQ-03
  persistence.
- **Envelope content differs by app at runtime** — not because of this file, but because
  Fab's `FabOrchError` reads message/priority/status from the runtime `error_catalog` DB
  loader (hotspot row 7) while Admin's reads the frozen in-code catalog. Same thrown
  error can produce different `message` text per app.

## Open questions for the code owner

1. Is the substring-based `classifyError` acceptable as-is (hotspot row 8), given that any
   "database"-mentioning message becomes `SQL_CALL_FAILURE` and any "session"-mentioning
   message becomes a 401 `SESSION_TIMEOUT`? Should classification prefer typed causes
   (error classes / codes) over message text?
2. Are `withErrorHandling` and `buildErrorBody` intended future API, or dead code? Should
   the header comment ("wrap your route handlers…") and `buildErrorBody`'s "used by
   streaming routes" claim be corrected?
3. Is it intended that most routes do *not* funnel through `handleApiError` — i.e., that
   REQ-01/REQ-03 coverage is partial at this commit?
4. Is the double-swallow of `recordError` failures (empty `.catch`) acceptable, or should
   the outer catch at least log ([03 §6](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors)
   asks to "verify each swallow actually logs" — this one does not)?
5. Confirm the client-facing `errorId` (UUID) ↔ human `ERR-…` id correlation via
   `error_uuid` is the intended support workflow.

## Both-apps note

**Functionally identical — a byte-level diff shows only comment differences.** The Fab
copy carries the full doc comments (header, per-function JSDoc, the "Prisma P2025" and
"never let audit-log failure break the request" remarks); the Admin copy strips them down
to a one-line header (`"…centralized API error handler (admin app)"`) and a short
`// REQ-03 — persist to error_audit_logs. Fire-and-forget.`. Every declaration, condition,
and constant is the same. Copy-paste drift risk is therefore currently zero *in this
file* — but the envelope each app actually emits still diverges downstream via
`faborch-errors.ts` (Fab: DB-backed catalog loader; Admin: frozen in-code catalog).
