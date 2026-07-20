# `lib/admin-tools.ts` — the ~30 AI chat tools that *are* the admin API surface

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Admin** (`admin_athena/lib/admin-tools.ts`; no Fab copy — see Both-apps note) ·
> Review priority: **High** ·
> Catalog row: [01 — File catalog §B.1](../01-file-catalog.md) · Hotspot: [03 §1 row 20](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

`getAdminTools(adminUserId)` returns the object of **31 Vercel AI SDK (v6) tools** that
Claude drives during a NexusOps admin chat. In this app there is effectively **no separate
REST admin API for mutations** — user/role/invitation/MCP management and the four REQ audit
subsystems (session, error, prompt, error-catalog) are all reached by the model calling
these tools. So this file *is* the admin write surface. The header comment claims "Each
tool calls the same service layer as the API routes"; that is **only partly true** — about
half the mutating tools delegate to `services/*`, and the rest hit Prisma or raw SQL
directly (see the table and Failure modes).

**⚠️ Corrections to the hotspots doc (verified at the pinned commit), covered in full
under Failure modes:**
- Row 20 says "`confirm=true` **+ 'never delete last admin'** enforced in code, not just
  prompt." The **`confirm=true`** guard is real code in five tools — but there is **no
  last-admin check anywhere in this file** (and per [03 §21] none in `deleteUser` either).
- [03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions) lists
  **`purgeOldSessionLogs`** and **`bulk_assign_role`** among "admin destructive tools …
  confirm the `confirm=true` guard." At `7976c78` **`purgeOldSessionLogs` is not a chat
  tool at all** (it's a `session-audit.ts` export run by the background
  `session-retention-worker.ts`), and **`bulk_assign_role` has no `confirm` parameter** —
  it mutates on the first call.

## Depends on / consumed by

**Depends on:**
- `zod` — every tool's `inputSchema`.
- `services/*` (the shared business core, also used by any REST routes):
  [`admin-user-service`](./admin-user-service.md) (`listUsers`, `updateUserStatus`,
  `changeUserRole`, `forcePasswordReset`, `deleteUser`), `role-service`
  (`listRoles`/`createRole`/`updateRole`/`deleteRole`),
  [`invitation-service`](./invitation-service.md)
  (`createInvitation`/`listInvitations`/`revokeInvitation`/`resendInvitation`),
  `usage-service` (`getSystemUsageSummary`). These services own the DB transactions,
  SMTP sends, and their own `audit_logs` writes.
- `./db` (Prisma) — used **directly** by several tools (see table), bypassing the services.
- Dynamic imports of the raw-SQL audit query/purge helpers:
  [`session-audit`](./session-audit.md) (`querySessionLogs`),
  [`prompt-audit`](./prompt-audit.md) (`queryPromptAudit`, `purgeOldPrompts`),
  [`errors/error-audit`](./error-audit.md) (`queryErrorAudit`, `markErrorResolved`,
  `purgeOldErrors`), and `@/lib/encryption` (`encrypt`, for API-keyed MCP creds).
- Eight `prisma.$queryRawUnsafe` calls **inside this file** — six in
  `prompt_quality_summary`, one in `list_error_catalog`, one **`UPDATE error_catalog`** in
  `update_error_catalog_message` (the audit tables aren't in `schema.prisma`, so they're
  reached by raw SQL). All eight parameterize user values (`$1…`); the only interpolated
  piece is the `WHERE` clause assembled from a fixed allow-list of columns. These raw
  statements **do not pass through [`sql-guard.ts`](./sql-guard.md)** — but sql-guard is a
  bypassable regex allowlist that is unused at runtime anyway ([03 §5]).

**Consumed by** (verified by grep at the pinned commit): **exactly one file** —
`admin_athena/app/api/admin/chat/route.ts`, which calls `getAdminTools(auth.user.id)` and
passes the whole object to `streamText`. That route is fronted by **`requireAdmin`**
([auth-middleware.md](./auth-middleware.md)), and the tools **trust that gate** — none of
them re-check `isAdmin`/`status` ([03 §2](../03-review-hotspots.md#2-security--authorization)).
Nothing else imports this module.

## Function-by-function

All 31 tools live inside the single `getAdminTools(adminUserId)` factory; `adminUserId` is
captured in the closure and used as the actor for every mutation and self-audit write.
Module-level helper `resolveUserId(userId?, userEmail?)` does a case-insensitive email →
id lookup. Almost every `execute` wraps its body in `try/catch` and returns `{ error }`
(or a `needs*` prompt-for-more object) rather than throwing — **the model, not the app,
decides what to do with a failure.**

**Side-effect legend:** **[read]** DB read only · **[write]** persistent mutation ·
**[DESTRUCTIVE]** irreversible delete / bulk / hard overwrite.
**Path:** *service* = delegates to `services/*` · *Prisma* = direct `prisma.*` ·
*raw SQL* = `$queryRawUnsafe` or a dynamic-imported raw-SQL helper.
**confirm:** `code` = a `confirm` param is checked in the tool body before the effect ·
`—` = no confirm param.
**self-logs:** whether the tool itself writes an `audit_logs` row (service-delegating
tools instead rely on the service to log; "via service" noted).

| # | Tool | Purpose | Class | Path | confirm | self-logs `audit_logs` |
|---|------|---------|-------|------|---------|------------------------|
| 1 | `list_users` | List users (search/status/role filters) | read | service | — | — |
| 2 | `invite_user` | Send an invitation email, user sets own password | write | service (+Prisma role lookup) | — | via service |
| 3 | `suspend_user` | Suspend account **+ delete all sessions** | write | service | — | via service |
| 4 | `activate_user` | Re-activate a suspended user | write | service | — | via service |
| 5 | `bulk_assign_role` | Assign a role to **many** users at once | **DESTRUCTIVE** (bulk) | **Prisma** (`updateMany`) | **—** | **no** |
| 6 | `change_user_role` | Change one user's role | write | service (+Prisma lookups) | — | via service |
| 7 | `force_password_reset` | Force reset email (7-day link) + logout | write | service | — | via service |
| 8 | `list_roles` | List roles + member counts | read | service | — | — |
| 9 | `create_role` | Create a role (prompts for models if absent) | write | service (+Prisma) | — | via service |
| 10 | `delete_user` | **Permanently** delete a user + data | **DESTRUCTIVE** | service | **code** | via service |
| 11 | `update_role` | Edit a role's fields/limits/MCP | write | service (+Prisma) | — | via service |
| 12 | `delete_role` | Delete a custom role | **DESTRUCTIVE** | service (+Prisma detail read) | **optional/advisory** | via service |
| 13 | `list_invitations` | List invitations + status | read | service | — | — |
| 14 | `revoke_invitation` | Revoke a pending invitation | write | service | — | via service |
| 15 | `resend_invitation` | New token + reset 7-day expiry | write | service | — | via service |
| 16 | `add_mcp_to_role` | Attach a role-level MCP (encrypts key) | write | **Prisma** (`create`) + crypto | — | **no** |
| 17 | `list_role_mcps` | List role-level MCP connections | read | **Prisma** | — | — |
| 18 | `query_user_mcp_tools` | Inspect one user's personal+role MCP tools | read | **Prisma** | — | **yes** (`mcp_audit_query`) |
| 19 | `remove_role_mcp` | Delete a role-level MCP connection | **DESTRUCTIVE** | **Prisma** (`delete`) | **code** | **no** |
| 20 | `check_usage` | System-wide usage summary | read | service | — | — |
| 21 | `query_cmf_runs` | Query CMF LOAD/VALIDATE runs | read | **Prisma** (`run.findMany`) | — | — |
| 22 | `list_audit_logs` | View recent `audit_logs` entries | read | **Prisma** | — | — |
| 23 | `query_user_sessions` | REQ-02 session-audit query | read | **raw SQL** (`querySessionLogs`) | — | **yes** (`session_audit_query`) |
| 24 | `query_error_audit` | REQ-03 error-audit query | read | **raw SQL** (`queryErrorAudit`) | — | **yes** (`error_audit_query`) |
| 25 | `mark_error_resolved` | Mark one `error_audit_logs` row RESOLVED | write | **raw SQL** (`markErrorResolved`) | — | **yes** (`error_audit_resolve`) |
| 26 | `purge_old_errors` | Run the 90-day error-audit retention sweep | **DESTRUCTIVE** | **raw SQL** (`purgeOldErrors` DELETE) | **code** | **yes** (`error_audit_purge`) |
| 27 | `query_prompt_audit` | REQ-04 prompt-audit query (incl. cost) | read | **raw SQL** (`queryPromptAudit`) | — | **yes** (`prompt_audit_query`) |
| 28 | `purge_old_prompts` | Run the 90-day prompt-audit retention sweep | **DESTRUCTIVE** | **raw SQL** (`purgeOldPrompts` DELETE) | **code** | **yes** (`prompt_audit_purge`) |
| 29 | `prompt_quality_summary` | Aggregate quality/cost metrics | read | **raw SQL** (6× `$queryRawUnsafe`) | — | **yes** (`prompt_quality_summary`) |
| 30 | `list_error_catalog` | List the 10 canonical error messages | read | **raw SQL** (`$queryRawUnsafe` SELECT) | — | — |
| 31 | `update_error_catalog_message` | Edit ONE error type's user-facing message | **DESTRUCTIVE** (overwrite) | **raw SQL** (`UPDATE error_catalog`) + Prisma | **code** | **yes** (`error_catalog_update`) |

**Read-side note (11 read tools, 23/24/27/29):** every audit *read* tool also
fire-and-forgets an `audit_logs` row recording the query itself (`… .catch(() => {})`),
implementing the "REQ-02 #4"-style "every audit query is itself audited" rule. A failure to
write that meta-audit row is silently swallowed.

### Deep-dives — the destructive / raw-SQL tools

Below, each `confirm` guard is quoted from the tool body so a reviewer can see exactly what
is (and isn't) enforced in code.

#### `delete_user` — [DESTRUCTIVE], service, **confirm enforced in code**

```
execute: async ({ userId, userEmail, confirm }) => {
  if (!confirm) return { error: 'Set confirm=true to proceed with deletion' };
  const id = await resolveUserId(userId, userEmail);
  if (!id) return { error: 'Provide userId or userEmail' };
  ... await deleteUser(id, adminUserId, 'chat-admin');
```

`confirm` is a **required** `z.boolean()`, and the body refuses to proceed without it — a
genuine code gate, not description-only. It then delegates to
[`deleteUser`](./admin-user-service.md) (the shared service, which logs to `audit_logs`).
**There is no "never delete the last admin" check here**, and per [03 §21] the service only
blocks *self*-deletion — so the model can delete any other admin, including the last one
besides itself. `ipAddress` is hard-coded `'chat-admin'` for all chat-path mutations.

#### `bulk_assign_role` — [DESTRUCTIVE bulk], **direct Prisma, NO confirm, NO self-audit**

Resolves the role, builds a `where` from either `allWithoutRole` (`roleId: null`) or a
lower-cased `userEmails` `in`-list (minus `excludeEmails`), then:

```
const updated = await prisma.user.updateMany({
  where: { id: { in: users.map(u => u.id) } },
  data: { roleId: resolvedRoleId },
});
```

This is the clearest divergence from the "same service layer" comment and from
[03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions): the input schema
has **no `confirm` field at all**, so the very first call mutates every matching user's
role. It bypasses `changeUserRole`/`role-service`, so **no `audit_logs` row is written** for
a change that can touch many accounts (e.g. `allWithoutRole=true`). Only guard against a
runaway is the caller-supplied `excludeEmails`.

#### `delete_role` — [DESTRUCTIVE], service, **confirm optional / advisory-only**

`confirm` is `z.boolean().optional()`. When it is falsy the tool returns a
`needsConfirmation` object with `isSystemRole`, `userCount`, and a computed
`canDelete: !role.isSystemRole && role._count.users === 0`. **But that guard is advisory
only** — if the model calls with `confirm: true` on the *first* call, the body skips the
preview branch entirely and goes straight to `deleteRole(resolvedId, adminUserId, …)`. The
real "can't delete system roles / roles with users" protection therefore lives in the
`role-service`, **not** in this tool body; the tool's own `canDelete` flag is never
re-checked before the service call.

#### `remove_role_mcp` — [DESTRUCTIVE], direct Prisma, **confirm enforced in code, NO self-audit**

```
if (!confirm) return { error: 'Set confirm=true to proceed' };
const conn = await prisma.mcpConnection.findUnique({ where: { id: mcpId } });
if (!conn) return { error: 'MCP connection not found' };
if (conn.userId) return { error: 'This is a personal MCP, not a role-level one' };
await prisma.mcpConnection.delete({ where: { id: mcpId } });
```

`confirm` is required and checked — a real code gate. It also refuses to delete a *personal*
MCP (`conn.userId` set). But the delete is a direct Prisma call with **no `audit_logs`
write**, so removing a role's MCP access leaves no admin-audit trail.

#### `purge_old_errors` / `purge_old_prompts` — [DESTRUCTIVE], raw SQL, **confirm enforced in code**

Both are identical in shape: `confirm` is a **required** `z.boolean()`, and the body is
`if (!confirm) return { error: 'Set confirm=true to proceed.' }` before dynamic-importing
and awaiting `purgeOldErrors()` / `purgeOldPrompts()` (raw-SQL `DELETE` of rows older than
90 days — see [error-audit.md](./error-audit.md) / [prompt-audit.md](./prompt-audit.md)).
Each then fire-and-forgets an `audit_logs` row (`error_audit_purge` / `prompt_audit_purge`)
with the deleted count. Note these are the **manual** sweeps; whether anything runs them on
a schedule is an open question ([03 §6](../03-review-hotspots.md#un-scheduled-retention)).

#### `update_error_catalog_message` — [DESTRUCTIVE overwrite], raw SQL, **confirm enforced in code**

The only tool here that mutates via a hand-written `$queryRawUnsafe`:

```
if (!confirm) return { error: 'Set confirm=true to proceed. ...' };
const trimmed = newMessage.trim();
... UPDATE error_catalog SET user_message = $1, updated_at = NOW(), updated_by = $2
    WHERE error_type = $3 RETURNING ...
```

`confirm` is required and checked; `newMessage` is Zod-bounded (1–500 chars) and re-trimmed;
`error_type` is a Zod `enum` of the 10 canonical types; the editor's email is resolved from
`adminUserId` for the `updated_by` trail. All three values are **parameterized** (`$1..$3`).
It self-logs `error_catalog_update`. This edits the live user-facing error text the Fab app
renders (propagating within the ~60 s catalog cache TTL), so it changes end-user behaviour
without a deploy — powerful, and the only in-body code protection is the `confirm` flag.

## Failure modes & gotchas

- **Service-bypass inconsistency (the headline finding, [catalog §B.1]/[03 §4]).** The
  file comment says every tool "calls the same service layer," but **`bulk_assign_role`,
  `add_mcp_to_role`, `remove_role_mcp`** and all the audit/purge/error-catalog tools go
  **direct to Prisma / raw SQL**. Consequences: invariants and the automatic `audit_logs`
  write that `services/*` guarantee are **not uniformly applied on the chat path** — in
  particular the three direct-Prisma mutations (#5, #16, #19) write **no admin-audit row at
  all**, so bulk role changes and MCP add/remove are invisible in `list_audit_logs`.
- **No `isAdmin` re-check in any tool ([03 §2]).** Every tool trusts that
  `/api/admin/chat` ran `requireAdmin`. That is true at this commit (the route awaits
  `requireAdmin` before building the tools), but the tools have no defense of their own — a
  new consumer that forgot the gate would expose the entire admin write surface.
- **No last-admin protection — anywhere.** Neither `delete_user` (this file) nor
  `deleteUser` (the service, per [03 §21]) prevents deleting the last remaining admin; the
  service only blocks self-deletion. **Row 20's claim that a "never delete last admin"
  check is "enforced in code" is not supported by the code at `7976c78`.** The system
  prompt may *assert* the rule to the model, but nothing structural enforces it.
- **`bulk_assign_role` has no confirm and no audit** — see deep-dive. It is listed in
  [03 §4] as a tool whose `confirm=true` guard should be verified; there is **no such guard
  to verify**. A single call with `allWithoutRole: true` re-roles every unroled user.
- **`purgeOldSessionLogs` is not a tool here.** [03 §4] groups it with the admin
  destructive *tools*, but it is a `session-audit.ts` export invoked only by the background
  `session-retention-worker.ts` — it is **not LLM-reachable through this file**. (Its
  sibling purges *are* exposed as `purge_old_errors`/`purge_old_prompts`.)
- **`delete_role` confirm is skippable.** The `canDelete`/system-role/user-count preview
  only runs when `confirm` is falsy; a first call with `confirm:true` bypasses it and
  relies entirely on `role-service` to reject bad deletes. Confirm the service actually
  enforces those guards.
- **Raw SQL bypasses `sql-guard`.** The 8 `$queryRawUnsafe` calls (6 in
  `prompt_quality_summary`, plus `list_error_catalog` and the `UPDATE error_catalog`) never
  touch [`sql-guard.ts`](./sql-guard.md). They are parameterized and their only interpolated
  fragment is a `WHERE` built from a fixed column allow-list — but sql-guard being unused
  here means it is not the boundary; the parameterization is. Confirm no future filter
  routes user text into the interpolated `conds`.
- **Errors are model-visible strings, not exceptions.** Tools return `{ error }` on
  failure, so a DB outage mid-conversation degrades into text the model paraphrases;
  little is logged server-side from this file. `query_cmf_runs` even guesses "table
  missing?" in its catch.
- **All chat mutations record `ipAddress: 'chat-admin'`** (a literal), so the real admin
  IP is not captured for chat-driven changes.
- **NUMERIC → JS `Number` in `prompt_quality_summary`** ([03 §3]) — token/cost sums and
  `avgPerPrompt` are coerced through `Number(...)`; verify precision/rounding of the USD
  totals.

## Open questions for the code owner

1. **Last-admin protection:** row 20 asserts it is "enforced in code" — it is **not** in
   this file, and per [03 §21] not in `deleteUser` either. Is that acceptable, or should a
   real guard be added (and where)?
2. **`bulk_assign_role`:** intended to have *no* `confirm` and *no* `audit_logs` write for
   a potentially many-user role change? Should it route through `changeUserRole`/the service
   like `change_user_role` does?
3. **`add_mcp_to_role` / `remove_role_mcp`:** should these direct-Prisma MCP mutations write
   an `audit_logs` row (they currently don't), given every other admin mutation does?
4. **`delete_role`:** is it intended that a `confirm:true` first call skips the
   system-role/user-count preview and relies solely on `role-service`?
5. **Retention:** what actually runs `purge_old_errors`/`purge_old_prompts` (and
   `purgeOldSessionLogs`) on a schedule, or are they manual-only?
   ([03 §6](../03-review-hotspots.md#un-scheduled-retention).)
6. **AuthZ:** confirm `/api/admin/chat` is the *only* consumer and always wraps
   `requireAdmin`, since no tool re-checks admin status.
7. **`update_error_catalog_message`:** confirm it is acceptable that admin chat can rewrite
   live user-facing error text (10 canonical types) with only the `confirm` flag as the
   in-code guard.

## Both-apps note

**Admin only.** Verified at the pinned commit: `claudeai_athena` (Fab) has no
`admin-tools.ts` and no importer of `getAdminTools`. Fab's chat exposes an entirely
separate, unrelated belt — [`lib/chat-cmf/tools.ts`](./chat-cmf-tools.md) (the Modeling
Agent's CMF tools) plus dynamic MCP tools from [`lib/mcp-client.ts`](./mcp-client.md). The
two apps' tool belts share no code and integrate only through the shared Postgres DB.

---

Related pages: [auth-middleware.md](./auth-middleware.md) ·
[admin-user-service.md](./admin-user-service.md) ·
[invitation-service.md](./invitation-service.md) · [session-audit.md](./session-audit.md) ·
[prompt-audit.md](./prompt-audit.md) · [error-audit.md](./error-audit.md) ·
[sql-guard.md](./sql-guard.md)
