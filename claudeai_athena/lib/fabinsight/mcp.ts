/**
 * FabInsight — read-only SQL channel to the Opcenter SemiDemo MES.
 *
 * This replaced an MCP/JSON-RPC client that pointed at the Entegris KSP
 * warehouse. The deck's data lives here instead: lot `26FHEAEB1E00000`,
 * product `HL13B5` and the 5,972-lot WIP count all resolve against this
 * database and nowhere else.
 *
 * There is no MCP server deployed for this host (the sheet's Opcenter entry is
 * a different box, 10.10.1.103/OLTP2510), so we connect directly with `mssql`.
 * The public surface is deliberately unchanged — `fabQuery(sql, limit)` still
 * returns plain row objects — so `dashboards.ts`, `inject.ts` and the routes
 * did not have to change shape when the source moved.
 *
 * Strictly read-only: every caller issues a SELECT, which is what makes the
 * transient-fault retry below safe.
 */

import sql from 'mssql';

export class FabQueryError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'FabQueryError';
  }
}

function config(): sql.config {
  const server = process.env.SEMI_SQL_SERVER ?? '10.10.1.109';
  const database = process.env.SEMI_SQL_DB ?? 'SemiDemoOLTP2504';
  const user = process.env.SEMI_SQL_USER ?? 'SemiOLTPUser';
  const password = process.env.SEMI_SQL_PASS;
  if (!password) {
    throw new FabQueryError(
      'The manufacturing data connection is not configured.',
      'SEMI_SQL_PASS is not set',
    );
  }
  return {
    server,
    database,
    user,
    password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { max: 8, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: Number(process.env.SEMI_SQL_CONNECT_TIMEOUT_MS ?? '20000'),
    requestTimeout: Number(process.env.SEMI_SQL_REQUEST_TIMEOUT_MS ?? '60000'),
  };
}

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config())
      .connect()
      .catch((err: unknown) => {
        poolPromise = null; // allow a retry on the next call
        throw err;
      });
  }
  return poolPromise;
}

/** Network faults a fresh connection recovers from. Every query is a SELECT,
 *  so re-running one is always safe. */
const TRANSIENT = new Set(['ECONNRESET', 'ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'EPIPE']);
function isTransient(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return !!code && TRANSIENT.has(code);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * When the link last answered. The dashboard route sizes its per-query timeout
 * from this: a first connection over the VPN is slow, a warm pool is not.
 */
let lastSuccessAt = 0;

export function isLinkWarm(withinMs = 120_000): boolean {
  return lastSuccessAt > 0 && Date.now() - lastSuccessAt < withinMs;
}

export type FabRow = Record<string, string | number | boolean | null>;

/**
 * Run one read-only SELECT and return plain row objects.
 *
 * `limit` is advisory — the queries in `dashboards.ts` carry their own `TOP n`.
 * It is applied client-side as a backstop so a mistaken query can never stream
 * an unbounded result set into the model's context.
 */
export async function fabQuery(query: string, limit = 500): Promise<FabRow[]> {
  const maxAttempts = Number(process.env.SEMI_SQL_RETRIES ?? '2') + 1;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const pool = await getPool();
      const result = await pool.request().query(query);
      lastSuccessAt = Date.now();
      const rows = (result.recordset ?? []) as FabRow[];
      return rows.length > limit ? rows.slice(0, limit) : rows;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxAttempts) break;
      // Drop the (likely dead) pool so the next attempt reconnects fresh.
      const dead = poolPromise;
      poolPromise = null;
      void dead?.then((p) => p.close()).catch(() => {});
      await sleep(400 * attempt);
    }
  }

  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new FabQueryError(
    'The manufacturing data service is temporarily unavailable. Please try again in a few moments.',
    detail.slice(0, 400),
  );
}

/** Schema introspection for the dev route — replaces the old MCP view catalogue. */
export async function fabViewDetails(tables: string[]): Promise<unknown> {
  if (!tables.length) {
    return fabQuery(
      `SELECT TOP 100 t.name AS TableName, SUM(p.rows) AS Rows
         FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
        WHERE s.name = 'cammes'
        GROUP BY t.name HAVING SUM(p.rows) > 0
        ORDER BY SUM(p.rows) DESC`,
      100,
    );
  }
  const list = tables.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
  return fabQuery(
    `SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'cammes' AND TABLE_NAME IN (${list})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    1000,
  );
}

/** Numeric coercion tolerant of decimal-as-string and `bit`-as-boolean. */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** String coercion with an em-dash placeholder, so tiles never render "null". */
export function str(v: unknown, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}
