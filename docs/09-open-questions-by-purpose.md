# 9 — Open questions by purpose: accuracy checks vs improvement decisions

> Version: commit `7976c78` on `main`. Validation: 🔵 Static.
> Compiled 2026-07-22 from the "Open questions for the code owner" section of every
> `docs/files/` deep-dive page and the "Open validation items" of every scenario trace.
> **The source pages remain authoritative** — question numbers below match each page's
> own numbered list, so the two can be read side by side.

## Why two categories

Every document in this set is 🔵 Static — produced by *reading* the code, never running
it. The open questions therefore serve two different purposes that were previously mixed
in one list per page:

- **A. Accuracy checks** — the answer confirms or refutes a factual claim the
  documentation made from static reading (current behavior, wiring, where something
  lives, what production config actually says). These exist to catch misreadings /
  hallucinations before sign-off. Most need only a quick yes/no from a code owner, or a
  runtime check anyone with a running app can perform — no design judgment required.
- **B. Improvement decisions** — the observed facts are certain (directly evidenced in
  the code); the question asks whether the behavior is *acceptable or should change*.
  These need real judgment from an owner, not fact-checking.

A few questions genuinely do both; they are placed by primary purpose and annotated
*(also a design decision)* / *(also verifies the reading)*.

## Summary

| Source | Accuracy checks (A) | Improvement decisions (B) | Total |
|--------|:---:|:---:|:---:|
| 28 file deep-dive pages | 45 | 119 | 164 |
| 5 scenario traces | 22 | 4 | 26 |
| Review hotspots (03 §8, consolidated) | 5 | 3 | 8 |
| Deployment & CI (05 §5.9, ops items) | 5 | 0 | 5 |
| **Total** | **77** | **126** | **203** |

Not re-listed here: the sign-off tracker's blocking questions (07 §7.5) — that list is the
already-triaged management shortlist, distilled *from* the questions below. Several 03 §8
items also duplicate a per-page question (noted inline); answer once, tick both.

Practical consequence: only the **B** column needs a knowledgeable human's judgment.
The **A** column is fact-checking — most of it resolvable by a code owner's quick
confirmation or by runtime validation, without a design discussion.

---

## A. Accuracy checks (hallucination detection)

*Answering these confirms or refutes the documentation's static reading. Pages not
listed have no questions of this type.*

### `files/encryption.md`
- Q1 — Confirm the scrypt `reject`-without-`return` bug and approve the one-line fix (03 §7 task 1). *(also a design decision)*
- Q2 — Confirm GCM auth-tag handling is correct end-to-end (16-byte tag, no truncated-tag acceptance) (hotspot row 2).

### `files/auth-middleware.md`
- Q4 — Which Fab routes still use `withAuth`, and may they skip the suspend/force-password checks? *(also a design decision)*
- Q5 — Confirm every `/api/admin/*` route wraps `requireAdmin`.

### `files/session-audit.md`
- Q1 — Confirm `reconcileStaleActiveSessions` deleting live `sessions` rows during `querySessionLogs` is intended, `sessions.token` is plaintext everywhere, and the `is_admin = false` filter cannot be bypassed (hotspot row 4). *(also a design decision)*
- Q5 — What runs `purgeOldSessionLogs` — or does `user_session_logs` grow unbounded (03 §6)?

### `files/prompt-audit.md`
- Q1 — What runs `purgeOldPrompts`, and is its hard-coded 90 days meant to coexist with the configurable `auditRetentionDays` redaction? (03 §6) *(also a design decision)*
- Q6 — Confirm `prompt_audit_daily_counter.counter_date` has the unique/PK the `ON CONFLICT` upsert requires in every environment.

