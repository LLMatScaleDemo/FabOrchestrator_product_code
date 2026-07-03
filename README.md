# FaborchNAdmin

Monorepo holding the two sibling **Next.js (TypeScript)** applications of the Fabric
Orchestration — Auditing & Error-handling platform. Both apps share one PostgreSQL
database (`claude_ai_athena` on AWS RDS, us-west-2).

| App | Folder | Role | Hosting |
|-----|--------|------|---------|
| **FabOrchestrator.AI** (LLMatscale.ai) | [`claudeai_athena/`](./claudeai_athena) | End-user streaming Claude chat, MCP tools, file uploads, document generation | AWS Elastic Beanstalk (Docker) |
| **NexusOps AI** (Admin) | [`admin_athena/`](./admin_athena) | Chat-driven admin console: users, roles, MCP registry, audit logs, error catalog | AWS App Runner (ECR via CodeBuild) |

Both satisfy the four-part audit-and-error spec: error catalog (REQ-01), session audit
(REQ-02), error audit (REQ-03), and prompt audit with token + USD-cost columns (REQ-04).

## Tech stack

Next.js 16 (App Router, standalone output) · React 19 · TypeScript 5 · Node 20 ·
Tailwind CSS v4 · Vercel AI SDK v6 + `@ai-sdk/anthropic` · Prisma 7.3 +
`@prisma/adapter-pg` · Zod 4.

The Prisma schema in `claudeai_athena/prisma/schema.prisma` is the source of truth;
`admin_athena/prisma/schema.prisma` mirrors the relevant subset.

## Getting started (per app)

```bash
cd claudeai_athena      # or: cd admin_athena
cp .env.example .env     # then fill in real values
npm install
npx prisma generate
npm run dev              # admin_athena runs on port 3001
```

## Environment

Each app reads its config from a local `.env` (see `.env.example` in each folder).
**No real secrets are committed** — `.env` files are git-ignored. Required keys include
`ANTHROPIC_API_KEY`, `DATABASE_URL`, `KEY_ENCRYPTION_SECRET`, and SMTP settings.

## Deployment

Per-app runbooks:
- FabOrchestrator.AI → [`claudeai_athena/DEPLOYMENT.md`](./claudeai_athena/DEPLOYMENT.md)
- NexusOps AI → [`admin_athena/DEPLOYMENT.md`](./admin_athena/DEPLOYMENT.md)
