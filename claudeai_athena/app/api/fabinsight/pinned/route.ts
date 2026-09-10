import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';
import { isDashboardAdmin } from '@/lib/fabinsight/access';
import { getDashboard } from '@/lib/fabinsight/dashboards';
import { parseCustomDef, fetchCustomData, isNumericColumn, type CustomDef } from '@/lib/fabinsight/custom';
import { refreshPin } from '@/lib/fabinsight/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — every pinned dashboard, readable by EVERY role.
 *
 * This is the "viewable to all roles" half of the requirement. Only the recipe
 * comes back; the HTML is produced on demand by `/api/fabinsight/render` so the
 * list itself stays cheap and nothing is ever served from a stale snapshot.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const rows = await prisma.pinnedDashboard.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      dashboardId: true,
      kind: true,
      params: true,
      createdAt: true,
      refreshedAt: true,
      lastStatus: true,
      cachedHtml: true,
      createdBy: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({
    dashboards: rows.map((r) => ({
      id: r.id,
      title: r.title,
      dashboardId: r.dashboardId,
      kind: r.kind,
      params: r.params,
      createdAt: r.createdAt.toISOString(),
      // Scheduled-snapshot metadata — the HTML itself is fetched per report
      // from GET /api/fabinsight/pinned/[id]. `refreshedAt` is when the last
      // scheduled (or manual) snapshot was cached; null = never cached yet.
      refreshedAt: r.refreshedAt ? r.refreshedAt.toISOString() : null,
      hasCache: !!r.cachedHtml,
      // "stale: source unreachable" means the last scheduled refresh couldn't
      // reach the MES and the previous snapshot was intentionally kept.
      stale: typeof r.lastStatus === 'string' && r.lastStatus.startsWith('stale:'),
      createdBy: r.createdBy?.name || r.createdBy?.email || 'Unknown',
    })),
    canManage: await isDashboardAdmin(auth.user.id),
  });
}

