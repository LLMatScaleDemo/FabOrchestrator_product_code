# 7 — Review & Sign-off Tracker

> Version: commit `7976c78` on `main`. See [README](./README.md).
> **This is the living control sheet for the documentation effort.** Yogita owns keeping it
> current. Update the status columns as review progresses.

---

## 7.1 Validation status legend

| Badge | Meaning |
|-------|---------|
| 🔵 Static | Traced by reading code only |
| 🟢 Runtime | Confirmed by running the app + logs |
| ✅ Dev-confirmed | A code owner confirmed accuracy |
| 🏁 Approved | Jothi (technical) / Raj (business) signed off |

## 7.2 Document status

| Doc | Author | Current | Runtime? | Dev-confirmed | Approved |
|-----|--------|:------:|:--------:|:-------------:|:--------:|
| 00 — Scope & inventory | AI | 🔵 | — | ☐ | ☐ |
| 01 — File catalog | AI | 🔵 | — | ☐ | ☐ |
| 02 — Entry points | AI | 🔵 | — | ☐ | ☐ |
| 03 — Review hotspots | AI | 🔵 | — | ☐ | ☐ |
| 04 — Architecture & integration | AI | 🔵 | — | ☐ | ☐ |
| 05 — Deployment & CI | AI | 🔵 | — | ☐ (ops) | ☐ |
| 06 — Error & recovery matrix | AI | 🔵 | — | ☐ | ☐ |
| 08 — Customer-safe overview | AI | 🔵 | — | ☐ | ☐ |

## 7.2b File deep-dive status (`docs/files/`)

| Page | Author | Current | Runtime? | Dev-confirmed | Approved |
|------|--------|:------:|:--------:|:-------------:|:--------:|
| [`db.md`](./files/db.md) | AI | 🔵 | — | ☐ | ☐ |
| [`encryption.md`](./files/encryption.md) | AI | 🔵 | — | ☐ | ☐ |
| [`auth-middleware.md`](./files/auth-middleware.md) | AI | 🔵 | — | ☐ | ☐ |
| [`session-audit.md`](./files/session-audit.md) | AI | 🔵 | — | ☐ | ☐ |
| [`prompt-audit.md`](./files/prompt-audit.md) | AI | 🔵 | — | ☐ | ☐ |
| [`error-audit.md`](./files/error-audit.md) | AI | 🔵 | — | ☐ | ☐ |
| [`error-catalog-loader.md`](./files/error-catalog-loader.md) | AI | 🔵 | — | ☐ | ☐ |
| [`api-error-handler.md`](./files/api-error-handler.md) | AI | 🔵 | — | ☐ | ☐ |
| [`sql-guard.md`](./files/sql-guard.md) | AI | 🔵 | — | ☐ | ☐ |
| [`model-pricing.md`](./files/model-pricing.md) | AI | 🔵 | — | ☐ | ☐ |
| [`model-registry.md`](./files/model-registry.md) | AI | 🔵 | — | ☐ | ☐ |
| [`mcp-client.md`](./files/mcp-client.md) | AI | 🔵 | — | ☐ | ☐ |
| [`context-window.md`](./files/context-window.md) | AI | 🔵 | — | ☐ | ☐ |
| [`s3-upload.md`](./files/s3-upload.md) | AI | 🔵 | — | ☐ | ☐ |
| [`chat-route.md`](./files/chat-route.md) | AI | 🔵 | — | ☐ | ☐ |
| [`cmf-types.md`](./files/cmf-types.md) | AI | 🔵 | — | ☐ | ☐ |
| [`cmf-client.md`](./files/cmf-client.md) | AI | 🔵 | — | ☐ | ☐ |
| [`cmf-auth.md`](./files/cmf-auth.md) | AI | 🔵 | — | ☐ | ☐ |
| [`chat-cmf-tools.md`](./files/chat-cmf-tools.md) | AI | 🔵 | — | ☐ | ☐ |
| [`rule-engine.md`](./files/rule-engine.md) | AI | 🔵 | — | ☐ | ☐ |
| [`storage.md`](./files/storage.md) | AI | 🔵 | — | ☐ | ☐ |
| [`validation-cmf-queries.md`](./files/validation-cmf-queries.md) | AI | 🔵 | — | ☐ | ☐ |
| [`admin-user-service.md`](./files/admin-user-service.md) | AI | 🔵 | — | ☐ | ☐ |
| [`invitation-service.md`](./files/invitation-service.md) | AI | 🔵 | — | ☐ | ☐ |
| [`admin-tools.md`](./files/admin-tools.md) | AI | 🔵 | — | ☐ | ☐ |
| [`admin-chat-route.md`](./files/admin-chat-route.md) | AI | 🔵 | — | ☐ | ☐ |
| [`email.md`](./files/email.md) | AI | 🔵 | — | ☐ | ☐ |
| [`schema.md`](./files/schema.md) | AI | 🔵 | — | ☐ | ☐ |

