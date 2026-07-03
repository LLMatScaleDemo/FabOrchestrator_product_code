import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';

// Routed through requireAuth so the same idle-eviction path that protects
// every other endpoint also applies here. Two consequences that matter:
//   1. If the user has been idle > 30 min, requireAuth → validateSession →
//      checkAndRecordActivity returns 'evicted', the live `sessions` row is
//      deleted, and the response is the canonical SESSION_TIMEOUT envelope.
//      The browser fetch wrapper sees `error.type === "SESSION_TIMEOUT"`
//      and fires the session-expired modal.
//   2. The visibility-change ping in providers.tsx now actually does
//      something useful — it forces server-side idle eviction on tab return
//      even when the client setInterval was throttled while the tab was in
//      the background.
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const role = user.roleId
    ? await prisma.role.findUnique({
        where: { id: user.roleId },
        select: { id: true, name: true },
      })
    : null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      preferences: user.preferences,
      hasAnthropicApiKey: !!(user as typeof user & { anthropicApiKeyEncrypted?: string }).anthropicApiKeyEncrypted,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
      role,
    },
  });
}
