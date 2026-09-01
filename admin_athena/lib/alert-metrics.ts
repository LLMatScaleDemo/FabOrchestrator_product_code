/**
 * Discrepancy-alert metric catalog (admin side — compute-free), grouped by
 * dashboard. Drives the "Alert Thresholds" picker: choose a DASHBOARD, then a
 * metric within it. The admin app never computes metric values; the queries +
 * `select` logic live in Fab Orch.
 *
 * KEEP IN SYNC with claudeai_athena/lib/fabinsight/alert-metrics.ts
 * (dashboards + metric keys + labels + units + suggested defaults must match).
 */

export type Comparator = "gt" | "lt" | "outside";
export type MetricUnit = "%" | "lots" | "count";

export type AlertMetric = {
  key: string;
  label: string;
  unit: MetricUnit;
  dashboardId: string;
  suggestedComparator: Comparator;
  suggestedThreshold: number;
};

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

export const ALERT_METRICS: AlertMetric[] = [
  { key: "fo_wip_lots", label: "WIP lots", unit: "lots", dashboardId: "factory-operations", suggestedComparator: "gt", suggestedThreshold: 6000 },
  { key: "fo_lots_on_hold", label: "Lots on hold", unit: "lots", dashboardId: "factory-operations", suggestedComparator: "gt", suggestedThreshold: 10 },
  { key: "fo_wip_units", label: "WIP units", unit: "count", dashboardId: "factory-operations", suggestedComparator: "gt", suggestedThreshold: 200000 },

  { key: "lh_tracked_lot_holds", label: "Tracked lot — hold count", unit: "count", dashboardId: "lot-history", suggestedComparator: "gt", suggestedThreshold: 0 },

  { key: "pa_first_pass_yield_pct", label: "First-pass yield %", unit: "%", dashboardId: "process-analytics", suggestedComparator: "lt", suggestedThreshold: 90 },
  { key: "pa_wip_lots", label: "WIP lots (live)", unit: "lots", dashboardId: "process-analytics", suggestedComparator: "gt", suggestedThreshold: 6000 },
  { key: "pa_lots_with_loss", label: "Lots with material loss", unit: "lots", dashboardId: "process-analytics", suggestedComparator: "gt", suggestedThreshold: 50 },
  { key: "pa_units_lost", label: "Units lost", unit: "count", dashboardId: "process-analytics", suggestedComparator: "gt", suggestedThreshold: 1000 },

  { key: "equipment_idle_pct", label: "Equipment idle %", unit: "%", dashboardId: "maintenance-prediction", suggestedComparator: "gt", suggestedThreshold: 30 },

  { key: "bp_lots_expired", label: "Lots expired", unit: "count", dashboardId: "bottleneck-prediction", suggestedComparator: "gt", suggestedThreshold: 0 },
  { key: "bp_lots_due_soon", label: "Lots due by coming Monday", unit: "count", dashboardId: "bottleneck-prediction", suggestedComparator: "gt", suggestedThreshold: 20 },

  { key: "an_scrap_units", label: "Total scrap / reject units", unit: "count", dashboardId: "analytics-dashboard", suggestedComparator: "gt", suggestedThreshold: 500 },

  { key: "eo_on_time_delivery_pct", label: "On-time delivery %", unit: "%", dashboardId: "executive-overview", suggestedComparator: "lt", suggestedThreshold: 90 },
  { key: "eo_late_orders", label: "Late orders", unit: "count", dashboardId: "executive-overview", suggestedComparator: "gt", suggestedThreshold: 50 },
  { key: "eo_active_wip_lots", label: "Active WIP lots", unit: "lots", dashboardId: "executive-overview", suggestedComparator: "gt", suggestedThreshold: 6000 },
  { key: "eo_lots_on_hold", label: "Lots on hold", unit: "lots", dashboardId: "executive-overview", suggestedComparator: "gt", suggestedThreshold: 10 },
  { key: "eo_daily_units_out", label: "Latest-day units out", unit: "count", dashboardId: "executive-overview", suggestedComparator: "lt", suggestedThreshold: 1000 },
];

export const ALERT_METRIC_KEYS = new Set(ALERT_METRICS.map((m) => m.key));

export function getAlertMetric(key: string): AlertMetric | undefined {
  return ALERT_METRICS.find((m) => m.key === key);
}

/** Validate comparator + that the bound(s) it needs are present numbers. */
export function validateBounds(comparator: string, minValue: unknown, maxValue: unknown): string | null {
  if (!["gt", "lt", "outside"].includes(comparator)) return "Invalid comparator.";
  const hasMin = typeof minValue === "number" && Number.isFinite(minValue);
  const hasMax = typeof maxValue === "number" && Number.isFinite(maxValue);
  if (comparator === "gt" && !hasMax) return "An upper bound (max) is required for 'greater than'.";
  if (comparator === "lt" && !hasMin) return "A lower bound (min) is required for 'less than'.";
  if (comparator === "outside" && (!hasMin || !hasMax)) return "Both min and max are required for 'outside range'.";
  if (comparator === "outside" && hasMin && hasMax && (minValue as number) >= (maxValue as number)) return "Min must be less than max.";
  return null;
}
