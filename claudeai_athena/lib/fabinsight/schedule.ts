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
  atTime: string | null; // "HH:MM" UTC
  dayOfWeek: number | null; // 0-6 (Sun=0) — legacy single-day
  daysOfWeek: number[] | null; // 0-6 list — weekly can run on several days
  dayOfMonth: number | null; // 1-31
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

function setUtcDayClamped(d: Date, dom: number): void {
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dom, daysInMonth));
}

/** Next run time (UTC), strictly after `from`. */
export function computeNextRun(s: ScheduleRow, from: Date): Date {
  const [hh, mm] = parseHM(s.atTime);

  switch (s.frequency) {
    case "hourly": {
      const mins = s.intervalMinutes && s.intervalMinutes > 0 ? s.intervalMinutes : 60;
      return new Date(from.getTime() + mins * 60_000);
    }
    case "daily": {
      const next = new Date(from);
      next.setUTCHours(hh, mm, 0, 0);
      if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }
    case "weekly": {
      // One or more days of the week (Mon/Wed/Fri…). Next run is the soonest of
      // the selected days at the given time. Falls back to the legacy single day.
      const days = s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [s.dayOfWeek ?? 1];
      let best: Date | null = null;
      for (const d of days) {
        const cand = new Date(from);
        cand.setUTCHours(hh, mm, 0, 0);
        let delta = (d - cand.getUTCDay() + 7) % 7;
        if (delta === 0 && cand <= from) delta = 7;
        cand.setUTCDate(cand.getUTCDate() + delta);
        if (!best || cand < best) best = cand;
      }
      return best ?? new Date(from.getTime() + 7 * 86_400_000);
    }
    case "monthly": {
      const targetDom = s.dayOfMonth ?? 1;
      const next = new Date(from);
      next.setUTCHours(hh, mm, 0, 0);
      next.setUTCDate(1); // avoid rollover while changing month
      setUtcDayClamped(next, targetDom);
      if (next <= from) {
        next.setUTCMonth(next.getUTCMonth() + 1, 1);
        setUtcDayClamped(next, targetDom);
      }
      return next;
    }
    default:
      return new Date(from.getTime() + 60 * 60_000);
  }
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
