/**
 * DB-backed CMF connection cache.
 *
 * The admin app manages CMF database connections in the `cmf_connections` table.
 * The hot paths here (profileFor → cmf-sql.buildConfig, cmf-auth) are synchronous
 * and are called on nearly every CMF request, so we CANNOT await the DB per call.
 * Instead we keep an in-memory cache of the connection rows, refreshed lazily in
 * the background (TTL) and on boot. `getCachedProfile` is a pure synchronous read;
 * `profileFor` (db-registry) falls back to the committed env-default profile
 * whenever the cache has no row yet, so behaviour is unchanged until an admin
 * edits a connection and the cache warms.
 *
 * Only TYPE imports come from db-registry (erased at compile time), so there is
 * no runtime import cycle even though db-registry imports this module.
 */

import type { CmfDbProfile } from "@/lib/cmf/db-registry";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";

const TTL_MS = Math.max(5_000, Number(process.env.CMF_CONN_CACHE_TTL_MS ?? "60000"));

const cache = new Map<string, CmfDbProfile>();
let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** host_resolver is stored as a JSONB array of [host, ip] pairs. Be tolerant of
 *  malformed data — a bad resolver must not break the whole connection. */
function parseResolver(raw: unknown): Array<[string, string]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, string]> = [];
  for (const pair of raw) {
    if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
      out.push([pair[0], pair[1]]);
    }
  }
  return out;
}

/** Decrypt a stored SQL password; on any failure return undefined so the caller
 *  falls back to the env var rather than crashing on a bad ciphertext. */
function safeDecrypt(enc: string | null): string | undefined {
  if (!enc) return undefined;
  try {
    return decrypt(enc);
  } catch (e) {
    console.error("[cmf-connection-store] failed to decrypt a stored SQL password — falling back to env var", e);
    return undefined;
  }
}

async function reload(): Promise<void> {
  const rows = await prisma.cmfConnection.findMany({ where: { enabled: true } });
  const next = new Map<string, CmfDbProfile>();
  for (const row of rows) {
    // Cache EVERY enabled connection by its db_key — the toggle and db-key
    // resolution are now dynamic, so any admin-created connection is usable.
    next.set(row.dbKey, {
      id: row.dbKey,
      label: row.label,
      sql: {
        server: row.sqlServer,
        database: row.sqlDatabase,
        instanceName: row.sqlInstance ?? undefined,
        user: row.sqlUser,
        passwordEnv: row.passwordEnv ?? "",
        password: safeDecrypt(row.sqlPasswordEncrypted),
      },
      baseUrl: row.baseUrl,
      hostResolver: parseResolver(row.hostResolver),
      tokenSecretId: row.tokenSecretId ?? "",
      tokenDbName: row.tokenDbName,
    });
  }
  // Atomic-ish swap: only replace the cache once the whole load succeeded.
  cache.clear();
  for (const [k, v] of next) cache.set(k, v);
  loadedAt = Date.now();
}

/**
 * Trigger a background refresh if the cache is stale. Never throws and never
 * blocks the caller — a failed reload just leaves the previous cache in place
 * (or an empty cache, in which case profileFor uses env defaults).
 */
export function ensureConnectionsFresh(): Promise<void> {
  if (inflight) return inflight;
  if (Date.now() - loadedAt < TTL_MS && loadedAt > 0) return Promise.resolve();
  inflight = reload()
    .catch((e) => {
      console.error("[cmf-connection-store] reload failed — keeping previous cache / env defaults", e);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Synchronous read of the cached profile for a key, or undefined if not loaded. */
export function getCachedProfile(key: string): CmfDbProfile | undefined {
  return cache.get(key);
}

/** All host→IP pairs from the cached (admin-managed) connections, so the undici
 *  DNS resolver can reach a newly-added connection's on-prem host without DNS. */
export function cachedHostResolverPairs(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const p of cache.values()) for (const pair of p.hostResolver) out.push(pair);
  return out;
}

/** Force an immediate reload (used at boot / after an admin edit if desired). */
export async function refreshConnections(): Promise<void> {
  loadedAt = 0;
  await ensureConnectionsFresh();
}

// Warm the cache once at module load so the first CMF request is already
// DB-backed. Fire-and-forget; failures fall back to env defaults.
void ensureConnectionsFresh();