### `files/error-audit.md`
- Q1 — Where is the DDL for `error_audit_logs`, `error_audit_daily_counter`, and `error_audit_status`, and does `counter_date` carry the unique/PK the `ON CONFLICT` upsert requires? (Hotspot row 6.)
- Q3 — What runs the 90-day `purgeOldErrors` sweep — is admin-chat-on-demand the intended retention mechanism? *(also a design decision)*
- Q4 — Is the ERR-id day meant to be UTC (comment) or DB-local (`CURRENT_DATE`), and what is the RDS timezone? *(also a design decision)*

### `files/error-catalog-loader.md`
- Q1 — Confirm the actual `loader → logger → faborch-errors → loader` cycle is init-safe, and update the stale circular-import comments here and in `faborch-errors.ts` (hotspot row 7).
- Q2 — Where do the `error_catalog` table's DDL and seed rows live (not in this repo)?

### `files/sql-guard.md`
- Q1 — Do the apps' `DATABASE_URL` credentials use a least-privilege / read-only role — the only defense on the raw-SQL surfaces (03 §5)?
- Q3 — Confirm this is dead code in *both* apps at `7976c78`, and update 03 §5 ("unused in Fab" implies Admin uses it).

### `files/model-pricing.md`
- Q3 — Is the "missing log-once" claim in 03 §1 row 9 / §3 out of date (the guard exists in both chat routes at `7976c78`)?

### `files/model-registry.md`
- Q6 — Confirm `create_model_registry.sql` was actually applied to the shared RDS.

### `files/mcp-client.md`
- Q4 — Do the real MCP servers signal expiry via the `'unauthorized'` substring that `isSessionExpiredError` matches? (scenario 03 §6)

### `files/context-window.md`
- Q2 — Does the SDK accept `ensureToolResultPairing`'s `result:` key (AI SDK v6 uses `output:`), or is the placeholder text dropped?
- Q3 — Can tool-results appear in `user`-role messages here — if so, can Phase 2 strand orphaned tool-results at the head of the kept tail?

### `files/s3-upload.md`
- Q2 — What TTL is intended in production — is `S3_PRESIGN_TTL_SECONDS` set anywhere, and do URLs actually survive 24 h given the instance role's temporary credentials?
- Q3 — Does `faborch-user-uploads` have Block Public Access and a lifecycle/retention rule? (Not in `cloudformation/` at the pinned commit.)

### `files/chat-route.md`
- Q2 — Does AI SDK v6 honor `maxTokens: 65536`, or is the obsolete key silently ignored in favor of `maxOutputTokens`? (Needs a runtime check.)

### `files/cmf-types.md`
- Q1 — Runtime-confirm the inversion: does `op=0` really commit and `op=1` really dry-run on the current deployment? (Hotspot §8 Q8, scenario 04 §7.)
- Q2 — Is the inversion scoped to "EntegrisKSPUpgrade, MES 10.2.7", and what is the plan if a CMF upgrade restores nominal semantics? *(also a design decision)*
- Q4 — Where does `CMF_API_Complete_Reference.md` live? (Cited as the verification record; absent from the repo.)

### `files/cmf-client.md`
- Q1 — Is `CMF_TLS_INSECURE=0` actually set in production with the corp CA installed? (03 §8 Q4)
- Q5 — Are the inverted `ExecutionOperation` semantics documented with the CMF vendor, so no one "fixes" them? (Hotspot row 14 / types page.)

### `files/cmf-auth.md`
- Q3 — Confirm the Lambda's ~45-min rotation, ~50-min JWT validity, and that the published `expiresAt` matches the JWT's real `exp`.
- Q5 — Does `cmf-client` handle an MES 401 mid-operation, or is the 60-second margin the only protection?
- Q7 — Where does the `cmf-auth-token` Lambda's source live? (Not in this repo.)

### `files/chat-cmf-tools.md`
- Q4 — Can `readSkeletonMarker` match a user-uploaded file and skip `validateTemplate`'s real parse?

