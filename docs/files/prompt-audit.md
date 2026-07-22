# `lib/prompt-audit.ts` — the REQ-04 prompt & response audit log

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/prompt-audit.ts` and `admin_athena/lib/prompt-audit.ts`) —
> **near-identical copies with one real divergence (the `model` column); see the Both-apps
> note.** · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.1 / §B.1](../01-file-catalog.md) · Hotspot: [03 §1 row 5](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Implements the REQ-04 prompt/response audit trail: every chat turn in either app gets a
row in `prompt_audit_logs` recording **who asked what, what the model answered, which
tools ran, how long it took, and what it cost** (per-turn token counts + USD cost
buckets). Note what that means: the table stores the **full prompt and response text plus
user name/email — PII** — capped at ~100 KB per field. The file also contains the regex
**topic classifier** that maps each prompt to one of the 7 Entegris use cases (or the
`AdminData` sentinel for admin-chat prompts). All writes are raw SQL
(`$executeRawUnsafe`/`$queryRawUnsafe`) because the audit tables are **not in
`schema.prisma`** ([03 §1 row 25](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)).

## Depends on / consumed by

**Depends on:** `lib/db.ts` (`prisma` singleton — raw SQL only, no Prisma models),
`node:crypto` (`randomUUID`), and two tables that exist **only as raw SQL DDL**
(`admin_athena/prisma/*.sql`): `prompt_audit_logs` and `prompt_audit_daily_counter`
(which needs a PK/unique on `counter_date` for the `ON CONFLICT` upsert to work).

**Consumed by** (verified by import grep at the pinned commit):
- *Fab:* `app/api/chat/route.ts` only — `recordPromptStart` / `recordPromptSuccess` /
  `recordPromptFailure` + the `PromptStartHandle` / `ToolCallSummary` types (opens the row
  as `PENDING` before streaming, closes it on success/error).
- *Admin:* `app/api/admin/chat/route.ts` — the same five imports for admin-chat turns;
  and `lib/admin-tools.ts`, which dynamic-imports `queryPromptAudit` (the
  `query_prompt_audit` chat tool) and `purgeOldPrompts` (the `purge_old_prompts` chat
  tool, gated on `confirm=true`).
- **Not** consumers, despite touching the same table: `app/api/admin/compliance/route.ts`
  (retention/redaction — its own raw SQL) and the `prompt_quality_summary` tool in
  `admin-tools.ts` (its own aggregate SQL). `session-retention-worker.ts` purges
  *session* logs only — it never calls `purgeOldPrompts`.
- Unused exports: `PROMPT_TOPIC_LABELS` and `classifyTopic` have no external importers in
  either app (`classifyTopic` is only called internally). In the **Fab copy**, the whole
  admin-query half (`queryPromptAudit`, `purgeOldPrompts`, the filter/row types) has no
  Fab caller — it is effectively dead code kept in sync by copy-paste.

## Function-by-function

### `recordPromptStart(params): Promise<PromptStartHandle | null>` — both apps

Opens the audit row before the LLM call: mints the human-readable prompt id via the
private `nextPromptId()` (an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` upsert
on `prompt_audit_daily_counter` → `PRO-YYYYMMDD-NNNN`), then inserts the row with
`status='PENDING'`, `NOW()` timestamp, user id/name/email, the (truncated) prompt text,
and the model id — all values parameterized (`$1..$7`). Returns
`{ rowId, promptId, startedAtMs, app }` for the close-out calls. **Any error returns
`null`** (empty `catch`, nothing logged) — the caller proceeds and the turn is simply
never audited.

### `recordPromptSuccess(p): Promise<void>` / `recordPromptFailure(p): Promise<void>` — both apps

Close the row opened by `recordPromptStart`:
- **Success:** classifies the topic (`topicOverride` wins, else `classifyTopic`), builds
  human-readable `query_executed` / `data_retrieved` summaries from the tool calls, sets
  `status='SUCCESS'`, the truncated `llm_response`, `response_time_ms`
  (`Date.now() - startedAtMs`), a `tool_calls` JSONB array of `{name, input, output}`
  (the private `buildToolCallsPayload`; per its comment, tool output already embeds the
  executed SQL via `_executed_sql`), and the six token/cost columns.
- **Failure:** picks `TIMEOUT` vs `FAILED` from `errorEnvelope.type` (or an explicit
  `status`, e.g. `CANCELLED`), preserves any `partialResponse` via
  `COALESCE($3, llm_response)`, and still writes response time + token/cost columns
  ("even failed prompts may have consumed tokens"). An in-code comment notes the
  `error_envelope` **column no longer exists** — the envelope is only used to pick the
  status, then discarded.

Both are parameterized `UPDATE … WHERE id = $1` and both **swallow every error in an
empty `catch` block** — best-effort by design ("never break the request"), but a dead
audit table is invisible even in logs (cf. [03 §6 silent-failure hazards](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors)).
Costs arrive here as **JS `number`s** (`PromptUsageBuckets`) and are bound into
`NUMERIC` columns — see gotchas.

### `classifyTopic(userPrompt, toolCalls, app): string | null` — both apps

The topic classifier. `app === 'faborch-admin'` short-circuits to the `'AdminData'`
sentinel **regardless of content** — which now doubles as the app-attribution flag (see
`queryPromptAudit`). Otherwise: two ordered, first-match-wins regex lists — first
`TOOL_TOPIC_PATTERNS` against the concatenated tool names + JSON-stringified args, then
`PROMPT_TOPIC_PATTERNS` against the raw prompt text; `null` if nothing matches. Pattern
order encodes precedence (e.g. outlier terms before OEE so "cycle-time outliers" isn't
swallowed by the broad equipment pattern; bare `equipment|machine` in the tool list is
very broad). Pure function, no side effects. `PROMPT_TOPIC_LABELS` exports the frozen
8-label list (7 use cases + `AdminData`) — currently unreferenced by either app.

### `queryPromptAudit(filters): Promise<{ rows, truncated }>` — code in both, executed only from Admin

The admin-side reader behind the `query_prompt_audit` chat tool. Builds a `WHERE` clause
dynamically: **every user-supplied value is parameterized** (`$1…$n` via the `push`
helper) — exact email, fuzzy `userKey` (three `ILIKE`s over name/email/local-part),
status, topic, `promptIdLike`, date range. The **interpolated** pieces are all internal
constants: status literals, the `topic_matched = 'AdminData'` translation of the legacy
`app` filter (the `app` *column* is gone from the table), and
``LIMIT ${limit + 1}`` where `limit` is first clamped
`Math.min(Math.max(1, filters.limit ?? 100), 1000)` — the `+1` over-fetch is how
`truncated` is detected; rows are sliced back to `limit`. Ordered `datetime DESC`,
snake_case → camelCase mapped. **Not** wrapped in try/catch — unlike the recorders, this
throws to the caller (the admin chat tool surfaces the error).

### `purgeOldPrompts(): Promise<number>` — code in both, executed only from Admin

`DELETE FROM prompt_audit_logs WHERE datetime < NOW() - INTERVAL '90 days'` (fixed
literal), returns the deleted count. Throws on error. Only caller is the
`purge_old_prompts` admin chat tool (`confirm=true` required) — **nothing schedules it**
([03 §6 un-scheduled retention](../03-review-hotspots.md#un-scheduled-retention)).

### Types & small helpers

`PromptAuditStatus` (`PENDING|SUCCESS|FAILED|TIMEOUT|CANCELLED`), `ToolCallSummary`,
`PromptStartParams`/`PromptStartHandle`, `PromptUsageBuckets` (the three token + three
USD-cost buckets: request = turn-1 input, retrieval = turns 2..N input, response = all
output), `PromptSuccessParams`, `PromptFailureParams`, `PromptAuditFilters`,
`PromptAuditRow`. Private: `truncate` (100 000-char cap + `[…truncated]` marker),
`nextPromptId`, `buildToolCallsPayload`, `buildQueryExecuted`, `buildDataRetrieved`.

## Failure modes & gotchas

- **PII retention:** full prompt + response text, tool inputs/outputs (including the SQL
  and rows the MCP tools returned), user name and email — kept 90 days by
  `purgeOldPrompts`, but that purge is **manual-only**. Separately, the Admin compliance
  route redacts *content* older than a configurable `auditRetentionDays`
  (platform_settings) while keeping metadata — so there are **two retention mechanisms
  with two different windows**, and `purgeOldPrompts`'s hard-coded 90 days ignores the
  configurable setting.
- **Audit failure is invisible:** all three recorders swallow errors in *empty* `catch`
  blocks — not even a `console.error` (the session-audit equivalents at least
  `.catch(log)`). If the table/counter is missing or the DB write fails, REQ-04 silently
  records nothing.
- **`recordPromptStart` returning `null` skips the whole turn's audit** — the close-out
  calls need the handle, so one failed insert (e.g. a missing
  `prompt_audit_daily_counter` unique constraint breaking the upsert) unaudits the turn.
- **Cost-number precision:** costs are *written* as JS `number`s (float64) into `NUMERIC`
  columns, and *read back* typed `string | null` (the Admin copy's comment: "NUMERIC
  comes back as string from pg to preserve precision"). The string typing is only
  honored until `admin-tools.ts` computes `totalCost` via `Number(...)` sums — the
  [03 §3](../03-review-hotspots.md#3-money--cost-accuracy) precision question therefore
  lives at both ends *outside* this file's SQL. Also verify at runtime that
  `$queryRawUnsafe` really returns NUMERIC as strings (Prisma has historically returned
  `Decimal` objects) — the `PromptAuditRow` typing is an unchecked `as` cast.
- **`LIMIT` interpolation is clamp-protected but string-built:** the interpolated value is
  `limit + 1` (so up to **1001** fetched, 1000 returned) after
  `Math.min(Math.max(1, …), 1000)`. Safe today; any future filter that routes user text
  into the interpolated parts (rather than through `push`) becomes injection
  ([03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface)).
- **ILIKE wildcards pass through:** `userKey`/`promptIdLike` are wrapped in `%…%` without
  escaping `%`/`_` — a user-supplied wildcard broadens the match (no injection, just
  looser filtering).
- **Stale header comment:** the file header still describes the "doc-spec 10-field set"
  and lists 12 columns — the code actually also writes `user_id`, `model`, `tool_calls`,
  and the six token/cost columns, and notes elsewhere that `error_envelope` and `app`
  columns were dropped. Trust the SQL, not the header.
- **Topic = app attribution:** since the `app` column was dropped, "came from the admin
  app" is encoded as `topic_matched = 'AdminData'`. A `topicOverride` or future
  classifier change that assigns `AdminData` to a Fab prompt (or vice versa) silently
  corrupts app-level reporting.
- **`nextPromptId` date formatting:** the `PRO-YYYYMMDD` prefix is built from the
  returned `counter_date` with *local-time* `getFullYear/getMonth/getDate` — if the Node
  process timezone and the DB `CURRENT_DATE` disagree, the printed date can be off by one
  from the counter's actual date (id-cosmetic only; the counter itself stays atomic).

## Open questions for the code owner

1. What runs `purgeOldPrompts`, and is its hard-coded 90 days meant to coexist with the
   configurable `auditRetentionDays` redaction?
   ([03 §6](../03-review-hotspots.md#un-scheduled-retention))
2. Is storing full prompt/response text + tool outputs (PII) for 90+ days acceptable?
   (Hotspot row 5.)
3. Should the recorders' empty `catch` blocks at least log?
   ([03 §7 task 3](../03-review-hotspots.md#7-where-to-start-contributing))
4. Is float64-into-NUMERIC cost storage, summed via `Number()` in `admin-tools.ts`,
   precise enough for billing? ([03 §3](../03-review-hotspots.md#3-money--cost-accuracy))
5. Should Admin's `queryPromptAudit` select the `model` column (the unused Fab copy
   does)?
6. Confirm `prompt_audit_daily_counter.counter_date` has the unique/PK the `ON CONFLICT`
   upsert requires in every environment.

## Both-apps note

Copy-paste twins, byte-identical in the taxonomy, classifier, recorders, filters, and
purge — with one functional divergence and two cosmetic ones:

| Aspect | Fab (`claudeai_athena`) | Admin (`admin_athena`) |
|---|---|---|
| `model` in `queryPromptAudit`/`PromptAuditRow` | **Yes** — selects `l.model`, maps `model: r.model`, `model: string \| null` in the row type | **No** — column not selected, field absent |
| `recordPromptStart` INSERT column order | `(…, user_prompt, status, model)` | `(…, user_prompt, model, status)` — functionally identical |
| Comments | — | Adds JSDoc on `model` param + the "NUMERIC comes back as string" note on `requestCost` |

The irony of the divergence: only the **Admin** copy's `queryPromptAudit` is ever
executed (via the admin chat tool), and it's the one *missing* `model` — the Fab copy's
richer query is dead code. So the stored `model` column is currently never surfaced
through this module's query path.
