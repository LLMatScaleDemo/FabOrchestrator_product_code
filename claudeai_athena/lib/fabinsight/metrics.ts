/**
 * Broad-question answers — "give me the yield", "give me the OEE".
 *
 * The Lumentum requirement is that the agent answers these without the user
 * explaining how the value is calculated. These are NOT dashboards: only the
 * seven curated prompts produce one. This attaches real, queried figures to the
 * model's context so it can answer in prose, the same way the alias glossary
 * attaches meanings.
 *
 * Everything here is measured at request time. Nothing is hardcoded — including
 * the evidence for what is NOT measurable, so if Lumentum's environment starts
 * populating E10 states the brief changes on its own.
 */

import { fabQuery, num, str } from '@/lib/fabinsight/mcp';

const S = 'cammes';

export type MetricKind = 'yield' | 'oee' | 'scrap';

/**
 * Does this message ask for one of the broad metrics?
 *
 * Deliberately narrow. It must not fire on a curated dashboard prompt (the
 * caller only asks when the turn is not curated), nor on passing mentions like
 * "the yield column is blank".
 */
export function detectMetricAsk(text: string): MetricKind | null {
  // The metric has to be the OBJECT of a request, not merely mentioned. A bare
  // keyword test fired on "the yield column is blank on the report", which is a
  // complaint about a dashboard, not a request for a figure. So the ask verb
  // must sit within a short window before the metric, or the message must lead
  // with it ("yield by product").
  const ASK = String.raw`(?:give|show|get|what(?:'s|s| is| are)?|tell|pull|display|breakdown of|break down)`;
  const metric = (word: string) =>
    new RegExp(String.raw`(?:\b${ASK}\b[^.?!]{0,40}?\b${word}\b)|(?:^\s*${word}\b)`, 'i').test(text);

  // OEE first — "OEE and yield" is an OEE question, and that brief covers
  // quality yield anyway.
  if (metric(String.raw`oee|overall equipment effectiveness`)) return 'oee';
  // Scrap before yield — "scrap rate" and "yield" are distinct keywords, but a
  // scrap ask should never fall through to the yield brief.
  if (metric(String.raw`scrap|reject rate`)) return 'scrap';
  if (metric('yield')) return 'yield';
  return null;
}

const pct = (n: number, d: number) => (d > 0 ? ((100 * n) / d).toFixed(2) : '—');

/** Date only — a full JS timestamp with a timezone name reads as noise here. */
const day = (v: unknown) => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? str(v) : d.toISOString().slice(0, 10);
};

/** Material yield per product, biggest volume first. */
async function yieldBrief(): Promise<string> {
  const rows = await fabQuery(
    `SELECT TOP 12 h.ProductName,
            COUNT(DISTINCT c.ContainerName) AS Lots,
            SUM(c.OriginalQty)              AS OrigQty,
            SUM(c.Qty)                      AS CurQty,
            SUM(c.OriginalQty) - SUM(c.Qty) AS LossQty,
            CAST(100.0 * SUM(c.Qty) / NULLIF(SUM(c.OriginalQty), 0) AS decimal(6,2)) AS YieldPct
       FROM ${S}.Container c
       JOIN (SELECT DISTINCT ContainerName, ProductName
               FROM ${S}.HistoryMainline
              WHERE ProductName IS NOT NULL AND ProductName <> '') h
         ON h.ContainerName = c.ContainerName
      GROUP BY h.ProductName
     HAVING COUNT(DISTINCT c.ContainerName) >= 5
      ORDER BY SUM(c.OriginalQty) DESC`,
    12,
  );

  const totOrig = rows.reduce((a, r) => a + num(r.OrigQty), 0);
  const totCur = rows.reduce((a, r) => a + num(r.CurQty), 0);

  const table = rows
    .map(
      (r) =>
        `  ${str(r.ProductName)} | lots ${num(r.Lots)} | started ${num(r.OrigQty)} | now ${num(
          r.CurQty,
        )} | loss ${num(r.LossQty)} | yield ${num(r.YieldPct).toFixed(2)}%`,
    )
    .join('\n');

  return [
    '<yield-by-product>',
    'The user asked about yield. These are live figures, queried just now.',
    '',
    'MATERIAL YIELD BY PRODUCT (quantity remaining vs quantity started):',
    table,
    '',
    `Across these products: ${totOrig} started, ${totCur} remaining, ` +
      `${totOrig - totCur} lost — ${pct(totCur, totOrig)}% overall.`,
    '',
    'HOW TO ANSWER:',
    '- Lead with yield BY PRODUCT, as a small table, worst performers called out.',
    '- Name it "Material Yield" and say once, briefly, what it measures: quantity',
    '  remaining against quantity started. It includes lot splits and consumption,',
    '  so it is not a first-pass or quality yield.',
    '- This MES records no first-pass yield, so if the user wants FPY, say that',
    '  plainly rather than presenting this figure as if it were FPY.',
    '- Products with very few lots carry noisy percentages — flag rather than rank them.',
    '- A yield ABOVE 100% (negative loss) is real here: the lot gained units through',
    '  merges or re-issues. Call it out as a data characteristic, never as a yield result.',
    '- Do NOT build a dashboard or an artifact. Answer in prose and a table.',
    '</yield-by-product>',
  ].join('\n');
}

