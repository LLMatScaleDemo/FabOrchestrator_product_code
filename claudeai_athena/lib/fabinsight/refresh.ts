/**
 * Re-render pinned dashboards and cache the result on the pin row.
 *
 * Reuses the exact render core the live `/api/fabinsight/render` route uses
 * (`fetchDashboardData` + `renderDashboard`), so a scheduled snapshot is
 * byte-for-byte what a live open would produce. `/reports` then serves the
 * cached HTML instead of querying Lumentum per visitor.
 *
 * Multi-DB note: `sourceKey` is stored/filtered but does not yet switch the
 * data source — the fabinsight source registry is deferred until a 2nd DB
 * exists (see plan). Everything still targets the single Lumentum pool today.
 */

import { prisma } from "@/lib/db";
import { getDashboard, fetchDashboardData } from "@/lib/fabinsight/dashboards";
import { renderDashboard } from "@/lib/fabinsight/render";
import { claimDueSchedules } from "@/lib/fabinsight/schedule";

type PinRow = {
  id: string;
  dashboardId: string;
  params: unknown;
  sourceKey: string;
};

/** Only lot/product reach SQL — mirrors the /render route's whitelist. */
function whitelistParams(params: unknown): Record<string, string> {
  const p = (params ?? {}) as Record<string, unknown>;
  return {
    ...(typeof p.lot === "string" ? { lot: p.lot } : {}),
    ...(typeof p.product === "string" ? { product: p.product } : {}),
  };
}

export async function refreshPin(pin: PinRow): Promise<{ ok: boolean; error?: string }> {
  const def = getDashboard(pin.dashboardId);
  if (!def) {
    await prisma.pinnedDashboard
      .update({ where: { id: pin.id }, data: { lastStatus: "error: unknown dashboard", refreshedAt: new Date() } })
      .catch(() => {});
    return { ok: false, error: "unknown dashboard" };
  }
  try {
    const data = await fetchDashboardData(def, whitelistParams(pin.params));
    const { html, summary } = renderDashboard(data);
    await prisma.pinnedDashboard.update({
      where: { id: pin.id },
      data: { cachedHtml: html, cachedSummary: summary, refreshedAt: new Date(), lastStatus: "ok" },
    });
    return { ok: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "render failed").slice(0, 300);
    await prisma.pinnedDashboard
      .update({ where: { id: pin.id }, data: { lastStatus: `error: ${msg}`, refreshedAt: new Date() } })
      .catch(() => {});
    return { ok: false, error: msg };
  }
}

/** Refresh every pinned report of a dashboard (for the given source). */
export async function refreshDashboardPins(
  dashboardId: string,
  sourceKey: string,
): Promise<{ refreshed: number; failed: number }> {
  const pins = await prisma.pinnedDashboard.findMany({
    where: { dashboardId, sourceKey },
    select: { id: true, dashboardId: true, params: true, sourceKey: true },
  });
  let refreshed = 0;
  let failed = 0;
  // Sequential on purpose — don't hammer the MES with parallel query bursts.
  for (const pin of pins) {
    const r = await refreshPin(pin);
    if (r.ok) refreshed++;
    else failed++;
  }
  return { refreshed, failed };
}

/**
 * One scheduler pass: claim every due schedule and refresh its pins. Shared by
 * the in-app timer (instrumentation) and the manual `/cron/tick` endpoint, so
 * both behave identically. Concurrency-safe via the atomic claim.
 */
export async function runDueReportRefresh(
  now: Date = new Date(),
): Promise<{ claimed: number; refreshed: number; failed: number; results: Array<Record<string, unknown>> }> {
  const claimed = await claimDueSchedules(now);
  let refreshed = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const s of claimed) {
    const r = await refreshDashboardPins(s.dashboardId, s.sourceKey);
    refreshed += r.refreshed;
    failed += r.failed;
    results.push({ dashboardId: s.dashboardId, sourceKey: s.sourceKey, ...r });
    await prisma.reportSchedule
      .updateMany({
        where: { id: s.id },
        data: { lastStatus: r.failed ? `refreshed ${r.refreshed}, failed ${r.failed}` : `refreshed ${r.refreshed}` },
      })
      .catch(() => {});
  }

  return { claimed: claimed.length, refreshed, failed, results };
}
