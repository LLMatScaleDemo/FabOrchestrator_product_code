import { prisma } from "@/lib/db";
import type { MasterDataPackage } from "@/lib/cmf/types";

export function getPackageByCmfId(cmfId: string) {
  return prisma.package.findUnique({ where: { cmfId } });
}

export function listPackages(take = 100) {
  return prisma.package.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Insert or update our local mirror of a CMF MasterDataPackage. Keyed on
 * cmfId. On update we refresh display fields but never reassign the original
 * owner.
 */
export function upsertPackageFromCmf(
  instance: MasterDataPackage,
  userId: string,
) {
  const file = instance.Package;
  const sizeStr = String(file?.Size ?? "0");
  const sizeBytes = BigInt(Number.parseInt(sizeStr, 10) || 0);

  return prisma.package.upsert({
    where: { cmfId: instance.Id },
    create: {
      cmfId: instance.Id,
      name: instance.Name,
      filename: file?.Filename ?? "",
      checksum: file?.Checksum ?? "",
      sizeBytes,
      contentType: file?.ContentType ?? "application/octet-stream",
      createdByUserId: userId,
    },
    update: {
      name: instance.Name,
      filename: file?.Filename ?? "",
      checksum: file?.Checksum ?? "",
      sizeBytes,
      contentType: file?.ContentType ?? "application/octet-stream",
    },
  });
}

export type PackageRow = {
  id: string;
  cmfId: string;
  name: string;
  createdAt: string;
  owner: string;
  lastResult: number | null;
  lastOperation: "VALIDATE" | "LOAD" | null;
  lastRunAt: string | null;
};

export type PackageSummary = {
  pkg: {
    id: string;
    cmfId: string;
    name: string;
    filename: string;
    checksum: string;
    sizeBytes: string;
    contentType: string;
    owner: string;
    createdAt: string;
    lastResult: number | null;
    lastOperation: "VALIDATE" | "LOAD" | null;
    lastRunAt: string | null;
  };
  latestValidation: {
    ok: boolean;
    errorCount: number;
    warningCount: number;
    createdAt: string;
  } | null;
  runs: {
    id: string;
    operation: "VALIDATE" | "LOAD";
    status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE" | "EXPIRED";
    result: number | null;
    error: string | null;
    startedAt: string;
    endedAt: string | null;
    user: string;
    /** Totals across all object types in this run's execution log. */
    created: number;
    updated: number;
    skipped: number;
    /** Per-object-type breakdown. */
    entries: { name: string; created: number; updated: number; skipped: number }[];
  }[];
  audit: { id: string; action: string; createdAt: string; user: string }[];
};

/** Extract created/updated/skipped from a stored CMF execution log (Json). */
function logCounts(log: unknown): {
  created: number;
  updated: number;
  skipped: number;
  entries: { name: string; created: number; updated: number; skipped: number }[];
} {
  const arr = Array.isArray(log)
    ? log
    : log && typeof log === "object" && Array.isArray((log as { Entries?: unknown }).Entries)
      ? ((log as { Entries: unknown[] }).Entries)
      : [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const entries = (arr as Record<string, unknown>[]).map((e) => {
    const c = Number(e.CreatedObjectsCounter) || 0;
    const u = Number(e.UpdatedObjectsCounter) || 0;
    const s = Number(e.SkippedObjectsCounter) || 0;
    created += c;
    updated += u;
    skipped += s;
    return { name: String(e.Name ?? "—"), created: c, updated: u, skipped: s };
  });
  return { created, updated, skipped, entries };
}

/** Full read-only history for one package (by CMF id): meta + validation + runs + audit. */
export async function getPackageSummary(cmfId: string): Promise<PackageSummary | null> {
  const p = await prisma.package.findUnique({
    where: { cmfId },
    include: {
      createdBy: { select: { email: true } },
      runs: { orderBy: { startedAt: "desc" }, include: { user: { select: { email: true } } } },
      validationReports: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!p) return null;

  // Audit trail lives in the shared audit_logs table (action = "cmf.*"),
  // keyed to this package by targetType/targetId.
  const auditRows = await prisma.auditLog.findMany({
    where: { targetType: "Package", targetId: p.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { email: true } } },
  });

  const v = p.validationReports[0];
  return {
    pkg: {
      id: p.id,
      cmfId: p.cmfId,
      name: p.name,
      filename: p.filename,
      checksum: p.checksum,
      sizeBytes: p.sizeBytes.toString(),
      contentType: p.contentType,
      owner: p.createdBy?.email ?? "—",
      createdAt: p.createdAt.toISOString(),
      lastResult: p.lastResult,
      lastOperation: p.lastOperation,
      lastRunAt: p.lastRunAt ? p.lastRunAt.toISOString() : null,
    },
    latestValidation: v
      ? {
          ok: v.ok,
          errorCount: v.errorCount,
          warningCount: v.warningCount,
          createdAt: v.createdAt.toISOString(),
        }
      : null,
    runs: p.runs.map((r) => ({
      id: r.id,
      operation: r.operation,
      status: r.status,
      result: r.result,
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      user: r.user?.email ?? "—",
      ...logCounts(r.log),
    })),
    audit: auditRows.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
      user: a.user?.email ?? "—",
    })),
  };
}

export async function listPackagesWithOwner(take = 100): Promise<PackageRow[]> {
  const rows = await prisma.package.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { createdBy: { select: { email: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    cmfId: p.cmfId,
    name: p.name,
    createdAt: p.createdAt.toISOString(),
    owner: p.createdBy?.email ?? "—",
    lastResult: p.lastResult,
    lastOperation: p.lastOperation,
    lastRunAt: p.lastRunAt ? p.lastRunAt.toISOString() : null,
  }));
}
