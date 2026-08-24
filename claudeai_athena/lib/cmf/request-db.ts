import type { NextRequest } from "next/server";

import { DEFAULT_DB_KEY, isCmfDbKey, type CmfDbKey } from "@/lib/cmf/db-registry";
import { prisma } from "@/lib/db";
import { getUserCmfAccess, pickAllowedKey } from "@/lib/cmf/access";

/**
 * Resolve which CMF database a Master Data Loader request targets.
 *
 * The loader wizard's REST routes (stage/register, validate, load, status,
 * package list) are standalone — unlike the chat tools, they don't receive a
 * `cmfDbs`/`loadDbKey` body. This resolves the active database for them so the
 * `CmfDatabaseToggle` on the loader page actually changes where the load lands.
 *
 * Priority:
 *   1. the explicit `x-cmf-db-key` request header — set by the loader's toggle
 *      via `cmfFetch`, so a just-flipped toggle takes effect immediately (before
 *      its async settings PATCH has landed);
 *   2. the user's saved preference (`preferences.cmfLoadDbKey`, or `cmfDb` when
 *      only the enabled flag is present);
 *   3. `source` — byte-for-byte the app's previous single-DB behaviour.
 */
export const CMF_DB_HEADER = "x-cmf-db-key";

export async function resolveCmfDbKey(
  request: NextRequest,
  userId?: string | null,
): Promise<CmfDbKey> {
  const candidate = await resolveCandidateKey(request, userId);
  // Enforce per-user access: if the resolved key isn't one the user is granted,
  // fall back to a key they ARE allowed to use (admins bypass via `all`).
  const access = await getUserCmfAccess(userId);
  return pickAllowedKey(access, candidate, DEFAULT_DB_KEY);
}

/** The raw key from header → saved preference → default, BEFORE access checks. */
async function resolveCandidateKey(
  request: NextRequest,
  userId?: string | null,
): Promise<CmfDbKey> {
  const header = request.headers.get(CMF_DB_HEADER);
  if (header) {
    // Built-ins are always valid without a DB round-trip.
    if (header === "source" || header === "target") return header;
    // A dynamic (admin-created) key: verify it's a real ENABLED connection
    // before trusting it to route a load — the in-memory cache can be a few
    // seconds behind a just-created connection, so check the DB directly.
    try {
      const row = await prisma.cmfConnection.findFirst({
        where: { dbKey: header, enabled: true },
        select: { dbKey: true },
      });
      if (row) return row.dbKey;
    } catch {
      /* fall through to prefs/default */
    }
  }

  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });
      const prefs = (user?.preferences ?? {}) as Record<string, unknown>;
      const loadKey = prefs.cmfLoadDbKey;
      if (typeof loadKey === "string" && isCmfDbKey(loadKey)) return loadKey;
      const cmfDb = prefs.cmfDb as Partial<Record<CmfDbKey, boolean>> | undefined;
      if (cmfDb?.target && !cmfDb?.source) return "target";
    } catch {
      /* preference read is best-effort — fall through to the default */
    }
  }

  return DEFAULT_DB_KEY;
}
