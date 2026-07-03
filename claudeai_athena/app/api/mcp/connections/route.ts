import { NextRequest, NextResponse } from 'next/server';
import { createMcpConnection, getUserMcpConnections } from '@/lib/storage';
import { encrypt } from '@/lib/encryption';
import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/errors/api-error-handler';
import { applyRowCap } from '@/lib/errors/row-cap';
import { FabOrchError } from '@/lib/errors/faborch-errors';
import { ALLOWED_MCP_AUTH_TYPES } from '@/lib/errors/parameter-values';

// GET /api/mcp/connections - List user's personal MCPs + role-level MCPs
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const userWithRole = await prisma.user.findUnique({
      where: { id: user.id },
      include: { role: true },
    });

    // Personal MCPs (owned by this user)
    const personalConnections = await getUserMcpConnections(user.id);
    const personal = personalConnections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      serverUrl: conn.serverUrl,
      authType: conn.authType,
      status: conn.status,
      lastError: conn.lastError,
      isActive: conn.isActive,
      availableTools: conn.availableTools,
      lastConnectedAt: conn.lastConnectedAt?.toISOString() || null,
      source: 'personal',
      canDelete: true,
    }));

    // Role-level MCPs (assigned by admin to user's role)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let roleMcps: any[] = [];
    if (userWithRole?.roleId) {
      const roleConnections = await prisma.mcpConnection.findMany({
        where: { roleId: userWithRole.roleId, userId: null, isActive: true },
      });
      roleMcps = roleConnections.map((conn) => ({
        id: conn.id,
        name: conn.name,
        serverUrl: conn.serverUrl,
        authType: conn.authType,
        status: 'connected',  // Role MCPs are always active
        lastError: null,
        isActive: true,        // Always enabled for the role
        availableTools: conn.availableTools as unknown[],
        lastConnectedAt: conn.lastConnectedAt?.toISOString() || null,
        source: 'role',
        canDelete: false,
      }));
    }

    const all = [...personal, ...roleMcps];
    const { rows, warning } = applyRowCap(all);
    if (warning) {
      return NextResponse.json(rows, {
        headers: {
          'X-FabOrch-Warning': warning.type,
          'X-FabOrch-Warning-Message': warning.userMessage,
        },
      });
    }
    return NextResponse.json(rows);
  } catch (error) {
    return handleApiError(error, req, {
      route: '/api/mcp/connections',
      userId: user.id,
    });
  }
}

// POST /api/mcp/connections - Create a new personal MCP connection
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    // Check role permissions
    const userWithRole = await prisma.user.findUnique({
      where: { id: user.id },
      include: { role: true },
    });

    if (userWithRole?.role) {
      if (!userWithRole.role.personalMcpEnabled) {
        return NextResponse.json(
          { error: 'Your role does not allow personal MCP connections.' },
          { status: 403 }
        );
      }
      const currentCount = await prisma.mcpConnection.count({ where: { userId: user.id } });
      if (currentCount >= userWithRole.role.personalMcpMaxCount) {
        return NextResponse.json(
          { error: `Maximum ${userWithRole.role.personalMcpMaxCount} personal MCP connections reached.` },
          { status: 403 }
        );
      }
    }

    const body = await req.json();
    const { name, serverUrl, authType, oauthClientId, oauthClientSecret, apiKey } = body;

    if (!name) throw FabOrchError.missingFilter({ parameter: 'name' }, 'A connection name is required.');
    if (!serverUrl) throw FabOrchError.missingFilter({ parameter: 'serverUrl' }, 'A server URL is required.');

    try { new URL(serverUrl); } catch {
      throw FabOrchError.invalidParameter('serverUrl', undefined, undefined, { badValue: serverUrl });
    }

    if (authType && !ALLOWED_MCP_AUTH_TYPES.includes(authType)) {
      throw FabOrchError.invalidParameter('authType', ALLOWED_MCP_AUTH_TYPES, undefined, { badValue: authType });
    }

    let encryptedCredentials: string | undefined;
    if (authType === 'oauth' && oauthClientId && oauthClientSecret) {
      encryptedCredentials = encrypt(JSON.stringify({ clientId: oauthClientId, clientSecret: oauthClientSecret }));
    } else if (authType === 'api_key' && apiKey) {
      encryptedCredentials = encrypt(JSON.stringify({ apiKey }));
    }

    const connection = await createMcpConnection({
      userId: user.id,
      name,
      serverUrl,
      authType: authType || 'none',
      authCredentialsEncrypted: encryptedCredentials,
    });

    return NextResponse.json({
      id: connection.id,
      name: connection.name,
      serverUrl: connection.serverUrl,
      authType: connection.authType,
      status: connection.status,
      isActive: connection.isActive,
      source: 'personal',
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req, {
      route: '/api/mcp/connections',
      userId: user.id,
    });
  }
}