/**
 * OEE = Availability x Performance x Quality.
 *
 * Only Quality is measurable here, so the brief carries the real Quality figure
 * plus the evidence for why the other two are not — measured, not asserted, so
 * the numbers stay honest if the environment changes.
 */
async function oeeBrief(): Promise<string> {
  const [quality, avail, perf, tools] = await Promise.all([
    fabQuery(
      `SELECT (SELECT SUM(RejectQty) FROM ${S}.A_WIPLotRejectsHistory) AS RejectedUnits,
              (SELECT COUNT(*) FROM ${S}.A_WIPLotRejectsHistory)       AS RejectRecords,
              (SELECT SUM(OriginalQty) FROM ${S}.Container)            AS UnitsStarted`,
      1,
    ),
    fabQuery(
      `SELECT COUNT(*) AS StatusEvents,
              COUNT(DISTINCT ResourceStatusHistoryId) AS DistinctRows,
              MIN(LastStatusChangeDate) AS FirstEvent,
              MAX(LastStatusChangeDate) AS LastEvent,
              SUM(CASE WHEN NewStatusName IN ('UnschDown','UDT','C_UDT') THEN 1 ELSE 0 END) AS UnschedDownEvents
         FROM ${S}.ResourceStatusHistory`,
      1,
    ),
    fabQuery(
      `SELECT COUNT(*) AS Products,
              COUNT(NULLIF(TargetCycleTime, 0))    AS WithTargetCycleTime,
              COUNT(NULLIF(TargetUnitsPerHour, 0)) AS WithTargetRate
         FROM ${S}.Product`,
      1,
    ),
    fabQuery(
      `SELECT (SELECT COUNT(*) FROM ${S}.ResourceDef) AS TotalTools,
              (SELECT COUNT(ResourceStatusModelId) FROM ${S}.ResourceDef) AS WithStatusModel,
              (SELECT COUNT(DISTINCT ResourceName) FROM ${S}.HistoryMainline
                WHERE ResourceName IS NOT NULL AND ResourceName <> '') AS ToolsWithWork`,
      1,
    ),
  ]);

  const q = quality[0] ?? {};
  const a = avail[0] ?? {};
  const p = perf[0] ?? {};
  const t = tools[0] ?? {};

  const rejected = num(q.RejectedUnits);
  const started = num(q.UnitsStarted);
  const qualityPct = pct(started - rejected, started);
  const totalTools = num(t.TotalTools);

  return [
    '<oee-request>',
    'The user asked for OEE. OEE = Availability x Performance x Quality, where',
    '  Availability = Run Time / Planned Production Time',
    '  Performance  = (Ideal Cycle Time x Total Units) / Run Time',
    '  Quality      = Good Units / Total Units',
    'Only ONE of the three terms (Quality) is measurable in this environment. The',
    'figures below were queried just now. Per the requirement, when one or more',
    'inputs are missing you must NOT fabricate them or produce an OEE number —',
    'state the formula, give the term(s) you CAN compute, and say plainly which',
    'inputs are unavailable and why.',
    '',
    'QUALITY — measurable:',
    `  ${rejected} units rejected across ${num(q.RejectRecords)} reject records,`,
    `  against ${started} units started. Quality yield ${qualityPct}%.`,
    '  Reject reason codes are recorded, so a Pareto of causes is available.',
    '',
    'AVAILABILITY — not measurable:',
    `  Equipment status history holds ${num(a.StatusEvents)} state-change events in total,`,
    `  spanning ${day(a.FirstEvent)} to ${day(a.LastEvent)}, across a fleet of ${totalTools} tools.`,
    `  Only ${num(t.WithStatusModel)} of ${totalTools} tools have a status model assigned.`,
    `  Unscheduled-downtime events recorded: ${num(a.UnschedDownEvents)}.`,
    '  Time-in-state cannot be reconstructed from this, so uptime/downtime is unknown.',
    '',
    'PERFORMANCE — not measurable:',
    `  ${num(p.WithTargetCycleTime)} of ${num(p.Products)} products have a target cycle time set,`,
    `  and ${num(p.WithTargetRate)} have a target units-per-hour.`,
    '  Without an ideal rate there is no denominator for the performance term.',
    '',
    'CONTEXT WORTH GIVING:',
    `  ${num(t.ToolsWithWork)} of ${totalTools} tools have recorded processing work, which is a`,
    '  coverage figure, NOT utilisation — it says nothing about time spent running.',
    '  The schema DOES support OEE (SEMI E10 states, product targets); those fields',
    '  are simply not populated in this environment. If the site enables E10 state',
    '  logging and sets product targets, OEE becomes computable with no rework.',
    '',
    'HOW TO ANSWER:',
    '- Say up front that a true OEE figure cannot be produced from this data, and why.',
    '- Give the Quality term, since it is real, and offer the scrap Pareto.',
    '- Use the counts above as evidence — they are measured, not estimates.',
    '- Do NOT invent, estimate or approximate Availability, Performance or an OEE %.',
    '- Do NOT build a dashboard or an artifact. Answer in prose.',
    '- Close by naming exactly what would need to be switched on to get real OEE.',
    '</oee-request>',
  ].join('\n');
}

