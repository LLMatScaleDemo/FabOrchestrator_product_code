# `prisma/schema.prisma` (+ `prisma/*.sql`) — the shared PostgreSQL data model

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **shared / both** — one PostgreSQL database, two Prisma clients.
> `admin_athena/prisma/schema.prisma` is the **source of truth**;
> `claudeai_athena/prisma/schema.prisma` is a hand-kept mirror. · Review priority: **High** ·
> Catalog row: [01 — File catalog §C](../01-file-catalog.md) · Hotspot:
> [03 §1 row 25](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance) +
> [03 §5](../03-review-hotspots.md#5-raw-sql--injection-surface) ·
> Integration: [04 §4.6 — Data model](../04-architecture-and-integration.md)

## Purpose

This is the **single physical database** both apps share. There is no app-to-app API — the
entire FabOrchestrator ↔ NexusOps (Admin) integration is *"Admin writes config rows, Fab
reads them; Fab writes audit/usage rows, Admin reads them"* through this schema
(see [04 §4.4](../04-architecture-and-integration.md)). The Prisma schema declares ~20
models; **a second, invisible layer of audit tables exists only as raw SQL** accessed via
`$queryRawUnsafe` and is **not declared anywhere in this repo** (see the prominent
"Raw-SQL-only tables" section). A reader of `schema.prisma` alone sees roughly two-thirds
of the real database.

Three physical layers make up the model:

1. **`admin_athena/prisma/schema.prisma`** — 21 Prisma models + 3 enums. The declared
   source of truth (its header comment: *"SOURCE OF TRUTH — run migrations from
   admin_athena, regenerate in both apps"*).
2. **`claudeai_athena/prisma/schema.prisma`** — a hand-maintained **mirror**, 20 models
   (missing exactly one: `McpRegistry`). Regenerated into Fab's Prisma client.
3. **`admin_athena/prisma/*.sql`** — 5 additive, idempotent migration scripts that create
   the config/CMF tables and patch a few columns. **None of them create the audit tables.**

## Depends on / consumed by

**Depends on:** PostgreSQL (RDS). The `datasource db` block has `provider = "postgresql"`
and reads `DATABASE_URL` from the environment (the URL string itself is not in the file).
Both apps connect with `ssl: false` ("POC mode" — see [db.md](./db.md) and
[03 §2](../03-review-hotspots.md#2-security--authorization)).

**Consumed by:** *everything.* Each app runs `prisma generate` from **its own** copy into
`lib/generated/prisma`, so:
- **Admin** (`admin_athena`) is authoritative: it owns the schema, the seed, and all 5 SQL
  migrations. Its services (`admin-user-service.ts`, `role-service.ts`, `usage-service.ts`,
  `invitation-service.ts`, `audit-service.ts`) and `admin-tools.ts` read/write these tables.
- **Fab** (`claudeai_athena`) generates a client from its mirror. Its data-access layer is
  [`storage.ts`](./storage.md) plus the raw-SQL modules
  ([`session-audit.ts`](./session-audit.md), [`prompt-audit.ts`](./prompt-audit.md),
  [`error-audit.ts`](./error-audit.md), [`error-catalog-loader.ts`](./error-catalog-loader.md),
  [`model-registry.ts`](./model-registry.md)).

Because the two clients are generated from two files, **the mirror drifting from the source
is the central Fab↔Admin integration risk** — the whole reason `schema.prisma` is declared
a single source of truth. See the [Fab-vs-Admin diff](#fab-vs-admin-schemaprisma-diff) below.

---

## Model-by-model (the declared Prisma schema)

All models use `@map`/`@@map` to snake_case the physical columns/tables (the model names
are PascalCase; the tables are `users`, `mcp_connections`, etc.). PKs are `uuid()` except
the six CMF models, which use `cuid()`, and `PlatformSettings`, whose PK is the literal
string `"global"` (a singleton row). "Cascade" below = an explicit `onDelete: Cascade`.

### Identity & RBAC (5 models)

| Model → table | Key fields | Notable indexes / constraints | Cascade behaviour |
|---|---|---|---|
| `Role` → `roles` | `name @unique`, `permissions` Json, `allowedModels` Json, `dailyRequestLimit?`, `dailyTokenLimit?`, `systemInstructions? @db.Text`, `personalMcpEnabled/MaxCount`, `promptSuggestions` Json | `name` unique | parent of User/McpConnection/Invitation (no explicit cascade — see gotchas) |
| `User` → `users` | `email @unique`, `passwordHash`, `anthropicApiKeyEncrypted?`, `preferences` Json, **`roleId?`**, **`isAdmin`**, **`status` (default `ACTIVE`)**, **`forcePasswordChange`**, `passwordChangedAt?`, `emailVerified` | `@@index([email])` (plus the unique) | **hub of the cascade graph** — see [cascade section](#cascade-delete--soft-delete-behaviour) |
| `Session` → `sessions` | `token @unique` (**plaintext**), `expiresAt`, `userAgent?`, `ipAddress?`, `lastUsedAt?` | `token @unique` **and** redundant `@@index([token])`; `@@index([userId])` | `user` **Cascade** |
| `Invitation` → `invitations` | `email`, `roleId`, `invitedById`, `token @unique` (**plaintext**), `status` (`PENDING`/`ACCEPTED`/`EXPIRED`/`REVOKED`), `expiresAt`, `acceptedAt?` | `@@index([token])`, `@@index([email])` | `role`, `invitedBy` (**no** onDelete → default Restrict) |
| `PasswordResetToken` → `password_reset_tokens` | `email`, `token @unique` (**plaintext**), `expiresAt`, `usedAt?` | `@@index([token])`, `@@index([email])` | none (no relation to User) |

`status` is a bare `String` (schema comment says `ACTIVE | SUSPENDED`, but the auth code
also treats `DELETED` as a value — see [auth-middleware.md](./auth-middleware.md) and
[soft-delete](#cascade-delete--soft-delete-behaviour)).

### Chat & memory (4 models)

| Model → table | Key fields | Notable indexes | Cascade behaviour |
|---|---|---|---|
| `Conversation` → `conversations` | `title` (default `"New Conversation"`), `model`, `agent` (default `"chat"`; `"chat"`/`"modeling"` splits Modeling-Agent history), `activeMcpIds` Json, `isPinned`, `isShared`, `lastMessageAt?`, **`deletedAt?`** (soft delete) | `@@index([userId])`, `@@index([userId, updatedAt desc])`, `@@index([userId, deletedAt])` | `user` **Cascade**; parent of Message/Artifact |
| `Message` → `messages` | `role` (`user`/`assistant`/`tool`), `content`, `parts` Json?, `metadata` Json (default `{}`), `editedAt?` | `@@index([conversationId, createdAt])` | `conversation` **Cascade** |
| `Artifact` → `artifacts` | `messageId`, `userId`, `type` (default `html`), `title`, `content` | `@@index([conversationId])`, `@@index([messageId])` | `conversation` **Cascade**, `message` **Cascade**, `user` **Cascade** (triple-parented) |
| `MemoryFile` → `memory_files` | `path`, `content`, `scope` (default `user`) | `@@unique([userId, path])`, **`@@unique([scope, path])`**, `@@index([userId])`, `@@index([scope])` | `user` **Cascade** |

The `deletedAt` on Conversation is the platform's only soft-delete flag besides
`users.status`. See [storage.md](./storage.md) — nothing purges soft-deleted rows and
message/artifact reads don't re-check the parent's `deletedAt`.

### MCP (2 models — one is Admin-only)

| Model → table | Key fields | Notable indexes | Cascade behaviour |
|---|---|---|---|
| `McpConnection` → `mcp_connections` | `userId?`, `roleId?` (null = personal, set = role-scoped), `serverUrl`, `authType` (default `none`), `authCredentialsEncrypted?`, `availableTools` Json, `status`, `sessionId?`, **`registryId?`** (links an admin-assigned MCP back to `mcp_registry`) | `@@index([userId])`, `@@index([registryId])` | `user` **Cascade**; `role` optional (default SetNull) |
| `McpRegistry` → `mcp_registry` | `displayName`, `serverUrl @unique`, `authType`, `authCredentialsEncrypted?`, `isActive` | `serverUrl @unique` | none. **⚠️ ADMIN SCHEMA ONLY — absent from Fab's mirror** |

### Admin-managed config (2 models)

| Model → table | Key fields | Notable indexes | Cascade behaviour |
|---|---|---|---|
| `ModelRegistry` → `model_registry` | `modelId @unique`, `displayName`, per-1M costs (`inputCostPer1M`, `outputCostPer1M`, `cacheReadCostPer1M`, `cacheWriteCostPer1M` — all `Float`/DOUBLE PRECISION, default 0), `thinkingType`, `thinkingBudget?`, `isActive`, `isDefault`, `sortOrder` | `@@index([isActive])`, `@@index([sortOrder])` | none |
| `PlatformSettings` → `platform_settings` | `id @default("global")` (**singleton**), `colorTheme` (default `fab-blue`), `auditRetentionDays` (default 90), `updatedById?` | PK is the constant string | none |

`ModelRegistry` and `PlatformSettings` are read by **both** apps (model picker / RBAC gate /
USD cost math; and the platform color theme respectively) — [04 §4.4](../04-architecture-and-integration.md).
See [model-registry.md](./model-registry.md).

### Audit & usage — Prisma models (3 models + 1 enum)

| Model → table | Key fields | Notable indexes | Cascade behaviour |
|---|---|---|---|
| `AuditLog` → `audit_logs` | `userId?`, `action` (`"user.created"`, `"cmf.*"`, …), `targetType?`, `targetId?`, `metadata` Json, `ipAddress?` | `@@index([userId])`, `@@index([action])`, `@@index([createdAt])` | `user` **SetNull** (not Cascade — rows survive user deletion) |
| `UserSessionLog` → `user_session_logs` | `sessionTokenHash? @unique` (**sha256 hash**, not the raw token), `loginTime`, `logoutTime?`, `lastActivityAt`, `idleSeconds`, `sessionStatus` (enum, default `ACTIVE`), `closedReason?`, `loginIp?`, `loginUserAgent?` | `@@index([userId, loginTime desc])`, `@@index([sessionStatus])`, `@@index([loginTime])` | `user` **Cascade** |
| `UsageRecord` → `usage_records` | `model`, `inputTokens`, `outputTokens`, `thinkingTokens`, `cacheCreationTokens`, `cacheReadTokens`, `conversationId?`, `requestDurationMs?` (all Int) | `@@index([userId])`, `@@index([createdAt])`, `@@index([userId, createdAt])`, `@@index([model])` | `user` **Cascade** |
| `enum SessionStatus` → `session_status` | `ACTIVE`, `CLOSED_LOGOUT`, `CLOSED_IDLE`, `CLOSED_ADMIN`, `CLOSED_EXPIRED` | — | — |

`UserSessionLog` is the REQ-02 audit trail written by [session-audit.ts](./session-audit.md).
Note it stores a **hash** of the session token, while the live `sessions.token` is
**plaintext** — the reconciler bridges the two by hashing the plaintext at query time.

### CMF master-data loader (5 models + 2 enums)

| Model → table | Key fields | Notable indexes | Cascade behaviour |
|---|---|---|---|
| `Package` → `cmf_packages` | `cmfId @unique`, `checksum`, `sizeBytes` BigInt, `contentType`, `createdByUserId`, `lastResult?`, `lastOperation?`, `lastRunAt?` | `@@index([createdAt])` | `createdBy` (**no** onDelete → Restrict) |
| `StagedUpload` → `cmf_staged_uploads` | `s3Key`, `status` (`UPLOADED`→`VALIDATED`→`REGISTERED`→`LOADED`), `packageName?`, `packageCmfId?`, `selectedTypes` Json? | `@@index([userId])`, `@@index([status])` | `user` **Cascade** |
| `PackageFile` → `cmf_package_files` | `packageId @unique`, `s3Key` | — | `package` (default Restrict) |
| `ValidationReport` → `cmf_validation_reports` | `packageId`, `ok`, `errorCount`, `warningCount`, `report` Json, `advisory` Json? | `@@index([packageId])` | `package` (default Restrict) |
| `Run` → `cmf_runs` | `packageId`, `userId`, `operation` enum, `status` enum (default `QUEUED`), `cmfBaselineEndDate?`, `selectedTypes` Json, `result?`, `log` Json?, `error?`, `startedAt`, `endedAt?` | `@@index([packageId])`, `@@index([startedAt])` | `package`, `user` (**no** onDelete → Restrict) |
| `enum Operation` → `cmf_operation` | `VALIDATE`, `LOAD` | — | — |
| `enum RunStatus` → `cmf_run_status` | `QUEUED`, `RUNNING`, `SUCCESS`, `FAILURE`, `EXPIRED` | — | — |

CMF audit reuses the shared `audit_logs` table (`action = "cmf.*"`); the original
cmf-loader `AuditEvent` model was intentionally **not** ported (schema comment).

> **Model count:** Admin = **21 models + 3 enums**; Fab = **20 models + 3 enums**
> (identity 5, chat/memory 4, MCP 2/1, config 2, audit+usage 3, CMF 5).

---

## Raw-SQL-only tables (NOT in Prisma) — definitive DDL provenance

These tables are accessed **only** through `$queryRawUnsafe` / `$executeRawUnsafe` in the
audit modules. They appear in **no** Prisma schema and — the key finding of this page —
**their `CREATE TABLE` / `CREATE TYPE` DDL does not exist anywhere in this repository.** A
repo-wide search finds `CREATE TABLE` in exactly the 5 SQL files, and none of those five
create an audit table. The only audit reference in any SQL file is one `ALTER TABLE
"prompt_audit_logs" ADD COLUMN ...`, which **assumes the table already exists**.

Legend: **Prisma-managed** = created by `prisma db push`/`migrate` from a Prisma model.
**Dual** = both a Prisma model *and* a `CREATE TABLE` in a `*.sql` file. **Out-of-band** =
neither — must be created by a script that is **not in this repo**.

| Table / type | (a) Prisma model? | (b) DDL in a `*.sql` file? | Verdict | Flagged by |
|---|---|---|---|---|
| `user_session_logs` | ✅ `UserSessionLog` (both) | ❌ | **Prisma-managed** | [session-audit.md](./session-audit.md) |
| `session_status` (enum) | ✅ `SessionStatus` | ❌ | **Prisma-managed** | [session-audit.md](./session-audit.md) |
| `prompt_audit_logs` | ❌ | ⚠️ **ALTER only** (`ADD COLUMN model` in `alter_audit_compliance.sql`) — **no CREATE** | **OUT-OF-BAND** | [prompt-audit.md](./prompt-audit.md) |
| `prompt_audit_daily_counter` | ❌ | ❌ | **OUT-OF-BAND** | [prompt-audit.md](./prompt-audit.md) |
| `prompt_audit_status` (enum) | ❌ | ❌ | **OUT-OF-BAND** | [prompt-audit.md](./prompt-audit.md) |
| `error_audit_logs` | ❌ | ❌ | **OUT-OF-BAND** | [error-audit.md](./error-audit.md) |
| `error_audit_daily_counter` | ❌ | ❌ | **OUT-OF-BAND** | [error-audit.md](./error-audit.md) |
| `error_audit_status` (enum) | ❌ | ❌ | **OUT-OF-BAND** | [error-audit.md](./error-audit.md) |
| `error_catalog` | ❌ | ❌ | **OUT-OF-BAND** | [error-catalog-loader.md](./error-catalog-loader.md) |
| `model_registry` | ✅ `ModelRegistry` (both) | ✅ `create_model_registry.sql` (+ seeds 3 rows) | **Dual** | [model-registry.md](./model-registry.md) |
| `mcp_registry` | ✅ `McpRegistry` (**Admin only**) | ⚠️ **ALTER only** (`alter_mcp_registry.sql` adds cols) — **no CREATE** | **Prisma-managed (Admin) + ALTER** | — |
| `platform_settings` | ✅ `PlatformSettings` (both) | ✅ `create_platform_settings.sql` (+ `alter_audit_compliance.sql`) | **Dual** | — |
| CMF tables (`cmf_packages`, `cmf_staged_uploads`, `cmf_package_files`, `cmf_validation_reports`, `cmf_runs`) + `cmf_operation`/`cmf_run_status` enums | ✅ (both) | ✅ `create_cmf_dataloader.sql` | **Dual** | — |

**Bottom line:** 9 database objects — `prompt_audit_logs`, `prompt_audit_daily_counter`,
`prompt_audit_status`, `error_audit_logs`, `error_audit_daily_counter`,
`error_audit_status`, `error_catalog` — have **no DDL in this repo at all.** In a fresh
environment, neither `prisma db push` (they're not models) nor the 5 SQL scripts (they
don't create them) will produce them. Whatever creates them lives outside the repo.

### What each out-of-band table needs (inferred from the SQL the code runs)

- **`prompt_audit_logs`** — columns the code writes/reads: `id, prompt_id, datetime,
  user_id, user_name, user_email, user_prompt, topic_matched, query_executed,
  data_retrieved, llm_response, response_time_ms, status, model, tool_calls (jsonb),
  request_tokens, retrieval_tokens, response_tokens, request_cost, retrieval_cost,
  response_cost`. `status` is cast to a **`prompt_audit_status`** enum
  (`PENDING`/`SUCCESS`/`FAILED`/`TIMEOUT`/`CANCELLED`). The cost columns read back as
  **strings** in TypeScript → they are PostgreSQL **NUMERIC** (unlike `model_registry`,
  whose costs are DOUBLE PRECISION).
- **`error_audit_logs`** — `id, error_id, error_uuid, error_type, user_id, datetime,
  user_message, technical_message, priority, status (error_audit_status:
  OPEN/RESOLVED), route, http_method, http_status, stack_preview, request_context (jsonb),
  created_at, resolved_by, resolved_at, resolution_note`.
- **`prompt_audit_daily_counter`** / **`error_audit_daily_counter`** — `(counter_date,
  last_seq)`. The human ID generators (`PRO-YYYYMMDD-NNNN`, `ERR-YYYYMMDD-NNNN`) do
  `INSERT ... ON CONFLICT (counter_date) DO UPDATE ...`, so **`counter_date` must carry a
  UNIQUE/PK constraint** or the atomic counter breaks.
- **`error_catalog`** — `error_type, user_message, priority, http_status`
  ([error-catalog-loader.md](./error-catalog-loader.md) reads these four columns).

---

## Fab-vs-Admin `schema.prisma` diff

The two files are **structurally near-identical**. Ignoring header/inline comments and
whitespace, exactly **one** difference matters:

| Difference | Admin (source of truth) | Fab (mirror) | Consequence |
|---|---|---|---|
| **`McpRegistry` model / `mcp_registry` table** | **Present** (21st model) | **Absent** (20 models) | Fab has **no typed access** to `mcp_registry`. Fab reaches admin-assigned MCPs only through `mcp_connections.registryId`; it can never `prisma.mcpRegistry.*`. Confirmed: Fab has zero `mcp_registry`/`McpRegistry` references anywhere. |

Everything else is byte-for-byte equivalent in **field definitions**: `User` (including
`status`, `forcePasswordChange`, `isAdmin`, `roleId`), `Session`, `Conversation`, `Message`,
`Artifact`, `McpConnection` (including `registryId`), `MemoryFile`, `PasswordResetToken`,
`Invitation`, `AuditLog`, `UserSessionLog`, `UsageRecord`, `PlatformSettings`,
`ModelRegistry`, all 5 CMF models, and all 3 enums are identical in both. Non-structural
differences: the header comment, section banners, and per-field inline comments differ
(Admin's are richer).

**Why this is the integration risk:** the field-level parity is maintained **by hand** —
there is no generator keeping the mirror in sync. Any column Admin adds/renames but forgets
to mirror will make Fab's generated client wrong. This is exactly why
[auth-middleware.ts](./auth-middleware.md) reads `status`/`forcePasswordChange` through
`as`-casts rather than typed fields ([03 row 3](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)):
Fab's client can lag the shared columns and the cast hides the drift.

---

## The five raw-SQL migrations (`admin_athena/prisma/*.sql`)

All are commented "additive, non-destructive, idempotent" and are meant to be run with
`psql "$DATABASE_URL" -f <file>` against the shared DB. There is **no Fab equivalent**
(`claudeai_athena/prisma/` contains only `schema.prisma` — no `*.sql`, no `seed.ts`).

| File | Creates | Alters | Enums |
|---|---|---|---|
| `create_platform_settings.sql` | `platform_settings` (id, color_theme, updated_by_id, updated_at) + seeds the `'global'` singleton row `ON CONFLICT DO NOTHING` | — | — |
| `create_model_registry.sql` | `model_registry` (+ unique index on `model_id`, indexes on `is_active`/`sort_order`) + seeds **3 models** (`claude-opus-4-7` "FabOrchestrator 1.0", `claude-sonnet-5` "1.1", **`claude-opus-4-8` "FabOrchestrator 2.0" = default**) `ON CONFLICT (model_id) DO NOTHING` | — | — |
| `alter_mcp_registry.sql` | — | `mcp_registry` ADD `description`, `auth_credentials_encrypted`, `is_active`, `updated_at`; `mcp_connections` ADD `registry_id` + index. **Does not CREATE `mcp_registry`** (assumes the Prisma-created table exists) | — |
| `alter_audit_compliance.sql` | ensures `platform_settings` exists (CREATE IF NOT EXISTS) | `prompt_audit_logs` ADD `model`; `platform_settings` ADD `audit_retention_days` default 90. **The `prompt_audit_logs` ALTER assumes the table already exists** — it does not create it | — |
| `create_cmf_dataloader.sql` | `cmf_packages`, `cmf_staged_uploads`, `cmf_package_files`, `cmf_validation_reports`, `cmf_runs` (+ indexes) | `conversations` ADD `agent` default `'chat'` | `cmf_operation`, `cmf_run_status` |

Note the seeded `model_registry` ids (`claude-opus-4-7`/`claude-sonnet-5`/`claude-opus-4-8`)
**do not match** the 7 legacy ids in the role templates' `allowedModels` (below) — a
model-id source-of-truth drift, related to [03 §6 / model-pricing](../03-review-hotspots.md#drift-hazards-multiple-copies-of-the-same-truth).

---

## Seed contents (`admin_athena/prisma/seed.ts`)

Run via `npm run db:seed` (or `npx tsx prisma/seed.ts`) with `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
`ADMIN_NAME` env vars (or interactively). Three phases, all idempotent:

1. **Roles** — creates the 3 `ROLE_TEMPLATES` (from `lib/constants/role-templates.ts`),
   skipping any that already exist:
   - **Admin** — `isSystemRole`, permissions `[admin, chat, mcp, artifacts, file_upload,
     web_search]`, `allowedModels = ALL_MODELS` (7 legacy ids), no limits.
   - **Business User** — permissions `[chat, artifacts, file_upload]`, 3 sonnet/haiku
     models, no limits.
   - **Operator User** — same permissions, but `dailyRequestLimit = 100`,
     `dailyTokenLimit = 200000`.
   (Note: `ALL_PERMISSIONS` includes `modeling_agent`, but **no** seeded role grants it.)
2. **Admin user** — creates a `User` with `isAdmin=true`, `status='ACTIVE'`, `roleId` = the
   Admin role (or upgrades an existing user of that email to admin). Password hashed via
   `hashPassword` (scrypt).
3. **MCP registry** — upserts **10** endpoints into `mcp_registry` (`authType='none'`), all
   `*.execute-api.us-west-2.amazonaws.com/mcp`: CMF – Critical Manufacturing, CM MES –
   Assembly, CM MES – Lab Data, Opcenter – Siemens, Opcenter – CoreSi, PSI Quantum,
   Lumentum Server, Genealogy, Bottleneck Analysis, Scrap Pareto. (These are the same
   real endpoints named in the CMF/scenario docs.)

---

## Cross-app fields, cascade & soft-delete behaviour

### Cross-app fields (Admin writes, Fab reads) — all on `users`

| Column | Written by | Read by Fab in | Effect |
|---|---|---|---|
| `status` (`ACTIVE`/`SUSPENDED`/`DELETED`) | Admin ([admin-user-service.md](./admin-user-service.md)) | [auth-middleware.md](./auth-middleware.md) `requireAuth` (via `as`-cast) | `SUSPENDED`/`DELETED` → 403 "Account is no longer active" |
| `forcePasswordChange` | Admin (reset flow) | [auth-middleware.md](./auth-middleware.md) `requireAuth` (via `as`-cast) | 403 `FORCE_PASSWORD_CHANGE` → redirect to `/force-password-change` |
| `isAdmin` | Admin seed / `admin-tools` | Admin `requireAdmin` (typed) | admin gate |
| `roleId` | Admin ([role-service], invites) | Fab chat gate (permissions/allowedModels/limits via `Role`) | per-request RBAC |

These fields are why a `User`-model column rename is a **cross-app breaking change**
([04 §4.4](../04-architecture-and-integration.md)).

### Cascade-delete graph

Explicit `onDelete: Cascade` fans out from **User** and **Conversation**:

```
User ─┬─Cascade─> Session
      ├─Cascade─> Conversation ─Cascade─> Message ─Cascade─> Artifact
      │                        └─Cascade─────────────────────> Artifact
      ├─Cascade─> Artifact (also parented by message & conversation)
      ├─Cascade─> McpConnection
      ├─Cascade─> MemoryFile
      ├─Cascade─> UserSessionLog
      ├─Cascade─> UsageRecord
      └─Cascade─> StagedUpload (cmf_staged_uploads)
```

**Not** cascaded from User (important — this makes a hard `deleteUser` only *partly* a
"delete everything"):
- `AuditLog.user` = **SetNull** (audit rows survive, `user_id` nulled).
- `Package.createdBy`, `Run.user`, `Run.package`, `PackageFile.package`,
  `ValidationReport.package` = **no `onDelete`** → default **Restrict**. A user who created
  a CMF package or run **cannot be hard-deleted** without first removing those rows; the DB
  will raise an FK violation.
- `Invitation.role`/`invitedBy`, `McpConnection.role`, `User.role` = optional/no-cascade.

In practice Fab never hard-deletes users ([storage.md](./storage.md) `deleteUser` is dead
code); Admin's delete is a **soft** status change.

### Soft-delete columns (nothing purges them)

- **`users.status = 'DELETED'`** — a soft delete; the row and all its cascaded children
  remain. Auth blocks the login; the data stays.
- **`conversations.deletedAt`** — set by [storage.md](./storage.md) `deleteConversation`.
  The `onDelete: Cascade` chain only fires on a *hard* delete, which nothing performs, so
  the messages/artifacts stay in the DB **and remain readable by id** (message/artifact
  reads don't filter the parent's `deletedAt`).

No scheduled job purges either — see [storage.md](./storage.md) and the un-scheduled
retention note in [03 §6](../03-review-hotspots.md).

---

## Failure modes & gotchas

- **Nine audit objects have no DDL in the repo (the headline).** `prompt_audit_logs`,
  `prompt_audit_daily_counter`, `prompt_audit_status`, `error_audit_logs`,
  `error_audit_daily_counter`, `error_audit_status`, `error_catalog` are neither Prisma
  models nor created by any `*.sql`. **In a fresh environment they will not exist.** Then:
  every prompt/error-audit write silently fails (the modules wrap all raw SQL in
  `try/catch {}` and swallow — REQ-03/04 audit just goes dark), and `error_catalog` reads
  fail so error rendering falls back to the hardcoded `FABORCH_ERROR_CATALOG`
  ([error-catalog-loader.md](./error-catalog-loader.md)). Nothing surfaces the miss except
  CloudWatch. This contradicts the wording in the catalog/architecture docs — see
  [discrepancy note](#discrepancy-vs-catalogarchitecture-wording).
- **Counter tables need a UNIQUE constraint the repo can't guarantee.** `nextPromptId`/
  `nextErrorId` rely on `ON CONFLICT (counter_date)`. If the out-of-band DDL forgets the
  unique/PK on `counter_date`, ID generation throws on the very first concurrent insert
  ([03 row 6](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)).
- **Plaintext token columns.** `sessions.token`, `invitations.token`, and
  `password_reset_tokens.token` are all stored **unhashed** (each `@unique`). This is
  load-bearing: [session-audit.ts](./session-audit.md)'s reconciler matches live sessions by
  `encode(sha256(token),'hex')` against `user_session_logs.session_token_hash`, which only
  works while `sessions.token` stays plaintext. Hash the token and the reconciler silently
  stops deleting stale sessions ([storage.md](./storage.md),
  [invitation-service.md](./invitation-service.md)).
- **Fab/Admin drift is hand-maintained.** No tooling keeps Fab's mirror in sync with the
  Admin source. The known live gap is `McpRegistry` (Admin-only). The known coping
  mechanism is auth-middleware's `as`-casts. A future silent drift is the standing risk.
- **Mixed cost column types.** `model_registry` costs are `Float`/DOUBLE PRECISION; the
  `prompt_audit_logs.*_cost` columns are NUMERIC (returned as strings). Two conventions for
  "money" across the schema — relevant to anyone reconciling billing
  ([model-pricing / 03 §6](../03-review-hotspots.md#drift-hazards-multiple-copies-of-the-same-truth)).
- **Model-id sources disagree.** The `model_registry` seed uses
  `claude-opus-4-7/…-sonnet-5/…-opus-4-8`; the role templates' `allowedModels` use 7
  *older* ids (`claude-opus-4-6`, `claude-sonnet-4-5-…`, etc.); `storage.ts` hardcodes
  `claude-opus-4-8`. Four sources of model-id truth.
- **`sessions.token` is doubly indexed, not missing an index.** It has both `@unique` and a
  redundant `@@index([token])`. Not a bug, but worth knowing when reviewing "hot lookup"
  indexes — the real un-verifiable index is the counter tables' `counter_date` constraint
  (no DDL).
- **Singleton `PlatformSettings`** relies on the literal PK `"global"`; any code inserting
  a second row would violate the intent silently (nothing enforces "exactly one row" beyond
  the fixed PK + `ON CONFLICT DO NOTHING` seeds).

### Discrepancy vs catalog/architecture wording

- ✅ **[03 §1 row 6](../03-review-hotspots.md) is correct** — it says `error_audit_daily_counter`
  has "**no DDL for it found in this repo**." This page confirms and extends that to all 7
  audit objects.
- ⚠️ **[03 row 25](../03-review-hotspots.md), [04 §4.6](../04-architecture-and-integration.md),
  and the root `CLAUDE.md`** say the audit tables "exist **only via** the additive SQL
  migrations" / "are only in `prisma/*.sql`." **Statically this is inaccurate:** no `*.sql`
  file in the repo creates any audit table (only one `ALTER` touches `prompt_audit_logs`,
  assuming it pre-exists). The precise statement is: the audit tables are in **neither**
  Prisma **nor** the SQL migrations — they are created out-of-band. The other rows'
  enumerations of *which* tables are raw-SQL-only are otherwise correct. Recommend
  correcting those three docs' wording. This does not change any conclusion about the
  Prisma models themselves.

## Open questions for the code owner

1. **Where is the DDL for `error_audit_logs`, `prompt_audit_logs`, the two
   `*_daily_counter` tables, `error_catalog`, and the `error_audit_status`/
   `prompt_audit_status` enums?** It is not in this repo. Is there an out-of-band script,
   and does it include the `UNIQUE(counter_date)` the ID generators require? (Blocks a fresh
   environment from having working REQ-03/04 audit.)
2. Should these audit tables be promoted to Prisma models (or at least checked-in `*.sql`)
   so a fresh env is reproducible from the repo — matching the "source of truth" claim?
3. Is the **hand-maintained** Fab mirror acceptable long-term, or should Fab regenerate its
   client from the Admin schema in CI so drift (like the missing `McpRegistry`) becomes a
   build failure rather than a runtime `as`-cast?
4. Confirm the **plaintext** `sessions.token` / `invitations.token` /
   `password_reset_tokens.token` are intentional and that no plan hashes them without also
   updating the session-audit reconciler ([session-audit.md](./session-audit.md)).
5. Is the **Restrict** on `cmf_packages.created_by_user_id` / `cmf_runs.user_id`
   (blocking hard-deletion of a user with CMF history) intended, given Admin only
   soft-deletes anyway?
6. Should soft-deleted `conversations` (and `users.status='DELETED'`) ever be purged, and
   should message/artifact reads honour the parent `deletedAt`? (Retention / data-remanence.)
7. The `model_registry` seed ids don't match the role templates' `allowedModels` — which is
   authoritative for the RBAC model gate?

## Both-apps note

This *is* the both-apps contract. One physical database; two Prisma clients generated from
two files. **Admin's `schema.prisma` is authoritative**; Fab's is a mirror that is
identical except it **omits `McpRegistry`**. The 5 SQL migrations and the seed live **only**
in Admin (`claudeai_athena/prisma/` has just `schema.prisma`). A change here is a cross-app
change by definition: Admin writes config (`model_registry`, `roles`, `mcp_registry`,
`platform_settings`, `users.status/roleId/…`), Fab reads it and writes audit/usage
(`user_session_logs`, `usage_records`, plus the out-of-band `error_audit_logs` /
`prompt_audit_logs`).

**Sibling pages:** [storage](./storage.md) · [auth-middleware](./auth-middleware.md) ·
[admin-user-service](./admin-user-service.md) · [invitation-service](./invitation-service.md) ·
[session-audit](./session-audit.md) · [prompt-audit](./prompt-audit.md) ·
[error-audit](./error-audit.md) · [error-catalog-loader](./error-catalog-loader.md) ·
[model-registry](./model-registry.md)
