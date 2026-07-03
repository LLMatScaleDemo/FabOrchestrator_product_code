/**
 * MCP Registry single connector.
 * PATCH: edit a connector — changes propagate to every role/user it's assigned to.
 * DELETE: remove a connector + all its assignments.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getIpAddress } from '@/lib/auth-middleware';
import { recordAuditLogDirect } from '@/lib/services/audit-service';
import prisma from '@/lib/db';
import { encrypt } from '@/lib/encryption';

const AUTH_TYPES = ['none', 'api_key', 'oauth'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const existing = await prisma.mcpRegistry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });

    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    let name = existing.displayName;
    let url = existing.serverUrl;
    let at = existing.authType;

    if (body.displayName !== undefined) { name = String(body.displayName).trim(); data.displayName = name; }
    if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
    if (body.serverUrl !== undefined) {
      url = String(body.serverUrl).trim();
      try { new URL(url); } catch { return NextResponse.json({ error: 'Invalid server URL' }, { status: 400 }); }
      data.serverUrl = url;
    }
    if (body.authType !== undefined) { at = AUTH_TYPES.includes(body.authType) ? body.authType : 'none'; data.authType = at; }
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    // Re-encrypt credentials only when a new key is supplied; clear when switching away from api_key.
    let credsChanged = false;
    let newCreds: string | null = existing.authCredentialsEncrypted;
    if (at !== 'api_key') { if (existing.authCredentialsEncrypted) { data.authCredentialsEncrypted = null; newCreds = null; credsChanged = true; } }
    else if (body.apiKey) { newCreds = encrypt(JSON.stringify({ apiKey: body.apiKey })); data.authCredentialsEncrypted = newCreds; credsChanged = true; }

    // Uniqueness guard (exclude self).
    if (data.displayName || data.serverUrl) {
      const dupe = await prisma.mcpRegistry.findFirst({
        where: {
          id: { not: id },
          OR: [{ serverUrl: url }, { displayName: { equals: name, mode: 'insensitive' } }],
        },
      });
      if (dupe) {
        return NextResponse.json(
          { error: dupe.serverUrl === url ? 'A connector with this URL already exists' : 'A connector with this name already exists' },
          { status: 409 }
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.mcpRegistry.update({ where: { id }, data });

      // Propagate to every assignment (role + user) derived from this connector.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propagate: any = { name, serverUrl: url, authType: at };
      if (credsChanged) propagate.authCredentialsEncrypted = newCreds;
      await tx.mcpConnection.updateMany({ where: { registryId: id }, data: propagate });

      await recordAuditLogDirect(tx, {
        userId: auth.user.id,
        action: 'mcp.connector_updated',
        targetType: 'McpRegistry',
        targetId: id,
        metadata: { displayName: name, serverUrl: url, fields: Object.keys(data) },
        ipAddress: getIpAddress(req),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update MCP connector error:', error);
    return NextResponse.json({ error: 'Failed to update connector' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const existing = await prisma.mcpRegistry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      // Remove all assignments derived from this connector, then the connector itself.
      const removed = await tx.mcpConnection.deleteMany({ where: { registryId: id } });
      await tx.mcpRegistry.delete({ where: { id } });
      await recordAuditLogDirect(tx, {
        userId: auth.user.id,
        action: 'mcp.connector_deleted',
        targetType: 'McpRegistry',
        targetId: id,
        metadata: { displayName: existing.displayName, serverUrl: existing.serverUrl, assignmentsRemoved: removed.count },
        ipAddress: getIpAddress(req),
      });
      return removed.count;
    });

    return NextResponse.json({ success: true, assignmentsRemoved: result });
  } catch (error) {
    console.error('Delete MCP connector error:', error);
    return NextResponse.json({ error: 'Failed to delete connector' }, { status: 500 });
  }
}
