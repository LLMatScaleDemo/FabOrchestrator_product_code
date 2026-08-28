import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';
import { refreshPin } from '@/lib/fabinsight/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST — re-run one pinned dashboard (recipe OR custom) and update its shared
 * cached snapshot. Readable/refreshable by ANY role: the requirement is that a
 * viewer can refresh a pinned dashboard on demand, and the refreshed snapshot
 * then becomes what every viewer sees (no per-viewer live query for customs,
 * which have no static layout to render live).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const pin = await prisma.pinnedDashboard.findUnique({
    where: { id },
    select: { id: true, dashboardId: true, params: true, sourceKey: true, kind: true, definition: true },
  });
  if (!pin) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const r = await refreshPin(pin);
  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? 'Refresh failed.' }, { status: 503 });
  }

  const fresh = await prisma.pinnedDashboard.findUnique({
    where: { id },
    select: { cachedHtml: true, cachedSummary: true, refreshedAt: true, lastStatus: true },
  });
  return NextResponse.json({
    html: fresh?.cachedHtml ?? null,
    summary: fresh?.cachedSummary ?? null,
    refreshedAt: fresh?.refreshedAt ? fresh.refreshedAt.toISOString() : null,
    status: fresh?.lastStatus ?? null,
  });
}
