import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_DB_KEY, type CmfDbKey } from "@/lib/cmf/db-registry";

/**
 * Request-scoped "which CMF database" selector.
 *
 * The app talks to two CMF databases (source = Entegris/KSP, target = OOB). A
 * single chat turn can EXPORT from one and LOAD into the other, so "which DB" is
 * per-operation, not per-process. Rather than thread a `dbKey` parameter through
 * the ~6-level export/load call chains (error-prone: one un-threaded intermediate
 * silently falls back to the default), we carry it in an AsyncLocalStorage store.
 *
 * The leaf connection primitives (cmfQuery, getMesToken, baseUrl) and the
 * per-DB caches call `currentDbKey()` to resolve the active database. When no
 * store is set — any code path not wrapped in `runWithCmfDb`, e.g. a background
 * job or the legacy single-DB path — it falls back to DEFAULT_DB_KEY (source),
 * which is byte-for-byte the app's previous single-DB behaviour.
 *
 * AsyncLocalStorage propagates across await / Promise.all / timers / the undici
 * fetch stack (Node ≥16), so a store entered at the tool boundary is inherited
 * by every descendant CMF call.
 */

type CmfDbStore = { dbKey: CmfDbKey };

const als = new AsyncLocalStorage<CmfDbStore>();

/** Run `fn` with `dbKey` as the active CMF database for all nested CMF calls. */
export function runWithCmfDb<T>(dbKey: CmfDbKey, fn: () => Promise<T>): Promise<T> {
  return als.run({ dbKey }, fn);
}

/** The active CMF database key for the current async context (DEFAULT when unset). */
export function currentDbKey(): CmfDbKey {
  return als.getStore()?.dbKey ?? DEFAULT_DB_KEY;
}
