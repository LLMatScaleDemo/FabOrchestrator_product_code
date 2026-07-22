# `app/api/admin/chat/route.ts` — the chat-driven admin engine

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Admin** (`admin_athena/app/api/admin/chat/route.ts`, ~264 lines). The Fab app has a
> **separate, much larger implementation** at `claudeai_athena/app/api/chat/route.ts` —
> see [`./chat-route.md`](./chat-route.md) and the Both-apps note. · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Entry point:
> [02 — Entry points, Admin console `POST /admin/chat`](../02-entry-points.md) · Hotspots:
> [03 §2 (admin authZ assumption)](../03-review-hotspots.md#2-security--authorization),
> [03 §3 (pricing-map divergence)](../03-review-hotspots.md#3-money--cost-accuracy)
>
> **Read this alongside [`./chat-route.md`](./chat-route.md).** This page is the ADMIN
> counterpart and is written as a **contrast**: it documents what differs, and points at
> the Fab page for the shared patterns (AI-SDK streaming, prompt-audit bucketing,
> `onError` classification) rather than re-explaining them.

## Purpose

The single endpoint behind every NexusOps (Admin) chat turn. `POST /api/admin/chat`
authenticates the caller as an **admin**, assembles the ~30 admin tools from
[`admin-tools.ts`](./admin-tools.md), prepends the current date to the admin system
prompt, and streams a Claude response back as SSE — while writing the prompt-audit and
error-audit records the Admin dashboards read. It is deliberately **thinner** than the Fab
chat route: no model gate, no per-user quotas, no attachments/S3, no MCP, no CMF, and no
local context-window trimming. Its security significance is outsized, though: **this route
is the *only* gate in front of the entire admin tool surface** — the tools in
`admin-tools.ts` (user delete/suspend, role edits, purge jobs, raw-SQL reads) do **not**
re-check `isAdmin` themselves.

## Depends on / consumed by

**Depends on** (all Admin `lib/` unless noted; deep-dive pages linked where they exist):
- [`auth-middleware.ts`](./auth-middleware.md) — `requireAdmin` (phase 1). **Not** `requireAuth`.
- [`admin-tools.ts`](./admin-tools.md) — `getAdminTools(adminUserId)` builds the tool belt (phase 4).
- `admin-system-prompt.ts` — `ADMIN_SYSTEM_PROMPT` (phase 5).
- [`prompt-audit.ts`](./prompt-audit.md) — `recordPromptStart` / `recordPromptSuccess` /
  `recordPromptFailure`, called with `app: 'faborch-admin'` (phases 3, 7, 8). Per the
  prompt-audit deep-dive, that `app` value is used as **app-attribution** since the `app`
  column was dropped — see [`./prompt-audit.md`](./prompt-audit.md).
- [`model-pricing.ts`](./model-pricing.md) — `costForTurn`, `hasPricing` (phase 7 cost
  bucketing). **No `model-registry` import** — Admin prices only from the hardcoded
  `MODEL_PRICING` map (contrast with Fab, which unions registry rates on top).
- `errors/faborch-errors.ts` — `FabOrchError`, `isFabOrchError` (phase 8).
- [`errors/api-error-handler.ts`](./api-error-handler.md) — `handleApiError`, the outer
  catch (phase 9).
- `errors/error-audit.ts` (dynamic import) — `recordError` (phase 8).
- [`session-audit.ts`](./session-audit.md) — `bumpActivityIfActive` (end-of-stream bump).
- `logger.ts`; the `ai` SDK (`streamText`, `convertToModelMessages`,
  `createUIMessageStream`) and `@ai-sdk/anthropic` (`anthropic` provider).
- External services: PostgreSQL (auth + audit tables) and the Anthropic API (streaming).
  **No S3, no Anthropic Files API, no MCP servers, no CMF/MES** — none are on this path.

**Consumed by** (verified by grep at the pinned commit): one frontend caller —
`admin_athena/app/admin/chat/page.tsx` (the AI admin console page), via the AI SDK
`useChat` hook + `DefaultChatTransport({ api: '/api/admin/chat' })` with a `Bearer` token
header. There is no `GET` export and no other caller.

## Function-by-function

The file has two exports: `maxDuration = 120` (runtime cap, **2 min** — half the Fab
route's 300 s) and `POST` (the engine). There are no module-level helpers; unlike Fab there
is no `cleanToolMessages` / `isServerTool` pass. `POST` is one function, documented by
**phase** to mirror the Fab page.

### `POST(req)` — phase by phase

**1. Auth (`requireAdmin`, not `requireAuth`).** The very first statement:

```ts
const auth = await requireAdmin(req);
if (auth instanceof NextResponse) return auth;
```

`requireAdmin` ([auth-middleware.md](./auth-middleware.md)) calls `validateSession`, then
enforces `auth.user.isAdmin` (403 "Admin access required") and `status === 'ACTIVE'` (403
"Account suspended"), and finally re-fetches the user **with role** from the DB. A 401
timeout is rendered through `handleApiError`; the 403s and 404 are plain JSON. Any of these
short-circuit before the `try`. The `Bearer` token is captured into `bearerToken` so the
end-of-stream `bumpActivityIfActive` can run after a long response — same pattern as Fab.
**This is the load-bearing difference from Fab's `requireAuth`: this single check is what
separates an admin from the ~30 destructive tools.**

**2. Body read + history flattening.** `body.messages`, `body.model` (default
**`claude-sonnet-4-6`** — note: a different, lower default than Fab's `claude-opus-4-8`).
Then a bespoke history transform replaces Fab's `cleanToolMessages`: every prior UI message
is reduced to **text parts only** — all `tool-call` / `tool-result` parts are dropped;
assistant turns left with no text become a `'[Used admin tools to process the request]'`
marker; user turns with no text become `'...'`. The stated intent is to "completely avoid
the tool_use/tool_result pairing issue with Anthropic's API" by never replaying tool parts
at all (Fab instead surgically balances the pairs). The flattened list is fed through
`convertToModelMessages`.

**3. Prompt-audit open (REQ-04).** The last message, if `role === 'user'`, has its text
parts joined (falling back to `.content`). If non-empty, `recordPromptStart({ …, app:
'faborch-admin', model: modelId })` inserts a PENDING row. **A text-less turn skips prompt
auditing entirely** — same gap as Fab. `app: 'faborch-admin'` is the value the
prompt-audit module carries as app-attribution ([./prompt-audit.md](./prompt-audit.md));
Fab passes `'faborch'`.

**4. Tool assembly.** `const tools = getAdminTools(auth.user.id)` (built at phase 2, above
the audit block). `getAdminTools` takes the admin's user id **only for audit attribution**
of the actions the tools perform — it does **not** re-verify admin status
([./admin-tools.md](./admin-tools.md)). There is no conditional tool selection: unlike Fab
(code_execution always on, web/fetch/MCP conditional), the admin belt is the same ~30 tools
every turn. No `code_execution`, `web_search`, `web_fetch`, or MCP tools exist here.

**5. System prompt.** `ADMIN_SYSTEM_PROMPT` (static) plus a runtime-injected
`## Current date and time` block (ISO UTC now, today's date, and the exact
`dateFrom`/`dateTo` bounds to use for "today" queries). This is the only dynamic part of
the prompt — there is no `buildSystemPromptWithTools`, no presigned-URL injection, no tool
catalog folded in (the AI SDK sends the tool schemas separately).

**6. `streamText` config.** Inside `createUIMessageStream({ execute })`:
`model: anthropic(modelId)` (the raw model id — **no allow-list validation**, contrast Fab
phase 3), `system: systemPrompt`, `messages: modelMessages`, `tools`,
`maxOutputTokens: 16384` (uses the **correct** AI-SDK v6 key, whereas Fab uses the possibly
obsolete `maxTokens`), `stopWhen: stepCountIs(10)` (Fab uses 20), and
`providerOptions.anthropic`:
- `disableParallelToolUse: true` — admin tools run one at a time (safer for destructive ops).
- `contextManagement.edits: [ clear_tool_uses_20250919 … ]` — **Anthropic server-side**
  context management (clear old tool-use blocks after 15 uses, keep last 3). This is the
  admin analog of Fab's local `fitMessagesToContextWindow`, but pushed to the API rather
  than computed in-process. There is **no local context-window trimming** in this route.
- **No thinking / reasoning config** is sent (no `getThinkingConfig`, no `effort`/budget);
  `toUIMessageStream({ sendReasoning: true })` only forwards reasoning if the model emits it.

**7. Stream + prompt-audit success (the `onFinish` analog).** `writer.merge(result.toUIMessageStream(...))`
streams to the client. Then, if a prompt-audit row was opened, a fire-and-forget async IIFE
awaits `result.text` and `result.steps` and finalizes the row. The token/cost bucketing is
**the same shape as Fab's `onFinish`**: step 0 input → `request_*`, later steps' input →
`retrieval_*`, all output → `response_*`; each step priced with its own reported model id;
tool calls paired to results by `toolCallId` into `tool_calls`; v6 `inputTokens` field names
with v5 fallbacks. The `hasPricing`/`unknownModelLogged` guard logs **once per request** if a
step's model is absent from `MODEL_PRICING` (`logger.fabOrchError("No pricing for model …")`)
— this is the Admin call-site guard that the model-pricing deep-dive confirmed exists
([./model-pricing.md](./model-pricing.md)). Cost math uses `costForTurn` against the
hardcoded map only (no registry rates). Then `recordPromptSuccess(...)` and, if
`bearerToken`, `bumpActivityIfActive` (REQ-02). **Notably absent: any `usageRecord.create`.**
Fab writes a `usage_records` row per turn; this route writes **only** the prompt-audit row —
admin turns do not land in `usage_records`.

**8. `onError` (stream-time).** Same classification skeleton as Fab, minus the invalid-key/
billing branch: an already-`FabOrchError` passes through; otherwise `timeout`/`aborted` →
`responseTimeout`, `rate_limit`/`overloaded` → `lambdaMcpCrash`, everything else →
`lambdaMcpCrash`. Then fire-and-forget: structured log, `recordError` into `error_audit_logs`
(dynamic import, [error-audit.md](./error-audit.md)), and `recordPromptFailure` closing the
PENDING row with the error envelope (REQ-03/REQ-04). Returns `"<userMessage> (errorId=…)"`
as client-visible text — the HTTP response is already 200 at this point.

**9. Response / outer catch.** `createUIMessageStreamResponse` with `X-Accel-Buffering: no`
+ `Cache-Control: no-cache, no-transform`. Any pre-stream throw inside the `try` (JSON parse,
`recordPromptStart`, `convertToModelMessages`, tool assembly) falls to
`handleApiError(error, req, { route: '/api/admin/chat' })`
([api-error-handler.md](./api-error-handler.md)) for the canonical envelope.

## Failure modes & gotchas

- **The entire admin API surface is gated ONLY here.** The tools in `admin-tools.ts` do not
  re-check `isAdmin` — they trust that `POST /admin/chat` already ran `requireAdmin`
  ([hotspot §2](../03-review-hotspots.md#2-security--authorization)). Verified statically:
  `requireAdmin` *is* called as the first line and enforces `isAdmin` + `status==='ACTIVE'`.
  The residual risk is architectural: if any *other* route ever imported `getAdminTools`
  (or an admin service) without `requireAdmin`, those tools would run unprotected. At this
  commit no such second caller was found, but the tools carry no defense-in-depth of their own.
- **No model validation.** `body.model` flows straight into `anthropic(modelId)` with no
  allow-list, no registry check, no RBAC. A mistyped or unlisted model id is accepted; if it
  is also absent from `MODEL_PRICING`, `hasPricing` is false and `costForTurn` returns **$0**
  (logged once, then billed as zero) — admin cost attribution silently under-counts. The
  default `claude-sonnet-4-6` *is* in the map, so the default path prices correctly.
- **Pricing-map divergence affects admin cost.** Admin's `MODEL_PRICING` is a separate copy
  from Fab's and the two **conflict on three Opus ids**
  ([hotspot §3](../03-review-hotspots.md#3-money--cost-accuracy),
  [./model-pricing.md](./model-pricing.md)). Because this route prices from that map with no
  registry override, any divergent rate is applied verbatim to admin prompt-audit costs.
- **No `usage_records` write.** Admin turns are recorded in `prompt_audit_logs` but not in
  `usage_records`. Any dashboard that sums `usage_records` for spend will not see admin usage.
- **PENDING prompt-audit rows can leak.** `promptAuditHandle` is declared inside the `try`;
  the outer `catch` (→ `handleApiError`) cannot finalize it. A throw between
  `recordPromptStart` and the stream opening (e.g. `convertToModelMessages`) leaves the row
  PENDING. The `maxDuration = 120` hard cut can do the same mid-stream. Same class of bug as Fab.
- **Text-less turns are invisible to prompt audit** — no `recordPromptStart`, so no
  success/failure finalization (and here, no `usage_records` fallback at all).
- **History flattening loses tool context across turns.** Dropping all prior tool-call/
  tool-result parts means the model cannot see what a previous turn's tool actually returned;
  it must re-call tools. Assistant turns collapse to a `'[Used admin tools…]'` marker. This is
  intentional (avoids Anthropic pairing errors) but can degrade multi-turn admin workflows.
- **No local context-window fit.** Long histories rely entirely on Anthropic's server-side
  `clear_tool_uses_20250919` edit and the 10-step cap; there is no `chars/4` budgeting or
  message-group dropping. A very large history could still exceed the model context.
- **`onError` mislabeling.** Anthropic rate-limit / overload conditions are recorded as
  `lambdaMcpCrash` (there is no Lambda/MCP on this route at all) — error-audit dashboards will
  attribute Anthropic-side incidents to "Lambda MCP." Inherited from the Fab pattern.
- **Best-effort by design.** Prompt-audit, error-audit, and activity-bump are all fire-and-
  forget with swallowed `.catch()`; a persistent audit-DB outage degrades silently.

## Open questions for the code owner

1. Is `requireAdmin` on this route the sole gate for the admin tools, with no other route able to run them? (hotspot §2)
2. Should an unknown/mistyped `model` be rejected (there is no allow-list) instead of silently priced at $0?
3. Should admin turns write `usage_records` (as Fab does), or is `prompt_audit_logs` the single source for admin spend?
4. Is the Admin-vs-Fab `MODEL_PRICING` divergence (three conflicting Opus ids) intended for admin costs? (hotspot §3)
5. Should the outer `catch` finalize the PENDING prompt-audit row (hoist `promptAuditHandle`), and is a sweeper needed for `maxDuration` cuts?
6. Are text-less admin turns intentionally excluded from prompt audit (REQ-04)?
7. Is discarding all prior tool results from history acceptable, or should balanced tool pairs be preserved as Fab attempts?
8. Is `lambdaMcpCrash` the right classification for Anthropic rate-limit/overload errors on a route with no Lambda or MCP?
9. Is default model `claude-sonnet-4-6` the intended admin default (vs Fab's Opus default)?

## Both-apps note

This endpoint exists **only in Admin**; the Fab analog is
[`app/api/chat/route.ts`](./chat-route.md) (~1,190 lines vs ~264 here), and the two are
**distinct implementations, not copies**. Same *patterns* — AI-SDK streaming via
`createUIMessageStream`, the request/retrieval/response prompt-audit bucketing, the
`onError` → `FabOrchError` mapping, and the end-of-stream activity bump — but the Admin route
strips almost everything else away: `requireAdmin` instead of `requireAuth`; the ~30
`admin-tools.ts` tools instead of code-execution/web/MCP; no per-user model gate, quotas, S3
attachments, Anthropic Files API, container skills, presigned-URL prompt injection, or local
context-window trimming (it delegates context pruning to Anthropic's server-side
`contextManagement`); pricing from the hardcoded `MODEL_PRICING` map only (no
`model-registry`); prompt-audit tagged `app: 'faborch-admin'` vs `'faborch'`; and no
`usage_records` write. Treat findings on the Fab page as **not** automatically applying here,
and vice versa.
