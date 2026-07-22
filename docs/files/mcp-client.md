# `lib/mcp-client.ts` — MCP tool discovery + execution over JSON-RPC/SSE

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/mcp-client.ts`; Admin has no copy — see the
> Both-apps note). · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 11](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The client half of the platform's MCP (Model Context Protocol) integration: it turns the
tool lists cached on `mcp_connections` rows into Vercel AI SDK tools the chat LLM can
call, and executes those calls as JSON-RPC 2.0 `tools/call` POSTs (JSON or SSE responses)
against external MCP servers — with per-connection encrypted credentials decrypted **at
call time** and a one-shot session-refresh retry when the remote session expires. The MCP
*servers* themselves live outside this repo. Full end-to-end flow:
[scenario 03 — MCP tool call](../scenarios/03-mcp-tool-call.md).

## Depends on / consumed by

**Depends on:**
- `storage.ts` — `getMcpConnection` (row lookup, static import) and `updateMcpConnection`
  (dynamic import, only when persisting a refreshed session ID).
- [`encryption.ts`](./encryption.md) — `decrypt` for `auth_credentials_encrypted`
  (AES-256-GCM via `KEY_ENCRYPTION_SECRET`).
- `ai` (`tool`) + `zod` — AI SDK tool construction and dynamic input schemas.
- `errors/faborch-errors.ts` + `logger.ts` — REQ-01 classification/logging; and
  `errors/error-audit.ts` (`recordError`) via **dynamic import at 3 call sites** (see
  [error-audit page](./error-audit.md)).
- Network: `fetch(connection.serverUrl, …)` — the URL comes from the DB row, ultimately
  from either the Admin MCP registry or a user's personal connection.

**Consumed by** (verified by import grep at the pinned commit): **exactly one file** —
`claudeai_athena/app/api/chat/route.ts` imports `loadActiveMcpToolsWithDescriptions`
([chat-route page](./chat-route.md)). The `/api/mcp/connections/*` routes (create / test
/ discover) do **not** import this file — they re-implement the JSON-RPC
`initialize`/`tools/list` calls and SSE parsing inline. (The
[file catalog](../01-file-catalog.md) lists `/api/mcp/*` as a consumer — that is true
only in the "same protocol, duplicated code" sense, not as an import.)

## Function-by-function

### `executeMcpTool(connectionId, toolName, toolArguments, userId?): Promise<McpToolResult>`

The runtime tool call. Reloads the connection row (throws `'MCP connection not found'` /
`'MCP connection is not active'` if missing or `status !== 'connected'`), then runs an
inner `executeWithRetry(retryCount)`:

1. **`getAuthHeaders` (private) — credentials decrypted per call.** Builds JSON +
   `Accept: application/json, text/event-stream` headers, adds `Mcp-Session-Id` if the
   row has one, and — if `auth_credentials_encrypted` is set — `decrypt`s + `JSON.parse`s
   it; `authType === 'api_key'` → `Authorization: Bearer <apiKey>`. **A decrypt/parse
   failure is caught, `console.error`'d, and the request proceeds with no auth header.**
   OAuth is explicitly not implemented (comment: "simplified here"). Plaintext
   credentials are never cached — every execution decrypts afresh.
2. **POST** JSON-RPC 2.0 `tools/call` (`id: Date.now()`) to `connection.serverUrl` with
   `AbortSignal.timeout(30000)` — 30 s hard cap per attempt.
3. **Three error branches**, each with the same session-refresh check first:
   `isSessionExpiredError(text)` (private) does a case-insensitive substring match
   against `missing session` / `invalid session` / `session expired` /
   `session not found` / `unauthorized` / `session id`. If it matches **and
   `retryCount === 0`**, `refreshMcpSession` runs; if it yields a new session ID the
   whole attempt is re-run once (`executeWithRetry(1)`). At most **one retry, ever**.
   - **HTTP not-ok:** classified as `LAMBDA_MCP_CRASH` (≥500 and default),
     `UNLISTED_STORED_PROC` (404), or `INVALID_PARAMETER` (400); logged
     (`logger.fabOrchError`) and persisted via **dynamic-import `recordError`
     (call site 1)**, fire-and-forget (`.catch(() => {})`).
   - **JSON-RPC `error` in the body:** `-32601` → `UNLISTED_STORED_PROC`, `-32602` →
     `INVALID_PARAMETER`, else `LAMBDA_MCP_CRASH`; logged + **`recordError` (call
     site 2)**.
   - **Thrown exception** (timeout, DNS, TLS, SSE-parse): `AbortError`/`TimeoutError` →
     `RESPONSE_TIMEOUT`, else `LAMBDA_MCP_CRASH`. Logged — but **no `recordError`
     here**; this branch is logger-only (see gotchas).
4. All three error branches **return, not throw**:
   `{ content: [{ type:'text', text: '<userMessage> (errorId=…)' }], isError: true }` —
   the error becomes tool output the LLM reads. Success returns `result.result`, or a
   `'No result returned'` text result if the server sent none.

**`parseSSEResponse` (private):** branches on `Content-Type` — JSON → `response.json()`;
`text/event-stream` → buffers the **entire** body text, scans `data:` lines,
`JSON.parse`s each (non-JSON lines silently skipped), and returns the **last** parseable
one; no `data:` payloads → throws `'No valid JSON-RPC response found in SSE stream'`.
Any other content-type → tries `response.json()` anyway.

**`refreshMcpSession(connectionId)` (private):** re-runs JSON-RPC `initialize`
(`protocolVersion '2024-11-05'`, `clientInfo.name 'llmatscale-ai'`) with a **10 s**
timeout and the same decrypt-or-proceed-unauthenticated auth logic (second decrypt site);
reads the new session ID from the `mcp-session-id` or `x-session-id` **response header**
(the body is never parsed), persists it via dynamic-import `updateMcpConnection`, and
returns it. Every failure path (row gone, non-ok, no header, exception) returns `null` —
never throws.

### `getMcpTools(connectionId): Promise<McpTool[]>`

Tool *discovery* at chat time is **cache-only — no network and no decrypt**: returns the
`available_tools` JSON column (populated earlier by the inline `/api/mcp/connections/[id]/test`
and `/discover` routes) if the row exists, `status === 'connected'`, and the column is a
non-empty array; otherwise returns `[]` with a `console.log` explaining why. Never
throws. Exported but only called internally at this commit.

### `convertMcpToolsToAiTools(mcpTools, connectionId, userId?): Record<string, any>`

Converts cached MCP tool definitions into AI SDK `tool()` objects:
- Key: `mcp_<name>` with every non-`[a-zA-Z0-9_]` character replaced by `_`.
- Description: the **remote server's** `description` verbatim (fallback
  `MCP tool: <name>`) — this text goes straight into the LLM's tool list.
- Input schema via **`buildZodSchema` (private)**: maps JSON-Schema `properties` to Zod —
  `string` (or `z.enum` if `enum` present), `number`/`integer`, `boolean`,
  `array` → `z.array(z.unknown())`, `object` → `z.record(z.string(), z.unknown())`,
  anything else → `z.unknown()`; non-`required` keys `.optional()`; `description`s
  carried over. Nested object shapes are *not* recursed into. No schema → `z.object({})`.
- The `execute` closure calls `executeMcpTool`, joins the `type:'text'` content parts,
  and: `isError` → returns `{ error, isError: true }` to the LLM; success → tries
  `JSON.parse(textContent)` and returns the parsed object, else
  `{ data: textContent, success: true }`. If `executeMcpTool` itself **throws** (row
  missing/inactive, or an unexpected bug — the network paths return rather than throw),
  the catch classifies (`RESPONSE_TIMEOUT` for abort/timeout names, else
  `LAMBDA_MCP_CRASH`, reusing an existing `FabOrchError` as-is), logs, and persists via
  **dynamic-import `recordError` (call site 3** — note: passes `connectionId`/`toolName`
  in `requestContext` but *not* the in-scope `userId`), then returns
  `{ error, isError: true, type }`.

### `loadActiveMcpToolsWithDescriptions(activeMcpIds, userId?): Promise<{ tools, descriptions }>`

The one export the chat route actually uses. For each connection ID (the route has
already reduced these to role-authorized + personal IDs — see
[scenario 03 §2.6](../scenarios/03-mcp-tool-call.md)): `getMcpTools` →
`convertMcpToolsToAiTools` → `Object.assign` into one flat map, plus a
`{ name: 'mcp_<safeName>', description }` list the route injects into the system prompt.
A per-connection `try/catch` logs and **continues** — one bad connection can't break the
others (or the chat). Empty/absent IDs → empty result.

### `loadActiveMcpTools(activeMcpIds, userId?)` and type exports

Thin wrapper returning just `.tools` — **no importers at this commit (dead export)**.
`McpTool`, `McpToolCall`, `McpToolResult` interfaces are also exported; `McpToolCall` is
referenced nowhere.

## Failure modes & gotchas

- **Decrypt failure fails open (twice):** in both `getAuthHeaders` and
  `refreshMcpSession`, a credential decrypt/parse error is swallowed
  (`console.error` only, no FabOrch error, no audit) and the call proceeds
  **unauthenticated**. A wrong `KEY_ENCRYPTION_SECRET` shows up as remote 401s, not as a
  crypto error.
- **Untrusted server output flows into the LLM prompt:** tool *descriptions* (cached from
  the remote `tools/list`) go into the tool list and the system prompt, and tool
  *results* are returned to the model — sometimes `JSON.parse`'d into arbitrary
  structures. A malicious or compromised MCP server can attempt prompt injection through
  either channel; nothing here sanitizes content. It also receives the LLM-generated
  arguments and the `Bearer` credential, and (per hotspot row 12) presigned S3 URLs that
  appear in prompts/arguments.
- **SSRF surface:** `serverUrl` is fetched server-side with no allowlist, scheme, or
  private-IP check in this file. Role-level URLs come from the Admin-curated
  `mcp_registry`, but **personal** connections are created by end users via
  `POST /api/mcp/connections` — a user can point the platform's backend at internal
  endpoints (response content then flows back to their own chat).
- **`'unauthorized'` triggers a session refresh:** `isSessionExpiredError` matches the
  substring `unauthorized`, so a plain bad-API-key 401 also burns the refresh + retry
  before failing.
- **The exception branch is logger-only:** timeouts and network errors inside
  `executeWithRetry` are classified and logged but **not** written to `error_audit_logs`
  (no `recordError`), and because `executeMcpTool` returns rather than throws, the
  closure's call-site-3 `recordError` never fires for them either. Scenario 03 §3's
  "each error … persisted via `recordError`" **overstates this** — only the HTTP and
  JSON-RPC branches persist.
- **Errors are tool results, not failures:** the chat stream never errors on an MCP
  failure; the LLM just sees `{ isError: true, error: '… (errorId=…)' }` and narrates it.
  Good UX, but nothing upstream can distinguish "tool failed" from "tool answered".
- **Name-collision by sanitization / merging:** `a-b` and `a_b` both become `mcp_a_b`;
  and the same tool name on two active connections collides in `Object.assign` — last
  connection silently wins, and its `connectionId` is what executes.
- **Shared mutable session:** `sessionId` lives on the single `mcp_connections` row; a
  role-level connection shares one session across all users, and concurrent expired
  calls can race `refreshMcpSession` (last write wins).
- **Verbose plaintext logging:** full tool arguments and a 500-char result preview are
  `console.log`'d on every execution — sensitive data in arguments/results lands in
  server logs.
- **Small sharp edges:** `id: Date.now()` can collide across concurrent calls; SSE
  parsing buffers the whole body (no size cap) and takes the *last* `data:` line;
  `buildZodSchema` would throw at tool-construction time on an **empty** `enum: []`;
  nested object schemas degrade to `z.record`, so the LLM gets no shape guidance for
  them.

## Open questions for the code owner

1. Is "decrypt failure ⇒ proceed unauthenticated" intended, or should the tool call
   fail and be recorded as a crypto error? (Hotspot row 11.)
2. Should `executeWithRetry`'s exception/timeout branch also call `recordError`, and
   should call site 3 pass `userId`?
3. Is the personal-connection SSRF surface (user-supplied `serverUrl`) accepted, or
   should URLs be restricted to the Admin registry / an allowlist?
4. Do the real MCP servers signal expiry via the `'unauthorized'` substring that
   `isSessionExpiredError` matches? ([scenario 03 §6](../scenarios/03-mcp-tool-call.md))
5. Is last-write-wins on `sessionId` safe for the session-refresh race on shared
   role-level connections?
6. Are the apparently dead `loadActiveMcpTools` and `McpToolCall` safe to remove?
7. Is the `/api/mcp/connections/*` routes' inline duplication of this JSON-RPC/SSE
   logic (vs importing `parseSSEResponse` etc.) intentional, or a drift hazard?

## Both-apps note

**Fab-only.** There is no `admin_athena/lib/mcp-client.ts`, and no Admin code speaks
JSON-RPC to MCP servers at all (grep for `jsonrpc`/`tools/list` finds nothing). The
asymmetry is by design: Admin *manages the catalog* — `/api/admin/mcp-registry` CRUDs the
`mcp_registry` table (name, URL, auth type, encrypted credentials) and
`/api/admin/mcp` copies a registry entry's fields onto `mcp_connections` rows assigned to
roles or users — while Fab *uses* the resulting `mcp_connections` rows: discovery/testing
via the inline `/api/mcp/connections/*` routes, and runtime execution via this file. The
shared DB is, as everywhere else, the only bridge.
