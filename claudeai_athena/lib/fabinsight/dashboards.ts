/**
 * The SQL behind the seven curated FabInsight prompts.
 *
 * Source: **Opcenter SemiDemo** — `SemiDemoOLTP2504`, schema `cammes`, on
 * `OPCENTER-SEMI-D\SQLEXPRESS` (10.10.1.109). This is the system the Athena
 * FabOrchestrator deck was built against: lot `26FHEAEB1E00000` resolves here,
 * `HL13B5` is the top product, and `cammes.Container` holds exactly the 5,972
 * lots the slide-3 screenshot reports. None of that exists on Entegris KSP,
 * which this file previously targeted.
 *
 * Camstar is an OLTP schema, not a warehouse — there are no pre-computed OEE or
 * bottleneck views here, so every metric is derived from two tables:
 *
 *  - `cammes.Container` — one row per lot. Current state: `Qty`, `LevelId`,
 *    `CurrentHoldCount`, `DueDate`, `ExpirationDate`, `FactoryStartDate`.
 *  - `cammes.HistoryMainline` — the move history, one row per transaction.
 *    `CDOName` is the transaction type (`TrackInLot`, `TrackOutLot`, `MoveLot`,
 *    `StartLot`, …). Carries `ContainerName`, `ProductName`, `ResourceName`,
 *    `SpecName` (the step), `WorkflowName` (the route), `EmployeeName` /
 *    `Username` (the operator), `ShiftName`, `Qty`, and the pair
 *    `MoveInTimestamp` / `LastMoveOutTimestamp` that yields cycle time.
 *
 * Equipment lives in `cammes.ResourceDef` (905 rows — the deck's "Equipment
 * 904"). `cammes.Resource` does NOT exist; don't reach for it.
 *
 * Every query below was verified against the live database before being wired
 * in. Keep that discipline: this schema has traps (see the notes on grain).
 */

import { fabQuery, str, type FabRow } from '@/lib/fabinsight/mcp';
import {
  DASHBOARD_META,
  DASHBOARD_ORDER,
  LOT_WANTED,
  PRODUCT_WANTED,
  type DashboardMeta,
  type PromptOverrides,
} from '@/lib/fabinsight/catalog';

export { matchCurated, matchDashboard } from '@/lib/fabinsight/catalog';

const S = 'cammes';

/**
 * Per-move duration in seconds.
 *
 * Prefers `MoveHistory.CycleTime` — the value the MES itself recorded — and
 * falls back to the track-in/track-out timestamp difference. Two reasons:
 * the MES figure is measured rather than inferred, and most HistoryMainline
 * rows have no timestamp pair at all, which is why cycle time read as zero.
 *
 * `MoveHistory.CycleTime` is in fractional DAYS, hence * 86400. Negative values
 * exist in both sources (track-out stamped before track-in) and are discarded
 * rather than averaged in, since a negative duration is a recording fault.
 *
 * Requires `LEFT JOIN cammes.MoveHistory mh ON mh.HistoryMainlineId = h.HistoryMainlineId`.
 */
const CYCLE_SEC = `NULLIF(
  CASE
    WHEN mh.CycleTime IS NOT NULL AND mh.CycleTime > 0 THEN mh.CycleTime * 86400.0
    WHEN DATEDIFF(second, h.MoveInTimestamp, h.LastMoveOutTimestamp) > 0
      THEN CAST(DATEDIFF(second, h.MoveInTimestamp, h.LastMoveOutTimestamp) AS float)
    ELSE NULL
  END, 0)`;

/** The join `CYCLE_SEC` depends on. */
const MOVE_JOIN = `LEFT JOIN ${S}.MoveHistory mh ON mh.HistoryMainlineId = h.HistoryMainlineId`;

/** Values reaching SQL come from this file or a prior query, but escape anyway. */
function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A completed processing pass: a track-in with its move-out, which is where
 * cycle time comes from. Reused by most dashboards, so it lives in one place.
 */
const PROCESSED = `
  FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
  WHERE h.MoveInTimestamp IS NOT NULL
    AND h.LastMoveOutTimestamp IS NOT NULL
    AND h.LastMoveOutTimestamp >= h.MoveInTimestamp`;

export type QuerySpec = {
  key: string;
  /** Human-readable role, passed to the model so it knows what each set is. */
  label: string;
  sql: string;
  limit?: number;
};

export type DashboardDef = DashboardMeta & {
  /**
   * Optional first pass that pins an entity (lot / product) before the batch.
   * Receives whatever the user named in their own wording; falls back to the
   * deck's value when they left it alone.
   */
  resolve?: (
    overrides: PromptOverrides,
  ) => Promise<{ params: Record<string, string>; notes: string[] }>;
  queries: (params: Record<string, string>) => QuerySpec[];
};

