# 1 — File-by-File Catalog

> Version: commit `abe8706` on `main` (re-verified 2026-07-22; originally written at
> `7976c78`). See [README](./README.md).
> Validation: 🔵 Static (each file was read by an analysis pass). The **Review priority**
> column tells you which rows a human code-owner must verify — see the
> [Review Hotspots](./03-review-hotspots.md) doc for the consolidated action list.

**How to use:** search for a filename. Each row gives its purpose, key exports, side
effects (DB / raw SQL / network / crypto / none), who consumes it, and a review priority.
Entry-point files (`route.ts`, `page.tsx`) are catalogued in
[02 — Entry Points](./02-entry-points.md); this document covers the **libraries and
supporting code**.

**Review priority legend:** **High** = security, money, data-integrity, destructive, or
raw-SQL — verify carefully. **Med** = behavioral contract or moderate risk. **Low** =
pure helper/formatter, low risk.

---

# Part A — Fab app (`claudeai_athena`)

## A.1 `lib/` core (24 files)

| File | Purpose | Key exports | Side effects | Consumed by | Review |
|------|---------|-------------|--------------|-------------|--------|
| `anthropic.ts` | Anthropic AI-SDK provider; variant injects `container_upload` blocks via custom fetch | `anthropic`, `createAnthropicWithContainerUploads`, `forwardAnthropicContainerIdFromLastStep` | Network (Anthropic) | `/api/chat` | Med |
| `anthropic-files.ts` | Lazy singleton `@anthropic-ai/sdk` client for Files API | `getAnthropicFilesClient` | Network | `/api/files/*` | Low |
| `artifact-parser.ts` | Regex parser: `<antArtifact>` tags → artifact objects/segments | `extractTagArtifacts`, `segmentMessageText` | none (pure) | message renderer | Med |
| `artifacts.ts` | Artifact type/Zod schema + extension/MIME helpers | `ARTIFACT_TYPES`, `ArtifactSchema`, `createFileArtifact` | none | parser, storage, viewers | Low |
| [`auth-middleware.ts`](./files/auth-middleware.md) | Session validation + route guards; idle-eviction, status/force-password checks | `validateSession`, `requireAuth`, `withAuth` | DB r/w | ~all `/api/*` | **High** |
| [`context-window.ts`](./files/context-window.md) | Two-phase trim to keep msgs < 200K; tool-pair repair | `fitMessagesToContextWindow` (+6 more) | none (pure) | `/api/chat` | **High** |
| [`db.ts`](./files/db.md) | Prisma singleton over `pg` Pool (**SSL disabled**) | `prisma` | DB pool init | all storage/audit | **High** |
| [`encryption.ts`](./files/encryption.md) | AES-256-GCM + scrypt password hash/verify + token gen | `encrypt`, `decrypt`, `hashPassword`, `verifyPassword`, `generateToken` | Crypto | auth routes, mcp-client | **High** |
| `enforce-light.ts` | Injects CSS to force artifacts to light mode | `enforceLightHtml` | none | artifact renderer | Low |
| `file-classifier.ts` | filename/MIME → render strategy | `classifyFile`, `isPreviewableFile` | none | artifacts, viewers | Low |
| `file-utils.ts` | Size/label/MIME helpers | `formatFileSize`, `inferMimeType` | none | components | Low |
| `language-aliases.ts` | Syntax-highlight alias map | `normalizeLanguage` | none | code-block | Low |
| `logger.ts` | Structured JSON logger w/ FabOrchError support | `logger`, `Logger` | stdout/stderr | app-wide | Low |
| [`mcp-client.ts`](./files/mcp-client.md) | MCP tool discovery + execution (JSON-RPC/SSE) w/ session refresh | `executeMcpTool`, `loadActiveMcpToolsWithDescriptions`, `convertMcpToolsToAiTools` | Network, DB r/w, crypto | `/api/chat` only (`/api/mcp/*` duplicates the protocol inline, no import) | **High** |
| [`model-pricing.ts`](./files/model-pricing.md) | Hardcoded per-model USD rates + turn cost math | `costForTurn`, `costForTurnWithRates`, `hasPricing`, `costForTurnAsync` (unused) | DB read (async variant, dead) | chat route (costs then flow to prompt-audit) | **High** |
| [`model-registry.ts`](./files/model-registry.md) | Cached loader of `model_registry` table (fail-safe) | `getRegistryModels`, `getRegistryRates`, `getAllowedModelIds`, `getThinkingConfig` (+2 unused) | DB read, TTL cache | pricing, chat, model routes | **High** |
| [`prompt-audit.ts`](./files/prompt-audit.md) | REQ-04 prompt/response audit (**raw SQL**) + topic classifier | `recordPromptStart/Success/Failure`, `classifyTopic`, `queryPromptAudit` | DB r/w, raw SQL | `/api/chat`, admin views | **High** |
| [`s3-upload.ts`](./files/s3-upload.md) | Uploads user files to private S3, returns presigned GET URLs | `uploadUserFileToS3`, `presignKey` | S3 | `/api/chat` | **High** |
| `sandpack-deps.ts` | Detects npm deps + TS from React artifact source | `detectDependencies`, `extractImports` | none | sandpack-preview | Med |
| [`session-audit.ts`](./files/session-audit.md) | REQ-02 session lifecycle (login/logout/idle/reconcile, **raw SQL**) | `recordLogin`, `recordLogout`, `checkAndRecordActivity`, `reconcileStaleActiveSessions` | DB r/w, raw SQL, crypto | auth-middleware, login, logout, chat | **High** |
| [`storage.ts`](./files/storage.md) | Prisma CRUD layer (users/sessions/convos/messages/artifacts/MCP/memory) | 41 fns incl. `getSessionByToken`, `addMessage`, `getConversation` | DB r/w | 18 Fab files (no ownership checks — callers enforce) | **High** |
| `system-prompts.ts` | Builds base + tool-aware system prompt (artifacts/audience/error rules) | `getSystemPrompt`, `buildSystemPromptWithTools` | none | `/api/chat` | Med |
| `utils.ts` | Tailwind `cn` helper | `cn` | none | UI | Low |
| `validation.ts` | Zod schemas for all API bodies + validate helpers | `LoginSchema`, `ChatRequestSchema`, `validate`, `validateOrThrow` | none | all `/api/*` | Med |

