# `lib/errors/sql-guard.ts` — the read-only-SQL regex guard (currently enforced nowhere)

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/errors/sql-guard.ts` and `admin_athena/lib/errors/sql-guard.ts`) —
> logic is identical, only comments differ; see the Both-apps note. ·
> Review priority: **Med** (Fab, [01 §A.2](../01-file-catalog.md)) / **High** (Admin, [01 §B.1](../01-file-catalog.md)) ·
> Hotspot: [03 §1 row 24](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance) and
> [03 §5 — Raw SQL & injection surface](../03-review-hotspots.md#5-raw-sql--injection-surface)

## Purpose

A regex/keyword check that classifies a SQL string as "read-only" (SELECT / WITH / SHOW /
EXPLAIN, with no DDL/DML keywords) and an assert wrapper that throws the canonical
`DDL_DML_REJECTED` error otherwise. The Fab copy's header comment states the intent:
FabOrch accepts no user-authored SQL today, and this guard exists as **defense in depth**
for "any future raw-SQL path". It implements the REQ-01 `DDL_DML_REJECTED` error type's
guard side.

**The headline finding of this page: at the pinned commit, no application code in either
app calls this module.** Its only importers are unit tests. Every raw-SQL execution site
in both apps runs without passing through it (see next section).

## Depends on / consumed by

**Depends on:** only `./faborch-errors.ts` — `FabOrchError.ddlDmlRejected` (→ type
`DDL_DML_REJECTED`, HIGH priority, HTTP 403 per the catalog defaults). No DB, no network,
no env vars; the check itself is pure string logic.

**Consumed by** (verified by grepping `sql-guard`, `isReadOnlySql`, and
`assertReadOnlySql` across the whole repo at the pinned commit):

- *Fab:* **only** `claudeai_athena/__tests__/errors/faborch-errors.test.ts` (unit tests).
  Zero runtime call sites.
- *Admin:* **only** `admin_athena/__tests__/errors/faborch-errors.test.ts` (unit tests).
  Zero runtime call sites.

For contrast, the raw-SQL surfaces that *could* have been behind this guard but are not:
Admin's `lib/admin-tools.ts` (eight `$queryRawUnsafe` calls in the chat tools, including
an `UPDATE error_catalog` in `update_error_catalog_message`), `lib/session-audit.ts`,
`lib/prompt-audit.ts`, `lib/errors/error-audit.ts`, `lib/services/usage-service.ts`, and
the `dashboard`/`usage`/`compliance` admin routes. All of these execute
**developer-authored** SQL template strings with `$1`-style parameter placeholders — user
input travels as parameters, not as SQL text — so the guard is arguably unnecessary for
them; but it means the module currently enforces nothing anywhere.

## Function-by-function

### `isReadOnlySql(sql: string): boolean` — both apps

Pure predicate, no side effects. The pipeline:

1. **Strip comments:** removes `-- …` to end-of-line and `/* … */` block comments
   (`COMMENT_PATTERN`, applied globally/multiline), then trims. Empty result → `false`.
2. **Keyword blocklist:** rejects if `FORBIDDEN_PATTERN` matches — any of 13 keywords
   (`DROP, DELETE, TRUNCATE, ALTER, CREATE, INSERT, UPDATE, GRANT, REVOKE, EXEC, EXECUTE,
   MERGE, CALL`), case-insensitive, when immediately preceded by start-of-string,
   whitespace, `;`, or `(`, and followed by a word boundary.
3. **Head allowlist:** strips leading whitespace/`(`, uppercases the first 8 characters,
   and requires the statement to start with `SELECT`, `WITH`, `SHOW`, or `EXPLAIN`.

So: "starts like a read, contains none of 13 write-ish keywords at token boundaries."

**Bypass shapes the regex misses by construction** (described as input shapes only —
each passes the check while doing more than reading):

- **String-literal / comment confusion:** the comment stripper is not SQL-aware. A
  statement whose *string literal* contains `--` causes everything after it on that line
  — including a semicolon and a second, forbidden statement — to be deleted *before* the
  check runs. The check sees a harmless prefix; the database receives (and executes) the
  full original text, because `assertReadOnlySql` returns the **unstripped** input.
  Dollar-quoted strings (`$$…$$`) confuse it the same way.
- **Keywords not on the list:** the blocklist omits Postgres write/DoS-capable verbs such
  as `COPY`, `DO`, `SET`, `LOCK`, `VACUUM`, and `REFRESH`. Most are caught incidentally
  by the head allowlist (they don't start with SELECT/WITH), but combined with the
  stacking trick above the list gap matters.
- **Writes hiding inside an allowed head:** a statement that starts with `SELECT` can
  still write — `SELECT … INTO <new table>` creates a table with no listed keyword, and
  `SELECT my_function(…)` executes whatever side effects the function has (the guard
  cannot know a function writes). `EXPLAIN ANALYZE` *executes* the statement it explains.
- **Multiple statements:** nothing requires a single statement. A batch of
  semicolon-separated statements passes as long as each forbidden keyword is masked by
  one of the tricks above.

**False positives too:** a forbidden word inside a *legitimate* string literal, preceded
by a space (e.g. filtering a text column for a value containing ` drop `), is rejected —
the pattern doesn't know it's inside quotes.

### `assertReadOnlySql(sql: string, route?: string): string` — both apps

Wrapper: if `isReadOnlySql` is false, throws
`FabOrchError.ddlDmlRejected(undefined, { route, extra: { sqlPreview: sql.slice(0, 200) } })`;
otherwise returns the input **unchanged** (no sanitization, no normalization). The thrown
error carries the first 200 characters of the offending SQL in its context — that preview
flows into the error-audit trail via `api-error-handler.ts`, which is useful for
debugging but worth knowing when auditing what gets persisted.

## Failure modes & gotchas

- **Zero enforcement anywhere (per the grep above):** the guard is dead code at runtime
  in *both* apps, not just Fab. Nothing fails when it's wrong — and nothing is protected
  when it's right. Its existence (plus passing unit tests) can create a **false sense of
  security**: a reviewer seeing "REQ-01 DDL/DML guard" may assume raw-SQL paths go
  through it. They don't.
- **Bypassable by construction:** it's a keyword blocklist over regex-stripped text, not
  a SQL parser. The hotspots doc's verdict stands: defense-in-depth only, never the sole
  boundary. The real boundary must be the DB role's privileges.
- **Check ≠ execute mismatch:** the check runs on comment-stripped text but the caller
  gets back the original string — the string-literal trick above exploits exactly this
  gap.
- **If it is ever wired up**, expect occasional false rejections of legitimate SELECTs
  whose string literals contain blocklisted words.
- The two copies are maintained independently (no shared package) — a fix applied to one
  can silently miss the other (same drift hazard as the rest of `lib/errors/`, see
  [03 §6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs)).

## Open questions for the code owner

1. Do the apps' `DATABASE_URL` credentials use a least-privilege / read-only role — the
   only defense on the raw-SQL surfaces
   ([03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface))?
2. Is a raw-SQL path planned that will call `assertReadOnlySql`, and is the team aware
   the check is bypassable?
3. Confirm this is dead code in *both* apps at `7976c78`, and update
   [03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface) ("unused in Fab"
   implies Admin uses it).
4. If ever enforced, should the guard be backed by a real mechanism
   (`default_transaction_read_only`, a read-only role, or a SQL parser)?

## Both-apps note

Functionally **identical** — same 13 keywords, same regexes, same two exports, same error
context. The only differences are comments: the Fab copy has the explanatory header
("FabOrch never accepts user-authored SQL today… defense in depth… any future raw-SQL
path must pass through this function") and JSDoc on both functions; the Admin copy has a
one-line header and no JSDoc. Note the *catalog* rates them differently — Fab **Med**
(flagged "currently unused"), Admin **High** — presumably because Admin is where the raw
SQL lives; but the usage picture is the same in both: tests only.
