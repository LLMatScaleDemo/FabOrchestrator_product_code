import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      totalConversations,
      totalRoles,
      recentUsage,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: { lastLogin: { gte: thirtyDaysAgo } },
      }),
      prisma.conversation.count({
        where: { deletedAt: null },
      }),
      prisma.role.count(),
      prisma.usageRecord.aggregate({
        _sum: {
          inputTokens: true,
          outputTokens: true,
          thinkingTokens: true,
        },
        _count: true,
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const totalTokens30d =
      (recentUsage._sum.inputTokens || 0) +
      (recentUsage._sum.outputTokens || 0) +
      (recentUsage._sum.thinkingTokens || 0);

    return NextResponse.json({
      totalUsers,
      activeUsers,
      totalConversations,
      totalRoles,
      totalRequests30d: recentUsage._count,
      totalTokens30d,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 }
    );
  }
}
