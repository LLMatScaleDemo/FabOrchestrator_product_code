/**
 * The seven dashboard layouts, each modelled on its slide in the Athena
 * FabOrchestrator deck.
 *
 * Built server-side from rows we already fetched — no model authors this, so
 * the layout is identical every run and rendering costs single-digit
 * milliseconds. The output goes out inside an `<antArtifact type="text/html">`
 * tag and lands in the existing artifact panel.
 *
 * Each layout picks its slide's own theme (see THEMES): the deck deliberately
 * gives every dashboard a different palette rather than one house style.
 */

import type { DashboardData } from '@/lib/fabinsight/dashboards';
import type { FabRow } from '@/lib/fabinsight/mcp';
import {
  BAD,
  OK,
  THEMES,
  WARN,
  areaChart,
  badge,
  barList,
  barTable,
  callout,
  chip,
  clock,
  columnChart,
  compact,
  day,
  donutWithLegend,
  dur,
  empty,
  esc,
  fmt,
  hero,
  heatMap,
  kpiCards,
  n,
  panel,
  pareto,
  pct,
  s,
  sectionLabel,
  shell,
  statTiles,
  table,
  type Row,
  type Theme,
} from '@/lib/fabinsight/render-kit';

type Sets = Record<string, FabRow[]>;
type Layout = {
  eyebrow: string;
  pills: (x: Sets, p: Record<string, string>) => string[];
  summary: (x: Sets, p: Record<string, string>) => string;
  body: (x: Sets, p: Record<string, string>, t: Theme) => string;
};

// ===========================================================================
// Slide 3 — Factory Operations Dashboard
// ===========================================================================

const factoryOperations: Layout = {
  eyebrow: 'Semiconductor Fab · Live Operations',
  pills: (x) => [`${n(x.equipmentTotals?.[0]?.Areas)} products`],
  summary: (x) => {
    const st = x.factoryStatus?.[0] ?? {};
    const eq = x.equipmentTotals?.[0] ?? {};
    const out = x.latestOutput?.[0] ?? {};
    // ResourcesUsed/LoadedResources is the count of tools with recorded work.
    // The previous 'productive' filter counted a hardcoded badge, so it only
    // ever returned the number of rows displayed.
    const prod = n(x.factoryStatus?.[0]?.LoadedResources);
    return `${fmt(n(st.WipLots))} lots in WIP across ${n(eq.Areas)} products, ${prod} of ${fmt(
      n(eq.TotalResources),
    )} tools with recorded work, ${fmt(n(out.UnitsOut))} units completed on ${s(out.Day).slice(0, 10)}.`;
  },
  body: (x, _p, t) => {
    const st = x.factoryStatus?.[0] ?? {};
    const eq = x.equipmentTotals?.[0] ?? {};
    const out = x.latestOutput?.[0] ?? {};
    // ResourcesUsed/LoadedResources is the count of tools with recorded work.
    // The previous 'productive' filter counted a hardcoded badge, so it only
    // ever returned the number of rows displayed.
    const prod = n(x.factoryStatus?.[0]?.LoadedResources);

    return [
      sectionLabel('Factory Status', t),
      kpiCards(
        [
          {
            label: 'WIP Lot Count',
            value: fmt(n(st.WipLots)),
            desc: `Active work-in-process lots · ${fmt(n(st.LoadedResources))} tools holding material`,
          },
          {
            label: 'Equipment',
            value: fmt(n(eq.TotalResources)),
            desc: `Total resources in the fab · ${prod} with recorded work`,
          },
          {
            label: 'Yield Qty (Output)',
            value: fmt(n(out.UnitsOut)),
            desc: `Units completed on ${s(out.Day).slice(0, 10)} · ${fmt(
              n(out.TotalLotsProduced),
            )} lots produced`,
          },
          {
            label: 'On Hold',
            value: fmt(n(st.OnHold)),
            desc: 'Lots currently held from processing',
            color: n(st.OnHold) > 0 ? WARN : OK,
          },
        ],
        t,
      ),
      `<div class="grid-2" style="margin-top:13px">`,
      panel(
        'WIP Distribution by Product',
        'Lots and units held per product',
        barList(
          (x.wipByArea ?? []).map((r) => ({
            label: s(r.AreaName),
            value: n(r.WipLots),
            right: n(r.OnHold) > 0 ? `${n(r.OnHold)} on hold` : undefined,
          })),
          'lots',
          t,
          true,
        ),
        t.ramp[0],
      ),
      panel(
        'WIP by Step',
        'Top steps by lot count',
        barList(
          (x.wipByStep ?? []).map((r) => ({ label: s(r.StepName), value: n(r.WipLots) })),
          'lots',
          t,
        ),
        t.ramp[1],
      ),
      `</div>`,
      sectionLabel('Current Production', t),
      `<div class="grid-2">`,
      panel(
        'Activity Breakdown',
        'Recorded transactions by type',
        donutWithLegend(
          (x.equipmentStates ?? []).map((r) => ({ label: s(r.State), value: n(r.Resources) })),
          'Total loaded',
          t.ramp,
        ),
        t.ramp[0],
      ),
      panel(
        'Cycle Time for each Step',
        'Average processing duration',
        barTable(
          (x.cycleTimeByStep ?? []).map((r) => ({
            label: s(r.StepName),
            value: Number((n(r.AvgProcessSec) / 60).toFixed(2)),
          })),
          'min',
          t,
        ),
        t.ramp[2],
      ),
      `</div>`,
      panel(
        'Equipment Activity',
        'Lots processed and time since last run',
        table(
          [
            { key: 'r', label: 'Equipment' },
            { key: 'a', label: 'Step' },
            { key: 'w', label: 'Lots processed', right: true },
            { key: 'o', label: 'Since last run', right: true },
          ],
          (x.runningEquipment ?? []).map(
            (r) =>
              ({
                r: esc(s(r.ResourceName)),
                a: esc(s(r.AreaName)),
                w: fmt(n(r.WipLots)),
                o: `${fmt(n(r.OldestQueuedHours))} h`,
              }) as Row,
          ),
        ),
        t.ramp[1],
        true,
      ),
    ].join('');
  },
};

