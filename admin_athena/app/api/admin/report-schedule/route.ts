import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth-middleware";
import prisma from "@/lib/db";
import { computeReportNextRun, toFrequency } from "@/lib/report-schedule";
import { getSchedulableDashboards, resolveAgainst } from "@/lib/report-dashboards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Apply a report-refresh schedule. Called by the in-chat ScheduleForm card's
 * Confirm button (deterministic write, not model-mediated). Upserts one row per
 * dashboard into report_schedules (shared DB); Fab Orch's cron tick reads it.
 * All times are UTC.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      database?: string;
      report?: string | string[];
      frequency?: string;
      intervalMinutes?: number;
      atTime?: string;
      dayOfWeek?: number;
      daysOfWeek?: number[];
      dayOfMonth?: number;
      enabled?: boolean;
      timezone?: string;
      windowStart?: string;
      windowEnd?: string;
    };

    const sourceKey = (body.database || "lumentum").trim() || "lumentum";
    const timezone = (body.timezone || "UTC").trim() || "UTC";
    const frequency = toFrequency(body.frequency);
    const enabled = body.enabled ?? true;
    const isHM = (v?: string) => !!v && /^(\d{1,2}):(\d{2})$/.test(v.trim());
    // Active window only applies to interval ("hourly") schedules.
    const windowStart = frequency === "hourly" && isHM(body.windowStart) ? body.windowStart!.trim() : null;
    const windowEnd = frequency === "hourly" && isHM(body.windowEnd) ? body.windowEnd!.trim() : null;
    // Weekly can run on several days ("1,3,5"). Sanitize to 0-6 ints.
    const daysList = Array.isArray(body.daysOfWeek)
      ? [...new Set(body.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [];
    const daysOfWeekStr = daysList.length ? daysList.join(",") : null;

    // Resolve against the LIVE pinned dashboards (7 curated + custom), not a
    // fixed list — so a newly-created custom dashboard is schedulable here too.
    const list = await getSchedulableDashboards();
    const ids = resolveAgainst(list, body.report ?? []);
    if (ids.length === 0) {
      return NextResponse.json(
        {
          error: `Select a report. Available: ${list.map((d) => d.label).join(", ") || "(none pinned yet)"}, or "All reports".`,
        },
        { status: 400 },
      );
    }

    const nextRun = computeReportNextRun(frequency, { ...body, daysOfWeek: daysList, timezone, windowStart, windowEnd }, new Date());
    for (const id of ids) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO report_schedules
           (id, dashboard_id, source_key, frequency, interval_minutes, at_time, day_of_week, days_of_week, day_of_month, enabled, next_run_at, updated_by_id, timezone, window_start, window_end, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
         ON CONFLICT (dashboard_id, source_key) DO UPDATE SET
           frequency = EXCLUDED.frequency,
           interval_minutes = EXCLUDED.interval_minutes,
           at_time = EXCLUDED.at_time,
           day_of_week = EXCLUDED.day_of_week,
           days_of_week = EXCLUDED.days_of_week,
           day_of_month = EXCLUDED.day_of_month,
           enabled = EXCLUDED.enabled,
           next_run_at = EXCLUDED.next_run_at,
           updated_by_id = EXCLUDED.updated_by_id,
           timezone = EXCLUDED.timezone,
           window_start = EXCLUDED.window_start,
           window_end = EXCLUDED.window_end,
           updated_at = now()`,
        id,
        sourceKey,
        frequency,
        body.intervalMinutes ?? null,
        body.atTime ?? null,
        body.dayOfWeek ?? null,
        daysOfWeekStr,
        body.dayOfMonth ?? null,
        enabled,
        nextRun,
        auth.user.id,
        timezone,
        windowStart,
        windowEnd,
      );
    }

    prisma.auditLog
      .create({
        data: {
          userId: auth.user.id,
          action: "report.schedule_set",
          targetType: "ReportSchedule",
          targetId: sourceKey,
          metadata: {
            dashboards: ids,
            frequency,
            intervalMinutes: body.intervalMinutes ?? null,
            atTime: body.atTime ?? null,
            dayOfWeek: body.dayOfWeek ?? null,
            daysOfWeek: daysOfWeekStr,
            dayOfMonth: body.dayOfMonth ?? null,
            enabled,
            sourceKey,
          },
        },
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      updated: ids.map((id) => list.find((d) => d.id === id)?.label ?? id),
      frequency,
      enabled,
      sourceKey,
      nextRunAtUtc: nextRun.toISOString(),
    });
  } catch (e) {
    console.error("[api/admin/report-schedule] failed", e);
    return NextResponse.json({ error: "Could not save the schedule." }, { status: 500 });
  }
}

/**
 * GET — the live list of schedulable dashboards (everything pinned to Recent
 * Reports: the 7 curated dashboards plus any admin-created custom ones), for the
 * in-chat schedule form's report dropdown. Each carries a `scheduled` flag.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const dashboards = await getSchedulableDashboards();
    type Row = {
      dashboard_id: string; frequency: string; interval_minutes: number | null; at_time: string | null;
      days_of_week: string | null; day_of_month: number | null; timezone: string | null; enabled: boolean;
      window_start: string | null; window_end: string | null;
    };
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT dashboard_id, frequency, interval_minutes, at_time, days_of_week, day_of_month, timezone, enabled, window_start, window_end
         FROM report_schedules`,
    )) as Row[];
    const schedules = rows.map((r) => ({
      dashboardId: r.dashboard_id,
      frequency: r.frequency,
      intervalMinutes: r.interval_minutes,
      atTime: r.at_time,
      daysOfWeek: r.days_of_week ? r.days_of_week.split(",").map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n <= 6) : [],
      dayOfMonth: r.day_of_month,
      timezone: r.timezone ?? "UTC",
      enabled: r.enabled,
      windowStart: r.window_start,
      windowEnd: r.window_end,
    }));
    return NextResponse.json({ dashboards, schedules });
  } catch (e) {
    console.error("[api/admin/report-schedule] GET failed", e);
    return NextResponse.json({ error: "Could not load dashboards." }, { status: 500 });
  }
}
