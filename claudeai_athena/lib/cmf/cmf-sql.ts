import sql from "mssql";

/**
 * Read-only connection to the CMF (Critical Manufacturing) SQL Server, used by
 * the pre-flight validator to read entity/table metadata and to check parent
 * key existence. Connects by INSTANCE NAME (resolved via SQL Browser) rather
 * than a fixed port, because the named instance uses a dynamic TCP port.
 *
 * Treat this as read-only: the validator never writes to CMF's database.
 */

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function buildConfig(): sql.config {
  const server = process.env.CMF_SQL_SERVER;
  const database = process.env.CMF_SQL_DB;
  const user = process.env.CMF_SQL_USER;
  const password = process.env.CMF_SQL_PASS;
  const instanceName = process.env.CMF_SQL_INSTANCE || undefined;
  if (!server || !database || !user || !password) {
    throw new Error(
      "CMF SQL not configured — set CMF_SQL_SERVER, CMF_SQL_DB, CMF_SQL_USER, CMF_SQL_PASS (and CMF_SQL_INSTANCE).",
    );
  }
  return {
    server,
    database,
    user,
    password,
    options: {
      instanceName, // dynamic-port named instance, resolved via SQL Browser (UDP 1434)
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
    // Fail fast. CMF sits behind a VPN, so a dropped tunnel is a normal event —
    // the old 20s/30s waits left interactive callers (e.g. the entry form's FK
    // dropdown) hanging for ~30s before erroring. These are short enough that a
    // blip degrades quickly to the "type the value instead" fallback, and are
    // env-overridable for slower links.
    connectionTimeout: Number(process.env.CMF_SQL_CONNECT_TIMEOUT_MS ?? "8000"),
    requestTimeout: Number(process.env.CMF_SQL_REQUEST_TIMEOUT_MS ?? "15000"),
  };
}

export async function getCmfSqlPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(buildConfig()).connect().catch((err: unknown) => {
      poolPromise = null; // allow retry on next call
      throw err;
    });
  }
  return poolPromise;
}

/**
 * Run a parameterized read-only query. Pass inputs as `{ name: value }` and
 * reference them in SQL as `@name`.
 */
export async function cmfQuery<T = Record<string, unknown>>(
  query: string,
  inputs: Record<string, string | number> = {},
): Promise<T[]> {
  const pool = await getCmfSqlPool();
  const req = pool.request();
  for (const [k, v] of Object.entries(inputs)) req.input(k, v);
  const result = await req.query(query);
  return result.recordset as T[];
}
