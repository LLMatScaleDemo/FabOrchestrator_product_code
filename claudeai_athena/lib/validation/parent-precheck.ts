import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRuleset } from "@/lib/validation/metadata";
import { isObjectRemoved } from "@/lib/validation/removal-policy";

/**
 * Parent-reference precheck. For every child object in `rowsByType`, look at
 * its mandatory FK columns (from CMF property metadata) and verify each
 * distinct value the child rows reference exists in one of:
 *   (a) the parent's live CMF table, OR
 *   (b) the same `rowsByType` payload (user is loading parent AND child in
 *       one file — CMF's atomic batch will accept this).
 *
 * A value that exists in neither is a warning: the Master Data Load section
 * will reject the file until the parent is added.
 *
 * System tables (no CMF metadata) and objects with no mandatory FKs are
 * silently skipped — nothing to check.
 */

const FK_QUERY_CAP = 5000;

export type ParentWarning = {
  objectType: string;
  parentType: string;
  fkColumn: string;
  /** Distinct parent-values present in child rows that we couldn't resolve. */
  missing: string[];
};

export type ParentPrecheckResult = {
  warnings: ParentWarning[];
  /**
   * True when CMF DB was reachable and the check ran authoritatively.
   * False when the DB was unavailable — the warnings list is then only
   * populated from in-file cross-checks and the caller must disclaim that
   * missing-parent claims aren't verified against live CMF data.
   */
  dbReachable: boolean;
};

export async function checkParentReferences(
  rowsByType: Record<string, Record<string, string>[]>,
): Promise<ParentPrecheckResult> {
  const warnings: ParentWarning[] = [];
  const dbCache = new Map<string, Set<string>>();
  let dbReachable = true;

  for (const [objectType, rows] of Object.entries(rowsByType)) {
    if (rows.length === 0) continue;
    if (isObjectRemoved(objectType)) continue;

    const ruleset = await loadRuleset(objectType);
    if (!ruleset) continue;

    for (const prop of ruleset.properties) {
      if (!prop.referenceTargetType) continue;
      // Check every FK column, not only mandatory ones. CMF marks most
      // logical parents as optional in metadata (e.g. Enterprise on Site),
      // but the moment the user supplies a value, that parent MUST resolve
      // at load time — otherwise CMF rejects the row.

      const parentType = prop.referenceTargetType;
      const fkColumn = prop.name;

      const values = new Set<string>();
      for (const row of rows) {
        const raw = row[fkColumn] ?? row[fkColumn.toLowerCase()] ?? "";
        const v = String(raw).trim();
        if (v) values.add(v);
      }
      if (values.size === 0) continue;

      let dbNames = dbCache.get(parentType);
      let dbLookupOk = true;
      if (!dbNames) {
        try {
          const parentRuleset = await loadRuleset(parentType);
          if (parentRuleset?.table) {
            const dbRows = await cmfQuery<{ Name: string }>(
              `select top ${FK_QUERY_CAP} Name from [${parentRuleset.table.schema}].[${parentRuleset.table.name}]`,
            );
            dbNames = new Set(dbRows.map((r) => String(r.Name)));
          } else {
            dbNames = new Set();
          }
        } catch {
          dbNames = new Set();
          dbLookupOk = false;
          dbReachable = false;
        }
        dbCache.set(parentType, dbNames);
      }

      const inFile = new Set<string>();
      for (const pr of rowsByType[parentType] ?? []) {
        const n = String(pr.Name ?? pr.name ?? "").trim();
        if (n) inFile.add(n);
      }

      // When DB is unreachable, we can only fault values that aren't in the
      // same file — anything else might exist in CMF, we just can't tell.
      const missing = [...values].filter((v) => {
        if (inFile.has(v)) return false;
        if (!dbLookupOk) return false;
        return !dbNames!.has(v);
      });
      if (missing.length > 0) {
        warnings.push({ objectType, parentType, fkColumn, missing });
      }
    }
  }

  return { warnings, dbReachable };
}