/** Pick a real value if the requested one is absent (should not happen here). */
async function resolveOrFallback(
  wanted: string,
  existsSql: string,
  fallbackSql: string,
  column: string,
  paramName: string,
  label: string,
): Promise<{ params: Record<string, string>; notes: string[] }> {
  const notes: string[] = [];
  try {
    const hit = await fabQuery(existsSql, 1);
    if (hit.length > 0) return { params: { [paramName]: wanted }, notes };

    const alt = await fabQuery(fallbackSql, 1);
    const found = alt.length ? str(alt[0][column], '') : '';
    if (found && found !== '—') {
      notes.push(
        `${label} "${wanted}" does not exist in this environment. The data below is for "${found}", which has the most recorded activity. State this plainly in your answer.`,
      );
      return { params: { [paramName]: found }, notes };
    }
  } catch {
    // Fall through: the batch below surfaces the real failure per query.
  }
  notes.push(`${label} "${wanted}" could not be resolved in this environment.`);
  return { params: { [paramName]: wanted }, notes };
}

// ===========================================================================
// Slide 3 — Factory Operations
// ===========================================================================

const factoryOperations: DashboardDef = {
  ...DASHBOARD_META['factory-operations'],
  queries: () => [
    {
      key: 'factoryStatus',
      label: 'Factory status totals (WIP lot count, units in WIP, lots on hold)',
      sql: `SELECT COUNT(*) AS WipLots, SUM(Qty) AS WipUnits,
                   SUM(CASE WHEN CurrentHoldCount > 0 THEN 1 ELSE 0 END) AS OnHold,
                   (SELECT COUNT(DISTINCT ResourceName) FROM ${S}.HistoryMainline
                     WHERE ResourceName IS NOT NULL AND ResourceName <> '') AS LoadedResources
              FROM ${S}.Container`,
    },
    {
      key: 'equipmentTotals',
      label: 'Total equipment defined in the fab, and how many are currently loaded',
      sql: `SELECT (SELECT COUNT(*) FROM ${S}.ResourceDef) AS TotalResources,
                   (SELECT COUNT(DISTINCT ProductName) FROM ${S}.HistoryMainline
                     WHERE ProductName IS NOT NULL AND ProductName <> '') AS Areas`,
    },
    {
      key: 'latestOutput',
      label: 'Yield quantity — units and lots completed (tracked out) on the latest recorded day',
      sql: `SELECT TOP 1 CAST(h.LastMoveOutTimestamp AS date) AS Day,
                   COUNT(DISTINCT h.ContainerName) AS TotalLotsProduced,
                   SUM(h.Qty) AS UnitsOut,
                   NULL AS FirstPassYield_Pct
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.CDOName = 'TrackOutLot' AND h.LastMoveOutTimestamp IS NOT NULL
             GROUP BY CAST(h.LastMoveOutTimestamp AS date)
             ORDER BY Day DESC`,
    },
    {
      key: 'wipByArea',
      label: 'WIP distribution by product — lots and units held per product',
      sql: `SELECT TOP 10 p.ProductName AS AreaName, COUNT(*) AS WipLots, SUM(c.Qty) AS Units,
                   0 AS OnHold
              FROM ${S}.Container c
              JOIN (SELECT DISTINCT ContainerName, ProductName
                      FROM ${S}.HistoryMainline
                     WHERE ProductName IS NOT NULL) p
                ON p.ContainerName = c.ContainerName
             GROUP BY p.ProductName
             ORDER BY WipLots DESC`,
    },
    {
      key: 'wipByStep',
      label: 'WIP by process step — where material is sitting in the route',
      sql: `SELECT TOP 12 h.SpecName AS StepName, COUNT(DISTINCT h.ContainerName) AS WipLots
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.SpecName IS NOT NULL AND h.SpecName <> ''
               AND h.CDOName IN ('TrackInLot','MoveInLot')
             GROUP BY h.SpecName
             ORDER BY WipLots DESC`,
    },
    {
      key: 'runningEquipment',
      label: 'Current production — running equipment, the step it ran and lots processed',
      sql: `SELECT TOP 20 h.ResourceName, MAX(h.SpecName) AS AreaName,
                   'Productive' AS CurrentSEMI_E10State,
                   COUNT(DISTINCT h.ContainerName) AS WipLots,
                   DATEDIFF(hour, MAX(h.LastMoveOutTimestamp), GETDATE()) AS OldestQueuedHours
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             GROUP BY h.ResourceName
             ORDER BY WipLots DESC`,
    },
    {
      key: 'equipmentStates',
      label: 'Transaction mix — how many of each move type are recorded',
      sql: `SELECT TOP 8 CDOName AS State, COUNT(*) AS Resources
              FROM ${S}.HistoryMainline
             WHERE CDOName IS NOT NULL
             GROUP BY CDOName
             ORDER BY Resources DESC`,
    },
    {
      key: 'cycleTimeByStep',
      label: 'Cycle Time for each Step — average minutes from track-in to move-out',
      sql: `SELECT TOP 12 h.SpecName AS StepName, COUNT(*) AS Lots,
                   AVG(${CYCLE_SEC}) AS AvgProcessSec
            ${PROCESSED} AND h.SpecName IS NOT NULL AND h.SpecName <> ''
             GROUP BY h.SpecName
             ORDER BY AvgProcessSec DESC`,
    },
  ],
};

