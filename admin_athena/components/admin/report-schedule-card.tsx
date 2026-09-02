"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { REPORT_DASHBOARDS, REPORT_SOURCES, toFrequency, type ReportFrequency } from "@/lib/report-schedule";
import { listTimezones, browserTz, canonicalTz } from "@/lib/timezones";

type DashOption = { id: string; label: string };

/** A current schedule row returned by GET, used to pre-fill the form on reschedule. */
type ScheduleRow = {
  dashboardId: string;
  frequency: string;
  intervalMinutes: number | null;
  atTime: string | null;
  daysOfWeek: number[] | null;
  dayOfMonth: number | null;
  timezone: string | null;
  enabled: boolean;
  windowStart: string | null;
  windowEnd: string | null;
};

export type ScheduleFormInitial = {
  database?: string;
  report?: string; // dashboard id/label or "all"
  frequency?: string;
  intervalMinutes?: number;
  atTime?: string; // "HH:MM"
  dayOfWeek?: number; // 0-6 (legacy single day)
  daysOfWeek?: number[]; // 0-6 list
  dayOfMonth?: number; // 1-31
  enabled?: boolean;
  timezone?: string; // IANA tz for atTime/day (default: the admin's browser tz)
  windowStart?: string; // "HH:MM" — interval active-window start
  windowEnd?: string; // "HH:MM" — interval active-window end
};

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TZ_OPTIONS = listTimezones();

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve a marker's report value to a <select> value: "all", a dashboard id, or "". */
function resolveReportValue(input: string | undefined, list: DashOption[]): string {
  if (!input) return "";
  if (norm(input) === "all") return "all";
  const n = norm(input);
  const hit =
    list.find((d) => norm(d.id) === n || norm(d.label) === n) ??
    list.find((d) => norm(d.label).includes(n));
  return hit ? hit.id : "";
}

const selectCls =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

/**
 * In-chat form to set a report's refresh schedule. Pre-filled from the current
 * schedule (on reschedule) and/or what the model parsed out of the admin's text;
 * the admin adjusts the dropdowns and confirms. Confirm POSTs to
 * /api/admin/report-schedule (deterministic write).
 */
