# Improvements & underutilized resources

> **Status:** 🔵 **Static** — every finding below was derived by reading code at the pinned
> commit. Nothing here has been runtime-confirmed except where explicitly marked 🟢.
> **Pinned to:** `abe8706d8ed51709bd316d83783a66e6a8a27f28`. Verified 2026-07-27 that
> `git diff abe8706 HEAD -- claudeai_athena admin_athena cloudformation` is **empty** —
> no application code has changed since the pin, so all file:line references are current.
>
> **This page is descriptive, not a change order.** It records what we found; the decision
> to act on any item belongs to the code owners. **No application code was modified.**

## Why this page exists

Requested by Jothi: *"look through the whole FabOrchestrator code and find improvements and
underutilized resources which can be utilized a bit more."* The framing that came with it was
**bug testing** and **low utilization of resources**, so the findings are grouped that way:

- **Group A — Underutilized:** capability that is already built, already paid for, or already
  running, but is not being used. Highest return per unit of effort.
- **Group B — Cost & correctness defects:** things that are actively producing wrong numbers.
- **Group C — Dead weight:** dependencies and modules carried at zero benefit.
- **Group D — Already good:** verified-healthy areas, recorded so nobody spends effort
  "fixing" them.

## The short list

Ranked by (impact ÷ effort). Detail for each is in the sections below.

| # | Finding | Type | Where | Effort |
|---|---------|------|-------|--------|
| 1 | Admin chat sends its entire prompt **uncached** on every turn; Fab caches correctly | Cost | `admin_athena/app/api/admin/chat/route.ts:104` | Low |
| 2 | Admin's cost table prices Opus 4.5/4.6/4.7 at **3× the real rate** | Correctness | `admin_athena/lib/model-pricing.ts:23` | Trivial |
| 3 | Admin records **$0 cost** for every turn on Opus 4.8 / Opus 5 / Sonnet 5 / Fable 5 | Correctness | `admin_athena/lib/model-pricing.ts:57` | Trivial |
| 4 | `xlsx` (SheetJS 0.18.5) is a dependency with **zero imports** and known advisories | Security | `claudeai_athena/package.json:75` | Trivial |
| 5 | 2 of the 10 MCP servers are **down** → 2 of the 7 Entegris use cases unreachable | Availability | [doc 11](./11-mcp-server-catalog.md) | External |
| 6 | `model_registry` (the intended source of truth for models + rates) holds **3 rows**; code hardcodes 12 | Underutilized | `admin_athena/prisma/create_model_registry.sql:31` | Low |
| 7 | `sql-guard.ts` exists in both apps and is enforced **nowhere** | Underutilized | `lib/errors/sql-guard.ts` (both) | Med |
| 8 | Each app has a context-management technique the other lacks | Underutilized | both chat routes | Med |
| 9 | `rule-engine.ts` (the R1–R6 hard gate) has **no live caller** | Underutilized | `claudeai_athena/lib/validation/rule-engine.ts` | Med |
| 10 | FabInsight™ card is presentational — hardcoded metrics, routes to generic `/chat` | Underutilized | `components/cockpit/agent-cards.tsx:32` | Med |

---

## Group A — Underutilized resources

### A1. Admin chat does not use prompt caching; Fab does

Fab's `/api/chat` implements Anthropic prompt caching properly
(`claudeai_athena/app/api/chat/route.ts:610–640`): it folds the system prompt into a leading
system message, sets an `ephemeral` cache breakpoint there and on the last message, and —
correctly — **disables caching when per-request presigned S3 URLs are in the prompt**, because
caching is a prefix match and those URLs change every request. That is a well-built
implementation.

Admin's `/api/admin/chat` (`admin_athena/app/api/admin/chat/route.ts:104–127`) sets
`providerOptions.anthropic` but **never sets `cacheControl`**. Every turn re-sends, at full
input price:

- `ADMIN_SYSTEM_PROMPT` plus an injected date block (lines 91–99),
- the JSON schemas for all **31 admin tools** (`lib/admin-tools.ts`),
- the entire conversation so far,

