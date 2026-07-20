# CLAUDE.md — FabOrchestrator Documentation Effort

> **Read this first.** This file orients a new session (human or Claude) to the
> **documentation project** happening in this repo. It is NOT app documentation — the
> app docs live in [`docs/`](./docs/README.md).

## What this project is

We are producing **as-built architecture documentation** for the FabOrchestrator platform:
reverse-engineering the existing code into a reviewable map of files, functions, entry
points, and end-to-end execution flows. The goal is that anyone can answer *"how does a
user request become a response?"* and point to a real file, function, and reviewed commit.

**This is descriptive, not prescriptive.** We document what exists; we do **not** change code.

## Hard constraints (do not violate)

- ❌ **Do NOT modify application code** — no moving files, renaming functions, refactoring,
  deleting "unused" files, or changing auth/deployment. Documentation only.
- ✅ Only write/edit files under [`docs/`](./docs/) (and this `CLAUDE.md`).
- 📌 **Pin the version.** All docs describe commit `7976c78af9f097f0a122d11e5fbee315e54172a5`
  (`7976c78`, branch `main`). If the code has moved, re-pin and re-verify affected sections.
- 🔵 Findings are **Static** (from reading code) until a human/runtime confirms them. Never
  present a static trace as verified fact. Use the validation badges (see `docs/README.md`).

## The system in one paragraph

A monorepo with **two Next.js/TypeScript apps sharing one PostgreSQL database**:
`claudeai_athena/` ("FabOrchestrator.AI", end-user AI chat + CMF master-data loader) and
`admin_athena/` ("NexusOps AI", chat-driven admin console). Plus `cloudformation/` (AWS
infra). The two apps **integrate only through the shared DB** (Admin writes config, Fab
reads it) — there is no direct app-to-app API call. Deep detail is in `docs/`.

⚠️ **The `CLAUDE.md` files inside `claudeai_athena/` and `admin_athena/` are STALE** —
they describe an older, simpler version (7 models, 7 tables). Trust `docs/` and the actual
code, not those.

## Where things are

| Path | What |
|------|------|
| [`docs/README.md`](./docs/README.md) | Index of all documentation + validation-badge legend |
| [`docs/REVIEW-REQUEST.md`](./docs/REVIEW-REQUEST.md) | The note sent to Jothi for review |
| `docs/00`–`08` | Reference & analysis (scope, catalog, entry points, hotspots, architecture, deploy, errors, sign-off, customer-safe) |
| `docs/scenarios/01`–`05` | End-to-end execution traces |
| `docs/files/` | Per-file deep-dive pages for High-priority files (template: `_template.md`; being added batch by batch) |
| `admin_athena/prisma/schema.prisma` | The shared DB schema — **source of truth** |

## Status

**Done (all 🔵 Static):** scope + inventories, file catalog, entry-point catalog, review
hotspots, architecture/integration, deployment/CI, error matrix, customer-safe overview,
sign-off tracker, and 5 scenario traces (login, chat turn, MCP call, CMF load, admin
force-logout).

**Remaining — see [`docs/07-signoff-tracker.md`](./docs/07-signoff-tracker.md):**
1. Runtime validation of the 5 scenarios (needs the apps running + logs).
2. Code-owner confirmation of every 🔵 document.
3. Answers to the blocking questions (esp. **where the Python MCP servers and Lambda live** —
   they are named in the assignment but NOT in this repo).
4. Any additional scenarios Raj prioritizes.

## How to continue in a new session

1. Read `docs/README.md`, then `docs/07-signoff-tracker.md` for current status.
2. Confirm the commit hash still matches (`git rev-parse HEAD`); re-pin if not.
3. Pick up the next unblocked item (usually: a new scenario trace, or applying
   code-owner corrections). Follow the format of `docs/scenarios/01-login.md`.
4. Keep everything version-pinned and badge-labeled. Do not touch app code.

## Method notes (what worked)

- Enumerate files with globs first, then read logic-heavy `lib/` files (fan out with
  parallel read-only agents for speed), then synthesize into catalog/scenario docs.
- Entry points = every `route.ts` (one export per HTTP verb), every `page.tsx`, plus the
  AI tools in `lib/admin-tools.ts` and `lib/chat-cmf/tools.ts`.
- The raw-SQL audit tables (`error_audit_logs`, `prompt_audit_logs`, `error_catalog`,
  `*_daily_counter`) are **not** in `schema.prisma` — only in `admin_athena/prisma/*.sql`.
