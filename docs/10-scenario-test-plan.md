# 10 — Scenario Runtime Test Plan

> Purpose: **runtime-validate the five scenario traces** (`docs/scenarios/01`–`05`) so their
> badges can move 🔵 Static → 🟢 Runtime in the [sign-off tracker](./07-signoff-tracker.md).
> Scenarios were traced at commit `7976c78`; the current build is `abe8706`+ (merged
> 2026-07-22). Impact analysis found **no scenario claim invalidated** by that merge, so
> these tests may run on the current build — one addition is flagged inline (T4.1).
>
> Each test states: the **doc claim** it checks, **steps**, **expected evidence**
> (HTTP / SQL / logs), and the **open validation item** it closes. A test that FAILS is a
> *documentation finding*, not a code bug per se — record what actually happened and
> correct the scenario doc.

---

## 0. Prerequisites & environment

| Need | Detail |
|------|--------|
| Both apps running | Fab (`claudeai_athena`) and Admin (`admin_athena`) against the **shared** PostgreSQL, with server logs visible (console or CloudWatch). |
| DB access | `psql` (or client) on the shared DB to run the verification queries below. Read-only is enough. |
| Test accounts | **F1**: Fab regular ACTIVE user · **F2**: SUSPENDED user · **A1**: Admin (`isAdmin`, ACTIVE) · **A2**: non-admin ACTIVE user · **T1**: throwaway target user for scenario 05. Create via Admin invite flow or seed. |
| Test role | A role with a low `dailyRequestLimit` (e.g. 2) for the 429 test (T2.8), assignable to F1 temporarily. |
| MCP | At least one working MCP connection (role-level) + one deliberately broken one (unreachable URL) for scenario 03. |
| CMF (scenario 04 only) | VPN up; MES token secret readable; **CMF owner present**; a sandbox/disposable object name agreed (e.g. `ZZ_DOCTEST_REASON_<date>`). |
| Evidence log | Copy §6's results table; record timestamps, response bodies, SQL output, and log excerpts per test. |

**Safety rules for scenario 04** (live factory MES): run tests in tier order (read-only →
validate-only → one sandbox commit). Never improvise extra loads. Remember the **inverted
op codes**: `0` = COMMIT, `1` = validate-only. The one commit test (T4.2) loads a single,
uniquely-named, agreed-with-owner sandbox record.

Useful queries (parameterize `<userId>`, `<t0>` = test start time):

```sql
-- sessions / audit written by a login (S01) or removed by force-logout (S05)
SELECT id, user_id, expires_at FROM sessions WHERE user_id = '<userId>';
SELECT session_status, login_time, logout_time, closed_reason, login_ip
  FROM user_session_logs WHERE user_id = '<userId>' ORDER BY login_time DESC LIMIT 5;
SELECT action, target_id, metadata, created_at FROM audit_logs
  WHERE created_at > '<t0>' ORDER BY created_at DESC LIMIT 10;

-- prompt/usage/error audit for a chat turn (S02/S03)
SELECT status, model, topic, input_tokens, output_tokens, total_cost, created_at
  FROM prompt_audit_logs WHERE user_id = '<userId>' AND created_at > '<t0>';
SELECT model, input_tokens, output_tokens, cost FROM usage_records
  WHERE user_id = '<userId>' AND created_at > '<t0>';
SELECT error_type, user_message, created_at FROM error_audit_logs
  WHERE created_at > '<t0>' ORDER BY created_at DESC LIMIT 10;

-- MCP connection state (S03)
SELECT id, status, session_id, jsonb_array_length(available_tools) AS tools
  FROM mcp_connections WHERE id = '<connId>';

-- CMF run lifecycle (S04)
SELECT id, operation, status, created_at, completed_at FROM cmf_runs
  ORDER BY created_at DESC LIMIT 5;
```

---

## 1. Scenario 01 — Login

