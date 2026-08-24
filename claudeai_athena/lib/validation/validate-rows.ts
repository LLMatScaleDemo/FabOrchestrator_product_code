import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRuleset, isFkReference, type EntityRuleset } from "@/lib/validation/metadata";
import { buildParentIndex } from "@/lib/validation/referential";
import { runRules } from "@/lib/validation/rule-engine";
import type { ParsedSheet, ValidationError } from "@/lib/validation/types";

/**
 * The file-less core of pre-flight validation, factored out so the loader (which
 * starts from an uploaded workbook) and the AI template-builder chatbot (which
 * starts from in-memory rows) share ONE implementation of the rule logic — no
 * duplicated rules. Everything keys off the same CMF-derived `loadRuleset`,
 * `runRules`, and `buildParentIndex` the loader uses; the only difference is the
 * input is `rows` instead of a parsed sheet.
 *
 * All DB access here is read-only (metadata + parent/duplicate existence).
 */

/** Batched, read-only existence lookup against a physical table's `Name` key. */
async function lookupExistingNames(
  schema: string,
  table: string,
  values: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const params: Record<string, string> = {};
    const placeholders = chunk.map((v, idx) => {
      params[`v${idx}`] = v;
      return `@v${idx}`;
    });
    const rows = await cmfQuery<{ Name: string }>(
      `select Name from [${schema}].[${table}] where Name in (${placeholders.join(",")})`,
      params,
    );
    for (const r of rows) found.add(String(r.Name).toLowerCase());
  }
  return found;
}

/** This type's own key values (so in-payload rows satisfy self-references). */
function fileKeyIndex(
  objectType: string,
  ruleset: EntityRuleset,
  rows: Record<string, string>[],
): Map<string, Set<string>> {
  const keyProp =
    ruleset.properties.find((p) => p.name.toLowerCase() === "name") ??
    ruleset.properties.find((p) => p.isKey);
  const keySet = new Set<string>();
  for (const row of rows) {
    const v = (row["Name"] ?? (keyProp ? row[keyProp.name] : "") ?? "").trim();
    if (v) keySet.add(v);
  }
  return new Map([[objectType.toLowerCase(), keySet]]);
}

/** Collect referenced-parent values per FK column (skipping empty cells). */
function collectRefs(ruleset: EntityRuleset, rows: Record<string, string>[]) {
  const byColumn: { column: string; targetType: string; values: Set<string> }[] = [];
  for (const p of ruleset.properties) {
    if (!isFkReference(p)) continue; // skip CMF's noisy scalar "references"
    const values = new Set<string>();
    for (const row of rows) {
      const v = (row[p.name] ?? "").trim();
      if (v) values.add(v);
    }
    if (values.size) byColumn.push({ column: p.name, targetType: p.referenceTargetType!, values });
  }
  return byColumn;
}

export type RowValidation = {
  ok: boolean;
  errors: ValidationError[];
  /** True when CMF has no metadata for the type (rule checks were skipped). */
  metadataMissing?: boolean;
};

/**
 * Run the SAME deterministic rule engine the loader uses (R1 required, R2
 * max-length, R3 numeric, R4 boolean, R5 regex, R6 parent-key) over in-memory
 * rows for a single object type — before any file is generated.
 */
export async function validateRows(
  objectType: string,
  rows: Record<string, string>[],
): Promise<RowValidation> {
  const ruleset = await loadRuleset(objectType);
  if (!ruleset) {
    return {
      ok: false,
      metadataMissing: true,
      errors: [
        {
          objectType,
          row: null,
          column: null,
          severity: "warning",
          message: `No CMF metadata found for object type "${objectType}" — rule checks were skipped.`,
        },
      ],
    };
  }

  const sheet: ParsedSheet = {
    objectType,
    headers: rows[0] ? Object.keys(rows[0]) : [],
    rows,
  };
  const refs = collectRefs(ruleset, rows).map((c) => ({ targetType: c.targetType, values: c.values }));
  const parentExists = await buildParentIndex(refs, fileKeyIndex(objectType, ruleset, rows));
  const errors = runRules(sheet, ruleset, parentExists);
  return { ok: errors.length === 0, errors };
}

export type ExistingCheck = {
  /** Names that already exist in CMF (would be a duplicate key on load). */
  existing: string[];
  /** Names that appear more than once within the supplied payload. */
  inPayloadDuplicates: string[];
  /** True when the type has no resolvable physical table to check against. */
  tableMissing?: boolean;
};

/**
 * Report which `names` already exist in CMF for `objectType` (duplicate keys)
 * and which are duplicated within the payload itself. Read-only.
 */
export async function checkExistingNames(
  objectType: string,
  names: string[],
): Promise<ExistingCheck> {
  const seen = new Map<string, string>();
  const dups = new Set<string>();
  for (const n of names) {
    const trimmed = n.trim();
    if (!trimmed) continue;
    const k = trimmed.toLowerCase();
    if (seen.has(k)) dups.add(seen.get(k)!);
    else seen.set(k, trimmed);
  }
  const inPayloadDuplicates = [...dups];

  const ruleset = await loadRuleset(objectType);
  if (!ruleset?.table) {
    return { existing: [], inPayloadDuplicates, tableMissing: true };
  }

  const unique = [...seen.values()];
  const foundLower = await lookupExistingNames(ruleset.table.schema, ruleset.table.name, unique);
  const existing = unique.filter((n) => foundLower.has(n.toLowerCase()));
  return { existing, inPayloadDuplicates };
}

export type ParentCheck = {
  /** FK columns whose referenced parents are missing (not in payload nor CMF). */
  missing: { column: string; targetType: string; values: string[] }[];
  metadataMissing?: boolean;
};

/**
 * For each foreign-key column of `objectType`, report referenced parent values
 * that exist neither in the supplied rows nor in CMF. Read-only.
 */
export async function checkParents(
  objectType: string,
  rows: Record<string, string>[],
): Promise<ParentCheck> {
  const ruleset = await loadRuleset(objectType);
  if (!ruleset) return { missing: [], metadataMissing: true };

  const byColumn = collectRefs(ruleset, rows);
  const refs = byColumn.map((c) => ({ targetType: c.targetType, values: c.values }));
  const parentExists = await buildParentIndex(refs, fileKeyIndex(objectType, ruleset, rows));

  const missing = byColumn
    .map((c) => ({
      column: c.column,
      targetType: c.targetType,
      values: [...c.values].filter((v) => !parentExists(c.targetType, v)),
    }))
    .filter((c) => c.values.length > 0);
  return { missing };
}