/**
 * Scrap rate, per the client spec:
 *   Scrap Rate (%)   = 100 x SUM(A_WIPLotRejectsHistory.RejectQty) / SUM(Container.OriginalQty),
 *                      broken down BY PRODUCT.
 *   Reason share (%) = 100 x SUM(RejectQty) per LossReasonName / SUM(RejectQty) total.
 *
 * The reject table's product handle varies by site, so we detect at request
 * time whether it carries ProductName or ContainerName and build the product
 * split accordingly; if neither exists we still give the overall rate + reasons.
 */
async function scrapBrief(): Promise<string> {
  let rejCols = new Set<string>();
  try {
    const cols = await fabQuery(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${S}' AND TABLE_NAME = 'A_WIPLotRejectsHistory'`,
      200,
    );
    rejCols = new Set(cols.map((r) => str(r.COLUMN_NAME).toLowerCase()));
  } catch {
    /* fall back to overall-only */
  }

  // Reject units grouped by product — chosen by the columns that exist.
  const rejByProduct = rejCols.has('productname')
    ? `SELECT ProductName, SUM(RejectQty) AS RejectQty
         FROM ${S}.A_WIPLotRejectsHistory WHERE RejectQty > 0 GROUP BY ProductName`
    : rejCols.has('containername')
      ? `SELECT h.ProductName, SUM(r.RejectQty) AS RejectQty
           FROM ${S}.A_WIPLotRejectsHistory r
           JOIN (SELECT DISTINCT ContainerName, ProductName FROM ${S}.HistoryMainline
                  WHERE ProductName IS NOT NULL AND ProductName <> '') h
             ON h.ContainerName = r.ContainerName
          WHERE r.RejectQty > 0 GROUP BY h.ProductName`
      : null;

  const [overall, reasons, products] = await Promise.all([
    fabQuery(
      `SELECT (SELECT SUM(RejectQty) FROM ${S}.A_WIPLotRejectsHistory WHERE RejectQty > 0) AS RejectQty,
              (SELECT COUNT(*)       FROM ${S}.A_WIPLotRejectsHistory WHERE RejectQty > 0) AS RejectRecords,
              (SELECT SUM(OriginalQty) FROM ${S}.Container)                                AS StartedQty`,
      1,
    ),
    fabQuery(
      `SELECT TOP 15 LossReasonName, SUM(RejectQty) AS RejectQty
         FROM ${S}.A_WIPLotRejectsHistory
        WHERE LossReasonName IS NOT NULL AND RejectQty > 0
        GROUP BY LossReasonName
        ORDER BY RejectQty DESC`,
      15,
    ),
    rejByProduct
      ? fabQuery(
          `SELECT TOP 12 rp.ProductName,
                  rp.RejectQty AS RejectQty,
                  op.OrigQty   AS OrigQty,
                  CAST(100.0 * rp.RejectQty / NULLIF(op.OrigQty, 0) AS decimal(6,2)) AS ScrapPct
             FROM (${rejByProduct}) rp
             JOIN (SELECT h.ProductName, SUM(c.OriginalQty) AS OrigQty
                     FROM ${S}.Container c
                     JOIN (SELECT DISTINCT ContainerName, ProductName FROM ${S}.HistoryMainline
                            WHERE ProductName IS NOT NULL AND ProductName <> '') h
                       ON h.ContainerName = c.ContainerName
                    GROUP BY h.ProductName) op
               ON op.ProductName = rp.ProductName
            ORDER BY rp.RejectQty DESC`,
          12,
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof fabQuery>>),
  ]);

  const o = overall[0] ?? {};
  const totalRej = num(o.RejectQty);
  const started = num(o.StartedQty);

  const reasonTable = reasons
    .map((r) => `  ${str(r.LossReasonName)} | ${num(r.RejectQty)} units | ${pct(num(r.RejectQty), totalRej)}% of scrap`)
    .join('\n');

  const productTable = products.length
    ? products
        .map(
          (r) =>
            `  ${str(r.ProductName)} | rejected ${num(r.RejectQty)} | started ${num(r.OrigQty)} | scrap ${num(
              r.ScrapPct,
            ).toFixed(2)}%`,
        )
        .join('\n')
    : '  (the reject records carry no product key in this environment — product split unavailable)';

  return [
    '<scrap-rate>',
    'The user asked for the scrap rate. These are live figures, queried just now.',
    '',
    `OVERALL: ${totalRej} units rejected across ${num(o.RejectRecords)} reject records, against ` +
      `${started} units started — scrap rate ${pct(totalRej, started)}%.`,
    '  (Scrap Rate % = 100 x rejected units / units started.)',
    '',
    'SCRAP RATE BY PRODUCT (100 x rejected / started, per product):',
    productTable,
    '',
    'REASON SHARE (share of total rejected units by documented loss reason):',
    reasonTable,
    '',
    'HOW TO ANSWER:',
    '- Break scrap down BOTH ways: by PRODUCT (scrap rate %) and by DEFECT/REASON code',
    '  (reason share %). Lead with the product split, then the reason Pareto.',
    '- Use small tables. Call out the worst product and the top reason(s).',
    '- Reject quantity is A_WIPLotRejectsHistory.RejectQty; the denominator is units',
    '  started (Container.OriginalQty). Say once, briefly, what the rate measures.',
    '- Use ONLY the numbers above — never invent, extrapolate or round away a figure.',
    '- Do NOT build a dashboard or an artifact. Answer in prose and tables.',
    '</scrap-rate>',
  ].join('\n');
}

/** Build the brief, or null if the data service is unavailable. */
export async function buildMetricBrief(kind: MetricKind): Promise<string | null> {
  try {
    if (kind === 'yield') return await yieldBrief();
    if (kind === 'scrap') return await scrapBrief();
    return await oeeBrief();
  } catch {
    return null;
  }
}
