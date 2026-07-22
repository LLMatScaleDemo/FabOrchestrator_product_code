# `lib/cmf/types.ts` — CMF wire types and the inverted operation enum

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab** (`claudeai_athena/lib/cmf/types.ts`; Admin has no copy — see the Both-apps
> note) · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 14](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The single TypeScript source of truth for talking to the Critical Manufacturing (CMF/MES)
Master Data Load REST API: the assembly-qualified `$type` strings CMF demands in every
body, the request/response envelope shapes, the business-object shapes
(`MasterDataPackage`, `CmfFile`, …), and four small numeric enums. It contains **no
functions and almost no runtime code** — the one runtime export is the `CMF_TYPES` string
map. Its importance is concentrated in one type: `ExecutionOperation`, whose values are
**inverted relative to CMF's nominal documentation** (`0` commits to the live factory,
`1` is the dry-run). Hotspot row 14: *"a wrong constant here silently commits to the
factory."*

The file header claims the shapes were "Verified against live install at
`atscmapp4.usa.athenatec.com` (CMF 10.2.7), tested 2026-05-20" — a claim this doc has
**not** re-verified (🔵), and the reference it cites does not exist in the repo (see
gotchas).

## Depends on / consumed by

**Depends on:** nothing. Zero imports — no modules, env vars, or services. Pure
declarations plus one `as const` object.

**Consumed by** (verified by import grep at the pinned commit — all Fab, no Admin
consumers):

- **CMF client:** [`lib/cmf/cmf-client.ts`](./cmf-client.md) — the only importer of the
  full set (`CMF_TYPES`, all request/response envelopes, `ExecutionOperation`,
  `PollResult`, …). Every wire body it sends/parses is typed here.
- **API routes:** `app/api/cmf/packages/route.ts` (`CMF_TYPES.MasterDataPackage` as a
  query filter value + `MasterDataPackage`), `app/api/cmf/packages/[id]/load/route.ts`
  and `.../validate/route.ts` (`UserFriendlyObjectType`; both also reference
  `ExecutionOperation` in comments and pass its literal values — see the call-site table).
- **Local mirror / reconcile:** `lib/repo-cmf/packages.ts`, `lib/repo-cmf/reconcile.ts`
  (`MasterDataPackage`).
- **Client-side UI:** `hooks/use-execution-run.ts` (`ExecutionLogEntry`,
  `ExecutionResult`, `MasterDataPackage`, `UserFriendlyObjectType`) and
  `components/cmf/{loader-wizard,execution-log-viewer,pre-execution-dialog,package-meta-card,object-type-selector}.tsx`
  (various subsets, type-only).
- **Indirectly:** [`lib/chat-cmf/tools.ts`](./chat-cmf-tools.md) does *not* import this
  file, but its `loadToCmf` tool passes the literal `0` into `loadMasterData(...)`, whose
  parameter is typed `ExecutionOperation` — making it a call site of the enum's risk
  surface without ever naming it.

## Function-by-function

There are no functions. The exports fall into four groups; the enum comes first because
it is the reason this file is High priority.

### `ExecutionOperation` — the inverted op code (the heart of the file)

Exact definition, lines 50–58, including the in-code warning comment:

```ts
/**
 * PerformMDP ExecutionOperation. NOTE: in this CMF deployment (EntegrisKSPUpgrade,
 * MES 10.2.7) the committing behavior is INVERTED from CMF's nominal docs —
 * verified against the live DB and the portal's own request:
 *   0 = Validate & Load — COMMITS to the DB (this is what the portal's "Load" sends)
 *   1 = Validate only   — reports counts but does NOT persist (dry-run)
 * Use 0 to actually load, 1 to validate without writing.
 */
export type ExecutionOperation = 0 | 1;
```

So: **`0` = Load (COMMITS to the live MES database); `1` = Validate (dry-run, nothing
persists)** — the opposite of what CMF's nominal docs say, per the comment (asserted
verified against the live DB and the CMF portal's own request on 2026-05-20; 🔵 not
re-verified here).

It appears in two wire positions: `PerformMasterDataPackageRequest.ExecutionOperation`
(what we send) and `MasterDataPackage.LastExecutionOperation?` (what CMF reports back).

**Every place a value is actually chosen** (grep-verified at `7976c78` — this is the
entire risk surface):