### `files/rule-engine.md`
- Q1 — Is `runRules` reachable in production at `7976c78` (no importer found statically) — pre-flight wiring pending, dynamic, or removed?
- Q5 — Is the `*Count`-suffix skip safe — do any user-fillable columns end in "Count"?

### `files/storage.md`
- Q1 — Is the missing conversation-ownership check in `/api/chat` / `/api/modeling-agent/chat` a real cross-user read/write hole?

### `files/validation-cmf-queries.md`
- Q1 — Confirm CMF property/table names are authored only by trusted CMF modelers/DBAs — no app-user or LLM path can influence them. (Hotspot row 19 / §5.)
- Q2 — Is `CMF_SQL_USER` a read-only login?
- Q6 — Confirm `encrypt: false` / `trustServerCertificate: true` on the CMF SQL connection is the intended production posture.

### `files/admin-tools.md`
- Q5 — What schedules `purge_old_errors` / `purge_old_prompts` / `purgeOldSessionLogs`, or are they manual-only?
- Q6 — Confirm `/api/admin/chat` is the only consumer and always wraps `requireAdmin` — no tool re-checks admin status.

### `files/admin-chat-route.md`
- Q1 — Is `requireAdmin` on this route the sole gate for the admin tools, with no other route able to run them? (hotspot §2)

### `files/email.md`
- Q4 — Does the production relay enforce STARTTLS, given `secure:false` and no `requireTLS` on port 587?
- Q5 — Confirm `APP_URL` and the token generator can never be attacker-influenced, keeping the `href` interpolations a non-issue.

### `files/schema.md`
- Q1 — Where does the DDL for `error_audit_logs`, `prompt_audit_logs`, `error_catalog`, the `*_daily_counter` tables, and the audit-status enums live, and does it include the required `UNIQUE(counter_date)`?
- Q7 — Which is authoritative for the RBAC model gate — the `model_registry` seed ids or the role templates' `allowedModels`?

### `scenarios/01-login.md`
- Item 1 — Verify a login on each app writes the expected `sessions`, `user_session_logs`, and `audit_logs` rows.
- Item 4 — Confirm `LoginSchema` in `admin_athena/lib/validation.ts` (min length, email format).

### `scenarios/02-chat-turn.md`
- Items 1–7 — All seven items are runtime verifications of the traced chat turn: tool availability log, `prepareStep` override survival, prompt caching, SDK v6 usage/cost fields, PENDING-row finalization in every path, `stepCountIs(20)` truncation, `classifyTopic` bucketing.

### `scenarios/03-mcp-tool-call.md`
- Items 1–5 — All five items are runtime verifications: actual tool selection/arguments, real server `Mcp-Session-Id`/expiry/SSE behavior, session-refresh race, silent-drop paths, `error_catalog` rows for the MCP error types.

### `scenarios/04-cmf-load.md`
- Item 1 — Verify against live CMF (runtime + VPN) that `op=0` really commits.
- Item 3 — Verify CMF serializes concurrent `performMDP` calls (AI vs AI, AI vs REST), or add a shared guard. *(also a design decision)*
- Item 5 — Verify production sets `CMF_TLS_INSECURE=0` with the corp CA.
- Item 6 — Verify whether a path-(b) poll timeout can report failure for a load that actually committed.
- Item 7 — Verify the UI always GET-polls to completion, since run closure depends on it.

### `scenarios/05-admin-force-logout.md`
- Items 1–3 — All three are runtime verifications: the admin-chat force-logout path audits and requires confirmation, a self-targeted force-logout cannot lock the admin out, the target user gets 401 on their next request.

### `03-review-hotspots.md` §8 (consolidated)
- Q4 — Is `CMF_TLS_INSECURE` set to `0` in production? (`cmf-client.ts`) *(duplicates cmf-client Q1)*
- Q5 — Where do the **Python MCP servers** and **Lambda** live? (scope §0.2)
- Q6 — What runs the 90-day retention purges? (`session-retention-worker.ts` / `instrumentation.ts`) *(duplicates admin-tools Q5 and the per-audit-page purge questions)*
- Q7 — Is there a last-admin protection anywhere? (`admin-user-service.ts`) *(also a design decision; the deep-dive found none in code)*
- Q8 — Are the inverted CMF op codes documented for every caller? (`cmf/types.ts`) *(duplicates cmf-client Q5)*