// ===========================================================================
// Slide 4 — Lot History
// ===========================================================================

const lotHistory: DashboardDef = {
  ...DASHBOARD_META['lot-history'],
  resolve: (o) =>
    resolveOrFallback(
      o.lot ?? LOT_WANTED,
      `SELECT TOP 1 ContainerName FROM ${S}.HistoryMainline WHERE ContainerName = ${q(o.lot ?? LOT_WANTED)}`,
      `SELECT TOP 1 ContainerName FROM ${S}.HistoryMainline
        WHERE ContainerName IS NOT NULL
        GROUP BY ContainerName ORDER BY COUNT(*) DESC`,
      'ContainerName',
      'lot',
      'Lot',
    ),
  queries: (p) => [
    {
      key: 'journey',
      label:
        'Step-to-step history for this lot: from step to step, track-in equipment, timestamps, quantity and operator name',
      sql: `SELECT TOP 100
                   h.ContainerName AS LotName, h.ProductName,
                   h.SpecName AS StepName, h.ResourceName, h.CDOName AS TxnType,
                   ROW_NUMBER() OVER (ORDER BY h.TxnDate) AS StepSeq,
                   h.WorkflowName AS ProductionOrderName,
                   h.TxnDate AS TrackInTime,
                   LEAD(h.TxnDate) OVER (ORDER BY h.TxnDate) AS TrackOutTime,
                   DATEDIFF(second, h.TxnDate,
                            LEAD(h.TxnDate) OVER (ORDER BY h.TxnDate)) AS ProcessSec,
                   h.Qty, h.ShiftName,
                   COALESCE(NULLIF(h.EmployeeName,''), NULLIF(h.MoveInUsername,''),
                            NULLIF(h.Username,'')) AS OperatorName
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.ContainerName = ${q(p.lot)}
               AND h.CDOName IN ('TrackInLot','TrackOutLot','MoveLot','MoveInLot','StartLot')
             ORDER BY h.TxnDate`,
      limit: 100,
    },
    {
      key: 'lotStatus',
      label: 'Current state of this lot — quantity, hold count, due and expiration dates',
      sql: `SELECT TOP 1 c.ContainerName AS MaterialName,
                   CASE WHEN c.CurrentHoldCount > 0 THEN 'On Hold' ELSE 'In Process' END AS CurrentStatus,
                   CASE WHEN c.CurrentHoldCount > 0 THEN 1 ELSE 0 END AS IsOnHold,
                   c.Qty AS TrackInPrimaryQuantity, c.OriginalQty, c.CurrentHoldCount,
                   'Lot' AS Type, '' AS Form,
                   c.FactoryStartDate AS TrackInDate, c.DueDate, c.ExpirationDate,
                   c.LastActivityDate,
                   (SELECT TOP 1 h.SpecName FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
                     WHERE h.ContainerName = c.ContainerName AND h.SpecName IS NOT NULL
                     ORDER BY h.TxnDate DESC) AS LastStepName,
                   (SELECT TOP 1 h.ResourceName FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
                     WHERE h.ContainerName = c.ContainerName AND h.ResourceName IS NOT NULL
                       AND h.ResourceName <> '' ORDER BY h.TxnDate DESC) AS LastResourceName,
                   (SELECT TOP 1 h.WorkflowName FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
                     WHERE h.ContainerName = c.ContainerName AND h.WorkflowName IS NOT NULL
                     ORDER BY h.TxnDate DESC) AS FlowPath
              FROM ${S}.Container c
             WHERE c.ContainerName = ${q(p.lot)}`,
    },
    {
      key: 'operators',
      label: 'Operators who worked this lot, with the equipment they used',
      sql: `SELECT TOP 15
                   COALESCE(NULLIF(h.EmployeeName,''), NULLIF(h.MoveInUsername,''),
                            NULLIF(h.Username,'')) AS UserName,
                   h.ResourceName, COUNT(*) AS UnitsProcessed,
                   AVG(${CYCLE_SEC}) AS AvgCycleTimeSec
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.ContainerName = ${q(p.lot)}
               AND COALESCE(NULLIF(h.EmployeeName,''), NULLIF(h.MoveInUsername,''),
                            NULLIF(h.Username,'')) IS NOT NULL
             GROUP BY COALESCE(NULLIF(h.EmployeeName,''), NULLIF(h.MoveInUsername,''),
                               NULLIF(h.Username,'')), h.ResourceName
             ORDER BY UnitsProcessed DESC`,
    },
  ],
};

