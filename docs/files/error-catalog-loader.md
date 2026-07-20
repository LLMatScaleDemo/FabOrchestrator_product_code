# `lib/errors/error-catalog-loader.ts` — runtime loader for the editable error catalog

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/errors/error-catalog-loader.ts`) — verified by
> listing `admin_athena/lib/errors/`: no loader (and no `error-catalog-defaults.ts`)
> exists there; see the Both-apps note. · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.2](../01-file-catalog.md) · Hotspot: [03 §1 row 7](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Makes the user-facing error messages **editable at runtime**. The canonical catalog (10
error types → message/priority/HTTP status) lives in the `error_catalog` table in RDS;
this file reads that table into an in-memory cache with a **60-second TTL** and serves
entries synchronously to `FabOrchError`'s constructor. If the DB read ever fails, it
silently falls back to the frozen `FABORCH_ERROR_CATALOG` constant — by design, error
rendering must never itself fail because of catalog problems. This is how an admin's
"change the SQL_CALL_FAILURE message to …" chat command in NexusOps propagates to Fab
users within ~a minute, with no redeploy.

## Depends on / consumed by

**Depends on:**
- `@/lib/db` (`prisma`) — one raw query: `` prisma.$queryRawUnsafe(`SELECT error_type,
  user_message, priority, http_status FROM error_catalog`) ``. No parameters, so
  `Unsafe` carries no injection risk here.
- `@/lib/logger` (`logger.fabOrchError`) — logs swallowed refresh failures. **Note:
  this import is what creates the real module cycle — see gotchas.**
- `./error-catalog-defaults.ts` — the frozen fallback catalog + the
  `FabOrchErrorType`/`FabOrchErrorPriority` enums used to validate DB rows.
- The `error_catalog` table itself — whose **DDL/seed SQL is not in this repo**
  (checked `admin_athena/prisma/*.sql`: only `platform_settings`, `model_registry`,
  and `cmf_*` are created there).

**Consumed by** (verified by import grep at the pinned commit): exactly **one** file —
`claudeai_athena/lib/errors/faborch-errors.ts` imports `getErrorEntry` and calls it in
the `FabOrchError` constructor, so every FabOrch error created anywhere in Fab flows
through this cache. `reloadErrorCatalog` has **no importers anywhere** (not even
`__tests__/errors/faborch-errors.test.ts`) — it is a dead export at this commit.
`lib/model-registry.ts`'s header comment says it *mirrors* this file's behaviour
(same lazy/TTL/fail-safe pattern for model data), but it shares no code.

## Function-by-function

### `getErrorEntry(type: FabOrchErrorType): FabOrchErrorEntry`

The hot path, and it is **synchronous — it never awaits the DB**:
1. If the cache is older than `TTL_MS = 60_000` (or has never loaded —
   `cacheLoadedAt` starts at 0), it fires `void refreshCache()` in the background and
   does **not** wait for it.
2. Returns `cache?.[type] ?? FABORCH_ERROR_CATALOG[type]` immediately — i.e. the
   possibly-stale cached entry, or the hardcoded default if no refresh has ever
   succeeded.

Consequences: the **first error rendered after a process start always shows the
hardcoded message**, even if the DB row differs — the fresh value arrives for the
*next* caller. Admin edits propagate within ~60 s + one triggering call. Within typed
usage this function cannot throw; the returned value is only `undefined` if `type` is
not a real `FabOrchErrorType` (possible only via an unsound cast), in which case the
*caller* (`FabOrchError`'s constructor reading `entry.userMessage`) would throw.

### `reloadErrorCatalog(): Promise<void>`

Test/admin hook: zeroes `cacheLoadedAt` and awaits `refreshCache()`. **Unused at this
commit** (no importers). Note that even this "force" reload cannot surface a DB error
to its caller — the failure is swallowed inside `refreshCache`.

### Internal: `refreshCache()` + row validation (not exported)

Single-flight: a module-level `inflight` promise collapses concurrent refreshes into
one query. The refresh:
1. `SELECT`s all rows from `error_catalog`.
2. Builds the new map **starting from a spread of `FABORCH_ERROR_CATALOG`**, so any
   type missing from the table keeps its hardcoded entry.
3. Per row: skips unknown `error_type`s and unknown `priority`s (guards
   `isKnownType`/`isKnownPriority` against the enums) — a bad row silently keeps the
   fallback for that type rather than poisoning the cache. `http_status` is **not**
   validated (any integer in the table is accepted).
4. On success sets `cache` and `cacheLoadedAt = Date.now()`. On **any** failure:
   `logger.fabOrchError(...)` and nothing else — the previous cache (or the hardcoded
   fallback, if this was the first load) stays in service. `finally` clears `inflight`.

Because `cacheLoadedAt` advances **only on success**, a persistent DB outage means
every post-TTL `getErrorEntry` call kicks off a new (failing) refresh attempt.

## Failure modes & gotchas

- **The claimed two-file circular import no longer exists — the comments are stale.**
  Hotspot row 7 asks whether the "circular import with `faborch-errors.ts`" is
  init-safe, and comments in *both* files (loader lines ~35–39, `faborch-errors.ts`
  lines ~74–76) still describe `loader ↔ faborch-errors` as circular. At `7976c78` it
  is not: `error-catalog-defaults.ts` is a leaf module both sides import, exactly so
  that neither imports the other (the defaults file's header records the history —
  the old cycle once made `FabOrchError.invalidParameter` fail at runtime under
  webpack). The edge `faborch-errors → loader` is one-directional.
- **…but a real three-module cycle exists via the logger:**
  `error-catalog-loader → logger → faborch-errors → error-catalog-loader`
  (`logger.ts` imports `isFabOrchError` from `faborch-errors.ts`). Statically traced
  as **init-safe**: all three modules only *dereference* their cross-module bindings
  inside function bodies at call time — module-init code is limited to declarations
  (loader: `TTL_MS` + `let` state; logger: `APP_NAME` + object literal whose methods
  close over `isFabOrchError`; faborch-errors: re-exports + a class whose constructor
  calls `getErrorEntry`). Under ESM/webpack live bindings, whichever module evaluates
  first, all bindings are populated before any of them can be called. Needs a code
  owner to confirm no bundler edge case (🔵 Static).
- **The loader's lazy-init rationale is also slightly wrong:** its comment defers
  touching `FABORCH_ERROR_CATALOG` "because of the circular import" — but the defaults
  module is a leaf that is always fully evaluated before the loader's body runs, so
  even an init-time read would be safe. The lazy pattern is harmless, just
  mis-explained.
- **Hotspot row 7's "DB read on *every* error render" is inaccurate in steady state.**
  Reads are served from memory; the DB is queried at most **once per 60 s**, in the
  background, single-flight, never blocking a response. The claim is only
  approximately true **during a DB outage**: since `cacheLoadedAt` never advances on
  failure, each error render after the TTL triggers another failed query attempt plus
  a logged error — a small extra load/log-noise cost exactly when the DB is already
  struggling.
- **"Fail-safe truly can't throw" — holds, with one theoretical hole.** `getErrorEntry`
  has no throwing operations on its synchronous path, and `refreshCache` catches
  everything. The hole: if `logger.fabOrchError` itself threw *inside* the catch
  block, the `inflight` promise would reject and — being `void`-ed by `getErrorEntry`
  — become an **unhandled rejection**. Statically, `logger` only string-concatenates
  and `JSON.stringify`s flat records, so this looks unreachable in practice.
- **Drift hazard — the catalog truth lives in five places, not three**
  ([03 §6](../03-review-hotspots.md) says "3+"): (1) Fab's
  `error-catalog-defaults.ts`, (2) Admin's `faborch-errors.ts` (its own inlined frozen
  copy — currently byte-equivalent messages), (3) Fab's `errors/client.ts`
  HTTP-status→message map, (4) Admin's `errors/client.ts` (same map, duplicated), and
  (5) the `error_catalog` DB table. The client maps cannot represent
  `MISSING_FILTER` (400 maps to `INVALID_PARAMETER`), `UNLISTED_STORED_PROC` (404
  maps to `NO_ROWS_RETURNED`), or `ROW_CAP_EXCEEDED` (status 200), and none of the
  hardcoded copies update when an admin edits the table.
- **No DDL or seed for `error_catalog` in the repo.** If the table is absent, every
  refresh fails forever and Fab silently serves the hardcoded defaults — admin edits
  via `update_error_catalog_message` would also fail ("No row found"). The
  bootstrapping script lives outside this repo (or was run by hand).
- **`http_status` from the DB is trusted un-validated** — a bad value (e.g. 0 or 999)
  would flow straight into API responses for that error type until corrected. The
  Admin edit tool locks `http_status` (only `user_message` is editable), so the risk
  is limited to direct SQL edits.

## Open questions for the code owner

1. Hotspot row 7 as written targets a cycle that no longer exists. Can the stale
   circular-import comments in this file and `faborch-errors.ts` be updated, and can
   you confirm the *actual* `loader → logger → faborch-errors → loader` cycle is safe
   under the production bundler (it traces as init-safe statically)?
2. Where do the `error_catalog` table's DDL and seed rows live? They are not in this
   repo, and the fallback masks a missing table completely.
3. Is "DB outage ⇒ one failed query + one error log per error render (post-TTL)"
   acceptable, or should failures back off (e.g. also bump `cacheLoadedAt` on failure)?
4. `reloadErrorCatalog` has no callers — intended future admin hook, or dead code?
5. Should `http_status` be range-checked like `priority` is?
6. The 5-copy drift hazard ([03 §6](../03-review-hotspots.md)): is the plan still to
   reconcile to one source (hotspots "good first tasks" #4)? In particular, Admin's
   own error rendering ignores the table it edits (see below) — intended?

## Both-apps note

**Fab-only file — the apps are deliberately asymmetric here.**

- *Fab* (`claudeai_athena`): `FabOrchError` reads through this loader → the
  `error_catalog` **DB table** is the runtime source of truth; the frozen defaults
  are only a fallback. Admin edits show up within ~60 s.
- *Admin* (`admin_athena`): there is no loader and no defaults file.
  `admin_athena/lib/errors/faborch-errors.ts` is the older single-file design: it
  inlines its own frozen `FABORCH_ERROR_CATALOG` and its `FabOrchError` constructor
  reads `FABORCH_ERROR_CATALOG[type]` **directly — no DB read, ever**. Its header
  still calls the constant the "single source of truth."
- The connecting irony: it is the **Admin** app that *writes* the table (chat tools
  `list_error_catalog` / `update_error_catalog_message` in `lib/admin-tools.ts`, raw
  SQL, `confirm: true` guard, only `user_message` editable, audit-logged
  fire-and-forget), yet only **Fab** *reads* it. After an edit, Fab and Admin can
  show **different messages for the same error type** until Admin is redeployed with
  updated hardcoded strings.