| Call site | Passes | Effect | Guardrails |
|---|---|---|---|
| `app/api/cmf/packages/[id]/load/route.ts:90` — `queueMasterDataExecution(id, 0, selectedTypes)` | **`0`** | **COMMIT** | Run lifecycle + 409 concurrency guard + audit ([scenario 04 path (a)](../scenarios/04-cmf-load.md)) |
| `app/api/cmf/packages/[id]/validate/route.ts:92` — `queueMasterDataExecution(id, 1, selectedTypes)` | `1` | dry-run | Same run/guard machinery, `operation:"VALIDATE"` |
| `lib/chat-cmf/tools.ts:633` — `loadMasterData(name, fileObj, 0)` | **`0`** | **COMMIT** (LLM-reachable, via `@deprecated` wrapper, ALL object types) | **None** — no run row, no concurrency guard, no audit ([scenario 04 path (b)](../scenarios/04-cmf-load.md)) |

Everything else only *forwards* an `op` it was given, never originates one — all in
[`cmf-client.ts`](./cmf-client.md): `performMDP(pkg, op, types)` (puts `op` into the
request body at line 291), `queueMasterDataExecution` → `performMDP`,
`executeMasterData` → `performMDP`, `loadMasterData` → `executeMasterData`. Both
choosing routes carry an adjacent comment restating the inversion (load route lines
87–89: "op=0 is the COMMITTING operation in this CMF deployment … op=1 reports success
but does NOT persist"; validate route lines 89–91 mirror it) — though both, and
`cmf-client.ts:422`, cite the file as "`lib/types.ts`", a stale path (it is
`lib/cmf/types.ts`).

### `CMF_TYPES` — the FQN `$type` string map (the only runtime export)

An `as const` object of 11 assembly-qualified .NET type names (e.g.
`"Cmf.Foundation.BusinessObjects.MasterDataPackage, Cmf.Foundation.BusinessObjects"`)
covering the three business objects and the input/output types for FileExists,
CreateObject, GetObjectById, GetMasterDataPackageObjectTypes, and
PerformMasterDataPackage. Per its comment, CMF "rejects paraphrases," so handlers must
emit these exact strings; the envelope types below pin each `$type` field to
`typeof CMF_TYPES.X`, so a wrong string in a typed body is a compile error. Used at
runtime by `cmf-client.ts` (every request body) and `app/api/cmf/packages/route.ts`
(as a filter value in a package-list query).

### Other numeric enums (all bare number-literal unions)

- `ExecutionResult = 0 | 1` — `LastExecutionResult`: **0 = success, 1 = failure**. Note
  the polarity trap: this shares the domain `{0, 1}` with `ExecutionOperation` but means
  something unrelated — and here `0` is the *good* outcome while for the operation `0` is
  the *dangerous* input.
- `ExecutionLogEntryState = 2 | 3` — per-entry log state: 2 = Success, 3 = Failed.
- `ObjectModelType = 1 | 2 | 3 | 4` — 1=Lookup, 2=Entity (Dynamic Model), 3=Generic
  Table, 4=Smart Table.

### Business objects and wire envelopes (grouped)

- **`CmfFile`** — file metadata; two wire quirks captured in comments: `Size` must be a
  **string** ("numeric Size is rejected") and `Checksum` is SHA-256 **uppercase** hex.
- **`MasterDataPackage`** — the central object. Carries `LastExecution*` readback fields
  (populated only after the first PerformMDP; `LastExecutionConfiguration` /
  `LastExecutionLog` are **JSON-encoded strings**, not objects), plus
  `LastOperationHistorySeq` / `LastServiceHistoryId` — optimistic-concurrency stamps that
  "must be echoed back on every write call" (this is why `cmf-client` re-fetches a fresh
  instance before each `performMDP`). Ends with an index signature
  `[extra: string]: unknown` so API-returned extras survive the echo — see gotchas.
- **`UserFriendlyObjectType`**, **`ExecutionLogEntry`** — the selectable object types and
  the parsed execution-log rows (counters, dates, `State`).
- **Request envelopes** — `FileExistsRequest`, `CreateObjectRequest`,
  `GetMasterDataPackageObjectTypesRequest`, `PerformMasterDataPackageRequest`. All pin
  `$id: "1"` and their `$type`. `PerformMasterDataPackageRequest` is where
  `ExecutionOperation` rides, alongside `ExecutionConfiguration` — commented
  "JSON-stringified UserFriendlyObjectType[]. NOT an object." — and
  `IsToPerformImmediate: boolean`.
- **Response envelopes** — `FileExistsResponse`, `CreateObjectResponse`,
  `GetObjectByIdResponse`, `GetMasterDataPackageObjectTypesResponse`,
  `PerformMasterDataPackageResponse`.
- **`PollResult`** — client-side composition (`result`, parsed `log`, `instance`) built
  by `cmf-client.pollForCompletion`.

## Failure modes & gotchas

- **The invert-on-refactor trap (hotspot [03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions)):**
  the inversion lives only in comments and in three hard-coded literals. Any tidy-up that
  "aligns the codes with CMF's docs" (swapping `0`↔`1`), or a copy-paste of the wrong
  literal into a new call site, turns validations into live factory commits — or loads
  into no-ops that still report success through reconcile. **Do not touch without a code
  owner.**
- **Nothing catches a swapped constant — compile time or runtime.** `ExecutionOperation`
  is a union of the *number literals* `0 | 1`; both values typecheck at every call site,
  and there are **no named constants** (no `OP_LOAD`/`OP_VALIDATE`) anywhere, so callers
  pass bare `0`/`1` with only adjacent comments as guardrails. At runtime CMF accepts
  both values and returns success either way — a validate-that-committed and a
  load-that-didn't are both invisible to the application. The only defenses at `7976c78`
  are the doc comment here and the comments at the two route call sites.
- **Same-domain enum with opposite polarity next door:** `ExecutionResult` also uses
  `{0, 1}` with `0 = success`. A reader (or a hasty refactor) conflating "0 is fine" from
  the result enum with the operation enum picks exactly the committing value.
- **The cited verification source is missing from the repo.** The header points to
  `../../CMF_API_Complete_Reference.md` (i.e. `claudeai_athena/CMF_API_Complete_Reference.md`);
  no file matching `CMF_API*` exists anywhere at `7976c78`. The "verified 2026-05-20"
  provenance for the inversion is therefore not checkable from this repo.
- **Stale comment paths:** three comments direct readers to "`ExecutionOperation` in
  `lib/types.ts`" (load route :89, validate route :91, `cmf-client.ts:422`); the real
  path is `lib/cmf/types.ts`. Harmless today, but these are the very comments guarding
  the landmine.
- **`MasterDataPackage`'s index signature weakens typo detection:** `[extra: string]:
  unknown` (intentional, to round-trip unknown API fields) disables excess-property
  checks, so a misspelled field on a package literal is silently absorbed rather than
  flagged by the compiler.
- **Type-only contract, no runtime validation:** these shapes assert what CMF sends;
  nothing parses/validates responses against them (no zod, no guards in `cmf-client`). If
  the live API drifts (e.g. a CMF upgrade), fields go quietly `undefined` — e.g.
  `pollForCompletion` maps a missing `LastExecutionResult` to `?? 1` (failure).

## Open questions for the code owner

1. Runtime-confirm the inversion: does `op=0` really commit and `op=1` really dry-run on
   the current deployment? (Hotspot [§8 Q8](../03-review-hotspots.md#8-open-questions-for-code-owners-consolidated),
   [scenario 04 §7](../scenarios/04-cmf-load.md).)
2. Is the inversion scoped to "EntegrisKSPUpgrade, MES 10.2.7", and what is the plan if
   a CMF upgrade restores nominal semantics?
3. Would you accept named constants (e.g. `EXECUTION_OP.LOAD` / `EXECUTION_OP.VALIDATE`)
   replacing the bare `0`/`1` literals at the three call sites?
4. Where does `CMF_API_Complete_Reference.md` live? (Cited as the verification record;
   absent from the repo.)
5. Is `loadToCmf` passing a hard-coded `0` through the `@deprecated` `loadMasterData`,
   with no confirmation gate, intended? (Hotspot rows 15/17;
   [./chat-cmf-tools.md](./chat-cmf-tools.md).)

## Both-apps note

**Fab only.** Verified at `7976c78`: `admin_athena` has no `lib/cmf/` directory and no
match for `ExecutionOperation` or `CMF_TYPES` anywhere in its source. Admin's CMF-adjacent
surface (`app/api/admin/cmf-loads/route.ts`, the data-loader dashboard) reads the shared
DB's run/package tables via Prisma — it never touches these wire types or calls CMF.
