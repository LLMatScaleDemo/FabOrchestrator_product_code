# `app/api/chat/route.ts` — the core streaming chat engine

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab** (`claudeai_athena/app/api/chat/route.ts`, ~1,190 lines). Admin has a
> **separate implementation** at `admin_athena/app/api/admin/chat/route.ts` — see the
> Both-apps note. · Review priority: **High** ·
> Catalog row: [01 — File catalog §A](../01-file-catalog.md) · Entry point: [02 — Entry points, Chat & conversations](../02-entry-points.md) · Hotspots: [03 §1 rows 9–13](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)
>
> **Flow trace:** the end-to-end request walk-through (control-flow diagram, sequence
> diagram, status-code matrix) lives in
> [Scenario 02 — One Chat Prompt Turn](../scenarios/02-chat-turn.md). This page is the
> file-centric complement: what each phase of the code does, its side effects, and where
> it can fail.

## Purpose

The single endpoint behind every Fab chat turn. `POST /api/chat` authenticates the user,
enforces model access and daily quotas, persists the user message and its attachments,
assembles the tool set (code execution, web search/fetch, MCP), fits the conversation
into the context window, and streams the Claude response back as SSE — while writing the
usage, cost, prompt-audit, and error-audit records that the Admin app's dashboards read.
It is the biggest single consumer of the platform's shared `lib/` modules; nearly every
other High-priority file is on its call path.

## Depends on / consumed by

**Depends on** (all Fab `lib/` unless noted — deep-dive pages linked where they exist):
- [`auth-middleware.ts`](./auth-middleware.md) — `requireAuth` (phase 1).
- `validation.ts` — `validateOrThrow` + `ChatRequestSchema` (phase 2).
- [`model-registry.ts`](./model-registry.md) — `getAllowedModelIds`, `getRegistryRates`,
  `getThinkingConfig` (phases 3, 6).
- `errors/parameter-values.ts` — hardcoded `ALLOWED_MODELS` fallback list (phase 3).
- `db.ts` (dynamic import) — role/RBAC lookups, `usageRecord` aggregate + create.
- [`prompt-audit.ts`](./prompt-audit.md) — `recordPromptStart` / `recordPromptSuccess` /
  `recordPromptFailure` (phases 7, 10); topic classification happens inside that module.
- `s3-upload.ts` — `uploadUserFileToS3`, `presignKey` (phases 8, 9; hotspot row 12).
- `storage.ts` — `addMessage`, `getMessages`.
- `mcp-client.ts` — `loadActiveMcpToolsWithDescriptions` (decrypts MCP credentials via
  [`encryption.ts`](./encryption.md); hotspot row 11).
- `anthropic.ts` — AI-SDK provider, `createAnthropicWithContainerUploads` (fetch wrapper
  that injects `container_upload` blocks), and a re-export of the SDK's
  `forwardAnthropicContainerIdFromLastStep`.
- `anthropic-files.ts` — Anthropic Files API client (container uploads, file-download
  metadata).
- `system-prompts.ts` — `buildSystemPromptWithTools`.
- `context-window.ts` — `fitMessagesToContextWindow` (hotspot row 13).
- [`session-audit.ts`](./session-audit.md) — `bumpActivityIfActive` (end-of-stream
  activity bump).
- `errors/faborch-errors.ts` + [`errors/api-error-handler.ts`](./api-error-handler.md) +
  [`errors/error-audit.ts`](./error-audit.md) — canonical envelopes, outer catch, and
  stream-time error persistence.
- [`model-pricing.ts`](./model-pricing.md) — `costForTurn`, `costForTurnWithRates`,
  `hasPricing` (cost math in `onFinish`).
- External services: PostgreSQL, S3 (`faborch-user-uploads`), the Anthropic API
  (streaming + Files API), and any active remote MCP servers.

**Consumed by** (verified by grep at the pinned commit): two frontend callers, both via
the AI SDK `useChat` hook + `DefaultChatTransport`:
- `components/full-chat-app.tsx` (~line 949) — the main chat UI; sends
  `{ model, webSearch, enableReasoning, conversationId, activeMcpIds }` with each turn.
- `components/cockpit/cockpit-ask.tsx` (line 44) — the Cockpit "Ask" box; streams with
  `activeMcpIds: []`.

No caller of the `GET` export was found — the frontend model picker fetches
`/api/user/models` instead (both `full-chat-app.tsx` and `modeling-chat-app.tsx`).

## Function-by-function

The file has three exports: `maxDuration = 300` (App Runner/Next.js runtime cap, 5 min),
`POST` (the engine), and `GET` (a legacy model list). Two module-level helpers support
`POST`. Since `POST` is one ~1,000-line function, it is documented by **phase**.

### Module-level helpers