## A.2 `lib/errors/` — FabOrch error/audit subsystem (REQ-01, REQ-03) (9 files)

| File | Purpose | Key exports | Side effects | Review |
|------|---------|-------------|--------------|--------|
| `error-catalog-defaults.ts` | Frozen fallback catalog + enums (10 error types) | `FabOrchErrorType`, `FABORCH_ERROR_CATALOG`, `ROW_CAP_LIMIT` | none | Med |
| [`error-catalog-loader.ts`](./files/error-catalog-loader.md) | Reads `error_catalog` from RDS, TTL-cache, fallback on failure | `getErrorEntry`, `reloadErrorCatalog` | DB read (raw SQL) | **High** |
| `faborch-errors.ts` | `FabOrchError` class + 10 static factories | `FabOrchError`, `isFabOrchError` | indirect DB read (ctor) | **High** |
| [`api-error-handler.ts`](./files/api-error-handler.md) | Classifies any thrown value → `FabOrchError`, logs, persists, HTTP envelope | `handleApiError`, `withErrorHandling`, `classifyError` | async DB write, logs | **High** |
| [`error-audit.ts`](./files/error-audit.md) | REQ-03 persistence + `ERR-YYYYMMDD-NNNN` id + admin query/resolve/purge | `recordError`, `queryErrorAudit`, `markErrorResolved`, `purgeOldErrors` | DB r/w, raw SQL | **High** |
| `client.ts` | Browser mirror: parse fetch responses into envelopes | `parseOrThrow`, `extractFabOrchMessage`, `readRowCapWarning` | none | Med |
| `parameter-values.ts` | REQ-01 valid-option registry (static + DB) | `listParameterValues`, `rejectInvalidParameter`, `ALLOWED_MODELS` | DB read | Med |
| `row-cap.ts` | 1000-row soft cap + limit clamp | `applyRowCap`, `clampLimit` | none | Low |
| [`sql-guard.ts`](./files/sql-guard.md) | DDL/DML guard (read-only SQL allow-check) — **currently unused** | `isReadOnlySql`, `assertReadOnlySql` | none | Med |

