/**
 * Live list of schedulable dashboards (Phase 2).
 *
 * Scheduling is no longer limited to the 7 curated dashboards: an admin can now
 * create + pin ANY dashboard in Fab Orch, and each pinned dashboard should be
 * schedulable from the admin chat. The source of truth is the shared
 * `pinned_dashboards` table (owned by Fab Orch) — the admin app reads it via raw
 * SQL, the same way it reads the other shared FabInsight tables.
 *
 * A schedule keys on (dashboard_id, source_key). Custom dashboards have a unique
 * dashboard_id (one pin each); the 7 recipes may back several pins that share an
 * id, so scheduling one recipe id refreshes all of its pins.
 */
import prisma from "@/lib/db";
import { REPORT_DASHBOARDS } from "@/lib/report-schedule";

export type SchedulableDashboard = {
  id: string; // dashboard_id (the schedule key)
  label: string; // friendly name — custom → pin title, recipe → curated label
  kind: string; // "custom" | "recipe"
  sourceKey: string;
  scheduled: boolean; // already has a report_schedules row
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Every dashboard the admin can schedule = whatever is pinned to Recent Reports,
 * with a flag for whether it already has a schedule. Empty when nothing is
 * pinned yet.
 */
export async function getSchedulableDashboards(): Promise<SchedulableDashboard[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ dashboard_id: string; title: string; kind: string; source_key: string; scheduled: boolean }>
  >(
    `SELECT p.dashboard_id,
            MIN(p.title) AS title,
            MIN(p.kind)  AS kind,
            p.source_key,
            bool_or(s.dashboard_id IS NOT NULL) AS scheduled
       FROM pinned_dashboards p
       LEFT JOIN report_schedules s
         ON s.dashboard_id = p.dashboard_id AND s.source_key = p.source_key
      GROUP BY p.dashboard_id, p.source_key
      ORDER BY MIN(p.title)`,
  );
  return rows.map((r) => ({
    id: r.dashboard_id,
    label:
      r.kind === "custom"
        ? r.title
        : REPORT_DASHBOARDS.find((d) => d.id === r.dashboard_id)?.label ?? r.title,
    kind: r.kind,
    sourceKey: r.source_key,
    scheduled: !!r.scheduled,
  }));
}

/** Resolve a user-supplied name/id (or "all") against the live list → dashboard ids. */
export function resolveAgainst(list: SchedulableDashboard[], input: string | string[]): string[] {
  const items = Array.isArray(input) ? input : [input];
  if (items.some((d) => norm(d) === "all")) return [...new Set(list.map((d) => d.id))];
  const ids: string[] = [];
  for (const raw of items) {
    const n = norm(raw);
    if (!n) continue;
    const hit =
      list.find((d) => norm(d.id) === n || norm(d.label) === n) ??
      list.find((d) => (n.length > 2 && norm(d.label).includes(n)) || norm(d.id).includes(n));
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}
