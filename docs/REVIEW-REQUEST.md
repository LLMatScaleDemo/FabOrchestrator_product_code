# Review Request — FabOrchestrator Architecture Docs

**To:** Jothi (technical review) · **From:** Atul · **Date:** 2026-07-20
**Documents:** everything under [`docs/`](./README.md) · **Version reviewed:** commit `7976c78` on `main`

---

First pass of the code-understanding documentation is ready for review. It's an **as-built
architecture doc** — reverse-engineered from the code, describing what exists, not a redesign
— pinned to commit **`7976c78`**. Start at [`docs/README.md`](./README.md), which indexes
everything.

## What's in it (15 files)

- Scope + repository + file-extension inventory ([`00`](./00-phase-0-scope-and-inventory.md))
- File-by-file catalog of both apps' libraries, with a review-priority column ([`01`](./01-file-catalog.md))
- Entry-point catalog — all 69 API routes, pages, and AI tools ([`02`](./02-entry-points.md))
- Architecture + Fab↔Admin integration, with diagrams ([`04`](./04-architecture-and-integration.md))
- Deployment/CI, error & recovery matrix, customer-safe overview ([`05`](./05-deployment-and-ci.md), [`06`](./06-error-and-recovery-matrix.md), [`08`](./08-customer-safe-overview.md))
- **5 end-to-end scenario traces** with real file/function names and sequence diagrams:
  [login](./scenarios/01-login.md), [chat turn](./scenarios/02-chat-turn.md),
  [MCP tool call](./scenarios/03-mcp-tool-call.md), [CMF load](./scenarios/04-cmf-load.md),
  [admin force-logout](./scenarios/05-admin-force-logout.md)
- A prioritized [review-hotspots](./03-review-hotspots.md) list and a [sign-off tracker](./07-signoff-tracker.md)

**Everything is marked 🔵 "Static"** — traced by reading code, not yet runtime-validated, and
**no application code was changed.**

## Three things I need you to confirm before we scale further

1. **Format & depth** — is the scenario-trace format ([`scenarios/01-login.md`](./scenarios/01-login.md)
   is the template) what you want? If yes, I'll apply it to any further scenarios.
2. **Structure mismatch** — the code is flatter than the assignment's assumed
   `route → controller → service → repository` layering; a `route.ts` file *is* the endpoint,
   calling `lib/` helpers directly. I documented the **actual** structure — please confirm
   that's the right call.
3. **Scope** — the brief names **Python MCP servers** and **Lambda functions**, but neither
   exists in this repo (the apps are MCP *clients*; the Lambda is only referenced). Where does
   that source live — separate repos? I need access to document them.
   (See [scope §0.2](./00-phase-0-scope-and-inventory.md#02-scope-reconciliation).)

## Findings worth your eye

(All are observations to confirm, **not** changes made. Details in [`03`](./03-review-hotspots.md).)

- The AI-invoked CMF `loadToCmf` path commits to the live MES with **no concurrency guard, no
  audit, and only a prompt-level confirmation gate** ([scenario 04](./scenarios/04-cmf-load.md)).
- The chat route sets `prepareStep` **twice** (second overwrites first) — possible regression
  of a tool-pairing workaround ([scenario 02](./scenarios/02-chat-turn.md)).
- DB TLS is disabled (`ssl:false`) in both apps.

## What's blocked on others

- **Runtime validation** of the 5 scenarios — needs the app running + logs.
- **Code-owner confirmation** per module.
- **Raj** identifying the highest-priority business scenarios.

Full status and the open blocking questions are in the [sign-off tracker](./07-signoff-tracker.md).
Happy to walk through any of it live.