// ===========================================================================
// Slide 4 — Lot History Report (gradient hero + event timeline)
// ===========================================================================

/** Colour per timeline event type, mirroring the slide's legend. */
function eventBadge(row: FabRow): string {
  const out = s(row.TrackOutTime, '');
  if (n(row.StepSeq) === 1) return badge('Lot Started', '#7c3aed');
  return out === '—' ? badge('Track In', '#1c86d4') : badge('Track Out', '#12a897');
}

const lotHistory: Layout = {
  eyebrow: 'Material Genealogy · Lot Trace',
  pills: (x) => {
    const st = x.lotStatus?.[0];
    return st ? [s(st.CurrentStatus, 'In process')] : [];
  },
  summary: (x) => {
    const j = x.journey ?? [];
    if (!j.length) return 'No recorded step history for this lot.';
    const st = x.lotStatus?.[0] ?? {};
    const proc = j.reduce((a, r) => a + Math.max(n(r.ProcessSec), 0), 0);
    return `Lot ${s(j[0].LotName)} travelled ${j.length} steps from ${s(j[0].StepName)} to ${s(
      j[j.length - 1].StepName,
    )} — ${dur(proc)} processing, now ${s(st.CurrentStatus, 'in process')}.`;
  },
  body: (x, _p, t) => {
    const j = x.journey ?? [];
    if (!j.length) {
      return panel('Lot History', '', empty('No track-in / track-out records exist for this lot.'), t.ramp[0], true);
    }
    const st = x.lotStatus?.[0] ?? {};
    const proc = j.reduce((a, r) => a + Math.max(n(r.ProcessSec), 0), 0);
    const rework = n(st.ReworkCount);
    const onHold = n(st.IsOnHold) === 1;
    const qty = n(st.TrackInPrimaryQuantity);
    const operators = x.operators ?? [];

    return [
      hero(
        'Lot History Report',
        `${s(st.Type, 'Material')} ${s(st.Form, '')} • Order ${s(j[0].ProductionOrderName)} • Status: ${s(
          st.CurrentStatus,
          'In Process',
        )}`,
        'Lot ID',
        s(j[0].LotName),
        '#1c86d4',
        '#12a897',
      ),
      statTiles(
        [
          { label: 'Process Operations', value: String(j.length) },
          { label: 'Processing Events', value: String(j.length * 2) },
          { label: 'Qty Started → Now', value: qty > 0 ? `${fmt(qty)} units` : '—', desc: 'Track-in quantity' },
          // A zero count stays neutral — showing "0 rework" in alarm red reads
          // as a problem when it is the opposite.
          {
            label: 'Holds',
            value: onHold ? '1' : '0',
            tint: onHold ? 'amber' : undefined,
            color: onHold ? WARN : '#8b93a7',
          },

          { label: 'Current Operation', value: s(st.LastStepName, '—'), desc: s(st.LastResourceName, '') },
        ],
        t,
      ),
      `<div class="notes">`,
      onHold
        ? callout('Lot hold.', `This lot is currently on hold at ${s(st.LastStepName)}.`, 'amber')
        : '',
      rework > 0
        ? callout('Rework.', `This lot has been reworked ${rework} time${rework === 1 ? '' : 's'}.`, 'red')
        : '',
      `</div>`,
      sectionLabel('Complete Event Timeline', t),
      panel(
        'Step-to-step history',
        `${dur(proc)} across recorded steps · flow ${s(st.FlowPath, '—')}`,
        table(
          [
            { key: 'i', label: '#', right: true },
            { key: 'ev', label: 'Event' },
            { key: 'dt', label: 'Date / time' },
            { key: 'op', label: 'From step → to step' },
            { key: 'eq', label: 'Track-in equipment' },
            { key: 'p', label: 'Time at step', right: true },
            { key: 'q', label: 'Qty', right: true },
          ],
          j.map((r, i) => ({
            i: n(r.StepSeq),
            ev: eventBadge(r),
            dt: esc(clock(r.TrackInTime)),
            op: esc(`${s(r.StepName)}${j[i + 1] ? ` → ${s(j[i + 1].StepName)}` : ''}`),
            eq: chip(s(r.ResourceName)),
            p: dur(Math.max(n(r.ProcessSec), 0)),
            q: qty > 0 ? fmt(qty) : '—',
          })) as Row[],
          true,
        ),
        t.ramp[0],
        true,
      ),
      `<div class="grid-2">`,
      panel(
        'Time at each step',
        'Longest first',
        barList(
          j
            .map((r) => ({
              label: `${n(r.StepSeq)}. ${s(r.StepName)}`,
              value: Number((Math.max(n(r.ProcessSec), 0) / 60).toFixed(2)),
              right: s(r.ResourceName),
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 12),
          'min',
          t,
        ),
        t.ramp[1],
      ),
      panel(
        'Operators',
        'Recorded on this lot’s equipment',
        operators.length
          ? table(
              [
                { key: 'u', label: 'Operator' },
                { key: 'r', label: 'Equipment' },
                { key: 'n', label: 'Units', right: true },
                { key: 'c', label: 'Avg cycle', right: true },
              ],
              operators.map((r) => ({
                u: esc(s(r.UserName)),
                r: chip(s(r.ResourceName)),
                n: fmt(n(r.UnitsProcessed)),
                c: dur(n(r.AvgCycleTimeSec)),
              })) as Row[],
            )
          : empty('No operator is recorded against this lot’s equipment.'),
        t.ramp[2],
      ),
      `</div>`,
    ].join('');
  },
};

// ===========================================================================
// Slide 5 — Fab Operations / Process Analytics
// ===========================================================================

const processAnalytics: Layout = {
  eyebrow: 'WIP Trend · Cycle Time Trend · Equipment Utilization — current week',
  pills: () => ['Current week'],
  summary: (x) => {
    const util = x.equipmentUtilisation ?? [];
    const avg = util.length ? util.reduce((a, r) => a + n(r.UtilizationPct), 0) / util.length : 0;
    return `${fmt(n(x.wipNow?.[0]?.WipLots))} lots in WIP now, average tool utilisation ${pct(
      avg,
    )}, material yield ${pct((x.yieldTrend ?? [])[0]?.FirstPassYield_Pct)}.`;
  },
  body: (x, _p, t) => {
    const wip = [...(x.wipTrend ?? [])].reverse();
    const yld = [...(x.yieldTrend ?? [])].reverse();
    const cyc = [...(x.cycleTimeTrend ?? [])].reverse();
    const util = x.equipmentUtilisation ?? [];
    const avg = util.length ? util.reduce((a, r) => a + n(r.UtilizationPct), 0) / util.length : 0;
    const latest = yld[yld.length - 1] ?? {};
    const running = util.filter((r) => n(r.UtilizationPct) > 0).length;

    return [
      kpiCards(
        [
          { label: 'Units Moved (week)', value: compact(cyc.reduce((a, r) => a + n(r.UnitsProduced), 0)), desc: 'Total WIP moved' },
          { label: 'Avg Cycle Time', value: `${n(cyc[cyc.length - 1]?.AvgCycleSec).toFixed(1)}`, desc: 'seconds / step' },
          { label: 'Tools Processing', value: String(running), desc: 'actively running' },
          { label: 'Fleet Utilization', value: pct(avg, 0), desc: 'of total equipment' },
        ],
        t,
      ),
      sectionLabel('WIP & Cycle Time Trend', t),
      `<div class="grid-2">`,
      panel(
        // The deck's slide plots movement per day, and this warehouse writes
        // WIP_Snapshot_EOD as 0 on every row, so lots moved is both the
        // matching measure and the one that actually carries data.
        'WIP Trend — Units Moved per Day',
        'Lots moved · per day',
        columnChart(
          wip.map((r) => ({ x: day(r.Day), y: n(r.TotalLotsProduced) })),
          t.ramp[0],
          'lots',
        ),
        t.ramp[0],
      ),
      panel(
        'Cycle Time Trend — avg seconds per step',
        'Per day',
        areaChart(
          [{ name: 'Avg cycle', points: cyc.map((r) => ({ x: day(r.Day), y: n(r.AvgCycleSec) })) }],
          's',
          [t.ramp[1]],
        ),
        t.ramp[1],
      ),
      `</div>`,
      `<div class="grid-2">`,
      panel(
        'Material Yield Trend',
        'Quantity remaining against original',
        areaChart(
          [
            { name: 'First-pass yield', points: yld.map((r) => ({ x: day(r.Day), y: n(r.FirstPassYield_Pct) })) },
            { name: 'Scrap rate', points: yld.map((r) => ({ x: day(r.Day), y: n(r.ScrapRate_Pct) })) },
          ],
          '%',
          t.ramp,
        ),
        t.ramp[2],
      ),
      panel(
        'Latest day',
        'Facility snapshot',
        kpiCards(
          [
            { label: 'Material Yield', value: pct(latest.FirstPassYield_Pct), desc: 'Quantity remaining vs original' },
            {
              label: 'Lots With Loss',
              value: fmt(n(x.wipNow?.[0]?.LotsWithLoss)),
              desc: `${fmt(n(x.wipNow?.[0]?.UnitsLost))} units below original quantity`,
              color: WARN,
            },
          ],
          t,
        ),
        t.ramp[3],
      ),
      `</div>`,
      sectionLabel('Equipment Utilization', t),
      `<div class="grid-2">`,
      panel(
        'Utilisation per tool',
        'Highest first',
        barList(
          util.map((r) => ({
            label: s(r.ResourceName),
            value: Number(n(r.UtilizationPct).toFixed(1)),
            right: `${compact(n(r.UnitsProduced))} units`,
          })),
          '%',
          t,
        ),
        t.ramp[0],
      ),
      panel(
        'Fleet Summary — by area',
        'Utilisation and output',
        [
          barList(
            (x.utilisationByArea ?? []).map((r) => ({
              label: s(r.AreaName),
              value: Number(n(r.UtilizationPct).toFixed(1)),
              right: `${compact(n(r.UnitsProduced))} units · ${n(r.Resources)} tools`,
            })),
            '%',
            t,
            true,
          ),
        ].join(''),
        t.ramp[4],
      ),
      `</div>`,
    ].join('');
  },
};

// ===========================================================================
// Slide 6 — Maintenance Prediction
// ===========================================================================

const maintenance: Layout = {
  eyebrow: 'Equipment Maintenance · Scheduled and Overdue',
  pills: (x) => [`${(x.riskRanking ?? []).filter((r) => n(r.RiskScore) > 0).length} at risk`],
  summary: (x) => {
    const up = x.scheduled ?? [];
    const due = x.pastDue ?? [];
    const risk = (x.riskRanking ?? []).filter((r) => n(r.RiskScore) > 0);
    return due.length
      ? `${due.length} maintenance window${due.length === 1 ? '' : 's'} past due, ${up.length} scheduled ahead, ${risk.length} tools at risk.`
      : `No maintenance windows are recorded in this environment — ${up.length} scheduled, none past due. Risk below is derived from utilisation and downtime.`;
  },
  body: (x, _p, t) => {
    const up = x.scheduled ?? [];
    const due = x.pastDue ?? [];
    const risk = x.riskRanking ?? [];
    const atRisk = risk.filter((r) => n(r.RiskScore) > 0);

    return [
      kpiCards(
        [
          { label: 'Scheduled for Maintenance', value: String(up.length), desc: 'Upcoming windows' },
          {
            label: 'Passing the Due',
            value: String(due.length),
            desc: 'Windows already ended',
            color: due.length ? BAD : OK,
          },
          {
            label: 'At Risk',
            value: String(atRisk.length),
            desc: 'Non-zero risk score',
            color: atRisk.length ? WARN : OK,
          },
          {
            label: 'Worst Downtime',
            value: pct((x.downtimeShare ?? [])[0]?.DowntimePct, 0),
            desc: s((x.downtimeShare ?? [])[0]?.ResourceName, 'None recorded'),
            color: BAD,
          },
        ],
        t,
      ),
      !up.length && !due.length
        ? `<div class="notes">${callout(
            'No maintenance schedule.',
            'This environment records no maintenance schedule, so the ranking below is derived from accumulated processing hours and time since last run instead.',
            'amber',
          )}</div>`
        : '',
      ...(due.length
        ? [
            sectionLabel('Equipment Passing the Due Date', t),
            panel(
              'Overdue maintenance',
              'Oldest first',
              table(
                [
                  { key: 'r', label: 'Equipment' },
                  { key: 't', label: 'Type' },
                  { key: 'e', label: 'Due' },
                  { key: 'p', label: 'Past due', right: true },
                ],
                due.map((r) => ({
                  r: esc(s(r.ResourceName)),
                  t: esc(s(r.MaintType)),
                  e: esc(clock(r.EndTime)),
                  p: `${fmt(n(r.HoursPastDue))} h`,
                  _flag: 'bad' as const,
                })),
              ),
              BAD,
              true,
            ),
          ]
        : []),
      ...(up.length
        ? [
            sectionLabel('Equipment Scheduled for Maintenance', t),
            panel(
              'Upcoming windows',
              'Soonest first',
              table(
                [
                  { key: 'r', label: 'Equipment' },
                  { key: 't', label: 'Type' },
                  { key: 'a', label: 'Starts' },
                  { key: 'b', label: 'Ends' },
                ],
                up.map((r) => ({
                  r: esc(s(r.ResourceName)),
                  t: esc(s(r.MaintType)),
                  a: esc(clock(r.StartTime)),
                  b: esc(clock(r.EndTime)),
                })) as Row[],
              ),
              t.ramp[0],
              true,
            ),
          ]
        : []),
      sectionLabel('Predicted Risk', t),
      `<div class="grid-2">`,
      panel(
        'Maintenance risk ranking',
        'By accumulated processing hours',
        // Only tools that actually carry risk. The view returns all 176
        // resources, so an unfiltered top-15 padded the ranking with rows
        // reading "0 — 0% utilised", which says nothing.
        barList(
          atRisk.map((r) => ({
            label: s(r.ResourceName),
            value: Number(n(r.RiskScore).toFixed(2)),
            color: WARN,
          })),
          '',
          t,
        ),
        WARN,
      ),
      panel(
        'Downtime share by tool',
        'Shift time spent down',
        barList(
          (x.downtimeShare ?? []).map((r) => ({
            label: s(r.ResourceName),
            value: Number(n(r.DowntimePct).toFixed(1)),
            color: BAD,
          })),
          '%',
          t,
        ),
        BAD,
      ),
      `</div>`,
      panel(
        'Downtime Pareto',
        'Hours lost by reason',
        pareto(
          (x.downtimeReasons ?? []).map((r) => ({
            label: s(r.Reason, 'Unclassified'),
            value: Number(n(r.TotalHours).toFixed(1)),
          })),
          'h',
          t.ramp[0],
        ),
        t.ramp[0],
        true,
      ),
    ].join('');
  },
};

// ===========================================================================
// Slide 7 — Bottleneck Prediction
// ===========================================================================

const bottleneck: Layout = {
  eyebrow: 'Bottleneck Prediction · Lots nearing due date',
  pills: (x) => [`${(x.ordersDueByMonday ?? []).length} orders due`],
  summary: (x) => {
    const due = x.ordersDueByMonday ?? [];
    const waiting = x.waitingLots ?? [];
    const late = due.filter((r) => n(r.IsLate) === 1).length;
    const worst = waiting[0];
    return `${due.length} open order${due.length === 1 ? '' : 's'} due by the coming Monday${
      late ? `, ${late} already late` : ''
    }${worst ? `; longest-waiting lot is ${s(worst.MaterialName)} at ${fmt(n(worst.HoursWaiting))} h on ${s(worst.ResourceName)}` : ''}.`;
  },
  body: (x, _p, t) => {
    const due = x.ordersDueByMonday ?? [];
    const waiting = x.waitingLots ?? [];
    const late = due.filter((r) => n(r.IsLate) === 1).length;
    const stalled = waiting.filter((r) => n(r.HoursWaiting) >= 24).length;
    const worst = waiting[0];
    const maxWait = Math.max(...waiting.map((r) => n(r.HoursWaiting)), 1);

    return [
      kpiCards(
        [
          { label: 'Orders Due by Monday', value: String(due.length), desc: 'Open production orders' },
          { label: 'Already Late', value: String(late), desc: 'Past their due date', color: late ? BAD : OK },
          {
            label: 'Lots Waiting > 24h',
            value: String(stalled),
            desc: `of ${waiting.length} queued lots`,
            color: stalled ? WARN : OK,
          },
          {
            label: 'Longest Wait',
            value: worst ? `${fmt(n(worst.HoursWaiting))} h` : '—',
            desc: worst ? `${s(worst.MaterialName)} at ${s(worst.ResourceName)}` : 'No queued lots',
            color: BAD,
          },
        ],
        t,
      ),
      late > 0
        ? `<div class="notes">${callout(
            'Delivery risk.',
            `${late} of ${due.length} open orders due by the coming Monday are already past their due date.`,
            'red',
          )}</div>`
        : '',
      sectionLabel('Bottleneck Lots Nearing Expiry', t),
      panel(
        'Lots queued longest',
        'WIP × wait time',
        table(
          [
            { key: 'l', label: 'Lot' },
            { key: 'p', label: 'Product' },
            { key: 'r', label: 'Held at' },
            { key: 'a', label: 'Area' },
            { key: 'w', label: 'Waiting', right: true },
            { key: 'i', label: 'Wait index' },
          ],
          waiting.map((r, i) => {
            const w = n(r.HoursWaiting);
            return {
              l: esc(s(r.MaterialName)),
              p: esc(s(r.ProductName)),
              r: chip(s(r.ResourceName)),
              a: esc(s(r.AreaName)),
              w: `${fmt(w)} h`,
              // Inline load-index bar, as on the deck's bottleneck table.
              i: `<span class="bt-track" style="display:inline-block;width:110px;vertical-align:middle"><i style="display:block;height:100%;border-radius:99px;width:${(
                (w / maxWait) *
                100
              ).toFixed(1)}%;background:${i === 0 ? BAD : t.ramp[2]}"></i></span>`,
              _flag: i === 0 ? ('bad' as const) : undefined,
            } as Row;
          }),
        ),
        BAD,
        true,
      ),
      sectionLabel('Orders Due on or Before the Coming Monday', t),
      panel(
        'Open production orders',
        'Earliest due date first',
        table(
          [
            { key: 'o', label: 'Production order' },
            { key: 'p', label: 'Product' },
            { key: 'd', label: 'Due date' },
            { key: 's', label: 'Status' },
            { key: 'q', label: 'Planned qty', right: true },
          ],
          due.map((r) => ({
            o: esc(s(r.ProductionOrderName)),
            p: esc(s(r.ProductName)),
            d: esc(s(r.DueDate).slice(0, 10)),
            s: n(r.IsLate) === 1 ? badge('LATE', BAD) : badge(s(r.OrderStatus), t.ramp[2]),
            q: fmt(n(r.Quantity_Planned)),
          })) as Row[],
        ),
        t.ramp[1],
        true,
      ),
      sectionLabel('Constraint Analysis', t),
      `<div class="grid-2">`,
      panel(
        'Constrained equipment',
        'Bottleneck score, latest day',
        barList(
          (x.constrainedEquipment ?? []).map((r) => ({
            label: s(r.ResourceName),
            value: n(r.BottleneckScore),
            right: s(r.AreaName),
          })),
          '',
          t,
        ),
        t.ramp[0],
      ),
      panel(
        'Next-shift risk',
        'Most likely to constrain',
        barList(
          (x.nextShiftRisk ?? [])
            .filter((r) => n(r.RiskScore) > 0)
            .map((r) => ({
              label: s(r.ResourceName),
              value: Number(n(r.RiskScore).toFixed(2)),
              color: WARN,
            })),
          '',
          t,
        ),
        WARN,
      ),
      `</div>`,
    ].join('');
  },
};

// ===========================================================================
// Slide 8 — Analytics Dashboard
// ===========================================================================

const analytics: Layout = {
  eyebrow: 'Yield · Scrap · WIP · Bottleneck · Cycle Time · Downtime',
  pills: (_x, p) => [p.product ?? '—'],
  summary: (x, p) => {
    const tp = x.yieldAndLossQty?.[0] ?? {};
    const qIn = n(tp.QuantityIn);
    const qOut = n(tp.QuantityOut);
    const y = qIn > 0 ? (qOut / qIn) * 100 : n(tp.AvgYield) * 100;
    return `${p.product}: ${fmt(qOut)} units out against ${fmt(qIn)} in (${pct(y)} yield), ${fmt(
      n(tp.LossQuantity),
    )} lost.`;
  },
  body: (x, p, t) => {
    const tp = x.yieldAndLossQty?.[0] ?? {};
    const rows = [...(x.yieldAndScrapTrend ?? [])].reverse();
    const qIn = n(tp.QuantityIn);
    const qOut = n(tp.QuantityOut);
    const loss = n(tp.LossQuantity);
    const y = qIn > 0 ? (qOut / qIn) * 100 : n(tp.AvgYield) * 100;

    const heat = x.wipHeatMap ?? [];
    const areas = [...new Set(heat.map((r) => s(r.AreaName)))].slice(0, 8);
    const steps = [...new Set(heat.map((r) => s(r.StepName)))].slice(0, 12);
    const cells = heat
      .map((r) => ({ x: areas.indexOf(s(r.AreaName)), y: steps.indexOf(s(r.StepName)), v: n(r.WipLots) }))
      .filter((c) => c.x >= 0 && c.y >= 0);

    return [
      kpiCards(
        [
          { label: 'Product', value: esc(p.product), desc: 'Scope of this analysis' },
          { label: 'Qty Out', value: fmt(qOut), desc: `${fmt(qIn)} units in` },
          { label: 'Loss Qty', value: fmt(loss), desc: 'Absolute quantity lost', color: loss > 0 ? WARN : OK },
          { label: 'Yield', value: pct(y), desc: 'Output over input' },
        ],
        t,
      ),
      sectionLabel('Yield Trends & Scrap Analysis', t),
      `<div class="grid-2">`,
      panel(
        'Yield, scrap and rework',
        'By day',
        areaChart(
          [
            { name: 'First-pass yield', points: rows.map((r) => ({ x: day(r.Day), y: n(r.FirstPassYield_Pct) })) },
            { name: 'Scrap rate', points: rows.map((r) => ({ x: day(r.Day), y: n(r.ScrapRate_Pct) })) },
            { name: 'Rework rate', points: rows.map((r) => ({ x: day(r.Day), y: n(r.ReworkRate_Pct) })) },
          ],
          '%',
          t.ramp,
        ),
        t.ramp[0],
      ),
      panel(
        `Cycle Time for each Step`,
        `${p.product} lots`,
        barList(
          (x.cycleTimeByStep ?? []).map((r) => ({
            label: s(r.StepName),
            value: Number(n(r.MeanCycleSec).toFixed(1)),
            right: `${n(r.Lots)} lots`,
          })),
          's',
          t,
        ),
        t.ramp[1],
      ),
      `</div>`,
      sectionLabel('WIP Heat Map', t),
      panel('Lots held by step and area', 'Darker = more WIP', heatMap(areas, steps, cells, t.ramp[0]), t.ramp[0], true),
      sectionLabel('Bottleneck Analysis & Equipment Utilization', t),
      `<div class="grid-2">`,
      panel(
        'Bottleneck analysis',
        'Latest recorded day',
        barList(
          (x.bottleneckAnalysis ?? []).map((r) => ({
            label: s(r.ResourceName),
            value: n(r.BottleneckScore),
            right: s(r.AreaName),
            color: BAD,
          })),
          '',
          t,
        ),
        BAD,
      ),
      panel(
        `Equipment Utilization — ${p.product}`,
        'Lots processed per tool',
        barList(
          (x.equipmentForProduct ?? []).map((r) => ({
            label: s(r.ResourceName),
            value: n(r.Lots),
            right: `${n(r.MeanCycleSec).toFixed(0)}s mean`,
          })),
          'lots',
          t,
        ),
        t.ramp[1],
      ),
      `</div>`,
      sectionLabel('Cycle Time Distribution', t),
      panel(
        'Percentile spread per step and tool',
        'Seconds',
        table(
          [
            { key: 'st', label: 'Step' },
            { key: 'r', label: 'Equipment' },
            { key: 'l', label: 'Lots', right: true },
            { key: 'a', label: 'P25', right: true },
            { key: 'b', label: 'Median', right: true },
            { key: 'c', label: 'P75', right: true },
            { key: 'd', label: 'P95', right: true },
          ],
          (x.cycleTimeDistribution ?? []).map((r) => ({
            st: esc(s(r.StepName)),
            r: chip(s(r.ResourceName)),
            l: fmt(n(r.LotCount)),
            a: fmt(n(r.P25CycleSec)),
            b: fmt(n(r.MedianCycleSec)),
            c: fmt(n(r.P75CycleSec)),
            d: fmt(n(r.P95CycleSec)),
          })) as Row[],
        ),
        t.ramp[4],
        true,
      ),
      sectionLabel('Pareto Analysis', t),
      `<div class="grid-2">`,
      panel(
        'Downtime Pareto',
        'Hours lost by reason',
        pareto(
          (x.downtimePareto ?? []).map((r) => ({
            label: s(r.Reason, 'Unclassified'),
            value: Number(n(r.TotalHours).toFixed(1)),
          })),
          'h',
          t.ramp[3],
        ),
        t.ramp[3],
      ),
      panel(
        'Scrap Pareto',
        'Units rejected by documented loss reason',
        pareto(
          (x.lossPareto ?? []).map((r) => ({ label: s(r.LossCategory, 'Unclassified'), value: n(r.LostUnits) })),
          'units',
          t.ramp[2],
        ),
        t.ramp[2],
      ),
      `</div>`,
    ].join('');
  },
};

// ===========================================================================
// Slide 9 — Executive Overview / Factory Performance
// ===========================================================================

const executive: Layout = {
  eyebrow: 'Plant-wide · Live Operations',
  pills: () => ['All products'],
  summary: (x) => {
    const daily = [...(x.dailyPerformance ?? [])].reverse();
    const latest = daily[daily.length - 1] ?? {};
    const otd = x.onTimeDelivery?.[0] ?? {};
    const total = n(otd.TotalOrders);
    const late = n(otd.Late);
    const wip = n(x.activeWipNow?.[0]?.WipLots);
    const area = (x.bottleneckArea ?? [])[0];
    return `${fmt(n(latest.UnitsOut))} units out on ${s(latest.Day).slice(0, 10)}, ${fmt(
      wip,
    )} lots in WIP, ${pct(latest.FirstPassYield_Pct)} material yield and ${pct(
      total > 0 ? ((total - late) / total) * 100 : 0,
      0,
    )} on-time delivery${area ? `; ${s(area.AreaName)} is the constraint` : ''}.`;
  },
  body: (x, _p, t) => {
    const daily = [...(x.dailyPerformance ?? [])].reverse();
    const latest = daily[daily.length - 1] ?? {};
    const otd = x.onTimeDelivery?.[0] ?? {};
    const total = n(otd.TotalOrders);
    const late = n(otd.Late);
    const otdPct = total > 0 ? ((total - late) / total) * 100 : 0;
    const wip = n(x.activeWipNow?.[0]?.WipLots);
    const areas = x.bottleneckArea ?? [];
    const maxWip = Math.max(...areas.map((r) => n(r.WipLots)), 1);

    return [
      kpiCards(
        [
          {
            label: 'Factory Throughput',
            value: fmt(n(latest.UnitsOut)),
            desc: `Units out · ${fmt(n(latest.TotalLotsProduced))} lots on ${s(latest.Day).slice(0, 10)}`,
          },
          { label: 'Active WIP', value: fmt(wip), desc: `lots · avg queue ${n(latest.AvgQueueLength).toFixed(1)}` },
          { label: 'Material Yield', value: pct(latest.FirstPassYield_Pct), desc: 'Quantity remaining vs original' },
          {
            label: 'On-Time Delivery',
            value: pct(otdPct, 1),
            desc: `${late} late of ${total} orders`,
            color: otdPct >= 95 ? OK : otdPct >= 80 ? WARN : BAD,
          },
        ],
        t,
      ),
      `<div class="grid-2" style="margin-top:13px">`,
      panel(
        'Factory Throughput Trend',
        'Units completed · by day',
        columnChart(
          daily.map((r) => ({ x: day(r.Day), y: n(r.UnitsOut) })),
          t.ramp[0],
          'units',
        ),
        t.ramp[0],
      ),
      panel(
        'Material Yield',
        'Quantity remaining against original',
        areaChart(
          [
            { name: 'First-pass yield', points: daily.map((r) => ({ x: day(r.Day), y: n(r.FirstPassYield_Pct) })) },
            { name: 'Scrap', points: daily.map((r) => ({ x: day(r.Day), y: n(r.ScrapRate_Pct) })) },
            { name: 'Rework', points: daily.map((r) => ({ x: day(r.Day), y: n(r.ReworkRate_Pct) })) },
          ],
          '%',
          t.ramp,
        ),
        t.ramp[2],
      ),
      `</div>`,
      panel(
        'Average Cycle Time per Step',
        'Mean processing duration · top 12 steps',
        barTable(
          (x.avgCycleTimePerStep ?? []).map((r) => ({
            label: s(r.StepName),
            value: Number(n(r.MeanCycleSec).toFixed(1)),
          })),
          's',
          t,
        ),
        t.ramp[0],
        true,
      ),
      `<div class="grid-2">`,
      panel(
        'Active WIP by Product',
        'Lots held · top products',
        barList(
          areas.map((r, i) => ({
            label: s(r.AreaName),
            value: n(r.WipLots),
            color: i === 0 ? BAD : t.ramp[1],
          })),
          'lots',
          t,
        ),
        t.ramp[1],
      ),
      panel(
        'WIP Concentration',
        'Where work in process is piling up',
        table(
          [
            { key: 'a', label: 'Product' },
            { key: 'w', label: 'WIP lots', right: true },

            { key: 'i', label: 'Load index' },
          ],
          areas.map((r, i) => ({
            a: `${i === 0 ? '▲ ' : ''}${esc(s(r.AreaName))}`,
            w: fmt(n(r.WipLots)),

            i: `<span class="bt-track" style="display:inline-block;width:120px;vertical-align:middle"><i style="display:block;height:100%;border-radius:99px;width:${(
              (n(r.WipLots) / maxWip) *
              100
            ).toFixed(1)}%;background:${i === 0 ? BAD : t.ramp[0]}"></i></span>`,
            _flag: i === 0 ? ('bad' as const) : undefined,
          })) as Row[],
        ),
        BAD,
      ),
      `</div>`,
      sectionLabel('On-Time Delivery', t),
      panel(
        'Open orders by due date',
        'Delivery risk',
        table(
          [
            { key: 'o', label: 'Order' },
            { key: 'p', label: 'Product' },

            { key: 'd', label: 'Due' },
            { key: 'st', label: 'Status' },
          ],
          (x.openOrders ?? []).map((r) => ({
            o: esc(s(r.ProductionOrderName)),
            p: esc(s(r.ProductName)),

            d: esc(s(r.DueDate).slice(0, 10)),
            st: n(r.IsLate) === 1 ? badge('LATE', BAD) : badge(s(r.OrderStatus), t.ramp[1]),
          })) as Row[],
        ),
        t.ramp[3],
        true,
      ),
    ].join('');
  },
};

// ===========================================================================

const LAYOUTS: Record<string, Layout> = {
  'factory-operations': factoryOperations,
  'lot-history': lotHistory,
  'process-analytics': processAnalytics,
  'maintenance-prediction': maintenance,
  'bottleneck-prediction': bottleneck,
  'analytics-dashboard': analytics,
  'executive-overview': executive,
};

/** Slide titles, matching the deck's own wording. */
const TITLES: Record<string, string> = {
  'factory-operations': 'Factory Operations Dashboard',
  'lot-history': 'Lot History Report',
  'process-analytics': 'Fab Operations Dashboard',
  'maintenance-prediction': 'Maintenance Prediction Dashboard',
  'bottleneck-prediction': 'Bottleneck Prediction Dashboard',
  'analytics-dashboard': 'Analytics Dashboard',
  'executive-overview': 'Factory Performance Dashboard',
};

export type RenderedDashboard = { summary: string; html: string; title: string };

export function renderDashboard(data: DashboardData): RenderedDashboard {
  const sets: Sets = {};
  for (const set of data.sets) sets[set.key] = set.rows;

  const layout = LAYOUTS[data.id];
  const theme = THEMES[data.id] ?? THEMES['factory-operations'];
  const title = TITLES[data.id] ?? data.title;

  if (!layout) {
    return {
      title,
      summary: 'That dashboard is not available.',
      html: shell({
        title,
        eyebrow: 'FabInsight',
        lede: '',
        stamp: '',
        pills: [],
        notes: [],
        theme,
        body: empty('No layout defined.'),
      }),
    };
  }

  const summary = layout.summary(sets, data.params);
  // Always UTC + labelled, so this matches the "Last refreshed … UTC" stamp on
  // the /reports page (and never drifts with the server's timezone).
  const stamp = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';

  const html = shell({
    title,
    eyebrow: layout.eyebrow,
    lede: summary,
    stamp,
    pills: layout.pills(sets, data.params),
    notes: data.notes,
    theme,
    body: layout.body(sets, data.params, theme),
  });

  // The recipe travels inside the document, so anything holding the HTML — the
  // artifact panel, a pinned record — can re-run the query later without having
  // been told separately what produced it. This is what makes Refresh and the
  // pinned dashboards live rather than snapshots.
  const recipe = esc(JSON.stringify({ id: data.id, params: data.params }));

  return {
    title,
    summary,
    html: html.replace('</head>', `<meta name="fab-recipe" content="${recipe}">\n</head>`),
  };
}
