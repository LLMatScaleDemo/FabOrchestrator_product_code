/**
 * MCP Registry — the catalog of available MCP connectors.
 * GET: list all connectors (+ assignment counts)
 * POST: add a new connector (unique name + url)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getIpAddress } from '@/lib/auth-middleware';
import { recordAuditLogDirect } from '@/lib/services/audit-service';
import prisma from '@/lib/db';
import { encrypt } from '@/lib/encryption';

const AUTH_TYPES = ['none', 'api_key', 'oauth'];

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const servers = await prisma.mcpRegistry.findMany({ orderBy: { displayName: 'asc' } });
    // Count every connection pointing at each connector's server URL — this
    // includes role assignments, user assignments, AND users' personal
    // connections (which have no registry_id link). Matched by serverUrl,
    // the connector's natural key.
    const counts = await prisma.mcpConnection.groupBy({
      by: ['serverUrl'],
      _count: { _all: true },
    });
    const countByUrl = new Map(counts.map((c) => [c.serverUrl, c._count._all]));

    return NextResponse.json({
      servers: servers.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
        serverUrl: s.serverUrl,
        authType: s.authType,
        hasCredentials: !!s.authCredentialsEncrypted,
        isActive: s.isActive,
        assignmentCount: countByUrl.get(s.serverUrl) || 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (error) {
    console.error('List MCP registry error:', error);
    return NextResponse.json({ error: 'Failed to list connectors' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { displayName, serverUrl, authType, apiKey, description } = await req.json();
    const name = String(displayName || '').trim();
    const url = String(serverUrl || '').trim();

    if (!name || !url) {
      return NextResponse.json({ error: 'Name and server URL are required' }, { status: 400 });
    }
    try { new URL(url); } catch {
      return NextResponse.json({ error: 'Invalid server URL' }, { status: 400 });
    }
    const at = AUTH_TYPES.includes(authType) ? authType : 'none';

    // Uniqueness — no duplicate connectors (by URL or name).
    const dupe = await prisma.mcpRegistry.findFirst({
      where: { OR: [{ serverUrl: url }, { displayName: { equals: name, mode: 'insensitive' } }] },
    });
    if (dupe) {
      return NextResponse.json(
        { error: dupe.serverUrl === url ? 'A connector with this URL already exists' : 'A connector with this name already exists' },
        { status: 409 }
      );
    }

    const encryptedCreds = at === 'api_key' && apiKey ? encrypt(JSON.stringify({ apiKey })) : null;

    const server = await prisma.mcpRegistry.create({
      data: {
        displayName: name,
        description: description ? String(description).trim() : null,
        serverUrl: url,
        authType: at,
        authCredentialsEncrypted: encryptedCreds,
      },
    });

    await recordAuditLogDirect(prisma, {
      userId: auth.user.id,
      action: 'mcp.connector_created',
      targetType: 'McpRegistry',
      targetId: server.id,
      metadata: { displayName: name, serverUrl: url, authType: at },
      ipAddress: getIpAddress(req),
    });

    return NextResponse.json({ id: server.id, displayName: server.displayName }, { status: 201 });
  } catch (error) {
    console.error('Create MCP connector error:', error);
    return NextResponse.json({ error: 'Failed to create connector' }, { status: 500 });
  }
}
