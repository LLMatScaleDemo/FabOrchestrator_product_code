import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';
import { isDashboardAdmin } from '@/lib/fabinsight/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — the cached snapshot for one pinned report, readable by every role.
 *
 * Returns the last scheduled (or manually) cached HTML + when it was refreshed,
 * so `/reports` can show the shared snapshot without querying the MES per
 * visitor. `html: null` means no snapshot exists yet (brand-new pin) and the
 * client should fall back to a live `/render`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const pin = await prisma.pinnedDashboard.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      dashboardId: true,
      params: true,
      cachedHtml: true,
      cachedSummary: true,
      refreshedAt: true,
      lastStatus: true,
    },
  });
  if (!pin) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  return NextResponse.json({
    id: pin.id,
    title: pin.title,
    dashboardId: pin.dashboardId,
    params: pin.params,
    html: pin.cachedHtml ?? null,
    summary: pin.cachedSummary ?? null,
    refreshedAt: pin.refreshedAt ? pin.refreshedAt.toISOString() : null,
    status: pin.lastStatus ?? null,
  });
}

/**
 * DELETE — unpin. Admin only, matching the rule that non-admins cannot create
 * them either. A pinned dashboard stays until an admin removes it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!(await isDashboardAdmin(auth.user.id))) {
    return NextResponse.json(
      { error: 'Only an administrator can remove a pinned dashboard.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const existing = await prisma.pinnedDashboard.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  await prisma.pinnedDashboard.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
