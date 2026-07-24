# On-the-Fly MCP Server Creation

Implementation of the team-approved "create an MCP server on demand" flow. Admins
supply a data source's connection parameters in the admin app; the platform
connects, generates a per-source read-only MCP server (Lambda), deploys it onto a
pre-provisioned substrate, and assigns it to users — who then run SELECT tools in
FabOrchestrator chat.

Design docs: `../MCPONFLY.md`, `../MCP_OnTheFly_Solution_Risks_and_Challenges1.docx`,
`On-the-Fly MCP Server Creation – Process Flow.pptx`. Plan:
`~/.claude/plans/lets-get-started-*.md`.

## Layout

```
mcp-onthefly/
  runtime/                 # the FIXED MCP-over-HTTP Lambda shell (never LLM-edited)
    index.mjs              #   Function-URL handler + MCP JSON-RPC (initialize/tools.list/tools.call)
    guard.mjs              #   pure read-only SQL guard + named-param binding (unit-tested)
    manifest.example.json  #   shape of the per-source manifest the pipeline generates
    test/guard.test.mjs    #   19 guard tests (writes/DDL/injection rejected)
    README.md
../cloudformation/mcp-onthefly.yaml   # provision-once substrate (role, SG, bucket, deploy policy, budget)
```

## Status

| Piece | State |
|---|---|
| Runtime Lambda shell + read-only guardrails | **built + unit-tested** (19/19 pass) |
| CloudFormation substrate (role/SG/bucket/deploy-policy/budget) | **built** — needs review + `validate-template` + deploy (ask-first) |
| Phase 1 admin pipeline (intake→connect→generate→deploy→register) | **built** (needs `npm install` + `prisma generate` + `tsc`) |
| Substrate deploy to AWS + runtime base zip | pending (AWS access / IAM = ask-first) |
| End-to-end proof (deploy runtime, consume in FO chat) | pending substrate |

## Phase 1 — admin pipeline (in `admin_athena`)

Data model: `prisma/schema.prisma` model `McpDataSource` + `prisma/create_mcp_data_sources.sql` (additive, idempotent).

Lib (`lib/mcp-onthefly/`): `types.ts` (zod), `parse-creds.ts`, `secrets.ts`
(Secrets Manager), `connectivity.ts` (SELECT 1 + information_schema),
`manifest-guard.ts` (control-plane read-only gate — mirrors `runtime/guard.mjs`),
`codegen.ts` (LLM → manifest, re-gated), `deploy.ts` (Lambda deploy on the
substrate), `requirements.ts` (Step-1 checklist).

Endpoints (all `requireAdmin`):

| Route | Step |
|---|---|
| `POST /api/admin/mcp/secrets` | 1 — creds file → Secrets Manager (off chat) |
| `POST /api/admin/mcp/sources/[id]/connect` | 2 — test + discover schema |
| `POST /api/admin/mcp/sources/[id]/generate` | 3 — generate + static-check manifest |
| `POST /api/admin/mcp/sources/[id]/deploy` | 4+5 — deploy, validate, register in `mcp_registry` |
| `GET /api/admin/mcp/sources`, `GET/DELETE .../[id]` | list / detail / retire (full deprovision) |
| existing `POST /api/admin/mcp` | assign the registered server to a user/role |

Admin chat tool `list_mcp_datasource_requirements` (in `lib/admin-tools.ts`)
surfaces the Step-1 checklist.

### Verification runbook (Phase 1)

```bash
cd admin_athena
npm install                 # pulls the new @aws-sdk/* + adm-zip deps
npx prisma generate         # regenerate client so prisma.mcpDataSource exists
npx tsc --noEmit            # type-check the new pipeline
# apply the additive table to the shared DB (ask-first):
psql "$DATABASE_URL" -f prisma/create_mcp_data_sources.sql
```

Then, once the substrate is deployed and its outputs are set as env vars
(`MCP_OTF_ARTIFACT_BUCKET`, `MCP_OTF_RUNTIME_ROLE_ARN`, `MCP_OTF_SUBNET_IDS`,
`MCP_OTF_SECURITY_GROUP_ID`) and the runtime base zip is published to
`s3://<artifact-bucket>/runtime-base/v1.zip` (built from `mcp-onthefly/runtime`
with `npm install --production`), the full loop is: secrets → connect → generate
→ (review) → deploy → assign → use in FO chat.

## How it maps to the 6 approved steps

1. **Collect params** — admin lists required params in chat; the creds *file*
   uploads to a dedicated endpoint (not chat) → Secrets Manager. *(Phase 1)*
2. **Connect** — admin backend `SELECT 1` + `information_schema` discovery. *(Phase 1)*
3. **Generate** — LLM fills the manifest (tool = name+inputs+SELECT) that plugs
   into `runtime/`; static-checked + human-approved. *(Phase 1)*
4. **Deploy** — bundle runtime+manifest → `lambda:CreateFunction` on the
   substrate + Function URL + per-server bearer. *(Phase 1 deploy module)*
5. **Add to FO** — write an `mcp_registry` row (serverUrl = Function URL) → reuse
   the existing assignment route. *(reuses existing machinery)*
6. **Use** — existing FO `/test` discovery + `lib/mcp-client.ts` + chat injection.
   *(no changes needed)*

## Guardrails (cost + data)

Data: bearer auth; creds only in Secrets Manager (by ARN); read-only SELECT-only
enforcement (allow-check + deny-list + multi-statement rejection +
`default_transaction_read_only`); named params only; DB errors not echoed. Cost:
statement timeout, row + output-byte caps, low reserved concurrency, capped
memory/timeout, shared substrate (no per-server IAM/VPC), tag-scoped AWS Budget.

## Next steps

1. Review + `aws cloudformation validate-template --template-body file://cloudformation/mcp-onthefly.yaml --region us-west-2`, then deploy the substrate (ask-first IAM).
2. Phase 0 proof: `cp runtime/manifest.example.json runtime/manifest.json`, zip
   `runtime/` with deps, deploy as `mcp-otf-spike`, register in `mcp_registry`,
   assign to a test user, confirm a SELECT tool works in FO chat.
3. Phase 1: build the admin pipeline modules (see the plan file).
```
