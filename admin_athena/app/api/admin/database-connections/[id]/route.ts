import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth-middleware";
import prisma from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encryption";
import { provisionConnectionLambda, deprovisionConnectionLambda } from "@/lib/cmf-lambda/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Update / delete a single CMF database connection (cmf_connections). db_key is
 * immutable (it's the stable identity Fab Orch selects by). Password is
 * write-only: send a non-empty `password` to (re)store it encrypted, send the
 * empty string / omit it to leave the stored one untouched. Admin-gated + audited.
 */

/** Derive the host→IP mapping from the base URL host + server IP (auto). */
function deriveResolver(baseUrl: string, server: string): Array<[string, string]> {
  try {
    const host = new URL(baseUrl).host;
    return host && server ? [[host, server]] : [];
  } catch {
    return [];
  }
}

/**
 * Return the connection's decrypted SQL + portal passwords so the admin Edit
 * dialog can pre-fill (and reveal) them. Admin-gated + audited. Only the edit
 * dialog calls this — the list endpoint still returns just a `hasPassword` flag.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT sql_password_encrypted, portal_password_encrypted FROM cmf_connections WHERE id = $1`,
      id,
    )) as Array<{ sql_password_encrypted: string | null; portal_password_encrypted: string | null }>;
    if (!rows.length) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    const r = rows[0];
    let sqlPassword = "";
    let portalPassword = "";
    try { if (r.sql_password_encrypted) sqlPassword = decrypt(r.sql_password_encrypted); } catch { /* leave blank on decrypt failure */ }
    try { if (r.portal_password_encrypted) portalPassword = decrypt(r.portal_password_encrypted); } catch { /* leave blank */ }

    prisma.auditLog
      .create({
        data: {
          userId: auth.user.id,
          action: "cmf_connection.reveal",
          targetType: "CmfConnection",
          targetId: id,
          metadata: {},
        },
      })
      .catch(() => {});

    return NextResponse.json({ sqlPassword, portalPassword });
  } catch (e) {
    console.error("[api/admin/database-connections/[id]] GET failed", e);
    return NextResponse.json({ error: "Could not load the connection." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const label = String(b.label ?? "").trim();
    const sqlServer = String(b.sqlServer ?? "").trim();
    const sqlDatabase = String(b.sqlDatabase ?? "").trim();
    const sqlUser = String(b.sqlUser ?? "").trim();
    const baseUrl = String(b.baseUrl ?? "").trim();
    // Token DB name = database name (auto). Host→IP derived from base URL + server.
    const tokenDbName = sqlDatabase;

    const missing = [
      ["label", label],
      ["sqlServer", sqlServer],
      ["sqlDatabase", sqlDatabase],
      ["sqlUser", sqlUser],
      ["baseUrl", baseUrl],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      return NextResponse.json({ error: `Missing required field(s): ${missing.join(", ")}.` }, { status: 400 });
    }

    const password = typeof b.password === "string" ? b.password : "";
    const resolver = deriveResolver(baseUrl, sqlServer);
    const sqlInstance = typeof b.sqlInstance === "string" && b.sqlInstance.trim() ? b.sqlInstance.trim() : null;
    const engine = typeof b.engine === "string" && b.engine.trim() ? b.engine.trim() : "mssql";
    const enabled = b.enabled === undefined ? true : !!b.enabled;

    // Passwords are optional on edit: only overwrite the ciphertext when a new
    // one is supplied. COALESCE keeps the existing value when we pass NULL.
    const newEncrypted = password ? encrypt(password) : null;
    const portalUser = typeof b.portalUser === "string" && b.portalUser.trim() ? b.portalUser.trim() : null;
    const portalPassword = typeof b.portalPassword === "string" ? b.portalPassword : "";
    const newPortalEncrypted = portalPassword ? encrypt(portalPassword) : null;

    const affected = await prisma.$executeRawUnsafe(
      `UPDATE cmf_connections SET
         label = $1,
         engine = $2,
         sql_server = $3,
         sql_instance = $4,
         sql_database = $5,
         sql_user = $6,
         sql_password_encrypted = COALESCE($7, sql_password_encrypted),
         base_url = $8,
         host_resolver = $9::jsonb,
         token_db_name = $10,
         portal_user = $11,
         portal_password_encrypted = COALESCE($12, portal_password_encrypted),
         enabled = $13,
         updated_at = now()
       WHERE id = $14`,
      label,
      engine,
      sqlServer,
      sqlInstance,
      sqlDatabase,
      sqlUser,
      newEncrypted,
      baseUrl,
      JSON.stringify(resolver),
      tokenDbName,
      portalUser,
      newPortalEncrypted,
      enabled,
      id,
    );

    if (!affected) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }

    // Re-provision (idempotent) so the Lambda's env stays in sync with the edited
    // connection. Uses the effective portal password: the just-supplied one, else
    // the stored (decrypted) one. Best-effort — never fails the save.
    let provisionWarning: string | undefined;
    try {
      const row = (await prisma.$queryRawUnsafe(
        `SELECT db_key, base_url, host_resolver, token_db_name, token_secret_id,
                portal_user, portal_password_encrypted, lambda_arn, schedule_name
           FROM cmf_connections WHERE id = $1`,
        id,
      )) as Array<{
        db_key: string; base_url: string; host_resolver: unknown; token_db_name: string;
        token_secret_id: string | null; portal_user: string | null; portal_password_encrypted: string | null;
        lambda_arn: string | null; schedule_name: string | null;
      }>;
      const r = row[0];
      const effectivePortalPassword = portalPassword
        ? portalPassword
        : r?.portal_password_encrypted
          ? decrypt(r.portal_password_encrypted)
          : "";
      if (r?.portal_user && effectivePortalPassword) {
        // Reuse the already-provisioned Lambda name (from lambda_arn) so we UPDATE
        // it rather than creating a duplicate under a different naming convention.
        const existingFunctionName = r.lambda_arn ? r.lambda_arn.split(":function:")[1] || null : null;
        const { lambdaArn, scheduleName } = await provisionConnectionLambda({
          dbKey: r.db_key,
          baseUrl: r.base_url,
          portalUser: r.portal_user,
          portalPassword: effectivePortalPassword,
          hostResolver: Array.isArray(r.host_resolver) ? (r.host_resolver as Array<[string, string]>) : [],
          tokenDbName: r.token_db_name,
          tokenSecretId: r.token_secret_id,
          existingFunctionName,
          existingScheduleName: r.schedule_name,
        });
        await prisma.$executeRawUnsafe(
          `UPDATE cmf_connections SET lambda_arn = $1, schedule_name = $2, updated_at = now() WHERE id = $3`,
          lambdaArn,
          scheduleName,
          id,
        );
      }
    } catch (e) {
      provisionWarning = `Saved, but re-provisioning the token Lambda failed: ${
        e instanceof Error ? e.message : String(e)
      }.`;
      console.error("[api/admin/database-connections/[id]] re-provision failed", e);
    }

    prisma.auditLog
      .create({
        data: {
          userId: auth.user.id,
          action: "cmf_connection.update",
          targetType: "CmfConnection",
          targetId: id,
          metadata: { label, sqlServer, sqlDatabase, baseUrl, tokenDbName, passwordChanged: !!newEncrypted, portalPasswordChanged: !!newPortalEncrypted, enabled },
        },
      })
      .catch(() => {});

    return NextResponse.json({ success: true, warning: provisionWarning });
  } catch (e) {
    console.error("[api/admin/database-connections/[id]] PATCH failed", e);
    return NextResponse.json({ error: "Could not update the connection." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    // Look up the key first so we can tear down its Lambda + schedule.
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT db_key FROM cmf_connections WHERE id = $1`,
      id,
    )) as Array<{ db_key: string }>;
    const dbKey = rows[0]?.db_key;
    if (!dbKey) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }

    // Deprovision the token Lambda + schedule (best-effort; ignores NotFound).
    await deprovisionConnectionLambda(dbKey).catch((e) =>
      console.error("[api/admin/database-connections/[id]] deprovision failed", e),
    );

    const affected = await prisma.$executeRawUnsafe(`DELETE FROM cmf_connections WHERE id = $1`, id);
    if (!affected) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    prisma.auditLog
      .create({
        data: {
          userId: auth.user.id,
          action: "cmf_connection.delete",
          targetType: "CmfConnection",
          targetId: id,
          metadata: {},
        },
      })
      .catch(() => {});
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[api/admin/database-connections/[id]] DELETE failed", e);
    return NextResponse.json({ error: "Could not delete the connection." }, { status: 500 });
  }
}