and it does this on **each** of up to `stepCountIs(10)` steps (line 110). Cache reads bill at
roughly a tenth of input price against a one-off write premium, so a prefix this large and this
stable is close to the ideal caching case. It also cuts time-to-first-token.

One caveat that makes this *more* attractive in Admin than in Fab: Admin's prefix has no
volatile presigned URLs, so the exception Fab has to code around does not apply. The one
volatile element is the injected current date at line 94 — it sits inside the system prompt, so
it would need to move after the breakpoint (or be coarsened to a date rather than a full
timestamp) for the cache to hold across a conversation.

**Why this is the top item:** it is a config change to one already-working call site, in the
app that has the largest fixed prefix, with no behavioral change to the product.

### A2. Each app has a context technique the other is missing

| Technique | Fab `/api/chat` | Admin `/admin/chat` |
|---|---|---|
| Prompt caching | ✅ lines 610–640 | ❌ absent |
| Server-side context editing (`clear_tool_uses_20250919`) | ❌ absent | ✅ lines 114–124 |
| Hand-rolled window fitting | ✅ `fitMessagesToContextWindow` (line 608) | ❌ absent |

Admin uses Anthropic's server-side context editing to clear old tool results — Fab instead
hand-rolls `fitMessagesToContextWindow` in `lib/context-window.ts`, which we have separately
documented as carrying tool-pair repair logic ([`files/context-window.md`](./files/context-window.md)).
Neither approach is wrong, but the two apps are solving overlapping problems with different
machinery, and each is missing the other's. Worth a deliberate decision on which to standardize
on rather than letting it stay accidental.

### A3. `model_registry` is the intended source of truth and is barely populated

`create_model_registry.sql:31` seeds **3 models**, with the comment *"Seed the current 3
FabOrchestrator models."* Fab reads this table through `lib/model-registry.ts` for rates, the
allow-list, and thinking config — that is a good design: model policy is admin-managed data,
not code.

But `claudeai_athena/lib/model-pricing.ts:24` also hardcodes rates for **12** model ids, and
`admin_athena/lib/model-pricing.ts` hardcodes a third, conflicting set (see B1/B2). So the
DB-driven design exists, is wired up, and is being bypassed by two divergent hardcoded maps.
Populating the table and having both apps read it would collapse three sources of truth into
one and make B1 and B2 structurally impossible to repeat.

### A4. `sql-guard.ts` is enforced nowhere

`lib/errors/sql-guard.ts` exists in **both** apps and exports `isReadOnlySql` /
`assertReadOnlySql`. Grepping every import at this commit finds exactly two callers, both unit
tests:

- `claudeai_athena/__tests__/errors/faborch-errors.test.ts:23`
- `admin_athena/__tests__/errors/faborch-errors.test.ts:18`

Zero runtime enforcement in either app. Meanwhile Admin executes 8 `$queryRawUnsafe` calls
through `lib/admin-tools.ts` that never touch it (documented in
[`files/admin-tools.md`](./files/admin-tools.md)). The guard is a regex keyword check and is
bypassable by design, so it should never be the sole boundary — but shipping it and enforcing
it nowhere is the worst of both worlds: maintenance cost with no protection. Either wire it in
as defense-in-depth behind a least-privilege read-only DB role, or delete it.

### A5. `rule-engine.ts` — the R1–R6 gate with no caller

`claudeai_athena/lib/validation/rule-engine.ts` implements the deterministic required / length /
numeric / boolean / regex / FK gate. Our deep-dive
([`files/rule-engine.md`](./files/rule-engine.md)) found **no live caller** — the shipped
validate path uses CMF's own remote dry-run (`ExecutionOperation` op=1) instead. It also
downgrades numeric/boolean/FK failures to non-blocking warnings.

This is the single most substantial piece of unused logic in the codebase. Either it is
redundant with the CMF dry-run (in which case it should go, and the docs should say the dry-run
is the gate), or it is meant to be a cheap local pre-flight that saves a network round-trip
against the live MES — in which case wiring it in is a genuine efficiency win on the
highest-risk path in the product. **This needs a code-owner answer, not our guess.**

### A6. Two MCP servers are down, taking two use cases with them

