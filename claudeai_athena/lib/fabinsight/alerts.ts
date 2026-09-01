/**
 * Discrepancy alerts.
 *
 * Generalized from the original equipment-idle POC into an admin-driven engine:
 * thresholds live in `alert_thresholds` (written by the admin app), each maps to
 * a metric in the registry (metrics.ts) whose value is derived by reusing the
 * existing dashboard queries, and a breach emails the alert roles + is logged to
 * audit_logs (so it also shows on the Audit Logs page). Evaluated on the
 * scheduler tick, throttled per-threshold so it doesn't spam while it stays over.
 *
 * The seeded row `equipment_idle_pct gt 30` preserves the original POC behavior.
 */
import { prisma } from "@/lib/db";
import { getDashboard, fetchDashboardData, type DashboardData } from "@/lib/fabinsight/dashboards";
import { ALERT_METRICS, getMetric } from "@/lib/fabinsight/alert-metrics";
import { resolveAlertRecipients } from "@/lib/fabinsight/alert-recipients";
import { parseCustomDef, fetchCustomData } from "@/lib/fabinsight/custom";

type ThresholdRow = {
  id: string;
  metricKey: string;
  label: string | null;
  comparator: string;
  minValue: number | null;
  maxValue: number | null;
  throttleMin: number;
  recipientRoleIds: unknown;
  dashboardId: string | null;
  customSetKey: string | null;
  customColumn: string | null;
};