// ===========================================================================
// Slide 5 — Process Analytics
// ===========================================================================

const processAnalytics: DashboardDef = {
  ...DASHBOARD_META['process-analytics'],
  queries: () => [
    {
      key: 'wipTrend',
      label: 'WIP trend — lots moved per day over the last recorded fortnight',
      sql: `SELECT TOP 14 CAST(h.TxnDate AS date) AS Day,
                   COUNT(DISTINCT h.ContainerName) AS TotalLotsProduced,
                   COUNT(DISTINCT h.ContainerName) AS WipEndOfDay,
                   COUNT(*) AS AvgQueueLength
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.TxnDate IS NOT NULL AND h.CDOName IN ('MoveLot','TrackOutLot','TrackInLot')
             GROUP BY CAST(h.TxnDate AS date)
             ORDER BY Day DESC`,
    },
    {
      key: 'wipNow',
      label: 'Live WIP on the floor right now — use THIS for any "current WIP" figure',
      sql: `SELECT COUNT(*) AS WipLots, SUM(Qty) AS WipUnits,
                   SUM(CASE WHEN Qty < OriginalQty THEN 1 ELSE 0 END) AS LotsWithLoss,
                   SUM(OriginalQty) - SUM(Qty) AS UnitsLost
              FROM ${S}.Container`,
    },
    {
      // The renderer's Yield Trend panel reads this key. SemiDemo records no
      // first-pass-yield metric, so it is derived the same way the deck does it
      // on slide 4 (52 -> 51 wafers = 98.1%): surviving quantity over original.
      key: 'yieldTrend',
      label: 'Yield trend — surviving quantity against original, by day',
      sql: `SELECT TOP 14 CAST(h.TxnDate AS date) AS Day,
                   (SELECT 100.0 * SUM(c2.Qty) / NULLIF(SUM(c2.OriginalQty),0)
                      FROM ${S}.Container c2) AS FirstPassYield_Pct,
                   NULL AS ScrapRate_Pct
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.TxnDate IS NOT NULL
             GROUP BY CAST(h.TxnDate AS date)
             ORDER BY Day DESC`,
    },
    {
      key: 'cycleTimeTrend',
      label: 'Cycle-time trend — average processing seconds per day',
      sql: `SELECT TOP 14 CAST(h.LastMoveOutTimestamp AS date) AS Day,
                   AVG(${CYCLE_SEC}) AS AvgCycleSec,
                   NULL AS IdealCycleSec,
                   COUNT(*) AS UnitsProduced
            ${PROCESSED}
             GROUP BY CAST(h.LastMoveOutTimestamp AS date)
             ORDER BY Day DESC`,
    },
    {
      key: 'equipmentUtilisation',
      label: 'Equipment utilisation — processing hours and lots handled per tool',
      sql: `SELECT TOP 15 h.ResourceName,
                   COUNT(DISTINCT h.ContainerName) AS UnitsProduced,
                   SUM(${CYCLE_SEC})/3600.0 AS UtilizationPct,
                   0 AS DowntimePct
            ${PROCESSED} AND h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             GROUP BY h.ResourceName
             ORDER BY UtilizationPct DESC`,
    },
    {
      key: 'utilisationByArea',
      label: 'Throughput by step — completions and units out',
      sql: `SELECT TOP 12 h.SpecName AS AreaName,
                   COUNT(*) AS Resources, SUM(h.Qty) AS UnitsProduced,
                   COUNT(DISTINCT h.ContainerName) AS UtilizationPct
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.CDOName = 'TrackOutLot' AND h.SpecName IS NOT NULL AND h.SpecName <> ''
             GROUP BY h.SpecName
             ORDER BY UnitsProduced DESC`,
    },
  ],
};

// ===========================================================================
// Slide 6 — Maintenance Prediction
// ===========================================================================

