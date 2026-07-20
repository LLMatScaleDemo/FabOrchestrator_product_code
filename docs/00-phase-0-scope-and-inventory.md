# 0 — Scope, Repository Inventory & File-Extension Inventory

> Version: commit `7976c78` on `main`. See [README](./README.md).
> Validation: 🔵 Static (derived by scanning the repository).

This is the foundation for every later section. It answers three questions:
1. **Which repositories/systems are in scope** (and which named-but-absent ones are *not*)?
2. **What file types actually exist** here?
3. **What did we deliberately exclude, and why?**

---

## 0.1 Repository inventory

Only **one** repository was available for review. It is a **monorepo** (multiple related
apps in one repo).

| Field | Value |
|-------|-------|
| Repository | `FabOrchestrator_product_code` |
| Branch | `main` |
| Commit hash | `7976c78af9f097f0a122d11e5fbee315e54172a5` |
| Structure | Monorepo containing 2 apps + infrastructure |
| Main language | TypeScript (Next.js / React) |
| Deployment | Docker on AWS Elastic Beanstalk; build via AWS CodeBuild |
| Documentation status | In progress |

### Systems inside this repository

| System | Folder | Role | Language | Deploy |
|--------|--------|------|----------|--------|
| **FabOrchestrator.AI** ("Fab") | `claudeai_athena/` | End-user streaming AI chat, MCP tools, file uploads, CMF master-data loader | TypeScript | EB (Docker), port 3000 |
| **NexusOps AI** ("Admin") | `admin_athena/` | Admin console: users, roles, models, MCP registry, usage/cost, audit logs | TypeScript | EB (Docker), port 3001 |
| **Infrastructure** | `cloudformation/` | AWS infra as code (networking, IAM, EB, CloudFront) | YAML (CloudFormation) | `aws cloudformation` |

Both apps **share one PostgreSQL database** (`claude_ai_athena`, AWS RDS, us-west-2).
The shared schema lives at `admin_athena/prisma/schema.prisma` (declared *source of truth*)
and is mirrored in `claudeai_athena/prisma/schema.prisma`.

---

## 0.2 Scope reconciliation — named systems that are **not** in this repo ⚠️

The assignment brief lists several systems to document. Scanning the code shows some of
them **have no source here**. Recording this absence accurately is part of the deliverable
(the assignment's "known gaps", Task 16). Confirm with Jothi whether each lives in a
separate repository that must also be reviewed.

| Named in brief | Present here? | Evidence | Implication |
|----------------|:-------------:|----------|-------------|
| Python MCP servers (`.py`) | ❌ **None** | `find -name '*.py'` → 0 results. The apps are MCP **clients** (`claudeai_athena/lib/mcp-client.ts`) that call *out* to MCP servers over HTTP. | The MCP **server** source lives in **other repos** (or is third-party). Needs separate access to document. |
| AWS Lambda functions | ❌ **None** | No Lambda handler code. Only *referenced*: a Lambda that mints a CMF token into AWS Secrets Manager (`cmf/mes-token`), consumed by `claudeai_athena/lib/cmf/cmf-auth.ts`. | Lambda source is **out of this repo**. Document as an external dependency until source is located. |
| Terraform (`.tf`) | ❌ **None** | Retired — commit `90633e2 "chore(infra): retire Terraform in favour of CloudFormation"`. | IaC is **CloudFormation**, not Terraform. Document CloudFormation instead. |
| GitHub Actions / CI | ❌ **None** | No `.github/workflows`. | CI is **AWS CodeBuild** (`buildspec.yml` in each app). Deploys are **manual** (zip → S3 → EB) per each `DEPLOYMENT.md`. |

**Action:** Before Phase 1 completes, confirm scope with Jothi:
*"I have the Fab + Admin monorepo at `7976c78`. Where do the Python MCP servers and the
Lambda function(s) live — separate repos? I need read access to inventory them."*

---

## 0.3 File-extension inventory

Counts across the whole repo, **excluding** the generated/vendored folders listed in
[0.4](#04-what-we-excluded-and-why).

| Extension / file | Count | Meaning | Documented as |
|------------------|------:|---------|---------------|
| `.ts` | 196 | TypeScript — API routes, libraries, services | File & function inventory |
| `.tsx` | 147 | TypeScript + React — UI pages/components | File inventory (grouped by module) |
| `.json` | 16 | Config / package metadata | Config notes |
| `.md` | 15 | Markdown docs (incl. stale legacy `CLAUDE.md`s) | Referenced, flagged if stale |
| `.svg` | 6 | Vector icons/assets | Not documented individually |
| `.sql` | 5 | Additive DB migrations (`admin_athena/prisma/*.sql`) | Deployment / DB section |
| `.yaml` | 4 | CloudFormation templates + config | Deployment section |
| `.mjs` | 4 | ESLint / PostCSS config | Config notes |
| `.config` | 4 | `.ebextensions` EB config | Deployment section |
| `.yml` | 2 | CodeBuild `buildspec.yml` (one per app) | CI/CD section |
| `.prisma` | 2 | DB schema (shared source of truth + mirror) | Data-model section |
| `.example` | 2 | `.env.example` — required env-var **names** | Security / config section |
| `.dockerignore` | 2 | Docker build-context excludes | Deployment section |
| `.conf` | 2 | Nginx streaming config (`.platform/nginx/`) | Deployment section |
| `Dockerfile` | 2 | Container image definitions (one per app) | Deployment section |
| `.css`, `.jpg`, `.png`, `.ico`, `.xlsx` | few | Styles / assets / one Excel template skeleton | Not documented individually |

**No** `.py`, `.tf`, `.sh`, or `.ps1` files exist (see scope reconciliation above).

---

## 0.4 What we excluded, and why

Per the assignment, generated and dependency directories are intentionally **excluded**
from the file catalog (they are not authored source):

| Excluded path | Why |
|---------------|-----|
| `node_modules/` | Third-party dependencies (installed, not authored) |
| `.next/` | Next.js build output (generated) |
| `lib/generated/prisma/` | Prisma client (generated from `schema.prisma`) |
| `.git/` | Version-control internals |
| `coverage/` | Test-coverage output (generated) |

These are recorded here so a reviewer knows the exclusion was deliberate, not an oversight.

---

## 0.5 Plan for the remaining phases

| Phase | Deliverable | Owner (draft) |
|-------|-------------|---------------|
| **0** | This document (scope + inventories) | Done |
| **1** | File-by-file catalog grouped by module (Fab, Admin, infra) | AI-generated, human-validated |
| **2** | Function/class inventory + entry-point catalog (~40 API routes, page loads, MCP tools, admin chat tools, `server.js` startup) | AI-generated |
| **3** | Scenario traces — starting with [Login](./scenarios/01-login.md); then a prompt turn, MCP tool call, CMF load, a deploy | AI draft → code-owner confirm |
| **4** | Architecture + sequence diagrams (Mermaid), verified vs code | AI draft → verify |
| **5** | Fab↔Admin integration (**shared-DB**, not direct calls), deployment/CI, security/data-flow, error-recovery matrix | AI draft |
| **6** | Package into internal + customer-safe versions; gaps list; sign-off tracker | Yogita structures; all review |

### One architectural fact to carry forward

**Fab and Admin do not call each other over the network.** They integrate **only through
the shared database**: Admin *writes* configuration (roles, model pricing, MCP access,
platform theme) into tables that Fab *reads*. There is no Admin→Fab request path. Any
integration diagram must reflect this shared-DB coupling rather than a direct API call.
