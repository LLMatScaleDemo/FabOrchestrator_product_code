/**
 * Phase 1 — custom (admin-created) dashboards.
 * Deterministic tests for the SQL guard + generic renderer, plus a LIVE MES
 * smoke (skipped unless SEMI_SQL_PASS is set — i.e. VPN connected).
 */
// mssql ships ESM deps (@azure/identity) that jest's transform ignores, and it
// is only pulled in transitively (custom.ts -> mcp.ts). These tests never run a
// real query, so a stub module keeps the import graph loadable. The live MES
// data path uses the same fabQuery the 7 shipped dashboards already use.
jest.mock('mssql', () => ({ __esModule: true, default: {} }));

import { assertReadOnlySelect, UnsafeSqlError } from '@/lib/fabinsight/sql-guard';
import { parseCustomDef, renderCustomDashboard } from '@/lib/fabinsight/custom';
import type { DashboardData } from '@/lib/fabinsight/dashboards';

describe('sql-guard: assertReadOnlySelect', () => {
  it('allows a plain SELECT and strips a trailing semicolon', () => {
    expect(assertReadOnlySelect('SELECT TOP 5 * FROM cammes.Container;')).toBe('SELECT TOP 5 * FROM cammes.Container');
  });
  it('allows a leading CTE that resolves to a SELECT', () => {
    expect(() => assertReadOnlySelect('WITH x AS (SELECT 1 AS a) SELECT * FROM x')).not.toThrow();
  });
  it('ignores keywords inside string literals', () => {
    expect(() => assertReadOnlySelect("SELECT 'please update the lot' AS note")).not.toThrow();
  });
  it.each([
    ['empty', ''],
    ['update', 'UPDATE cammes.Container SET Qty = 0'],
    ['delete', 'DELETE FROM cammes.Container'],
    ['drop', 'DROP TABLE cammes.Container'],
    ['multi-statement', 'SELECT 1; DELETE FROM cammes.Container'],
    ['select into', 'SELECT * INTO tmp FROM cammes.Container'],
    ['exec proc', 'EXEC sp_who'],
    ['xp proc', 'SELECT * FROM x WHERE 1=1; xp_cmdshell'],
    ['not a select', 'TRUNCATE TABLE x'],
  ])('rejects %s', (_label, sql) => {
    expect(() => assertReadOnlySelect(sql)).toThrow(UnsafeSqlError);
  });
});

describe('parseCustomDef', () => {
  it('normalises a valid definition', () => {
    const def = parseCustomDef({ title: 'X', queries: [{ label: 'A', sql: 'SELECT 1 AS a' }] });
    expect(def.title).toBe('X');
    expect(def.queries).toHaveLength(1);
    expect(def.queries[0].key).toBe('set1');
  });
  it('requires a title', () => {
    expect(() => parseCustomDef({ title: '', queries: [{ label: 'A', sql: 'SELECT 1' }] })).toThrow();
  });
  it('requires at least one query', () => {
    expect(() => parseCustomDef({ title: 'X', queries: [] })).toThrow();
  });
  it('rejects an unsafe query', () => {
    expect(() => parseCustomDef({ title: 'X', queries: [{ label: 'A', sql: 'DELETE FROM x' }] })).toThrow();
  });
  it('caps the number of queries', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ label: `q${i}`, sql: 'SELECT 1' }));
    expect(() => parseCustomDef({ title: 'X', queries: many })).toThrow();
  });
});

describe('renderCustomDashboard (generic layout)', () => {
  it('renders KPI cards for a single-row set and a table for a multi-row set', () => {
    const data: DashboardData = {
      id: 'custom',
      title: 'My Dash',
      params: {},
      notes: [],
      sets: [
        { key: 'kpi', label: 'Totals', rows: [{ Lots: 42, Products: 7 }] },
        {
          key: 'byprod',
          label: 'By Product',
          rows: [
            { ProductName: 'HL13B5', Lots: 10 },
            { ProductName: 'ZX9', Lots: 5 },
          ],
        },
      ],
      tookMs: 3,
    };
    const def = {
      title: 'My Dash',
      queries: [
        { key: 'kpi', label: 'Totals', sql: 'SELECT 1' },
        { key: 'byprod', label: 'By Product', sql: 'SELECT 1' },
      ],
    };
    const out = renderCustomDashboard(data, def);
    expect(out.title).toBe('My Dash');
    expect(out.html).toContain('My Dash');
    expect(out.html).toContain('Totals');
    expect(out.html).toContain('By Product');
    expect(out.html).toContain('HL13B5');
    // KPI cards for the single-row set
    expect(out.html).toContain('kpi-value');
    // A data table for the multi-row set
    expect(out.html).toContain('<table');
    // Re-runnable recipe embedded, marked custom
    expect(out.html).toContain('name="fab-recipe"');
    expect(out.html).toContain('custom');
  });
});