From the runtime probe recorded in [doc 11](./11-mcp-server-catalog.md) 🟢 (probed 2026-07-24):
**Genealogy** and **Scrap Pareto** both return HTTP 500. Of the 7 Entegris use cases, Material
Genealogy and Scrap Pareto Analysis therefore have no working data plane. The other 8 servers
respond and expose 126 tools between them.

This is not something we can fix — the servers are on the developers' side — but it is the
highest-impact availability gap found, since it is the difference between a demoed use case
working and not working.

### A7. FabInsight™ is a card, not an agent

`claudeai_athena/components/cockpit/agent-cards.tsx:32` defines the FabInsight™ card with
`route: "/chat"` — the generic chat page — and hardcoded metrics `num2: "1,284"` and
`delta: "18%"` (line 96). There is no FabInsight-specific backend; of the four marketed agents,
only the Modeling Agent has one. The actual capability lives entirely in the MCP servers.

Flagging this as *underutilized* rather than *broken*: the data plane (doc 11) is real and
substantial. What is missing is anything in this repo that routes a user to it as a
distinguishable product surface.

### A8. `error_catalog` falls back to hardcoded defaults

`claudeai_athena/lib/errors/error-catalog-loader.ts` reads the `error_catalog` DB table with a
TTL cache and falls back to hardcoded defaults when it is empty. The table has **no `CREATE`
statement anywhere in the repo** (see [`files/error-audit.md`](./files/error-audit.md)) — which
is exactly the gap behind the `pg_dump --schema-only` request to Jothi. Five copies of the
catalog exist across the two apps. Until the table is created and seeded, the admin-managed
error catalog is a feature that exists in code and does nothing in production.

---

## Group B — Cost & correctness defects

These produce wrong numbers today. Both are in one file and are trivial to correct.

### B1. Admin over-states Opus cost by 3×

| Model id | Fab (`claudeai_athena/lib/model-pricing.ts:29-32`) | Admin (`admin_athena/lib/model-pricing.ts:23-25`) | Correct |
|---|---|---|---|
| `claude-opus-4-7` | $5 / $25 | **$15 / $75** | $5 / $25 |
| `claude-opus-4-6` | $5 / $25 | **$15 / $75** | $5 / $25 |
| `claude-opus-4-5-20251101` | $5 / $25 | **$15 / $75** | $5 / $25 |

The published rate for the Opus 4.5/4.6/4.7/4.8 generation is **$5 per million input / $25 per
million output**. Fab is right; **Admin is 3× high**. Admin's numbers are the older Opus 4.0
rate — `claude-opus-4-20250514` genuinely is $15/$75, and it looks like that row was copied
upward when the newer ids were added.

**Consequence:** every cost figure Admin writes — `usage_records`, `prompt_audit_logs` cost
columns, the usage dashboard (`app/api/admin/usage/route.ts`), the CSV export, and the
compliance view — over-reports Opus spend by 3×. Any budgeting or chargeback decision made
from that dashboard is wrong in the expensive direction.

### B2. Admin records $0 for the four newest models

`admin_athena/lib/model-pricing.ts` has **no entry** for `claude-opus-4-8`, `claude-opus-5`,
`claude-sonnet-5`, or `claude-fable-5` — all four of which Fab prices. And the lookup fails
open:

```ts
const rates = modelId ? MODEL_PRICING[modelId] : undefined;
if (!rates) return { inputCost: 0, outputCost: 0, total: 0 };   // line 57
```

An unknown model id yields **zero cost, silently** — no throw, no warning, no log. So Admin
turns on the current-generation models are recorded as free.

Combined with B1, Admin's cost reporting is simultaneously 3× too high on older Opus and 100%
too low on newer models. The two errors do not cancel; they make the totals uninterpretable.

Worth noting the *shape* of the bug as much as the values: a silent `return 0` on an unknown
key means this class of error recurs invisibly every time a model is added. A logged warning —
or reading rates from `model_registry` per A3 — would make it self-announcing.

### B3. Step budgets differ between the apps with no stated rationale

Fab: `stepCountIs(20)` (`claudeai_athena/app/api/chat/route.ts:713`).
Admin: `stepCountIs(10)` (`admin_athena/app/api/admin/chat/route.ts:110`).

