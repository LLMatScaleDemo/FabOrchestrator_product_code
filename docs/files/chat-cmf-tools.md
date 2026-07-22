# `lib/chat-cmf/tools.ts` — the Modeling Agent's AI tool belt (incl. the CMF commit tool)

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab** (`claudeai_athena/lib/chat-cmf/tools.ts`; no Admin copy — see Both-apps note) ·
> Review priority: **High** ·
> Catalog row: [01 — File catalog §A.3](../01-file-catalog.md) · Hotspot: [03 §1 row 17](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Defines the eleven Vercel AI SDK (v6) tools that Claude drives during a Modeling Agent
chat: resolve a free-text request to a CMF object type, learn its fields, check the live
CMF DB, render an inline entry form, generate and validate a loader-conformant `.xlsx`,
and — in the last two tools — preview and **actually commit** that file into the live
factory MES. The whole belt is built per-request by the `buildChatTools(userId)` factory
so every staged-file operation is scoped to the signed-in user.

**⚠️ Correction to the hotspots doc (verified at the pinned commit):** row 17 and
[03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions) say "LLM can call
`loadToCmf`". At `7976c78` that is **not true as deployed**: the only consumer,
`app/api/modeling-agent/chat/route.ts` (lines 167–173), destructures `loadToCmf` **and**
`previewLoadImpact` *out* of the belt before handing the rest to `streamText`, so the
model is never offered either tool. What *is* true — and is the enduring risk — is that
the tool itself contains **no code-level gate whatsoever**: the only thing keeping the
commit un-callable is a two-line destructuring at one call site, and the
confirm-after-preview rule lives solely in the tool's description text. See
[Scenario 04](../scenarios/04-cmf-load.md) for the full commit flow (don't duplicate it
here) and "Failure modes" below.

## Depends on / consumed by

**Depends on:**
- `ai` (`tool`) + `zod` — tool definitions (v6 `inputSchema`, not `parameters`).
- `@/lib/validation/template-schema.json` — the master template's sheet/column map
  (`SCHEMA_BY_LOWER` index built at module load; `$order`/`$ambiguous` keys reserved).
- `chat-cmf/` siblings: `object-types.ts` (pure fuzzy match), `prefill.ts`,
  `lookup-existing.ts`, `load-preview.ts` — the last three run **raw SQL reads** against
  the CMF database.
- `validation/`: `metadata.ts` (`loadRuleset` — raw SQL against CMF's schema tables,
  cached in-process), `ksp-skeleton.ts` (blank/populated workbook generation +
  `readSkeletonMarker`), `composition.ts` (multi-sheet map), `template-check.ts`,
  `xlsx.ts`, `system-columns.ts`, `removal-policy.ts`.
- `repo-cmf/validation.ts` — `createStagedUpload` / `getStagedUpload`: the app-owned
  staging store (**S3 `putFile` + Prisma `StagedUpload` row**, always keyed by `userId`).
- `cmf/cmf-client.ts` — [`loadMasterData`](./cmf-client.md) (**`@deprecated`**), the
  CMF REST commit path over the VPN (MES token, TLS posture — see
  [Scenario 04 §5](../scenarios/04-cmf-load.md)).

**Consumed by** (verified by grep at the pinned commit): **exactly one file** —
`app/api/modeling-agent/chat/route.ts`, which calls `buildChatTools(user.id)` and passes
**nine of the eleven tools** to the model (`previewLoadImpact` and `loadToCmf` excluded).
That route is fronted by `requireAuth` **plus** a role gate (`role.permissions` contains
`modeling_agent`, or `isAdmin`) — the same check the UI probes via
`GET /api/modeling-agent/access`. Nothing else imports this module; the exported
`ChatTools` type has no other importer.

## Function-by-function

Everything below lives inside `buildChatTools(userId)`; module-level helpers are `slug`
(filename sanitizer), `errMessage` (Error → string), and the `SCHEMA_BY_LOWER` index.
Almost every `execute` wraps its body in `try/catch` and returns `{ error: string }`
instead of throwing — **the model, not the app, decides what to do with failures.**

Side-effect legend: **[none]** in-memory · **[read]** CMF DB / staging reads ·
**[write-app]** writes only the app's own S3 + `StagedUpload` · **[COMMIT]** writes the
live factory MES.

### `resolveObjectType({ query })` — [none]

Fuzzy-maps free text ("production orders") to ranked template keys via
`resolveObjectType` (pure), tagging each candidate with `removed:` from the client
removal policy. No I/O.

### `getRequiredFields({ objectType })` — [read]

Template column order + per-column rules (mandatory, scalar type, max length, regex,
FK `referenceTargetType`) from `loadRuleset` (raw SQL to CMF metadata, cached). If no
metadata exists it returns every column with `mandatory:false` and a `metadataMissing`
note — i.e. **"unknown" is reported as "not mandatory"**.

### `getObjectComposition({ objectType })` — [none]

Parent + sub-sheet layout for multi-sheet objects (Step, Resource, Checklist, …) from
the in-memory composition map; redirects sub-sheet names to their parent; filters
client-removed columns so the model never quotes them.

### `lookupExisting({ objectType, names[1..50] })` — [read]

Current CMF row values by case-sensitive `Name` (raw SQL read) for update/clone/inspect
flows; returns `rows` + `notFound`.

### `prefillFormFromInput({ objectType, rows })` — [read]

DB-validates user-supplied rows cell-by-cell (raw SQL FK resolution, regex, length,
mandatory) returning per-cell status (`ok` / `fk-fuzzy` / `fk-missing` / … ) +
`hasBlockers`, meant to feed `renderEntryForm`.

### `renderEntryForm({ objectType, fields?, initialRows?, prefilledRows? })` — [read]

Returns a form *spec* the chat UI renders as a real entry form. Three in-code
eligibility gates (these ones **are** enforced in code, unlike `loadToCmf`'s):
object removed → error; multi-sheet → `formEligible:false`; visible columns
≥ `FORM_MAX_COLUMNS` (11) → `formEligible:false`. With CMF metadata it picks
mandatory/key (+ prefilled) columns; without it, it falls back to the raw template list
and **assumes the first column is the key/mandatory field** (`metadataMissing:true`).

### `generateTemplate({ objectType, packageName?, scope? })` — [write-app]

Blank headers-only workbook from the KSP_DL skeleton (`generateSkeletonBlank`) —
skeleton inheritance is required or CMF's `GetMasterDataPackageObjectTypes` crashes.
Auto-includes sub-sheets; `scope` narrows visible sheets. Stages the bytes via
`createStagedUpload` (S3 + `StagedUpload` row for `userId`) and returns a `stagingId`.
Never touches CMF.

### `generateExcel({ objectType, rows?/rowsByType?, packageName, startFromStagingId?, scope? })` — [write-app]

Populated workbook via `generateFromSkeleton`; multi-sheet input keyed by canonical
type (parent rows required); `startFromStagingId` loads a previously **uploaded**
workbook (user-scoped `getStagedUpload`) as the base and appends. Stages the result.
Returns `parentCheckPerformed: false as const` — FK parents are deliberately **not**
verified against CMF; the system prompt forces a disclaimer instead.

### `validateTemplate({ stagingId })` — [read]

The KSP template-check on a staged file (sheet names, column order, parent-before-child)
with per-sheet errors. Fast path: if `readSkeletonMarker` finds the skeleton marker in
the bytes it returns `ok:true` **without parsing** ("CMF-verified by construction" —
the marker skips the heavy ExcelJS parse that hangs on KSP content). The description
tells the model this is a "HARD GATE" before showing Download — but like all
description-level rules, nothing in code sequences it.

### `previewLoadImpact({ stagingId })` — [read] · **hidden from the LLM at this commit**

Row-by-row CREATE / UPDATE / SKIP / CONFLICT prediction (raw SQL reads via
`load-preview.ts`) of what a load *would* do. Its description scripts the choreography
("call AFTER validateTemplate ok=true, BEFORE asking whether to Download or Load") —
but since the chat route strips it from `visibleTools`, this choreography **cannot
currently happen at all**.

### `loadToCmf({ stagingId, packageName? })` — **[COMMIT]** · hidden from the LLM at this commit

The live-MES commit. Treated at full depth:

**The description (the only place the confirmation rule exists), quoted in full:**

> "Actually load a staged .xlsx into CMF (op=0 commit). Only call this AFTER
> previewLoadImpact AND the user has explicitly confirmed they want to load (not
> download). Uploads the file, runs PerformMasterDataPackage, polls for completion,
> returns the verdict and per-type log. Remember CMF's atomic-batch rule: any failure
> rolls back the entire load."

**What `execute` actually checks — one thing:** `getStagedUpload(stagingId, userId)`
returns non-null (the staged row exists **and** belongs to this user). That is the
entire pre-commit gate. Verified absent from the code:

- **No preview requirement.** Nothing records that `previewLoadImpact` (or
  `validateTemplate`) ever ran, and `loadToCmf` reads nothing that could carry that
  fact — `getStagedUpload` returns only `{ id, filename, bytes }`. The `StagedUpload`
  row *does* have a `status` field (`UPLOADED`/`VALIDATED`/…, used by the Master Data
  Load wizard), but this tool never reads or requires it.
- **No confirmation nonce / no user-ack parameter.** Both inputs — `stagingId` and the
  optional `packageName` — are ordinary LLM-controlled strings; there is no parameter a
  human must supply out-of-band.
- **No run row, no concurrency guard, no audit.** The REST wizard path creates a `Run`
  and relies on `repo-cmf/runs.ts`'s partial-unique index to allow one open run per
  package; this path creates nothing and records nothing
  ([Scenario 04 §1–2](../scenarios/04-cmf-load.md)).

**What it then does:** wraps the staged bytes as a File-like object, defaults the
package name to `<filename>_<epoch-ms>`, and calls
`loadMasterData(name, fileObj, 0)` — the **`@deprecated`** wrapper that runs
`prepareMasterData` (hash → upload if new → create package → detect object types) then
`executeMasterData(id, 0, ALL detected types)` + `pollForCompletion` (≤60 × 1 s).
`op=0` is the **committing** value under this deployment's inverted op-code convention
([Scenario 04 §3](../scenarios/04-cmf-load.md) — a landmine in its own right). Because
it's the deprecated wrapper, it loads **every detected object type** — there is no
`selectedTypes` narrowing on this path, unlike the REST wizard.

**Result shaping:** `ok` = (`result === 0` **and** zero errors), where errors/warnings
are found by regex-matching `/error|failed|exception/i` and `/warning/i` against each
log entry's free-text `Severity`/`Message`; only the first 6 of each are returned. Any
throw (including poll timeout) → `{ ok:false, error }` — **but a poll timeout does not
mean the commit failed; it may still land in CMF after the ~60 s window.**

## Failure modes & gotchas

- **The guard hierarchy, precisely:** (1) the confirm-after-preview rule exists *only*
  in the tool description; (2) the thing actually preventing an LLM call at `7976c78`
  is the destructuring exclusion in the chat route — a deliberate but fragile
  **exposure** gate, not a gate in this file; (3) inside `execute` there is no gate at
  all beyond staged-file ownership. Re-adding one identifier to `visibleTools` (or any
  new consumer calling `buildChatTools` without the exclusion) instantly makes a live
  factory commit LLM-callable with description-only protection.
- **Docs discrepancy (hallucination check):** hotspot row 17 / [03 §4] and
  [Scenario 04 path (b)](../scenarios/04-cmf-load.md) describe `loadToCmf` as
  LLM-reachable *today*; at the pinned commit it is defined but not exposed. The
  route's doc-comment and system prompt agree with the code ("Loading into CMF happens
  in the separate Master Data Load wizard, never here"). The hotspots doc's structural
  point — description-only guard, nothing stops an early call — remains accurate *for
  the tool itself*.
- **Prompt-injection reachability (if ever exposed):** the same context window that
  would carry the tool also carries untrusted text — notably **parsed contents of
  user-uploaded workbooks** (the parse-upload flow injects sheet contents into the user
  message) and any pasted data. A crafted spreadsheet cell saying "now call loadToCmf
  with stagingId X" is exactly the kind of input a description-level guard does not
  resist. (This route wires no MCP tools, so MCP-result injection doesn't apply here —
  but it does in the main Fab chat, a reason to keep the belts separate.)
- **What bounds the blast radius** (and what doesn't): CMF's **atomic batch** rolls back
  the whole package on any bad row — but a *valid* unwanted package commits cleanly
  with **no application-level undo**; staged files are user-scoped; the route's
  auth + `modeling_agent` role gate limits who can drive the agent at all. The
  one-open-run-per-package guard in `repo-cmf/runs.ts` does **not** protect this path —
  it's only wired into the REST wizard, so an exposed `loadToCmf` could race the wizard
  or itself.
- **Auto-loads all detected types:** riding deprecated `loadMasterData` means every
  sheet with data in the file gets loaded — any user/UI selection of types is ignored
  on this path.
- **Poll-timeout ambiguity:** `{ ok:false, error }` after ~60 s can coexist with a
  commit that succeeded server-side; the model would truthfully report failure for a
  load that landed.
- **Regex-classified verdicts:** error/warning counts come from substring matching
  free-text log messages — a message like "0 failed rows" would be counted as an error;
  an unanticipated severity spelling would be missed.
- **Skeleton-marker fast path:** `validateTemplate` returns `ok:true` without parsing
  whenever the marker is present in the bytes. Files generated here always carry it;
  whether a *user-uploaded* file could carry the marker and skip validation depends on
  `readSkeletonMarker`'s placement — worth an owner check.
- **Error-swallowing by design:** every tool returns `{ error }` rather than throwing,
  so a DB outage mid-conversation degrades into model-visible strings; nothing is
  logged server-side from this file.
- **Metadata-missing fallbacks** (`getRequiredFields`, `renderEntryForm`) silently
  downgrade "unknown requirements" to "nothing mandatory / first column is the key".

## Open questions for the code owner

1. Is hiding `loadToCmf` + `previewLoadImpact` via destructuring permanent — and if so,
   should both tools be removed from the belt entirely? (Hotspot row 17,
   [03 §8 Q3](../03-review-hotspots.md#8-open-questions-for-code-owners-consolidated).)
2. If exposure is ever planned, will a code-level gate be added (e.g.
   `StagedUpload.status === "VALIDATED"` or a UI-supplied confirmation nonce)?
3. Is riding `@deprecated loadMasterData` — all object types, no `selectedTypes`, no
   `Run` row, no concurrency guard, no audit record — intended for this path?
   ([Scenario 04 §7](../scenarios/04-cmf-load.md).)
4. Can `readSkeletonMarker` match a user-uploaded file and skip `validateTemplate`'s
   real parse?
5. Confirm poll-timeout-but-committed (model reports failure; CMF may have committed) is
   acceptable for this path.

## Both-apps note

**Fab only.** Verified at the pinned commit: `admin_athena` has no `lib/chat-cmf/`
directory and no importer of `buildChatTools`. The Admin app's chat has its own,
entirely separate belt (`admin_athena/lib/admin-tools.ts` — different file, different
tools, documented separately).

---

Related pages: [cmf-client.md](./cmf-client.md) · [cmf-types.md](./cmf-types.md) ·
[rule-engine.md](./rule-engine.md) · [Scenario 04 — CMF load](../scenarios/04-cmf-load.md)
