import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth-middleware";
import prisma from "@/lib/db";
import {
  REPORT_DASHBOARDS,
  resolveDashboardIds,
  computeReportNextRun,
  toFrequency,
} from "@/lib/report-schedule";

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
    };

    const sourceKey = (body.database || "lumentum").trim() || "lumentum";
    const frequency = toFrequency(body.frequency);
    const enabled = body.enabled ?? true;
    // Weekly can run on several days ("1,3,5"). Sanitize to 0-6 ints.
    const daysList = Array.isArray(body.daysOfWeek)
      ? [...new Set(body.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [];
    const daysOfWeekStr = daysList.length ? daysList.join(",") : null;

    const ids = resolveDashboardIds(body.report ?? []);
    if (ids.length === 0) {
      return NextResponse.json(
        {
          error: `Select a report. Valid options: ${REPORT_DASHBOARDS.map((d) => d.label).join(", ")}, or "All reports".`,
        },
        { status: 400 },
      );
    }

    const nextRun = computeReportNextRun(frequency, { ...body, daysOfWeek: daysList }, new Date());
    for (const id of ids) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO report_schedules
           (id, dashboard_id, source_key, frequency, interval_minutes, at_time, day_of_week, days_of_week, day_of_month, enabled, next_run_at, updated_by_id, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
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
      updated: ids.map((id) => REPORT_DASHBOARDS.find((d) => d.id === id)?.label ?? id),
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
