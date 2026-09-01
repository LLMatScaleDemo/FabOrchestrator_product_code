/**
 * Discrepancy-alert metric registry, grouped by dashboard.
 *
 * The admin picks a DASHBOARD first, then a metric within it (never arbitrary
 * SQL). Each metric's value is derived by REUSING that dashboard's existing query
 * set — the SQL lives once in dashboards.ts, and `select` reads the already-
 * fetched rows of a DashboardData. If the backing set is missing or errored,
 * `select` returns null so the engine skips it (never a false breach on a
 * degraded MES/VPN).
 *
 * Coverage: all 7 curated dashboards. "lot-history" is per-lot (auto-resolves to
 * the most-active lot), so its single metric watches that tracked lot's hold
 * count — fab-wide hold/idle alerts live on Factory Operations / Executive.
 *
 * KEEP IN SYNC with admin_athena_WITH_SECRETS/lib/alert-metrics.ts
 * (dashboards + metric keys + labels + units + suggested defaults must match; the
 * admin copy has no compute and no MES imports, so it ships in the browser bundle).
 *
 * (Named alert-metrics.ts, distinct from metrics.ts = yield/OEE/scrap chat briefs.)
 */
import { type DashboardData } from "@/lib/fabinsight/dashboards";
import { num, type FabRow } from "@/lib/fabinsight/mcp";

export type Comparator = "gt" | "lt" | "outside";
export type MetricUnit = "%" | "lots" | "count";

/** Dashboards that have alertable metrics, in deck order. */
export const ALERT_DASHBOARDS: { id: string; title: string }[] = [
  { id: "factory-operations", title: "Factory Operations Dashboard" },
  { id: "lot-history", title: "Lot History" },
  { id: "process-analytics", title: "Process Analytics" },
  { id: "maintenance-prediction", title: "Maintenance Prediction" },
  { id: "bottleneck-prediction", title: "Bottleneck Prediction" },
  { id: "analytics-dashboard", title: "Analytics Dashboard" },
  { id: "executive-overview", title: "Executive Overview" },
];

export type MetricDef = {
  key: string;
  label: string;
  unit: MetricUnit;
  /** The curated dashboard whose query set supplies this metric's rows. */
  dashboardId: string;
  suggestedComparator: Comparator;
  suggestedThreshold: number;
  /** Read the numeric value from a fetched dashboard result. Returns null when
   *  the backing set is absent or errored (engine skips → no false alert). */
  select: (d: DashboardData) => number | null;
};

/** First row of a named set, or null if the set is missing / errored / empty. */
function firstRow(d: DashboardData, key: string): FabRow | null {
  const set = d.sets.find((s) => s.key === key);
  if (!set || set.error || !set.rows.length) return null;
  return set.rows[0];
}

/** Read one numeric column off a single-row set. */
function scalar(d: DashboardData, setKey: string, col: string): number | null {
  const r = firstRow(d, setKey);
  return r ? num(r[col]) : null;
}

