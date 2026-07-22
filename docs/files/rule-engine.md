# `lib/validation/rule-engine.ts` — the deterministic R1–R6 rule gate for master-data files

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/validation/rule-engine.ts`; no Admin copy — see
> Both-apps note) · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.4](../01-file-catalog.md) · Hotspot: [03 §1 row 18](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The deterministic, pure-function rule engine for pre-flight validation of CMF master-data
rows: given a parsed sheet, a CMF-derived ruleset ([metadata.ts](./validation-cmf-queries.md)),
and a precomputed parent-existence resolver, it returns every violation of rules
**R1 required / R2 max-length / R3 numeric / R4 boolean / R5 regex / R6 parent-FK**. No
I/O, no LLM — same input always yields the same result. The hotspots doc calls it "the
only hard pass/fail gate" before a factory commit; note, however, that only findings with
`severity: "error"` block (`validate.ts` computes `ok = errorCount === 0`), and the file's
own header comment states a deliberate **severity philosophy**: checks the code trusts
(R1 on plain text columns, R2, R5) emit blocking errors, while checks where CMF metadata
"can't be fully trusted" (R3/R4 on enum-by-name columns, R6 on mis-mapped targets) are
**downgraded to non-blocking warnings**, deferring to "CMF's own dry-run [as] the
authoritative gate."

## Depends on / consumed by

**Depends on:** type-only imports — `EntityRuleset` from `lib/validation/metadata.ts`
(see [validation-cmf-queries.md](./validation-cmf-queries.md)) and
`ParsedSheet`/`ValidationError` from `lib/validation/types.ts`. No runtime dependencies,
no env vars, no I/O — the CMF/file lookups are injected as the synchronous
`parentExists` callback (built by `referential.ts::buildParentIndex`).

**Consumed by** (verified by import grep at the pinned commit):
- `lib/validation/validate.ts` — `runRules` inside `validateFile` /
  `validatePreflightFromSheets`, the pipeline orchestrator: parse workbook →
  `loadRuleset` per sheet → `buildParentIndex` (file + CMF) → **`runRules`** →
  `runCrossChecks` (CMF round-trips). Structure/template conformance is a separate,
  earlier layer (`template-check.ts` / `structure-check.ts`).
- `lib/validation/validate-rows.ts` — `runRules` inside `validateRows`, the file-less
  variant for in-memory rows (built for the AI template-builder so the chatbot and the
  loader "share ONE implementation of the rule logic").
- `lib/validation/referential.ts` — imports only the `ParentExists` type.

⚠️ **Statically unwired at this commit:** no route, chat tool, or other module imports
`validate.ts` or `validate-rows.ts` (grepped for `validateFile`, `validatePreflightFromSheets`,
`validateRows`, `checkExistingNames`, `checkParents`, and every `validation/validate*`
path form — zero callers). The staging route
`app/api/cmf/packages/stage/[id]/validate/route.ts` explicitly says it is a
"Template-conformance check only — … no rule-engine R1–R6", and
`app/api/cmf/packages/[id]/validate/route.ts` queues **CMF's own remote dry-run**
(`queueMasterDataExecution(id, 1, …)`) instead. So as far as static reading shows, R1–R6
never execute on any live path at `7976c78`. See open question 1.

## Function-by-function

### `runRules(sheet, ruleset, parentExists): ValidationError[]` — the only function export

Iterates every row × every property in the ruleset and emits findings. Per rule:

- **R1 — required value** (`category: "required"`). Empty cell on a `mandatory` property
  that is *not* system-managed (see skip-list below). **Severity is conditional:**
  - **Downgraded to `warning`** when the column is numeric-ish (`scalarType === "Bit"`
    or in the `NUMERIC` set: BigInt/Int/SmallInt/TinyInt/Decimal/Numeric/Float/Real/
    Money/SmallMoney) **or** has any `referenceTargetType`. The in-code comment gives
    the why: "CMF defaults numeric / boolean columns on insert, and the
    referenceTargetType from `metadata.ts` is unreliable for some columns (notably
    `Type` — the join mis-resolves) so we can't be sure the column is really a hard
    reference."
  - **Hard `error`** only for text columns with no FK metadata ("Description /
    free-text fields the preparer genuinely needs to fill").
- **R1 row summary** (`category: "required-summary"`, `column: null`). When a row has
  **≥ 3** missing user-fillable mandatories, one summary line lists them all; its
  severity "tracks the worst individual finding" — `error` only if at least one miss was
  a hard error, else `warning`.
- **R2 — max length.** `val.length > scalarSize` → always **error**.
- **R3 — numeric parse.** `scalarType` in `NUMERIC` and `Number(val)` not finite →
  **warning** when the column has a `referenceTargetType` **or** the type is Int-family
  (`NUMERIC_INT_LIKE`: BigInt/Int/SmallInt/TinyInt) — comments explain the value may be
  a parent/enum *name* CMF resolves to an ID on load. Only a non-numeric value in a
  **non-int numeric column with no FK metadata** (Decimal/Numeric/Float/Real/Money/
  SmallMoney) is a hard **error**. (The file-header comment says "R3 numeric … emit
  `warning`" — the code is slightly stricter than the comment.)
- **R4 — boolean.** `scalarType === "Bit"` and value not in
  `{0,1,true,false,yes,no,y,n}` → **always `warning`** ("CMF may coerce; verify on
  load").
- **R5 — regex.** `validationRegex` mismatch → **error**. An invalid stored regex is
  swallowed by `try { … } catch { /* ignore … rather than block */ }` — a broken pattern
  silently disables the rule for that column.
- **R6 — parent FK** (`category: "parent-fk"`). `referenceTargetType` set and
  `parentExists(target, value)` false → **always `warning`**. The comment is explicit
  about why it can't block: "the metadata join in `metadata.ts` mis-maps the target for
  some columns (e.g. `Type` is resolved to wildly different EntityTypes because
  ReferencedObjectId collides across tables), and numeric FKs are loaded by ID, not
  Name. The cross-check layer does the authoritative per-target lookup."

Header matching is case-insensitive (`valueFor` tries exact key, then a lowercase scan);
values are trimmed before checks; an empty *optional* cell skips all further checks.

### The `SYSTEM_MANAGED` skip-list + private `isSystemManaged(name)`

Columns CMF auto-populates on insert — they come back `IsMandatory=true` from metadata,
"but preparers must NOT supply them"; skipping them "eliminates the bulk of pre-flight
false positives." Effects: an **empty** system column is never a required-miss; a
**non-empty** one skips R2–R6 entirely ("values there are advisory and CMF overwrites
them anyway"). The set (14 literals, matched lowercase): `Id`, `Version`,
`UniversalState`, `RevisionState`, `IsDefaultRevision`, `CreatedBy`, `CreatedOn`,
`ModifiedBy`, `ModifiedOn`, `LastOperationHistorySeq`, `LastServiceHistoryId`,
`LastCorrelationID` + `LastCorrelationId` (both lowercase to the same key — one is
redundant), `HoldCount` — plus a `/count$/` suffix rule for CMF-maintained `*Count`
aggregates (which also makes the `HoldCount` literal redundant). **This is a private
duplicate of, and has drifted from, `system-columns.ts::isSystemManaged` — see gotchas.**

### Other exports

`export type ParentExists = (targetType: string, value: string) => boolean` — the
injected resolver contract ("exists in the file or in CMF"), also imported by
`referential.ts`. Everything else (`NUMERIC`, `BOOL_OK`, `mkError`/`mkWarn`, `valueFor`)
is module-private.

## Failure modes & gotchas

- **The downgrade means genuinely invalid rows can pass the only blocking gate.** A row
  missing a mandatory FK/numeric value, referencing a nonexistent parent, or putting
  text in an Int column produces only warnings; `validate.ts` returns `ok: true` when
  `errorCount === 0`. The next line of defense is CMF itself — and per
  [03 §4](../03-review-hotspots.md#4-cmf--the-physical-factory), the CMF batch is
  **atomic**: one bad row rolls back the entire package at load time instead of being
  caught pre-flight. The comments present this as deliberate (metadata can't be
  trusted; CMF dry-run is authoritative), but it inverts the "hard pass/fail gate"
  framing. ([03 §1 row 18](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)'s
  question.)
- **Mis-mapped reference targets are admitted in the comments.** Both the R1 and R6
  comments say `metadata.ts` mis-resolves `referenceTargetType` for some columns
  (`Type` collides on `ReferencedObjectId` across tables). So R6's warning text can name
  the *wrong* parent type, and the R1 downgrade fires for columns that only *look* like
  FKs. See [validation-cmf-queries.md](./validation-cmf-queries.md).
- **Two divergent system-column sets** ([03 §6 drift](../03-review-hotspots.md)) —
  this file's `SYSTEM_MANAGED` vs `lib/validation/system-columns.ts::SYSTEM_AUTOFILL`
  (used by the chat entry form and prefill engine in
  [chat-cmf-tools.md](./chat-cmf-tools.md)). Compared precisely at `7976c78`:
  - **Shared (11):** `Id`, `Version`, `UniversalState`, `RevisionState`,
    `IsDefaultRevision`, `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`,
    `LastOperationHistorySeq`, `LastServiceHistoryId`.
  - **Only in `SYSTEM_MANAGED` (rule engine):** `LastCorrelationID`/`LastCorrelationId`
    (one effective entry) and `HoldCount` (redundant with both suffix rules).
  - **Only in `SYSTEM_AUTOFILL` (form/prefill) — 14 entries:** `SystemState`,
    `IsTemplate`, `DataGroupId`, `DataGroupName`, `DocumentationURL`, `EntityPicture`,
    `Image`, `MainStateModelId`, `MainStateModelStateId`, `MainStateModelStateReason`,
    `ApprovalDate`, `Approver`, `CurrentSequence`, `LongText`.
  - **Suffix rules differ:** rule engine matches only `*Count`; `system-columns.ts`
    matches `*Count` **and** `*Counter`.
  - Consequence: a mandatory column in the AUTOFILL-only list (e.g. `SystemState`,
    `DataGroupName`) is hidden from the entry-form/prefill "required" UX yet flagged
    missing by the rule engine — as a **hard error** if it's a plain text column. The
    reverse holds for `LastCorrelationID` and `*Counter` columns.
- **The gate may not run at all at this commit.** As noted above, `validateFile` /
  `validateRows` have no static callers; the shipped validate button queues CMF's remote
  dry-run (op `1`) and the staging check is template-only. Either the wiring is dynamic/
  in-flight, or R1–R6 is currently dead code and the real gate is CMF.
- **Silent regex swallow (R5):** a malformed `validationRegex` stored in CMF disables
  format checking for that column with no warning anywhere.
- **`*Count` suffix is a heuristic:** any user column that happens to end in
  `count` is skipped by every check; the comment notes the loader also "rejects
  user-supplied values silently" for such columns.
- **Same-name function trap:** this file's private `isSystemManaged` and the exported
  `system-columns.ts::isSystemManaged` share a name but not behavior — an importer (or
  refactor) picking the "obvious" one changes which columns are validated.
- **R2 counts UTF-16 code units** (`val.length`) against `scalarSize` — may over/under
  count vs the DB's byte or character semantics for non-ASCII data. Minor.

## Open questions for the code owner

1. Is `runRules` reachable in production at `7976c78` (no importer found statically) — pre-flight wiring pending, dynamic, or removed?
2. Is the warning downgrade for R3/R4/R6 and for R1 numeric/FK-typed mandatories intended, leaving CMF's rollback as the only catch? (Hotspot row 18.)
3. Can the `metadata.ts` `Type`/`ReferencedObjectId` join collision be fixed so R6 becomes a blocking error?
4. Should `SYSTEM_MANAGED` be replaced by `system-columns.ts::isSystemManaged`, and which of the differing entry sets is correct?
5. Is the `*Count`-suffix skip safe — do any user-fillable columns end in "Count"?
6. Should an invalid stored `validationRegex` surface a finding instead of being silently ignored?

## Both-apps note

**Fab only.** `admin_athena/` has no `lib/validation/` rule engine and no occurrence of
`runRules`, `SYSTEM_AUTOFILL`, or a `rule-engine.ts` file (verified by glob + grep at the
pinned commit). Admin never touches CMF master-data loading.
