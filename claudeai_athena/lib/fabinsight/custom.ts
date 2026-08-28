/**
 * Admin-created ("custom") dashboards.
 *
 * Unlike the seven curated dashboards — each with its own hand-built layout in
 * render.ts — a custom dashboard is defined at runtime by the admin: a title and
 * one or more read-only SELECTs. We run those queries and render their result
 * sets through a GENERIC layout (a titled panel + table per set, KPI cards for a
 * single-row set) using the same render-kit primitives, so a custom dashboard
 * looks native and — crucially — stays re-runnable: Refresh and scheduled runs
 * re-execute the stored SQL, exactly like the recipes do.
 */

import { fabQuery, type FabRow } from '@/lib/fabinsight/mcp';
import type { DashboardData } from '@/lib/fabinsight/dashboards';
import { assertReadOnlySelect } from '@/lib/fabinsight/sql-guard';
import {
  THEMES,
  type Col,
  type Row,
  empty,
  esc,
  fmt,
  kpiCards,
  n,
  panel,
  s,
  sectionLabel,
  shell,
  table,
} from '@/lib/fabinsight/render-kit';
import type { RenderedDashboard } from '@/lib/fabinsight/render';

export type CustomQuery = { key: string; label: string; sql: string; limit?: number };
export type CustomDef = { title: string; queries: CustomQuery[] };

const MAX_QUERIES = 6;
const MAX_LIMIT = 500;
const DISPLAY_ROWS = 100;
const CUSTOM_THEME = THEMES['executive-overview'] ?? THEMES['factory-operations'];

/** The stable id prefix that marks a pin/definition as custom (vs one of the 7). */
export const CUSTOM_ID = 'custom';

/**
 * Validate + normalise a raw custom-dashboard definition (from the create tool
 * or a stored pin). Throws on any unsafe/invalid input. Every SQL is passed
 * through the read-only guard and stored in its cleaned form.
 */
export function parseCustomDef(input: unknown): CustomDef {
  const o = (input ?? {}) as Record<string, unknown>;
  const title = String(o.title ?? '').trim();
  if (!title) throw new Error('A dashboard title is required.');
  if (title.length > 120) throw new Error('Title is too long (120 characters max).');

  const rawQueries = Array.isArray(o.queries) ? o.queries : [];
  if (!rawQueries.length) throw new Error('At least one query is required.');
  if (rawQueries.length > MAX_QUERIES) {
    throw new Error(`Too many queries (max ${MAX_QUERIES}).`);
  }

  const queries: CustomQuery[] = rawQueries.map((raw, i) => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const label = String(q.label ?? `Result ${i + 1}`).trim().slice(0, 80);
    const key = String(q.key ?? '').trim() || `set${i + 1}`;
    const sql = assertReadOnlySelect(String(q.sql ?? '')); // throws if unsafe
    const rawLimit = Number(q.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : MAX_LIMIT;
    return { key, label, sql, limit };
  });

  return { title, queries };
}

/** Run a custom definition's queries and return DashboardData-shaped result. */
export async function fetchCustomData(def: CustomDef): Promise<DashboardData> {
  const started = Date.now();
  const settled = await Promise.allSettled(
    def.queries.map((q) => fabQuery(q.sql, q.limit ?? MAX_LIMIT)),
  );

  const sets = def.queries.map((q, i) => {
    const res = settled[i];
    if (res.status === 'fulfilled') {
      return { key: q.key, label: q.label, rows: res.value };
    }
    const reason = res.reason as { detail?: string; message?: string };
    return {
      key: q.key,
      label: q.label,
      rows: [] as FabRow[],
      error: reason?.detail ?? reason?.message ?? 'query failed',
    };
  });

  const notes: string[] = [];
  const failed = sets.filter((set) => set.error);
  if (failed.length) {
    notes.push(
      `${failed.length} of ${sets.length} data sets did not return; the panels they would feed are omitted.`,
    );
  }

  return {
    id: CUSTOM_ID,
    title: def.title,
    params: {},
    notes,
    sets,
    tookMs: Date.now() - started,
  };
}

/** A column is numeric when every non-empty value in the shown rows is a number. */
function isNumericColumn(rows: FabRow[], key: string): boolean {
  let seen = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined || v === '') continue;
    seen++;
    if (typeof v === 'number') continue;
    if (typeof v === 'boolean') return false;
    if (Number.isNaN(Number(String(v)))) return false;
  }
  return seen > 0;
}

/** Render one result set as a table (or KPI cards for a single-row set). */
function renderSet(label: string, rows: FabRow[], error: string | undefined): string {
  if (error) return panel(label, 'Query failed', empty(`This data set failed to load: ${esc(error)}`), CUSTOM_THEME.ramp[0]);
  if (!rows.length) return panel(label, '', empty('No rows returned.'), CUSTOM_THEME.ramp[0]);

  const cols = Object.keys(rows[0]);

  // A single row with a handful of columns reads best as KPI cards.
  if (rows.length === 1 && cols.length > 0 && cols.length <= 6) {
    const only = rows[0];
    return panel(
      label,
      '',
      kpiCards(
        cols.map((c) => ({
          label: c,
          value: isNumericColumn(rows, c) ? fmt(n(only[c])) : esc(s(only[c])),
        })),
        CUSTOM_THEME,
      ),
      CUSTOM_THEME.ramp[0],
      true,
    );
  }

  const shown = rows.slice(0, DISPLAY_ROWS);
  const numeric = new Set(cols.filter((c) => isNumericColumn(rows, c)));
  const tableCols: Col[] = cols.map((c) => ({ key: c, label: c, right: numeric.has(c) }));
  const tableRows: Row[] = shown.map((r) => {
    const out: Row = {};
    for (const c of cols) out[c] = numeric.has(c) ? fmt(n(r[c])) : esc(s(r[c]));
    return out;
  });
  const note = rows.length > shown.length ? `${rows.length} rows · showing first ${shown.length}` : `${rows.length} rows`;
  // table() emits cell values verbatim; we pre-escaped every cell above.
  return panel(label, note, table(tableCols, tableRows, true), CUSTOM_THEME.ramp[1], true);
}

/**
 * Render a custom dashboard's data to a self-contained HTML document, matching
 * the look of the curated dashboards. Embeds a `fab-recipe` meta carrying the
 * whole definition, so the artifact panel / a pinned row can re-run it later.
 */
export function renderCustomDashboard(data: DashboardData, def: CustomDef): RenderedDashboard {
  const totalRows = data.sets.reduce((a, set) => a + set.rows.length, 0);
  const summary = `${def.title} — ${data.sets.length} data set${data.sets.length === 1 ? '' : 's'}, ${totalRows} row${totalRows === 1 ? '' : 's'}.`;

  const stamp =
    new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC';

  const body = data.sets
    .map((set) => [sectionLabel(set.label, CUSTOM_THEME), renderSet(set.label, set.rows, set.error)].join(''))
    .join('');

  const html = shell({
    title: def.title,
    eyebrow: 'Custom Dashboard',
    lede: summary,
    stamp,
    pills: [],
    notes: data.notes,
    theme: CUSTOM_THEME,
    body,
  });

  const recipe = esc(JSON.stringify({ kind: 'custom', title: def.title, queries: def.queries }));
  return {
    title: def.title,
    summary,
    html: html.replace('</head>', `<meta name="fab-recipe" content="${recipe}">\n</head>`),
  };
}
