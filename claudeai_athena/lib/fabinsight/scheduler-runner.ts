/**
 * In-app report-refresh scheduler.
 *
 * Runs inside the always-on Elastic Beanstalk Node process (started from
 * instrumentation.ts on server boot). Replaces the external EventBridge trigger:
 * a lightweight timer calls the same `runDueReportRefresh()` in-process every
 * ~minute. Concurrency-safe even under the ASG's 1→2 scaling because the DB
 * claim is atomic — no external infrastructure required.
 *
 * A globalThis singleton guard ensures only one timer runs per process even if
 * `register()` is invoked more than once (dev HMR, double module eval).
 */

import { runDueReportRefresh } from "@/lib/fabinsight/refresh";
import { runDiscrepancyAlerts } from "@/lib/fabinsight/alerts";
import { sampleMetricBaselines } from "@/lib/fabinsight/baselines";
import { runDueShiftSummaries } from "@/lib/fabinsight/shift-summary";

const g = globalThis as unknown as { __fabReportSchedulerStarted?: boolean };

export function startReportScheduler(): void {
  if (g.__fabReportSchedulerStarted) return;
  g.__fabReportSchedulerStarted = true;

  // Heartbeat interval — the effective per-dashboard cadence still lives in the
  // report_schedules table; this is just how often we check "anything due?".
  const intervalMs = Math.max(15_000, Number(process.env.REPORT_TICK_INTERVAL_MS ?? "60000"));
  // Hard ceiling on a single pass. A refresh renders every due dashboard's pins
  // against Lumentum; if the MES/VPN degrades those queries slow to their own
  // timeouts and a pass could otherwise outlive its interval. The cap bounds how
  // long one pass can hold DB/MES connections so passes can't pile up.
  const tickTimeoutMs = Math.max(30_000, Number(process.env.REPORT_TICK_TIMEOUT_MS ?? "120000"));

  // Non-overlap guard: setInterval fires on a fixed clock regardless of whether
  // the previous pass finished. If a pass runs long (slow MES), a naive timer
  // would stack overlapping passes, each holding pool connections — the exact
  // amplifier that can starve the pool and wedge the instance. Skip a tick while
  // one is still in flight.
  let running = false;

  const tick = async () => {
    // Lock stays held until the REAL work settles — not until a timeout fires —
    // because the underlying SQL promises aren't cancellable. This guarantees no
    // two passes ever run concurrently. Per-query timeouts (pg 30s, mssql 60s)
    // ensure the real work always settles, so the lock can't be held forever.
    if (running) {
      console.warn("[report-scheduler] previous pass still running — skipping this tick");
      return;
    }
    running = true;
    // Warn (don't abort) if a pass overruns its budget — a signal the MES/VPN is
    // degraded and passes are running long.
    const warnTimer = setTimeout(
      () => console.warn(`[report-scheduler] pass still running after ${tickTimeoutMs}ms — MES/VPN may be degraded`),
      tickTimeoutMs,
    );
    try {
      const out = await runDueReportRefresh();
      if (out.claimed > 0) {
        console.log(`[report-scheduler] claimed ${out.claimed}, refreshed ${out.refreshed}, failed ${out.failed}`);
      }
      // Discrepancy alerts — evaluated each tick against admin-set thresholds,
      // throttled per-threshold internally.
      await runDiscrepancyAlerts();
      // Metric baselines — sample metric values for the admin's dynamic "normal
      // range"; globally throttled (default every 15 min) inside the call.
      await sampleMetricBaselines();
      // Shift-summary emails — send at each configured shift boundary (PST).
      await runDueShiftSummaries();
    } catch (err) {
      console.error("[report-scheduler] tick failed", err);
    } finally {
      clearTimeout(warnTimer);
      running = false;
    }
  };

  // Small delay after boot so the DB pool is warm, then run on the interval.
  setTimeout(() => void tick(), 10_000);
  setInterval(() => void tick(), intervalMs);
  console.log(`[report-scheduler] in-app timer started (every ${intervalMs}ms, tick cap ${tickTimeoutMs}ms)`);
}
