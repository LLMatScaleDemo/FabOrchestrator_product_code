import { NextRequest, NextResponse } from 'next/server';

import { fabQuery, fabViewDetails, FabQueryError } from '@/lib/fabinsight/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Development-only introspection helper for authoring the FabInsight dashboard
 * SQL: returns curated-view column lists, or runs an ad-hoc SELECT so a query
 * can be checked against live data before it is baked into `dashboards.ts`.
 *
 * Disabled outside development — it would otherwise be an unauthenticated
 * arbitrary-SELECT endpoint.
 *
 *   GET  /api/fabinsight/schema?views=vw_LossPareto,vw_Resources
 *   POST /api/fabinsight/schema   { "sql": "SELECT TOP 5 * FROM ..." }
 */
function guard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const views = (request.nextUrl.searchParams.get('views') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    const details = await fabViewDetails(views);
    return NextResponse.json({ views, details });
  } catch (err) {
    const detail = err instanceof FabQueryError ? err.detail : String(err);
    return NextResponse.json({ error: String(err), detail }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as
    | { sql?: string; limit?: number }
    | null;
  const sql = body?.sql?.trim();
  if (!sql) {
    return NextResponse.json({ error: 'Provide { sql }' }, { status: 400 });
  }

  const started = Date.now();
  try {
    const rows = await fabQuery(sql, body?.limit ?? 50);
    return NextResponse.json({ ms: Date.now() - started, rowCount: rows.length, rows });
  } catch (err) {
    const detail = err instanceof FabQueryError ? err.detail : String(err);
    return NextResponse.json(
      { ms: Date.now() - started, error: String(err), detail },
      { status: 502 },
    );
  }
}
