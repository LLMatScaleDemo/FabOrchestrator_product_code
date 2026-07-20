# `lib/model-registry.ts` — cached loader of the shared `model_registry` table

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/model-registry.ts`; Admin has **no copy** — it
> *writes* the same table directly, see the Both-apps note). · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.1](../01-file-catalog.md) · Hotspot: [03 §1 row 10](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Reads the `model_registry` table — the admin-managed source of the model list, per-token
USD rates, default model, and thinking config — and serves it to the Fab app through a
~60 s in-memory cache. It is deliberately **fail-safe**: any DB problem (table missing,
RDS unreachable) is logged and swallowed, and callers fall back to their hardcoded model
lists and rates so chat can never break because the registry is absent. This is the
"money" half of the Admin-writes / Fab-reads integration: rates edited in **NexusOps AI →
Models** flow through this cache into every turn's cost attribution.

## Depends on / consumed by

**Depends on:** `lib/db.ts` (`prisma.modelRegistry.findMany` — the `ModelRegistry` model
**is** in both apps' `schema.prisma`, unlike the raw-SQL audit tables), `lib/logger.ts`.
The table's DDL + seed lives in `admin_athena/prisma/create_model_registry.sql`
(idempotent `CREATE TABLE IF NOT EXISTS` + unique index on `model_id` + seeds the three
branded models with `claude-opus-4-8` as default).

**Consumed by** (verified by import grep at the pinned commit — three call sites, all Fab):
- `app/api/chat/route.ts` — `getAllowedModelIds` (model gate), `getRegistryRates`
  (rates preloaded once per request for the streaming `onFinish` cost math),
  `getThinkingConfig` (thinking mode + manual budget).
- `app/api/user/models/route.ts` — `getRegistryModels` builds the model picker
  (display names, default) with fallback to its hardcoded `ALL_MODELS`. (It computes the
  default from `isDefault` itself rather than calling `getDefaultModelId`.)
- `lib/model-pricing.ts` — `costForTurnAsync` dynamically imports `getRegistryRates`
  and prefers registry rates over the hardcoded `MODEL_PRICING` map
  (see [model-pricing.md](./model-pricing.md)).
- **Unused exports at this commit:** `getDefaultModelId` and `reloadModelRegistry`
  (the latter is documented in-code as a test/admin hook) have no importers.

## Function-by-function

### Cache mechanics (module state + `refreshCache()`)

One module-scoped cache per Node process: `cache: RegistryModel[] | null`,
`cacheLoadedAt`, and a single-flight `inflight` promise. The three cache states are
documented in-code: `null` = never loaded / load failed / table missing; `[]` = table
exists but has no active rows; `[...]` = active rows ordered by `sortOrder`.
`refreshCache` runs `prisma.modelRegistry.findMany({ where: { isActive: true }, orderBy:
{ sortOrder: 'asc' } })`; concurrent refreshes collapse into the one in-flight query.

**On DB failure** the catch block does exactly this: leaves `cache` **as-is** ("null on
first load, so callers fall back"), pushes `cacheLoadedAt` forward "so we don't hammer
the DB on every call when the table genuinely doesn't exist yet", and emits
`logger.warn('[model-registry] load failed — falling back to hardcoded models', ...)`.
Nothing ever throws out of this module.

Note the header comment ("first call kicks an async refresh; the cache is reused on the
hot path") slightly undersells the blocking: when the TTL (60 s, `TTL_MS = 60_000`) has
expired, `getRegistryModels` **awaits** the refresh, so one post-TTL request per instance
pays the DB round-trip (or its failure timeout) before responding.

### `getRegistryModels(): Promise<RegistryModel[] | null>`

The core accessor: refresh if stale (awaited, single-flight), then return the cache.
`null`/`[]` both mean "fall back to hardcoded" to every caller (via the internal
`hasRegistry` guard, which requires ≥1 active row).

### `getRegistryRates(modelId): Promise<RegistryRates | null>`

Per-1M-token `{ input, output, cacheRead, cacheWrite }` for one model, or `null` when
the registry is empty/missing **or the id isn't in it** — in every case the caller falls
back to `model-pricing.ts`'s hardcoded map (where an id missing from *that* map bills
**$0**; see [model-pricing.md](./model-pricing.md)).

### `getAllowedModelIds(): Promise<string[]>`

Active model ids, or `[]` to fall back. The chat route treats a model as allowed if it is
in this list **or** in the hardcoded `ALLOWED_MODELS` (`lib/errors/parameter-values.ts`)
— a union, so deactivating a model in the admin UI does **not** block it while it remains
in `ALLOWED_MODELS` (see gotchas).

### `getThinkingConfig(modelId): Promise<ThinkingConfig | null>`

`{ type, budget }` for one model, or `null` to fall back. `normalizeThinkingType` maps
any string that isn't `adaptive`/`manual`/`none` to `'none'` — so a mistyped
`thinking_type` value in the DB silently **disables** thinking for that model, and
because the chat route uses `registryThinking?.type ?? getThinkingMode(modelId)`, the
hardcoded per-model fallback is *not* consulted in that case.

### `getDefaultModelId(): Promise<string | null>` · `reloadModelRegistry(): Promise<void>`

The registry's `isDefault` model id (or `null`); and a force-refresh hook
(`cacheLoadedAt = 0` + awaited refresh). **Neither is imported anywhere at this commit**
— `/api/user/models` re-derives the default itself, and nothing calls the reload hook.

## Failure modes & gotchas

- **Silent fallback can bill the wrong rates.** Registry unreachable → `logger.warn` +
  hardcoded `MODEL_PRICING` rates; if the admin has set different rates in the table,
  turns are costed at the stale hardcoded numbers with no user-visible signal. Worse,
  the terminal fallback (`costForTurn`) bills **$0** for ids in neither source
  ([03 §3](../03-review-hotspots.md#3-money--cost-accuracy)).
- **Stale-serve after a successful load.** On failure the cache is left *as-is* — so
  after one good load, a DB outage means callers keep getting the **last successful
  snapshot** (retried every 60 s), not the hardcoded fallback. Fallback-to-hardcoded only
  happens when the registry has *never* loaded in that process. The hotspot's "falls back
  to hardcoded" is exact only for the never-loaded case.
- **~60 s TTL lag, per instance.** Rate/model edits in the admin UI take up to 60 s to
  reach each Fab instance (the cache is per-process — multi-instance deployments each lag
  independently). `reloadModelRegistry` exists but nothing exposes it.
- **Three sources of truth for models/rates**
  ([03 §6 drift hazards](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs)):
  the `model_registry` table, the hardcoded `MODEL_PRICING` map, and `ALLOWED_MODELS`
  (currently the same three ids the SQL file seeds: `claude-opus-4-7`, `claude-sonnet-5`,
  `claude-opus-4-8`). Because the chat gate is a **union** of registry ids and
  `ALLOWED_MODELS`, deactivating (or deleting) a model in the admin UI does not actually
  block it; and a model added only in the admin UI prices correctly via the registry but
  bills $0 the moment the registry is unreachable.
- **Bad `thinking_type` data silently disables thinking** (normalization to `'none'`
  short-circuits the hardcoded fallback — see `getThinkingConfig` above).
- **Post-TTL requests block on the refresh** — a slow/timing-out DB query is paid inline
  by one chat/models request per minute per instance, despite the "async refresh" framing
  in the header comment.

## Open questions for the code owner

1. Is stale-serve-on-failure (last good snapshot, not hardcoded values) the intended
   degraded mode, and is `logger.warn` in CloudWatch enough visibility for a registry
   outage that affects billing? ([03 §1 row 10](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance))
2. Is the union with `ALLOWED_MODELS` in the chat gate intended — i.e. is it acceptable
   that deactivating a model in NexusOps does not block it while it stays hardcoded?
   ([03 §3](../03-review-hotspots.md#3-money--cost-accuracy))
3. Is a ~60 s (per-instance) propagation delay for rate changes acceptable for cost
   attribution, or should rate-sensitive paths use `reloadModelRegistry` / a shorter TTL?
4. `getDefaultModelId` and `reloadModelRegistry` are exported but unused — dead API, or
   reserved for a planned admin/test hook?
5. Should `normalizeThinkingType` fall back to the hardcoded per-model thinking mode
   (rather than `'none'`) when the DB value is unrecognized?
6. Confirm `create_model_registry.sql` has actually been applied to the shared RDS (the
   module is written to survive its absence, so nothing fails loudly if it was never run).

## Both-apps note

**Fab-only file** — there is no `admin_athena/lib/model-registry.ts` (verified by glob at
the pinned commit). The two apps meet only at the shared table, in the standard
Admin-writes / Fab-reads pattern:

| Side | How it touches `model_registry` |
|---|---|
| Admin (`admin_athena`) | Writes/reads it **directly via Prisma** in `app/api/admin/model-registry/route.ts` + `[id]/route.ts` (CRUD behind the Models admin page, including a transaction that clears the previous `isDefault`), and reads it in `app/api/admin/usage/route.ts`. No cache, no fallback — Admin is the editor. |
| Fab (`claudeai_athena`) | Reads it only through this module: cached, fail-safe, hardcoded fallbacks. |

The table itself is defined in **both** apps' `schema.prisma` (`model ModelRegistry` →
`@@map("model_registry")`) *and* in `admin_athena/prisma/create_model_registry.sql` —
unlike the raw-SQL audit tables, this one is fully modeled in Prisma; the SQL file exists
for additive, idempotent deployment + seeding.
