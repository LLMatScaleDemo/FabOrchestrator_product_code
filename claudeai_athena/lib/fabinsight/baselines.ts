/**
 * Metric baseline sampler.
 *
 * Records each metric's current value into `metric_samples` on a slow cadence, so
 * the admin "Alert Thresholds" form can show a DYNAMIC normal range (7-day
 * min / avg / max + current) when picking a metric. Covers both the 7 curated
 * dashboards (static registry) and admin-created CUSTOM dashboards (numeric
 * columns discovered at runtime + persisted onto the pinned row so the admin can
 * pick them without MES access). Reuses the 45s dashboard cache, is globally
 * throttled, and prunes old rows so the table stays small.
 */
import { prisma } from "@/lib/db";
import { getDashboard, fetchDashboardData, type DashboardData } from "@/lib/fabinsight/dashboards";
import { ALERT_METRICS, ALERT_DASHBOARDS } from "@/lib/fabinsight/alert-metrics";
import { parseCustomDef, fetchCustomData, isNumericColumn } from "@/lib/fabinsight/custom";

const INTERVAL_MIN = Number(process.env.FABINSIGHT_BASELINE_INTERVAL_MIN ?? "15");
const RETAIN_DAYS = Number(process.env.FABINSIGHT_BASELINE_RETAIN_DAYS ?? "30");
const SOURCE = "lumentum";

/** Synthetic metric key for a custom-dashboard column. Mirrored in the admin app. */
export function customMetricKey(pinnedId: string, setKey: string, column: string): string {
  return `custom:${pinnedId}:${setKey}:${column}`;
}

type Sample = { key: string; value: number };

async function insertSamples(samples: Sample[]): Promise<void> {
  if (!samples.length) return;
  const values = samples.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, '${SOURCE}', now())`).join(", ");
  const params = samples.flatMap((s) => [s.key, s.value]);
  await prisma.$executeRawUnsafe(
    `INSERT INTO metric_samples (metric_key, value, source_key, sampled_at) VALUES ${values}`,
    ...params,
  );
}

/** Sample the 7 curated dashboards' metrics. */
async function sampleCurated(): Promise<Sample[]> {
  const dashData = new Map<string, DashboardData | null>();
  for (const d of ALERT_DASHBOARDS) {
    const def = getDashboard(d.id);
    let data: DashboardData | null = null;
    if (def) {
      try {
        data = await fetchDashboardData(def);
      } catch (e) {
        console.error(`[baselines] dashboard ${d.id} fetch failed`, e);
      }
    }
    dashData.set(d.id, data);
  }
  const out: Sample[] = [];
  for (const m of ALERT_METRICS) {
    const data = dashData.get(m.dashboardId);
    if (!data) continue;
    const v = m.select(data);
    if (v === null || !Number.isFinite(v)) continue;
    out.push({ key: m.key, value: Number(v.toFixed(4)) });
  }
  return out;
}

/**
 * Sample every admin-created custom dashboard: run its queries, detect numeric
 * columns, persist them onto the pin (so the admin can pick them), and sample the
 * first row's value for each.
 */
async function sampleCustom(): Promise<Sample[]> {
  const pins = (await prisma.pinnedDashboard.findMany({
    where: { kind: "custom" },
    select: { id: true, definition: true },
  })) as { id: string; definition: unknown }[];

  const out: Sample[] = [];
  for (const pin of pins) {
    try {
      const def = parseCustomDef(pin.definition);
      const data = await fetchCustomData(def);
      const columns: { setKey: string; setLabel: string; column: string }[] = [];
      for (const set of data.sets) {
        if (set.error || !set.rows.length) continue;
        for (const col of Object.keys(set.rows[0])) {
          if (!isNumericColumn(set.rows, col)) continue;
          columns.push({ setKey: set.key, setLabel: set.label, column: col });
          const v = Number(set.rows[0][col]);
          if (Number.isFinite(v)) out.push({ key: customMetricKey(pin.id, set.key, col), value: Number(v.toFixed(4)) });
        }
      }
      // Persist the discovered columns so the admin form can list them.
      await prisma.$executeRawUnsafe(
        `UPDATE pinned_dashboards SET metric_columns = $1::jsonb WHERE id = $2`,
        JSON.stringify(columns),
        pin.id,
      );
    } catch (e) {
      console.error(`[baselines] custom dashboard ${pin.id} sampling failed`, e);
    }
  }
  return out;
}

/** Sample all metrics once (throttled). Safe to call each scheduler tick. */
export async function sampleMetricBaselines(): Promise<void> {
  try {
    // Global throttle: skip if we sampled within the interval.
    const recent = (await prisma.$queryRawUnsafe(
      `SELECT 1 FROM metric_samples WHERE sampled_at > now() - ($1 || ' minutes')::interval LIMIT 1`,
      String(INTERVAL_MIN),
    )) as unknown[];
    if (recent.length) return;

    const samples = [...(await sampleCurated()), ...(await sampleCustom())];
    await insertSamples(samples);

    await prisma
      .$executeRawUnsafe(`DELETE FROM metric_samples WHERE sampled_at < now() - ($1 || ' days')::interval`, String(RETAIN_DAYS))
      .catch(() => {});

    if (samples.length) console.log(`[baselines] recorded ${samples.length} metric samples`);
  } catch (e) {
    console.error("[baselines] sampling failed", e);
  }
}
