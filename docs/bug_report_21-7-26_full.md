# Bug Report — Master Data Loader (FabOrchestrator.ai / Modeling Agent)

---

## Issue # 1

**Issue details:** Data is written into the wrong column of the generated Excel, and the agent misreports where it wrote it. "Entegris" entered as the **Enterprise** value on the Site sheet was written into the **DataGroup** column (cell C2), while the agent's chat confirmation claimed it was placed in Enterprise. Validation still reported the file as clean. Root cause (confirmed in code): `generateFromSkeleton()` in `lib/validation/ksp-skeleton.ts` writes cells by position using the client-filtered column list (`template-overrides.json` removes DataGroup + 3 RemoteExport columns from Site), but the shipped template `templates/KSP_DL_client_final.xlsx` still contains all 8 original Site columns in its header row — the build step that was supposed to bake the removals in (`scripts/build-client-final-excel.ts`) does not exist in the repo. Every column after the first removed one shifts left; affects all object types with removed columns (Site, Enterprise, Area, Reason, Step, Resource, BOM, Config, and others). The mismatch is never caught because `validateTemplate` short-circuits on the skeleton marker and never parses file contents.

**Report date:** 7/21/2026

**Priority:** Critical (silent data corruption; bad master data can be loaded into CMF)

**Supporting document / screenshot / details:** Screenshot `Bug_ 2026-07-21 141238.png` (Entegris visible under DataGroup header); downloaded file `Site_Site_SITE-A (1).xlsx` (row 2 verified byte-for-byte: `A=SITE-A, B=Plant A, C=Entegris`, D empty); code refs `lib/validation/ksp-skeleton.ts:474-516` (positional write, headers untouched), `lib/validation/template-overrides.json` (Site removedColumns), `lib/chat-cmf/tools.ts:552` (validation fast path). Recommended fix: rebuild the client-final template with removals baked into headers; map values by reading the sheet's actual header row instead of by schema position; make validation read back written rows.

**Test outcome:** FAIL — reproduced and root cause confirmed against file bytes and code.

**Proposed fixes (in order of confidence):**
1. **Write by header name, not position (primary fix).** In `generateFromSkeleton()` (`ksp-skeleton.ts:474-516`), before emitting rows for a sheet, parse the sheet's actual row-1 header (the code already has the XML in hand as `sheetXml`; header cells are shared-string or inline-string — a small helper resolving both is ~30 lines). Build `headerName → column index` and place each value at its real column; drop values whose header is a client-removed column. This fixes fresh generations AND the upload-append path, where headers are user-controlled and positional writing is always unsafe.
2. **Rebuild the shipped template.** Recreate the missing `scripts/build-client-final-excel.ts`: for every type in `template-overrides.json → removedColumns`, apply the existing `rewriteHeaderRow()` logic to `KSP_DL.xlsx` and save as `templates/KSP_DL_client_final.xlsx`. This restores the invariant the code already assumes. (Do this *and* fix 1 — fix 1 protects against future drift.)
3. **Make self-verification real.** In `validateTemplate` (`tools.ts:552`), after the skeleton-marker fast path, add a cheap read-back for the sheets listed in `sheetsWritten`: unzip, read row 1 + the appended rows, and assert each written value sits under its intended header. Only touched sheets are parsed, so it stays fast. Return `ok=false` with a precise sheet/column message on mismatch.

---

## Issue # 2

