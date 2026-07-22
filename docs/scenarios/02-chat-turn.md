# Scenario 02 — One Chat Prompt Turn (`POST /api/chat`)

> Version: commit `7976c78` on `main`. See [README](../README.md).
> **Validation: 🔵 Static** — traced from `app/api/chat/route.ts` + helpers. No runtime
> execution; items needing live confirmation are in §6. This is the **core product path**.

---

## 1. Entry point

| Field | Value |
|---|---|
| **URL** | `POST /api/chat` |
| **File** | `claudeai_athena/app/api/chat/route.ts` |
| **Function** | `export async function POST(req: NextRequest)` |
| **Trigger** | Frontend `useChat` hook streams a turn; response is SSE (`text/event-stream`) via `createUIMessageStreamResponse` |
| **Runtime** | `export const maxDuration = 300` (5 min) |

---

## 2. Control flow (request → streamed response)

```
POST /api/chat
│
├─[1] requireAuth(req)                                   [lib/auth-middleware.ts]
│      └─ validateSession: Bearer parse, token len ≥ 32
│           ├─ getSessionByToken(token)                  [lib/storage.ts]  ← DB READ (Session+user)
│           ├─ 30-day absolute expiry → recordExpired() on fail            ← DB WRITE (audit)
│           └─ checkAndRecordActivity(token,…)           [lib/session-audit.ts] ← DB WRITE (user_session_logs)
│                └─ 'evicted' → deleteSession() + 401
│      • unauthenticated → 401 (SESSION_TIMEOUT)  • SUSPENDED/DELETED → 403  • forcePasswordChange → 403
│
├─[2] validateOrThrow(ChatRequestSchema, body)          [lib/validation.ts]
│      → { messages, model, enableReasoning=true, conversationId, webSearch=false, activeMcpIds=[] }
│      • invalid → FabOrchError INVALID_PARAMETER (400)
│
├─[3] Model gating: getAllowedModelIds()                [lib/model-registry.ts] ← DB READ (model_registry, ~60s cache)
│      allowed = registryIds ∪ ALLOWED_MODELS; not allowed → 400
│
├─[4] getRegistryRates(modelId)                         [lib/model-registry.ts]  (loaded once, for onFinish pricing)
│
├─[5] RBAC: user.findUnique(include role)               ← DB READ
│      • model ∉ role.allowedModels (non-admin) → 400 (role-restricted)
│      • rolling-24h usageRecord.aggregate → ≥ dailyRequestLimit or dailyTokenLimit → 429
│
├─[6] Thinking: getThinkingConfig(modelId) ?? hardcoded (adaptive|manual|none)
│
├─[7] recordPromptStart(...)                            [lib/prompt-audit.ts]  ← DB WRITE (prompt_audit_logs PENDING) [REQ-04 open]
│
├─[8] S3 upload of this turn's attachments             [lib/s3-upload.ts]  ← S3 PutObject (best-effort)
│
├─[9] addMessage(conversationId, user msg + s3 metadata) [lib/storage.ts]  ← DB WRITE
│
├─[10] Tool assembly → tools:
│       • code_execution (ALWAYS)   • web_search + web_fetch (if webSearch)
│       • MCP tools: authorize (role-level userId=null OR personal if role.personalMcpEnabled)  ← DB READ
│              loadActiveMcpToolsWithDescriptions(authorizedIds)  [lib/mcp-client.ts]  ← NETWORK
│       • memory tool = commented out / disabled
│
├─[11] File handling: inline (jpeg/png/gif/webp/pdf/text) vs container_upload
│       unsupported (xlsx/docx/pptx/csv) → Anthropic Files API upload → container_upload id  ← NETWORK
│
├─[12] cleanToolMessages(convertToModelMessages(...))   (strips orphaned/errored tool pairs; AI-SDK #11855/#8112)
│
├─[13] presignKey(key) for all file refs               [lib/s3-upload.ts]  ← fresh presigned GET URLs
│
├─[14] buildSystemPromptWithTools(...)                  [lib/system-prompts.ts]
│
├─[15] fitMessagesToContextWindow(...)                  [lib/context-window.ts]  (trim to <200K)
│
├─[16] Prompt caching: enabled only if NO presigned URLs present (they bust the prefix cache)
│
├─[17] streamText config: maxTokens 65536, stopWhen stepCountIs(20), container.skills,
│       thinking providerOptions, prepareStep=forwardAnthropicContainerIdFromLastStep
│
├─[18] result = streamText(...)                          ← NETWORK (Anthropic, streaming)
│       result.consumeStream()  (finish backend even if client disconnects)
│
├─[19] createUIMessageStream:
│       • keepalive every 15s (data-keepalive)  • merge tokens/reasoning to client
│       • scan steps for code-exec file_id → retrieveMetadata → data-fileDownload chunks
│       • onFinish: addMessage(assistant) + usageRecord.create + recordPromptSuccess (cost buckets) + bumpActivity
│       • onError: normalize → recordError (error_audit_logs) + recordPromptFailure (prompt_audit_logs)
│
└─[20] return SSE (X-Accel-Buffering: no)   |  outer catch → handleApiError
```