/** Send one alert email via SMTP (same env the password-reset flow uses). */
async function sendAlertEmail(to: string[], subject: string, html: string): Promise<boolean> {
  const host = process.env.SMTP_SERVER;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM_EMAIL;
  if (!host || !user || !pass || !from) {
    console.warn("[alerts] SMTP not configured (SMTP_SERVER/USERNAME/PASSWORD/FROM_EMAIL) — skipping email");
    return false;
  }
  if (!to.length) {
    console.warn("[alerts] no recipients resolved for alert roles — skipping email");
    return false;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transport.sendMail({ from: `FabOrchestrator Alerts <${from}>`, to: to.join(", "), subject, html });
  return true;
}

/** True when `value` breaches the threshold. Missing bounds → not breached. */
function isBreached(t: ThresholdRow, value: number): boolean {
  switch (t.comparator) {
    case "gt":
      return t.maxValue !== null && value > t.maxValue;
    case "lt":
      return t.minValue !== null && value < t.minValue;
    case "outside":
      return (t.minValue !== null && value < t.minValue) || (t.maxValue !== null && value > t.maxValue);
    default:
      return false;
  }
}

/** Human-readable bound description for the email/subject. */
function boundText(t: ThresholdRow, unit: string): string {
  const u = unit === "%" ? "%" : "";
  if (t.comparator === "gt") return `above ${t.maxValue}${u}`;
  if (t.comparator === "lt") return `below ${t.minValue}${u}`;
  return `outside ${t.minValue}${u}–${t.maxValue}${u}`;
}

/** Skip if this threshold already alerted within its throttle window. */
async function isThrottled(thresholdId: string, throttleMin: number): Promise<boolean> {
  const recent = (await prisma.$queryRawUnsafe(
    `SELECT 1 FROM audit_logs
      WHERE action = 'alert.discrepancy'
        AND metadata->>'thresholdId' = $1
        AND created_at > now() - ($2 || ' minutes')::interval
      LIMIT 1`,
    thresholdId,
    String(throttleMin),
  )) as unknown[];
  return recent.length > 0;
}

/**
 * Evaluate all active discrepancy thresholds. Fetches each needed dashboard once,
 * compares each metric against its threshold, and on breach emails the alert
 * roles + logs to audit_logs. Throttled per-threshold. Safe to call every tick.
 */
export async function runDiscrepancyAlerts(now: Date = new Date()): Promise<void> {
  try {
    const thresholds = (await prisma.alertThreshold.findMany({
      where: { isActive: true },
      select: {
        id: true,
        metricKey: true,
        label: true,
        comparator: true,
        minValue: true,
        maxValue: true,
        throttleMin: true,
        recipientRoleIds: true,
        dashboardId: true,
        customSetKey: true,
        customColumn: true,
      },
    })) as ThresholdRow[];
    if (!thresholds.length) return;

    // Lazy, memoized loaders — each curated dashboard or custom pinned dashboard
    // is fetched at most once per pass (45s cache makes repeats free).
    const curated = new Map<string, DashboardData | null>();
    const custom = new Map<string, DashboardData | null>();
    const loadCurated = async (id: string): Promise<DashboardData | null> => {
      if (curated.has(id)) return curated.get(id) ?? null;
      const def = getDashboard(id);
      let data: DashboardData | null = null;
      if (def) {
        try {
          data = await fetchDashboardData(def);
        } catch (e) {
          console.error(`[alerts] dashboard ${id} fetch failed`, e);
        }
      }
      curated.set(id, data);
      return data;
    };
    const loadCustom = async (pinnedId: string): Promise<DashboardData | null> => {
      if (custom.has(pinnedId)) return custom.get(pinnedId) ?? null;
      let data: DashboardData | null = null;
      try {
        const pin = await prisma.pinnedDashboard.findUnique({ where: { id: pinnedId }, select: { definition: true } });
        if (pin?.definition) data = await fetchCustomData(parseCustomDef(pin.definition));
      } catch (e) {
        console.error(`[alerts] custom dashboard ${pinnedId} fetch failed`, e);
      }
      custom.set(pinnedId, data);
      return data;
    };

    for (const t of thresholds) {
      // Resolve the metric's current value + display info, curated or custom.
      let value: number | null = null;
      let name = t.label ?? "";
      let unit = "";
      let dashRef = t.dashboardId ?? "";
      let metricRef = t.metricKey;

      const metric = getMetric(t.metricKey);
      if (metric) {
        const data = await loadCurated(metric.dashboardId);
        if (!data) continue; // dashboard fetch failed — skip, no false alert
        value = metric.select(data);
        name = t.label || metric.label;
        unit = metric.unit;
        dashRef = metric.dashboardId;
        metricRef = metric.key;
      } else if (t.metricKey.startsWith("custom:") && t.dashboardId && t.customSetKey && t.customColumn) {
        const data = await loadCustom(t.dashboardId);
        if (!data) continue;
        const set = data.sets.find((sSet) => sSet.key === t.customSetKey);
        if (!set || set.error || !set.rows.length) continue;
        const raw = set.rows[0][t.customColumn];
        value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
        name = t.label || t.customColumn;
      } else {
        continue; // unknown / malformed metric — skip
      }

      if (value === null || !Number.isFinite(value)) continue;
      if (!isBreached(t, value)) continue;
      if (await isThrottled(t.id, t.throttleMin)) continue;

      const roleIds = Array.isArray(t.recipientRoleIds)
        ? (t.recipientRoleIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const recipients = await resolveAlertRecipients(roleIds);
      const shown = unit === "%" ? `${value.toFixed(1)}%` : `${Math.round(value)}${unit ? " " + unit : ""}`;
      const bound = boundText(t, unit);
      const subject = `⚠️ Discrepancy: ${name} is ${shown} (${bound})`;
      const html = `
        <p><b>Discrepancy alert</b></p>
        <p><b>${name}</b> is <b>${shown}</b>, which is ${bound} the configured range.</p>
        <ul>
          <li>Metric: ${name}</li>
          <li>Current value: ${shown}</li>
          <li>Threshold: ${bound}</li>
          <li>Dashboard: ${dashRef}</li>
        </ul>
        <p>As of ${now.toISOString()} (UTC).</p>`;

      const emailed = await sendAlertEmail(recipients, subject, html);

      await prisma
        .$executeRawUnsafe(
          `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, metadata, created_at)
           VALUES (gen_random_uuid()::text, NULL, 'alert.discrepancy', 'Alert', $1, $2::jsonb, now())`,
          t.id,
          JSON.stringify({
            thresholdId: t.id,
            metricKey: metricRef,
            value: Number(value.toFixed(2)),
            min: t.minValue,
            max: t.maxValue,
            comparator: t.comparator,
            dashboardId: dashRef,
            recipientsCount: recipients.length,
            emailed,
          }),
        )
        .catch(() => {});

      console.log(`[alerts] ${metricRef}=${shown} breached (${bound}) — emailed=${emailed} to ${recipients.length}`);
    }
  } catch (e) {
    console.error("[alerts] discrepancy run failed", e);
  }
}

// Re-export the catalog for any caller that wants the metric list.
export { ALERT_METRICS };