## A.3 CMF loader subsystem — `lib/cmf/`, `lib/chat-cmf/`, `lib/repo-cmf/` (20 files)

**Three layers:** `lib/cmf` = low-level MES integration (REST/SQL/auth/S3); `lib/chat-cmf` =
the Modeling Agent's AI tool belt; `lib/repo-cmf` = the app-side Postgres repository.

| File | Layer | Purpose | Side effects | Review |
|------|-------|---------|--------------|--------|
| [`cmf/cmf-auth.ts`](./files/cmf-auth.md) | cmf | Fetch/cache MES JWT from AWS Secrets Manager (`cmf/mes-token`) | Secrets Manager | **High** |
| [`cmf/cmf-client.ts`](./files/cmf-client.md) | cmf | 6 CMF REST calls + polling + prepare/execute/**load**; installs global undici dispatcher (custom DNS + TLS-insecure) | Network (VPN), global fetch mutation | **High** |
| [`cmf/types.ts`](./files/cmf-types.md) | cmf | CMF wire types + **inverted operation enum** (0=Load, 1=Validate) | none | **High** |
| `cmf/cmf-sql.ts` | cmf | Read-only pooled mssql conn to CMF SQL Server | Raw SQL (VPN) | Med |
| `cmf/s3-object.ts` | cmf | Private S3 storage for uploaded master-data files | S3 | Med |
| `cmf/audit.ts` | cmf | Append-only `cmf.*` rows into shared `audit_logs` | DB | Low |
| `cmf/cmf-errors.ts` | cmf | Map CMF error codes → friendly messages | none | Low |
| `cmf/client-auth.ts` | cmf | Browser fetch wrapper injecting bearer token | none (client) | Low |
| `cmf/run-completion.ts` | cmf | Pure: has an open run completed? | none | Low |
| `cmf/session.ts` | cmf | Bearer-session shim → user id | none | Low |
| [`chat-cmf/tools.ts`](./files/chat-cmf-tools.md) | chat-cmf | **AI Modeling Agent tool belt** incl. `loadToCmf` (commit tool — **excluded from the model at this commit**, no code gate inside) | DB, S3, **network commit** | **High** |
| [`chat-cmf/load-preview.ts`](./files/validation-cmf-queries.md) | chat-cmf | Per-row CREATE/UPDATE/SKIP/CONFLICT preview before load | Raw SQL (CMF read) | Med |
| [`chat-cmf/lookup-existing.ts`](./files/validation-cmf-queries.md) | chat-cmf | Look up existing CMF rows by Name (`select *`) | Raw SQL (CMF read) | Med |
| [`chat-cmf/prefill.ts`](./files/validation-cmf-queries.md) | chat-cmf | DB-validate loose rows per-cell for the entry form | Raw SQL (CMF read) | Med |
| `chat-cmf/object-types.ts` | chat-cmf | Pure fuzzy match text → object-type key | none | Low |
| `repo-cmf/validation.ts` | repo-cmf | Staged-upload + package-file + validation-report repo (S3 + PG) | DB + S3 | Med |
| `repo-cmf/packages.ts` | repo-cmf | Local mirror of CMF packages + history | DB | Med |
| `repo-cmf/runs.ts` | repo-cmf | Run lifecycle + one-in-flight concurrency guard | DB | Med |
| `repo-cmf/reconcile.ts` | repo-cmf | Close open run when CMF reports completion | DB | Med |
| `repo-cmf/stats.ts` | repo-cmf | Dashboard aggregates | DB (raw, fixed) | Low |

## A.4 `lib/validation/` — deterministic Excel validation engine (17 files)

Pipeline: **structure/template** (`template-check`, `structure-check`, pure) → **row rules**
(`rule-engine` R1–R6, the hard gate) → **referential/parent** (`referential`,
`parent-precheck`, file + live CMF) → **cross-check** (`cross-check`, CMF round-trips).
`validate.ts::validateFile` orchestrates. `generate-xlsx`/`ksp-skeleton` *build* files.

| File | Purpose | Side effects | Review |
|------|---------|--------------|--------|
| `validate.ts` | Top-level orchestrator: parse → rules → cross-checks | reads .xlsx, calls CMF | **High** |
| [`rule-engine.ts`](./files/rule-engine.md) | Deterministic gate R1–R6 (required/length/numeric/bool/regex/FK) — **many failures downgraded to warnings; no live caller found at this commit** | none (pure) | **High** |
| [`metadata.ts`](./files/validation-cmf-queries.md) | Load per-object CMF ruleset; resolve physical table | calls CMF | **High** |
| [`referential.ts`](./files/validation-cmf-queries.md) | Build parent-existence resolver (file + batched CMF) — **unwired at this commit** | calls CMF | **High** |
| [`parent-precheck.ts`](./files/validation-cmf-queries.md) | Verify each FK resolves in parent's live CMF table or payload — **unwired at this commit** | calls CMF | **High** |
| [`cross-check.ts`](./files/validation-cmf-queries.md) | CMF round-trip exists/update/no-op + dependent-sheet checks — **unwired at this commit** | calls CMF | **High** |
| [`validate-rows.ts`](./files/validation-cmf-queries.md) | File-less rule run over in-memory rows (chatbot path) — **unwired at this commit** | calls CMF | **High** |
| `ksp-skeleton.ts` | Prune a real CMF skeleton via JSZip + regex to build workbooks | reads file | **High** |
| `generate-xlsx.ts` | Build loader-conformant .xlsx from rows + self-verify | in-memory ExcelJS | Med |
| `template-check.ts` | Streaming ExcelJS conformance vs `template-schema.json` | reads .xlsx (temp file) | Med |
| `xlsx.ts` | Non-streaming ExcelJS parser → `ParsedSheet[]` | reads .xlsx | Med |
| `structure-check.ts` | Structural + in-file referential (order checks disabled) | none | Med |
| `llm-advisor.ts` | Advisory (non-blocking) LLM explanations of errors | calls Anthropic | Med |
| `composition.ts` | Group parent object type with sub-sheets | none | Low |
| `system-columns.ts` | Canonical CMF auto-filled columns | none | Low |
| `removal-policy.ts` | Client `template-overrides.json` blacklist reader | none | Low |
| `types.ts` | Shared types | none | Low |

## A.5 `hooks/` (8 files)

| File | Purpose |
|------|---------|
| `use-file-content.ts` | Files-API content caching |
| `use-smooth-streaming.ts` | Smooth token-by-token render |
| `use-idle-timeout.tsx` | Client idle warning → session banner/modal |
| `use-keyboard-shortcuts.tsx` | Keyboard shortcuts |
| `use-execution-run.ts` | Poll a CMF run's status |
| `use-polling.ts` | Generic polling helper |
| `use-dark-mode.ts` | Theme toggle |
| `use-mobile.tsx` | Responsive breakpoint |

## A.6 `components/` (77 files) — grouped

UI is not individually catalogued (low risk); grouped by folder:

| Group | Files | Purpose |
|-------|------:|---------|
| root | `full-chat-app.tsx` (main chat UI, ~86KB), `login-page.tsx`, `settings-modal.tsx`, `sandpack-preview.tsx`, `artifact-preview.tsx`, `session-*`, `providers.tsx`, `error-boundary.tsx` | Top-level chat surfaces |
| `agent-chat/` | 2 | Modeling Agent chat + access gate |
| `cmf/` | 9 | Loader wizard, entry form, execution-log viewer, step progress |
| `cockpit/` | 6 | Landing dashboard (`/home`) |
| `mcp/` | 2 | MCP add dialog + connection card |
| `prompt-kit/` | 16 | Message/markdown/code-block/tool/reasoning render primitives |
| `viewers/` | 5 | PDF/DOCX/XLSX/PPTX/Mermaid document viewers. Since `abe8706` the XLSX viewer no longer parses client-side with SheetJS — `viewers/xlsx-viewer.tsx` delegates to `@extend-ai/react-xlsx` (via `ui/xlsx-viewer.tsx`) with a wasm parser served from `public/duke_sheets_wasm_bg.wasm` |
| `ui/` | 28 | shadcn/Radix wrappers (incl. `claude-style-chat-input.tsx`, ~39KB; new at `abe8706`: `popover.tsx`, `scroll-area.tsx`, `tabs.tsx`, `xlsx-viewer.tsx`) |

---

# Part B — Admin app (`admin_athena`)

## B.1 `lib/` (33 files incl. subfolders)

| File | Purpose | Side effects | Review |
|------|---------|--------------|--------|
| [`admin-tools.ts`](./files/admin-tools.md) | **31 AI chat tools = the admin API surface** (users/roles/mcp/audit/purge) | DB r/w, raw SQL, crypto, self-audit | **High** |
| `admin-system-prompt.ts` | System prompt: tool list + NL→tool mappings + anti-fabrication rules | none | Med |
| `anthropic.ts` | Anthropic provider factory | env read | Low |
| `artifacts.ts` | Artifact type/schema + helpers | none | Low |
| [`auth-middleware.ts`](./files/auth-middleware.md) | Session/Bearer validation; admin gate; **no idle eviction** | DB read, audit | **High** |
| [`db.ts`](./files/db.md) | Prisma singleton over pg Pool (**SSL disabled**) | DB | Med |
| [`encryption.ts`](./files/encryption.md) | AES-256-GCM + scrypt + token gen | crypto | **High** |
| `file-classifier.ts`, `file-utils.ts`, `language-aliases.ts`, `utils.ts` | Pure helpers | none | Low |
| `logger.ts` | Structured JSON logger | stdout | Low/Med |
| [`model-pricing.ts`](./files/model-pricing.md) | Per-model USD rates + cost math (**older snapshot — rates conflict with Fab's copy**) | none | **High** |
| [`prompt-audit.ts`](./files/prompt-audit.md) | REQ-04 prompt audit (raw SQL) + classifier | DB r/w, raw SQL | **High** |
| [`session-audit.ts`](./files/session-audit.md) | REQ-02 session audit; **reconciles stale end-user sessions on read** | DB r/w, raw SQL, crypto | **High** |
| `session-retention-worker.ts` | `setInterval` daemon purging logs >90 days | DB delete, timers | Med |
| `validation.ts` | Zod schemas + validate helpers | none | Med |
| `constants/role-templates.ts` | Seed role templates + model/permission lists | none | Low |
| [`email/smtp.ts`](./files/email.md) | Nodemailer transport + send (no-op when SMTP unset; callers log token links) | **SMTP** | **High** |
| [`email/invitation-template.ts`](./files/email.md) | Invite email HTML (unescaped `inviterName`/`roleName`) | none | Med |
| [`email/password-reset-template.ts`](./files/email.md) | Reset email HTML (unescaped `userName`) | none | Med |
| [`errors/api-error-handler.ts`](./files/api-error-handler.md) | Central error → classify → envelope + persist | DB write, logs | **High** |
| [`errors/error-audit.ts`](./files/error-audit.md) | REQ-03 error audit (raw SQL) + resolve/purge | DB r/w, raw SQL | **High** |
| `errors/faborch-errors.ts` | REQ-01 10-error catalog + `FabOrchError` | none | Med |
| `errors/client.ts`, `errors/row-cap.ts`, `errors/parameter-values.ts` | Client parse / row-cap / allowlist | some DB read | Low/Med |
| [`errors/sql-guard.ts`](./files/sql-guard.md) | Read-only SQL allow-check (**bypassable regex**; unused at runtime) | none | **High** |
| [`services/admin-user-service.ts`](./files/admin-user-service.md) | User CRUD: list/create/status/role/delete/force-reset/force-logout | DB tx, session delete, **SMTP**, audit | **High** |
| [`services/invitation-service.ts`](./files/invitation-service.md) | Invitation lifecycle + accept (mints session) | DB tx, **SMTP**, token | **High** |
| `services/role-service.ts` | Role CRUD w/ system-role & user-count guards | DB tx, audit | Med |
| `services/usage-service.ts` | Usage-limit checks + system usage summary | DB aggregate, raw SQL | Med |
| `services/audit-service.ts` | Audit-log write helpers + IP extract | DB write | Med |

> **Key design fact:** `services/*` is the shared business core used by **both** the REST
> routes **and** the admin chat tools. But several chat tools (`bulk_assign_role`,
> `add_mcp_to_role`, `remove_role_mcp`, the audit/purge tools) **bypass the service layer**
> and hit Prisma / raw SQL directly — so invariants and audit-logging enforced in services
> are not uniformly applied on the chat path. (Flagged in [hotspots](./03-review-hotspots.md).)

## B.2 `components/` (40 files) — grouped

| Group | Files | Purpose |
|-------|------:|---------|
| root | `admin-login-page.tsx`, `auth-branding-panel.tsx`, `session-expired-modal.tsx`, `providers.tsx` | Auth surfaces |
| `admin/` | 10 | Sidebar, page header, KPI card, analytics charts, user/role dialogs, data-loader dashboard |
| `prompt-kit/` | 8 | Chat render primitives (shared with Fab) |
| `ui/` | 18 | shadcn/Radix wrappers incl. `chart.tsx`, `confirm-dialog.tsx`, `toast.tsx` |

## B.3 `hooks/` (1 file)

`use-dark-mode.ts` — theme toggle.

---

# Part C — Shared / infra / config

| File(s) | Purpose | Review |
|---------|---------|--------|
| [`admin_athena/prisma/schema.prisma`](./files/schema.md) | **Shared DB schema — source of truth** (21 models) | **High** |
| [`claudeai_athena/prisma/schema.prisma`](./files/schema.md) | Mirror of the shared schema (20 models — omits `McpRegistry`) | Med |
| [`admin_athena/prisma/*.sql`](./files/schema.md) (5) | Additive idempotent migrations (`platform_settings`, `model_registry`, `mcp_registry` ALTER, `audit_compliance`, `cmf_dataloader`) — **none create the audit tables** | **High** |
| [`admin_athena/prisma/seed.ts`](./files/schema.md) | Seeds 3 roles + admin user + 10 MCP registry endpoints | Med |
| `*/next.config.ts` | Standalone output; `pg` server-external | Med |
| `admin_athena/instrumentation.ts` | Boot hook — **no-op** (retention worker can't run here) | Med |
| `cloudformation/*.yaml` (4) | AWS infra: networking, iam, elasticbeanstalk, cloudfront-admin | **High** |
| `*/Dockerfile`, `*/buildspec.yml`, `*/DEPLOYMENT.md`, `.ebextensions/*`, `.platform/nginx/*` | Build & deploy | Med — see deployment section (future) |
| `*/.env.example` | Required env-var **names** (secrets never committed) | **High** |

---

## Not yet catalogued (tracked gaps)

- **Individual UI components** — grouped only; low risk, expand on request.
- **API route internals** — listed in [entry points](./02-entry-points.md); per-route
  function bodies to be traced as scenarios (Phase 3), not row-by-row.
- **Deployment artifacts** — summarized; full deployment scenario is Phase 5.
