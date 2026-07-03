import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { recordLogout } from '@/lib/session-audit';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Find session to get userId before deleting
    const session = await prisma.session.findUnique({ where: { token }, select: { userId: true } });

    // REQ-02 — close the user_session_logs row.
    recordLogout(token).catch((e) => logger.fabOrchError(e, { route: '/api/auth/logout' }));

    await prisma.session.deleteMany({ where: { token } });

    // Audit log (fire-and-forget)
    if (session) {
      prisma.auditLog.create({
        data: {
          userId: session.userId,
          action: 'user.logout',
          targetType: 'User',
          targetId: session.userId,
          ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        },
      }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
