# 3 — Review Hotspots & Correctness Checklist

> Version: commit `7976c78` on `main`. See [README](./README.md).
> Validation: 🔵 Static — **these are findings from reading code, not confirmed bugs.**
> Each item is a question for a code owner (Task 13 human-validation), not a defect report.

**Purpose.** Phase 1 read every library file. This document ranks the files where our
understanding *most needs a human to confirm it*, because getting them wrong has real
consequences (security, money, factory data, silent failures). Use it two ways:
1. As the **code-owner review agenda** — walk the High-priority list and confirm/correct each.
2. As a **contributor on-ramp** — the [Where to start](#7-where-to-start-contributing) section
   turns these into ordered, learnable tasks.

> ⚠️ **Read-only reminder:** everything below is an *observation to verify*, not a
> change to make. Fixes are a separate, approved task (see [README constraints](./README.md)).

---

## 1. The High-priority files at a glance

Search any filename in [01 — File Catalog](./01-file-catalog.md) for context. "App": F=Fab, A=Admin, both.

| # | File | App | Why it's hot | The one thing to verify |
|---|------|-----|--------------|--------------------------|
| 1 | [`lib/db.ts`](./files/db.md) | both | `ssl: false` to RDS ("POC mode") | Is unencrypted DB traffic acceptable in production? |
| 2 | [`lib/encryption.ts`](./files/encryption.md) | both | Passwords + all secrets | scrypt callback `reject` has no `return` (latent bug, §6); GCM tag handling |
| 3 | [`lib/auth-middleware.ts`](./files/auth-middleware.md) | both | The authZ gate on every route | Status/`forcePasswordChange` read via `as` casts — silently no-op if schema drifts |
| 4 | [`lib/session-audit.ts`](./files/session-audit.md) | both | Raw SQL; **deletes live `sessions`** | `reconcileStaleActiveSessions` assumes plaintext tokens; `is_admin=false` filter can't be bypassed |
| 5 | [`lib/prompt-audit.ts`](./files/prompt-audit.md) | both | Raw SQL; stores prompt/response **PII** + cost | `limit` always clamped before interpolation; PII retention |
| 6 | [`lib/errors/error-audit.ts`](./files/error-audit.md) | both | Raw SQL; ERR-id atomicity | Depends on `error_audit_daily_counter` table + unique constraint existing — **no DDL for it found in this repo** |
| 7 | [`lib/errors/error-catalog-loader.ts`](./files/error-catalog-loader.md) | F | DB read on **every** error render | Circular import with `faborch-errors.ts` is init-safe; fail-safe truly can't throw |
| 8 | [`lib/errors/api-error-handler.ts`](./files/api-error-handler.md) | both | Heuristic error classification | String/name matching misclassifies (e.g. any "database" → SQL_CALL_FAILURE) |
| 9 | [`lib/model-pricing.ts`](./files/model-pricing.md) | both | **Money** — billing rates | Unknown model **silently bills $0** inside the function (deep-dive: call-site "log once" guards DO exist at `7976c78`); Fab/Admin maps **conflict 3× on three Opus ids** |
| 10 | [`lib/model-registry.ts`](./files/model-registry.md) | F | **Money** — DB rate source | Swallows all DB errors (deep-dive: falls back to hardcoded only if **never** loaded — otherwise serves the last good snapshot); ~60s TTL lag; chat gate is a **union** with `ALLOWED_MODELS`, so admin deactivation doesn't block |
| 11 | [`lib/mcp-client.ts`](./files/mcp-client.md) | F | Network + decrypts creds + dynamic tools | Session-refresh retry logic; credential decrypt at call time. Deep-dive adds: **decrypt failure fails open** (proceeds unauthenticated); **SSRF** via user-supplied personal `serverUrl`; untrusted server descriptions/results flow into the LLM prompt |
| 12 | [`lib/s3-upload.ts`](./files/s3-upload.md) | F | Presigned URLs to **private files** | TTL: 24h **default**, 7d **cap**, no floor; URLs egress to Anthropic (system prompt), external MCP servers (if model passes them), `prompt_audit_logs`, `Message` table, browser |
| 13 | [`lib/context-window.ts`](./files/context-window.md) | F | Reshapes/drops messages before send | Truncation can't corrupt tool-call pairing (**mostly** — user-role tool-results are an edge case); `chars/4` token estimate; over-budget last group is sent anyway |
| 14 | [`lib/cmf/types.ts`](./files/cmf-types.md) | F | **Inverted op codes** (0=Load/commit, 1=Validate) | A wrong constant here silently commits to the factory; bare `0\|1` union, nothing compile/runtime catches a swap; 3 comments cite stale path `lib/types.ts` |
| 15 | [`lib/cmf/cmf-client.ts`](./files/cmf-client.md) | F | **Commits to live MES**; global TLS/DNS | `setGlobalDispatcher` weakens TLS **process-wide** (incl. Anthropic/MCP fetch), insecure unless `CMF_TLS_INSECURE=0`; `loadMasterData` is `@deprecated` yet the LLM commit path; Playwright header comment is stale |
| 16 | [`lib/cmf/cmf-auth.ts`](./files/cmf-auth.md) | F | The MES write key (Secrets Manager) | In-memory cache + single-flight (per-process); trusts secret's `expiresAt`, not JWT `exp`; bad `TOKEN_SAFETY_MARGIN_SEC` (NaN) silently bricks all tokens |
| 17 | [`lib/chat-cmf/tools.ts`](./files/chat-cmf-tools.md) | F | `loadToCmf` = real commit; **no code gate inside the tool** | Deep-dive: at `7976c78` the tool is **NOT** offered to the model (excluded at the one call site) — the only guard is that destructuring, plus the description text; nothing in `execute` requires prior preview/validation |
| 18 | [`lib/validation/rule-engine.ts`](./files/rule-engine.md) | F | Deterministic R1–R6 gate | Numeric/bool/FK misses downgraded to non-blocking warnings; **deep-dive found no live caller** — the shipped validate path uses CMF's own remote dry-run (op 1) instead |
| 19 | [`lib/validation/*` (CMF-querying)](./files/validation-cmf-queries.md) | F | SQL identifier interpolation | Deep-dive verdict: **user/LLM text cannot reach the interpolated identifiers** (echoed from CMF `INFORMATION_SCHEMA`, values parameterized); trust anchor is CMF DB content. Also: **4 of 8 files unreachable** at this commit |
| 20 | [`lib/admin-tools.ts`](./files/admin-tools.md) | A | 31 tools incl. destructive; raw SQL | `confirm=true` is real code in 5 tools — but **"never delete last admin" does NOT exist in code**; `bulk_assign_role` has **no confirm + writes no audit_logs**; `add_mcp_to_role`/`remove_role_mcp` also skip audit; `purgeOldSessionLogs` is **not** a chat tool |
| 21 | [`lib/services/admin-user-service.ts`](./files/admin-user-service.md) | A | Delete/suspend/force-logout/reset + email | **Confirmed: no last-admin check anywhere**; only `deleteUser` blocks self-delete — suspend/demote/force-logout have no self- or last-admin guard. Email failure never rolls back the mutation |
| 22 | [`lib/services/invitation-service.ts`](./files/invitation-service.md) | A | Creates accounts, mints sessions, emails | Accept = **immediate unverified 30-day login**; soft-deleted reactivation reattaches old data to the same user id; `SUSPENDED` re-invite throws a raw DB error; concurrent-accept double-mint race |
| 23 | [`lib/email/smtp.ts` + templates](./files/email.md) | A | Email egress; **unescaped HTML** | Live cross-person vector is invitation `inviterName`/`roleName` (admin-set, unescaped, opened by invitee); URLs are **not** user-controlled. When SMTP unset, callers `console.log` the **token links** in prod. Fab inlines a divergent copy of the reset email |
| 24 | [`lib/errors/sql-guard.ts`](./files/sql-guard.md) | both | Regex SQL allowlist — **bypassable** | Must be defense-in-depth only; DB creds least-privilege/read-only. Deep-dive found it **unused at runtime in both apps** |
| 25 | [`admin_athena/prisma/schema.prisma`](./files/schema.md) | shared | Source of truth for ~20 tables | Deep-dive: audit tables (`error_audit_logs`, `prompt_audit_logs`, `error_catalog`, both `*_daily_counter`, 2 enums = **9 objects**) are in **neither** Prisma **nor** the `*.sql` files — **no DDL in the repo at all** (not "raw SQL only") |

---

## 2. Security & authorization

- **`db.ts` — TLS disabled (`ssl: false`)** to RDS in both apps. Explicitly "POC mode." Confirm production posture.
- **`auth-middleware.ts` — schema-drift blind spot.** `User.status` and `forcePasswordChange` are read with `as User & {...}` casts because they're set by the *other* app. If a column is renamed/removed, the suspend/force-reset checks silently pass. Both apps affected.
- **`session-audit.ts` — reconcile deletes live sessions.** `reconcileStaleActiveSessions` (admin) and `forceLogoutUser` delete rows from the live `sessions` table, matching by `encode(sha256(token),'hex')`. Verify: (a) tokens really are stored plaintext so the hash matches; (b) the `is_admin=false` filter cannot be bypassed (so admins aren't mass-logged-out).
- **Admin authZ assumption.** Admin **chat tools** in `admin-tools.ts` do **not** re-check `isAdmin` — they assume the `/admin/chat` route already did. Confirm every admin route wraps `requireAdmin`.
- **User enumeration (from [scenario 01](./scenarios/01-login.md)).** Fab login reveals "No account found with this email"; Admin returns a generic message. Fab is a mild information leak.
- **Token acceptance.** `validateSession` accepts any token ≥32 chars + 30-day absolute expiry, no rotation. Confirm that's the intended session policy.

## 3. Money / cost accuracy

- **`model-pricing.ts` — silent $0.** Any model id missing from the hardcoded `MODEL_PRICING` map bills **$0** with no error (the "logged once at call site" comment is not backed by code). A renamed/mistyped model under-bills invisibly. Both apps.
- **`model-registry.ts` — silent fallback.** All DB errors are swallowed and pricing falls back to the hardcoded map; wrong rates in the `model_registry` table bill wrong silently, and rate edits lag ~60s (TTL). Runtime-dependent — verify against real DB rows.
- **`ALLOWED_MODELS` in `lib/errors/parameter-values.ts`** is a hardcoded list that may not match the live model ids — model validation could allow/reject the wrong set.
- **NUMERIC → JS Number** in `prompt_quality_summary` / cost sums — verify precision/rounding of `request_cost + retrieval_cost + response_cost` and `avgPerPrompt`.

## 4. Data integrity & destructive actions

- **CMF live commit is LLM-reachable.** `chat-cmf/tools.ts::loadToCmf` → `cmf-client.loadMasterData(..., 0)` **writes to the live factory MES**. The "only after preview + confirmation" guard lives in the tool *description*, not code — nothing structurally stops an early call. **Highest-risk path in the codebase.**
- **`loadMasterData` is `@deprecated`** yet is exactly what `loadToCmf` calls; it auto-runs *every* detected object type, ignoring user-selected types. Confirm intended.
- **Inverted op codes (`cmf/types.ts`).** `0 = Load (commit)`, `1 = Validate (dry-run)` — opposite of CMF's nominal docs. Any refactor "aligning to docs" would turn validations into real commits. **Do not touch without a code owner.**
- **Atomic-batch rollback.** One bad row (missing FK parent) rolls back the entire CMF package — so `load-preview` blocking conflicts must be honored before load.
- **`generateExcel` does not verify parents against CMF** (`parentCheckPerformed:false`) — a generated file can pass local checks yet fail/rollback the atomic load.
- **Rule-engine severity.** `rule-engine.ts` downgrades numeric/boolean/FK failures to non-blocking *warnings* (comments admit `metadata.ts` mis-maps some reference targets). Confirm genuinely invalid loads can't slip past the gate.
- **Admin destructive tools.** `delete_user`, `purge_old_errors/prompts`, `purgeOldSessionLogs`, `bulk_assign_role`, `remove_role_mcp`, `delete_role` — confirm the `confirm=true` guard is enforced in each tool body, and note there is **no "never delete the last admin" check in code** (`deleteUser` only blocks self-deletion) despite the system prompt claiming it.

## 5. Raw SQL & injection surface

The Prisma client couldn't be regenerated under the local toolchain, so audit tables use
`$queryRawUnsafe`/`$executeRawUnsafe` throughout. **User-supplied values are parameterized
(`$1`,`$2`…) — good.** The risk is *interpolated* pieces:
- **Numeric/interval constants** string-interpolated into SQL (`LIMIT ${limit}`, `INTERVAL '${IDLE_TIMEOUT_SEC} seconds'`) in `session-audit.ts`, `prompt-audit.ts`, `error-audit.ts`. Safe today (internal numbers) — verify `limit` is always clamped (`Math.min(...,1000)`) and no future filter routes user text there.
- **CMF SQL table/column identifiers** (`[schema].[table]`) interpolated in `metadata.ts`, `referential.ts`, `parent-precheck.ts`, `cross-check.ts`, `validate-rows.ts`, `load-preview.ts`, `lookup-existing.ts`, `prefill.ts`. Values are parameterized; identifiers come from CMF metadata — confirm that metadata can never be user-influenced. `lookup-existing.ts` uses `select *`.
- **`sql-guard.ts`** (both apps) is a regex keyword blocklist and is **bypassable**; it's currently unused in Fab. Treat as defense-in-depth only, never the sole boundary. Ensure any user-driven SQL uses a least-privilege read-only DB role.

## 6. Network posture, secrets, latent bugs

- **TLS off by default for CMF.** `cmf-client.ts`: `CMF_TLS_INSECURE` defaults to **insecure** (only `"0"` enables verification), and it calls `setGlobalDispatcher`, weakening TLS for the **entire process's** `fetch`, not just CMF. `cmf-sql.ts` uses `trustServerCertificate:true`. Confirm production sets `CMF_TLS_INSECURE=0` with the corp CA.
- **Email HTML injection.** `email/invitation-template.ts` + `password-reset-template.ts` interpolate `inviterName`/`roleName`/`userName`/URLs into HTML **without escaping**.
- **`smtp.ts` silent no-op.** Returns `false` when SMTP env is unset and only `console.log`s the link — check reset/invite links can't leak in prod logs.
- **Latent bug — `encryption.ts`:** in `hashPassword`/`verifyPassword`, the `crypto.scrypt` callback calls `reject(err)` **without `return`**, so `resolve(...)` still runs after an error. Worth fixing (small, safe) — see below.
- **Stale/misleading comment.** `cmf-client.ts` header claims it depends on a "Playwright child-process token fetch," but `cmf-auth.ts` actually uses AWS Secrets Manager. Documentation-only, but confirm no dead Playwright path remains.

### Drift hazards (multiple copies of the same truth)

These will silently diverge over time — flag for a single-source refactor later:
- **Error catalog exists in 3+ places:** `error-catalog-defaults.ts` (server), `errors/client.ts` HTTP-status map (browser), and the `error_catalog` DB table. The client map is missing several types.
- **Model pricing / model lists** are hardcoded in `model-pricing.ts` **and** `ALLOWED_MODELS` **and** the `model_registry` DB table — three sources.
- **System-column sets** differ between `rule-engine.ts::SYSTEM_MANAGED` and `system-columns.ts::SYSTEM_AUTOFILL`.

### Silent-failure hazards (swallowed errors)

Many audit/mutation paths use fire-and-forget `.catch()` (login audit, `recordError`, `recordAudit`, `reconcile`, `storage.ts` mutations returning `null`/`false`). Resilient by design, but **real outages are invisible except in CloudWatch.** Verify each swallow actually logs.

### Un-scheduled retention

`purgeOldErrors` / `purgeOldPrompts` / `purgeOldSessionLogs` (90-day) — Fab has **no scheduler**; Admin has `session-retention-worker.ts` but `instrumentation.ts` is a **no-op**, so confirm what actually runs the sweeps or the tables grow unbounded.

---

## 7. Where to start contributing

Ordered so each task teaches you a layer of the system while being genuinely useful.
(All require a code owner to confirm the finding first — this doc is observations, not approved fixes.)

| Order | Task | Teaches you | Risk |
|-------|------|-------------|------|
| 1 | **Fix the `encryption.ts` scrypt `reject`-without-`return` bug** | Auth/crypto path, promises, how tests are run (`npm run test:errors`) | Tiny, well-contained |
| 2 | **Add the missing "log once" on $0 pricing** in `model-pricing.ts` | The cost/billing pipeline (`prompt-audit` → `usage_records`) | Low |
| 3 | **Add a `console`/logger line to each swallowed `.catch()`** in the audit paths | The four REQ audit subsystems end-to-end | Low, high learning |
| 4 | **Reconcile the 3 error-catalog copies** (document, then propose one source) | Error taxonomy + how both apps consume it | Med (design) |
| 5 | **Wire up (or document) the retention scheduler** | Deployment/runtime lifecycle, `instrumentation.ts`, `pg` constraints | Med |
| 6 | **Trace + write the next scenario** (a full `POST /chat` turn) with the team | The core product path — best way to learn the whole system | None (docs) |

**Suggested first read-through for a new contributor**, in order:
`lib/db.ts` → `lib/encryption.ts` → `lib/auth-middleware.ts` → [scenario 01 login](./scenarios/01-login.md)
→ `lib/storage.ts` → `app/api/chat/route.ts` (the core) → `lib/model-registry.ts` +
`lib/prompt-audit.ts` (money/audit) → the CMF stack (`lib/cmf` → `lib/chat-cmf` → `lib/validation`).

---

## 8. Open questions for code owners (consolidated)

1. Is `ssl:false` acceptable in production, or a POC leftover? (`db.ts`)
2. Should Fab login stop leaking account existence? (scenario 01)
3. Is the LLM-reachable `loadToCmf` acceptable without a code-level confirmation gate? (`chat-cmf/tools.ts`)
4. Is `CMF_TLS_INSECURE` set to `0` in production? (`cmf-client.ts`)
5. Where do the **Python MCP servers** and **Lambda** live? (scope — [§0.2](./00-phase-0-scope-and-inventory.md#02-scope-reconciliation))
6. What runs the 90-day retention purges? (`session-retention-worker.ts` / `instrumentation.ts`)
7. Is there a last-admin protection anywhere? (`admin-user-service.ts`)
8. Are the inverted CMF op codes documented for every caller? (`cmf/types.ts`)
