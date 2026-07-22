# `lib/validation/*` + `lib/chat-cmf/*` (CMF-querying) — the eight files that build SQL against live CMF tables

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena`) · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 19](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance) + [03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface)

One combined page for the eight Fab files that share a single pattern: **SQL text built by
string-interpolating `[schema].[table]` (and sometimes column) identifiers, with all
*values* passed as mssql parameters**, executed through the shared read-only CMF SQL
connection ([`lib/cmf/cmf-sql.ts`](#the-connection-libcmfcmf-sqlts)). The files:

| File | Role |
|---|---|
| `lib/validation/metadata.ts` | Loads per-object CMF ruleset; **resolves the physical table** everyone else interpolates |
| `lib/validation/referential.ts` | Parent-existence resolver (file + CMF) for the rule engine |
| `lib/validation/parent-precheck.ts` | FK check of child rows against live CMF parent tables |
| `lib/validation/cross-check.ts` | CMF round-trip: exists / update / no-op, dependent sheets, parent-in-CMF notes |
| `lib/validation/validate-rows.ts` | File-less rule run over in-memory rows (built for the chatbot path) |
| `lib/chat-cmf/load-preview.ts` | Per-row CREATE / UPDATE / SKIP / CONFLICT preview of a staged .xlsx |
| `lib/chat-cmf/lookup-existing.ts` | Look up existing CMF rows by Name (`select *`) for update/clone/inspect intents |
| `lib/chat-cmf/prefill.ts` | Per-cell DB validation (mandatory/length/regex/FK) for the inline entry form |

Related pages (parallel deep-dives): [rule-engine.md](./rule-engine.md) (the deterministic
R1–R6 gate these feed), [chat-cmf-tools.md](./chat-cmf-tools.md) (the LLM tools that call
three of these files), [cmf-client.md](./cmf-client.md) (the HTTP client that performs the
actual load — a different connection entirely).

## Purpose

Everything on this page is **pre-flight, read-only reconnaissance against the live CMF
(Critical Manufacturing MES) SQL Server**: before a master-data load is committed via
`cmf-client`, these files answer "what rules does CMF enforce for this object type?",
"does this parent already exist?", "would this row be a create, an update, or a no-op?".
They never write to CMF. `metadata.ts` is the root of the group — it turns an object-type
*name* into a ruleset **plus the physical `{schema, name}` table** that every other file
then interpolates into its own queries.

## Depends on / consumed by

**Depends on (all eight):** `cmfQuery` from `lib/cmf/cmf-sql.ts` (mssql pool; env
`CMF_SQL_SERVER/DB/USER/PASS/INSTANCE`), and — for all but `metadata.ts` itself —
`loadRuleset` from `metadata.ts`. Extras: `parent-precheck.ts` + `load-preview.ts` +
`prefill.ts` use `removal-policy.ts`; `cross-check.ts` uses `structure-check.ts`
(`RELATIONSHIPS`); `load-preview.ts` uses `template-check.ts` (`readUploadSheets`);
`prefill.ts` uses `system-columns.ts`; `validate-rows.ts` uses `referential.ts` +
`rule-engine.ts`.

**Consumed by** (verified by import grep at the pinned commit — **and this is the page's
biggest surprise**):

| File | Consumers at `7976c78` |
|---|---|
| `metadata.ts` | `chat-cmf/tools.ts` (LLM toolset), `chat-cmf/{load-preview,lookup-existing,prefill}.ts`, `app/api/modeling-agent/chat/parent-options/[targetType]/route.ts`, and the four unwired files below; `rule-engine.ts` (types only) |
| `load-preview.ts` | `chat-cmf/tools.ts` → LLM tool `previewLoadImpact` (also referenced by `app/api/modeling-agent/chat/route.ts`) |
| `lookup-existing.ts` | `chat-cmf/tools.ts` → LLM tool `lookupExisting` |
| `prefill.ts` | `chat-cmf/tools.ts` → LLM tool `prefillFormFromInput` |
| `referential.ts` | **only** `validate.ts` and `validate-rows.ts` — both themselves unconsumed (below) |
| `cross-check.ts` | **only** `validate.ts` — itself unconsumed |
| `validate-rows.ts` | **none found** (no static or dynamic import anywhere in the app) |
| `parent-precheck.ts` | **none found** |

`lib/validation/validate.ts` (`validateFile` / `validatePreflightFromSheets`, the
orchestrator that would wire `referential` + `cross-check` into an upload flow) also has
**no importers** at this commit. The staging validate route
(`app/api/cmf/packages/stage/[id]/validate/route.ts`) runs only the template/structure
check and explicitly documents "no CMF round-trips, no rule-engine R1–R6, no
cross-checks". So at `7976c78` **the only live paths into this group are the three
chat-CMF LLM tools + the parent-options dropdown route**, all rooted in `loadRuleset`.
The other four files look like a built-but-not-yet-wired (or no-longer-wired) loader
pipeline — a code owner must say which.

## Shared mechanics

### The connection: `lib/cmf/cmf-sql.ts`

- Singleton `mssql` pool (max 5) to a **named SQL Server instance** resolved via SQL
  Browser (UDP 1434, dynamic port); connect/request timeouts 20 s/30 s (env-tunable), with
  an in-code warning not to shorten them (VPN + discovery cost).
- `encrypt: false` and `trustServerCertificate: true` — **unencrypted, unverified SQL
  traffic**, consistent with the CMF TLS posture flagged in
  [03 §6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs).
- "Read-only" is **a comment, not a mechanism**: `cmfQuery` will run any SQL it is given.
  Whether `CMF_SQL_USER` is actually a read-only login is a deployment fact this repo
  cannot show.
- `cmfQuery(query, inputs)` binds every entry of `inputs` as an mssql parameter
  (`@name`) — this is what makes the *values* side of the pattern safe.

### The interpolation pattern

Every query in the group has the same shape:

```ts
`select Name from [${table.schema}].[${table.name}] where Name in (@v0, @v1, …)`
```

- **Values are always parameterized** — names, FK values, object-type strings — batched
  in chunks of 500 to stay under SQL Server's 2100-parameter cap. No user *value* is ever
  concatenated into SQL. ✔ (matches the hotspot doc)
- **Identifiers are always interpolated**, bracket-quoted but **not `]]`-escaped**:
  table names (all eight files + the parent-options route), column lists
  (`cross-check.ts` `fetchCmfRows`, `load-preview.ts` step 1), and numeric caps
  (`top ${FK_QUERY_CAP}` = 5000, `top ${FK_OPTION_CAP + 1}` = 1001, `top ${MAX_OPTIONS + 1}`
  = 501 — all module-level constants, never inputs).

### Identifier provenance — the headline question (hotspot row 19)

Where do the interpolated identifiers actually come from? The chain, traced end-to-end:

1. **The entry input is user/LLM-influenced.** `objectType` arrives as an LLM tool
   argument (`chat-cmf/tools.ts`), a URL path segment (`parent-options/[targetType]`),
   or an uploaded workbook's sheet name (`load-preview`, and the unwired `validate.ts`
   path). Any of these can be arbitrary text.
2. **But it is only ever used as a parameterized value.** `loadRuleset(objectType)` runs
   three metadata queries (Smart → Generic → Entity tables `T_SmartTableProperty` etc.)
   with `@name = objectType`. No metadata match → `null` ruleset → every caller bails
   before building any interpolated query.
3. **The interpolated table name is an echo from `INFORMATION_SCHEMA`, not the input.**
   `resolvePhysicalTable` queries
   `INFORMATION_SCHEMA.TABLES where TABLE_TYPE='BASE TABLE' and TABLE_NAME = @t` with
   `@t = "T_ST_"|"T_GT_"|"T_" + objectType` (parameterized), and interpolates the
   **returned** `TABLE_SCHEMA`/`TABLE_NAME`. So the interpolated string is by
   construction the exact name of a base table that *already exists* in the CMF
   database. User/LLM input can only **select which existing table** is named — it
   cannot inject identifier text of its own, unless a base table whose name equals the
   injected string already exists.
4. **Column identifiers never come from user headers.** `cross-check.ts` interpolates
   `getDiffableColumns(ruleset)` — property names read from CMF's own metadata tables.
   `load-preview.ts` canonicalizes user-supplied column keys **through** the ruleset
   (`propByLower.get(lower)`); a header that doesn't match a CMF property name is simply
   dropped from the projection. `prefill.ts` interpolates no columns; `lookup-existing.ts`
   sidesteps the issue with `select *`.

**Verdict (🔵 Static): direct user/LLM text cannot reach an interpolated identifier.**
The trust anchor is the **content of the CMF database itself** — its metadata tables and
its `INFORMATION_SCHEMA`. Anyone who can write CMF metadata or create tables in that DB
(a CMF modeler/DBA, not an app user) could plant an identifier containing `]` and break
out of the un-escaped bracket quoting — but such an actor already has DB-level access and
doesn't need injection through this app. What a code owner must confirm is exactly that
boundary: **no app-side path lets an end user author CMF metadata** (property names,
table names) — e.g. via CMF's own modeling UI accounts shared with app users.

## Function-by-function

### `metadata.ts` — `loadRuleset(objectType)`, `getDiffableColumns(ruleset)`, `clearRulesetCache()`

`loadRuleset` tries Smart Table → Generic Table → Entity metadata (three parameterized
queries) and returns `{ objectType, model, table, properties }`, where `table` is the
`INFORMATION_SCHEMA`-resolved physical `{schema, name}` (or `null`) and each
`PropertyRule` carries mandatory/key flags, scalar type/size, optional `validationRegex`,
and `referenceTargetType` for FK columns. Results — **including `null` misses** — are
cached in a module-level `Map` for the process lifetime. `clearRulesetCache()` exists but
**is never called anywhere**, so metadata edits in CMF (new types, changed rules) are
invisible until the Node process restarts. `getDiffableColumns` = all non-key,
non-`Name` property names, used for update/no-op diffs.

### `referential.ts` — `buildParentIndex(references, fileKeysByType)`

Returns a synchronous `(targetType, value) => boolean` closure for the rule engine's R6
parent check. A parent "exists" if its key is in the uploaded file's own sheets OR in the
parent's live CMF table (batched, parameterized `IN` lookups on `Name`, chunked ×500, all
comparisons lower-cased). Types with no resolvable table silently contribute nothing —
their parents all read as missing. *Unwired at this commit* (only reachable via the
also-unwired `validate.ts` / `validate-rows.ts`).

### `parent-precheck.ts` — `checkParentReferences(rowsByType)`

For every FK column of every supplied type (deliberately **all** FK columns, not just
mandatory ones — see the in-code comment), verifies each distinct child value against
(a) `select top 5000 Name from [schema].[table]` (whole-table fetch, cached per parent
type) or (b) rows of the same payload. Returns `warnings` plus `dbReachable: false` when
any CMF lookup threw — in that degraded mode it only faults values missing from the file
itself. Note the `top 5000` has **no `order by`** and no `where`: a parent table with
more than 5000 rows yields an arbitrary subset, so real parents can be reported missing.
*Unwired at this commit* — no importers at all.

### `cross-check.ts` — `runCrossChecks(sheets, opts)`

Three best-effort checks, each individually try/caught (`console.error` + skip, so a CMF
outage never blanks the result): **exists/update/no-op** per row (fetches `Name` + the
diffable columns by interpolated column list, diffs with type-aware equality — `Bit`
synonyms, numeric compare — and treats blank file cells as "don't touch"; `Active` is
excluded via `NEVER_DIFF`); **dependent-sheets** (per hardcoded `RELATIONSHIPS`, one
sheet-level error listing parents that are in neither the file nor CMF); and
**parent-in-CMF info** notes. Emits `ValidationError`s with severity `info`/`error`.
*Unwired at this commit* (only via `validate.ts`).

### `validate-rows.ts` — `validateRows`, `checkExistingNames`, `checkParents`

The file-less twin of the loader validation: runs the same `runRules` R1–R6 over
in-memory `rows` for one object type (header comment says it was factored out so the
chatbot and the loader "share ONE implementation"), plus duplicate-key detection
(`checkExistingNames` — in-CMF and in-payload) and per-column missing-parent reporting
(`checkParents`). Degrades explicitly with `metadataMissing` / `tableMissing` flags.
Contains its own third copy of `lookupExistingNames`. *Unwired at this commit* — despite
the header comment, nothing (including `chat-cmf/tools.ts`) imports it.

### `load-preview.ts` — `previewLoadImpact(bytes)`

LLM-tool backend (Phase 2 of the AI Template Builder). Parses the staged .xlsx, and per
sheet: removed object types → whole sheet CONFLICT (blocks load); no metadata/table →
every row optimistically CREATE with `metadataMissing: true`; otherwise **one batched
`IN`-query** projecting `[Name]` + only the user-supplied columns that canonicalize to
ruleset properties (comment: blindly projecting all metadata properties raised
`Invalid column name 'Id'`), plus **one `IN`-query per FK target table**. Verdict order:
CONFLICT (any unresolvable FK — CMF's atomic batch would roll back the whole package) →
CREATE → SKIP/UPDATE by exact-string diff of supplied, non-empty cells (`"1"` vs
`"1.0"` counts as a change here, unlike `cross-check.ts`'s numeric-aware diff). FK
targets with no resolvable table are **passed through as existing** ("can't verify →
pass through").

### `lookup-existing.ts` — `lookupExisting(objectType, names)`

One parameterized `IN`-query returning **`select *`** on the physical table — the
in-code comment says this is intentional (projecting metadata property names is what
caused the `Invalid column name 'Id'` failures) and notes identifiers are "bracket-quoted
CMF metadata strings, which we already trust elsewhere". Every column of each found row
is stringified and returned to the LLM/prefill flow, with a parallel `notFound` list and
`metadataMissing` degrade. Consequence of `select *`: **any column CMF stores on that
table — including internal/system ones — is handed into the chat context.**

### `prefill.ts` — `prefillFormFromInput(objectType, rows)`

Per-cell validation for the inline entry form. Loads up to 1001 parent `Name`s per FK
target (`top ${FK_OPTION_CAP + 1} … order by Name`); over the 1000 cap → `fk-unknown`
(yellow), never a false red. Cell statuses: `required-missing`, `too-long`, `regex-fail`
(compiles CMF's `validationRegex` via `new RegExp`; an invalid pattern is **silently
skipped**), and FK resolution: exact → `fk-resolved`, case-insensitive/substring/
char-overlap ≥ 0.6 → `fk-fuzzy` with up to 3 suggestions, else `fk-missing` (blocker).
Unknown columns are flagged as "will be ignored", missing mandatory columns are surfaced
unless system-managed (`system-columns.ts`) or removed by the client's template policy.
No metadata at all → every cell passes through as `"ok"` with `metadataMissing: true`
(the LLM is trusted to tell the user nothing was checked).

## Failure modes & gotchas

- **Half the group is unreachable at the pinned commit.** `parent-precheck.ts`,
  `validate-rows.ts`, `referential.ts`, `cross-check.ts` (and their orchestrator
  `validate.ts`) have no live callers — the staging validate route runs only the
  template check. Either the deep pre-flight pipeline was never wired in, or it was
  unwired. Until that's resolved, statements like "cross-checks run before load" are
  **not true at runtime**, and [03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions)'s
  atomic-rollback concern rests entirely on `load-preview.ts` + the tool description.
- **The identifier trust anchor is the CMF DB itself.** Bracket quoting without `]]`
  escaping means a hostile table or property name in CMF breaks the query (see
  provenance verdict above). Low practical risk (requires CMF DB write access), but the
  guard is provenance, not escaping.
- **"Read-only" is unenforced.** `cmf-sql.ts` says "treat this as read-only"; only the
  privileges of `CMF_SQL_USER` make it true. Hotspot §5's own recommendation
  (least-privilege read-only role) is a deployment question, not visible in code.
- **`select *` in `lookup-existing.ts`** returns every physical column to the LLM
  context — confirm CMF tables carry nothing sensitive (audit columns, internal ids are
  certainly included).
- **Process-lifetime ruleset cache, including negative results.** A typo'd object type
  is cached as `null` forever; a *newly created* CMF type stays invisible until restart.
  `clearRulesetCache()` is dead code.
- **`resolvePhysicalTable` takes `rows[0]` with no `order by`** — if the same table
  name exists in two schemas, which one wins is nondeterministic.
- **`parent-precheck.ts`'s `top 5000` without `order by` or a `where`** can silently
  drop real parents on large tables → false "missing parent" warnings (moot while
  unwired, a trap if re-wired).
- **Three private copies of `lookupExistingNames`** (`referential.ts`,
  `cross-check.ts`, `validate-rows.ts`) — a drift hazard of exactly the kind
  [03 §6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs) catalogs.
- **Two different definitions of "changed".** `cross-check.ts` diffs with Bit/numeric
  awareness; `load-preview.ts` diffs raw trimmed strings — the same file could preview
  as UPDATE in one path and no-op in the other.
- **Optimistic degradation everywhere.** No metadata → `load-preview` marks all rows
  CREATE; unresolvable FK target table → FK values pass as existing; `prefill` with no
  metadata → all cells "ok". Each is flagged (`metadataMissing`), but the flag's only
  consumer is the LLM's judgment.
- **CMF-authored regex is executed** (`new RegExp` in `prefill.ts`, and in
  `rule-engine.ts`) — a pathological pattern in metadata is a ReDoS-shaped surface;
  an invalid one is skipped with no log.

## Open questions for the code owner

1. Confirm CMF property/table names are authored only by trusted CMF modelers/DBAs — no app-user or LLM path can influence them. (Hotspot row 19 / §5.)
2. Is `CMF_SQL_USER` a read-only login?
3. Are `parent-precheck.ts`, `validate-rows.ts`, `cross-check.ts`, `referential.ts`, and `validate.ts` intentionally unwired at `7976c78`?
4. Is `select *` in `lookup-existing.ts` acceptable given rows reach LLM context, or is a system/sensitive-column deny-list needed?
5. Is the never-refreshed ruleset cache (including cached `null`) acceptable, or should `clearRulesetCache` be wired to something?
6. Confirm `encrypt: false` / `trustServerCertificate: true` on the CMF SQL connection is the intended production posture
   ([03 §6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs)).

## Both-apps note

**Fab only.** Verified at the pinned commit: `admin_athena` has no `lib/validation/`
directory of this kind, no `lib/chat-cmf/`, no `cmf-sql.ts`, and no `cmfQuery` usage.
(Admin does import from `@/lib/validation` — but that is its unrelated **Zod schema
module** `lib/validation.ts`; a name collision only, no CMF SQL involved.)
