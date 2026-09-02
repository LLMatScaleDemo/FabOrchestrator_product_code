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
  const existing = await prisma.pinnedDashboard.findUnique({
    where: { id },
    select: { id: true, dashboardId: true, sourceKey: true },
  });
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  await prisma.pinnedDashboard.delete({ where: { id } });
  // Clean up every reference to this dashboard so a deleted custom dashboard
  // leaves nothing dangling (schedule, alerts, shift-summary lists, samples).
  // Custom-dashboard metrics key on the pin id; the schedule keys on dashboardId.
  await prisma.reportSchedule
    .deleteMany({ where: { dashboardId: existing.dashboardId, sourceKey: existing.sourceKey } })
    .catch(() => {});
  // Alert thresholds set on this custom dashboard's columns (metric_key
  // custom:<pinId>:… , dashboard_id = pinId).
  await prisma
    .$executeRawUnsafe(
      `DELETE FROM alert_thresholds WHERE dashboard_id = $1 OR metric_key LIKE $2`,
      existing.id,
      `custom:${existing.id}:%`,
    )
    .catch(() => {});
  // Drop this dashboard from every shift-summary's dashboard list (match either
  // the pin id or the dashboard_id, since older rows may store either).
  await prisma
    .$executeRawUnsafe(
      `UPDATE shift_summaries SET dashboard_ids = dashboard_ids - $1 - $2, updated_at = now()
        WHERE jsonb_exists(dashboard_ids, $1) OR jsonb_exists(dashboard_ids, $2)`,
      existing.id,
      existing.dashboardId,
    )
    .catch(() => {});
  // Its accumulated baseline samples.
  await prisma
    .$executeRawUnsafe(`DELETE FROM metric_samples WHERE metric_key LIKE $1`, `custom:${existing.id}:%`)
    .catch(() => {});
  return NextResponse.json({ success: true });
}