- `getThinkingMode(modelId)` — hardcoded fallback thinking classification:
  `claude-opus-4-7` / `claude-sonnet-5` / `claude-opus-4-8` → `'adaptive'`;
  `MANUAL_THINKING_MODELS` is an **empty array**, so `'manual'` is unreachable from the
  hardcoded path (only the registry can select it); everything else → `'none'`.
- `isServerTool(c)` / `cleanToolMessages(messages)` (lines ~49–137) — drops tool-call /
  tool-result blocks that are errored, orphaned, or server-tool results split out of
  their assistant message (works around vercel/ai #11855 and #8112, which otherwise make
  Anthropic 400 the request on replay). Balanced successful pairs pass through untouched.
  **The doc-comment claims this also runs per-step via `prepareStep` — it does not; see
  Failure modes.**

### `POST(req)` — phase by phase

**1. Auth** — `requireAuth(req)` ([auth-middleware.md](./auth-middleware.md)): 401
SESSION_TIMEOUT / 403 suspend / 403 force-password-change all short-circuit here. The
Bearer token is captured into `bearerToken` so the streaming `onFinish` can bump the
activity clock after a multi-minute response.

**2. Validation** — `validateOrThrow(ChatRequestSchema, body)` →
`{ messages, model, enableReasoning=true, conversationId, webSearch=false, activeMcpIds=[] }`;
bad input throws the canonical `INVALID_PARAMETER` (400). Model defaults to
`claude-opus-4-8` if empty.

**3. Model gate** — allowed = `getAllowedModelIds()` (registry, ~60 s cache) **∪**
hardcoded `ALLOWED_MODELS`. Not in the union → 400 with the valid options. Because this
is a union, deactivating a model in the Admin registry does **not** block it if it is
still in `ALLOWED_MODELS` (hotspot row 10). Registry per-token rates for the requested
model are also preloaded here (`getRegistryRates`, errors swallowed → hardcoded pricing
fallback) so `onFinish` can price steps synchronously.

**4. RBAC + quotas** — `prisma.user.findUnique({ include: role })`. Non-admins are
restricted to `role.allowedModels`, but **only if** that list references at least one
currently-valid model id — roles still listing only retired pre-rebrand ids do not lock
users out (in-code comment documents the intent). Then rolling-24h
`usageRecord.aggregate`: request count ≥ `dailyRequestLimit` or token sum ≥
`dailyTokenLimit` → **429 as plain JSON** (not the canonical FabOrch envelope).

**5. Thinking resolution** — `getThinkingConfig(modelId)` (registry) with fallback to
the hardcoded sets; `enableReasoning=false` forces `'none'`. Manual budget defaults to
16000 if the registry doesn't supply one.

**6. Prompt-audit open (REQ-04)** — extracts the last user message's text; if non-empty,
`recordPromptStart(...)` inserts a PENDING row in `prompt_audit_logs` (with
`user_name`/`user_email` — PII, hotspot row 5). **A file-only message with no text skips
prompt auditing entirely.**

**7. S3 upload** — every `data:` file part on the current turn goes to S3 via
`Promise.allSettled` (per-file failures logged, never fatal). Durable S3 **keys** are
kept for message metadata; history is never re-uploaded.

**8. Persist user message** — if `conversationId` is set, `addMessage` writes the user
turn with `metadata.s3Files` carrying the S3 keys.

**9. Tool assembly** — `code_execution` (Anthropic server tool) is **always** added;
`web_search` (maxUses 5) + `web_fetch` (maxUses 3) only when `webSearch` is toggled; a
~60-line memory tool is present but **commented out**. `activeMcpIds` from the client
are filtered against an authorization query (`mcpConnection.findMany`: role-level rows
with `userId=null`, plus personal rows only if `role.personalMcpEnabled`) — the client
cannot activate an MCP it isn't entitled to. Authorized ids are then loaded via
`loadActiveMcpToolsWithDescriptions` (network; failure logged and swallowed — chat
continues without MCP tools).

**10. Message sanitation + container uploads** — history parts that
`convertToModelMessages` can't handle are stripped; inline-supported MIME types
(jpeg/png/gif/webp/pdf/plain text) stay as file parts; unsupported ones
(xlsx/docx/pptx/csv) are uploaded to the **Anthropic Files API** and replaced with a
text hint ("uploaded to the sandbox"), their file ids later injected into the request
body as `container_upload` blocks via `createAnthropicWithContainerUploads`. Then
`cleanToolMessages(convertToModelMessages(...))` (phase-0 helper) sanitizes tool pairs.

**11. S3 refs into the prompt** — collects the current turn's S3 keys plus every
`metadata.s3Files` key from the saved conversation, mints a **fresh presigned GET URL**
per key (`presignKey`), and passes them to `buildSystemPromptWithTools` — so
time-limited URLs to a private bucket are embedded in the system prompt sent to
Anthropic, and reachable by the model's tools (hotspot row 12).

