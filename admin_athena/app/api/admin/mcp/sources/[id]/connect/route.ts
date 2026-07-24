/**
 * On-the-Fly MCP — Step 2: test connectivity + discover schema. Thin wrapper over
 * the shared service (lib/mcp-onthefly/service.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getIpAddress } from '@/lib/auth-middleware';
import { connectDataSource } from '@/lib/mcp-onthefly/service';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const r = await connectDataSource(id, auth.user.id, getIpAddress(req) || 'api');
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.httpStatus });
  return NextResponse.json({ reachable: true, latencyMs: r.latencyMs, tableCount: r.tableCount, tables: r.tables });
}