| ID | Validates (doc claim) | Steps | Expected evidence | Closes |
|----|----------------------|-------|-------------------|--------|
| T1.1 | Fab happy path writes 3 audit surfaces (§2, §5) | `POST /api/auth/login` on Fab as F1 | `200` with `{user, token, expiresAt≈now+30d}`; SQL: new `sessions` row, `user_session_logs` row `ACTIVE` with `login_ip`/user-agent, `audit_logs` `action='user.login'`; `users.last_login` updated | item 1 (Fab) |
| T1.2 | Admin happy path, same writes + `isAdmin`/`role` in body (§3) | Same on Admin as A1 | `200` incl. `isAdmin`, `role`; same 3 DB writes | item 1 (Admin) |
| T1.3 | Fab reveals account existence (§4, §5 finding) | Fab login with unregistered email | `401` body says **"No account found with this email"** (verbatim check) | evidence for item 2 |
| T1.4 | Admin is generic (§4) | Admin login with unregistered email, then with wrong password | `401` **"Invalid email or password"** in *both* cases (indistinguishable) | — |
| T1.5 | Fab wrong-password branch (§2) | Fab login as F1, bad password | `401` "Incorrect password…"; **no** new `sessions` row | — |
| T1.6 | Admin rejects non-admins (§3 key difference) | Admin login as A2 (valid password) | `403` "Admin access required"; no session created | evidence for item 3 |
| T1.7 | SUSPENDED blocked on both (§4) | Login as F2 on each app | `403` on both | — |
| T1.8 | Admin Zod `LoginSchema` vs Fab manual check (§4) | Send `{email:"notanemail", password:"x"}` to both | Admin: `400` with field-level Zod errors (record which rules fire — min length? email format?); Fab: `400` only if a field is *missing* (malformed email passes the presence check → expect `401` instead) | item 4 |

## 2. Scenario 02 — Chat turn (`POST /api/chat`)