**12. Context-window fit + prompt caching** — `fitMessagesToContextWindow(messages,
systemPrompt)` trims tool results and drops old message groups (hotspot row 13). Prompt
caching (`cacheControl: ephemeral` breakpoints on a folded-in system message and on the
last message) is enabled **only when there are no presigned file URLs** — they change
every request and would bust the prefix cache.

**13. streamText config** — model provider (container-upload wrapper if needed),
`system` or cached system-message, `maxTokens: 65536`, **no temperature** (rejected by
current-gen Claude models), `stopWhen: stepCountIs(20)` when tools exist (always true —
code_execution is unconditional), verbose `onStepFinish` console logging,
`providerOptions.anthropic`: thinking (`{type:'adaptive'}` + `effort` `'max'` for Opus /
`'high'` for Sonnet, or `{type:'enabled', budgetTokens}` for manual mode) and
`container.skills` (pptx/docx/pdf/xlsx + one custom skill id, always attached).
`prepareStep` is assigned **twice** — first a `cleanToolMessages` wrapper, then
overwritten with `forwardAnthropicContainerIdFromLastStep` (see Failure modes).

**14. Stream execution** — `streamText(...)` then `result.consumeStream()` so the
backend finishes (and persists) even if the client disconnects. `createUIMessageStream`'s
`execute`: 15 s `data-keepalive` writes (App Runner idle-drop workaround), merges the
token/reasoning stream to the client, then after completion scans all steps' tool
results for code-execution `file_id`s, dedupes by filename (last id wins), enriches via
Files API `retrieveMetadata` (failure ignored), and writes `data-fileDownload` chunks.

**15. `onFinish`** — all inside `if (conversationId)` for persistence:
- **Assistant message**: `responseMessage.parts` (exactly what the client saw) is mapped
  to serializable parts, `file-download` parts appended, and saved via `addMessage` with
  `metadata: { reasoning, stepsCount, model }`.
- **Usage record**: per-step usage summed reading AI-SDK v6 field names first
  (`inputTokens`…) with v5 fallbacks (`promptTokens`…), then `usageRecord.create`
  (tokens only — **no cost column**; the Admin dashboards price it later). Failure is
  caught and logged.
- **Prompt-audit success (REQ-04)**: builds `tool_calls` summaries (pairing calls to
  results by `toolCallId` — MCP results, typically including generated SQL + rows, are
  persisted into `prompt_audit_logs.tool_calls`), buckets tokens/cost as step 0 input →
  `request_*`, later steps' input → `retrieval_*`, all output → `response_*`. Each step
  is priced with **that step's own model id** using registry rates, else
  `costForTurn`/`MODEL_PRICING`. Lines **1049–1055**: if a step's model has neither
  registry rates nor hardcoded pricing, `logger.fabOrchError("No pricing for model …
  cost will be 0")` fires **once per request** (`unknownModelLogged` flag) — this is the
  call-site guard that hotspot row 9's deep-dive confirmed exists. Then
  `recordPromptSuccess(...)` finalizes the PENDING row.
- **Activity bump (REQ-02)**: `bumpActivityIfActive(bearerToken)` fire-and-forget, so a
  long stream doesn't read as idle time.

