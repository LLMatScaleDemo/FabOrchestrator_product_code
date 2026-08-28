/**
 * Report-refresh scheduling for the Recent Reports (pinned dashboards).
 *
 * A schedule is one row per (dashboard, source) in `report_schedules`, written
 * by the admin app's chat tool and read here by the cron tick. All times are
 * UTC. `claimDueSchedules` is the concurrency-safe claim: it advances a row's
 * `nextRunAt` with a compare-and-set on the exact value it read, so if two app
 * instances tick at once only one wins each row (no double refresh).
 */

import { prisma } from "@/lib/db";

export type ScheduleRow = {
  id: string;
  dashboardId: string;
  sourceKey: string;
  frequency: string; // hourly | daily | weekly | monthly
  intervalMinutes: number | null;
  atTime: string | null; // "HH:MM" — wall-clock in `timezone`
  dayOfWeek: number | null; // 0-6 (Sun=0) — legacy single-day
  daysOfWeek: number[] | null; // 0-6 list — weekly can run on several days
  dayOfMonth: number | null; // 1-31
  timezone: string; // IANA tz the atTime/day are interpreted in (default "UTC")
  nextRunAt: Date | null;
};

/** Parse a stored "1,3,5" days string to a sorted, de-duped 0-6 list. */
export function parseDaysOfWeek(s: string | null): number[] {
  if (!s) return [];
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function parseHM(s: string | null): [number, number] {
  if (!s) return [0, 0];
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return [0, 0];
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return [hh, mm];
}

// ── Timezone-aware wall-clock math (built-in Intl, no dependency) ────────────
// KEEP IN SYNC with admin_athena's lib/report-schedule.ts (same helper).
// atTime + day are a WALL-CLOCK in the schedule's timezone; we convert that to
// the correct UTC instant so the UTC-based scheduler fires at the right moment,
// and it stays correct across DST because the offset is recomputed each run.

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts a given UTC instant shows in `tz`. */
function partsInTz(utc: Date, tz: string): { y: number; mon: number; day: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(utc)) if (x.type !== "literal") p[x.type] = x.value;
  return { y: +p.year, mon: +p.month, day: +p.day, dow: DOW[p.weekday] ?? 0 };
}

/** tz offset (ms) at a UTC instant = (its wall-clock read as UTC) − the instant. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(utcMs))) if (x.type !== "literal") p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
}

/** UTC Date for wall-clock (y, mon[1-12], day, hh, mm) interpreted in `tz`. DST-aware. */
function zonedToUtc(y: number, mon: number, day: number, hh: number, mm: number, tz: string): Date {
  if (!tz || tz === "UTC") return new Date(Date.UTC(y, mon - 1, day, hh, mm, 0));
  const guess = Date.UTC(y, mon - 1, day, hh, mm, 0);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz); // one correction pass for DST boundaries
  return new Date(utc);
}

/** Add `n` LOCAL calendar days to (base y/mon/day) then resolve hh:mm in `tz` to UTC. */
function localDayToUtc(y: number, mon: number, day: number, n: number, hh: number, mm: number, tz: string): Date {
  const d = new Date(Date.UTC(y, mon - 1, day + n)); // Date normalizes month/year rollover
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm, tz);
}

/** Monthly: clamp day-of-month to the month's length, then resolve in `tz`. */
function monthlyToUtc(y: number, mon: number, dom: number, hh: number, mm: number, tz: string): Date {
  const dim = new Date(Date.UTC(y, mon, 0)).getUTCDate();
  return zonedToUtc(y, mon, Math.min(dom, dim), hh, mm, tz);
}

/** Next run time (UTC), strictly after `from`, honouring the schedule's timezone. */
export function computeNextRun(s: ScheduleRow, from: Date): Date {
  const tz = s.timezone && s.timezone.trim() ? s.timezone.trim() : "UTC";
  const [hh, mm] = parseHM(s.atTime);

  if (s.frequency === "hourly") {
    const mins = s.intervalMinutes && s.intervalMinutes > 0 ? s.intervalMinutes : 60;
    return new Date(from.getTime() + mins * 60_000);
  }

  const now = partsInTz(from, tz); // "today" in the schedule's timezone

  if (s.frequency === "daily") {
    let cand = zonedToUtc(now.y, now.mon, now.day, hh, mm, tz);
    if (cand <= from) cand = localDayToUtc(now.y, now.mon, now.day, 1, hh, mm, tz);
    return cand;
  }
  if (s.frequency === "weekly") {
    const days = s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [s.dayOfWeek ?? 1];
    let best: Date | null = null;
    for (const d of days) {
      const delta = (d - now.dow + 7) % 7;
      let cand = localDayToUtc(now.y, now.mon, now.day, delta, hh, mm, tz);
      if (cand <= from) cand = localDayToUtc(now.y, now.mon, now.day, delta + 7, hh, mm, tz);
      if (!best || cand < best) best = cand;
    }
    return best ?? new Date(from.getTime() + 7 * 86_400_000);
  }
  if (s.frequency === "monthly") {
    const dom = s.dayOfMonth ?? 1;
    let cand = monthlyToUtc(now.y, now.mon, dom, hh, mm, tz);
    if (cand <= from) {
      const ny = now.mon === 12 ? now.y + 1 : now.y;
      const nm = now.mon === 12 ? 1 : now.mon + 1;
      cand = monthlyToUtc(ny, nm, dom, hh, mm, tz);
    }
    return cand;
  }
  return new Date(from.getTime() + 60 * 60_000);
}

/**
 * Claim every schedule that is due (enabled and nextRunAt <= now), advancing
 * each claimed row's nextRunAt. Returns the rows this caller won. Safe across
 * concurrent instances via a compare-and-set on the observed nextRunAt.
 */
export async function claimDueSchedules(now: Date = new Date()): Promise<ScheduleRow[]> {
  const due = await prisma.reportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
  });

  const claimed: ScheduleRow[] = [];
  for (const row of due) {
    const s: ScheduleRow = {
      id: row.id,
      dashboardId: row.dashboardId,
      sourceKey: row.sourceKey,
      frequency: row.frequency,
      intervalMinutes: row.intervalMinutes,
      atTime: row.atTime,
      dayOfWeek: row.dayOfWeek,
      daysOfWeek: parseDaysOfWeek(row.daysOfWeek),
      dayOfMonth: row.dayOfMonth,
      timezone: row.timezone ?? "UTC",
      nextRunAt: row.nextRunAt,
    };
    const next = computeNextRun(s, now);
    const res = await prisma.reportSchedule.updateMany({
      // Atomic claim: re-assert "still due" in the UPDATE itself. Postgres row
      // locking serializes concurrent ticks — the first advances nextRunAt into
      // the future, the second re-evaluates this WHERE against the new value and
      // matches 0 rows. (We must NOT compare the exact observed nextRunAt: it's
      // a microsecond-precision timestamptz that a JS Date truncates to ms, so
      // an equality filter would never match and nothing would ever be claimed.)
      where: { id: row.id, enabled: true, nextRunAt: { lte: now } },
      data: { nextRunAt: next, lastRunAt: now },
    });
    if (res.count === 1) claimed.push(s);
  }
  return claimed;
}
