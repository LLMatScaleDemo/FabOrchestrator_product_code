/** Maximum token budgets per prompt layer. */
export const TOKEN_LIMITS = { org: 700, role: 500, user: 200 } as const;

/** Maximum character limits for restriction instruction fields. */
export const CHAR_LIMITS = { orgRestrictions: 2000, roleRestrictions: 1000 } as const;

/** Server-side margin multiplier: accept up to 105% to account for approximation error. */
export const SERVER_MARGIN = 1.05;

/**
 * Estimate the token count of a text string.
 * Uses the ~4 English characters per token heuristic.
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  return Math.ceil(text.length / 4);
}