| ID | Validates | Steps | Expected evidence | Closes |
|----|----------|-------|-------------------|--------|
| T2.1 | Baseline tool set + full audit chain (§2 steps 10, 19) | One plain turn as F1 (no web, no MCP, no files) | Server log `[Chat] Available tools` lists **`code_execution` only**; SSE completes; SQL: user+assistant `messages`, `prompt_audit_logs` **PENDING → SUCCESS**, one `usage_records` row | items 1, 5 (success path) |
| T2.2 | Conditional tools (§2 step 10) | Repeat with `webSearch=true`; then with `activeMcpIds` set | Log shows `web_search`+`web_fetch` added; then `mcp_*` tools added | item 1 |
| T2.3 | Cost uses registry rates (§2 step 4, 19) | After T2.1, compare `usage_records.cost` / `prompt_audit_logs.total_cost` against `model_registry` rates for that model (SQL join by hand) | Cost = tokens × registry rates (not the hardcoded `MODEL_PRICING` numbers, which differ for some models) | item 4 |
| T2.4 | Prompt caching on/off (§2 step 16) | Send the same prompt twice in one conversation; then once with a file attached | Turn 2: `cachedInputTokens > 0` in usage/logs; file turn: caching fields 0/absent | item 3 |
| T2.5 | Container-id forwarding survives (§2 steps 12, 17) | A turn that forces multi-step code-execution (e.g. "run this Python, then modify and re-run") | All steps complete; step ≥2 reuses the container (log shows forwarded container id); no orphaned-tool-pair 400 from Anthropic | item 2 |
| T2.6 | Error path audits (§2 step 19 onError) | Trigger a mid-stream tool failure (call the *broken* MCP connection's tool) | Stream returns error text with `(errorId=…)`; SQL: `error_audit_logs` row + `prompt_audit_logs` FAILED | item 5 (failure path) |
| T2.7 | `stepCountIs(20)` behavior (§2 step 17) | Prompt engineered to chain many tool calls ("do these 25 small code steps one at a time") | Record what happens at the cap: does the turn end with a coherent message or silently stop? (Either result = doc update) | item 6 |
| T2.8 | Quota gate (§2 step 5) | Set F1's role `dailyRequestLimit=2`; send 3 turns | Third → `429` "Daily limit reached"; restore the role after | — |
| T2.9 | `classifyTopic` bucket (§2 step 19) | One clearly manufacturing prompt ("What is OEE for an etch tool?") | `prompt_audit_logs.topic` = the expected manufacturing bucket | item 7 |

## 3. Scenario 03 — MCP tool invocation

| ID | Validates | Steps | Expected evidence | Closes |
|----|----------|-------|-------------------|--------|
| T3.1 | Discovery handshake + cache (§2 steps 1–4) | `POST /api/mcp/connections/[id]/test` on the working connection | `200`; SQL: `mcp_connections.status='connected'`, `session_id` set, `available_tools` populated. From server logs record: did the server return `Mcp-Session-Id`? Did it answer **JSON or SSE**? | item 2 (partial) |
| T3.2 | LLM tool choice + arguments (§2 steps 9–12) | Chat turn as F1 designed to trigger one MCP tool | Log shows the chosen `mcp_<name>` and its exact `arguments`; result streamed back | item 1 |
| T3.3 | Session-expiry refresh + retry-once (§2 step 11) | Corrupt `session_id` in DB (`UPDATE mcp_connections SET session_id='stale'`), then trigger the tool | Logs: first call fails with the server's expiry message (**record its text** — does it match the 6 substrings?), `refreshMcpSession` runs `initialize`, retry succeeds; `session_id` rewritten | items 2, 3 (single-user half) |
| T3.4 | Silent authorization drop (§2 step 6) | Include another user's personal `connectionId` in `activeMcpIds` | Turn succeeds; that connection's tools absent; **no error shown to user** (confirms the silent drop) | item 4 (authz half) |
| T3.5 | Error classification + persistence (§3) | Trigger the broken-URL connection's tool | LLM receives `{isError:true, "... (errorId=…)"}`. SQL: check whether `error_audit_logs` has the row — the mcp-client deep-dive predicts the **thrown-exception branch (DNS/timeout) is logger-only**; record which branch actually persisted | item 4 (decrypt half is code-inspect only), deep-dive Q2 |
| T3.6 | Catalog rows exist (§3 note) | `SELECT error_type, user_message FROM error_catalog WHERE error_type IN ('LAMBDA_MCP_CRASH','RESPONSE_TIMEOUT','UNLISTED_STORED_PROC','INVALID_PARAMETER');` | Rows exist with sensible messages (or record fallback-to-hardcoded) | item 5 |
| T3.7 *(optional)* | Concurrent refresh race (§4 shared session) | Two simultaneous chats on one role-level connection right after corrupting `session_id` | Both eventually succeed; record whether one retry clobbers the other's fresh session (last-write-wins) | item 3 (concurrent half) |

## 4. Scenario 04 — CMF master-data load ⚠️ (tiered; CMF owner present)

| ID | Tier | Validates | Steps | Expected evidence | Closes |
|----|:---:|----------|-------|-------------------|--------|
| T4.0 | 0 — no CMF calls | Prod TLS config (§5) | Ops reads the prod env: is `CMF_TLS_INSECURE=0` set? | Yes/no recorded (this is also tracker Top-5 #3) | item 5 |
| T4.1 | 1 — validate only | `op=1` does **not** persist (§3) | Stage the sandbox workbook, run the app's **validate** step only | CMF dry-run reports counts; SQL/CMF UI confirm the object was **not** created. *Note: on the current build the validate route also runs the new local cross-sheet PK/FK gate (commit `9db9ff1`) — record its findings output; this is post-pin behavior.* | supports item 1 |
| T4.2 | 2 — ONE sandbox commit | **`op=0` really commits** (§3 — the inverted-op landmine) | `POST /api/cmf/packages/[id]/load` with `selectedTypes=[Reason]` for the agreed `ZZ_DOCTEST_…` record | `202 {runId}`; `cmf_runs` row OPEN → (poll `GET /api/cmf/packages/[id]`) → run completes; the record **exists in CMF**. Owner deletes/retires it afterward per their procedure | items 1, 7 (partial) |
| T4.3 | 2 | REST concurrency guard (§2a step 4) | While T4.2's run is OPEN, fire a second `POST /load` | `409` already-in-progress (pre-check or P2002 path — record which) | item 3 (REST half) |
| T4.4 | 1 | AI path is **not exposed** (§1b; chat-cmf-tools deep-dive) | In the modeling-agent chat, ask outright: "load this file into CMF now" | The model **cannot** call `loadToCmf` (tools log lacks it); it instructs the user to use Master Data Load instead. If it *can* → stop, escalate: the exclusion was removed | item 2 evidence; AI-vs-AI half of item 3 is untestable while excluded |
| T4.5 | 2 | Run closure is reconcile-driven (§2a step 9) | After a load, keep the UI open → run closes. Then repeat a validate-run and close the tab immediately | With polling: run completes. Without: run stays OPEN and flips **EXPIRED after >15 min** (confirms nothing else closes it) | item 7 |
| T4.6 *(only if observed)* | 2 | Poll-timeout-but-committed ambiguity (§4) | If any load takes >60 s during the above, record whether the caller reported failure while CMF committed | Recorded either way | item 6 |

## 5. Scenario 05 — Admin force-logout

| ID | Validates | Steps | Expected evidence | Closes |
|----|----------|-------|-------------------|--------|
| T5.1 | Full REST path + transactional audit (§2) | Log T1 in on Fab (keep the token). As A1: `POST /api/admin/users/<T1>/force-logout` | `200 {sessionsDeleted:1,…}`; SQL: T1's `sessions` gone, `user_session_logs` → `CLOSED_ADMIN`/`admin_force`, `audit_logs` `user.force_logout` written; **then** any request with T1's old token → `401` | item 3 |
| T5.2 | Chat-path claim (§1 — **expected to FAIL as written**) | In admin AI chat: "force logout user T1" | The deep-dive found `admin-tools.ts` has **no force-logout tool** (tracker discrepancy 18) — record what the AI actually does (likely offers suspend/delete, which evict sessions via other calls). Outcome feeds a scenario-05 §1 correction | item 1 |
| T5.3 | Self-target behavior (§4 reviewer check) | As A1, force-logout **A1's own id** (from a second browser session) | Record: are A1's sessions deleted, logging A1 out? (Deep-dive predicts **no self-block exists**.) Whatever happens is the answer | item 2 |
| T5.4 | Idempotency (§3) | Repeat T5.1 against T1 (who now has no sessions) | `200 {sessionsDeleted:0}` | — |

---

## 6. Results & sign-off

Record one row per test:

| Test | Date | Runner | Result (PASS / FAIL / PARTIAL) | Evidence (log/SQL snippet or link) | Doc correction needed? |
|------|------|--------|-------------------------------|------------------------------------|------------------------|
| T1.1 | | | | | |
| …    | | | | | |

Then, per scenario:

1. **All tests PASS** → flip the scenario's badge to 🟢 Runtime in the doc header and in
   [tracker §7.3](./07-signoff-tracker.md); tick the matching "Open validation items".
2. **Any FAIL/PARTIAL** → the trace is wrong or incomplete: correct the scenario doc first
   (cite the evidence), *then* flip the badge. T5.2 is expected to land here.
3. Items this plan **cannot** close (design judgments, e.g. "should there be a gate?")
   stay open — they are the **B**-column decisions in
   [doc 09](./09-open-questions-by-purpose.md) and the tracker Top-5.

Coverage note: of the 26 open validation items across the five scenarios, this plan
exercises 22 at least partially; the rest are code-inspection or design questions out of
runtime scope (S03 decrypt-failure branch needs a fault injection no test above forces;
S04's AI-vs-AI concurrency is untestable while `loadToCmf` stays excluded).
