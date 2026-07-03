import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import prisma from '@/lib/db';

/**
 * Enterprise admin dashboard metrics.
 *
 * READ-ONLY. Every raw-SQL audit query (prompt_audit_logs / error_audit_logs)
 * is wrapped so a missing table degrades to zeros instead of a 500.
 *
 * The top-level fields (totalUsers, activeUsers, totalConversations,
 * totalRoles, totalRequests30d, totalTokens30d) are kept for backward
 * compatibility with older clients; the rich metrics live in nested objects.
 */

interface ModelRate {
  inputCostPer1M: number;
  outputCostPer1M: number;
  cacheReadCostPer1M: number;
  cacheWriteCostPer1M: number;
}

interface TokenBucket {
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

// Usage-record token sums grouped by model over a window.
interface ModelUsageRow {
  model: string;
  requests: number;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheCreation: number;
}

/** USD cost of a usage-record token bucket for one model, given its rate. */
function costForModel(row: ModelUsageRow, rate: ModelRate | undefined): number {
  if (!rate) return 0;
  const per1M = (tokens: number, price: number) => (tokens / 1_000_000) * price;
  return (
    per1M(row.input, rate.inputCostPer1M) +
    // Thinking tokens are billed as output tokens by Anthropic.
    per1M(row.output + row.thinking, rate.outputCostPer1M) +
    per1M(row.cacheRead, rate.cacheReadCostPer1M) +
    per1M(row.cacheCreation, rate.cacheWriteCostPer1M)
  );
}

async function usageByModel(since: Date): Promise<ModelUsageRow[]> {
  const grouped = await prisma.usageRecord.groupBy({
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
  });
  return grouped.map((g) => ({
    model: g.model,
    requests: g._count._all,
    input: g._sum.inputTokens || 0,
    output: g._sum.outputTokens || 0,
    thinking: g._sum.thinkingTokens || 0,
    cacheRead: g._sum.cacheReadTokens || 0,
    cacheCreation: g._sum.cacheCreationTokens || 0,
  }));
}

function tokensOf(rows: ModelUsageRow[]): TokenBucket {
  const b: TokenBucket = { input: 0, output: 0, thinking: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  for (const r of rows) {
    b.input += r.input;
    b.output += r.output;
    b.thinking += r.thinking;
    b.cacheRead += r.cacheRead;
    b.cacheCreation += r.cacheCreation;
  }
  b.total = b.input + b.output + b.thinking + b.cacheRead + b.cacheCreation;
  return b;
}

function requestsOf(rows: ModelUsageRow[]): number {
  return rows.reduce((n, r) => n + r.requests, 0);
}

function computedCost(rows: ModelUsageRow[], rates: Map<string, ModelRate>): number {
  return rows.reduce((sum, r) => sum + costForModel(r, rates.get(r.model)), 0);
}

/** Sum of prompt_audit_logs USD cost since a date, or null if the table is unavailable. */
async function promptAuditCost(since: Date): Promise<number | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ cost: number | string | null }>>(
      `SELECT COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)),0)::float AS cost
         FROM prompt_audit_logs WHERE datetime >= $1`,
      since
    );
    const c = Number(rows?.[0]?.cost ?? 0);
    return Number.isFinite(c) ? c : 0;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      adminUsers,
      totalConversations,
      conversations7d,
      conversations30d,
      totalMessages,
      totalRoles,
      totalMcp,
      connectedMcp,
      activeSessions,
      closedIdle7d,
      modelRates,
      usage7dRows,
      usage30dRows,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastLogin: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count({ where: { isAdmin: true } }),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
      prisma.conversation.count({ where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.message.count(),
      prisma.role.count(),
      prisma.mcpConnection.count(),
      prisma.mcpConnection.count({ where: { status: 'connected' } }),
      prisma.userSessionLog.count({ where: { sessionStatus: 'ACTIVE' } }),
      prisma.userSessionLog.count({
        where: { sessionStatus: 'CLOSED_IDLE', loginTime: { gte: sevenDaysAgo } },
      }),
      // model_registry may not exist yet (migration not run) → fall back to
      // no pricing rather than failing the whole dashboard.
      prisma.modelRegistry.findMany({
        select: {
          modelId: true,
          inputCostPer1M: true,
          outputCostPer1M: true,
          cacheReadCostPer1M: true,
          cacheWriteCostPer1M: true,
        },
      }).catch(() => [] as Array<{
        modelId: string;
        inputCostPer1M: number; outputCostPer1M: number;
        cacheReadCostPer1M: number; cacheWriteCostPer1M: number;
      }>),
      usageByModel(sevenDaysAgo),
      usageByModel(thirtyDaysAgo),
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

    // Average closed-session duration (seconds), last 30d. Raw SQL because
    // Prisma cannot aggregate a timestamp difference. Table is a real model,
    // but wrap anyway for resilience.
    let avgSessionSec = 0;
    try {
      const dur = await prisma.$queryRawUnsafe<Array<{ avg_sec: number | string | null }>>(
        `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (logout_time - login_time))),0)::float AS avg_sec
           FROM user_session_logs
          WHERE logout_time IS NOT NULL AND login_time >= $1`,
        thirtyDaysAgo
      );
      avgSessionSec = Math.round(Number(dur?.[0]?.avg_sec ?? 0));
    } catch {
      avgSessionSec = 0;
    }

    // Cost: prefer prompt_audit_logs sums when they exist and are non-zero,
    // otherwise fall back to usage_records × modelRegistry rates.
    const [promptCost7d, promptCost30d] = await Promise.all([
      promptAuditCost(sevenDaysAgo),
      promptAuditCost(thirtyDaysAgo),
    ]);
    const computedCost7d = computedCost(usage7dRows, rates);
    const computedCost30d = computedCost(usage30dRows, rates);
    const cost7d = promptCost7d && promptCost7d > 0 ? promptCost7d : computedCost7d;
    const cost30d = promptCost30d && promptCost30d > 0 ? promptCost30d : computedCost30d;
    const costSource =
      (promptCost30d && promptCost30d > 0) || (promptCost7d && promptCost7d > 0)
        ? 'prompt_audit_logs'
        : 'usage_records';

    // ── Errors (raw-SQL audit table, resilient) ──────────────────────────
    let errorsOpen = 0;
    let errorsByPriority: Array<{ priority: string; count: number }> = [];
    let errorsByType: Array<{ type: string; count: number }> = [];
    let errorsTotal30d = 0;
    try {
      const [openRows, prioRows, typeRows] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ n: number | string }>>(
          `SELECT COUNT(*)::int AS n FROM error_audit_logs WHERE status = 'OPEN'`
        ),
        prisma.$queryRawUnsafe<Array<{ priority: string; n: number | string }>>(
          `SELECT priority, COUNT(*)::int AS n FROM error_audit_logs
            WHERE datetime >= $1 GROUP BY priority ORDER BY n DESC`,
          thirtyDaysAgo
        ),
        prisma.$queryRawUnsafe<Array<{ error_type: string; n: number | string }>>(
          `SELECT error_type, COUNT(*)::int AS n FROM error_audit_logs
            WHERE datetime >= $1 GROUP BY error_type ORDER BY n DESC LIMIT 12`,
          thirtyDaysAgo
        ),
      ]);
      errorsOpen = Number(openRows?.[0]?.n ?? 0);
      errorsByPriority = (prioRows || []).map((r) => ({ priority: r.priority, count: Number(r.n) }));
      errorsByType = (typeRows || []).map((r) => ({ type: r.error_type, count: Number(r.n) }));
      errorsTotal30d = errorsByType.reduce((n, r) => n + r.count, 0);
    } catch {
      // table absent → zeros
    }

    // ── Prompts (raw-SQL audit table, resilient) ─────────────────────────
    let promptsTotal = 0;
    let promptsSuccessRate: number | null = null;
    let promptsAvgResponseMs = 0;
    let promptsByTopic: Array<{ topic: string; count: number }> = [];
    try {
      const [sumRows, topicRows] = await Promise.all([
        prisma.$queryRawUnsafe<
          Array<{ total: number | string; success: number | string; avg_ms: number | string | null }>
        >(
          `SELECT COUNT(*)::int AS total,
                  SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END)::int AS success,
                  COALESCE(ROUND(AVG(response_time_ms)),0)::int AS avg_ms
             FROM prompt_audit_logs WHERE datetime >= $1`,
          thirtyDaysAgo
        ),
        prisma.$queryRawUnsafe<Array<{ topic: string; n: number | string }>>(
          `SELECT COALESCE(topic_matched,'(unmatched)') AS topic, COUNT(*)::int AS n
             FROM prompt_audit_logs WHERE datetime >= $1
            GROUP BY 1 ORDER BY n DESC LIMIT 12`,
          thirtyDaysAgo
        ),
      ]);
      promptsTotal = Number(sumRows?.[0]?.total ?? 0);
      const succ = Number(sumRows?.[0]?.success ?? 0);
      promptsSuccessRate = promptsTotal > 0 ? Math.round((succ / promptsTotal) * 1000) / 10 : null;
      promptsAvgResponseMs = Number(sumRows?.[0]?.avg_ms ?? 0);
      promptsByTopic = (topicRows || []).map((r) => ({ topic: r.topic, count: Number(r.n) }));
    } catch {
      // table absent → zeros
    }

    const tokens7d = tokensOf(usage7dRows);
    const tokens30d = tokensOf(usage30dRows);
    const requests7d = requestsOf(usage7dRows);
    const requests30d = requestsOf(usage30dRows);

    return NextResponse.json({
      // ── Backward-compatible top-level fields ──
      totalUsers,
      activeUsers,
      totalConversations,
      totalRoles,
      totalRequests30d: requests30d,
      totalTokens30d: tokens30d.total,

      // ── Rich, enterprise metrics ──
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        admins: adminUsers,
      },
      conversations: {
        total: totalConversations,
        last7d: conversations7d,
        last30d: conversations30d,
      },
      messages: { total: totalMessages },
      roles: { total: totalRoles },
      mcp: { total: totalMcp, connected: connectedMcp },
      sessions: {
        active: activeSessions,
        closedIdle7d,
        avgDurationSec: avgSessionSec,
      },
      usage: {
        last7d: { requests: requests7d, tokens: tokens7d },
        last30d: { requests: requests30d, tokens: tokens30d },
      },
      cost: {
        last7d: Math.round(cost7d * 100) / 100,
        last30d: Math.round(cost30d * 100) / 100,
        source: costSource,
      },
      errors: {
        open: errorsOpen,
        total30d: errorsTotal30d,
        byPriority: errorsByPriority,
        byType: errorsByType,
      },
      prompts: {
        total: promptsTotal,
        successRate: promptsSuccessRate,
        avgResponseMs: promptsAvgResponseMs,
        byTopic: promptsByTopic,
      },
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}