export function ReportScheduleCard({
  initial,
  active = true,
  token,
  onDone,
}: {
  initial: ScheduleFormInitial;
  active?: boolean;
  token: string | null;
  onDone?: (summary: string | null) => void;
}) {
  const [database, setDatabase] = useState(initial.database || REPORT_SOURCES[0].key);
  const [dashboards, setDashboards] = useState<DashOption[]>(REPORT_DASHBOARDS);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [report, setReport] = useState(() => resolveReportValue(initial.report, REPORT_DASHBOARDS));

  const [frequency, setFrequency] = useState<ReportFrequency>(toFrequency(initial.frequency));
  const [intervalMinutes, setIntervalMinutes] = useState<number>(initial.intervalMinutes || 60);
  const [atTime, setAtTime] = useState<string>(initial.atTime || "06:00");
  const [timezone, setTimezone] = useState<string>(canonicalTz(initial.timezone) || browserTz());
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(() => {
    if (initial.daysOfWeek && initial.daysOfWeek.length) {
      return [...new Set(initial.daysOfWeek.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
    }
    return typeof initial.dayOfWeek === "number" ? [initial.dayOfWeek] : [1];
  });
  const [dayOfMonth, setDayOfMonth] = useState<number>(initial.dayOfMonth ?? 1);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled ?? true);
  const [windowStart, setWindowStart] = useState<string>(initial.windowStart || "");
  const [windowEnd, setWindowEnd] = useState<string>(initial.windowEnd || "");

  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Fill the form fields from an existing schedule row (reschedule pre-fill).
  const applySchedule = (s: ScheduleRow) => {
    setFrequency(toFrequency(s.frequency));
    setIntervalMinutes(s.intervalMinutes || 60);
    setAtTime(s.atTime || "06:00");
    setTimezone(canonicalTz(s.timezone) || browserTz());
    setDaysOfWeek(s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [1]);
    setDayOfMonth(s.dayOfMonth ?? 1);
    setEnabled(s.enabled ?? true);
    setWindowStart(s.windowStart || "");
    setWindowEnd(s.windowEnd || "");
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/admin/report-schedule", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { dashboards?: DashOption[]; schedules?: ScheduleRow[] } | null) => {
        if (cancelled || !j) return;
        const live = j.dashboards?.length ? j.dashboards.map((d) => ({ id: d.id, label: d.label })) : REPORT_DASHBOARDS;
        setDashboards(live);
        setSchedules(j.schedules ?? []);
        const id = resolveReportValue(initial.report, live) || report;
        setReport(id);
        // Pre-fill from the existing schedule for this report, then let any
        // fields the admin explicitly named in their message win.
        const existing = (j.schedules ?? []).find((s) => s.dashboardId === id);
        if (existing) {
          applySchedule(existing);
          if (initial.frequency) setFrequency(toFrequency(initial.frequency));
          if (initial.intervalMinutes) setIntervalMinutes(initial.intervalMinutes);
          if (initial.atTime) setAtTime(initial.atTime);
          if (initial.timezone) setTimezone(canonicalTz(initial.timezone));
          if (initial.daysOfWeek?.length) setDaysOfWeek([...new Set(initial.daysOfWeek.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b));
          if (typeof initial.dayOfMonth === "number") setDayOfMonth(initial.dayOfMonth);
          if (typeof initial.enabled === "boolean") setEnabled(initial.enabled);
          if (initial.windowStart) setWindowStart(initial.windowStart);
          if (initial.windowEnd) setWindowEnd(initial.windowEnd);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initial.report]);

  // Switching the report in the dropdown loads that report's current schedule.
  const onReportChange = (id: string) => {
    setReport(id);
    const existing = schedules.find((s) => s.dashboardId === id);
    if (existing) applySchedule(existing);
  };

  const toggleDay = (d: number) =>
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  const weeklyDaysMissing = frequency === "weekly" && daysOfWeek.length === 0;
  const windowInvalid = frequency === "hourly" && !!windowStart && !!windowEnd && windowStart >= windowEnd;
  const canSave = active && report !== "" && !weeklyDaysMissing && !windowInvalid && state !== "saving" && state !== "saved";

  const submit = async () => {
    if (!canSave) return;
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/admin/report-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          database,
          report,
          frequency,
          intervalMinutes: frequency === "hourly" ? intervalMinutes : undefined,
          atTime: frequency !== "hourly" ? atTime : undefined,
          daysOfWeek: frequency === "weekly" ? daysOfWeek : undefined,
          dayOfMonth: frequency === "monthly" ? dayOfMonth : undefined,
          timezone,
          windowStart: frequency === "hourly" && windowStart ? windowStart : undefined,
          windowEnd: frequency === "hourly" && windowEnd ? windowEnd : undefined,
          enabled,
        }),
      });
      const raw = await res.text();
      const json = raw ? (JSON.parse(raw) as { error?: string; updated?: string[]; nextRunAtUtc?: string }) : {};
      if (!res.ok) throw new Error(json.error ?? `Could not save the schedule (${res.status}).`);

      const scope = report === "all" ? "all reports" : (json.updated?.[0] ?? "the report");
      const daysLabel = daysOfWeek.map((d) => DOW_SHORT[d]).join(", ");
      const win = windowStart && windowEnd ? ` between ${windowStart}–${windowEnd} ${timezone}` : "";
      const cadence =
        frequency === "hourly"
          ? `every ${intervalMinutes} min${win}`
          : frequency === "daily"
            ? `daily at ${atTime} ${timezone}`
            : frequency === "weekly"
              ? `weekly on ${daysLabel} at ${atTime} ${timezone}`
              : `monthly on day ${dayOfMonth} at ${atTime} ${timezone}`;
      const summary = enabled
        ? `✅ Scheduled ${scope} — ${cadence}.`
        : `⏸ Paused the schedule for ${scope}.`;
      setState("saved");
      onDone?.(summary);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Could not save the schedule.");
    }
  };

  const reportOptions = useMemo(
    () => [{ value: "all", label: "All reports" }, ...dashboards.map((d) => ({ value: d.id, label: d.label }))],
    [dashboards],
  );

  const disabled = !active || state === "saving" || state === "saved";

  return (
    <div className="mt-1 rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">🗓</span>
        Schedule report refresh
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">
          times in {timezone.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Database</label>
          <select className={selectCls} value={database} disabled={disabled} onChange={(e) => setDatabase(e.target.value)}>
            {REPORT_SOURCES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Report</label>
          <select className={selectCls} value={report} disabled={disabled} onChange={(e) => onReportChange(e.target.value)}>
            <option value="" disabled>Select a report…</option>
            {reportOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Frequency</label>
          <select
            className={selectCls}
            value={frequency}
            disabled={disabled}
            onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
          >
            <option value="hourly">Interval (every N min)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {frequency === "hourly" && (
          <div>
            <label className={labelCls}>Every (minutes)</label>
            <input
              type="number" min={5} max={1440} step={5}
              className={selectCls} value={intervalMinutes} disabled={disabled}
              onChange={(e) => setIntervalMinutes(Math.max(5, Number(e.target.value) || 60))}
            />
          </div>
        )}

        {frequency === "hourly" && (
          <>
            <div>
              <label className={labelCls}>Active from (optional)</label>
              <input type="time" className={selectCls} value={windowStart} disabled={disabled} onChange={(e) => setWindowStart(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Active until (optional)</label>
              <input type="time" className={selectCls} value={windowEnd} disabled={disabled} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
            {windowInvalid && <p className="text-xs text-destructive sm:col-span-2">Start time must be before end time.</p>}
          </>
        )}

        {(frequency === "daily" || frequency === "weekly" || frequency === "monthly") && (
          <div>
            <label className={labelCls}>Time</label>
            <input type="time" className={selectCls} value={atTime} disabled={disabled} onChange={(e) => setAtTime(e.target.value)} />
          </div>
        )}

        <div>
          <label className={labelCls}>Timezone</label>
          <select className={selectCls} value={timezone} disabled={disabled} onChange={(e) => setTimezone(e.target.value)}>
            {TZ_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>

        {frequency === "weekly" && (
          <div className="sm:col-span-2">
            <label className={labelCls}>Days (pick one or more)</label>
            <div className="flex flex-wrap gap-1.5">
              {DOW_SHORT.map((d, i) => {
                const on = daysOfWeek.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleDay(i)}
                    title={DOW[i]}
                    className={
                      "h-8 min-w-[44px] rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-60 " +
                      (on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-foreground hover:bg-accent")
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            {weeklyDaysMissing && <p className="mt-1 text-xs text-destructive">Pick at least one day.</p>}
          </div>
        )}

        {frequency === "monthly" && (
          <div>
            <label className={labelCls}>Day of month</label>
            <input
              type="number" min={1} max={31}
              className={selectCls} value={dayOfMonth} disabled={disabled}
              onChange={(e) => setDayOfMonth(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        )}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border border-input accent-primary" />
        Enabled
      </label>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {state === "saved" && <p className="mt-2 text-xs text-green-600">Saved. Applies within ~5 minutes.</p>}

      {active && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onDone?.(null)} disabled={state === "saving" || state === "saved"}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSave} title={report === "" ? "Select a report first" : undefined}>
            {state === "saving" ? "Saving…" : "Confirm"}
          </Button>
        </div>
      )}
    </div>
  );
}
