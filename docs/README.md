# FabOrchestrator — System Documentation

> **Type of document:** As-built architecture documentation, reverse-engineered from
> the current source. It *describes what exists* (descriptive), it does **not** propose
> changes (prescriptive). See [Reading guide](#how-to-read-this) below.

## Version this document describes

| Field | Value |
|-------|-------|
| Repository | `FabOrchestrator_product_code` (monorepo) |
| Branch | `main` |
| Commit hash | `7976c78af9f097f0a122d11e5fbee315e54172a5` (`7976c78`) |
| Commit date | 2026-07-17 |
| Documented on | 2026-07-20 |

**Everything in this document is true only for the commit above.** When the code changes,
re-pin the hash and re-verify the affected sections.

## Contents

> 📋 **For reviewers:** start with the [Review Request](./REVIEW-REQUEST.md) — what's ready and what's needed back.

Think of the set in three groups: **the map** (what exists), **the understanding** (how it
works), and **worked examples** (real request flows). Plain-language description of each below.

**Reference & analysis — "the map" and the watch-list**
| # | Document | What it is (plain language) | Status |
|---|----------|-----------------------------|--------|
| 0 | [Scope & inventory](./00-phase-0-scope-and-inventory.md) | Answers "what are we documenting?" — the one repo, a count of every file type, and an honest record of what the assignment named but **isn't here** (Python MCP servers, Lambda). | ✅ Draft |
| 1 | [File-by-file catalog](./01-file-catalog.md) | A searchable list of every code library file: what it does, what it exports, whether it touches DB/network/money, and a review priority (High/Med/Low). | ✅ Draft |
| 2 | [Entry-point catalog](./02-entry-points.md) | Every place execution *begins* — all 69 web API addresses, pages, server startup, and AI tools. "Where do I start reading for behavior X?" | ✅ Draft |
| 3 | [Review hotspots](./03-review-hotspots.md) | **The watch-list.** The ~25 files a human must double-check, grouped by why (security, money, factory-data), each with the exact thing to verify. Includes a "where to start contributing" guide. | ✅ Draft |
| 4 | [Architecture & integration](./04-architecture-and-integration.md) | The diagrams: whole system, each app inside, and the key fact that the two apps talk **through the shared database**, not to each other. | ✅ Draft |
| 5 | [Deployment & CI/CD](./05-deployment-and-ci.md) | How the code gets from a laptop to running on AWS (containers → Elastic Beanstalk → CloudFront), load-bearing settings, and required secrets. | ✅ Draft |
| 6 | [Error & recovery matrix](./06-error-and-recovery-matrix.md) | What can go wrong and what the system does about it — the 10-error catalog, graceful degradation, session states, rollback. | ✅ Draft |
| 7 | [Sign-off tracker](./07-signoff-tracker.md) | **The living checklist** (Yogita drives it): which docs are reviewed, who confirms what, and the open blocking questions. | ✅ Living |
| 8 | [Customer-safe overview](./08-customer-safe-overview.md) | The same platform explained for an **external** audience, with all code, paths, secrets, and internal addresses stripped out. | ✅ Draft |
| 9 | [Open questions by purpose](./09-open-questions-by-purpose.md) | Every open review question from the deep-dives and scenarios, split into **accuracy checks** (verify the doc's reading — fact-check) vs **improvement decisions** (should the code change — judgment), grouped per file. | ✅ Living |

**File deep-dives — "how a single file works"** (in [`files/`](./files/); template: [`files/_template.md`](./files/_template.md))
| File | What it covers | Status |
|------|----------------|--------|
| [`db.md`](./files/db.md) | The shared Prisma/PostgreSQL connection both apps use (`ssl: false`, singleton pattern). | ✅ Draft |
| [`encryption.md`](./files/encryption.md) | AES-256-GCM secrets encryption, scrypt password hashing (incl. the latent `reject` bug), token generation. | ✅ Draft |
| [`auth-middleware.md`](./files/auth-middleware.md) | The Bearer-token gate on every API route; Fab vs Admin divergence (idle eviction, admin gate). | ✅ Draft |
| [`session-audit.md`](./files/session-audit.md) | REQ-02 session lifecycle audit (raw SQL); the reconciler that deletes live sessions. | ✅ Draft |
| [`prompt-audit.md`](./files/prompt-audit.md) | REQ-04 prompt/response audit (PII + cost columns); topic classifier; manual-only retention. | ✅ Draft |
| [`error-audit.md`](./files/error-audit.md) | REQ-03 error persistence and ERR-id generation; audit tables have no DDL in the repo. | ✅ Draft |
| [`error-catalog-loader.md`](./files/error-catalog-loader.md) | Fab's TTL-cached loader of the `error_catalog` DB table; five copies of the catalog exist. | ✅ Draft |
| [`api-error-handler.md`](./files/api-error-handler.md) | The anything-thrown → REQ-01 envelope funnel; substring classification and its misfires. | ✅ Draft |
| [`sql-guard.md`](./files/sql-guard.md) | The read-only-SQL regex guard — bypassable by design and unused at runtime in both apps. | ✅ Draft |
| [`model-pricing.md`](./files/model-pricing.md) | Hardcoded per-model USD rates + turn cost math; the two apps' maps conflict 3× on three Opus ids. | ✅ Draft |
| [`model-registry.md`](./files/model-registry.md) | Fab's cached reader of the admin-managed `model_registry` table (rates, allow-list, thinking config). | ✅ Draft |
| [`mcp-client.md`](./files/mcp-client.md) | MCP tool discovery/execution over JSON-RPC/SSE; call-time credential decrypt, SSRF and prompt-injection surface. | ✅ Draft |
| [`context-window.md`](./files/context-window.md) | Fits history under the 200K window before each LLM call; token estimation and tool-pair repair. | ✅ Draft |
| [`s3-upload.md`](./files/s3-upload.md) | Uploads chat attachments to private S3 and presigns GET URLs; where those URLs travel and persist. | ✅ Draft |
| [`chat-route.md`](./files/chat-route.md) | The core `POST /api/chat` endpoint, documented phase by phase (auth → tools → stream → cost/audit). | ✅ Draft |
| [`cmf-types.md`](./files/cmf-types.md) ⚠️ | CMF wire types and the **inverted** operation enum (0 = commit, 1 = dry-run) — every call site that picks a value. | ✅ Draft |
| [`cmf-client.md`](./files/cmf-client.md) ⚠️ | The REST client that commits to the live factory MES; process-wide TLS/DNS side effect at import. | ✅ Draft |
| [`cmf-auth.md`](./files/cmf-auth.md) | The MES Bearer token, read and cached from AWS Secrets Manager; expiry and multi-instance behavior. | ✅ Draft |
| [`chat-cmf-tools.md`](./files/chat-cmf-tools.md) ⚠️ | The Modeling Agent's 11-tool belt; `loadToCmf` commit tool — currently excluded from the model, no code gate inside. | ✅ Draft |
| [`rule-engine.md`](./files/rule-engine.md) | The deterministic R1–R6 master-data rule gate; severity downgrades and its (unwired?) place in the pipeline. | ✅ Draft |
| [`storage.md`](./files/storage.md) | The Fab Prisma CRUD layer (41 functions); error-swallow pattern and where ownership is/ isn't enforced. | ✅ Draft |
| [`validation-cmf-queries.md`](./files/validation-cmf-queries.md) | Combined page for the 8 files that build SQL against live CMF tables; SQL-identifier provenance and injection analysis. | ✅ Draft |
| [`admin-user-service.md`](./files/admin-user-service.md) | Admin's audit-wrapped user-mutation core (suspend/delete/force-logout/reset); the no-last-admin-guard finding. | ✅ Draft |
| [`invitation-service.md`](./files/invitation-service.md) | The invite lifecycle; how accepting an invite mints a live 30-day session, and the soft-deleted-reactivation logic. | ✅ Draft |
| [`admin-tools.md`](./files/admin-tools.md) | The 31 AI chat tools that *are* the admin write surface; per-tool side-effect class, confirm guards, service bypasses. | ✅ Draft |
| [`admin-chat-route.md`](./files/admin-chat-route.md) | The admin chat engine (`POST /admin/chat`) — the single `requireAdmin` gate in front of the whole tool surface. | ✅ Draft |
| [`email.md`](./files/email.md) | The Admin email stack (SMTP + invite/reset templates); HTML-injection provenance and the token-in-logs leak. | ✅ Draft |
| [`schema.md`](./files/schema.md) | The shared PostgreSQL data model — Prisma models, the raw-SQL-only audit tables and their DDL provenance, Fab↔Admin drift. | ✅ Draft |

_Deep-dive pages exist for High-priority files only (see [hotspots](./03-review-hotspots.md));
Medium/Low files are documented by their one-line row in the [file catalog](./01-file-catalog.md).
More pages are being added batch by batch._

**End-to-end scenario traces — "worked examples"** (a request from entry point to result, with real names + a diagram)
| # | Scenario | What it traces | Status |
|---|----------|----------------|--------|
| 01 | [Login](./scenarios/01-login.md) | How signing in works, and how Fab vs Admin differ. | ✅ Draft |
| 02 | [Chat prompt turn](./scenarios/02-chat-turn.md) | The core product path: user message → AI → streamed answer, incl. cost tracking. | ✅ Draft |
| 03 | [MCP tool invocation](./scenarios/03-mcp-tool-call.md) | How the AI reaches out to an external tool. | ✅ Draft |
| 04 | [CMF master-data load ⚠️](./scenarios/04-cmf-load.md) | The highest-risk path: committing data into the live factory system. | ✅ Draft |
| 05 | [Admin force-logout](./scenarios/05-admin-force-logout.md) | An admin action, showing how every change is audited in the same DB transaction. | ✅ Draft |

_All documents are 🔵 **Static** (from reading code). What remains is runtime validation and
code-owner sign-off — tracked in [doc 07](./07-signoff-tracker.md)._

> **One-line pitch for the team:** files 00–02 are the *map* (what exists), 03 is the
> *watch-out list*, 04–06 explain *how it works*, 07 tracks *who reviews what*, 08 is the
> *customer-safe* version, and the scenarios are *worked examples* of real request flows —
> all describing one frozen snapshot of the code, with nothing changed.

## How to read this

- **Reference sections** (file catalog, function tables, entry-point catalog) are for
  *looking things up*. Search for a file or function name and read its row.
- **Scenario sections** are for *understanding a behavior*. Each traces one real user
  action from its entry point to its final result, with real file and function names,
  every decision branch, and a diagram.

### Validation status — what to trust

Each scenario carries a validation badge (per the assignment's Task 13):

| Badge | Meaning |
|-------|---------|
| 🔵 **Static** | Traced by reading the code only. Accurate for call structure; runtime behaviour (e.g. which tool the AI picks) not yet confirmed. |
| 🟢 **Runtime-validated** | Confirmed by running the scenario and inspecting logs / DB. |
| ✅ **Developer-confirmed** | A code owner reviewed and confirmed the trace. |
| 🏁 **Approved** | Signed off by Jothi (technical) / Raj (business). |

Everything currently in this document is 🔵 **Static** unless marked otherwise.
