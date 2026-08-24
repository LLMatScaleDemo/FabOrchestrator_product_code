import sql from "mssql";
import { currentDbKey } from "@/lib/cmf/db-context";
import { profileFor, type CmfDbKey } from "@/lib/cmf/db-registry";

/**
 * Read-only connection to the CMF (Critical Manufacturing) SQL Server, used by
 * the pre-flight validator to read entity/table metadata and to check parent
 * key existence. Connects by INSTANCE NAME (resolved via SQL Browser) rather
 * than a fixed port, because the named instance uses a dynamic TCP port.
 *
 * Treat this as read-only: the validator never writes to CMF's database.
 *
 * The app targets TWO CMF databases (source/target). Which one a call hits is
 * carried in AsyncLocalStorage (see db-context.ts) and resolved here per call,
 * so callers don't thread a "which DB" argument. Pools are cached PER dbKey.
 */

// One connection pool per CMF database key. A miss/`null` triggers a fresh
// connect for that key only, so a transient fault on one DB never drops the other.
const pools = new Map<CmfDbKey, Promise<sql.ConnectionPool> | null>();

function buildConfig(dbKey: CmfDbKey): sql.config {
  const profile = profileFor(dbKey);
  const { server, database, user, instanceName, passwordEnv } = profile.sql;
  // Prefer the admin-managed connection row's decrypted password; fall back to
  // the env var (passwordEnv) when the row has none — so nothing breaks until an
  // admin sets a password in the UI.
  const password = profile.sql.password ?? (passwordEnv ? process.env[passwordEnv] : undefined);
  if (!server || !database || !user || !password) {
    const src = passwordEnv ? `${passwordEnv} (SQL password) or a stored connection password` : "a stored connection password";
    throw new Error(`CMF SQL not configured for "${dbKey}" — need server/database/user and ${src}.`);
  }
  return {
    server,
    database,
    user,
    password,
    options: {
      instanceName: instanceName || undefined, // dynamic-port named instance, resolved via SQL Browser (UDP 1434)
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
    // These defaults are the values proven to work against this CMF instance.
    // Do NOT shorten them without measuring a healthy connect first: the server
    // is a named instance behind a VPN, so every connect pays SQL Browser
    // discovery (UDP 1434) plus a dynamic-port handshake. An earlier attempt to
    // "fail fast" at 8s simply broke connections. Slow-link UX is handled in the
    // UI instead — the entry form falls back to a typeable input when a lookup
    // fails, rather than blocking on a dropdown that never loads.
    connectionTimeout: Number(process.env.CMF_SQL_CONNECT_TIMEOUT_MS ?? "20000"),
    requestTimeout: Number(process.env.CMF_SQL_REQUEST_TIMEOUT_MS ?? "30000"),
  };
}

export async function getCmfSqlPool(): Promise<sql.ConnectionPool> {
  const dbKey = currentDbKey();
  let p = pools.get(dbKey) ?? null;
  if (!p) {
    p = new sql.ConnectionPool(buildConfig(dbKey)).connect().catch((err: unknown) => {
      pools.set(dbKey, null); // allow retry on next call
      throw err;
    });
    pools.set(dbKey, p);
  }
  return p;
}

/** Transient network faults on the VPN link that a fresh connection recovers
 *  from — the query is read-only, so re-running it is always safe. */
const TRANSIENT = new Set(["ECONNRESET", "ETIMEOUT", "ESOCKET", "ECONNCLOSED", "EPIPE"]);
function isTransient(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return !!code && TRANSIENT.has(code);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a parameterized read-only query. Pass inputs as `{ name: value }` and
 * reference them in SQL as `@name`.
 *
 * The CMF server is a named instance behind a VPN, so a heavy query can drop
 * mid-flight (ECONNRESET) even when the link is up. Because every query here is
 * read-only, we transparently retry transient network faults on a FRESH pool a
 * few times before giving up — this is what makes large reads (metadata bulk
 * loads, dependency-export data walks) reliable over a flaky tunnel.
 */
export async function cmfQuery<T = Record<string, unknown>>(
  query: string,
  inputs: Record<string, string | number> = {},
): Promise<T[]> {
  const maxAttempts = Number(process.env.CMF_SQL_RETRIES ?? "3") + 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const pool = await getCmfSqlPool();
      const req = pool.request();
      for (const [k, v] of Object.entries(inputs)) req.input(k, v);
      const result = await req.query(query);
      return result.recordset as T[];
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxAttempts) throw err;
      // Drop the (likely dead) pool for the CURRENT DB so the next attempt
      // reconnects fresh — without disturbing the other database's pool.
      const dbKey = currentDbKey();
      const dead = pools.get(dbKey) ?? null;
      pools.set(dbKey, null);
      void dead?.then((p) => p.close()).catch(() => {});
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
}
