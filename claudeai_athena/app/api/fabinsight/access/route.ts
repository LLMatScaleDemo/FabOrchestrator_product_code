import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth-middleware';
import { isDashboardAdmin } from '@/lib/fabinsight/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tells the chat UI whether to show the seven dashboard bubbles or the sample
 * prompts. Mirrors `/api/modeling-agent/access` so the client has one shape to
 * deal with. The server enforces the same rule independently — this endpoint is
 * only what the UI renders from, never the security boundary.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ canCreateDashboards: await isDashboardAdmin(auth.user.id) });
}