const maintenance: DashboardDef = {
  ...DASHBOARD_META['maintenance-prediction'],
  queries: () => [
    {
      key: 'riskRanking',
      label: 'Maintenance risk ranking — tools by accumulated processing hours (heaviest first)',
      sql: `SELECT TOP 15 h.ResourceName,
                   SUM(${CYCLE_SEC})/3600.0 AS RiskScore,
                   COUNT(*) AS UtilizationPct
            ${PROCESSED} AND h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             GROUP BY h.ResourceName
             ORDER BY RiskScore DESC`,
    },
    {
      key: 'pastDue',
      label:
        'Equipment passing the due date — tools unused longest (treated as overdue for service)',
      sql: `SELECT TOP 15 h.ResourceName,
                   MIN(h.MoveInTimestamp) AS StartTime,
                   MAX(h.LastMoveOutTimestamp) AS EndTime,
                   'Idle since last run' AS MaintType,
                   DATEDIFF(hour, MAX(h.LastMoveOutTimestamp), GETDATE()) AS HoursPastDue
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.ResourceName IS NOT NULL AND h.ResourceName <> ''
               AND h.LastMoveOutTimestamp IS NOT NULL
             GROUP BY h.ResourceName
             ORDER BY HoursPastDue DESC`,
    },
    {
      key: 'scheduled',
      label: 'Fleet size versus how much of it has actually been used',
      sql: `SELECT (SELECT COUNT(*) FROM ${S}.ResourceDef) AS TotalResources,
                   (SELECT COUNT(DISTINCT ResourceName) FROM ${S}.HistoryMainline
                     WHERE ResourceName IS NOT NULL AND ResourceName <> '') AS ResourcesUsed`,
    },
    {
      key: 'downtimeShare',
      label: 'Longest single runs — the individual passes that took the most time',
      sql: `SELECT TOP 12 h.ResourceName,
                   ${CYCLE_SEC}/3600.0 AS DowntimePct,
                   0 AS UtilizationPct
            ${PROCESSED} AND h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             ORDER BY DowntimePct DESC`,
    },
    {
      key: 'downtimeReasons',
      label: 'Lots currently on hold, by product',
      sql: `SELECT TOP 10 p.ProductName AS Reason, COUNT(*) AS TotalHours, SUM(c.CurrentHoldCount) AS Events
              FROM ${S}.Container c
              JOIN (SELECT DISTINCT ContainerName, ProductName
                      FROM ${S}.HistoryMainline WHERE ProductName IS NOT NULL) p
                ON p.ContainerName = c.ContainerName
             WHERE c.CurrentHoldCount > 0
             GROUP BY p.ProductName
             ORDER BY TotalHours DESC`,
    },
  ],
};

// ===========================================================================
// Slide 7 — Bottleneck Prediction (lots nearing expiry)
// ===========================================================================

const bottleneck: DashboardDef = {
  ...DASHBOARD_META['bottleneck-prediction'],
  queries: () => [
    {
      // DATEADD/DATEDIFF from day 0 (a Monday) is DATEFIRST-independent, unlike
      // DATEPART(weekday) — "coming Monday" is stable whatever the session's
      // first-day-of-week happens to be.
      key: 'ordersDueByMonday',
      label:
        'Bottleneck lots nearing their expiry date on or before the coming Monday',
      sql: `SELECT TOP 25 c.ContainerName AS ProductionOrderName,
                   c.ContainerName AS ProductName,
                   c.ExpirationDate AS DueDate,
                   CASE WHEN c.ExpirationDate < GETDATE() THEN 'Expired' ELSE 'Nearing expiry' END AS OrderStatus,
                   CASE WHEN c.ExpirationDate < GETDATE() THEN 1 ELSE 0 END AS IsLate,
                   c.Qty AS Quantity_Planned
              FROM ${S}.Container c
             WHERE c.ExpirationDate IS NOT NULL
               AND c.ExpirationDate <= DATEADD(week, DATEDIFF(week, 0, GETDATE()) + 1, 0)
             ORDER BY c.ExpirationDate`,
    },
    {
      key: 'expiryHorizon',
      label: 'How many lots expire in each upcoming window',
      sql: `SELECT
              SUM(CASE WHEN ExpirationDate < GETDATE() THEN 1 ELSE 0 END) AS AlreadyExpired,
              SUM(CASE WHEN ExpirationDate >= GETDATE()
                        AND ExpirationDate <= DATEADD(week, DATEDIFF(week, 0, GETDATE()) + 1, 0)
                       THEN 1 ELSE 0 END) AS DueByComingMonday,
              SUM(CASE WHEN ExpirationDate > DATEADD(week, DATEDIFF(week, 0, GETDATE()) + 1, 0)
                       THEN 1 ELSE 0 END) AS Later,
              SUM(CASE WHEN ExpirationDate IS NULL THEN 1 ELSE 0 END) AS NoExpiry,
              COUNT(*) AS TotalLots
              FROM ${S}.Container`,
    },
    {
      key: 'waitingLots',
      label: 'Bottleneck lots — idle longest, by hours since last recorded activity',
      sql: `SELECT TOP 25 c.ContainerName AS MaterialName, c.ContainerName AS ProductName,
                   '' AS ResourceName, '' AS AreaName,
                   DATEDIFF(hour, c.LastActivityDate, GETDATE()) AS HoursWaiting,
                   CASE WHEN DATEDIFF(day, c.LastActivityDate, GETDATE()) > 30 THEN '>30d'
                        WHEN DATEDIFF(day, c.LastActivityDate, GETDATE()) > 7  THEN '7-30d'
                        ELSE '<7d' END AS AgeBucket
              FROM ${S}.Container c
             WHERE c.LastActivityDate IS NOT NULL
             ORDER BY HoursWaiting DESC`,
    },
    {
      key: 'constrainedEquipment',
      label: 'Where the queue is building — lots per step, worst first',
      sql: `SELECT TOP 12 h.SpecName AS ResourceName, '' AS AreaName,
                   COUNT(DISTINCT h.ContainerName) AS BottleneckScore,
                   COUNT(DISTINCT h.ContainerName) AS QueueLength,
                   COUNT(*) AS WipCount, 0 AS UtilizationPct
            ${PROCESSED} AND h.SpecName IS NOT NULL AND h.SpecName <> ''
             GROUP BY h.SpecName
             ORDER BY BottleneckScore DESC`,
    },
  ],
};

