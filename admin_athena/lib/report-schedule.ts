/**
 * Shared helpers for the Recent Reports refresh schedule.
 *
 * Used by the admin "schedule report" API route (and mirrors the same logic the
 * admin chat tool uses). All schedule times are UTC. Kept in sync with Fab
 * Orch's lib/fabinsight/schedule.ts (computeNextRun) and catalog.ts (the 7
 * dashboard ids).
 */

export type ReportFrequency = "hourly" | "daily" | "weekly" | "monthly";

/** Narrow a free-form string to a valid frequency (no unsafe casts). */
export function toFrequency(f?: string | null): ReportFrequency {
  return f === "hourly" || f === "daily" || f === "weekly" || f === "monthly" ? f : "daily";
}

/** The 7 curated FabInsight dashboards (id ↔ label). */
export const REPORT_DASHBOARDS: { id: string; label: string }[] = [
  { id: "factory-operations", label: "Factory Operations" },
  { id: "lot-history", label: "Lot History" },
  { id: "process-analytics", label: "Process Analytics" },
  { id: "maintenance-prediction", label: "Maintenance" },
  { id: "bottleneck-prediction", label: "Bottleneck Risk" },
  { id: "analytics-dashboard", label: "Product Analytics" },
  { id: "executive-overview", label: "Executive Overview" },
];

export const REPORT_SOURCES: { key: string; label: string }[] = [
  { key: "lumentum", label: "Lumentum" },
];

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve a user-supplied dashboard name/id (or "all") to canonical id(s). */
export function resolveDashboardIds(input: string | string[]): string[] {
  const items = Array.isArray(input) ? input : [input];
  if (items.some((d) => normalizeName(d) === "all")) {
    return REPORT_DASHBOARDS.map((d) => d.id);
  }
  const ids: string[] = [];
  for (const raw of items) {
    const n = normalizeName(raw);
    const hit =
      REPORT_DASHBOARDS.find((d) => normalizeName(d.id) === n || normalizeName(d.label) === n) ??
      REPORT_DASHBOARDS.find((d) => normalizeName(d.label).includes(n) || (n && n.length > 2 && normalizeName(d.id).includes(n)));
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

/** Next run (UTC), strictly after `from`. Mirrors Fab Orch's computeNextRun. */
export function computeReportNextRun(
  freq: ReportFrequency,
  opts: {
    intervalMinutes?: number | null;
    atTime?: string | null;
    dayOfWeek?: number | null;
    daysOfWeek?: number[] | null;
    dayOfMonth?: number | null;
  },
  from: Date,
): Date {
  const m = opts.atTime ? /^(\d{1,2}):(\d{2})$/.exec(opts.atTime.trim()) : null;
  const hh = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 0;
  const mm = m ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;

  if (freq === "hourly") {
    const mins = opts.intervalMinutes && opts.intervalMinutes > 0 ? opts.intervalMinutes : 60;
    return new Date(from.getTime() + mins * 60_000);
  }
  if (freq === "daily") {
    const next = new Date(from); next.setUTCHours(hh, mm, 0, 0);
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (freq === "weekly") {
    const days = opts.daysOfWeek && opts.daysOfWeek.length ? opts.daysOfWeek : [opts.dayOfWeek ?? 1];
    let best: Date | null = null;
    for (const d of days) {
      const cand = new Date(from); cand.setUTCHours(hh, mm, 0, 0);
      let delta = (d - cand.getUTCDay() + 7) % 7;
      if (delta === 0 && cand <= from) delta = 7;
      cand.setUTCDate(cand.getUTCDate() + delta);
      if (!best || cand < best) best = cand;
    }
    return best ?? new Date(from.getTime() + 7 * 86_400_000);
  }
  // monthly
  const dom = opts.dayOfMonth ?? 1;
  const next = new Date(from); next.setUTCHours(hh, mm, 0, 0); next.setUTCDate(1);
  const clamp = (d: Date) => {
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dom, dim));
  };
  clamp(next);
  if (next <= from) { next.setUTCMonth(next.getUTCMonth() + 1, 1); clamp(next); }
  return next;
}
