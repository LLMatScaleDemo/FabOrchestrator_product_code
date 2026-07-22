# FaborchNAdmin

Monorepo holding the two sibling **Next.js (TypeScript)** applications of the Fabric
Orchestration — Auditing & Error-handling platform. Both apps share one PostgreSQL
database (`claude_ai_athena` on AWS RDS, us-west-2).

| App                                          | Folder                                   | Role                                                                                                                    | Hosting                            |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **FabOrchestrator.AI** (LLMatscale.ai) | [`claudeai_athena/`](./claudeai_athena) | End-user streaming Claude chat, MCP tools, file uploads, document generation                                            | AWS Elastic Beanstalk (Docker)     |
| **NexusOps AI** (Admin)                | [`admin_athena/`](./admin_athena)       | Chat-driven admin console: users, roles,**models**, MCP registry, usage/cost analytics, audit logs, error catalog | AWS App Runner (ECR via CodeBuild) |

Both satisfy the four-part audit-and-error spec: error catalog (REQ-01), session audit
(REQ-02), error audit (REQ-03), and prompt audit with token + USD-cost columns (REQ-04).

## Tech stack

Next.js 16 (App Router, standalone output) · React 19 · TypeScript 5 · Node 20 ·
Tailwind CSS v4 · **shadcn/ui** (Radix primitives) · Vercel AI SDK v6 +
`@ai-sdk/anthropic` · Prisma 7.3 + `@prisma/adapter-pg` · Zod 4 · Recharts (admin
analytics).

The UI is component-driven with **shadcn/ui** on top of Tailwind v4. All colours are
theme tokens defined in each app's `app/globals.css` (no hardcoded hex in components);
`prefers-reduced-motion` and WCAG AA contrast are respected. The admin console ships an
enterprise dashboard (KPI tiles + charts) for usage, cost, sessions, errors and prompts.

The Prisma schema is shared between the apps; `admin_athena/prisma/schema.prisma` is the
source of truth for the RBAC/audit/registry models and `claudeai_athena/prisma/schema.prisma`
mirrors the shared set.

## AI models

The Fab app exposes three branded models (user-facing label → Anthropic model id):

| Label                         | Model id            | Default |
| ----------------------------- | ------------------- | ------- |
| FabOrchestrator 1.0           | `claude-opus-4-7` |         |
| FabOrchestrator 1.1           | `claude-sonnet-5` |         |
| **FabOrchestrator 2.0** | `claude-opus-4-8` | ✓      |

Models — their display name, model id, per-token pricing (input / output / cache read /
cache write), thinking mode, active flag and default — are **configured from the admin UI**
(**NexusOps AI → Models**), backed by the shared `model_registry` table. Both apps read the
model list, the RBAC gate, and USD cost attribution from it, and fall back to the built-in
values above when the table is empty or not yet migrated.

## Getting started (per app)

```bash
cd claudeai_athena      # or: cd admin_athena
cp .env.example .env     # then fill in real values
npm install
npx prisma generate
npm run dev              # admin_athena runs on port 3001
```

## Database migrations

The base schema is applied with Prisma (`npx prisma db push`). Additive, idempotent SQL
files under `admin_athena/prisma/` create the singleton/registry tables without touching
existing data — run each once against the shared DB:

```bash
psql "$DATABASE_URL" -f admin_athena/prisma/create_platform_settings.sql
psql "$DATABASE_URL" -f admin_athena/prisma/create_model_registry.sql   # + seeds the 3 models
```

Until `model_registry` exists, both apps run on the built-in model list and pricing above.

## Environment

Each app reads its config from a local `.env` (see `.env.example` in each folder).
**No real secrets are committed** — `.env` files are git-ignored. Required keys include
`ANTHROPIC_API_KEY`, `DATABASE_URL`, `KEY_ENCRYPTION_SECRET`, and SMTP settings.

## Scripts (per app)

```bash
npm run dev          # dev server (admin on :3001, fab on :3000)
npm run build        # production build (standalone output)
npm run lint         # ESLint
npm run test:errors  # REQ-01 error-catalog unit tests
npm run test:a11y    # accessibility tests (jest-axe)
```

## Deployment

Per-app runbooks:

- FabOrchestrator.AI → [`claudeai_athena/DEPLOYMENT.md`](./claudeai_athena/DEPLOYMENT.md)
- NexusOps AI → [`admin_athena/DEPLOYMENT.md`](./admin_athena/DEPLOYMENT.md)