## 7.3 Scenario status

| Scenario | Current | Runtime | Dev-confirmed | Approved | Owner to confirm |
|----------|:------:|:-------:|:-------------:|:--------:|------------------|
| 01 — Login | 🔵 | ☐ | ☐ | ☐ | Auth owner |
| 02 — Chat turn | 🔵 | ☐ | ☐ | ☐ | Chat owner |
| 03 — MCP tool call | 🔵 | ☐ | ☐ | ☐ | MCP/platform owner |
| 04 — CMF load ⚠️ | 🔵 | ☐ | ☐ | ☐ | CMF owner (**priority**) |
| 05 — Admin force-logout | 🔵 | ☐ | ☐ | ☐ | Admin owner |

## 7.4 Roles (per the assignment)

| Person | Responsibility |
|--------|----------------|
| **You** | Inspect repos, extract files/functions, trace scenarios, diagrams, record commit hash |
| **Yogita** | Document structure, coverage tracking, coordinate code owners, manage this tracker |
| **Jothi** | Technical review — confirm architecture & control flows, approve accuracy |
| **Raj** | Define/confirm the business scenarios that matter |
| **Code owners** | Verify their modules + dynamic/runtime behavior |

## 7.5 Blocking questions (must be answered to progress)

**Top 5 — the only ones that need a management-level answer now.** Everything else in
this tracker is routine code-owner confirmation (see §7.6 note) or deferred below.

| # | Question | Owner | Why it can't wait | Status |
|---|----------|-------|-------------------|:------:|
| 1 | Where do the **Python MCP servers** and **Lambda** live (separate repos)? We need access to document them. | Jothi | Blocks an entire scope item of the assignment | ☐ open |
| 2 | **Cross-user access in `/api/chat`**: both chat routes read/write messages on a client-supplied `conversationId` with no ownership check ([storage](./files/storage.md)). Real gap or compensated elsewhere? | Chat owner | Potential cross-user data exposure — needs confirmation before anything else | ☐ open |
| 3 | **Prod TLS posture**: is `ssl:false` to RDS acceptable, and is `CMF_TLS_INSECURE=0` actually set? (The insecure default disables cert checks for **all** outbound `fetch` in the process, not just CMF — [cmf-client](./files/cmf-client.md).) | Ops | Security config that only Ops can verify; static reading can't resolve it | ☐ open |
| 4 | **`loadToCmf` gate**: the only thing keeping the LLM from committing to the live MES is a one-line exclusion from the tool belt ([chat-cmf-tools](./files/chat-cmf-tools.md)) — is that the intended design, or should a code-level confirm gate exist? | CMF owner | Highest-risk write path in the product | ☐ open |
| 5 | **Missing DDL**: 9 audit/catalog DB objects (`prompt_audit_logs`, `error_audit_logs`, counters, enums, `error_catalog`) have no create statements anywhere in the repo ([schema](./files/schema.md)). Where does the DDL live, and who owns it? A fresh environment silently runs without audit. | Ops / DB owner | Compliance-relevant (REQ-03/04) and invisible when it fails | ☐ open |

