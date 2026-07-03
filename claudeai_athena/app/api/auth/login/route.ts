import { getUserByEmail, createSession, updateUser } from '@/lib/storage';
import { verifyPassword, generateToken } from '@/lib/encryption';
import { recordLogin } from '@/lib/session-audit';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    // Validate required fields
    if (!email || !password) {
      return Response.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await getUserByEmail(email);
    if (!user) {
      return Response.json(
        { error: 'No account found with this email. Please contact your administrator.' },
        { status: 401 }
      );
    }

    // Check if user is deleted
    if ((user as { status?: string }).status === 'DELETED') {
      return Response.json(
        { error: 'This account has been removed. Please contact your administrator.' },
        { status: 403 }
      );
    }

    // Check if user is suspended
    if ((user as { status?: string }).status === 'SUSPENDED') {
      return Response.json(
        { error: 'This account has been suspended. Please contact your administrator.' },
        { status: 403 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return Response.json(
        { error: 'Incorrect password. Please try again or use "Forgot password?" to reset.' },
        { status: 401 }
      );
    }

    // Create session (30 day expiry)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await createSession({
      userId: user.id,
      token,
      expiresAt,
    });

    // Update last login
    await updateUser(user.id, { lastLogin: new Date() });

    // REQ-02 — write user_session_logs row.
    const loginIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null;
    const loginUserAgent = req.headers.get('user-agent') || null;
    recordLogin({ userId: user.id, sessionToken: token, loginIp, loginUserAgent }).catch((e) =>
      logger.fabOrchError(e, { route: '/api/auth/login' })
    );

    // Audit log (fire-and-forget)
    const { prisma: db } = await import('@/lib/db');
    db.auditLog.create({
      data: { userId: user.id, action: 'user.login', targetType: 'User', targetId: user.id, metadata: { email: user.email } },
    }).catch(() => {});

    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        preferences: user.preferences,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Login error:', error);
    return Response.json(
      { error: 'Failed to login' },
      { status: 500 }
    );
  }
}