/** POST — pin a dashboard. Admin only. */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!(await isDashboardAdmin(auth.user.id))) {
    return NextResponse.json(
      { error: 'Only an administrator can pin a dashboard.' },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    dashboardId?: string;
    params?: Record<string, string>;
    replace?: boolean;
    /** Present for an admin-created custom dashboard: { queries: [...] }. */
    kind?: string;
    definition?: { queries?: unknown } | unknown;
  };

  const title = (body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  if (title.length > 120) {
    return NextResponse.json({ error: 'Name is too long (120 characters max).' }, { status: 400 });
  }

  // A pin is either a "custom" dashboard (its own query set travels in the body)
  // or a "recipe" — one of the fixed 7, gated by getDashboard().
  const isCustom = body.kind === 'custom' || (!!body.definition && !body.dashboardId);
  let dashboardId: string;
  let kind: string;
  let customDef: CustomDef | null = null;
  let params: Record<string, string> = {};

  if (isCustom) {
    try {
      // Re-validate + normalise (re-applies the read-only SQL guard) server-side —
      // never trust the client's definition even though the agent produced it.
      const defInput = (body.definition ?? {}) as Record<string, unknown>;
      customDef = parseCustomDef({ title, queries: (defInput as { queries?: unknown }).queries });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid custom dashboard definition.' },
        { status: 400 },
      );
    }
    kind = 'custom';
    // A stable id distinct from the 7 recipe ids; the schedule keys off this.
    dashboardId = `custom-${randomUUID().slice(0, 8)}`;
  } else {
    if (!body.dashboardId || !getDashboard(body.dashboardId)) {
      return NextResponse.json({ error: 'Unknown dashboard.' }, { status: 400 });
    }
    kind = 'recipe';
    dashboardId = body.dashboardId;
    params = {
      ...(typeof body.params?.lot === 'string' ? { lot: body.params.lot } : {}),
      ...(typeof body.params?.product === 'string' ? { product: body.params.product } : {}),
    };
  }

  // A duplicate name would make the list ambiguous. On the first attempt we
  // ask the caller to confirm a replace (needsReplace) rather than silently
  // creating a second card; with `replace: true` we overwrite the existing
  // pin's recipe and clear its cached snapshot so it re-renders fresh.
  const clash = await prisma.pinnedDashboard.findFirst({
    where: { title: { equals: title, mode: 'insensitive' } },
    select: { id: true, title: true, dashboardId: true },
  });
  if (clash && !body.replace) {
    return NextResponse.json(
      {
        error: `A report named “${clash.title}” already exists. Replacing it will overwrite the existing report.`,
        needsReplace: true,
        existingId: clash.id,
      },
      { status: 409 },
    );
  }

  if (clash && body.replace) {
    // Keep a custom pin's existing id so any schedule attached to it survives.
    const keepDashboardId = isCustom ? clash.dashboardId : dashboardId;
    const updated = await prisma.pinnedDashboard.update({
      where: { id: clash.id },
      data: {
        title,
        dashboardId: keepDashboardId,
        kind,
        definition: customDef ?? undefined,
        params,
        // New recipe/definition → the old snapshot is stale; clear it so it
        // re-renders on the next scheduled tick (or via Refresh) instead of
        // showing wrong data.
        cachedHtml: null,
        cachedSummary: null,
        refreshedAt: null,
        lastStatus: null,
      },
      select: { id: true, title: true, dashboardId: true, params: true, createdAt: true },
    });
    // Re-cache the snapshot + re-detect metric columns for the new definition so
    // the updated custom dashboard's metrics are available in Alert Thresholds
    // right away.
    if (isCustom && customDef) {
      await refreshPin({ id: updated.id, dashboardId: keepDashboardId, params, sourceKey: 'lumentum', kind: 'custom', definition: customDef }).catch(() => {});
      try {
        const data = await fetchCustomData(customDef);
        const columns: { setKey: string; setLabel: string; column: string }[] = [];
        for (const set of data.sets) {
          if (set.error || !set.rows.length) continue;
          for (const col of Object.keys(set.rows[0])) {
            if (isNumericColumn(set.rows, col)) columns.push({ setKey: set.key, setLabel: set.label, column: col });
          }
        }
        await prisma.pinnedDashboard.update({ where: { id: updated.id }, data: { metricColumns: columns } });
      } catch {
        // leave columns to the sampler.
      }
    }
    return NextResponse.json(
      { dashboard: { ...updated, createdAt: updated.createdAt.toISOString() }, replaced: true },
      { status: 200 },
    );
  }

  const created = await prisma.pinnedDashboard.create({
    data: {
      title,
      dashboardId,
      kind,
      definition: customDef ?? undefined,
      params,
      createdById: auth.user.id,
    },
    select: { id: true, title: true, dashboardId: true, params: true, createdAt: true },
  });

  // Custom dashboards have no live-render route, so cache their snapshot now:
  // "whatever the last run is stays statically present in every user's view"
  // until someone refreshes. Best-effort — a pin is still valid if this fails.
  if (isCustom && customDef) {
    await refreshPin({
      id: created.id,
      dashboardId,
      params,
      sourceKey: 'lumentum',
      kind: 'custom',
      definition: customDef,
    }).catch(() => {});
    // Detect the dashboard's numeric columns NOW so its metrics are available in
    // the admin Alert Thresholds section immediately — no waiting for the first
    // scheduled sampler run. Best-effort; the sampler refreshes this later too.
    try {
      const data = await fetchCustomData(customDef);
      const columns: { setKey: string; setLabel: string; column: string }[] = [];
      for (const set of data.sets) {
        if (set.error || !set.rows.length) continue;
        for (const col of Object.keys(set.rows[0])) {
          if (isNumericColumn(set.rows, col)) columns.push({ setKey: set.key, setLabel: set.label, column: col });
        }
      }
      await prisma.pinnedDashboard.update({ where: { id: created.id }, data: { metricColumns: columns } });
    } catch {
      // leave metric_columns empty; the sampler will fill it on its next run.
    }
  }

  return NextResponse.json(
    { dashboard: { ...created, createdAt: created.createdAt.toISOString() } },
    { status: 201 },
  );
}