Neither has a comment explaining the number, and neither has a per-request token ceiling
independent of step count. Not a defect on its own — flagged because these are the two knobs
that bound worst-case spend per conversation, and right now they are two different unexplained
constants.

---

## Group C — Dead weight

Verified by grepping every import across `app/`, `lib/`, `components/`, `hooks/`, `scripts/`,
and `__tests__/` in each app.

### C1. `xlsx` (SheetJS 0.18.5) — zero imports, known advisories

`claudeai_athena/package.json:75` pins `"xlsx": "^0.18.5"`. **Zero source files import it.**
Spreadsheet work is split between `exceljs` (`lib/validation/xlsx.ts`, `template-check.ts`,
`generate-xlsx.ts`) and `@extend-ai/react-xlsx` (`components/viewers/xlsx-viewer.tsx`, which
moved to the wasm parser at commit `abe8706`). The SheetJS import went away with that move; the
dependency did not.

This matters more than a normal unused dependency: SheetJS 0.18.x carries published
prototype-pollution and ReDoS advisories, and the fixed releases are distributed from SheetJS's
own CDN rather than the npm registry — so `npm audit fix` cannot resolve it and it will keep
showing up in every scan. Removing an unused package is the complete fix here.

**This is the one Group C item worth doing on its own merits**, not just for tidiness.

### C2. `lenis` — zero usage

`claudeai_athena/package.json:52` pins `lenis@^1.3.21` (smooth-scroll library). No import
anywhere in source. Safe to drop.

### C3. `katex` direct dependency — check whether math renders styled

`katex@^0.16.11` is a direct dependency but has **no direct import**, and — more importantly —
**`katex/dist/katex.min.css` is not imported anywhere**, including `globals.css`.
`rehype-katex` (used with `remark-math` in the markdown pipeline) already pulls `katex` as its
own dependency, so the direct pin is redundant.

The absent stylesheet is the substantive part: `rehype-katex` emits KaTeX HTML that renders as
unstyled markup without that CSS. **This one needs a visual check** — ask the model a question
with LaTeX in the answer and look at it. If math renders wrong, this is a small, real UI bug;
if a stylesheet is being pulled in some way we did not find, this drops to a redundant-pin
cleanup.

---

## Group D — Verified healthy (do not churn)

Recorded so this is not re-litigated:

- **Database indexing is thorough.** `admin_athena/prisma/schema.prisma` carries 48
  index/unique declarations, including the composite indexes that matter on the hot paths —
  `Conversation@@index([userId, updatedAt(sort: Desc)])`, `Message@@index([conversationId, createdAt])`,
  `UsageRecord@@index([userId, createdAt])`, `UserSessionLog@@index([userId, loginTime(sort: Desc)])`.
  We found no missing index on a query path we traced. No work needed.
- **The prompt-audit topic classifier costs nothing.** `claudeai_athena/lib/prompt-audit.ts:62–122`
  classifies prompts into the 7 Entegris use-case topics with pure regex — no LLM call. This is
  the *right* pattern and is a good counter-example to "use a model for everything."
- **Fab's prompt caching is correctly built**, including the non-obvious part: it disables
  itself when volatile presigned S3 URLs are in the prefix rather than paying cache writes that
  can never be read (`app/api/chat/route.ts:617–619`). Use it as the reference implementation
  for A1.

---

## What needs a code owner, not us

Three items cannot be resolved by reading code:

1. **`rule-engine.ts` (A5)** — is the CMF remote dry-run intended to be the only gate, or was
   the local pre-flight meant to be wired and missed?
2. **`sql-guard.ts` (A4)** — wire it in, or delete it? Depends on whether the DB role behind
   `$queryRawUnsafe` is already read-only.
3. **The two dead MCP servers (A6)** — needs the developers; they are outside this repo.

And one needs five minutes in a browser: **C3**, whether math renders styled.

## Related

[03 — Review hotspots](./03-review-hotspots.md) ·
[09 — Open questions by purpose](./09-open-questions-by-purpose.md) ·
[11 — MCP server & tool catalog](./11-mcp-server-catalog.md) ·
[07 — Sign-off tracker](./07-signoff-tracker.md)