### `05-deployment-and-ci.md` §5.9 (ops items)
- Item 1 — Confirm the **live** deploy method (CodeBuild/ECR vs manual zip→EB) — both exist; docs say manual is current.
- Item 2 — Confirm `CMF_TLS_INSECURE=0` in production (hotspots §6). *(duplicates 03 §8 Q4)*
- Item 3 — Confirm the `NODE_OPTIONS` memory value (6144 vs 3072/4096 discrepancy).
- Item 4 — Confirm who/what runs DB migrations and retention purges. *(duplicates 03 §8 Q6)*
- Item 5 — Confirm the Fab CloudFront distribution id (unmanaged: `d7y8a8whrch88`).

---

## B. Improvement decisions (should the system change?)

*The facts here are code-certain; the question is whether the behavior is acceptable.
Pages not listed have no questions of this type.*

### `files/db.md`
- Q1 — Is `ssl: false` to RDS acceptable in production, or a POC leftover? (Blocking question #2.)
- Q2 — Are the `pg` pool defaults adequate for production, and may the two apps' pool settings diverge?

### `files/encryption.md`
- Q3 — Is the absence of key rotation acceptable, or should ciphertexts be versioned?
- Q4 — Should `verifyPassword` treat malformed stored hashes as `false` instead of throwing?

### `files/auth-middleware.md`
- Q1 — Can the `as`-cast `status`/`forcePasswordChange` reads become typed fields by regenerating Fab's Prisma client? (Hotspot row 3.)
- Q2 — Is "audit failure ⇒ authenticate anyway" intended in Fab's `validateSession`?
- Q3 — Is the ≥32-char/30-day/no-rotation token policy intended (03 §2)?

### `files/session-audit.md`
- Q2 — Are the fully silent `.catch(() => {})` on `bumpActivityIfActive` and `.catch(() => 0)` on `closeAllUserSessions` acceptable?
- Q3 — Should the lazy-create `catch {}` distinguish the duplicate-key race from real DB failures?
- Q4 — Is Admin's `bumpActivityIfActive` delegating to the evicting `checkAndRecordActivity` (not `recordActivityWithoutEviction`) intended?
- Q6 — Can the dead exports (`recordAdminForce`; Fab's query/reconcile/purge half) be removed?

### `files/prompt-audit.md`
- Q2 — Is storing full prompt/response text + tool outputs (PII) for 90+ days acceptable? (Hotspot row 5.)
- Q3 — Should the recorders' empty `catch` blocks at least log? (03 §7 task 3)
- Q4 — Is float64-into-NUMERIC cost storage, summed via `Number()` in `admin-tools.ts`, precise enough for billing? (03 §3)
- Q5 — Should Admin's `queryPromptAudit` select the `model` column (the unused Fab copy does)?

### `files/error-audit.md`
- Q2 — Is "persistence failure ⇒ silent `null`, no log line" acceptable when no caller logs it? (03 §6.)
- Q5 — `countErrorAudit` has no callers — planned feature or removable?
- Q6 — Is adding these models to `schema.prisma` (prerequisite for the promised typed `prisma.errorAuditLog.*` switch) planned?

### `files/error-catalog-loader.md`
- Q3 — Should catalog-load failures back off (e.g. bump `cacheLoadedAt` on failure) instead of retrying every error render post-TTL?
- Q4 — `reloadErrorCatalog` has no callers — intended future admin hook, or dead code?
- Q5 — Should `http_status` be range-checked like `priority` is?
- Q6 — Is the plan still to reconcile the 5 drifting copies to one source, and is Admin's own error rendering ignoring the table it edits intended (03 §6)?

### `files/api-error-handler.md`
- Q1 — Is substring-based `classifyError` acceptable, or should classification prefer typed causes over message text? (Hotspot row 8.)
- Q2 — Are `withErrorHandling`/`buildErrorBody` future API or dead code, and should their stale header comments be corrected?
- Q3 — Is partial REQ-01/REQ-03 coverage (most routes bypass `handleApiError`) intended at this commit?
- Q4 — Should the double-swallow of `recordError` failures (empty `.catch`) at least log (03 §6)?
- Q5 — Confirm the `errorId` (UUID) ↔ `ERR-…` id correlation via `error_uuid` is the intended support workflow.

### `files/sql-guard.md`
- Q2 — Is a raw-SQL path planned that will call `assertReadOnlySql`, and is the team aware the check is bypassable?
- Q4 — If ever enforced, should the guard be backed by a real mechanism (`default_transaction_read_only`, a read-only role, or a SQL parser)?

### `files/model-pricing.md`
- Q1 — Are Admin's $15/$75 Opus rates (`claude-opus-4-7`/`-4-6`/`-4-5-20251101`) stale, and which app's numbers should finance trust? *(also verifies the reading)*
- Q2 — Should Admin's map get the four Fab-only models (`claude-fable-5`, `claude-mythos-5`, `claude-opus-4-8`, `claude-sonnet-5`), which today bill $0?
- Q4 — Is `costForTurnAsync` dead code or the intended future API — and if kept, should it gain the unknown-model log?
- Q5 — Which of this map, `ALLOWED_MODELS`, and `model_registry` is authoritative long-term?
- Q6 — Should `hasPricing`/`costForTurn` return a structured `priced: false` signal instead of relying on every call site to check?

### `files/model-registry.md`
- Q1 — Is stale-serve-on-failure the intended degraded mode, and is `logger.warn` enough visibility for a billing-affecting registry outage? (03 §1 row 10)
- Q2 — Is it intended that deactivating a model in NexusOps does not block it while it stays in `ALLOWED_MODELS`? (03 §3)
- Q3 — Is a ~60 s per-instance propagation delay for rate changes acceptable, or should rate-sensitive paths use `reloadModelRegistry` / a shorter TTL?
- Q4 — Are the unused exports `getDefaultModelId` and `reloadModelRegistry` dead API or reserved for a planned hook?
- Q5 — Should `normalizeThinkingType` fall back to the hardcoded per-model mode (not `'none'`) on an unrecognized DB value?

### `files/mcp-client.md`
- Q1 — Is "decrypt failure ⇒ proceed unauthenticated" intended, or should the tool call fail and be recorded as a crypto error? (Hotspot row 11.)
- Q2 — Should `executeWithRetry`'s exception/timeout branch also call `recordError`, and should call site 3 pass `userId`?
- Q3 — Is the personal-connection SSRF surface (user-supplied `serverUrl`) accepted, or should URLs be restricted to the Admin registry / an allowlist?
- Q5 — Is last-write-wins on `sessionId` safe for the session-refresh race on shared role-level connections?
- Q6 — Are the apparently dead `loadActiveMcpTools` and `McpToolCall` safe to remove? *(also verifies the reading)*
- Q7 — Is the `/api/mcp/connections/*` routes' inline duplication of this JSON-RPC/SSE logic (vs importing `parseSSEResponse` etc.) intentional, or a drift hazard?

### `files/context-window.md`
- Q1 — Is chars ÷ 4 plus the 4,000-token buffer accurate enough — any observed context-overflow 400s? (Hotspot row 13.) *(also verifies the reading)*
- Q4 — Is "send over budget and let the API 400" intended when the current exchange alone exceeds the budget, or should there be a phase 3 / user-facing error?
- Q5 — Should the user be told when earlier history was omitted from a turn?
- Q6 — Are `keepFirstUserMessage` and the other unused exports deliberate or removable?

### `files/s3-upload.md`
- Q1 — Is the presigned-URL flow (URLs handed to MCP servers, persisted in `prompt_audit_logs.tool_calls`) the accepted design for private uploads? (03 §1 row 12)
- Q4 — Should `ContentType` be allowlisted instead of client-trusted, and a max upload size enforced?
- Q5 — Should the chat route's `presignKey` fan-out use `allSettled` so a credential hiccup doesn't fail the turn?

### `files/chat-route.md`
- Q1 — Is the `prepareStep` overwrite (container-id forwarding replacing mid-loop tool cleaning) intentional, or a regression needing the two composed? (Scenario 02 §6.)
- Q3 — Should the outer `catch` close the PENDING prompt-audit row, and is a PENDING-row sweeper needed for `maxDuration` cuts?
- Q4 — Are file-only (no text) turns intentionally excluded from prompt audit (REQ-04)?
- Q5 — Is `GET /api/chat` still needed? (No frontend caller found; third registry-unaware model list.)
- Q6 — Should the 429 response use the REQ-01 envelope instead of plain JSON?
- Q7 — Is `lambdaMcpCrash` the intended `onError` classification for Anthropic rate-limit/billing errors?
- Q8 — Confirm presigned-S3-URL exposure in the system prompt (visible to Anthropic and MCP servers) and its TTL are acceptable (hotspot row 12).
- Q9 — What is the hardcoded skill id `skill_01JcCJ…` in `container.skills`, and should it be configurable?

### `files/cmf-types.md`
- Q3 — Would you accept named constants (e.g. `EXECUTION_OP.LOAD` / `EXECUTION_OP.VALIDATE`) replacing the bare `0`/`1` literals at the three call sites?
- Q5 — Is `loadToCmf` passing a hard-coded `0` through the `@deprecated` `loadMasterData`, with no confirmation gate, intended? (Hotspot rows 15/17; chat-cmf-tools page.)

### `files/cmf-client.md`
- Q2 — Is process-wide TLS weakening via `setGlobalDispatcher` acceptable (it also governs the Anthropic SDK's fetch), or should the Agent be scoped per-fetch to CMF calls?
- Q3 — Is `loadToCmf` riding the `@deprecated` `loadMasterData` (all object types, op `0`) intended, or should it migrate to `prepareMasterData` + selected types?
- Q4 — Can the stale Playwright header comment be corrected, and is the old Playwright token-fetch path confirmed gone? *(also verifies the reading)*
- Q6 — Can `LastExecutionLog` ever be non-JSON (throwing out of `pollForCompletion`), and is `result` defaulting to `1` the right conservative choice? *(also verifies the reading)*

### `files/cmf-auth.md`
- Q1 — How many app instances run in production, and are N independent per-process caches acceptable for Secrets Manager rate limits/cost (hotspot row 16)?
- Q2 — Is no-cache-on-stale intended, given a minting-Lambda outage degrades to one `GetSecretValue` per request with no backoff?
- Q4 — Should `MARGIN_MS` guard against `NaN` from a bad `TOKEN_SAFETY_MARGIN_SEC`?
- Q6 — Can the stale Playwright-token-fetch comment in `cmf-client.ts` be corrected, and is that old fetch path fully removed? *(also verifies the reading)*

### `files/chat-cmf-tools.md`
- Q1 — Is hiding `loadToCmf` + `previewLoadImpact` via destructuring permanent — and if so, should both tools be removed from the belt entirely? (Hotspot row 17, 03 §8 Q3.)
- Q2 — If exposure is ever planned, will a code-level gate be added (e.g. `StagedUpload.status === "VALIDATED"` or a UI-supplied confirmation nonce)?
- Q3 — Is riding `@deprecated loadMasterData` — all object types, no `selectedTypes`, no `Run` row, no concurrency guard, no audit record — intended for this path? (Scenario 04 §7.)
- Q5 — Confirm poll-timeout-but-committed (model reports failure; CMF may have committed) is acceptable for this path.

### `files/rule-engine.md`
- Q2 — Is the warning downgrade for R3/R4/R6 and for R1 numeric/FK-typed mandatories intended, leaving CMF's rollback as the only catch? (Hotspot row 18.)
- Q3 — Can the `metadata.ts` `Type`/`ReferencedObjectId` join collision be fixed so R6 becomes a blocking error?
- Q4 — Should `SYSTEM_MANAGED` be replaced by `system-columns.ts::isSystemManaged`, and which of the differing entry sets is correct?
- Q6 — Should an invalid stored `validationRegex` surface a finding instead of being silently ignored?

### `files/storage.md`
- Q2 — Should the 14 bare `catch { return null/false }` blocks log?
- Q3 — Is it acceptable that the chat route ignores `addMessage`'s `null`, so a rendered turn can silently fail to persist?
- Q4 — Confirm plaintext `sessions.token` stays — hashing it breaks the session-audit reconciler.
- Q5 — Is "any authenticated user can edit/rename/bulk-delete all global memory files" intended once the disabled chat memory tool returns?
- Q6 — `updateUser` throws despite its `Promise<User | null>` signature — fix the signature or add the catch?
- Q7 — Are the six dead exports (`createUser`, `deleteUser`, `cleanupExpiredSessions`, `deleteUserSessions`, `getUserById`, `deleteMessage`) intentionally kept, and does anything ever run `cleanupExpiredSessions` (03 §6)? *(also verifies the reading)*
- Q8 — Is never purging soft-deleted conversations, whose messages stay readable by id, the intended retention?

### `files/validation-cmf-queries.md`
- Q3 — Are `parent-precheck.ts`, `validate-rows.ts`, `cross-check.ts`, `referential.ts`, and `validate.ts` intentionally unwired at `7976c78`?
- Q4 — Is `select *` in `lookup-existing.ts` acceptable given rows reach LLM context, or is a system/sensitive-column deny-list needed?
- Q5 — Is the never-refreshed ruleset cache (including cached `null`) acceptable, or should `clearRulesetCache` be wired to something?

### `files/admin-user-service.md`
- Q1 — Should suspend, demote (`toggleUserAdmin`), delete, force-reset, and force-logout refuse the last `isAdmin && ACTIVE` user and the acting admin themselves? (Hotspot row 21 / §4; §8.7; scenario 05.)
- Q2 — Is "commit the mutation, then best-effort email" intended for `forcePasswordReset`, given a failed email leaves the user locked out with no reset link?
- Q3 — Is it intended that an explicit `status` filter in `listUsers` exposes `DELETED` users while the default hides them?
- Q4 — Should chat-origin actions record something more useful than the literal `'chat-admin'` in `audit_logs.ip_address`?

### `files/invitation-service.md`
- Q1 — Is reattaching a `DELETED` user's history to a re-invited email, overwriting only the role, the intended reactivation behavior? (Row 22.)
- Q2 — Is minting a live 30-day session on accept — no separate sign-in or verification beyond the link — the intended posture?
- Q3 — Should `SUSPENDED` users be invitable, given accept throws a raw unique-key error for them?
- Q4 — Are invite tokens meant to stay plaintext in `invitations.token` (same trade-off as `sessions.token`)?
- Q5 — Should the concurrent-accept race be closed (e.g. `SELECT ... FOR UPDATE`) to prevent a double session mint?
- Q6 — Is silent email failure (invite minted, never delivered) acceptable, or should the chat/REST caller surface it?

### `files/admin-tools.md`
- Q1 — Last-admin protection is absent here and in `deleteUser` (contra row 20's claim) — should a real guard be added, and where? (03 §21) *(also verifies the reading)*
- Q2 — Should `bulk_assign_role` require `confirm`, write `audit_logs`, and route through `changeUserRole` like `change_user_role` does?
- Q3 — Should `add_mcp_to_role` / `remove_role_mcp` write `audit_logs` rows like every other admin mutation?
- Q4 — Is it intended that a first-call `confirm:true` to `delete_role` skips the system-role/user-count preview?
- Q7 — Is the `confirm` flag alone a sufficient guard for `update_error_catalog_message` rewriting live user-facing error text?

### `files/admin-chat-route.md`
- Q2 — Should an unknown/mistyped `model` be rejected (there is no allow-list) instead of silently priced at $0?
- Q3 — Should admin turns write `usage_records` (as Fab does), or is `prompt_audit_logs` the single source for admin spend?
- Q4 — Is the Admin-vs-Fab `MODEL_PRICING` divergence (three conflicting Opus ids) intended for admin costs? (hotspot §3)
- Q5 — Should the outer `catch` finalize the PENDING prompt-audit row (hoist `promptAuditHandle`), and is a sweeper needed for `maxDuration` cuts?
- Q6 — Are text-less admin turns intentionally excluded from prompt audit (REQ-04)?
- Q7 — Is discarding all prior tool results from history acceptable, or should balanced tool pairs be preserved as Fab attempts?
- Q8 — Is `lambdaMcpCrash` the right classification for Anthropic rate-limit/overload errors on a route with no Lambda or MCP?
- Q9 — Is default model `claude-sonnet-4-6` the intended admin default (vs Fab's Opus default)?

### `files/email.md`
- Q1 — Should `inviterName`, `roleName`, and `userName` be HTML-escaped before interpolation? (row 23 / §6)
- Q2 — Should the `[DEV]` log lines that print invite/reset URLs with tokens be gated on `NODE_ENV !== 'production'`, or removed? (§6)
- Q3 — Should a `sendMail` failure be surfaced (admin UI or failed invite/reset) rather than swallowed with the token already minted?

### `files/schema.md`
- Q2 — Should those audit tables be checked in (Prisma models or `*.sql`) so a fresh environment is reproducible from the repo?
- Q3 — Should Fab regenerate its Prisma client from the Admin schema in CI so drift (e.g. the missing `McpRegistry`) fails the build?
- Q4 — Confirm plaintext `sessions.token` / `invitations.token` / `password_reset_tokens.token` are intentional and won't be hashed without updating the session-audit reconciler.
- Q5 — Is `Restrict` on `cmf_packages.created_by_user_id` / `cmf_runs.user_id` intended, given Admin only soft-deletes users?
- Q6 — Should soft-deleted `conversations` and `users.status='DELETED'` ever be purged, and should message/artifact reads honour parent `deletedAt`?

### `scenarios/01-login.md`
- Item 2 — Is the Fab "No account found" message intentional despite enabling user enumeration?
- Item 3 — Is the missing admin/role gate at Fab login by design (permissions enforced per-route)?

### `scenarios/04-cmf-load.md`
- Item 2 — Should `execute()` gain a code-level confirmation gate on path (b), since an early or double model call commits without preview?
- Item 4 — Is `loadToCmf` riding `@deprecated` `loadMasterData` (auto-loads ALL types) intended, versus `prepareMasterData`+`executeMasterData` with a selected list?

### `03-review-hotspots.md` §8 (consolidated)
- Q1 — Is `ssl:false` acceptable in production, or a POC leftover? (`db.ts`) *(duplicates db Q1)*
- Q2 — Should Fab login stop leaking account existence? (scenario 01) *(duplicates scenario 01 item 2)*
- Q3 — Is the LLM-reachable `loadToCmf` acceptable without a code-level confirmation gate? (`chat-cmf/tools.ts`) *(duplicates chat-cmf-tools Q1/Q2; note the deep-dive found the tool currently excluded from the belt)*