## 3. Branch / status-code matrix

| Condition | Status |
|---|---|
| No/invalid Bearer, expired/evicted | 401 (SESSION_TIMEOUT) |
| SUSPENDED / DELETED | 403 |
| forcePasswordChange | 403 (`code: FORCE_PASSWORD_CHANGE`) |
| Body fails `ChatRequestSchema` | 400 |
| Unknown model | 400 |
| Model not in role.allowedModels | 400 (role-restricted) |
| ≥ dailyRequestLimit / dailyTokenLimit (24h) | 429 |
| Error before stream opens | 500 (or mapped) |
| Error during stream | 200 stream + error chunk `(errorId=…)`, audit rows written |
| Success | 200 SSE |

## 4. Security & data-flow notes

- **Auth + RBAC** on every request; model access vs `role.allowedModels`; rolling-24h quotas.
- **Sent to Anthropic:** system prompt (with tool descriptions + **presigned S3 URLs** when files attached), fitted history, tool defs, thinking config, container skills. Temperature omitted.
- **PII persisted:** user prompt + full response → `prompt_audit_logs` (~100KB cap) with `user_name`/`user_email`; `tool_calls` JSONB may include MCP-generated SQL + returned rows.
- **S3:** private bucket `faborch-user-uploads`; time-limited presigned GET (24h default, 7d max); durable keys stored in message metadata. Prompt caching disabled whenever file refs present.
- **Resilience:** S3/MCP/registry/audit are best-effort — none break the stream; `consumeStream()` completes backend on disconnect.

## 5. Mermaid sequence diagram

```mermaid
sequenceDiagram
    autonumber
    participant User as User (useChat)
    participant Route as route.ts POST /api/chat
    participant Auth as requireAuth / session-audit
    participant DB as PostgreSQL
    participant S3 as S3
    participant Anthropic as Anthropic API

    User->>Route: messages, model, conversationId, webSearch, activeMcpIds
    Route->>Auth: requireAuth(req)
    Auth->>DB: getSessionByToken + checkAndRecordActivity
    DB-->>Auth: session/user (or evict -> 401)
    Auth-->>Route: { user }
    Route->>Route: validateOrThrow(ChatRequestSchema)
    Route->>DB: getAllowedModelIds / getRegistryRates / getThinkingConfig
    Route->>DB: user.findUnique(role) + usageRecord.aggregate (RBAC + limits)
    alt limit exceeded
        Route-->>User: 429 Daily limit reached
    end
    Route->>DB: recordPromptStart -> INSERT prompt_audit_logs (PENDING)
    Route->>S3: uploadUserFileToS3(attachments)
    Route->>DB: addMessage(user message)
    Route->>Route: assemble tools (code_execution + web_* + MCP)
    opt MCP active
        Route->>DB: mcpConnection.findMany (authorized)
        Route->>Anthropic: load MCP tool schemas
    end
    Route->>S3: presignKey(key) fresh URLs
    Route->>Route: fitMessagesToContextWindow + caching
    Route->>Anthropic: streamText(model, system, messages, tools, thinking, skills)
    loop tool-loop (stopWhen stepCountIs 20)
        Anthropic-->>User: stream tokens / reasoning
        Note over Route: keepalive every 15s; container id forwarded
    end
    Anthropic-->>Route: result.text / reasoning / steps
    Route-->>User: data-fileDownload chunks
    Note over Route: onFinish
    Route->>DB: addMessage(assistant) + usageRecord.create + recordPromptSuccess (cost)
    alt stream error
        Route->>DB: recordError (error_audit_logs) + recordPromptFailure
        Route-->>User: error text (errorId=...)
    end
```

## 6. Open validation items (need runtime)

- [ ] Verify the `[Chat] Available tools` log and step `toolCalls` match expectations (`code_execution` always; `web_*` and MCP only when enabled).
- [ ] Verify mid-loop tool cleaning survives the second `prepareStep` override, `forwardAnthropicContainerIdFromLastStep` (refs #11855/#8112).
- [ ] Verify `cachedInputTokens > 0` on repeat turns and caching stays off when files are attached.
- [ ] Verify SDK v6 usage fields populate and cost uses registry rates (not `MODEL_PRICING` fallback) with per-step model attribution.
- [ ] Verify the PENDING audit row finalizes to SUCCESS/FAILED/TIMEOUT in every path, including a hard `maxDuration` cut.
- [ ] Verify long tool loops hitting `stepCountIs(20)` do not silently truncate.
- [ ] Verify `classifyTopic` assigns the intended manufacturing bucket.
