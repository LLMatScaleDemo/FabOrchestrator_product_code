import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import prisma from '@/lib/db';
import { handleApiError } from '@/lib/errors/api-error-handler';
import { FabOrchError } from '@/lib/errors/faborch-errors';

/**
 * Detailed usage analytics for the admin Usage page. READ-ONLY.
 *
 * Cost is computed from usage_records token counts × the matching
 * modelRegistry per-1M rate (unknown models fall back to $0).
 *
 * Response is additive/back-compatible: the legacy fields
 * `totalRequests`, `totalTokens`, and `perModel[{model,requests,tokens}]`
 * are preserved while richer analytics live alongside them.
 */

interface ModelRate {
  inputCostPer1M: number;
  outputCostPer1M: number;
  cacheReadCostPer1M: number;
  cacheWriteCostPer1M: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function costOf(
  tokens: { input: number; output: number; thinking: number; cacheRead: number; cacheCreation: number },
  rate: ModelRate | undefined
): number {
  if (!rate) return 0;
  const per1M = (t: number, p: number) => (t / 1_000_000) * p;
  return (
    per1M(tokens.input, rate.inputCostPer1M) +
    per1M(tokens.output + tokens.thinking, rate.outputCostPer1M) +
    per1M(tokens.cacheRead, rate.cacheReadCostPer1M) +
    per1M(tokens.cacheCreation, rate.cacheWriteCostPer1M)
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const url = new URL(req.url);
    const daysRaw = url.searchParams.get('days');
    const days = Number(daysRaw) || 30;
    if (days <= 0 || days > 365) {
      throw FabOrchError.invalidParameter('days', undefined, undefined, {
        badValue: daysRaw,
        validRange: '1..365',
      });
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totals, byModelGroup, byUserModelGroup, modelRates, dailyRaw] = await Promise.all([
      prisma.usageRecord.aggregate({
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _avg: { requestDurationMs: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          thinkingTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
        },
      }),
      prisma.usageRecord.groupBy({
        by: ['model'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          thinkingTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
        },
      }),
      prisma.usageRecord.groupBy({
        by: ['userId', 'model'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          thinkingTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
        },
      }),
      // model_registry may not exist yet (migration not run) → fall back to
      // no pricing (cost = $0) rather than failing the whole analytics route.
      prisma.modelRegistry.findMany({
        select: {
          modelId: true,
          displayName: true,
          inputCostPer1M: true,
          outputCostPer1M: true,
          cacheReadCostPer1M: true,
          cacheWriteCostPer1M: true,
        },
      }).catch(() => [] as Array<{
        modelId: string; displayName: string;
        inputCostPer1M: number; outputCostPer1M: number;
        cacheReadCostPer1M: number; cacheWriteCostPer1M: number;
      }>),
      // Daily grouped by (date, model) so we can attach cost per day.
      prisma.$queryRawUnsafe<
        Array<{
          date: string;
          model: string;
          requests: number | string;
          input: bigint | number;
          output: bigint | number;
          thinking: bigint | number;
          cache_read: bigint | number;
          cache_creation: bigint | number;
        }>
      >(
        `SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, model,
                COUNT(*)::int AS requests,
                COALESCE(SUM(input_tokens),0)::bigint AS input,
                COALESCE(SUM(output_tokens),0)::bigint AS output,
                COALESCE(SUM(thinking_tokens),0)::bigint AS thinking,
                COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read,
                COALESCE(SUM(cache_creation_tokens),0)::bigint AS cache_creation
           FROM usage_records WHERE created_at >= $1
          GROUP BY DATE(created_at), model
          ORDER BY date`,
        since
      ).catch(() => []),
    ]);

    const rates = new Map<string, ModelRate>(
      modelRates.map((m) => [
        m.modelId,
        {
          inputCostPer1M: m.inputCostPer1M,
          outputCostPer1M: m.outputCostPer1M,
          cacheReadCostPer1M: m.cacheReadCostPer1M,
          cacheWriteCostPer1M: m.cacheWriteCostPer1M,
        },
      ])
    );
    const displayNames = new Map<string, string>(modelRates.map((m) => [m.modelId, m.displayName]));

    // ── Token totals + breakdown ──
    const tInput = totals._sum.inputTokens || 0;
    const tOutput = totals._sum.outputTokens || 0;
    const tThinking = totals._sum.thinkingTokens || 0;
    const tCacheRead = totals._sum.cacheReadTokens || 0;
    const tCacheCreation = totals._sum.cacheCreationTokens || 0;
    const totalTokens = tInput + tOutput + tThinking + tCacheRead + tCacheCreation;

    // ── Usage by model (with cost) ──
    const byModel = byModelGroup
      .map((g) => {
        const tk = {
          input: g._sum.inputTokens || 0,
          output: g._sum.outputTokens || 0,
          thinking: g._sum.thinkingTokens || 0,
          cacheRead: g._sum.cacheReadTokens || 0,
          cacheCreation: g._sum.cacheCreationTokens || 0,
        };
        const tokens = tk.input + tk.output + tk.thinking + tk.cacheRead + tk.cacheCreation;
        return {
          model: g.model,
          displayName: displayNames.get(g.model) || g.model,
          requests: g._count._all,
          tokens,
          input: tk.input,
          output: tk.output,
          thinking: tk.thinking,
          cacheRead: tk.cacheRead,
          cacheCreation: tk.cacheCreation,
          cost: round2(costOf(tk, rates.get(g.model))),
        };
      })
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

    const totalCost = round2(byModel.reduce((s, m) => s + m.cost, 0));

    // ── Per-user aggregation (tokens + cost), then join names ──
    const perUser = new Map<string, { tokens: number; cost: number; requests: number }>();
    for (const g of byUserModelGroup) {
      const tk = {
        input: g._sum.inputTokens || 0,
        output: g._sum.outputTokens || 0,
        thinking: g._sum.thinkingTokens || 0,
        cacheRead: g._sum.cacheReadTokens || 0,
        cacheCreation: g._sum.cacheCreationTokens || 0,
      };
      const tokens = tk.input + tk.output + tk.thinking + tk.cacheRead + tk.cacheCreation;
      const cost = costOf(tk, rates.get(g.model));
      const cur = perUser.get(g.userId) || { tokens: 0, cost: 0, requests: 0 };
      cur.tokens += tokens;
      cur.cost += cost;
      cur.requests += g._count._all;
      perUser.set(g.userId, cur);
    }
    const userIds = Array.from(perUser.keys());
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userInfo = new Map(users.map((u) => [u.id, u]));
    const usersEnriched = userIds.map((id) => {
      const u = perUser.get(id)!;
      const info = userInfo.get(id);
      return {
        userId: id,
        name: info?.name || null,
        email: info?.email || 'unknown',
        requests: u.requests,
        tokens: u.tokens,
        cost: round2(u.cost),
      };
    });
    const topUsersByCost = [...usersEnriched].sort((a, b) => b.cost - a.cost).slice(0, 10);
    const topUsersByTokens = [...usersEnriched].sort((a, b) => b.tokens - a.tokens).slice(0, 10);

    // ── Daily time series (continuous, zero-filled) ──
    const dailyMap = new Map<string, { tokens: number; cost: number; requests: number }>();
    for (const r of dailyRaw) {
      const tk = {
        input: num(r.input),
        output: num(r.output),
        thinking: num(r.thinking),
        cacheRead: num(r.cache_read),
        cacheCreation: num(r.cache_creation),
      };
      const tokens = tk.input + tk.output + tk.thinking + tk.cacheRead + tk.cacheCreation;
      const cost = costOf(tk, rates.get(r.model));
      const cur = dailyMap.get(r.date) || { tokens: 0, cost: 0, requests: 0 };
      cur.tokens += tokens;
      cur.cost += cost;
      cur.requests += num(r.requests);
      dailyMap.set(r.date, cur);
    }
    // Zero-fill every day in the window for a smooth chart.
    const timeSeries: Array<{ date: string; tokens: number; cost: number; requests: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const v = dailyMap.get(key) || { tokens: 0, cost: 0, requests: 0 };
      timeSeries.push({ date: key, tokens: v.tokens, cost: round2(v.cost), requests: v.requests });
    }

    return NextResponse.json({
      days,
      // ── Back-compat legacy fields ──
      totalRequests: totals._count._all,
      totalTokens,
      perModel: byModel.map((m) => ({ model: m.model, requests: m.requests, tokens: m.tokens })),

      // ── Rich analytics ──
      totalCost,
      avgRequestDurationMs: Math.round(totals._avg.requestDurationMs || 0),
      tokenBreakdown: {
        input: tInput,
        output: tOutput,
        thinking: tThinking,
        cacheRead: tCacheRead,
        cacheCreation: tCacheCreation,
        total: totalTokens,
      },
      byModel,
      topUsersByCost,
      topUsersByTokens,
      timeSeries,
    });
  } catch (error) {
    return handleApiError(error, req, {
      route: '/api/admin/usage',
      userId: auth.user.id,
    });
  }
}
