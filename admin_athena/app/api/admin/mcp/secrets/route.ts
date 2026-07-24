/**
 * On-the-Fly MCP — Step 1: SECURE credentials intake (dedicated, NOT the chat path).
 *
 * The admin uploads a credentials document here (multipart file) or posts a JSON
 * body. Credentials are parsed in memory, validated, written to AWS Secrets
 * Manager, and the DB keeps only the ARN + non-secret metadata. The plaintext
 * never enters a conversation, the LLM, messages, or prompt_audit_logs.
 *
 * POST multipart/form-data: file=<creds doc>, name, engine?, schemas (csv or JSON)
 * POST application/json:     { name, engine?, schemas: string[], creds: {...} }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getIpAddress } from '@/lib/auth-middleware';
import { recordAuditLogDirect } from '@/lib/services/audit-service';
import prisma from '@/lib/db';
import { CredsDocSchema, IntakeMetaSchema } from '@/lib/mcp-onthefly/types';
import { parseCredsDocument, extractCredsText } from '@/lib/mcp-onthefly/parse-creds';
import { createTargetSecret } from '@/lib/mcp-onthefly/secrets';

function parseSchemas(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) { try { return JSON.parse(t); } catch { /* fall through */ } }
    return t.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  // 1) Extract meta + creds from either multipart or JSON. Creds stay in memory.
  let meta: { name: string; engine: string; schemas: string[] };
  let credsRaw: Record<string, unknown>;
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
      const filename = (file as File).name || 'creds.txt';
      credsRaw = parseCredsDocument(await extractCredsText(file, filename));
      meta = {
        name: String(form.get('name') || ''),
        engine: String(form.get('engine') || 'postgres'),
        schemas: parseSchemas(form.get('schemas')),
      };
    } else {
      const body = await req.json();
      meta = { name: body.name, engine: body.engine || 'postgres', schemas: parseSchemas(body.schemas) };
      credsRaw = typeof body.creds === 'string' ? parseCredsDocument(body.creds) : (body.creds || {});
    }
  } catch {
    return NextResponse.json({ error: 'Could not read the credentials input' }, { status: 400 });
  }

  // 2) Validate. Zod errors must not echo the secret value back.
  const metaParsed = IntakeMetaSchema.safeParse(meta);
  if (!metaParsed.success) {
    return NextResponse.json({ error: 'Invalid metadata', details: metaParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
  }
  const credsParsed = CredsDocSchema.safeParse(credsRaw);
  if (!credsParsed.success) {
    const missing = credsParsed.error.issues.map((i) => i.path.join('.'));
    // Report which field NAMES were recognized (never values) to aid diagnosis —
    // e.g. an unreadable/encoding-mangled file yields an empty foundFields.
    return NextResponse.json(
      { error: 'Credentials document is missing required fields', missingFields: missing, foundFields: Object.keys(credsRaw) },
      { status: 400 },
    );
  }
  const { name, engine, schemas } = metaParsed.data;
  const creds = credsParsed.data;

  // 3) Create the row first (need the id for the secret name/tag), then the secret.
  const row = await prisma.mcpDataSource.create({
    data: {
      name,
      engine,
      status: 'DRAFT',
      host: creds.host,
      port: creds.port,
      database: creds.database,
      schemasJson: schemas,
      createdById: auth.user.id,
    },
  });

  try {
    const secretArn = await createTargetSecret({ dataSourceId: row.id, name, creds });
    await prisma.mcpDataSource.update({ where: { id: row.id }, data: { secretArn } });
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[mcp_otf] createTargetSecret failed:', detail);
    await prisma.mcpDataSource.update({
      where: { id: row.id },
      data: { status: 'FAILED', lastError: detail },
    });
    // Surface the AWS error to the admin (no secret value is included in it).
    return NextResponse.json({ error: 'Failed to store credentials securely', detail }, { status: 502 });
  }

  await recordAuditLogDirect(prisma, {
    userId: auth.user.id,
    action: 'mcp_otf.source_created',
    targetType: 'McpDataSource',
    targetId: row.id,
    metadata: { name, engine, host: creds.host, database: creds.database, schemas },
    ipAddress: getIpAddress(req),
  });

  // 4) Return ONLY non-secret metadata.
  return NextResponse.json(
    { id: row.id, name, status: 'DRAFT', metadata: { engine, host: creds.host, port: creds.port, database: creds.database, schemas } },
    { status: 201 },
  );
}
