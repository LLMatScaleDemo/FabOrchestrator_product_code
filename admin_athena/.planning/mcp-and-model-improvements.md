# MCP & Model Improvements Plan

## 1. Remove API Key requirement from admin MCP assignment
**Problem**: Admin MCP connection form asks for API key, but these MCP servers don't need auth.
**Fix**: Default auth type to "none" and hide API key field unless explicitly selected.
**Files**: `app/admin/mcp/page.tsx` (AddMcpDialog), `app/api/admin/mcp/route.ts`

## 2. Auto-enable MCP connections for users
**Problem**: When admin assigns MCP to a role, users see it but have to manually click "Connect".
**Fix**: Role-level MCPs should be auto-active (`isActive: true`, `status: 'connected'`). In Athena's chat route, skip the "test connection" requirement for role-level MCPs — treat them as always available.
**Files**: 
- `Claude_ai_athena/app/api/mcp/connections/route.ts` — return role MCPs as connected
- `Claude_ai_athena/app/api/chat/route.ts` — auto-include role MCPs without activation check

## 3. MCP Registry Table + Dropdown in Admin
**Problem**: Admin has to copy-paste MCP URLs. Want a dropdown to select from saved MCP servers.
**Fix**: 
- Create new `McpRegistry` model in Prisma (id, displayName, serverUrl, authType, createdAt)
- Seed with the 7 known MCP servers
- Admin MCP page shows dropdown from registry instead of manual URL input
- Admin can also add new registry entries

**Schema change**:
```prisma
model McpRegistry {
  id          String   @id @default(uuid())
  displayName String   @map("display_name")
  serverUrl   String   @unique @map("server_url")
  authType    String   @default("none") @map("auth_type")
  createdAt   DateTime @default(now()) @map("created_at")
  @@map("mcp_registry")
}
```

**Seed data** (7 servers):
- CMF - Critical Manufacturing | https://sd6ch0xtng.execute-api.us-west-2.amazonaws.com/mcp
- CM MES - Assembly | https://9vh4xw2kb1.execute-api.us-west-2.amazonaws.com/mcp
- CM MES - Lab Data | https://f09ls0pyr9.execute-api.us-west-2.amazonaws.com/mcp
- Opcenter - Siemens | https://rniju3wscb.execute-api.us-west-2.amazonaws.com/mcp
- Opcenter - CoreSi | https://bu6num9hr8.execute-api.us-west-2.amazonaws.com/mcp
- PSI Quantum | https://fezokoagz5.execute-api.us-west-2.amazonaws.com/mcp
- Lumentum Server | https://ocx3mhgaw5.execute-api.us-west-2.amazonaws.com/mcp

**Files**:
- `prisma/schema.prisma` — add McpRegistry model
- `prisma/seed.ts` — seed 7 MCP servers
- `app/api/admin/mcp-registry/route.ts` — CRUD for registry
- `app/admin/mcp/page.tsx` — dropdown from registry
- `lib/admin-tools.ts` — update chat tools

## 4. Model Display Labels
**Problem**: Want custom display labels for models (e.g. "Sonnet 4.6" shown as "FabOrchestrator Standard").
**Fix**: Add `displayLabel` column to Role's allowedModels or create a separate model label mapping.
- Option A: Add `modelLabels` JSON field to a settings table
- Option B: Extend the seed to include labels in a new `ModelLabel` table
- Option C: Use the existing `Role.allowedModels` as `[{id, label}]` instead of `[string]`

**Simplest approach**: Add a `model_labels` JSON column to a platform settings table, or just use a config file. Admin can set custom labels per model.

## 5. Available MCP servers (reference)
Already listed above in item 3 seed data.

## Implementation Order
1. Item 1 (quick fix — remove API key default) 
2. Item 2 (auto-enable role MCPs)
3. Item 3 (MCP registry + dropdown) — requires schema change
4. Item 4 (model labels) — requires schema change
5. Deploy both apps

## Estimated Time
~2-3 hours for all 5 items
