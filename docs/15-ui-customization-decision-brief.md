# 15 — Agent-driven UI customization: decision brief

> **Status:** 🔵 **Static** — derived by reading source only. Nothing here is runtime-confirmed.
> **Pinned to:** `abe8706d8ed51709bd316d83783a66e6a8a27f28` (app code verified unchanged at HEAD `8b304c0`).
> **No application code was modified.**
> **Purpose:** decision input for the meeting on letting clients customize the front end by
> prompting the agent. Establishes what exists, what the stated product requirements rule in and
> out, and what must be built that does not exist today.
>
> **Rev 2** — incorporates product answers on tenancy, MCP, change frequency, and approval.
> §2 of rev 1 claimed the product is "single-client by construction". **That was over-broad and
> is corrected in [§2](#2-two-data-planes-only-one-is-single-client).** The conclusion drawn
> from it — that generated code gets free native access to real data — does not hold.

---

## The ask

Clients customize their own front end by prompting the agent, with no developer involved.

**Stated product requirements** (from the product owner, 2026-07-31):

| | |
|---|---|
| Clients | Many. Count and growth rate unknown. |
| Data access | Each client connects **their own MCP server** via a self-service portal. |
| Hosting | **Our cloud.** No on-prem, no air-gapped clients. |
| Change frequency | **Continuous** — not an onboarding-only activity. |
| Approval | **None.** Generated UI goes live without human review. |
| Primary users | **Operators**, who are the heaviest users. |
| Variation | "One needs a search bar, another needs a little table." |

---

## 1. What exists today

Three things are built. All are **complete**; none are connected to agent-driven customization.
There is no partially-built UI-customization feature to finish — no TODOs, no stubs, no
in-progress work in the git history.

### 1.1 The client MCP portal — already built

This is the piece described as needed. It exists.

| Capability | Location |
|---|---|
| Connection record — `serverUrl`, `authType`, encrypted credentials, discovered tools, status, last error | `admin_athena/prisma/schema.prisma:171` (`McpConnection`) |
| Scoping — `userId` = personal, `roleId` = role-assigned | same, `:173-174` |
| Self-service CRUD | `claudeai_athena/app/api/mcp/connections/route.ts` |
| Tool discovery / connection test | `.../[id]/discover/route.ts`, `.../[id]/test/route.ts` |
| Client-facing UI | `claudeai_athena/components/mcp/mcp-add-dialog.tsx`, `mcp-connection-card.tsx` |
| Admin-side catalog + role assignment | `McpRegistry` (`schema.prisma:259`), `/api/admin/mcp-registry` |
| Per-request authorization | `claudeai_athena/app/api/chat/route.ts:432-447` — filters requested connections against role-assigned plus personal (when `role.personalMcpEnabled`) |

### 1.2 Admin-controlled appearance — works end to end, one knob wide

| Step | Location |
|---|---|
| Storage | `admin_athena/prisma/schema.prisma:360` — `PlatformSettings`, singleton row `id = "global"` |
| Admin write | `admin_athena/app/api/admin/settings/theme/route.ts` — PATCH, admin-only, validated against 6 themes, audit-logged |
| Fab read | `claudeai_athena/app/api/platform-theme/route.ts` — public GET (login page needs it pre-auth) |
| Fab apply | `claudeai_athena/components/providers.tsx:196` — sets `data-theme` on `<html>` |

Proof that appearance can change without a code deploy. Arrived whole in `286a5a9`, untouched
since. **One enum column, set by a human, global to the whole deployment.**

### 1.3 Model-generated React that renders live — built for chat previews

`lib/artifact-parser.ts` (238 lines) · `lib/sandpack-deps.ts` (179) ·
`components/sandpack-preview.tsx` (216) · `components/artifact-preview.tsx` (875) ·
`lib/artifacts.ts` (144).

"Model writes React, user sees it render in a sandboxed iframe" is solved and working. It should
not be rebuilt. It is scoped to disposable chat previews — see [§6](#6-what-must-be-built).

### 1.4 What is missing

- **The admin agent has 31 tools and none touch the UI.** `grep theme admin_athena/lib/admin-tools.ts` returns nothing.
- **No client/tenant concept exists** — see [§3](#3-the-gap-that-is-now-mandatory-a-tenant-boundary).
- **No branding fields** — no logo, product name, favicon, or login copy.
- **The cockpit is fully hardcoded**, including its metrics. `components/cockpit/agent-cards.tsx:32` renders "1,284 queries today" as a literal string; `cockpit-nav.tsx:26` defines five nav items, four non-functional.
- **Themes are a closed set of six**, requiring a CSS change in both apps plus a redeploy.
- **Artifacts are conversation-scoped** — `Artifact` requires `conversationId`/`messageId`/`userId`, all `onDelete: Cascade`. A generated UI would be deleted when a chat is tidied up.
- **`Role.permissions` is never read by the front end** — server-side only, so no UI-level feature gating.

---

## 2. Two data planes — only one is single-client

**This corrects rev 1**, which claimed the whole product is single-client by construction.

| Surface | Data path | Client scoping |
|---|---|---|
| Modeling Agent / CMF loader — `/api/cmf/*`, `/api/modeling-agent/*` | `CMF_BASE_URL`, `CMF_SQL_SERVER`, `CMF_SQL_DB`, `CMF_SQL_USER/_PASS` (env vars) | **Single factory per deployment.** No per-client routing exists. |
| General chat / FabInsight — `/api/chat` | **MCP servers only** | **Already scoped per role and per user** (§1.1). |

Verified: `/api/chat/route.ts` never imports `lib/cmf`. Every CMF import is confined to the CMF
routes, the modeling-agent routes, `lib/chat-cmf/`, and `lib/repo-cmf/`.

**Consequence:** the surface this feature targets was never single-client, so generated code does
**not** get free native access to client data. Data reaches the UI through that client's MCP
connection, and access must be scoped per client — which requires §3.

The CMF single-factory constraint remains real, but applies only to the Modeling Agent surface.

---

## 3. The gap that is now mandatory: a tenant boundary

**There is no client or organization concept in the schema.**

`Role` is a permission tier — the templates are Admin, Technical, Business, Basic
(`admin_athena/lib/constants/role-templates.ts`) — not a customer. MCP connections scope to
`userId` or `roleId`. Neither is a client boundary.

With many clients sharing one cloud deployment, this must exist before anything else:

- a tenant entity, with users belonging to it
- tenant on every configuration and generated-UI record
- tenant resolution on each request
- every query scoped, including the **pre-auth** path (the login page reads branding before a user is known — see `providers.tsx:196`)

Rev 1 listed this as optional. Given the stated requirements, it is a prerequisite.

---

## 4. What the requirements rule out

### Ruled out: generated code with per-client deployment

Three requirements each independently break it:

| Requirement | Consequence |
|---|---|
| Continuous changes | Every change is a build + deploy — minutes per iteration |
| Unknown, growing client count | One Elastic Beanstalk environment per client is unbounded cost and ops surface |
| No human approval | An uncompiled-but-deployed generation reaches an operator's console with nobody watching |

**Also relevant:** there is **no automated deploy pipeline today.** Deploys are manual — a human
zips the app, uploads to S3, points EB at it. (The CodeBuild pipeline is legacy; it fed App
Runner, decommissioned because its 120s timeout broke streaming. See [doc 05](./05-deployment-and-ci.md).)
This path would require building that from zero.

### Required: shared deployment, UI resolved at runtime

Only this satisfies instant changes, flat cost as clients are added, and rollback as a database
write. **Rev 1 recommended against this**; the stated requirements reverse that.

Within it, two ways to express a client's UI:

| | **Arrangement of a component library** | **Generated React, evaluated in-browser** |
|---|---|---|
| Agent emits | A layout spec referencing vetted components | Raw component source |
| Can produce a broken UI? | No — invalid specs are rejected before saving | Yes — needs a sandbox and error isolation |
| Data access | Normal app code, normal MCP authorization | Untrusted; needs a `postMessage` bridge defining exactly what it may reach |
| Ceiling | Only what the library covers | None |
| Reuses | Existing `components/ui/*` (table, input, select, tabs, card, badge, chart) | Sandpack pipeline (§1.3) |

**Why this choice is sharper than it looks under these requirements:** with no human approval, in
a shared deployment, with operators depending on it, raw generated code means unreviewed
model-written JavaScript running in an app that holds other clients' sessions. The safety
machinery to make that acceptable is substantial, and it is the same machinery an approval gate
would otherwise have provided.

**The stated variation — "a search bar" and "a little table", from an operator's perspective — is
within a bounded vocabulary.** Search, tables, filters, status tiles, and charts are components
built once and arranged per client. Under arrangement, the agent still *designs* the UI; it emits
a layout rather than source. That may satisfy the requirement, since "the agent builds the UI" is
the goal and raw React is an implementation choice.

> **Decision for the meeting:** does "the agent writes code" mean *raw React*, or *the agent
> authors the UI*? If the latter, arrangement meets every stated constraint at materially lower
> cost and risk.

---

## 5. Requirements: answered and outstanding

**Answered:** client count (many, unknown growth) · hosting (our cloud, no on-prem) · change
frequency (continuous) · approval (none) · data path (per-client MCP via portal) · primary users
(operators) · variation (search bar vs. table, operator-facing).

**Outstanding:**

1. **Raw React, or agent-authored arrangement?** See §4. The largest remaining cost driver.
2. **What is the tenant?** A company, a site, or a fab? Determines the §3 model. Multi-site customers make this materially harder.
3. **What happens when a generation is wrong?** With no approval gate, safety must be automatic. Does the client self-serve a rollback, or does it revert automatically on failure?
4. **May generated UI trigger MCP *actions*, or only read?** MCP servers can expose write tools. Unreviewed generated UI invoking writes against a live MES is a materially different risk from reading.
5. **Is the Modeling Agent (CMF) surface in scope?** It is single-factory (§2) and would not fit a multi-client model without separate work.

---

## 6. What must be built

**Prerequisites — needed under every option:**

1. **Tenant boundary** (§3). Blocks everything else.
2. **Per-tenant UI configuration store**, replacing the global singleton. Not conversation-scoped — the current `Artifact` model cascade-deletes with its chat (§1.4).
3. **Separate the shared platform core from the per-client UI surface.** Currently entangled: the cockpit's hardcoded cards sit alongside session-management logic.
4. **Agent tools over appearance.** The write path, validation, and audit logging already exist (§1.2) — this wraps them. Small, and proves the full loop end to end before anything expensive is committed.

**Then, depending on the §4 decision:** either a component library plus a spec renderer and
validator, or a sandboxed runtime evaluator plus the data bridge, capability model, and failure
isolation that unreviewed code in a shared deployment requires.

---

## 7. Scope note

This repo is under a **documentation-only constraint** (`CLAUDE.md`): docs pinned to `abe8706`,
application code unmodified, two logged exceptions. Building any of the above lifts that. Worth
making an explicit decision rather than letting it erode.

---

## Related

[14 — Agentic architecture](./14-agentic-architecture.md) ·
[11 — MCP server & tool catalog](./11-mcp-server-catalog.md) ·
[12 — Improvements & underutilized resources](./12-improvements-and-underutilized-resources.md) ·
[05 — Deployment & CI](./05-deployment-and-ci.md) ·
[04 — Architecture & integration](./04-architecture-and-integration.md)
