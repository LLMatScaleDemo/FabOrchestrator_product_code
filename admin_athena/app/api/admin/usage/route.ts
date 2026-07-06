import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import prisma from '@/lib/db';
import { handleApiError } from '@/lib/errors/api-error-handler';
import { FabOrchError } from '@/lib/errors/faborch-errors';

/**
 * Detailed usage analytics for the admin Usage page. READ-ONLY.
 *
 * ACCURATE SOURCE: token counts and USD cost are sourced from
 * `prompt_audit_logs` (a raw-SQL audit table with real per-prompt data),
 * NOT `usage_records` — the latter historically stored 0 tokens.
 *
 * prompt_audit_logs has no 5-way token split: it records
 * request/retrieval/response tokens + matching *_cost columns. We map
 * tokenBreakdown as { input: request+retrieval, output: response,
 * thinking:0, cacheRead:0, cacheCreation:0 } while keeping every field
 * name so the page keeps working. Per-model breakdown uses the (newly
 * added) `model` column, treating NULL as 'unknown'.
 *
 * Every raw-SQL query is wrapped so a missing table/column degrades to
 * zeros instead of crashing the route.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

interface TotalsRow {
  requests: number | string;
  request_tokens: bigint | number | string;
  retrieval_tokens: bigint | number | string;
  response_tokens: bigint | number | string;
  cost: number | string | null;
  avg_ms: number | string | null;
}

interface ModelRow {
  model: string | null;
  requests: number | string;
  request_tokens: bigint | number | string;
  retrieval_tokens: bigint | number | string;
  response_tokens: bigint | number | string;
  cost: number | string | null;
}

interface UserRow {
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  requests: number | string;
  tokens: bigint | number | string;
  cost: number | string | null;
}

interface DayRow {
  date: string;
  requests: number | string;
  tokens: bigint | number | string;
  cost: number | string | null;
}

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

    const [totalsRows, byModelRows, byUserRows, dailyRows, modelNames] = await Promise.all([
      prisma
        .$queryRawUnsafe<TotalsRow[]>(
          `SELECT COUNT(*)::int AS requests,
                  COALESCE(SUM(request_tokens),0)::bigint   AS request_tokens,
                  COALESCE(SUM(retrieval_tokens),0)::bigint AS retrieval_tokens,
                  COALESCE(SUM(response_tokens),0)::bigint  AS response_tokens,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)),0)::float AS cost,
                  COALESCE(ROUND(AVG(response_time_ms)),0)::float AS avg_ms
             FROM prompt_audit_logs
            WHERE datetime >= $1`,
          since
        )
        .catch(() => [] as TotalsRow[]),
      prisma
        .$queryRawUnsafe<ModelRow[]>(
          `SELECT COALESCE(model,'unknown') AS model,
                  COUNT(*)::int AS requests,
                  COALESCE(SUM(request_tokens),0)::bigint   AS request_tokens,
                  COALESCE(SUM(retrieval_tokens),0)::bigint AS retrieval_tokens,
                  COALESCE(SUM(response_tokens),0)::bigint  AS response_tokens,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)),0)::float AS cost
             FROM prompt_audit_logs
            WHERE datetime >= $1
            GROUP BY COALESCE(model,'unknown')`,
          since
        )
        .catch(() => [] as ModelRow[]),
      prisma
        .$queryRawUnsafe<UserRow[]>(
          `SELECT user_id, MAX(user_name) AS user_name, MAX(user_email) AS user_email,
                  COUNT(*)::int AS requests,
                  COALESCE(SUM(COALESCE(request_tokens,0)+COALESCE(retrieval_tokens,0)+COALESCE(response_tokens,0)),0)::bigint AS tokens,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)),0)::float AS cost
             FROM prompt_audit_logs
            WHERE datetime >= $1
            GROUP BY user_id`,
          since
        )
        .catch(() => [] as UserRow[]),
      prisma
        .$queryRawUnsafe<DayRow[]>(
          `SELECT TO_CHAR(DATE(datetime), 'YYYY-MM-DD') AS date,
                  COUNT(*)::int AS requests,
                  COALESCE(SUM(COALESCE(request_tokens,0)+COALESCE(retrieval_tokens,0)+COALESCE(response_tokens,0)),0)::bigint AS tokens,
                  COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)),0)::float AS cost
             FROM prompt_audit_logs
            WHERE datetime >= $1
            GROUP BY DATE(datetime)
            ORDER BY date`,
          since
        )
        .catch(() => [] as DayRow[]),
      // Optional: friendly model display names from the registry (if present).
      prisma.modelRegistry
        .findMany({ select: { modelId: true, displayName: true } })
        .catch(() => [] as Array<{ modelId: string; displayName: string }>),
    ]);

    const displayNames = new Map<string, string>(
      modelNames.map((m) => [m.modelId, m.displayName])
    );

    // ── Token totals + breakdown ──
    const t = totalsRows[0];
    const tRequest = num(t?.request_tokens);
    const tRetrieval = num(t?.retrieval_tokens);
    const tResponse = num(t?.response_tokens);
    const tInput = tRequest + tRetrieval;
    const tOutput = tResponse;
    const totalTokens = tInput + tOutput;
    const totalRequests = num(t?.requests);
    const totalCost = round2(num(t?.cost));
    const avgRequestDurationMs = Math.round(num(t?.avg_ms));

    // ── Usage by model (with cost) ──
    const byModel = byModelRows
      .map((g) => {
        const model = g.model || 'unknown';
        const input = num(g.request_tokens) + num(g.retrieval_tokens);
        const output = num(g.response_tokens);
        const tokens = input + output;
        return {
          model,
          displayName: displayNames.get(model) || model,
          requests: num(g.requests),
          tokens,
          input,
          output,
          thinking: 0,
          cacheRead: 0,
          cacheCreation: 0,
          cost: round2(num(g.cost)),
        };
      })
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

    // ── Per-user (top spenders / top consumers) ──
    const usersEnriched = byUserRows.map((u) => ({
      userId: u.user_id || 'unknown',
      name: u.user_name || null,
      email: u.user_email || 'unknown',
      requests: num(u.requests),
      tokens: num(u.tokens),
      cost: round2(num(u.cost)),
    }));
    const topUsersByCost = [...usersEnriched].sort((a, b) => b.cost - a.cost).slice(0, 10);
    const topUsersByTokens = [...usersEnriched].sort((a, b) => b.tokens - a.tokens).slice(0, 10);

    // ── Daily time series (continuous, zero-filled) ──
    const dailyMap = new Map<string, { tokens: number; cost: number; requests: number }>();
    for (const r of dailyRows) {
      dailyMap.set(r.date, {
        tokens: num(r.tokens),
        cost: num(r.cost),
        requests: num(r.requests),
      });
    }
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
      totalRequests,
      totalTokens,
      perModel: byModel.map((m) => ({ model: m.model, requests: m.requests, tokens: m.tokens })),

      // ── Rich analytics ──
      totalCost,
      avgRequestDurationMs,
      tokenBreakdown: {
        input: tInput,
        output: tOutput,
        thinking: 0,
        cacheRead: 0,
        cacheCreation: 0,
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