**Issue details:** The Index sheet of every generated file contains the full master catalog (all object types) even when the user requested an object-specific file, so every download looks like the full template. Sheet *hiding* works correctly (only the requested object's sheets plus meta sheets are visible), but the Index content itself is never reduced. Root cause (confirmed in code): `Index` is listed in `META_SHEET_NAMES` in `lib/validation/ksp-skeleton.ts:294-301` ("never hide, never strip rows from"), and both generation paths copy it through untouched from the master template; no code path prunes or rewrites it.

**Report date:** 7/21/2026

**Priority:** High

**Supporting document / screenshot / details:** Downloaded file `Site_Site_SITE-A (1).xlsx` — 206 of 213 sheets correctly hidden (only Site + meta sheets visible) yet the Index sheet still holds 235 rows listing the entire catalog, presumably including the 28 object types removed for this client. Code ref `lib/validation/ksp-skeleton.ts:294-301`. Recommended fix: rewrite the Index rows during generation to match the kept/visible sheets (same mechanism as the existing header rewrite); at minimum strip the 28 removed object types from the shipped template's Index.

**Test outcome:** FAIL — reproduced and root cause confirmed in the delivered file.

**Proposed fixes (in order of confidence):**
1. **Prune Index rows to the kept sheets at generation time.** In both `generateSkeletonBlank` and `generateFromSkeleton`, after computing the visible/kept sheet set, rewrite the Index sheet with the existing row-regex machinery (a predicate variant of `stripDataRows()`): keep the header row plus only rows whose object-type cell matches a kept sheet name, and renumber the surviving rows' `r` attributes. For scope='full', leave the Index as-is.
2. **Strip client-removed object types from the shipped template's Index permanently** (the 28 entries in `removedObjects`) as part of the template rebuild in Issue #1 fix 2 — those types can never be generated, so they should never be listed.
3. **Regression guard:** before rollout, upload one narrow-scope file with a pruned Index to CMF's `GetMasterDataPackageObjectTypes` in a test environment to confirm CMF doesn't dictionary into Index rows (the skeleton approach exists precisely because CMF is strict about OOXML pieces). If CMF rejects a pruned Index, fall back to hiding the Index sheet's non-relevant rows via row-level `hidden="1"` attributes instead of deleting them — visually identical for the user, byte-compatible for CMF.

---

## Issue # 3

**Issue details:** No download button/link appears for a generated file, even after the user explicitly asks to regenerate. In the "pre-fill Flow template with ALL IN ONE - BULK records" flow, the agent twice announced `Flow_allinone_bulk_flow.xlsx` was generated, validated, and "ready to download," but no download card rendered — and the agent invented UI guidance (scroll down / refresh / check a Downloads area) that does not exist. Root cause (confirmed at architecture level): the download card is rendered only by a client-side fallback (`components/agent-chat/modeling-chat-app.tsx:1320-1340`) that requires the generateExcel/generateTemplate tool part to end in a clean success state with a stagingId; the server route emits no file part itself, so any tool failure silently suppresses the button. Probable trigger (needs logs/DB to close): the tool's input schema requires all cell values to be strings, while rows echoed from CMF contain booleans/numbers (`IsEnabled: true`, `ChildType: 0`), which the schema rejects. Compounding: the "never reveal Download until validation passes" rule exists only in the system prompt, and `validateTemplate` returns ok=true for any skeleton-marker file — including a stale stagingId from an earlier turn — so the agent can claim success with no fresh file staged.

**Report date:** 7/21/2026

**Priority:** High

**Supporting document / screenshot / details:** Chat transcript (payload in `docs/bug_report_21-7-26.txt`) — compare the earlier turns where attachments rendered (`Flow_Flow_template.xlsx`, `Reason_Flow_and_Reason.xlsx`) against the failing prefill turns with none. Code refs `components/agent-chat/modeling-chat-app.tsx:1320-1340`, `lib/chat-cmf/tools.ts:38` (string-only row schema), `lib/chat-cmf/tools.ts:552` (validation fast path). To close the diagnosis: pull the assistant message `parts` for that conversation from the Message table (or server logs) and check the generateExcel part's state/errorText. Recommended fix: emit the file part server-side when a staged upload is created; coerce non-string cell values in the tool schema; reject stagingIds not created in the current turn; surface tool errors visibly.

**Test outcome:** FAIL — reproduced in session; architectural cause confirmed, exact trigger pending log/DB confirmation.

**Proposed fixes (in order of confidence):**
1. **Emit the file part server-side.** In `app/api/modeling-agent/chat/route.ts`, inside `createUIMessageStream`'s `onFinish` (and into `dbParts` for reloads), scan `responseMessage.parts` for `tool-generateExcel`/`tool-generateTemplate` outputs carrying a `stagingId` and append a `file-download` part (`fileId: stagingId`, `filename`, xlsx mimeType, `downloadUrl: /api/modeling-agent/chat/download/<stagingId>`). The client already renders `file-download`/`data-fileDownload` parts (`modeling-chat-app.tsx:1280-1304`), so the button stops depending on tool-output sniffing entirely.
2. **Coerce non-string cell values in the tool schema.** Replace `rowSchema = z.record(z.string(), z.string())` (`tools.ts:38`) with `z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]).transform(v => v == null ? "" : String(v)))`. This removes the most likely failure trigger (CMF-echoed `true`/`0` values rejected by Zod) at zero risk — the writer already emits strings.
3. **Enforce freshness in `validateTemplate`.** `createStagedUpload` already stores a timestamp; have `validateTemplate` return `stale: true` (and `ok: false`) when the stagingId wasn't created within the last N minutes / current request, so the model can't rubber-stamp an old file after a failed regeneration.
4. **Make tool failures visible in the UI.** In `modeling-chat-app.tsx`, when a `generateExcel`/`generateTemplate` part ends in `output-error`, render an explicit red "file generation failed: <errorText>" card instead of nothing — so a missing button is never silent again.

---

## Issue # 4

**Issue details:** The agent fabricates CMF query results, and the lookup tool cannot return multiple revisions of an object. (a) In the transcript the agent reported a search for "Bulk" returning "98 matching Flow records (showing the first 50)" and later a 4-row table of ALL IN ONE - BULK records with differing per-row values — outputs no exposed tool can produce: there is no pattern-search tool at all, and `lookupExisting` cannot return more than one row per name. These results were fabricated, which also puts the agent's "4 rows filled from CMF" claim for `Flow_allinone_bulk_flow.xlsx` in doubt. (b) Code defect: `lookupExisting` (`lib/chat-cmf/lookup-existing.ts:66-75`) returns rows in a dictionary keyed by Name; CMF flows are revision-versioned (multiple physical rows share one Name), so all revisions collapse to a single entry (last row wins) — multi-revision objects can never be looked up correctly.

**Report date:** 7/21/2026

**Priority:** High (trust/integrity — the agent confidently narrates operations that never happened, inflating the severity of Issue #3)

**Supporting document / screenshot / details:** Chat transcript turns "Can you tell me why the all in one bulk flow objects are not listing?" through "Can you check if all in one bulk flow exists?" (payload in `docs/bug_report_21-7-26.txt`); code refs `lib/chat-cmf/lookup-existing.ts:66-75` (Name-keyed map), `lib/chat-cmf/tools.ts` (tool inventory — no pattern-search tool exposed). Recommended fix: return an array of rows with revision identifiers instead of a Name-keyed map; add a real pattern-search/browse tool if that capability is wanted; forbid the model from citing counts/records absent from tool results.

**Test outcome:** FAIL — fabrication evidenced by transcript vs. tool inventory; lookup data-shape defect confirmed in code.

**Proposed fixes (in order of confidence):**
1. **Return all matching rows from `lookupExisting`.** Change the result shape in `lib/chat-cmf/lookup-existing.ts` from `rows: Record<name, row>` to `rows: Array<Record<string, string>>` (keep every revision; include distinguishing columns like Revision/Id in each row) plus `matchCount`. Update the tool description and the prefill/renderEntryForm consumers. This makes multi-revision objects (flows) actually inspectable.
2. **Add a real `searchExisting` tool** (parametrised `LIKE`-search on Name, capped at 50 rows, returning `totalCount`). The transcript shows users *expect* pattern search ("98 records… showing 50" is exactly this shape) — giving the model the real capability removes the incentive to fabricate it.
3. **Harden the system prompt** in `app/api/modeling-agent/chat/route.ts`: add an explicit rule — "Never state record counts, search results, or table contents that do not appear verbatim in a tool result from this conversation. If you lack a tool to answer, say so." The prompt already forbids guessing generally; this names the specific failure.
4. **Optional guardrail:** log a `prompt_audit` warning when an assistant turn contains phrases like "N records" with no tool call in that turn — cheap detection for regression testing of fabrication.

---

## Issue # 5

**Issue details:** Uploading a master-data spreadsheet through the loader wizard fails with a bare "Upload failed / HTTP 413" toast for any file larger than ~1 MB. Root cause (confirmed in config + code): in the deployed environment every request passes through nginx (ALB → nginx:80 → Next.js container:3000, per `claudeai_athena/DEPLOYMENT.md:35`), and nginx's `client_max_body_size` directive — which defaults to **1 MB** — is never raised: the repo's nginx override `claudeai_athena/.platform/nginx/conf.d/proxy.conf` sets only streaming timeouts, and nothing in `.ebextensions/` touches it either. Oversized uploads are therefore refused by nginx with `413 Request Entity Too Large` **before the application ever runs** — the staging route (`app/api/cmf/packages/stage/route.ts`) checks auth and `.xlsx` type but has no size check and no 413 path, and no app code anywhere emits 413. The unhelpful error message is a secondary symptom: nginx returns an HTML error page, so the wizard's `res.json()` fails and the toast falls back to the raw status (`components/cmf/loader-wizard.tsx:1026-1027`) instead of a friendly `{error: {title, description}}` message; the failure never enters the app's error-handling/audit system at all. `admin_athena` ships the identical 6-line `proxy.conf`, so the Admin app shares the same 1 MB ceiling.

**Report date:** 7/23/2026

**Priority:** High (blocks the master-data load workflow for any realistic workbook over 1 MB; deployed environments only — not reproducible locally, where no nginx sits in front of the app)

**Supporting document / screenshot / details:** Runtime observation: loader wizard "Upload and verify" → toast "Upload failed / HTTP 413". Config/code refs: `claudeai_athena/.platform/nginx/conf.d/proxy.conf` and `admin_athena/.platform/nginx/conf.d/proxy.conf` (no `client_max_body_size`; nginx default is 1 MB), `claudeai_athena/.ebextensions/01-alb.config` (no override), `app/api/cmf/packages/stage/route.ts` (no size check or 413 path), `components/cmf/loader-wizard.tsx:1026-1027` (bare-status fallback toast). Quick confirmations: a workbook under 1 MB uploads through the same wizard; DevTools Network shows the 413 response body is nginx HTML, not app JSON. Sizing ramifications to weigh when picking the new limit: the staging route buffers the whole file in Node memory (`Buffer.from(await file.arrayBuffer())`, `stage/route.ts:56`); nginx enforces the ceiling before auth, so the limit is also the unauthenticated request-body exposure on every route (can be location-scoped to the upload path); and larger accepted workbooks mean heavier xlsx parsing/LLM validation and bigger CMF register pushes, aggravating the known AI-path poll-timeout issue where a slow load is reported failed though the commit may still land (`docs/06-error-and-recovery-matrix.md`). Choose the ceiling from the largest legitimate workbook (10–25 MB), not the technical maximum.

**Test outcome:** FAIL — 413 observed at runtime in the deployed environment; root cause confirmed statically (no size limit raised in any repo config; no app-level 413 source exists).

**Proposed fixes (in order of confidence):**
1. **Raise the nginx limit (primary fix).** Add `client_max_body_size 25M;` (or a ceiling sized to real workbooks) to `.platform/nginx/conf.d/proxy.conf` in **both** `claudeai_athena` and `admin_athena`, then redeploy. Optionally scope it to the upload route only (`location /api/cmf/packages/stage { client_max_body_size 25M; }`) to keep the 1 MB default everywhere else. The ALB imposes no body limit, so nginx is the only knob.
2. **Add an app-side size check with a friendly error.** In `app/api/cmf/packages/stage/route.ts`, after the `.xlsx` type check, reject files over the app limit with the route's existing JSON shape (`{error: {title: "File too large", description: "Maximum upload size is 25 MB — …"}}`, status 413). Set nginx slightly **above** the app limit (e.g. nginx 26M, app 25M) so realistic oversize files reach the app and get the friendly message; nginx's blunt 413 then only fires for egregious bodies.
3. **Client-side pre-check in the wizard.** In `UploadStep.submit()` (`loader-wizard.tsx`), toast "File too large" with the actual size before uploading when `file.size` exceeds the limit — instant feedback, no bytes sent (advisory only; layers 1–2 remain the enforcement).
4. **Optional polish — make nginx speak JSON.** `error_page 413 = @too_large;` returning the wizard's `{error: {title, description}}` shape with `Content-Type: application/json`, so even a true nginx rejection renders as a friendly toast with zero client changes (the wizard already reads `data.error?.title`).

---

## Triage notes (cross-issue)

- Issues #1 and #2 are both in the Excel generation layer (`ksp-skeleton.ts`) and share a fix vehicle (header/Index rewriting + rebuilt client template). Issue #1 likely also explains the earlier 4.2/4.5 report (corrupt/blank-looking files).
- Issue #3 is chat/UI plumbing plus validation rubber-stamping — independent of the Excel layer.
- Cross-cutting theme: every self-check currently short-circuits (skeleton-marker fast path, prompt-only gates), so the agent has no ground truth about what it actually produced.
- Issue #5 is deployment configuration (nginx), independent of the Excel and chat layers — it gates the upload entry point to the whole loader flow, so it can mask Issues #1–#4 for any workbook over 1 MB. Fix owner is deploy/ops, not the app codebase.