export const ALERT_METRICS: MetricDef[] = [
  // ── Factory Operations ────────────────────────────────────────────────────
  { key: "fo_wip_lots", label: "WIP lots", unit: "lots", dashboardId: "factory-operations", suggestedComparator: "gt", suggestedThreshold: 6000,
    select: (d) => scalar(d, "factoryStatus", "WipLots") },
  { key: "fo_lots_on_hold", label: "Lots on hold", unit: "lots", dashboardId: "factory-operations", suggestedComparator: "gt", suggestedThreshold: 10,
    select: (d) => scalar(d, "factoryStatus", "OnHold") },
  { key: "fo_wip_units", label: "WIP units", unit: "count", dashboardId: "factory-operations", suggestedComparator: "gt", suggestedThreshold: 200000,
    select: (d) => scalar(d, "factoryStatus", "WipUnits") },

  // ── Lot History (per-lot: watches the auto-tracked most-active lot) ────────
  { key: "lh_tracked_lot_holds", label: "Tracked lot — hold count", unit: "count", dashboardId: "lot-history", suggestedComparator: "gt", suggestedThreshold: 0,
    select: (d) => scalar(d, "lotStatus", "CurrentHoldCount") },

  // ── Process Analytics ─────────────────────────────────────────────────────
  { key: "pa_first_pass_yield_pct", label: "First-pass yield %", unit: "%", dashboardId: "process-analytics", suggestedComparator: "lt", suggestedThreshold: 90,
    select: (d) => {
      const r = firstRow(d, "yieldTrend");
      if (!r || r.FirstPassYield_Pct === null || r.FirstPassYield_Pct === undefined) return null;
      return num(r.FirstPassYield_Pct);
    } },
  { key: "pa_wip_lots", label: "WIP lots (live)", unit: "lots", dashboardId: "process-analytics", suggestedComparator: "gt", suggestedThreshold: 6000,
    select: (d) => scalar(d, "wipNow", "WipLots") },
  { key: "pa_lots_with_loss", label: "Lots with material loss", unit: "lots", dashboardId: "process-analytics", suggestedComparator: "gt", suggestedThreshold: 50,
    select: (d) => scalar(d, "wipNow", "LotsWithLoss") },
  { key: "pa_units_lost", label: "Units lost", unit: "count", dashboardId: "process-analytics", suggestedComparator: "gt", suggestedThreshold: 1000,
    select: (d) => scalar(d, "wipNow", "UnitsLost") },

  // ── Maintenance Prediction ────────────────────────────────────────────────
  // equipment_idle_pct key is preserved (seeded row + original POC behavior).
  { key: "equipment_idle_pct", label: "Equipment idle %", unit: "%", dashboardId: "maintenance-prediction", suggestedComparator: "gt", suggestedThreshold: 30,
    select: (d) => {
      const r = firstRow(d, "scheduled");
      if (!r) return null;
      const total = num(r.TotalResources);
      if (total <= 0) return null;
      return ((total - num(r.ResourcesUsed)) / total) * 100;
    } },

  // ── Bottleneck Prediction ─────────────────────────────────────────────────
  { key: "bp_lots_expired", label: "Lots expired", unit: "count", dashboardId: "bottleneck-prediction", suggestedComparator: "gt", suggestedThreshold: 0,
    select: (d) => scalar(d, "expiryHorizon", "AlreadyExpired") },
  { key: "bp_lots_due_soon", label: "Lots due by coming Monday", unit: "count", dashboardId: "bottleneck-prediction", suggestedComparator: "gt", suggestedThreshold: 20,
    select: (d) => scalar(d, "expiryHorizon", "DueByComingMonday") },

  // ── Analytics Dashboard ───────────────────────────────────────────────────
  { key: "an_scrap_units", label: "Total scrap / reject units", unit: "count", dashboardId: "analytics-dashboard", suggestedComparator: "gt", suggestedThreshold: 500,
    select: (d) => scalar(d, "yieldAndLossQty", "LossQuantity") },

  // ── Executive Overview ────────────────────────────────────────────────────
  { key: "eo_on_time_delivery_pct", label: "On-time delivery %", unit: "%", dashboardId: "executive-overview", suggestedComparator: "lt", suggestedThreshold: 90,
    select: (d) => {
      const r = firstRow(d, "onTimeDelivery");
      if (!r) return null;
      const total = num(r.TotalOrders);
      if (total <= 0) return null;
      return ((total - num(r.Late)) / total) * 100;
    } },
  { key: "eo_late_orders", label: "Late orders", unit: "count", dashboardId: "executive-overview", suggestedComparator: "gt", suggestedThreshold: 50,
    select: (d) => scalar(d, "onTimeDelivery", "Late") },
  { key: "eo_active_wip_lots", label: "Active WIP lots", unit: "lots", dashboardId: "executive-overview", suggestedComparator: "gt", suggestedThreshold: 6000,
    select: (d) => scalar(d, "activeWipNow", "WipLots") },
  { key: "eo_lots_on_hold", label: "Lots on hold", unit: "lots", dashboardId: "executive-overview", suggestedComparator: "gt", suggestedThreshold: 10,
    select: (d) => scalar(d, "activeWipNow", "OnHold") },
  { key: "eo_daily_units_out", label: "Latest-day units out", unit: "count", dashboardId: "executive-overview", suggestedComparator: "lt", suggestedThreshold: 1000,
    select: (d) => scalar(d, "dailyPerformance", "UnitsOut") },
];

const BY_KEY = new Map(ALERT_METRICS.map((m) => [m.key, m]));

export function getMetric(key: string): MetricDef | undefined {
  return BY_KEY.get(key);
}
