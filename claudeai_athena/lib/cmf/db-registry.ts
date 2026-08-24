/**
 * CMF database registry — the two Critical Manufacturing databases the app can
 * talk to, and how to reach each one.
 *
 *  - source (Entegris/KSP)  — the customized production CMF.
 *  - target (OOB)           — the out-of-the-box CMF we load data INTO.
 *
 * Design (per the dual-DB plan):
 *  - NON-SECRET connection facts (SQL host/instance/db, REST base URL, host→IP,
 *    token secret id) are hardcoded here, committed. There are exactly two,
 *    ops-owned, near-never-changing connections; a DB table + admin UI would be
 *    far more machinery than that warrants.
 *  - The only real SECRET — the SQL password — is read from an env var named per
 *    DB (`passwordEnv`), so rotating one DB never touches the other.
 *  - The bearer TOKEN is never minted here: a separate Lambda mints it and
 *    publishes it to AWS Secrets Manager; we only READ the secret named by
 *    `tokenSecretId` (see cmf-auth.ts).
 *
 * Back-compat: the `source` profile DEFAULTS every field to the existing env
 * vars (CMF_SQL_SERVER/DB/USER/PASS/INSTANCE, CMF_BASE_URL, HOST_RESOLVER,
 * CMF_TOKEN_SECRET_ID). With no DB selected, everything resolves to `source` ==
 * the app's previous single-DB config, so the deployed behaviour is unchanged.
 */

import { getCachedProfile, ensureConnectionsFresh } from "@/lib/cmf/connection-store";

// A CMF database key. Historically just "source" | "target" (the two built-in
// connections); now ANY admin-created connection's db_key, so it is a string.
// The two built-ins keep committed env-default profiles as a fallback; every
// other key is resolved from the admin-managed cmf_connections table (cache).
export type CmfDbKey = string;

export interface CmfDbSqlConfig {
  server: string;
  database: string;
  instanceName?: string;
  user: string;
  /** Name of the env var holding this DB's SQL password (kept out of source). */
  passwordEnv: string;
  /** Resolved plaintext SQL password from the admin-managed connection row
   *  (decrypted at load). When present it takes precedence over `passwordEnv`;
   *  when absent the app falls back to reading `process.env[passwordEnv]`. */
  password?: string;
}

export interface CmfDbProfile {
  id: CmfDbKey;
  /** Human label for the toggle UI. */
  label: string;
  sql: CmfDbSqlConfig;
  /** CMF MES REST base URL. */
  baseUrl: string;
  /** host→IP pairs merged into the undici resolver (on-prem hosts w/o public DNS). */
  hostResolver: Array<[host: string, ip: string]>;
  /** AWS Secrets Manager secret id holding this DB's bearer token (legacy source;
   *  used as a fallback while migrating to the DB-backed token table). */
  tokenSecretId: string;
  /** Key into the `cmf_bearer_tokens` table (the auth Lambda writes the JWT here
   *  every ~45 min, keyed by CMF database name). Preferred token source. */
  tokenDbName: string;
}

/** The DB used when no selection is active — the app's legacy single-DB target. */
export const DEFAULT_DB_KEY: CmfDbKey = "source";

/** Parse "host=ip[,host=ip]" (the legacy HOST_RESOLVER format) into pairs. */
function parseHostResolver(raw: string | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const pair of (raw ?? "").split(",")) {
    const [host, ip] = pair.split("=").map((s) => s.trim());
    if (host && ip) out.push([host, ip]);
  }
  return out;
}

const SOURCE: CmfDbProfile = {
  id: "source",
  label: "Entegris / KSP (source)",
  sql: {
    // Default to the existing env config so prod behaviour is unchanged.
    server: process.env.CMF_SQL_SERVER ?? "10.10.1.224",
    database: process.env.CMF_SQL_DB ?? "EntegrisKSPUpgrade",
    instanceName: process.env.CMF_SQL_INSTANCE ?? "ONLINE",
    user: process.env.CMF_SQL_USER ?? "cmuser",
    passwordEnv: "CMF_SQL_PASS",
  },
  baseUrl: process.env.CMF_BASE_URL ?? "https://atscmapp4.usa.athenatec.com",
  hostResolver: parseHostResolver(process.env.HOST_RESOLVER).length
    ? parseHostResolver(process.env.HOST_RESOLVER)
    : [["atscmapp4.usa.athenatec.com", "10.10.1.224"]],
  tokenSecretId: process.env.CMF_TOKEN_SECRET_ID ?? "cmf/portal-token-entegris-224",
  tokenDbName: process.env.CMF_SQL_DB ?? "EntegrisKSPUpgrade",
};

const TARGET: CmfDbProfile = {
  id: "target",
  label: "OOB (target)",
  sql: {
    server: process.env.CMF_SQL_SERVER_TARGET ?? "10.10.1.145",
    database: process.env.CMF_SQL_DB_TARGET ?? "CriticalManufacturing",
    instanceName: process.env.CMF_SQL_INSTANCE_TARGET ?? "ONLINE",
    user: process.env.CMF_SQL_USER_TARGET ?? "cmuser",
    passwordEnv: "CMF_SQL_PASS_TARGET",
  },
  baseUrl: process.env.CMF_BASE_URL_TARGET ?? "https://athena-cmf-srv.usa.athenatec.com",
  // OOB host has NO public DNS — this mapping is mandatory.
  hostResolver: [["athena-cmf-srv.usa.athenatec.com", "10.10.1.145"]],
  tokenSecretId: process.env.CMF_TOKEN_SECRET_ID_TARGET ?? "cmf/portal-token-oob",
  tokenDbName: process.env.CMF_SQL_DB_TARGET ?? "CriticalManufacturing",
};

/** The committed env-default profiles for the two built-in connections. Any
 *  other connection is resolved from the DB cache. */
export const CMF_DB_PROFILES: Record<"source" | "target", CmfDbProfile> = {
  source: SOURCE,
  target: TARGET,
};

/** The built-in default DB keys (always resolvable without the DB). */
export const CMF_DB_KEYS: CmfDbKey[] = ["source", "target"];

/** True if `key` names a KNOWN CMF database — a built-in (source/target) or an
 *  admin-managed connection currently in the cache. Used to validate untrusted
 *  input (request headers, saved prefs) before selecting a database. */
export function isCmfDbKey(key: string): boolean {
  if (!key) return false;
  if (key === "source" || key === "target") return true;
  return getCachedProfile(key) !== undefined;
}

/**
 * Resolve a profile by key. Throws on an unknown key.
 *
 * Prefers the admin-managed connection row (loaded into an in-memory cache from
 * the `cmf_connections` table by connection-store), and falls back to the
 * committed env-default profile below whenever the cache has no row for this key
 * yet (cold start, missing row) — so behaviour is identical to the pre-DB config
 * until an admin edits a connection. A stale cache is refreshed in the
 * background; this call never blocks on the DB.
 */
export function profileFor(key: string): CmfDbProfile {
  const cached = getCachedProfile(key);
  void ensureConnectionsFresh();
  const p = cached ?? (CMF_DB_PROFILES as Record<string, CmfDbProfile | undefined>)[key];
  if (!p) {
    throw new Error(`Unknown CMF database "${key}" — no connection row is loaded and it is not a built-in default.`);
  }
  return p;
}
