import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/cmf/session";
import { prisma } from "@/lib/db";
import { CMF_DB_PROFILES } from "@/lib/cmf/db-registry";
import { getUserCmfAccess } from "@/lib/cmf/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the selectable CMF databases for the `CmfDatabaseToggle`.
 *
 * Returns the ENABLED admin-managed connections (`cmf_connections`) as
 * `{ key, label }`. This is what makes the toggle DYNAMIC — a connection added
 * in the admin app appears here automatically. If the table is empty/unreadable
 * we fall back to the two committed built-ins so the toggle always works.
 */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fallback = [
    { key: "source", label: CMF_DB_PROFILES.source.label },
    { key: "target", label: CMF_DB_PROFILES.target.label },
  ];

  // The user only sees the connections they've been granted (admins see all).
  const access = await getUserCmfAccess(userId);
  const allowed = (list: { key: string; label: string }[]) =>
    access.all ? list : list.filter((c) => access.keys.has(c.key));

  try {
    const rows = await prisma.cmfConnection.findMany({
      where: { enabled: true },
      select: { dbKey: true, label: true },
      orderBy: { dbKey: "asc" },
    });
    const connections = rows.map((r) => ({ key: r.dbKey, label: r.label }));
    // Fall back to built-ins only when the table itself is empty (never to widen
    // access — the fallback is filtered by grants too).
    return NextResponse.json({ connections: allowed(connections.length ? connections : fallback) });
  } catch (e) {
    console.error("[api/cmf/connections] list failed — using built-in defaults", e);
    return NextResponse.json({ connections: allowed(fallback) });
  }
}
