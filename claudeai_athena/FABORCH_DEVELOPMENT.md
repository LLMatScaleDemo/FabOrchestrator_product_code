# FabOrchestrator.ai — Development Reference

Comprehensive developer documentation for the FabOrch chat application
(internally `Claude_ai_athena`, publicly LLMatscale.ai / FabOrchestrator.ai).
All file paths are relative to `two_applications/Claude_ai_athena/`.

---

## 1. Overview

FabOrch is a streaming AI chat application for manufacturing operations. Users
log in, pick a Claude model, chat in natural language, and the model uses MCP
(Model Context Protocol) servers to retrieve manufacturing data from Entegris'
backend (Material Genealogy, OEE, Scrap, Bottleneck, Cycle Time, Operator
Performance, Facility KPIs). The app also enforces a four-part audit/error
spec — session audit, error audit, prompt audit, and a 10-type error catalog.

| Item | Value |
|---|---|
| Internal repo dir | `two_applications/Claude_ai_athena/` |
| Public URL | http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com |
| Framework | Next.js **16.1.4** (App Router, Turbopack dev) |
| React | **19.2.3** |
| Language | TypeScript 5 |
| Runtime | Node.js 20 |
| Database | PostgreSQL (Prisma 7.3.0, shared `claude_ai_athena` DB on `athena-poc-db`) |
| AI provider | Anthropic API (Claude 4.x family) |
| Streaming SDK | Vercel AI SDK **v6.0.97** (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`) |
| Styling | Tailwind CSS v4 + Radix UI primitives |
| Sister app | `admin_athena` (separate repo dir, same DB) |

The admin app (`admin_athena`) manages users, roles, MCPs, audit logs, and
metrics for both apps. FabOrch is the end-user chat app.

---

## 2. Tech Stack & Major Dependencies

| Package | Version | Role |
|---|---|---|
| `next` | 16.1.4 | App Router, RSC, streaming SSE |
| `react` / `react-dom` | 19.2.3 | UI |
| `ai` | 6.0.97 | `streamText`, multi-step tool flow, `createUIMessageStream` |
| `@ai-sdk/anthropic` | 3.0.46 | Anthropic provider for AI SDK |
| `@ai-sdk/react` | 3.0.64 | `useChat` hook, transport |
| `@anthropic-ai/sdk` | 0.78.0 | Direct Anthropic SDK (Files API, containers) |
| `prisma` / `@prisma/client` | 7.3.0 | ORM + raw SQL fallback |
| `@prisma/adapter-pg` | 7.3.0 | Direct `pg` adapter (Node 20 ESM issue forced raw SQL) |
| `pg` | 8.17.2 | PostgreSQL driver |
| `zod` | 4.3.6 | Input validation |
| `motion` | 12.29.2 | UI animations (Framer Motion) |
| `lucide-react` | 0.473.0 | Icon set |
| `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` | latest | Markdown rendering |
| `react-syntax-highlighter` | 15.6.1 | Code blocks |
| `@codesandbox/sandpack-react` | 2.20.0 | Live React preview for artifacts |
| `mermaid` | 11.12.3 | Diagrams |
| `mammoth` / `xlsx` / `jszip` | – | DOCX/XLSX/PPTX viewers |
| `nodemailer` | 8.0.4 | SMTP for password reset / invitation emails |
| `tailwindcss` v4 + `@tailwindcss/typography` | – | Styling |

Dev tooling: `eslint` v9 + `eslint-config-next`, `typescript` 5, `tsx`, `dotenv`.

---

## 3. Repository Layout

```
two_applications/Claude_ai_athena/
├── app/                           # Next.js App Router
│   ├── api/                       # Backend route handlers (see §6)
│   │   ├── auth/                  # register, login, logout, me,
│   │   │                           change-password, password-reset
│   │   ├── chat/                  # Main streaming chat endpoint
│   │   ├── conversations/         # CRUD + messages, title
│   │   ├── files/[fileId]/        # Anthropic Files API proxy
│   │   ├── memory/                # User memory CRUD
│   │   ├── mcp/connections/       # MCP CRUD + discover + test
│   │   ├── messages/feedback/     # Message thumbs-up/down
│   │   └── user/                  # settings, anthropic key
│   ├── chat/page.tsx              # Chat application page (protected)
│   ├── layout.tsx                 # Root layout + theme
│   ├── globals.css                # Theme vars + Tailwind base
│   └── page.tsx                   # Login (entry point)
├── components/                    # React components
│   ├── full-chat-app.tsx          # Main chat UI (~86 KB)
│   ├── login-page.tsx             # Auth UI
│   ├── settings-modal.tsx         # Settings modal (~43 KB)
│   ├── faborch-error-toast.tsx    # REQ-01 user-facing error toast
│   ├── session-expired-modal.tsx  # REQ-02 idle timeout modal
│   ├── session-warning-banner.tsx # REQ-02 "you're about to be logged out"
│   ├── providers.tsx              # React context providers
│   ├── error-boundary.tsx         # React 19 error boundary
│   ├── mcp/                       # MCP add dialog + connection card
│   ├── prompt-kit/                # Custom chat UI (Markdown, Reasoning,
│   │                              # ToolTimeline, ChatContainer, etc.)
│   ├── viewers/                   # PDF / DOCX / XLSX / PPTX / Mermaid
│   └── ui/                        # Radix-wrapped primitives
├── hooks/                         # Custom React hooks
├── lib/                           # Server-side logic + shared utils
│   ├── anthropic.ts               # Anthropic provider + client
│   ├── anthropic-files.ts         # Files API helpers
│   ├── api-utils.ts               # HTTP retry, fetch-with-timeout
│   ├── auth-middleware.ts         # requireAuth, validateSession
│   ├── context-window.ts          # fitMessagesToContextWindow
│   ├── db.ts                      # Prisma client singleton
│   ├── encryption.ts              # scrypt + AES-256-GCM
│   ├── errors/                    # REQ-01 + REQ-03 module (see §7)
│   │   ├── faborch-errors.ts      # FabOrchError class + catalog access
│   │   ├── error-catalog-defaults.ts # 10 error-type enum + default catalog
│   │   ├── error-catalog-loader.ts   # DB-backed runtime catalog (5-min cache)
│   │   ├── error-audit.ts         # REQ-03 — error_audit_logs writes
│   │   ├── api-error-handler.ts   # handleApiError (centralised)
│   │   ├── client.ts              # Browser-side error handling
│   │   ├── sql-guard.ts           # DDL/DML guard
│   │   ├── row-cap.ts             # ROW_CAP enforcement
│   │   ├── parameter-values.ts    # Valid-parameter list for INVALID_PARAMETER
│   │   └── index.ts               # Barrel
│   ├── logger.ts                  # CloudWatch-compatible structured logging
│   ├── mcp-client.ts              # MCP tool execution (JSON-RPC over HTTP)
│   ├── model-pricing.ts           # Per-model USD price map (§8)
│   ├── prompt-audit.ts            # REQ-04 — prompt_audit_logs (§8)
│   ├── session-audit.ts           # REQ-02 — user_session_logs
│   ├── storage.ts                 # Prisma CRUD helpers
│   ├── system-prompts.ts          # System prompt builder + topic guides
│   ├── validation.ts              # Zod schemas
│   └── …
├── prisma/
│   ├── schema.prisma              # Source of truth (§5)
│   └── migrations/                # Prisma migrations
├── public/                        # Static assets
├── __tests__/errors/              # Node test runner suite for REQ-01
├── .ebextensions/                 # EB ALB + Node memory config
├── .platform/nginx/               # Nginx proxy overrides
├── Dockerfile                     # Multi-stage build
├── buildspec.yml                  # CodeBuild spec (alternate path)
├── next.config.ts                 # output: "standalone"
├── CLAUDE.md                      # Higher-level summary (also in repo)
├── DEPLOYMENT.md                  # AWS deployment runbook (also in repo)
└── package.json
```

---

## 4. Application Entry Points

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Login / register page (entry point) |
| `/chat` | `app/chat/page.tsx` | Main chat UI (protected by session token) |
| `/settings` | `app/settings/page.tsx` | Redirects to `/chat` (settings moved into modal) |

Auth flow: user logs in → backend issues a 30-day session token → frontend
stores it under `llmatscale_auth_token` in `localStorage` → every API call
sends `Authorization: Bearer <token>`. The chat page checks for the token on
mount and redirects to `/` if missing.

---

## 5. Database Schema

The schema is **shared with `admin_athena`** — both apps read/write the same
PostgreSQL database (`claude_ai_athena`). FabOrch owns chat-facing models;
admin_athena owns RBAC, MCP registry, audit catalog management. FabOrch's
own `schema.prisma` is the source of truth for the chat-side models; the
audit-table DDL is shared and shown below.

### Core chat models

| Model | Key fields | Notes |
|---|---|---|
| `User` | `id (uuid)`, `email (unique)`, `passwordHash`, `name`, `anthropicApiKeyEncrypted`, `preferences (json)`, `roleId`, `isAdmin`, `status`, `forcePasswordChange`, `passwordChangedAt`, `emailVerified`, `lastLogin` | scrypt-hashed password (`salt:derivedKey`). API key encrypted AES-256-GCM. |
| `Session` | `id`, `userId`, `token (unique)`, `expiresAt`, `userAgent`, `ipAddress`, `lastUsedAt` | 30-day TTL. `token` is 32+ random bytes hex. |
| `Conversation` | `id`, `userId`, `title`, `model`, `activeMcpIds (json[])`, `isPinned`, `isShared`, `lastMessageAt`, `deletedAt` | Soft-delete via `deletedAt`. Composite indexes on `(userId, updatedAt DESC)` and `(userId, deletedAt)`. |
| `Message` | `id`, `conversationId`, `role`, `content`, `parts (json)`, `metadata (json)`, `createdAt`, `editedAt` | `parts` stores the structured streaming parts (text, tool-*, reasoning, step-start, data-fileDownload). |
| `Artifact` | `id`, `conversationId`, `messageId`, `userId`, `type (html\|code)`, `title`, `content` | Auto-extracted from `<artifact>` blocks via `lib/artifact-parser.ts`. |
| `McpConnection` | `id`, `userId?`, `roleId?`, `name`, `serverUrl`, `authType`, `authCredentialsEncrypted`, `availableTools (json)`, `isActive`, `status`, `lastError`, `sessionId`, `lastConnectedAt` | User- or role-scoped (admin assigns role-level via admin_athena). |
| `MemoryFile` | `id`, `userId`, `path`, `content`, `scope (user\|global)` | Persistent user memory across conversations. Unique on `(userId, path)` and `(scope, path)`. |
| `PasswordResetToken` | `id`, `email`, `token (unique)`, `expiresAt`, `usedAt` | One-shot, 1-hour TTL. |

### RBAC models (admin-managed, FabOrch reads)

| Model | Purpose |
|---|---|
| `Role` | `name`, `permissions[]`, `allowedModels[]`, `systemInstructions`, `customInstructionsEnabled`, `personalMcpEnabled`, `dailyRequestLimit`, `dailyTokenLimit`, `promptSuggestions[]`, `isSystemRole` |
| `Invitation` | `email`, `roleId`, `token`, `status`, `expiresAt`, `acceptedAt` |
| `AuditLog` | `action`, `targetType`, `targetId`, `metadata (json)`, `ipAddress` — generic admin audit trail |

### FabOrch audit models (REQ-02 / REQ-03 / REQ-04)

| Table | Purpose |
|---|---|
| `user_session_logs` (model `UserSessionLog`) | REQ-02. One row per Session lifecycle. Transitions ACTIVE → CLOSED_LOGOUT / CLOSED_IDLE / CLOSED_ADMIN / CLOSED_EXPIRED. Carries `lastActivityAt`, `idleSeconds`, `closedReason`. Status enum `session_status`. |
| `error_audit_logs` | REQ-03. Permanent log of every FabOrchError instance. Carries `error_id (ERR-YYYYMMDD-NNNN)`, `error_type`, `user_id`, `user_name`, `user_email`, `datetime`, `user_message`, `technical_message`, `priority (HIGH/MEDIUM)`, `status (OPEN/RESOLVED)`, `resolved_by`, `resolved_at`, `route`, `http_status`. |
| `prompt_audit_logs` | REQ-04. One row per user prompt. Carries `prompt_id (PRO-YYYYMMDD-NNNN)`, `user_id` (FK to users.id), `user_name`, `user_email`, `datetime`, `user_prompt`, `topic_matched`, `query_executed`, `data_retrieved`, `llm_response`, `response_time_ms`, `status` (PENDING/SUCCESS/FAILED/TIMEOUT/CANCELLED), `tool_calls (jsonb)`, **`request_tokens`, `retrieval_tokens`, `response_tokens`, `request_cost`, `retrieval_cost`, `response_cost`**. |
| `prompt_audit_daily_counter` | Atomic per-day sequence counter (`counter_date PK, last_seq`) used by `nextPromptId()`. |
| `error_audit_daily_counter` | Same pattern, for `error_id`. |
| `error_catalog` | Live, editable runtime catalog of the 10 REQ-01 error types (admin can edit the user-facing message). Fallback defaults frozen in `lib/errors/error-catalog-defaults.ts`. |
| `usage_records` | Per-LLM-call token totals (model, inputTokens, outputTokens, thinkingTokens, cacheCreationTokens, cacheReadTokens, conversationId, requestDurationMs). Indexed on `(userId, createdAt)` for role-level daily-limit checks. |

All audit tables are append-only from FabOrch's perspective. Admin app can
edit error_catalog rows and mark error_audit_logs rows as resolved.

---

## 6. API Routes

All routes live under `app/api/*/route.ts` and require Bearer auth except
the explicitly public ones (`register`, `login`, `password-reset`). Auth is
enforced via `lib/auth-middleware.ts::requireAuth(request)` which returns
either `{ user }` or a 401 `Response` object.

### Auth (`app/api/auth/`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/register` | Create account. Returns session token. Public. |
| POST | `/login` | Email + password → session token. Public. |
| POST | `/logout` | Invalidate session. Triggers REQ-02 `CLOSED_LOGOUT`. |
| GET | `/me` | Current user info. **Does not** bump activity (was previously, removed to fix idle-timeout bug). |
| POST | `/change-password` | Authenticated password change. |
| POST | `/password-reset` | Request email. Always returns success. |
| POST | `/password-reset/confirm` | Confirm with token. |

### Chat (`app/api/chat/route.ts`)
The headline endpoint. `maxDuration = 300` (5 min). Flow:
1. `requireAuth(req)` → user.
2. Validate body with `validation.ts::ChatRequestSchema`.
3. Resolve role-level + user-level MCP tools via `mcp-client.ts`.
4. Apply `context-window.ts::fitMessagesToContextWindow(messages, systemPrompt)`.
5. `recordPromptStart({ userId, userName, userEmail, userPrompt, app: 'faborch' })` → INSERT PENDING row with auto-generated `PRO-YYYYMMDD-NNNN`.
6. `streamText({ model: anthropic(modelId), system, messages, tools, stopWhen: stepCountIs(20), providerOptions: { anthropic: { thinking, container: { skills: [...] } } } })`.
7. `onStepFinish` logs tool calls + results.
8. `createUIMessageStream` with `merge(result.toUIMessageStream({ sendReasoning: true }))`.
9. `onFinish`:
   - Persist assistant `Message` (`role, content, parts, metadata`).
   - Insert `UsageRecord`.
   - **REQ-04 finalize**: walk `result.steps`, bucket usage into request / retrieval / response (turn-1 input → `request_*`, turns 2..N input → `retrieval_*`, all output → `response_*`), price each step via `model-pricing.ts::costForTurn`, call `recordPromptSuccess(...)`.
   - REQ-02 bump activity.
10. `onError`: classify error via REQ-01 catalog, log structured error, write to `error_audit_logs`, close prompt audit with `recordPromptFailure`.

### Conversations
| Method | Path | Purpose |
|---|---|---|
| GET | `/conversations` | List (pinned first, by updatedAt DESC). |
| POST | `/conversations` | Create. |
| GET | `/conversations/[id]` | One conversation + all messages. |
| PATCH | `/conversations/[id]` | Update title, pinned, shared, model. |
| DELETE | `/conversations/[id]` | Soft-delete (`deletedAt = NOW()`). |
| PATCH | `/conversations/[id]/title` | Rename. |
| GET / POST / DELETE | `/conversations/[id]/messages` | List / add / clear. |

### MCP (`app/api/mcp/connections/`)
| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/connections` | List / create user-scoped MCP connection. |
| GET / PATCH / DELETE | `/connections/[id]` | Read / update / remove. |
| POST | `/connections/[id]/discover` | JSON-RPC `tools/list` against the server, persist `availableTools`. |
| POST | `/connections/[id]/test` | Lightweight health check. |

### User Settings
| Method | Path | Purpose |
|---|---|---|
| GET / PATCH | `/user/settings` | Preferences (theme, font size, density, code theme). |
| GET / POST | `/user/anthropic` | Per-user Anthropic API key (encrypted). |
| POST | `/user/anthropic/test` | Validate key with Anthropic. |
| GET | `/user/models` | Allowed model list (intersection of installed + role allowedModels). |

### Files / Artifacts / Memory / Feedback
| Path | Purpose |
|---|---|
| `/files/[fileId]` | GET metadata from Anthropic Files API. |
| `/files/[fileId]/download` | Streams the file bytes back to the browser. |
| `/artifacts` + `/artifacts/[id]` | CRUD. |
| `/memory` | User's persistent memory CRUD. |
| `/messages/feedback` | Thumbs up/down + comment per message. |

Centralised error handling: every catch block goes through
`lib/errors/api-error-handler.ts::handleApiError(error, req, ctx)` which
maps to a `FabOrchError`, logs structured JSON, writes the
`error_audit_logs` row, and returns the canonical JSON error envelope.

---

## 7. REQ-01 — Error Handling

### The 10 canonical error types

Defined in `lib/errors/error-catalog-defaults.ts` (the frozen fallback) and
live-edited via the admin app's `error_catalog` table. Loader caches DB
reads for 5 minutes.

| Type | Priority | HTTP | Default user message |
|---|---|---|---|
| `SQL_CALL_FAILURE` | HIGH | 503 | "I cannot reach the data right now. Please retry." |
| `RESPONSE_TIMEOUT` | HIGH | 504 | "The request took too long…" |
| `NO_ROWS_RETURNED` | HIGH | 404 | "No data found for that request." |
| `MISSING_FILTER` | HIGH | 400 | "I need one more detail before I can answer that…" |
| `INVALID_PARAMETER` | HIGH | 400 | "That value is not valid. Please choose one of the available options." |
| `DDL_DML_REJECTED` | HIGH | 400 | "I can't run that kind of statement…" |
| `LAMBDA_MCP_CRASH` | HIGH | 503 | "The data service had an issue. Please try again." |
| `SESSION_TIMEOUT` | HIGH | 401 | "Your session has expired. Please sign in again." |
| `ROW_CAP_EXCEEDED` | MEDIUM | 200 | "Showing the first 100 rows…" (returns partial) |
| `UNLISTED_STORED_PROC` | HIGH | 400 | "That report isn't available yet." |

### Detection sites

- **DDL/DML guard** (`lib/errors/sql-guard.ts`) — rejects any user prompt that
  asks the model to insert/update/delete data.
- **Row-cap** (`lib/errors/row-cap.ts`) — caps MCP responses at
  `ROW_CAP_LIMIT` (configurable, default 100).
- **Parameter validator** (`lib/errors/parameter-values.ts`) — checks tool
  arguments against the MCP's published valid-value list.
- **Stream `onError` hook** in `app/api/chat/route.ts` — classifies SDK
  errors (timeout/rate-limit/auth) into the catalog.
- **API handler** (`lib/errors/api-error-handler.ts`) — last-resort wrapper
  used by every non-chat route.

### `FabOrchError` class

Centralised in `lib/errors/faborch-errors.ts`. Carries:
- `errorId` (random UUID per instance)
- `type` (enum)
- `priority`
- `userMessage` (from live catalog)
- `httpStatus`
- `context` (route, method, userId, sessionId, toolName, validOptions, extra)

Static constructors: `FabOrchError.missingFilter(...)`,
`FabOrchError.invalidParameter(...)`, `FabOrchError.sqlCallFailure(...)`, etc.

### Test suite

`__tests__/errors/faborch-errors.test.ts` — Node test-runner, run via
`npm run test:errors`.

---

## 8. REQ-02 / REQ-03 / REQ-04 — Audit

### REQ-02 — Session audit (`lib/session-audit.ts` + `user_session_logs`)

- Login → INSERT a row with `loginTime = NOW()`, `lastActivityAt = NOW()`, `sessionStatus = ACTIVE`, `loginIp`, `loginUserAgent`.
- Every authenticated request → `bumpActivityIfActive(token)` updates `lastActivityAt`. The chat endpoint **only bumps after streaming completes** so a 2-min stream doesn't count as 2 min of idle.
- 30-min idle → background sweep flips ACTIVE → CLOSED_IDLE.
- Logout / admin force-logout / token expiry → CLOSED_LOGOUT / CLOSED_ADMIN / CLOSED_EXPIRED.
- Frontend: `session-warning-banner.tsx` shows at 28 min idle; `session-expired-modal.tsx` at 30 min. Gated on `!isOnLoginPage`.
- Lazy-create: if a request arrives with a valid Session but no ACTIVE audit row (PSI Quantum stale-session case), `checkAndRecordActivity` and `recordActivityWithoutEviction` auto-create the row.

### REQ-03 — Error audit (`lib/errors/error-audit.ts` + `error_audit_logs`)

- Every `FabOrchError` thrown → `recordError(err, { userId, route, method })` → INSERT row with `ERR-YYYYMMDD-NNNN`.
- 9 doc-spec fields: `errorId`, `errorType`, `userName`, `userEmail`, `datetime`, `userMessage`, `priority`, `status (OPEN)`, `resolvedBy/resolvedAt (null)`.
- Plus context: `technicalMessage`, `route`, `httpStatus`.
- Admin app can mark errors resolved → flips status to RESOLVED.

### REQ-04 — Prompt audit (`lib/prompt-audit.ts` + `prompt_audit_logs`)

Two-phase write per prompt:

1. **Start** — `recordPromptStart({ userId, userName, userEmail, userPrompt, app })`
   - Calls `nextPromptId()` — atomic upsert against `prompt_audit_daily_counter` returns the next `PRO-YYYYMMDD-NNNN`.
   - INSERT row with `status = 'PENDING'`, `user_id`, etc.
2. **Finalize** — `recordPromptSuccess(...)` or `recordPromptFailure(...)`
   - UPDATE row with `llm_response`, `topic_matched`, `query_executed`, `data_retrieved`, `response_time_ms`, `tool_calls (jsonb)`, and the 6 token/cost columns.

#### Topic classifier

`classifyTopic(prompt, toolCalls, app)` (also in `prompt-audit.ts`) maps the
user prompt + tools used to one of 8 labels:

- `Material Genealogy + Hold/Disposition`
- `Equipment OEE Report`
- `Scrap Pareto Analysis`
- `Bottleneck Analysis`
- `Cycle Time Outlier Detection`
- `Operator Performance Analysis`
- `Overall Facility Performance Insights`
- `AdminData` (sentinel for admin-app prompts)

Uses both `PROMPT_TOPIC_PATTERNS` (regex against prompt text) and
`TOOL_TOPIC_PATTERNS` (regex against `tool.name`). Tools win in case of
conflict. Returns `null` if nothing matches.

#### `tool_calls` JSONB shape

Strictly three fields per entry (per MCP team spec):
```jsonc
[
  {
    "name": "mcp_search_materials",
    "input":  { "pattern": "S4442", "limit": 30 },
    "output": { "matches": [...], "_executed_sql": "SELECT ...", "match_count": 30 }
  }
]
```
`_executed_sql` is added by the MCP server itself — FabOrch just relays.

#### Token bucketing (the `request_*`, `retrieval_*`, `response_*` columns)

In `app/api/chat/route.ts::onFinish`, we walk `result.steps`:

| Step | Tokens go into |
|---|---|
| Step 0 (turn 1) input | `request_tokens` |
| Steps 1..N (turn 2+) input | `retrieval_tokens` |
| All steps' output | `response_tokens` |

Per-step cost is computed via `lib/model-pricing.ts::costForTurn(stepModelId, usage)`:

```ts
inputCost  = (inputTokens*rates.input
            + cachedInputTokens*rates.cacheRead
            + cacheCreationInputTokens*rates.cacheWrite) / 1_000_000
outputCost = (outputTokens * rates.output) / 1_000_000
```

The `MODEL_PRICING` map covers Opus 4.7/4.6/4.5/4, Sonnet 4.6/4.5/4, Haiku 4.5.
Unknown model → logged warning + $0 cost. Cache-read tokens are billed at
~10% of the input rate; cache-creation at ~125%.

---

## 9. Chat Streaming Pipeline (the heart of the app)

```
Browser
  │  POST /api/chat { messages, model, conversationId, webSearch, enableReasoning, activeMcpIds }
  ▼
app/api/chat/route.ts
  │  requireAuth → user
  │  recordPromptStart → PRO-… row, status=PENDING
  │  fitMessagesToContextWindow(...) → trim old tool results
  │  Build tools (role-level MCPs + user-level MCPs)
  │  Build providerOptions (thinking mode, container skills)
  ▼
ai.streamText({ model: anthropic(modelId), system, messages, tools, stopWhen: stepCountIs(20), onStepFinish })
  │
  ├─ Step 0: model reads sys + tools + user → emits tool_use
  │     (Anthropic returns usage = {inputTokens, outputTokens, cachedInputTokens, ...})
  │
  ├─ tool execution (mcp-client.ts JSON-RPC to MCP server)
  │
  ├─ Step 1: model reads sys+tools+user+tool_result → emits final text
  │
  └─ stream resolves
       │
       ▼
createUIMessageStream → onFinish
  │  Persist assistant Message (parts: text, tool-*, reasoning, step-start, data-fileDownload, …)
  │  Insert UsageRecord
  │  Walk result.steps, bucket usage → request/retrieval/response tokens + costs
  │  recordPromptSuccess({ rowId, llmResponse, toolCalls, requestTokens, …, responseCost })
  │  bumpActivityIfActive(bearerToken)
  ▼
createUIMessageStreamResponse with X-Accel-Buffering: no, Cache-Control: no-cache
```

Key details:
- **`stopWhen: stepCountIs(20)`** caps the multi-step tool loop at 20 turns.
- **Adaptive thinking** for 4.6 models (`type: 'adaptive'`, effort `max`/`high`).
- **Manual thinking** for 4.5 Sonnet/Haiku (`type: 'enabled'`, `budgetTokens: 16000`).
- **Container skills** for document generation (PPTX, DOCX, PDF, XLSX, plus one custom skill).
- **`prepareStep: forwardAnthropicContainerIdFromLastStep`** so the same container persists across steps.
- **Context fitting**: `lib/context-window.ts` enforces `ensureToolResultPairing` and drops old tool results when token budget is tight.

---

## 10. MCP Tools

`lib/mcp-client.ts` speaks JSON-RPC 2.0 over HTTPS. Helpers:
- `discoverMcpTools(serverUrl, auth)` — `tools/list`. Returns `[{ name, description, inputSchema }]`. Persisted on `McpConnection.availableTools`.
- `executeMcpTool({ serverUrl, toolName, arguments, authType, authCredentialsEncrypted })` — `tools/call`. 30-second timeout. Returns the server's payload (which by convention includes `_executed_sql` for our Entegris MCPs).

In the chat route, each user's available tools are computed as the union of:
- The Role-level MCPs assigned by admin (`mcp_connections` where `role_id = user.roleId`)
- The user's personal MCPs (`mcp_connections` where `user_id = user.id`, gated by `role.personalMcpEnabled` + `role.personalMcpMaxCount`)
- The user's `Conversation.activeMcpIds` (their per-conversation toggle).

The decrypted credentials are passed inline to `executeMcpTool` — they're
never logged or returned to the client.

---

## 11. Frontend Components (highlights)

| File | Purpose | Notes |
|---|---|---|
| `components/full-chat-app.tsx` | Master chat shell | Sidebar (conversations), main message view, input, model selector, settings, MCP toggles. Uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport`. |
| `components/ui/claude-style-chat-input.tsx` | The chat input | Model picker dropdown, attachment button, voice toggle, custom paste handling. Exposes `ClaudeChatInputHandle` ref with `setMessage(text)` for prefill. |
| `components/prompt-kit/markdown.tsx` | Renders LLM markdown | GFM tables, KaTeX math, code blocks with syntax highlighting, links. |
| `components/prompt-kit/reasoning.tsx` | Adaptive/manual thinking display | Collapsible "Thinking…" section. |
| `components/prompt-kit/tool-timeline.tsx` | Three-stage loader + tool history | Stage 1 "Received your prompt" (900 ms), Stage 2 "Retrieval in progress…" (min 700 ms), Stage 3 "Generating Response…". Strictly one-way, no loop. |
| `components/prompt-kit/streaming-text.tsx` | Smooth streaming via `useSmoothStreaming` | Char-by-char rendering. |
| `components/viewers/*` | Inline PDF/DOCX/XLSX/PPTX/Mermaid viewers | Used when the assistant attaches generated docs. |
| `components/sandpack-preview.tsx` | Live React sandbox for artifacts | `@codesandbox/sandpack-react`. |
| `components/settings-modal.tsx` | Settings | Theme, font size, message density, code theme, MCP CRUD, API key. |
| `components/session-warning-banner.tsx` + `session-expired-modal.tsx` | REQ-02 idle UI | Hidden on login page. State clears on `isOnLoginPage` flip. |
| `components/faborch-error-toast.tsx` | REQ-01 user-facing error | Reads `userMessage` + `errorId` from the API envelope. |
| `components/providers.tsx` | Context providers | Theme, session, font scaling. |
| `components/error-boundary.tsx` | React 19 error boundary | Wraps the app. |

---

## 12. State, Hooks, Conventions

- **Theme**: `light` / `dark` / `system` stored in `localStorage` (`llmatscale_theme`); applied via `.dark` class on `<html>`; system detection via `matchMedia`.
- **Session token**: `localStorage.llmatscale_auth_token`. User object: `localStorage.llmatscale_user`.
- **Custom hooks** (`hooks/`):
  - `use-file-content.ts` — caches downloaded files in memory + IndexedDB.
  - `use-keyboard-shortcuts.tsx` — Cmd+K, etc.
  - `use-mobile.tsx` — viewport-based mobile detection.
  - `use-smooth-streaming.ts` — char-throttling for streaming text.
- **`cn(...)` utility** in `lib/utils.ts` for className merging (tailwind-merge + clsx).
- **Zod schemas** in `lib/validation.ts` are the single source of truth for request body shapes.
- **Raw SQL fallback**: Some queries (audit reads with dynamic filters) use `prisma.$queryRawUnsafe` / `$executeRawUnsafe`. Required because of Node 20 ESM issues with some Prisma Query Engine operations; behaviour is identical, just bypasses the Engine.

---

## 13. Local Development Setup

```bash
# 1. Clone, install
git clone <repo>
cd two_applications/Claude_ai_athena
npm install

# 2. .env (do NOT commit)
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/llmatscale_ai"
KEY_ENCRYPTION_SECRET="...64 hex chars..."

# 3. Push schema (creates all tables)
npm run db:push

# 4. (optional) Prisma Studio
npm run db:studio

# 5. Dev server
npm run dev   # http://localhost:3000
```

### Available scripts

| Script | What it does |
|---|---|
| `npm run dev` | `next dev` (Turbopack) on port 3000 |
| `npm run build` | Production build (`next build`, standalone output) |
| `npm run start` | Run the built standalone server |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npm run db:generate` | Regenerate Prisma client into `lib/generated/prisma/` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:push` | `prisma db push` (skip migrations, sync schema) |
| `npm run db:studio` | Prisma Studio GUI |
| `npm run db:reset` | **DESTRUCTIVE** — `prisma migrate reset` |
| `npm run test:errors` | Run `__tests__/errors/faborch-errors.test.ts` |

### Windows path note
The repo path contains an `&` (`D:\FabOrchAudit&Error\…`) which breaks npm
shim resolution on Windows because npm splits `PATH` on `&`. Workaround:
invoke `next` directly via `node ./node_modules/next/dist/bin/next build`.
On Linux / CodeBuild this is a non-issue.

---

## 14. Common Development Tasks

### Add a new API route
```ts
// app/api/my-thing/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { validate, MySchema } from '@/lib/validation';
import { handleApiError } from '@/lib/errors/api-error-handler';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const { data, error } = validate(MySchema, await req.json());
    if (error) return NextResponse.json({ error }, { status: 400 });

    // ... business logic ...

    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return handleApiError(e, req, { route: '/api/my-thing' });
  }
}
```

### Add a new Claude model

1. Add the price row to `lib/model-pricing.ts::MODEL_PRICING`.
2. Add the model ID to `app/api/user/models/route.ts` if it should be exposed.
3. If it supports a thinking variant, add to `ADAPTIVE_THINKING_MODELS` /
   `MANUAL_THINKING_MODELS` constants at the top of
   `app/api/chat/route.ts`.

### Add a new error type
1. Append to `FabOrchErrorType` enum in `lib/errors/error-catalog-defaults.ts`.
2. Add the entry to `FABORCH_ERROR_CATALOG`.
3. Add a static constructor on `FabOrchError` if you'll throw it from
   multiple places (`FabOrchError.myNewError(cause, ctx)`).
4. Update `__tests__/errors/faborch-errors.test.ts`.
5. (Optional) Insert the same row into the `error_catalog` table so admins
   can edit the user-facing message in production.

### Add a new audit/aggregate question for the admin app
This is admin_athena territory, but FabOrch's prompt-audit columns are the
data source. The admin's `prompt_quality_summary` and `query_prompt_audit`
tools already include `request_tokens`, `retrieval_tokens`, `response_tokens`,
and the three cost columns.

### Backfill `user_id` for legacy prompt_audit_logs rows
```sql
UPDATE prompt_audit_logs p
   SET user_id = u.id
  FROM users u
 WHERE p.user_email = u.email
   AND p.user_id IS NULL;
```

---

## 15. Testing

- **Unit tests for REQ-01 errors**: `__tests__/errors/faborch-errors.test.ts`.
  Run with `npm run test:errors`. Uses Node's built-in `node --test`.
- **Type checking**: `node ./node_modules/typescript/bin/tsc --noEmit -p
  tsconfig.json`. This is the gating check for deploy — the deploy doc says
  "TypeScript errors → run npm run build locally first."
- **Manual smoke tests** for chat after a deploy:
  1. Log in.
  2. Send a prompt that uses an MCP tool — verify the three-stage loader,
     verify the response renders.
  3. Check the latest `prompt_audit_logs` row: `user_id`, `tool_calls`, and
     the 6 token/cost columns should all be populated.
  4. Stay idle 28 min — banner should appear; 30 min — modal + redirect.

---

## 16. Logging

`lib/logger.ts` exports a `logger` with structured methods:

- `logger.fabOrchError(err, ctx)` — emits JSON `{ ts, level, errorId, type, priority, route, userId, ... }` lines to stdout. EB / App Runner pick this up automatically into CloudWatch via the docker container's stdout pipeline.
- `logger.info(msg, ctx)`, `logger.warn(...)`, etc.

Format is intentionally JSON-per-line so CloudWatch Logs Insights can
filter / aggregate on `errorId`, `type`, `userId`, etc.

---

## 17. Security Notes

- **Passwords**: scrypt, `salt:keyHex` format, timing-safe compare in
  `lib/encryption.ts::verifyPassword`.
- **Anthropic / MCP credentials**: AES-256-GCM via `KEY_ENCRYPTION_SECRET`
  (64 hex chars = 32 bytes). Stored as `iv:authTag:ciphertext`.
- **Session tokens**: 32+ random bytes hex, only stored hashed for the
  audit-log foreign key (`session_token_hash`), full token only in
  `sessions.token`.
- **All routes** require Bearer auth except `register`, `login`,
  `password-reset`, `password-reset/confirm`, `auth/me`'s GET (which
  itself requires Bearer — listed here for clarity only).
- **CORS**: not currently configured — the API is same-origin with the
  static app.
- **Rate limiting**: not implemented at app level; Anthropic and the MCP
  servers enforce their own.
- **Cascade deletes** on `userId` for `conversations`, `mcp_connections`,
  `memory_files`, `usage_records`, `sessions`, `user_session_logs`.
  `ON DELETE SET NULL` on `prompt_audit_logs.user_id` so audit history
  survives a user deletion.

---

## 18. Where to look when…

| Symptom | First place to check |
|---|---|
| Login broken | `app/api/auth/login/route.ts`, `lib/encryption.ts::verifyPassword`, scrypt hash format |
| Idle timeout not firing | `lib/session-audit.ts`, `components/session-warning-banner.tsx`, the 28/30-min thresholds, `/api/auth/me` no longer bumps activity |
| Stream times out | Anthropic / network / ALB idle timeout (600 s). Check `maxDuration` on the chat route (300 s) |
| Tool result empty | MCP server unreachable, auth failed, or invalid arguments. Check `executeMcpTool` exception handling in `lib/mcp-client.ts` |
| Prompt audit row stuck PENDING | `recordPromptSuccess` / `recordPromptFailure` not reached — stream-time error pre-onFinish. Check the route's `onError` |
| `request_cost = 0` | Model ID not in `MODEL_PRICING` map (CloudWatch warning will mention which model) |
| Tool call missing `_executed_sql` | MCP server team hasn't deployed the SQL-emit change for that use case |
| Audit row missing `user_id` | Row pre-dates the 2026-05-12 migration. Run the backfill SQL in §14 |

---

## 19. Sister Documents

- `CLAUDE.md` — short version of this doc, optimised for AI agent context.
- `DEPLOYMENT.md` — AWS Elastic Beanstalk deployment runbook (see also `FABORCH_INFRASTRUCTURE.md`).
- `app/api/CLAUDE.md` — backend API documentation.
- `components/CLAUDE.md` — frontend documentation.
- `.claude/agents/` — Claude Code agent definitions (backend-architect, frontend-developer, whimsy-injector).

---

*Last reviewed: 2026-05-13. Schema reflects DDL through the
token/cost migration of 2026-05-12.*
