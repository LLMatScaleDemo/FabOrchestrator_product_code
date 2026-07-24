import { parseWorkbook } from "@/lib/validation/xlsx";
import { loadRulesets, type EntityRuleset } from "@/lib/validation/metadata";
import { buildParentIndex } from "@/lib/validation/referential";
import { runRules } from "@/lib/validation/rule-engine";
import { runCrossChecks, type CrossCheckOptions } from "@/lib/validation/cross-check";
import type { ParsedSheet, ValidationError, ValidationResult } from "@/lib/validation/types";

/**
 * Deterministic pre-flight validation of an uploaded master-data file. Parses
 * the workbook, loads each object type's CMF-derived ruleset, resolves
 * parent/child key existence (file + CMF), and runs the rule engine. After
 * rules pass, layers on cross-checks that query CMF for richer pre-load
 * signals (existence, update vs no-op, dependent-sheet completeness,
 * parent-in-CMF notes). Optionally restrict to a subset of object types.
 */
export async function validateFile(
  bytes: ArrayBuffer | Buffer,
  restrictToTypes?: string[],
  crossCheckOpts?: CrossCheckOptions,
): Promise<ValidationResult> {
  const sheets = await parseWorkbook(bytes);
  return validatePreflightFromSheets(sheets, restrictToTypes, crossCheckOpts);
}

/**
 * Same as `validateFile` but accepts pre-parsed sheets — used by callers that
 * already streamed the workbook (e.g. the staging API, which reads it once
 * for both the template check and these deeper checks).
 */
export async function validatePreflightFromSheets(
  sheets: ParsedSheet[],
  restrictToTypes?: string[],
  crossCheckOpts?: CrossCheckOptions,
): Promise<ValidationResult> {
  const restrict = restrictToTypes ? new Set(restrictToTypes) : null;

  const errorsByType: Record<string, ValidationError[]> = {};
  const refs: { targetType: string; values: Set<string> }[] = [];
  const fileKeysByType = new Map<string, Set<string>>();
  const prepared: { sheet: ParsedSheet; ruleset: EntityRuleset }[] = [];

  // Preload every considered type's ruleset in ONE bulk call (was: one
  // loadRuleset per sheet, each up to ~4 sequential CMF round-trips).
  const considered = sheets.filter((s) => !restrict || restrict.has(s.objectType));
  const rulesetMap = await loadRulesets([...new Set(considered.map((s) => s.objectType))]);
  const rulesetOf = (t: string) => rulesetMap.get(t.toLowerCase()) ?? null;

  for (const sheet of sheets) {
    if (restrict && !restrict.has(sheet.objectType)) continue;

    const ruleset = rulesetOf(sheet.objectType);
    if (!ruleset) {
      // Many master-data files include child sub-tables (PlanSteps,
      // ChecklistItems, MaintenancePlanActivities, …) that are loaded as
      // embedded properties of a parent entity rather than as standalone
      // types — so they have no top-level CMF metadata of their own. Silently
      // skip; the parent's load covers them. Surfacing one warning per
      // sub-table would add 50+ noise lines per typical upload.
      continue;
    }
    prepared.push({ sheet, ruleset });

    // Record this type's own key values so other sheets can reference them.
    const keyProp =
      ruleset.properties.find((p) => p.name.toLowerCase() === "name") ??
      ruleset.properties.find((p) => p.isKey);
    const keySet = fileKeysByType.get(sheet.objectType.toLowerCase()) ?? new Set<string>();
    for (const row of sheet.rows) {
      const v = (row["Name"] ?? (keyProp ? row[keyProp.name] : "") ?? "").trim();
      if (v) keySet.add(v);
    }
    fileKeysByType.set(sheet.objectType.toLowerCase(), keySet);

    // Collect referenced parent values for batch existence checks.
    for (const p of ruleset.properties) {
      if (!p.referenceTargetType) continue;
      const values = new Set<string>();
      for (const row of sheet.rows) {
        const v = (row[p.name] ?? "").trim();
        if (v) values.add(v);
      }
      if (values.size) refs.push({ targetType: p.referenceTargetType, values });
    }
  }

  const parentExists = await buildParentIndex(refs, fileKeysByType);

  for (const { sheet, ruleset } of prepared) {
    const errs = runRules(sheet, ruleset, parentExists);
    if (errs.length) {
      errorsByType[sheet.objectType] = (errorsByType[sheet.objectType] ?? []).concat(errs);
    }
  }

  // Cross-checks (CMF round-trips for existence/update/no-op, dependent
  // sheets, and parent-in-CMF notes). Best-effort: each sub-check swallows
  // its own errors, so a CMF outage here won't blank the result.
  const preparedSheets = prepared.map((p) => p.sheet);
  const crossFindings = await runCrossChecks(preparedSheets, crossCheckOpts);
  for (const f of crossFindings) {
    (errorsByType[f.objectType] ??= []).push(f);
  }

  // Hard-block a wrong file: if NOT ONE sheet maps to a known CMF object type,
  // this isn't a valid master-data package (CMF would also return zero object
  // types). Surface a clear error instead of letting the user reach a dead-end.
  if (prepared.length === 0) {
    errorsByType["File"] = [
      {
        objectType: "File",
        row: null,
        column: null,
        severity: "error",
        message:
          "No recognized master-data object types were found in this file. It doesn't look like a valid CMF master-data package — check you uploaded the right template.",
      },
    ];
  }

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const list of Object.values(errorsByType)) {
    for (const e of list) {
      if (e.severity === "error") errorCount++;
      else if (e.severity === "warning") warningCount++;
      else infoCount++;
    }
  }

  return { ok: errorCount === 0, errorsByType, errorCount, warningCount, infoCount };
}