// ===========================================================================
// Slide 8 — Analytics Dashboard (product-scoped)
// ===========================================================================

const analytics: DashboardDef = {
  ...DASHBOARD_META['analytics-dashboard'],
  resolve: (o) =>
    resolveOrFallback(
      o.product ?? PRODUCT_WANTED,
      `SELECT TOP 1 ProductName FROM ${S}.HistoryMainline WHERE ProductName = ${q(o.product ?? PRODUCT_WANTED)}`,
      `SELECT TOP 1 ProductName FROM ${S}.HistoryMainline
        WHERE ProductName IS NOT NULL AND ProductName <> ''
        GROUP BY ProductName ORDER BY COUNT(*) DESC`,
      'ProductName',
      'product',
      'Product',
    ),
  queries: (p) => [
    {
      key: 'yieldAndLossQty',
      label: 'Yield and loss quantity for this product — units in at start versus out at track-out',
      sql: `SELECT
              (SELECT SUM(h.Qty) FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
                WHERE h.ProductName = ${q(p.product)} AND h.CDOName = 'StartLot') AS QuantityIn,
              (SELECT SUM(h.Qty) FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
                WHERE h.ProductName = ${q(p.product)} AND h.CDOName = 'TrackOutLot') AS QuantityOut,
              (SELECT COUNT(DISTINCT h.ContainerName) FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
                WHERE h.ProductName = ${q(p.product)}) AS Lots,
              (SELECT SUM(r.RejectQty) FROM ${S}.A_WIPLotRejectsHistory r
                WHERE r.RejectQty > 0) AS LossQuantity,
              0 AS AvgYield`,
    },
    {
      key: 'yieldAndScrapTrend',
      label: 'Yield trend — units started versus completed per day for this product',
      sql: `SELECT TOP 10 CAST(h.TxnDate AS date) AS Day,
                   SUM(CASE WHEN h.CDOName = 'TrackOutLot' THEN h.Qty ELSE 0 END) AS UnitsOut,
                   COUNT(DISTINCT h.ContainerName) AS TotalLotsProduced,
                   (SELECT 100.0 * SUM(c2.Qty) / NULLIF(SUM(c2.OriginalQty),0) FROM ${S}.Container c2) AS FirstPassYield_Pct,
                   NULL AS ScrapRate_Pct, NULL AS ReworkRate_Pct
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.ProductName = ${q(p.product)} AND h.TxnDate IS NOT NULL
             GROUP BY CAST(h.TxnDate AS date)
             ORDER BY Day DESC`,
    },
    {
      key: 'cycleTimeByStep',
      label: 'Cycle time for each step for this product’s lots',
      sql: `SELECT TOP 12 h.SpecName AS StepName, COUNT(*) AS Lots,
                   AVG(${CYCLE_SEC}) AS MeanCycleSec,
                   MIN(${CYCLE_SEC}) AS MinCycleSec,
                   MAX(${CYCLE_SEC}) AS MaxCycleSec
            ${PROCESSED} AND h.ProductName = ${q(p.product)}
               AND h.SpecName IS NOT NULL AND h.SpecName <> ''
             GROUP BY h.SpecName
             ORDER BY MeanCycleSec DESC`,
    },
    {
      key: 'cycleTimeDistribution',
      label: 'Cycle time distribution — spread per step and tool (seconds)',
      sql: `SELECT TOP 10 h.SpecName AS StepName, h.ResourceName, COUNT(*) AS LotCount,
                   AVG(${CYCLE_SEC}) AS MedianCycleSec,
                   MIN(${CYCLE_SEC}) AS P25CycleSec,
                   MAX(${CYCLE_SEC}) AS P75CycleSec,
                   MAX(${CYCLE_SEC}) AS P95CycleSec
            ${PROCESSED} AND h.ProductName = ${q(p.product)}
               AND h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             GROUP BY h.SpecName, h.ResourceName
             ORDER BY LotCount DESC`,
    },
    {
      key: 'equipmentForProduct',
      label: 'Equipment utilisation for this product — lots processed per tool',
      sql: `SELECT TOP 12 h.ResourceName,
                   COUNT(DISTINCT h.ContainerName) AS Lots, COUNT(*) AS Runs,
                   AVG(${CYCLE_SEC}) AS MeanCycleSec
            ${PROCESSED} AND h.ProductName = ${q(p.product)}
               AND h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             GROUP BY h.ResourceName
             ORDER BY Lots DESC`,
    },
    {
      key: 'wipHeatMap',
      label: 'WIP heat map source — lots per step and equipment',
      sql: `SELECT h.SpecName AS StepName, h.ResourceName AS AreaName,
                   COUNT(DISTINCT h.ContainerName) AS WipLots
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.SpecName IS NOT NULL AND h.SpecName <> ''
               AND h.ResourceName IS NOT NULL AND h.ResourceName <> ''
             GROUP BY h.SpecName, h.ResourceName
             ORDER BY WipLots DESC`,
      limit: 300,
    },
    {
      key: 'bottleneckAnalysis',
      label: 'Bottleneck analysis — steps with the most lots and the longest processing',
      sql: `SELECT TOP 10 h.SpecName AS ResourceName, '' AS AreaName,
                   COUNT(DISTINCT h.ContainerName) AS BottleneckScore,
                   COUNT(DISTINCT h.ContainerName) AS QueueLength, 0 AS UtilizationPct
            ${PROCESSED} AND h.SpecName IS NOT NULL AND h.SpecName <> ''
             GROUP BY h.SpecName
             ORDER BY BottleneckScore DESC`,
    },
    {
      key: 'lossPareto',
      label: 'Scrap Pareto — units rejected by documented loss reason',
      sql: `SELECT TOP 10 r.LossReasonName AS LossCategory,
                   SUM(r.RejectQty) AS LostUnits, NULL AS CumulativePct
              FROM ${S}.A_WIPLotRejectsHistory r
             WHERE r.LossReasonName IS NOT NULL AND r.RejectQty > 0
             GROUP BY r.LossReasonName
             ORDER BY LostUnits DESC`,
    },
    {
      key: 'downtimePareto',
      label: 'Idle-time Pareto — tools ranked by days since last use',
      sql: `SELECT TOP 10 h.ResourceName AS Reason,
                   DATEDIFF(day, MAX(h.LastMoveOutTimestamp), GETDATE()) AS TotalHours
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.ResourceName IS NOT NULL AND h.ResourceName <> ''
               AND h.LastMoveOutTimestamp IS NOT NULL
             GROUP BY h.ResourceName
             ORDER BY TotalHours DESC`,
    },
  ],
};

