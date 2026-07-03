// Per-model token pricing for cost attribution in prompt_audit_logs.
//
// All rates are USD per 1,000,000 tokens, as published by Anthropic.
// Update this map whenever Anthropic posts new prices or new models.
//
// `cacheRead` and `cacheWrite` cover prompt-caching:
//   - cache reads  → ~10% of the normal input rate
//   - cache writes → ~125% of the normal input rate
// Without splitting these out, cached prompts over-report their cost.

export interface ModelRates {
  /** USD per 1M input tokens (uncached). */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M input tokens served from the prompt cache (read). */
  cacheRead: number;
  /** USD per 1M input tokens written into the prompt cache (write). */
  cacheWrite: number;
}

const MODEL_PRICING: Record<string, ModelRates> = {
  "claude-opus-4-8":            { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-sonnet-5":           { input:  3, output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  "claude-opus-4-7":            { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-opus-4-6":            { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-opus-4-5-20251101":   { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-opus-4-20250514":     { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-sonnet-4-6":          { input:  3, output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  "claude-sonnet-4-5-20250929": { input:  3, output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  "claude-sonnet-4-20250514":   { input:  3, output: 15, cacheRead: 0.30, cacheWrite:  3.75 },
  "claude-haiku-4-5-20251001":  { input:  1, output:  5, cacheRead: 0.10, cacheWrite:  1.25 },
};

export interface TurnUsage {
  /** Uncached input tokens. */
  inputTokens?: number | null;
  /** Output tokens generated. */
  outputTokens?: number | null;
  /** Input tokens served from the prompt cache. */
  cachedInputTokens?: number | null;
  /** Input tokens written into the prompt cache. */
  cacheCreationInputTokens?: number | null;
}

export interface TurnCost {
  inputCost: number;
  outputCost: number;
  total: number;
}

/**
 * Compute the USD cost of a single LLM turn using that turn's model rates.
 * Returns zeros if the model is not in the pricing table (logged once at the
 * call site so an unknown model never silently mis-bills).
 */
export function costForTurn(modelId: string | undefined | null, usage: TurnUsage): TurnCost {
  const rates = modelId ? MODEL_PRICING[modelId] : undefined;
  if (!rates) return { inputCost: 0, outputCost: 0, total: 0 };

  const inTok    = usage.inputTokens               ?? 0;
  const outTok   = usage.outputTokens              ?? 0;
  const readTok  = usage.cachedInputTokens         ?? 0;
  const writeTok = usage.cacheCreationInputTokens  ?? 0;

  const inputCost =
    (inTok    * rates.input)      / 1_000_000 +
    (readTok  * rates.cacheRead)  / 1_000_000 +
    (writeTok * rates.cacheWrite) / 1_000_000;
  const outputCost = (outTok * rates.output) / 1_000_000;

  return { inputCost, outputCost, total: inputCost + outputCost };
}

export function hasPricing(modelId: string | undefined | null): boolean {
  return !!(modelId && MODEL_PRICING[modelId]);
}

/**
 * Compute a turn cost from an explicit rate table (e.g. loaded from the
 * ModelRegistry) instead of the hardcoded MODEL_PRICING map. Same math as
 * `costForTurn`. Callers pass registry rates when available.
 */
export function costForTurnWithRates(rates: ModelRates, usage: TurnUsage): TurnCost {
  const inTok    = usage.inputTokens               ?? 0;
  const outTok   = usage.outputTokens              ?? 0;
  const readTok  = usage.cachedInputTokens         ?? 0;
  const writeTok = usage.cacheCreationInputTokens  ?? 0;

  const inputCost =
    (inTok    * rates.input)      / 1_000_000 +
    (readTok  * rates.cacheRead)  / 1_000_000 +
    (writeTok * rates.cacheWrite) / 1_000_000;
  const outputCost = (outTok * rates.output) / 1_000_000;

  return { inputCost, outputCost, total: inputCost + outputCost };
}

/**
 * Async cost: prefer per-token rates from the shared ModelRegistry table;
 * fall back to the hardcoded MODEL_PRICING via `costForTurn` when the
 * registry has no rate for this model (table empty / missing / unknown id).
 */
export async function costForTurnAsync(
  modelId: string | undefined | null,
  usage: TurnUsage
): Promise<TurnCost> {
  if (modelId) {
    try {
      const { getRegistryRates } = await import('@/lib/model-registry');
      const rates = await getRegistryRates(modelId);
      if (rates) return costForTurnWithRates(rates, usage);
    } catch {
      // Registry unavailable — fall through to the hardcoded map.
    }
  }
  return costForTurn(modelId, usage);
}
