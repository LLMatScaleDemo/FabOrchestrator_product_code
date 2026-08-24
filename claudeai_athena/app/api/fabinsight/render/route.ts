import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth-middleware';
import { fetchDashboardData, getDashboard } from '@/lib/fabinsight/dashboards';
import { renderDashboard } from '@/lib/fabinsight/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Re-run one dashboard's SQL and hand back freshly rendered HTML.
 *
 * This is what makes both "live" requirements real: the Refresh button on an
 * artifact, and opening a pinned dashboard. Neither replays stored HTML — they
 * ask for the recipe to be executed again, so the figures reflect the
 * environment now.
 *
 * Readable by ANY role. Creating a dashboard is admin-only, but the requirement
 * is explicit that once pinned it is viewable by everyone, and a pinned
 * dashboard is worthless if its viewers cannot refresh it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as {
    dashboardId?: string;
    params?: Record<string, string>;
  };

  const def = body.dashboardId ? getDashboard(body.dashboardId) : undefined;
  if (!def) {
    return NextResponse.json({ error: 'Unknown dashboard' }, { status: 400 });
  }

  // Only the two entity overrides are honoured. Anything else in `params` is
  // dropped rather than passed through — these values reach SQL.
  const params = {
    ...(typeof body.params?.lot === 'string' ? { lot: body.params.lot } : {}),
    ...(typeof body.params?.product === 'string' ? { product: body.params.product } : {}),
  };

  try {
    const data = await fetchDashboardData(def, params);
    const { html, title, summary } = renderDashboard(data);
    return NextResponse.json({
      html,
      title,
      summary,
      rowCount: data.sets.reduce((a, s) => a + s.rows.length, 0),
      tookMs: data.tookMs,
      refreshedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Live manufacturing data is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
