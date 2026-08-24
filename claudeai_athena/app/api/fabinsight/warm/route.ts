import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth-middleware';
import { fabQuery, isLinkWarm } from '@/lib/fabinsight/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Warm-up ping for the manufacturing warehouse link.
 *
 * The MCP server behind the curated dashboards sits on a Lambda + VPN hop that
 * answers 503 for the first 30-60s from cold, then responds in ~1-4s. The chat
 * UI calls this on mount so the first curated prompt of a session lands on a
 * warm link instead of paying that wait mid-conversation.
 *
 * Fire-and-forget by design: it returns immediately and never reports failure,
 * because the real request retries the cold start on its own.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (isLinkWarm()) return NextResponse.json({ warm: true });

  void fabQuery('SELECT 1 AS ok', 1).catch(() => {});
  return NextResponse.json({ warm: false, warming: true });
}
