import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import prisma from '@/lib/db';

/**
 * Enterprise admin dashboard metrics.
 *
 * READ-ONLY. Every raw-SQL audit query (prompt_audit_logs / error_audit_logs)
 * is wrapped so a missing table degrades to zeros instead of a 500.
 *
 * ACCURATE SOURCE: usage token sums and USD cost come from
 * `prompt_audit_logs` (real per-prompt data) — NOT `usage_records`, which
 * historically stored 0 tokens. prompt_audit_logs has no 5-way token split,
 * so we map request+retrieval → input and response → output while keeping the
 * TokenBucket field names for back-compat.
 *
 * The top-level fields (totalUsers, activeUsers, totalConversations,
 * totalRoles, totalRequests30d, totalTokens30d) are kept for backward
 * compatibility with older clients; the rich metrics live in nested objects.
 */

interface TokenBucket {
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

interface PromptAuditUsage {
  requests: number;
  tokens: TokenBucket;
  cost: number;
}

const emptyBucket = (): TokenBucket => ({
  input: 0,
  output: 0,
  thinking: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total: 0,
});

/**
 * Requests, token bucket, and USD cost from prompt_audit_logs since a date.
 * Degrades to zeros if the table/columns are unavailable.
 */
async function promptAuditUsage(since: Date): Promise<PromptAuditUsage> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        requests: number | string;
        input: bigint | number | string;
        output: bigint | number | string;
        cost: number | string | null;
      }>
    >(
      `SELECT COUNT(*)::int AS requests,
              COALESCE(SUM(COALESCE(request_tokens,0)+COALESCE(retrieval_tokens,0)),0)::bigint AS input,
              COALESCE(SUM(response_tokens),0)::bigint AS output,
              COALESCE(SUM(COALESCE(request_cost,0)+COALESCE(retrieval_cost,0)+COALESCE(response_cost,0)),0)::float AS cost
         FROM prompt_audit_logs WHERE datetime >= $1`,
      since
    );
    const r = rows?.[0];
    const input = Number(r?.input ?? 0) || 0;
    const output = Number(r?.output ?? 0) || 0;
    const cost = Number(r?.cost ?? 0);
    return {
      requests: Number(r?.requests ?? 0) || 0,
      tokens: { input, output, thinking: 0, cacheRead: 0, cacheCreation: 0, total: input + output },
      cost: Number.isFinite(cost) ? cost : 0,
    };
  } catch {
    return { requests: 0, tokens: emptyBucket(), cost: 0 };
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
      usage7d,
      usage30d,
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
      // ACCURATE usage + cost from prompt_audit_logs (resilient to missing table).
      promptAuditUsage(sevenDaysAgo),
      promptAuditUsage(thirtyDaysAgo),
    ]);

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

    const tokens7d = usage7d.tokens;
    const tokens30d = usage30d.tokens;
    const requests7d = usage7d.requests;
    const requests30d = usage30d.requests;
    const cost7d = usage7d.cost;
    const cost30d = usage30d.cost;
    const costSource = 'prompt_audit_logs';

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