### Deferred — answer during normal review, not blocking

| # | Question | Owner | Status |
|---|----------|-------|:------:|
| D1 | What runs the 90-day retention purges? (Nothing is scheduled; only trigger today is a manual admin chat tool.) | Ops | ☐ open |
| D2 | Which scenarios does Raj consider highest business priority? (Only gates *additional* scenarios; 5 are already done.) | Raj | ☐ open |
| D3 | Confirm documenting the actual (flat route→lib) structure, not the assignment's layered template. | Jothi | ☐ open |

## 7.6 Doc-vs-code discrepancies found by the file deep-dives

The `docs/files/` pages re-verified earlier claims against the code (commit `7976c78`).
Where a deep-dive contradicts docs 01/03 or the root `CLAUDE.md`, the deep-dive is the
more careful reading — but a code owner should confirm before the older doc is corrected.

> **These are not management questions.** Each row belongs to one code owner and gets
> confirmed as part of that owner's normal module sign-off (§7.2b) — no separate answers
> needed. The two rows serious enough to escalate (14: cross-user chat access, and the
> missing-DDL findings in 1/16/21) are already promoted into the §7.5 Top 5.

| # | Older claim (where) | What the deep-dive found | Page |
|---|---------------------|--------------------------|------|
| 1 | Audit tables live in `admin_athena/prisma/*.sql` (catalog Part C, root `CLAUDE.md`) | **No DDL anywhere in the repo** for `error_audit_logs`, `error_audit_daily_counter`, the `error_audit_status` enum, or `error_catalog` — presumably created by hand against RDS. A fresh environment would silently run without error persistence. | [error-audit](./files/error-audit.md), [error-catalog-loader](./files/error-catalog-loader.md) |
| 2 | `sql-guard` "currently unused **in Fab**" (03 §5) | Unused at runtime in **both** apps — only unit tests import it. Zero enforcement anywhere. | [sql-guard](./files/sql-guard.md) |
| 3 | `forceLogoutUser` deletes live sessions "matching by `sha256(token)`" (03 §2) | Only `reconcileStaleActiveSessions` uses the sha256 match; `forceLogoutUser` deletes by user id via Prisma (scenario 05 had it right). | [session-audit](./files/session-audit.md) |
| 4 | Retention: worker may cover the 90-day sweeps (03 §6) | The worker only purges **session** logs. `purgeOldErrors`/`purgeOldPrompts` are unscheduled even if the worker ran — the only trigger is an admin chat tool with `confirm=true`. | [error-audit](./files/error-audit.md), [prompt-audit](./files/prompt-audit.md) |
| 5 | `error-catalog-loader`: "DB read on every error render"; "circular import with `faborch-errors`" (03 §1 row 7) | Steady-state reads are memory-cached (60 s TTL, background refresh). The 2-file cycle no longer exists; the real cycle is 3-module via `logger.ts`, statically init-safe. | [error-catalog-loader](./files/error-catalog-loader.md) |
| 6 | `withErrorHandling` a key export (catalog row) | Dead export — no route in either app imports it; routes call `handleApiError` in their own `catch`. `buildErrorBody`, `toFabOrchError`, `countErrorAudit`, `recordAdminForce`, `reloadErrorCatalog` are dead exports too. | [api-error-handler](./files/api-error-handler.md) + others |
| 7 | Minor wording (03 §5) | `LIMIT ${limit}` is actually `LIMIT ${limit + 1}` (over-fetch for truncation detection); the interpolated-`INTERVAL` item applies to session-audit only — prompt/error-audit use fixed `'90 days'` literals. | [prompt-audit](./files/prompt-audit.md), [error-audit](./files/error-audit.md) |
| 8 | "Promised 'log once' on $0 pricing doesn't exist" (03 §1 row 9, §3; also 03 §7 task 2) | **Out of date** — both chat routes implement the guard at `7976c78` (`unknownModelLogged` + `logger.fabOrchError`). Residual risk: the function itself stays silent, so future callers skipping `hasPricing` re-introduce silent $0. New finding instead: the two apps' pricing maps **conflict 3× on three shared Opus ids** and Admin lacks Fab's four newest models. | [model-pricing](./files/model-pricing.md) |
| 9 | "Swallows all DB errors → falls back to hardcoded" (03 §1 row 10, §3) | Only exact for a registry that has **never** loaded in that process — after one good load, failures serve the last good snapshot (stale-serve). Sharper finding: the chat model gate is a **union** of registry ids + hardcoded `ALLOWED_MODELS`, so deactivating a model in the admin UI does not block it; and unrecognized `thinking_type` DB values silently disable thinking (hardcoded fallback not consulted). | [model-registry](./files/model-registry.md) |
| 10 | `mcp-client` consumed by "`/api/chat`, `/api/mcp/*`" (catalog row) | Only `/api/chat` imports it; the `/api/mcp/connections/*` routes **duplicate** the JSON-RPC/SSE protocol inline rather than importing — a drift hazard, not a consumer relationship. | [mcp-client](./files/mcp-client.md) |
| 11 | "Each MCP error is logged and persisted via `recordError`" (scenario 03 §3) | Overstated — only the HTTP-not-ok and JSON-RPC-error branches persist; the thrown-exception branch (timeouts, DNS, TLS) is logger-only, and since `executeMcpTool` returns rather than throws, the tool closure's `recordError` never fires for those either. | [mcp-client](./files/mcp-client.md) |
| 12 | **"LLM can call `loadToCmf`" — the highest-risk path (03 §1 row 17, §4; scenario 04 path b)** | At `7976c78` the tool is **not offered to the model** — the modeling-agent chat route destructures `loadToCmf` + `previewLoadImpact` *out* of the belt before `streamText`. The guard is that one-line exclusion, not anything in the tool. Structural point stands (no code gate inside `execute`; only staged-file ownership), but the "reachable today" framing needs correcting in 03 and scenario 04. | [chat-cmf-tools](./files/chat-cmf-tools.md) |
| 13 | **"The only hard pass/fail gate" — R1–R6 rule engine (03 §1 row 18)** | `runRules` has **no live caller** at this commit: `validate.ts`/`validate-rows.ts` are imported by nothing, the stage validate route disclaims R1–R6, and `/validate` delegates to CMF's own remote dry-run (op 1). Either the pre-flight wiring is pending/dynamic, or R1–R6 is currently dead and CMF's atomic load is the real gate. | [rule-engine](./files/rule-engine.md) |
| 14 | **Cross-user access gap in `/api/chat`** (new — not in 03) | `storage.ts` by-id accessors take no `userId`; routes normally compensate with fetch-then-compare, but `/api/chat` and `/api/modeling-agent/chat` call `addMessage`/`getMessages` on the client-supplied `conversationId` with **no ownership check** — statically a cross-user write/read of messages and stored S3 file refs. 🔵 needs owner/runtime confirmation. | [storage](./files/storage.md) |
| 15 | **Process-wide TLS weakening** (sharpens 03 §6) | `cmf-client.ts`'s import-time `setGlobalDispatcher` sets `rejectUnauthorized:false` (unless `CMF_TLS_INSECURE=0`) for **every** global-`fetch` in the process — Anthropic API and MCP included, not just CMF — and even importing `CmfApiError` triggers it. | [cmf-client](./files/cmf-client.md) |
| 16 | Audit tables gap extends to `error_catalog`, and stale-path comments | `error_catalog` has no DDL in the repo either (loader silently serves hardcoded defaults if the table is absent); catalog exists in **five** copies, not "3+". Separately, comments in the CMF stack cite stale paths (`lib/types.ts`, `src/lib/chat/tools.ts`) and a nonexistent `CMF_API_Complete_Reference.md`. | [error-catalog-loader](./files/error-catalog-loader.md), [cmf-types](./files/cmf-types.md) |
| 17 | "`[schema].[table]` interpolated — confirm never user-influenced" (03 §1 row 19, §5) | **Resolved in the code's favour:** user/LLM input is only ever a parameterized *value*; interpolated identifiers are echoed back from CMF's `INFORMATION_SCHEMA`/metadata, so injected text can't reach them (bracket-quoting isn't `]]`-escaped, but the trust anchor is CMF DB write access, not the app). Open sub-question: confirm no app path lets an end user author CMF metadata. Also: **4 of the 8 files (`parent-precheck`, `validate-rows`, `referential`, `cross-check`) are unreachable** at this commit — same unwired-pipeline finding as the rule engine. | [validation-cmf-queries](./files/validation-cmf-queries.md) |
| 18 | "Admin AI chat force-logout tool calls `forceLogoutUser`" (scenario 05 §1) | At `7976c78` `admin-tools.ts` does **not** import `forceLogoutUser` — the chat exposes only `listUsers/updateUserStatus/changeUserRole/forcePasswordReset/deleteUser`. `forceLogoutUser` is REST-route-only (though suspend/delete/force-reset still evict sessions from chat). Also confirmed: **no last-admin protection anywhere** in the service (only `deleteUser` self-block); `forcePasswordReset` email is best-effort *after* commit, so a killed-session user can get no reset link. | [admin-user-service](./files/admin-user-service.md) |
| 19 | **"`confirm=true` + 'never delete last admin' enforced in code" (03 §1 row 20); §4 destructive-tool list** | `confirm=true` is real code in 5 tools, but **no last-admin check exists in `admin-tools.ts` or the service** — the row-20 claim is unsupported. Also: **`bulk_assign_role` has no `confirm` param and writes no `audit_logs`** (§4 lists it as a confirm-guarded tool); `add_mcp_to_role`/`remove_role_mcp` also write no audit row; **`purgeOldSessionLogs` is not a chat tool** (§4 groups it wrongly — it's a background-worker export); `delete_role`'s confirm is advisory-skippable. | [admin-tools](./files/admin-tools.md) |
| 20 | "smtp.ts silent no-op — only console.logs the link" (03 §6, row 23) | `smtp.ts` itself logs nothing — the **callers** `console.log` the full URL **including the one-time token** when SMTP is unset (fires on config, not env, despite the `[DEV]` prefix). The live HTML-injection vector is invitation `inviterName`/`roleName` (admin-set, unescaped, opened by the invitee); the interpolated **URLs are env+server-token, not user-controlled**, so not a live vector. Drift: **Fab inlines its own divergent copy** of the reset email with the same unescaped-name + token-log bugs in `app/api/auth/password-reset/route.ts`. | [email](./files/email.md) |
| 21 | Audit tables "exist only via the additive SQL migrations" / "only in `prisma/*.sql`" (03 row 25, arch §4.6, root `CLAUDE.md`) | **Inaccurate:** no `*.sql` file creates any audit table — the only audit-related SQL is one `ALTER prompt_audit_logs ADD COLUMN` that assumes the table exists. **9 objects** (`prompt_audit_logs`, `error_audit_logs`, both `*_daily_counter`, `error_catalog`, `prompt_audit_status`/`error_audit_status`/... enums) have **no DDL anywhere in the repo** — neither Prisma nor SQL. A fresh env built from the repo has broken REQ-03/04 audit + falls back to hardcoded error catalog, silently. Fix the wording in those three docs. Also: Fab's `schema.prisma` mirror omits only `McpRegistry`; all other fields match by hand (the drift the auth `as`-casts cope with). | [schema](./files/schema.md) |

## 7.7 Remaining work (what's left after this pass)

| Item | Type | Who |
|------|------|-----|
| Runtime-validate the 5 scenarios | needs running app + logs | You + code owners |
| Code-owner confirmation of every 🔵 doc | human review | Code owners |
| Answer §7.5 blocking questions | decisions | Named owners |
| Expand individual UI component catalog (currently grouped) | optional docs | You (on request) |
| Additional scenarios if Raj requests (e.g. invitation accept, model config change, deploy) | docs | You |
| Document Python MCP servers + Lambda once repos located | docs | You (blocked on #1) |
