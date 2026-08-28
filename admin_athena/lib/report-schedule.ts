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

// ── Timezone-aware wall-clock math (built-in Intl, no dependency) ────────────
// KEEP IN SYNC with claudeai_athena's lib/fabinsight/schedule.ts (same helper).
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function partsInTz(utc: Date, tz: string): { y: number; mon: number; day: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(utc)) if (x.type !== "literal") p[x.type] = x.value;
  return { y: +p.year, mon: +p.month, day: +p.day, dow: DOW[p.weekday] ?? 0 };
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(utcMs))) if (x.type !== "literal") p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
}

function zonedToUtc(y: number, mon: number, day: number, hh: number, mm: number, tz: string): Date {
  if (!tz || tz === "UTC") return new Date(Date.UTC(y, mon - 1, day, hh, mm, 0));
  const guess = Date.UTC(y, mon - 1, day, hh, mm, 0);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return new Date(utc);
}

function localDayToUtc(y: number, mon: number, day: number, n: number, hh: number, mm: number, tz: string): Date {
  const d = new Date(Date.UTC(y, mon - 1, day + n));
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm, tz);
}

function monthlyToUtc(y: number, mon: number, dom: number, hh: number, mm: number, tz: string): Date {
  const dim = new Date(Date.UTC(y, mon, 0)).getUTCDate();
  return zonedToUtc(y, mon, Math.min(dom, dim), hh, mm, tz);
}

/** Next run (UTC), strictly after `from`, honouring `opts.timezone`. Mirrors Fab Orch's computeNextRun. */
export function computeReportNextRun(
  freq: ReportFrequency,
  opts: {
    intervalMinutes?: number | null;
    atTime?: string | null;
    dayOfWeek?: number | null;
    daysOfWeek?: number[] | null;
    dayOfMonth?: number | null;
    timezone?: string | null;
  },
  from: Date,
): Date {
  const tz = opts.timezone && opts.timezone.trim() ? opts.timezone.trim() : "UTC";
  const m = opts.atTime ? /^(\d{1,2}):(\d{2})$/.exec(opts.atTime.trim()) : null;
  const hh = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 0;
  const mm = m ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;

  if (freq === "hourly") {
    const mins = opts.intervalMinutes && opts.intervalMinutes > 0 ? opts.intervalMinutes : 60;
    return new Date(from.getTime() + mins * 60_000);
  }

  const now = partsInTz(from, tz);

  if (freq === "daily") {
    let cand = zonedToUtc(now.y, now.mon, now.day, hh, mm, tz);
    if (cand <= from) cand = localDayToUtc(now.y, now.mon, now.day, 1, hh, mm, tz);
    return cand;
  }
  if (freq === "weekly") {
    const days = opts.daysOfWeek && opts.daysOfWeek.length ? opts.daysOfWeek : [opts.dayOfWeek ?? 1];
    let best: Date | null = null;
    for (const d of days) {
      const delta = (d - now.dow + 7) % 7;
      let cand = localDayToUtc(now.y, now.mon, now.day, delta, hh, mm, tz);
      if (cand <= from) cand = localDayToUtc(now.y, now.mon, now.day, delta + 7, hh, mm, tz);
      if (!best || cand < best) best = cand;
    }
    return best ?? new Date(from.getTime() + 7 * 86_400_000);
  }
  // monthly
  const dom = opts.dayOfMonth ?? 1;
  let cand = monthlyToUtc(now.y, now.mon, dom, hh, mm, tz);
  if (cand <= from) {
    const ny = now.mon === 12 ? now.y + 1 : now.y;
    const nm = now.mon === 12 ? 1 : now.mon + 1;
    cand = monthlyToUtc(ny, nm, dom, hh, mm, tz);
  }
  return cand;
}