// ===========================================================================
// Slide 9 — Executive Overview
// ===========================================================================

const executive: DashboardDef = {
  ...DASHBOARD_META['executive-overview'],
  queries: () => [
    {
      key: 'dailyPerformance',
      label:
        'Daily factory performance — lots and units completed, and lots started, per day',
      sql: `SELECT TOP 14 CAST(h.TxnDate AS date) AS Day,
                   SUM(CASE WHEN h.CDOName = 'TrackOutLot' THEN h.Qty ELSE 0 END) AS UnitsOut,
                   COUNT(DISTINCT CASE WHEN h.CDOName = 'TrackOutLot' THEN h.ContainerName END) AS TotalLotsProduced,
                   COUNT(DISTINCT h.ContainerName) AS WIP_Snapshot_EOD,
                   COUNT(*) AS AvgQueueLength,
                   (SELECT 100.0 * SUM(c2.Qty) / NULLIF(SUM(c2.OriginalQty),0) FROM ${S}.Container c2) AS FirstPassYield_Pct,
                   NULL AS ScrapRate_Pct, NULL AS ReworkRate_Pct,
                   '' AS BottleneckResourceName
              FROM ${S}.HistoryMainline h
              ${MOVE_JOIN}
             WHERE h.TxnDate IS NOT NULL
             GROUP BY CAST(h.TxnDate AS date)
            HAVING SUM(CASE WHEN h.CDOName = 'TrackOutLot' THEN h.Qty ELSE 0 END) > 0
             ORDER BY Day DESC`,
    },
    {
      key: 'activeWipNow',
      label:
        'Active WIP live on the floor — use THIS for the Active WIP headline, not the daily trend',
      sql: `SELECT COUNT(*) AS WipLots, SUM(Qty) AS WipUnits,
                   SUM(CASE WHEN CurrentHoldCount > 0 THEN 1 ELSE 0 END) AS OnHold,
                   0 AS InRework,
                   (SELECT COUNT(DISTINCT ResourceName) FROM ${S}.HistoryMainline
                     WHERE ResourceName IS NOT NULL AND ResourceName <> '') AS LoadedResources
              FROM ${S}.Container`,
    },
    {
      key: 'onTimeDelivery',
      label: 'On-time delivery — lots against their due date',
      sql: `SELECT COUNT(*) AS TotalOrders,
                   SUM(CASE WHEN ExpirationDate IS NOT NULL AND ExpirationDate >= GETDATE() THEN 1 ELSE 0 END) AS Completed,
                   SUM(CASE WHEN ExpirationDate IS NOT NULL AND ExpirationDate < GETDATE() THEN 1 ELSE 0 END) AS Late,
                   SUM(CASE WHEN ExpirationDate IS NULL THEN 1 ELSE 0 END) AS InProgress
              FROM ${S}.Container`,
    },
    {
      key: 'openOrders',
      label: 'Lots closest to their expiry date',
      sql: `SELECT TOP 15 c.ContainerName AS ProductionOrderName,
                   c.ContainerName AS ProductName,
                   c.ExpirationDate AS DueDate,
                   CASE WHEN c.ExpirationDate < GETDATE() THEN 'Expired' ELSE 'Active' END AS OrderStatus,
                   CASE WHEN c.ExpirationDate < GETDATE() THEN 1 ELSE 0 END AS IsLate
              FROM ${S}.Container c
             WHERE c.ExpirationDate IS NOT NULL
             ORDER BY c.ExpirationDate`,
    },
    {
      key: 'avgCycleTimePerStep',
      label: 'Average cycle time per step across all products',
      sql: `SELECT TOP 12 h.SpecName AS StepName, COUNT(*) AS Lots,
                   AVG(${CYCLE_SEC}) AS MeanCycleSec
            ${PROCESSED} AND h.SpecName IS NOT NULL AND h.SpecName <> ''
             GROUP BY h.SpecName
             ORDER BY MeanCycleSec DESC`,
    },
    {
      key: 'bottleneckArea',
      label: 'Bottleneck by product — where WIP is concentrated',
      sql: `SELECT TOP 8 p.ProductName AS AreaName, COUNT(*) AS WipLots, SUM(c.Qty) AS Units
              FROM ${S}.Container c
              JOIN (SELECT DISTINCT ContainerName, ProductName
                      FROM ${S}.HistoryMainline WHERE ProductName IS NOT NULL) p
                ON p.ContainerName = c.ContainerName
             GROUP BY p.ProductName
             ORDER BY WipLots DESC`,
    },
  ],
};

