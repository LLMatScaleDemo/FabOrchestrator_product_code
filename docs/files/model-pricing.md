# `lib/model-pricing.ts` — per-model USD rates and per-turn cost math

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/model-pricing.ts` and `admin_athena/lib/model-pricing.ts`) —
> **the two copies have diverged: different model ids AND different rates for the same ids; see the
> Both-apps note.** · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 9](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Holds a hardcoded map of USD prices per 1M tokens for each Claude model id (split into
`input` / `output` / `cacheRead` / `cacheWrite` so prompt-caching doesn't over-report cost)
and the arithmetic that turns a turn's token usage into dollars. Every cost number in the
platform's money trail starts here: the per-step costs computed in the chat routes flow into
the `prompt_audit_logs` cost columns (`request_cost` / `retrieval_cost` / `response_cost`)
via [`prompt-audit.ts`](./prompt-audit.md), and from there into the admin usage/cost views.

## Depends on / consumed by

**Depends on:**
- *Fab:* `@/lib/model-registry` (`getRegistryRates`) — but only inside `costForTurnAsync`,
  via a dynamic `import()` wrapped in `try/catch`; every other export is pure, no I/O.
- *Admin:* nothing — the whole file is pure functions over the hardcoded map.

**Consumed by** (verified by import grep at the pinned commit) — exactly two files:
- *Fab:* `claudeai_athena/app/api/chat/route.ts` — imports `costForTurn`,
  `costForTurnWithRates`, `hasPricing`, `type ModelRates`.
- *Admin:* `admin_athena/app/api/admin/chat/route.ts` — imports `costForTurn`, `hasPricing`.

Note the catalog row says "consumed by: prompt-audit, cost" — that is *indirect*:
`prompt-audit.ts` never imports this file; the chat routes compute the costs and pass the
finished numbers to `recordPromptSuccess`. And **`costForTurnAsync` has zero callers** —
the Fab chat route instead pre-loads `getRegistryRates(modelId)` once up front (route.ts
lines 178–188) so the streaming `onFinish` callback can price synchronously.

## Function-by-function

### `costForTurn(modelId, usage): TurnCost` — both apps

The core lookup + math. `MODEL_PRICING[modelId]`; if the model id is missing (or
`modelId` is null/undefined) it returns exactly:

```ts
if (!rates) return { inputCost: 0, outputCost: 0, total: 0 };
```

— i.e. **an unknown model bills $0 with no error, no log, no flag in the return value**.
The doc comment claims this is "logged once at the call site so an unknown model never
silently mis-bills" — see the gotchas below for how true that is at this commit. For a
known model: `inputCost = (input·rate + cacheRead·rate + cacheWrite·rate) / 1M`,
`outputCost = output·rate / 1M`, all token fields `?? 0`. Pure; never throws.

### `hasPricing(modelId): boolean` — both apps

`!!(modelId && MODEL_PRICING[modelId])`. This is what makes the call-site logging
possible: both chat routes call it to detect the unknown-model case *before* calling
`costForTurn`. It only knows the hardcoded map — a model priced solely in the
`model_registry` table returns `false` (Fab's route compensates by also checking its
pre-loaded registry rate; Admin has no registry path at all).

### `costForTurnWithRates(rates, usage): TurnCost` — Fab only

Identical math to `costForTurn` but takes an explicit `ModelRates` instead of consulting
the map — this is how registry (DB) rates get used. The Fab chat route calls it when its
up-front `getRegistryRates` lookup succeeded, else falls back to `costForTurn`. Pure.

### `costForTurnAsync(modelId, usage): Promise<TurnCost>` — Fab only, **unused**

The composed variant: dynamic-imports `@/lib/model-registry`, tries
`getRegistryRates(modelId)` (a DB read behind a ~60 s TTL cache), and on any rate found
uses `costForTurnWithRates`; on `null` **or any thrown error** (registry unavailable,
table missing) it silently falls through to the hardcoded `costForTurn`. This is the
catalog's "DB read (async variant)" — but no file imports it at the pinned commit, so the
DB read never actually happens through this module. It contains no unknown-model logging,
so any future caller adopting it would get the silent-$0 behavior with no log.

### Types: `ModelRates`, `TurnUsage`, `TurnCost` — both apps

`ModelRates` (per-1M `input`/`output`/`cacheRead`/`cacheWrite`) is also the shape
`model-registry.ts` returns, which is what lets registry rates plug into the same math.
`TurnUsage` mirrors the AI SDK's usage fields (`inputTokens`, `outputTokens`,
`cachedInputTokens`, `cacheCreationInputTokens`), all optional/nullable.

## Failure modes & gotchas

- **Silent $0 inside the function — but the "log once" *does* exist at both call sites.**
  [03 §3](../03-review-hotspots.md#3-money--cost-accuracy) states the promised log "is not
  backed by code"; at commit `7976c78` that is **out of date**. Both consumers implement
  it: Fab `app/api/chat/route.ts:1049–1055` and Admin `app/api/admin/chat/route.ts:177–183`
  guard with a per-request `unknownModelLogged` flag and call `logger.fabOrchError` with
  `No pricing for model "<stepModel>" — cost will be 0`.
  The residual risk is real but narrower: the *function* stays silent, so any **future**
  caller (including the existing-but-unused `costForTurnAsync`) that forgets the
  `hasPricing` check re-introduces invisible under-billing.
- **Fab and Admin disagree on the price of the same model.** Three ids the two maps share
  (`claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5-20251101`) are priced **3×
  higher in Admin** ($15/$75) than in Fab ($5/$25). The same turn on the same model
  produces different `prompt_audit_logs` costs depending on which app served it. Full
  table in the Both-apps note.
- **Three sources of truth for models/pricing** (drift hazard,
  [03 §6](../03-review-hotspots.md#drift-hazards-multiple-copies-of-the-same-truth)): this
  file's `MODEL_PRICING`, `ALLOWED_MODELS` in `lib/errors/parameter-values.ts`, and the
  `model_registry` DB table. They already disagree at this commit: Fab's
  `ALLOWED_MODELS` is 3 ids (`claude-opus-4-7`, `claude-sonnet-5`, `claude-opus-4-8`)
  vs 12 priced ids; Admin's is 7 ids that don't include `claude-opus-4-7` even though
  Admin prices it; and none of Fab's four newest priced ids exist in Admin's map at all.
- **Registry rates silently win, and silently disappear.** When the `model_registry`
  table has a row, its rates override this file (Fab only); when the registry read fails
  for *any* reason it's swallowed and the hardcoded map is used — a wrong or vanished
  DB rate changes billed amounts with no signal (that's `model-registry.ts`, hotspot
  row 10, but this file is the fallback half of that behavior).
- **Alias vs dated ids.** Fab prices both alias-style ids (`claude-sonnet-4-6`,
  `claude-sonnet-5`) and dated snapshots (`claude-sonnet-4-5-20250929`). The chat routes
  price by `s.response?.modelId || s.modelId || modelId` — if the provider reports a
  dated id for a request made with an alias (or vice versa), the lookup can miss and hit
  the $0 path even though the "same" model is priced.
- **Float math into NUMERIC columns.** Costs are IEEE doubles summed per step, then
  stored in `prompt_audit_logs` NUMERIC columns and later re-summed
  ([03 §3](../03-review-hotspots.md#3-money--cost-accuracy)'s NUMERIC→Number precision
  question applies downstream of this file).
- **Rates are a manual copy of Anthropic's price sheet** ("Update this map whenever
  Anthropic posts new prices") — nothing detects staleness; a price change upstream just
  makes every subsequent audit row quietly wrong.

## Open questions for the code owner

1. Are Admin's $15/$75 Opus rates (`claude-opus-4-7`/`-4-6`/`-4-5-20251101`) stale, and
   which app's numbers should finance trust?
2. Should Admin's map get the four Fab-only models (`claude-fable-5`, `claude-mythos-5`,
   `claude-opus-4-8`, `claude-sonnet-5`), which today bill $0?
3. Is the "missing log-once" claim in [03 §1 row 9 / §3](../03-review-hotspots.md) out
   of date (the guard exists in both chat routes at `7976c78`)?
4. Is `costForTurnAsync` dead code or the intended future API — and if kept, should it
   gain the unknown-model log?
5. Which of this map, `ALLOWED_MODELS`, and `model_registry` is authoritative long-term?
6. Should `hasPricing`/`costForTurn` return a structured `priced: false` signal instead
   of relying on every call site to check?

## Both-apps note

Same skeleton (same interfaces, same math in `costForTurn`/`hasPricing`), but the copies
have **materially diverged** — Admin looks like a frozen older snapshot:

**Exports:** Fab adds `costForTurnWithRates` and `costForTurnAsync` (registry
integration); Admin has only `costForTurn` + `hasPricing` and no registry awareness.

**Map contents** (Fab 12 ids, Admin 8):

| Model id | Fab (in/out/cacheR/cacheW per 1M) | Admin | Verdict |
|---|---|---|---|
| `claude-fable-5` | 10 / 50 / 1.0 / 12.5 | — | **Fab only** |
| `claude-mythos-5` | 10 / 50 / 1.0 / 12.5 | — | **Fab only** |
| `claude-opus-4-8` | 5 / 25 / 0.50 / 6.25 | — | **Fab only** |
| `claude-sonnet-5` | 2 / 10 / 0.20 / 2.50 | — | **Fab only** |
| `claude-opus-4-7` | 5 / 25 / 0.50 / 6.25 | 15 / 75 / 1.5 / 18.75 | **Rates conflict (3×)** |
| `claude-opus-4-6` | 5 / 25 / 0.50 / 6.25 | 15 / 75 / 1.5 / 18.75 | **Rates conflict (3×)** |
| `claude-opus-4-5-20251101` | 5 / 25 / 0.50 / 6.25 | 15 / 75 / 1.5 / 18.75 | **Rates conflict (3×)** |
| `claude-opus-4-20250514` | 15 / 75 / 1.50 / 18.75 | 15 / 75 / 1.5 / 18.75 | match |
| `claude-sonnet-4-6` | 3 / 15 / 0.30 / 3.75 | 3 / 15 / 0.30 / 3.75 | match |
| `claude-sonnet-4-5-20250929` | 3 / 15 / 0.30 / 3.75 | 3 / 15 / 0.30 / 3.75 | match |
| `claude-sonnet-4-20250514` | 3 / 15 / 0.30 / 3.75 | 3 / 15 / 0.30 / 3.75 | match |
| `claude-haiku-4-5-20251001` | 1 / 5 / 0.10 / 1.25 | 1 / 5 / 0.10 / 1.25 | match |

**Comments:** Fab's map is annotated with pricing-tier comments (e.g. "Opus 4.5–4.8 →
$5 / $25", "Sonnet 5 (through Aug 31, 2026)"); Admin's map has none — consistent with
Fab having been repriced for the newer generation without back-porting to Admin.
