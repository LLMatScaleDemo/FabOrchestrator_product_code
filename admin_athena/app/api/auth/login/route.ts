import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyPassword, generateToken } from '@/lib/encryption';
import { validate, LoginSchema, formatValidationErrors } from '@/lib/validation';
import { recordLogin } from '@/lib/session-audit';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { data, error } = validate(LoginSchema, body);

    if (error) {
      return NextResponse.json(
        { error: formatValidationErrors(error) },
        { status: 400 }
      );
    }

    const { email, password } = data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check admin status
    if (!user.isAdmin) {
      return NextResponse.json(
        { error: 'Admin access required. This portal is for administrators only.' },
        { status: 403 }
      );
    }

    // Check user status
    if (user.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Account is suspended. Contact your administrator.' },
        { status: 403 }
      );
    }

    // Create session (30-day expiry)
    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
        userAgent: req.headers.get('user-agent') || undefined,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      },
    });

    // REQ-02 — write user_session_logs row (fire-and-forget).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const ua = req.headers.get('user-agent') || null;
    recordLogin({ userId: user.id, sessionToken: token, loginIp: ip, loginUserAgent: ua }).catch(
      (e) => logger.fabOrchError(e, { route: '/api/auth/login' })
    );

    // Update lastLogin + audit log (fire-and-forget)
    prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch(() => {});
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'user.login',
        targetType: 'User',
        targetId: user.id,
        metadata: { email: user.email },
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      },
    }).catch(() => {});

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        role: user.role ? { id: user.role.id, name: user.role.name } : null,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
