# 17 — UI customization: file-by-file implementation spec

> **Status:** 🟠 **Proposal** — nothing here exists. This describes files to create and modify.
> **Baseline:** `abe8706d8ed51709bd316d83783a66e6a8a27f28` (app code unchanged at HEAD `8b304c0`).
> **Read first:** [16 — design plan](./16-ui-customization-design-plan.md). Decision and phase
> references (`D1`–`D8`, `P0`–`P6`) are that document's.
> **No application code has been modified.**

## What this document is

The design plan says *what* to build. This says *which files*, *where*, and *what goes in each*.
Not the code itself — the shape of it: exports, responsibilities, and the non-obvious parts.

Every file is marked **NEW** or **MODIFY**, and files that exist only under one branch of `D1`
are marked **`D1`(a)** or **`D1`(b)**.

**Every file carries a plain-English note** explaining why it exists, written to be readable
without a technical background. The detail underneath it is for whoever builds the thing.

> ⚠️ **P0 is under review.** [P0](#3-p0--tenancy-foundation) is multi-client separation
> infrastructure, not part of the chatbot feature. It may be cut or scheduled separately —
> see [§12](#12-open-p0-may-not-belong-here). Everything from P1 onward is the feature itself.

---

## 1. Conventions this follows

Established by the existing codebase — new files should match:

| Concern | Convention | Example |
|---|---|---|
| DB access | `prisma` singleton, default + named export | `lib/db.ts` |
| Business logic | Plain async functions in `lib/services/*.ts` | `lib/services/role-service.ts` |
| API routes | `app/api/**/route.ts`, one export per HTTP verb | `app/api/admin/roles/route.ts` |
| Auth | `requireAuth` / `requireAdmin`, returning `NextResponse` on failure | `lib/auth-middleware.ts` |
| Agent tools | Plain object: `{ description, inputSchema (zod), execute }` | `lib/admin-tools.ts:27` |
| Audit | `recordAuditLog(tx, entry)` inside a transaction | `lib/services/audit-service.ts` |
| Validation | Zod schemas | `lib/validation.ts` |
| UI components | shadcn/Radix + CVA + `cn()` | `components/ui/*` |

**Two repo-wide facts that shape this spec:**

1. **There is no npm workspace at the root.** The two apps share nothing at build time. Shared
   types are **duplicated with a sync-note header**, exactly as `prisma/schema.prisma` already is
   (admin is source of truth; fab is a synchronized copy).
2. **`admin_athena/prisma/schema.prisma` is the source of truth**; `claudeai_athena/prisma/schema.prisma`
   mirrors it. Both must be edited, then `npm run db:generate` in each.

---

## 2. Directory map

```
admin_athena/
├── prisma/
│   ├── schema.prisma                          MODIFY  source of truth
│   └── migrations/<ts>_tenancy/migration.sql  NEW     P0
├── scripts/
│   └── backfill-default-tenant.ts             NEW     P0, run once
├── lib/
│   ├── tenant-context.ts                      NEW     P0
│   ├── db-tenant.ts                           NEW     P0  ← the scoping guard
│   ├── auth-middleware.ts                     MODIFY  P0
│   ├── admin-tools.ts                         MODIFY  P1  (compose only)
│   ├── admin-tools-ui.ts                      NEW     P1/P3
│   ├── admin-system-prompt.ts                 MODIFY  P1/P3
│   ├── ui-spec/                               NEW     P2   mirror of fab's
│   │   ├── types.ts · schema.ts · validate.ts
│   └── services/
│       ├── tenant-service.ts                  NEW     P0
│       ├── ui-view-service.ts                 NEW     P2
│       └── {admin-user,role,invitation,usage}-service.ts   MODIFY  P0
└── app/
    ├── api/admin/
    │   ├── settings/theme/route.ts             MODIFY  P0
    │   ├── tenants/route.ts                    NEW     P0
    │   ├── tenants/[id]/route.ts               NEW     P0
    │   └── views/…                             NEW     P3
    └── admin/settings/page.tsx                 MODIFY  P1

claudeai_athena/
├── prisma/schema.prisma                        MODIFY  P0  mirror
├── middleware.ts                               NEW     P0  hostname → tenant
├── lib/
│   ├── tenant-context.ts                       NEW     P0
│   ├── db-tenant.ts                            NEW     P0
│   ├── auth-middleware.ts                      MODIFY  P0
│   ├── ui-spec/                                NEW     P2
│   │   ├── types.ts · schema.ts · validate.ts · registry.ts
│   │   ├── bindings.ts                         P4
│   │   └── binding-guard.ts                    P4
│   └── services/ui-view-read-service.ts        NEW     P2
├── components/
│   ├── providers.tsx                           MODIFY  P1
│   └── ui-runtime/                             NEW     P2  D1(a)
│       ├── renderer.tsx · error-fallback.tsx
│       └── nodes/*.tsx
└── app/
    ├── v/[key]/page.tsx                        NEW     P2
    ├── api/tenant-config/route.ts              NEW     P1  (replaces platform-theme)
    ├── api/platform-theme/route.ts             MODIFY  P1  keep as alias
    └── api/views/[key]/{route.ts,data/route.ts,report/route.ts}   NEW  P2/P4/P5
```

---

## 3. P0 — Tenancy foundation

> **What this whole phase is, in plain English:** today the system assumes everyone using it
> belongs to the same organisation. If we put several customers into one installation, we need a
> way to keep them completely separate — separate people, separate factory connections, separate
> branding, separate screens. This phase builds that separation. **It is not part of the
> chatbot feature** and may be dropped — see [§12](#12-open-p0-may-not-belong-here).

### 3.1 `admin_athena/prisma/schema.prisma` — **MODIFY**

> **Why it exists:** this file is the blueprint for everything the system stores — like the plan
> of a filing cabinet, listing which drawers exist and what goes in each. We're adding new
> drawers: one for customers, one for each customer's branding, and two for the screens they've
> designed.

Add the four models from [16 §3](./16-ui-customization-design-plan.md#3-data-model). Then add to
existing models:

| Model | Add |
|---|---|
| `User` | `tenantId String? @map("tenant_id")` + relation + `@@index([tenantId])` |
| `Role` | same |
| `McpConnection` | same |

**Nullable, not required.** Existing rows have no tenant; the backfill fills them, and a later
migration can tighten to non-null once verified. Making it required immediately breaks every
existing row.

**Do not add `tenantId` to** `Conversation`, `Message`, `Artifact`, `UsageRecord`, or `AuditLog` —
they reach tenant through `User`. Denormalising invites the two from drifting.

### 3.2 `claudeai_athena/prisma/schema.prisma` — **MODIFY**

> **Why it exists:** the second app keeps its own copy of the same blueprint. Both have to be
> updated together or the two apps disagree about what's in the filing cabinet.

Mirror. `UiView`/`UiViewVersion` are read by fab, so both need them. Keep the existing
"Synchronized with admin_athena schema" header note accurate.

### 3.3 `admin_athena/lib/db-tenant.ts` — **NEW** ← *the most important file in P0*

> **Why it exists:** a safety gate on the database. Every time the system looks anything up, this
> automatically narrows the search to one customer's records. Without it, we'd be relying on
> every developer remembering to add "…and only for this customer" to every single lookup,
> forever. One forgotten line would show one customer another's data. This makes forgetting
> impossible instead of merely discouraged.

**Purpose:** make tenant scoping structural rather than remembered at each call site. [16 §7](./16-ui-customization-design-plan.md#7-risks)
names a missed scoping path as the top risk; this is the mitigation.

```ts
export function tenantDb(tenantId: string): PrismaClient
export const TENANT_SCOPED_MODELS: readonly string[]
```

**Contains:**
- A Prisma client extension (`prisma.$extends`) with a `query` hook over the models in `TENANT_SCOPED_MODELS`
- On every `findMany` / `findFirst` / `findUnique` / `count` / `update` / `delete`: injects `where.tenantId = tenantId`
- On `create` / `createMany`: injects `data.tenantId`
- Throws if a scoped model is queried through this client without a tenant

**Notes:**
- Extended clients are cheap but not free — memoise per `tenantId` in a `Map`
- `findUnique` cannot take a non-unique `where`; the extension must rewrite it to `findFirst`. Easy to miss and it fails at runtime, not compile time.
- The raw `prisma` export stays available for genuinely cross-tenant work (platform admin, background jobs). **Every use of raw `prisma` on a scoped model becomes a review point** — worth an ESLint rule.

### 3.4 `claudeai_athena/lib/db-tenant.ts` — **NEW**

> **Why it exists:** the same safety gate, for the customer-facing app. Both apps read the same
> database, so both need the same protection.

Duplicated per §1. Add `UiView`/`UiViewVersion` to `TENANT_SCOPED_MODELS`.

### 3.5 `admin_athena/lib/tenant-context.ts` — **NEW**

> **Why it exists:** works out which customer a request belongs to. Every action needs to know
> "who is this for?" before it can do anything safely — this is what answers that.

```ts
export interface TenantContext { tenantId: string; slug: string; name: string }
export async function resolveTenantFromSession(userId: string): Promise<TenantContext | null>
export async function resolveTenantFromHostname(host: string): Promise<TenantContext | null>
export async function requireTenant(req: NextRequest): Promise<TenantContext | NextResponse>
```

Implements `D3`. `requireTenant` returns a `NextResponse` on failure, matching `requireAdmin`.

### 3.6 `claudeai_athena/lib/tenant-context.ts` — **NEW**

> **Why it exists:** same job, in the customer app — with one extra case. The login page has to
> show the right logo *before* anyone has signed in, so at that moment we can't identify the
> customer from the person. We identify them from the web address instead.

Same, plus the pre-auth path: `providers.tsx:196` fetches the theme before any user exists, so
hostname resolution must work unauthenticated.

### 3.7 `claudeai_athena/middleware.ts` — **NEW**

> **Why it exists:** reads the web address someone typed and works out which customer it belongs
> to, before the page starts loading. This is what allows `acme.faborchestrator.ai` to show
> Acme's branding on the sign-in screen.

Next middleware resolving hostname → tenant slug, set on a request header for downstream routes.
Avoids every route re-parsing `Host`.

**Notes:**
- Must not touch the database — Next middleware runs on the edge runtime. Either carry the slug only and let routes look it up, or use a cached map.
- Set `matcher` to skip `_next/*` and static assets.
- **Only needed if `D3` (per-tenant hostnames) is confirmed.** Drop this file if pre-auth branding turns out not to matter.

### 3.8 `admin_athena/lib/services/tenant-service.ts` — **NEW**

> **Why it exists:** the single place where customer records are created and changed. Setting up
> a new customer, renaming one, updating their branding — all of it goes through here, so it
> happens the same way every time and is always recorded in the audit history.

```ts
export interface CreateTenantData { slug: string; name: string; hostname?: string }
export async function listTenants()
export async function getTenant(id: string)
export async function createTenant(data: CreateTenantData, actorId: string)
export async function updateTenant(id: string, data: Partial<CreateTenantData>, actorId: string)
export async function getTenantSettings(tenantId: string)
export async function updateTenantSettings(tenantId: string, data: TenantSettingsPatch, actorId: string)
```

**Contains:** slug validation (URL-safe, reserved words), hostname uniqueness, `TenantSettings`
row created with the tenant, audit entries via `recordAuditLog` inside the transaction — the
pattern at `app/api/admin/settings/theme/route.ts:43-58`.

### 3.9 `admin_athena/lib/auth-middleware.ts` — **MODIFY**

> **Why it changes:** this is the existing security check that confirms who someone is on every
> request. We're adding one more fact for it to report back: which customer they belong to.

Add `tenantId: string | null` to `AuthResult` and `AdminAuthContext`; include `tenantId` in the
user select inside `validateSession`.

**Note:** `AdminAuthContext` is consumed by every admin route. Adding a field is
backward-compatible; changing existing ones is not.

### 3.10 `claudeai_athena/lib/auth-middleware.ts` — **MODIFY**

> **Why it changes:** same addition, in the customer-facing app.

Same, on `AuthResult`. `withAuth` and `getUserFromRequest` pass it through.

### 3.11 `admin_athena/lib/services/*.ts` — **MODIFY** (four files)

> **Why they change:** these four files already manage users, roles, invitations, and usage
> reporting — and they work fine today. They currently assume there's only one organisation, so
> each has to be updated to work with one customer's records at a time. **This is existing,
> working functionality being altered, and none of it is about the chatbot's appearance** — the
> main reason to question whether this phase belongs here at all.

`admin-user-service.ts`, `role-service.ts`, `invitation-service.ts`, `usage-service.ts`: take
`tenantId` and query through `tenantDb(tenantId)` instead of the raw client.

**This is the bulk of P0.** Mechanical, but every missed path is a cross-tenant leak.

### 3.12 `admin_athena/scripts/backfill-default-tenant.ts` — **NEW**

> **Why it exists:** a one-time tidy-up. All the data that exists today belongs to nobody in
> particular. Once the new rules switch on, records without an owner become invisible. This
> assigns everything existing to a first customer so nothing is orphaned.

Creates a `default` tenant, assigns every existing `User`, `Role`, and `McpConnection` to it, and
migrates the `PlatformSettings` singleton into `TenantSettings`.

**Note:** deploys do not run migrations ([doc 05](./05-deployment-and-ci.md) §5.4 — applied
manually). This script is part of the manual sequence and must run **between** schema push and
new code going live.

### 3.13 `admin_athena/app/api/admin/tenants/route.ts` + `[id]/route.ts` — **NEW**

> **Why they exist:** the controls for creating and editing customers. Used by our own staff when
> onboarding someone new — not by customers themselves.

Platform-admin CRUD. `GET`/`POST` and `GET`/`PATCH`. Uses raw `prisma`, not `tenantDb` — this is
the legitimate cross-tenant surface.

> **Open:** who may call these? A tenant admin must not create tenants. This needs a
> platform-admin distinction above the current `isAdmin`, which does not exist today.

### 3.14 Tests — **NEW**

> **Why they exist:** proof that the separation actually works. Two pretend customers are created
> with data, and the tests confirm neither can see the other's. This is the check that the most
> serious risk in the plan has genuinely been dealt with.

`admin_athena/__tests__/tenancy/scoping.test.ts`, run via `node --test` + `tsx`, matching
`test:errors`.

---

## 4. P1 — Prove the loop

> **What this phase is, in plain English:** the smallest possible version of the whole idea. A
> customer types "call us AcmeFab and use our green" and their app changes. Nothing is generated
> and no new screens exist yet — it just proves the full chain works: the agent understands, the
> decision is saved, the app picks it up.

### 4.1 `admin_athena/lib/admin-tools-ui.ts` — **NEW**

> **Why it exists:** the list of new abilities we're giving the agent. Today the agent can manage
> users and roles but cannot touch how the app looks. This file is the menu of appearance-related
> things it's now allowed to do — and, just as importantly, everything not on this list is
> something it cannot do.

```ts
export function getUiTools(adminUserId: string, tenantId: string)
```

**A separate file, not an addition to `admin-tools.ts`** — that file is already 1,503 lines.

| Tool | Input | Does |
|---|---|---|
| `get_appearance` | — | Current settings |
| `set_appearance` | `productName?`, `logoUrl?`, `primaryColor?`, `colorTheme?` | Validates + writes + audits |
| `list_color_themes` | — | The 6 built-ins, so the agent can offer them |

**Contains:** `primaryColor` validated as a hex/oklch string; `colorTheme` validated against
`ALLOWED_THEMES` (already exported from `app/api/admin/settings/theme/route.ts` — import it,
don't restate it); all writes through `tenant-service`.

### 4.2 `admin_athena/lib/admin-tools.ts` — **MODIFY**

> **Why it changes:** this is the existing master list of what the agent can do. Two lines to
> plug the new appearance abilities into it.

Import `getUiTools`, spread it into the returned object. `getAdminTools` gains a `tenantId` parameter.

### 4.3 `admin_athena/app/api/admin/chat/route.ts` — **MODIFY**

> **Why it changes:** this is the agent's conversation handler — where a message arrives and a
> reply comes back. We tell it which customer it's acting for.

Resolve tenant, pass to `getAdminTools`.

**Note:** `stepCountIs(10)` at `:110`, with parallel tool calls disabled at `:113`. A UI request
touching several settings plus a confirmation can exceed ten steps. Watch this; raising it is a
one-line change but should be deliberate.

### 4.4 `admin_athena/lib/admin-system-prompt.ts` — **MODIFY**

> **Why it changes:** the agent's standing instructions — the briefing it reads before every
> conversation. We add a section telling it that it can now change how the app looks, what it may
> change, and that changes take effect immediately for everyone at that customer.

A section describing the appearance tools and their limits.

### 4.5 `claudeai_athena/app/api/tenant-config/route.ts` — **NEW**

> **Why it exists:** when the customer's app starts up it asks "what should I look like?" This
> answers — with the product name, logo, and colours.

Public `GET`, no auth. Resolves tenant by hostname, returns `{ colorTheme, productName, logoUrl,
primaryColor }`, `Cache-Control: no-store`, safe default on any error. Keep the existing
try/catch-with-fallback shape — the login page must render even if this fails.

### 4.6 `claudeai_athena/app/api/platform-theme/route.ts` — **MODIFY**

> **Why it changes:** the older, simpler version of the file above. We keep it working for a
> while so nothing breaks in the window where some code has been updated and some hasn't.

Thin alias returning only `colorTheme`. Delete once `providers.tsx` is confirmed migrated.

### 4.7 `claudeai_athena/components/providers.tsx` — **MODIFY**

> **Why it changes:** this runs the moment the app opens in someone's browser. It already fetches
> the colour scheme; we extend it to also fetch the product name and logo and put them on screen.

At `:196`, switch to `/api/tenant-config` and apply the extra fields: `primaryColor` as a CSS
custom property on `documentElement`, `productName`/`logoUrl` into a small context.

**Note:** this runs client-side on mount, so branding paints one frame late. Acceptable for a
theme; more visible for a logo. Server-rendering it in `app/layout.tsx` is the fix if it looks
wrong — decide after seeing it.

---

## 5. P2 — Definition store and renderer

> **What this phase is, in plain English:** the machinery that turns a saved screen design into
> a real screen. After this, a design written by hand appears as a working page. The agent isn't
> involved yet and there's no live data yet — this is the engine, tested on its own.

### 5.1 `claudeai_athena/lib/ui-spec/types.ts` — **NEW**

> **Why it exists:** the vocabulary. A written list of every building block a screen can be made
> from — a table, a search box, a chart, a heading. This is the shared language: the agent can
> only ask for things on this list, and the app knows how to draw everything on it.

```ts
export type SpecNode = ContainerNode | TableNode | SearchNode | StatNode | ChartNode | TextNode
export interface ViewSpec { version: 1; root: SpecNode; bindings: BindingRef[] }
```

Keep it small — **six node types is a better v1 than twenty**, and the stated need is a search box
and a table.

### 5.2 `claudeai_athena/lib/ui-spec/schema.ts` — **NEW**

> **Why it exists:** the rulebook that checks the agent's work. Before any design is saved, this
> confirms it's properly formed — a bit like spellcheck, but for layouts. This is what makes it
> true that the agent cannot save something broken.

Zod mirror of `types.ts`. Recursive (`z.lazy`) for containers. Must be strict: `.strict()` on
every object so unknown props are rejected rather than silently ignored.

### 5.3 `claudeai_athena/lib/ui-spec/validate.ts` — **NEW**

> **Why it exists:** the fuller inspection. Beyond "is it well-formed", it checks the design isn't
> absurdly large and isn't referring to data it hasn't been given permission to use. When
> something is wrong it explains why *in words the agent can read*, so the agent can correct
> itself rather than a person having to.

```ts
export function validateSpec(input: unknown): { ok: true; spec: ViewSpec } | { ok: false; errors: string[] }
```

Depth limit, node-count limit, unique node ids, every `BindingRef` resolves to a declared binding.

### 5.4 `claudeai_athena/lib/ui-spec/registry.ts` — **NEW** · `D1`(a)

> **Why it exists:** the lookup table connecting each building block's name to the real thing that
> draws it. Keeping it in one place means the agent can never offer a customer something that
> doesn't actually exist — the list it reads from *is* the list of what works.

Maps node type → React component. One place to add a component; the agent's `list_components` tool
reads from it.

### 5.5 `claudeai_athena/components/ui-runtime/renderer.tsx` — **NEW** · `D1`(a)

> **Why it exists:** the part that turns a saved design into an actual screen — reading the
> design and drawing it piece by piece. If one piece fails, it's contained so the rest of the
> page still works.

```tsx
export function SpecRenderer({ spec, data }: { spec: ViewSpec; data: BindingData })
```

Recursive walk, registry lookup, error boundary per node.

### 5.6 `claudeai_athena/components/ui-runtime/nodes/*.tsx` — **NEW** · `D1`(a)

> **Why they exist:** one small file per building block — the table, the search box, the chart.
> Each knows how to draw itself. Most are thin wrappers around parts the app already has, so this
> is less work than it sounds.

One per node type, over existing `components/ui/*` (`table.tsx`, `input.tsx`, `card.tsx`,
`badge.tsx`, `tabs.tsx` all exist). **No data fetching inside a node** — data arrives as props (P4).

### 5.7 `admin_athena/lib/ui-spec/{types,schema,validate}.ts` — **NEW**

> **Why they exist:** a copy of the vocabulary and rulebook on the agent's side, so it can check
> its work before saving rather than saving something broken and finding out later. The two
> copies must be kept identical — the same arrangement already used for the database blueprint.

Admin does **not** need `registry.ts` or the node components — it never renders views.

### 5.8 `admin_athena/lib/services/ui-view-service.ts` — **NEW**

> **Why it exists:** where screen designs are saved, published, and undone. Every save creates a
> new numbered version and old versions are never overwritten — so going back to yesterday's
> version is always possible, instantly.

```ts
export async function listViews(tenantId: string)
export async function getView(tenantId: string, key: string)
export async function createViewVersion(tenantId, key, definition, actorId)
export async function publishVersion(tenantId, viewId, versionId, actorId)
export async function rollbackView(tenantId, viewId, actorId)
```

**Contains:** validation before any write (`D5` — invalid never persists); monotonic `version`
allocated inside the transaction; `publishVersion` sets `liveVersionId`; audit entries.

**Note:** allocate `version` inside a transaction, not `count() + 1` outside one — two concurrent
saves would collide on `@@unique([viewId, version])`.

### 5.9 `claudeai_athena/lib/services/ui-view-read-service.ts` — **NEW**

> **Why it exists:** the customer app's read-only access to screen designs. It can look them up
> but never change them — designs are only ever written from the admin side.

`getLiveView(tenantId, key)` — live version only.

### 5.10 `claudeai_athena/app/api/views/[key]/route.ts` — **NEW**

> **Why it exists:** the request the app makes when it needs to fetch a particular screen's design.

`GET` — authed, tenant-scoped. 404 if absent or unpublished.

### 5.11 `claudeai_athena/app/v/[key]/page.tsx` — **NEW**

> **Why it exists:** the actual web page an operator opens. It fetches the design, shows it, and
> handles the cases where it's still loading, doesn't exist, or went wrong.

Follows the existing client-side session-check pattern (`app/chat/page.tsx`).

### 5.12 `D1`(b) alternative — replaces 5.4–5.6

> **Why these would exist:** only if we go the "agent writes real code" route. Then we need a
> sealed container to run that code inside, so a mistake can't damage the rest of the app, plus a
> strictly controlled hatch for passing data in and out. This is the extra machinery that the
> building-block approach doesn't need.

| File | Purpose |
|---|---|
| `components/ui-runtime/sandbox-host.tsx` | iframe host, `postMessage` channel, timeout, crash detection |
| `components/ui-runtime/sandbox-bridge.ts` | Message protocol — the complete definition of what generated code may do |
| `lib/ui-spec/capabilities.ts` | Per-view capability grants enforced at the bridge |
| `public/ui-sandbox.html` | Sandbox document; needs styling shipped in |

`lib/artifact-parser.ts` and `lib/sandpack-deps.ts` are reusable. `sandpack-preview.tsx` is not —
it loads Tailwind from `cdn.tailwindcss.com` (`:43`), fine for a chat preview, wrong for an
operator console.

**Everything else in this document is unchanged by `D1`.**

---

## 6. P3 — Agent authoring

> **What this phase is, in plain English:** the agent starts actually making screens. Up to now
> designs had to be written by hand; now a customer describes what they want and the agent
> produces it.

### 6.1 `admin_athena/lib/admin-tools-ui.ts` — **MODIFY**

> **Why it changes:** the agent's menu of abilities grows from "change the colours" to "design,
> preview, publish, and undo whole screens".

| Tool | Plain English |
|---|---|
| `list_views` | What screens does this customer already have? |
| `list_components` | What building blocks may I use? *(read from the schema, never hand-written)* |
| `list_data_sources` | What factory data has this customer connected? |
| `create_view` / `update_view` | Design or change a screen |
| `preview_view` | Show it to someone before it goes live |
| `publish_view` | Make it live |
| `rollback_view` | Put the previous version back |

**The critical detail:** validation errors must come back as a normal tool result, not a thrown
exception. That turns a bad generation into a retry inside the same turn.

### 6.2 `admin_athena/app/api/admin/views/*` — **NEW**

> **Why they exist:** the same abilities, reachable by ordinary buttons rather than by chatting.
> Useful for a management screen later, and for anything the agent shouldn't be the only route to.

Route parity with the tools, both over `ui-view-service`.

### 6.3 `claudeai_athena/app/api/views/[key]/preview/route.ts` — **NEW**

> **Why it exists:** lets someone look at a design before it goes live to operators.

Short-lived signed token. **Must not** accept an arbitrary version id from a normal session.

---

## 7. P4 — Live data

> **What this phase is, in plain English:** until now the screens show placeholder numbers. This
> connects them to the customer's real factory data.

### 7.1 `claudeai_athena/lib/ui-spec/bindings.ts` — **NEW**

> **Why it exists:** describes how a screen is wired to real data — which piece of factory
> information feeds which part of the page.

```ts
export interface Binding { id: string; connectionId: string; toolName: string; params: Record<string, unknown> }
export type BindingData = Record<string, { status: 'ok'|'error'|'loading'; rows?: unknown[]; error?: string }>
```

### 7.2 `claudeai_athena/lib/ui-spec/binding-guard.ts` — **NEW** ← *the `D6` enforcement point*

> **Why it exists:** the gatekeeper for data. Before a screen is allowed to fetch anything, this
> checks three things: that the request was part of the approved design, that it belongs to this
> customer, and that this person is allowed to see it. Without it, a screen could ask the factory
> system for anything at all.

```ts
export async function assertBindingAllowed(tenantId, userId, binding): Promise<void>
```

Checks in order: (1) declared on the **stored** version, never trusted from the request;
(2) connection belongs to this tenant and is authorized for this user's role — reuse
`chat/route.ts:432-447`; (3) tool is on the read allowlist (`D7`).

**Note:** MCP tool metadata does not reliably mark read vs write. Until it does, the allowlist is
explicit per connection and set by an admin — **manual work, worth stating plainly.**

### 7.3 `claudeai_athena/app/api/views/[key]/data/route.ts` — **NEW**

> **Why it exists:** fetches the live factory numbers a screen needs. If one source is slow or
> down, it returns what it can rather than leaving the operator with a blank page.

`POST` with binding ids → `assertBindingAllowed` → `executeMcpTool` from `lib/mcp-client.ts`.
Per-binding timeout, **partial results returned**. Two of ten registered servers were already
down at last check ([doc 11](./11-mcp-server-catalog.md)) — a live condition, not hypothetical.

### 7.4 `claudeai_athena/components/ui-runtime/renderer.tsx` — **MODIFY**

> **Why it changes:** now that data can be loading, missing, or failed, each part of the screen
> needs to say so clearly rather than showing nothing.

Accept `BindingData`; nodes render loading, error, and empty states per binding.

---

## 8. P5 — Safety and operations

> **What this phase is, in plain English:** because nobody reviews the agent's work before it goes
> live, the system has to catch its own mistakes. This is what replaces a human checking.

| File | Change | Plain English |
|---|---|---|
| `components/ui-runtime/error-fallback.tsx` | **NEW** | What an operator sees if a screen breaks — plain language and who to contact, not technical error text |
| `app/v/[key]/page.tsx` | **MODIFY** | If the current version won't load, quietly fall back to the last one that worked |
| `app/api/views/[key]/report/route.ts` | **NEW** | Lets the app tell us a screen failed, so we find out before the customer calls |
| `lib/services/ui-view-service.ts` | **MODIFY** | If a version keeps failing, put the previous one back automatically |
| `admin_athena/app/admin/views/page.tsx` | **NEW** | A list of versions with an undo button, for when clicking is faster than asking the agent |

Audit actions to add: `ui.view.published`, `ui.view.rolled_back`, `ui.view.auto_rolled_back`,
`ui.appearance.changed`.

---

## 9. P6 — Actions *(only if `D7` is overturned)*

> **What this phase is, in plain English:** letting operators *do* things from generated screens —
> press a button that changes something in the factory system — rather than only looking. Left
> out of the first version deliberately: a mistake here changes real factory records.

- `lib/ui-spec/actions.ts` — action node types, each naming a write tool
- `lib/ui-spec/action-guard.ts` — separate allowlist from reads; **never** share one
- `app/api/views/[key]/action/route.ts` — executes, with confirmation and mandatory audit
- `components/ui-runtime/nodes/action-button.tsx` — requires explicit confirmation UI

---

## 10. Build order within a phase

The dependency that bites: **`db-tenant.ts` (§3.3) before any service edit (§3.11).** Doing the
services first means editing them twice.

Per phase: schema in both apps → `db:generate` → scoping guard + tests → services → routes →
agent tools → UI.

---

## 11. What this spec does not settle

- **Who may create tenants** (§3.13) — needs a platform-admin role that does not exist
- **Read/write MCP tool classification** (§7.2) — manual until MCP metadata supports it
- **Whether branding server-renders** (§4.7) — decide after seeing the flash
- **`D1`** — §5.12 lists what changes; nothing else does

---

## 12. Open: P0 may not belong here

> **In plain English:** everything in P0 is about keeping multiple customers separate inside one
> installation. That's real work and will matter eventually — but it is not part of letting a
> customer change how their app looks, and it's the largest phase in the plan.

If two customers do **not** share one installation today, P0 can be cut entirely. The existing
global settings already work for a single customer, and P1–P5 can be built against them.

**Cheap insurance if P0 is cut:** route every configuration and view read through one accessor
(`getClientConfig()`, `getLiveView()`) that currently ignores customer identity. Adding it later
changes those two functions rather than every place that calls them — the same seam used for
`D1`.

**The question this turns on:** do two customers share one installation now, or within the next
few months? If not, cutting P0 removes the largest phase, avoids altering four working services
(§3.11), and removes the plan's most serious risk.

---

## Related

[16 — Design plan](./16-ui-customization-design-plan.md) ·
[15 — Decision brief](./15-ui-customization-decision-brief.md) ·
[11 — MCP server & tool catalog](./11-mcp-server-catalog.md) ·
[05 — Deployment & CI](./05-deployment-and-ci.md) ·
[01 — File catalog](./01-file-catalog.md)