// ===========================================================================

const BY_ID: Record<string, DashboardDef> = {
  'factory-operations': factoryOperations,
  'lot-history': lotHistory,
  'process-analytics': processAnalytics,
  'maintenance-prediction': maintenance,
  'bottleneck-prediction': bottleneck,
  'analytics-dashboard': analytics,
  'executive-overview': executive,
};

/** Deck order comes from the shared catalog, so bubbles and server agree. */
export const DASHBOARDS: DashboardDef[] = DASHBOARD_ORDER.map((id) => BY_ID[id]);

export function getDashboard(id: string): DashboardDef | undefined {
  return BY_ID[id];
}

export type DashboardData = {
  id: string;
  title: string;
  params: Record<string, string>;
  notes: string[];
  /** One entry per query, in declaration order. */
  sets: { key: string; label: string; rows: FabRow[]; error?: string }[];
  tookMs: number;
};

/**
 * Short in-process cache. A demo clicks the same bubble repeatedly; 45 s keeps
 * "live" honest while making a repeat click effectively free.
 */
const TTL_MS = Number(process.env.FABINSIGHT_CACHE_TTL_MS ?? '45000');
const cache = new Map<string, { at: number; data: DashboardData }>();

/**
 * Run one dashboard's whole query set and return the raw rows.
 *
 * Sets fail independently: an empty or erroring query becomes a note rather
 * than taking the answer down.
 */
export async function fetchDashboardData(
  def: DashboardDef,
  overrides: PromptOverrides = {},
): Promise<DashboardData> {
  // The entity is part of the identity of the result — without it in the key,
  // asking for a second lot inside the TTL would serve the first one's rows.
  const cacheKey = `${def.id}|${overrides.lot ?? ''}|${overrides.product ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const started = Date.now();
  const notes: string[] = [];
  let params: Record<string, string> = {};

  if (def.resolve) {
    const resolved = await def.resolve(overrides);
    params = resolved.params;
    notes.push(...resolved.notes);
  }

  const specs = def.queries(params);
  const settled = await Promise.allSettled(
    specs.map((s) => fabQuery(s.sql, s.limit ?? 500)),
  );

  const sets = specs.map((spec, i) => {
    const res = settled[i];
    if (res.status === 'fulfilled') {
      return { key: spec.key, label: spec.label, rows: res.value };
    }
    const reason = res.reason as { detail?: string; message?: string };
    return {
      key: spec.key,
      label: spec.label,
      rows: [] as FabRow[],
      error: reason?.detail ?? reason?.message ?? 'query failed',
    };
  });

  const failed = sets.filter((s) => s.error);
  if (failed.length) {
    notes.push(
      `${failed.length} of ${sets.length} data sets did not return; omit the panels they would have fed rather than inventing them.`,
    );
  }

  const data: DashboardData = {
    id: def.id,
    title: def.title,
    params,
    notes,
    sets,
    tookMs: Date.now() - started,
  };
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
