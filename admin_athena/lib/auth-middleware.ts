/**
 * Authentication & Authorization Middleware for Admin Athena
 *
 * - validateSession(req) - validate Bearer token, return user
 * - requireAuth(req) - basic auth check, returns user
 * - requireAdmin(req) - admin auth check, returns user with role
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from './db';
import type { User, Role } from './generated/prisma/client';
import { recordActivityWithoutEviction, recordExpired } from './session-audit';
import { FabOrchError } from './errors/faborch-errors';
import { handleApiError } from './errors/api-error-handler';
import { logger } from './logger';

// ============================================
// Types
// ============================================

export interface AuthResult {
  authenticated: boolean;
  user?: User;
  sessionId?: string;
  error?: string;
  status?: number;
}

export interface AdminAuthContext {
  user: User & { role: Role | null };
}

// ============================================
// Session Validation
// ============================================

export async function validateSession(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'No valid authorization header', status: 401 };
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 32) {
    return { authenticated: false, error: 'Invalid token format', status: 401 };
  }

  try {
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session) {
      return { authenticated: false, error: 'Invalid or expired session', status: 401 };
    }

    if (session.expiresAt < new Date()) {
      recordExpired(token, session.expiresAt).catch((e) =>
        logger.fabOrchError(e, { route: 'admin-auth-middleware' })
      );
      return {
        authenticated: false,
        error: 'Your session has expired. Please log in again.',
        status: 401,
      };
    }

    // ── Admin app: NO idle eviction ──────────────────────────────
    // Admins running long operations or leaving the chat console open
    // should never be kicked out for inactivity. We still record the
    // activity timestamp + idle history (for audit completeness), but
    // we never evict on gap > 30 min. Only the absolute 30-day session
    // expiry above can end an admin session involuntarily.
    // The lazy-create context covers admins who land here with a stale
    // token from an old login — we create a fresh ACTIVE audit row so
    // their session shows up in the audit table from this point on.
    // ──────────────────────────────────────────────────────────────
    const loginIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const loginUa = req.headers.get('user-agent') ?? null;
    recordActivityWithoutEviction(token, {
      userId: session.user.id,
      loginIp,
      loginUserAgent: loginUa,
    }).catch((e) =>
      logger.fabOrchError(e, { route: 'admin-auth-middleware' })
    );

    return {
      authenticated: true,
      user: session.user,
      sessionId: session.id,
    };
  } catch (error) {
    console.error('Session validation error:', error);
    return { authenticated: false, error: 'Failed to validate session', status: 500 };
  }
}

// ============================================
// Basic Auth
// ============================================

export async function requireAuth(
  req: NextRequest
): Promise<{ user: User } | NextResponse> {
  const auth = await validateSession(req);

  if (!auth.authenticated || !auth.user) {
    if ((auth.status || 401) === 401) {
      const fabErr = FabOrchError.sessionTimeout({ route: req.nextUrl.pathname });
      return handleApiError(fabErr, req);
    }
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: auth.status || 401 }
    );
  }

  return { user: auth.user };
}

// ============================================
// Admin Auth
// ============================================

/**
 * Validates session and checks that user is an admin.
 * Returns user with role included, or 401/403 response.
 */
export async function requireAdmin(
  req: NextRequest
): Promise<AdminAuthContext | NextResponse> {
  const auth = await validateSession(req);

  if (!auth.authenticated || !auth.user) {
    if ((auth.status || 401) === 401) {
      const fabErr = FabOrchError.sessionTimeout({ route: req.nextUrl.pathname });
      return handleApiError(fabErr, req);
    }
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: auth.status || 401 }
    );
  }

  // Check admin status
  if (!auth.user.isAdmin) {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

  // Check user status
  if (auth.user.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'Account suspended' },
      { status: 403 }
    );
  }

  // Fetch user with role
  const userWithRole = await prisma.user.findUnique({
    where: { id: auth.user.id },
    include: { role: true },
  });

  if (!userWithRole) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404 }
    );
  }

  return { user: userWithRole };
}

// ============================================
// Response Helpers
// ============================================

export function unauthorizedResponse(message?: string): NextResponse {
  return NextResponse.json(
    { error: message || 'Unauthorized' },
    { status: 401 }
  );
}

export function forbiddenResponse(message?: string): NextResponse {
  return NextResponse.json(
    { error: message || 'Forbidden' },
    { status: 403 }
  );
}

// ============================================
// IP Address Helper
// ============================================

export function getIpAddress(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  );
}
