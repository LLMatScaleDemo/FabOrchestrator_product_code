# On-the-Fly MCP Runtime (Lambda)

The **fixed, reviewed** shell that every on-the-fly MCP server runs on. It is never
generated or edited by the LLM. The only per-source input is `manifest.json`
(tools = name + inputSchema + a read-only SELECT), which is baked into the
deployment zip. In Phase 1 the admin pipeline generates that manifest; this code
stays constant.

> **Note on the approved flow.** The team-approved design is "generate the MCP
> server code per source." This shell is the guardrailed realization of that: the
> per-source *code* is confined to the manifest's SELECT bodies plugged into this
> reviewed protocol shell, so no free-form LLM code is ever deployed. See
> `../../MCPONFLY.md` and the plan file.

## Protocol

Speaks the MCP JSON-RPC-over-HTTP subset that `claudeai_athena/lib/mcp-client.ts`
already consumes, so Steps 5–6 of the flow need no consumer changes:

| Method | Behaviour |
|---|---|
| `initialize` | returns `protocolVersion` / `capabilities` / `serverInfo`; mints an `Mcp-Session-Id` response header |
| `tools/list` | returns the manifest's tools (name + description + inputSchema) |
| `tools/call` | runs the named tool's SELECT with bound params, returns MCP `content[]` |

Transport: a **Lambda Function URL** (`POST`, `Authorization: Bearer <token>`).

## Guardrails

**Data**
- Bearer auth (`MCP_BEARER_TOKEN`) on every request.
- Target DB creds are **never** in env/code — fetched from Secrets Manager by
  `SECRET_ARN` and cached in the warm container.
- **Read-only only:** each SQL must start with `SELECT`/`WITH`, passes a
  write/DDL deny-list, and rejects multi-statement input; connections open with
  `default_transaction_read_only=on`.
- **Named params only** (`:name` → `$n`); no string concatenation; args must be
  in the tool's `inputSchema.properties`.
- DB errors are not echoed verbatim (avoids schema/cred leakage).

**Cost**
- `statement_timeout` (≤30s), row cap (`MAX_ROWS`), output-byte cap
  (`MAX_OUTPUT_BYTES`), small PG pool, warm reuse of pool + secret.
- Deployed with low reserved concurrency + capped memory/timeout (see the
  CloudFormation substrate + the deploy module).

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `SECRET_ARN` | Secrets Manager ARN of the target DB creds `{host,port,user,password,database,ssl?}` | (required) |
| `MCP_BEARER_TOKEN` | per-server bearer FO sends as `Authorization: Bearer` | (required) |
| `AWS_REGION` | region for Secrets Manager | `us-west-2` |
| `MAX_ROWS` | row cap per call | `1000` |
| `MAX_OUTPUT_BYTES` | output byte cap per call | `1000000` |
| `STATEMENT_TIMEOUT_MS` | Postgres statement timeout | `15000` |

## Local smoke test

```bash
npm install
# point at a throwaway Postgres; put creds in a local secret or stub getSecret()
node -e "import('./index.mjs').then(m=>m.handler({requestContext:{http:{method:'POST'}},headers:{authorization:'Bearer test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(r=>console.log(r.body)))"
```

The Phase 0 goal: deploy this with `manifest.example.json` copied to
`manifest.json`, register it in `mcp_registry`, assign to a test user, and confirm
the FO chat can `tools/list` + `tools/call` end to end.
