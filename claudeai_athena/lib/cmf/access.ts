/**
 * Per-user CMF database access resolution.
 *
 * A user may only see/use the CMF connections granted to them. A grant lives in
 * `cmf_access` and is either direct (user_id) or inherited from the user's role
 * (role_id). Effective access = the UNION of both. Admins bypass entirely.
 *
 * This is the single source of truth the three enforcement points call:
 *   - app/api/cmf/connections (filter the toggle list)
 *   - lib/cmf/request-db (validate the loader's target DB)
 *   - app/api/modeling-agent/chat (validate export/load DB from the request body)
 *
 * Never trust a client-supplied dbKey — always intersect it with this set.
 */

import { prisma } from "@/lib/db";

export type CmfAccess = {
  /** Admin (or otherwise unrestricted) — may use every connection. */
  all: boolean;
  /** The specific db_keys this user may use (ignored when `all`). */
  keys: Set<string>;
};

/** Resolve a user's effective CMF access (union of user + role grants). Fails
 *  CLOSED (empty set) on any error so a fault can't widen access. */
export async function getUserCmfAccess(userId: string | null | undefined): Promise<CmfAccess> {
  if (!userId) return { all: false, keys: new Set() };
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, roleId: true },
    });
    if (!user) return { all: false, keys: new Set() };
    if (user.isAdmin) return { all: true, keys: new Set() };

    const grants = await prisma.cmfAccess.findMany({
      where: { OR: [{ userId }, ...(user.roleId ? [{ roleId: user.roleId }] : [])] },
      select: { dbKey: true },
    });
    return { all: false, keys: new Set(grants.map((g) => g.dbKey)) };
  } catch (e) {
    console.error("[cmf-access] getUserCmfAccess failed — denying access", e);
    return { all: false, keys: new Set() };
  }
}

/** Does this access set permit `dbKey`? */
export function accessAllows(access: CmfAccess, dbKey: string): boolean {
  return access.all || access.keys.has(dbKey);
}

/**
 * Pick a sensible DEFAULT db_key the user is actually allowed to use: the
 * requested `preferred` if granted, else `fallback` if granted, else the first
 * granted key, else `fallback` (admins/`all` → preferred/fallback unchanged).
 */
export function pickAllowedKey(access: CmfAccess, preferred: string, fallback: string): string {
  if (access.all) return preferred || fallback;
  if (preferred && access.keys.has(preferred)) return preferred;
  if (access.keys.has(fallback)) return fallback;
  const first = access.keys.values().next().value;
  return first ?? fallback;
}