**16. `onError`** — normalizes any stream-time error into a `FabOrchError`:
rate-limit/overloaded/529 and invalid-key/billing strings → `lambdaMcpCrash` (note the
misleading type name — these are Anthropic-side conditions), timeout/aborted →
`responseTimeout`, everything else → `lambdaMcpCrash`. Then, fire-and-forget: structured
log, `recordError` into `error_audit_logs` (dynamic import,
[error-audit.md](./error-audit.md)), and lines ~1129–1140 `recordPromptFailure` closing
the prompt-audit row with the error envelope (REQ-03/REQ-04 — the "stream-time error
persistence" hotspot item). Returns `"<userMessage> (errorId=…)"` as the client-visible
error text — the stream is already HTTP 200 at this point.

**17. Response / outer catch** — `createUIMessageStreamResponse` with
`X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`. Any pre-stream throw
falls to `handleApiError` ([api-error-handler.md](./api-error-handler.md)) for the
canonical envelope.

### `GET(): Response` — legacy model list

Returns a hardcoded array of the three branded models (`claude-opus-4-7` "FabOrchestrator
1.0", `claude-sonnet-5` "1.1", `claude-opus-4-8` "2.0") + `defaultModel:
'claude-opus-4-8'`. No auth, no registry integration — and no frontend caller found at
the pinned commit (the UI uses `/api/user/models`, which does read the registry). Drift
hazard: three model lists now exist (this GET, `ALLOWED_MODELS`, the registry).

## Failure modes & gotchas

- **`prepareStep` is overwritten — mid-loop tool cleaning is dead code.** Line ~660 sets
  `prepareStep` to a `cleanToolMessages` wrapper; line ~746 unconditionally reassigns it
  to `forwardAnthropicContainerIdFromLastStep`, which is a plain re-export from
  `@ai-sdk/anthropic` and does **no** tool cleaning. The comments at lines ~78 and ~656
  ("we run this on the initial messages *and* via streamText's `prepareStep`") are
  therefore wrong at this commit: cleaning runs only on the initial history, and the
  #11855/#8112 protections do not apply mid-loop. (Scenario 02 §6 flagged this as a
  runtime question; the overwrite is confirmable statically.)
- **PENDING prompt-audit rows can leak.** `promptAuditHandle` is declared inside the
  `try`, so the outer `catch` cannot finalize it (the comment at line ~1154 admits
  this). Any throw between `recordPromptStart` and the stream opening — e.g.
  `addMessage`, the MCP authorization query, `convertToModelMessages` — leaves the row
  PENDING forever. `maxDuration` hard cuts may do the same.
- **Text-less turns are invisible to prompt audit.** A message that is only file
  attachments skips `recordPromptStart` (and thus success/failure finalization), though
  usage records are still written.
- **429s bypass the canonical error envelope** — plain `{ error: '...' }` JSON, unlike
  every other failure in this route.
- **Error-type mislabeling in `onError`** — Anthropic rate limits, overloads, and even
  invalid-API-key/billing failures are all recorded as `lambdaMcpCrash`; error-audit
  dashboards will attribute Anthropic-side incidents to "Lambda MCP".
- **Almost everything is best-effort by design**: S3 upload, MCP loading, registry
  reads, usage recording, prompt/error audit, Files-API metadata — all are caught and
  logged so the stream never breaks. The flip side: a persistent failure in any of them
  (e.g. audit DB down) degrades silently.
- **Model-gate union**: admin deactivation in the registry does not block a model still
  in the hardcoded `ALLOWED_MODELS` (hotspot row 10); role restrictions are skipped for
  admins and for roles listing only retired ids.
- **Older web-tool variants pinned**: `webSearch_20250305` / `webFetch_20250910`; newer
  `_20260209` variants (with dynamic filtering) exist for the models in use. Not a bug,
  but worth an intentionality check.
- **Manual-thinking path is a latent 400**: `MANUAL_THINKING_MODELS` is empty, but the
  registry can return `thinkingType: 'manual'`; sending
  `{type:'enabled', budgetTokens}` to the current-gen models this route serves
  (`claude-opus-4-8/-4-7`, `claude-sonnet-5`) is rejected by the Anthropic API
  (`budget_tokens` removed on those models). Harmless while no registry row selects it.
- **Verbose console logging** of tool args/results (truncated to 200–300 chars) on every
  step — may land MCP data fragments in application logs in addition to the audit
  tables.

## Open questions for the code owner

1. Is the `prepareStep` overwrite (container-id forwarding replacing mid-loop tool
   cleaning) intentional, or a regression needing the two composed? (Scenario 02 §6.)
2. Does AI SDK v6 honor `maxTokens: 65536`, or is the obsolete key silently ignored in
   favor of `maxOutputTokens`? (Needs a runtime check.)
3. Should the outer `catch` close the PENDING prompt-audit row, and is a PENDING-row
   sweeper needed for `maxDuration` cuts?
4. Are file-only (no text) turns intentionally excluded from prompt audit (REQ-04)?
5. Is `GET /api/chat` still needed? (No frontend caller found; third registry-unaware
   model list.)
6. Should the 429 response use the REQ-01 envelope instead of plain JSON?
7. Is `lambdaMcpCrash` the intended `onError` classification for Anthropic
   rate-limit/billing errors?
8. Confirm presigned-S3-URL exposure in the system prompt (visible to Anthropic and MCP
   servers) and its TTL are acceptable (hotspot row 12).
9. What is the hardcoded skill id `skill_01JcCJ…` in `container.skills`, and should it
   be configurable?

## Both-apps note

This file exists **only in Fab**. The Admin app's chat endpoint,
`admin_athena/app/api/admin/chat/route.ts` (`POST /api/admin/chat`,
[02 — Entry points](../02-entry-points.md)), is a **distinct implementation, not a
copy**: it is gated by `requireAdmin` rather than `requireAuth`, drives the ~30
admin tools in `lib/admin-tools.ts` (each self-logging to `audit_logs`) instead of
code-execution/web/MCP tools, and has no S3 attachment or container-skills pipeline. It
shares the same *patterns* (AI-SDK streaming, prompt-audit with `app: 'faborch-admin'`
vs Fab's `'faborch'`, model pricing) via the audit/pricing modules' Admin copies. It will get its own deep-dive page
together with `admin-tools.ts`; do not assume any finding on this page applies to it.
