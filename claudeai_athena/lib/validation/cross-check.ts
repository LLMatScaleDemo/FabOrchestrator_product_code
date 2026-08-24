import { cmfQuery } from "@/lib/cmf/cmf-sql";
import {
  getDiffableColumns,
  isFkReference,
  loadRuleset,
  type EntityRuleset,
} from "@/lib/validation/metadata";
import { RELATIONSHIPS } from "@/lib/validation/structure-check";
import type { ParsedSheet, ValidationError } from "@/lib/validation/types";

/**
 * Pre-flight cross-checks that talk to CMF, layered on top of the deterministic
 * rule engine. None of these block the user — they answer the "what would CMF
 * see if I loaded this right now?" questions:
 *
 *   • Exists / update / no-op — for each row keyed by Name, is there already
 *     a matching CMF row? If yes, are the diffable columns identical (no-op)
 *     or different (update)?
 *   • Dependent-sheets-not-filled — when a child sheet references parents
 *     that are NOT in the file and ALSO not in CMF, and the parent sheet in
 *     the file is missing or empty, surface a single sheet-level error
 *     listing every missing parent so the preparer can add them upstream.
 *   • Parent-in-CMF info — when a referenced parent value isn't in the file
 *     but IS in CMF, raise an `info` note (the rule engine swallows this
 *     silently otherwise).
 *
 * Everything emits `ValidationError` rows with severity / category set; the
 * caller merges them into `errorsByType`.
 */

// CMF often uses `Active` (Bit) as a system-managed default; including it in
// the diff would make every prior load look like an "update". Skip it.
const NEVER_DIFF = new Set(["active"]);

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function rowValue(row: Record<string, string>, name: string): string {
  if (name in row) return (row[name] ?? "").trim();
  const lower = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return (row[k] ?? "").trim();
  return "";
}

/** Same numeric "looks equal" as `1` vs `1.0`, true vs "1". */
function valuesEqual(a: string, b: string, scalarType: string | null): boolean {
  if (a === b) return true;
  const ak = a.toLowerCase();
  const bk = b.toLowerCase();
  if (ak === bk) return true;
  if (scalarType === "Bit") {
    const toBool = (s: string) => ["1", "true", "yes", "y"].includes(s.toLowerCase()) ? "1"
      : ["0", "false", "no", "n", ""].includes(s.toLowerCase()) ? "0" : s;
    return toBool(a) === toBool(b);
  }
  if (scalarType && /Int|Decimal|Numeric|Float|Real|Money/i.test(scalarType)) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return false;
}

/**
 * Pull `Name` + every diffable column for the rows whose Name is in `names`.
 * Batched in chunks of 500 to stay under SQL Server's 2100-parameter cap.
 */
async function fetchCmfRows(
  schema: string,
  table: string,
  columns: string[],
  names: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const byName = new Map<string, Record<string, unknown>>();
  if (names.length === 0 || columns.length === 0) return byName;
  const colList = ["Name", ...columns].map((c) => `[${c}]`).join(", ");
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const params: Record<string, string> = {};
    const placeholders = chunk.map((v, idx) => {
      params[`v${idx}`] = v;
      return `@v${idx}`;
    });
    const rows = await cmfQuery<Record<string, unknown>>(
      `select ${colList} from [${schema}].[${table}] where Name in (${placeholders.join(",")})`,
      params,
    );
    for (const r of rows) {
      const name = cellStr(r.Name);
      if (name) byName.set(name.toLowerCase(), r);
    }
  }
  return byName;
}

/**
 * Names that already exist in CMF for a given physical table. Lighter-weight
 * than `fetchCmfRows` for cases where we only need to know "exists or not".
 */
async function lookupExistingNames(
  schema: string,
  table: string,
  values: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (values.length === 0) return found;
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

function info(
  objectType: string,
  row: number | null,
  column: string | null,
  category: ValidationError["category"],
  message: string,
): ValidationError {
  return { objectType, row, column, severity: "info", message, category };
}

function err(
  objectType: string,
  row: number | null,
  column: string | null,
  category: ValidationError["category"],
  message: string,
): ValidationError {
  return { objectType, row, column, severity: "error", message, category };
}

/**
 * Walk one sheet's rows and emit one info row per row: either "row N would
 * UPDATE existing X (changes: A, B)" or "row N matches CMF — no changes".
 * Rows whose Name isn't in CMF get no message here (a brand-new row).
 */
async function checkExistsAndUpdates(
  sheet: ParsedSheet,
  ruleset: EntityRuleset,
): Promise<ValidationError[]> {
  if (!ruleset.table) return [];

  const names: string[] = [];
  const rowByName = new Map<string, { row: Record<string, string>; rowNum: number }>();
  sheet.rows.forEach((row, i) => {
    const name = rowValue(row, "Name");
    if (!name) return;
    names.push(name);
    rowByName.set(name.toLowerCase(), { row, rowNum: i + 1 });
  });
  if (names.length === 0) return [];

  const diffable = getDiffableColumns(ruleset).filter((c) => !NEVER_DIFF.has(c.toLowerCase()));
  const cmfRows = await fetchCmfRows(ruleset.table.schema, ruleset.table.name, diffable, names);

  const out: ValidationError[] = [];
  const propByName = new Map(ruleset.properties.map((p) => [p.name.toLowerCase(), p]));

  for (const name of names) {
    const cmfRow = cmfRows.get(name.toLowerCase());
    if (!cmfRow) continue; // brand-new row — nothing to say here

    const { row, rowNum } = rowByName.get(name.toLowerCase())!;
    const changes: string[] = [];
    for (const col of diffable) {
      const fileVal = rowValue(row, col);
      // Skip columns the preparer left blank — CMF treats blank as "don't
      // touch" on an update, so flagging a difference there would be noise.
      if (fileVal === "") continue;
      const cmfVal = cellStr(cmfRow[col]);
      const scalar = propByName.get(col.toLowerCase())?.scalarType ?? null;
      if (!valuesEqual(fileVal, cmfVal, scalar)) {
        changes.push(`${col}: "${cmfVal}" → "${fileVal}"`);
      }
    }

    if (changes.length === 0) {
      out.push(
        info(
          sheet.objectType,
          rowNum,
          null,
          "noop",
          `Row ${rowNum} ("${name}") already exists in CMF and matches — load would be a no-op.`,
        ),
      );
    } else {
      const preview = changes.slice(0, 5).join("; ");
      const more = changes.length > 5 ? ` (+${changes.length - 5} more)` : "";
      out.push(
        info(
          sheet.objectType,
          rowNum,
          null,
          "update",
          `Row ${rowNum} ("${name}") already exists in CMF — load would UPDATE it. Changes: ${preview}${more}.`,
        ),
      );
    }
  }
  return out;
}

/**
 * For each known parent→child relationship: if the child sheet has rows whose
 * FK targets aren't in the file AND aren't in CMF, emit a single sheet-level
 * error on the child sheet listing every missing parent name. The hint is
 * actionable: add these to <Parent> sheet, or load <Parent> first.
 */
async function checkDependentSheets(
  sheetsByType: Map<string, ParsedSheet>,
): Promise<ValidationError[]> {
  const out: ValidationError[] = [];

  for (const rel of RELATIONSHIPS) {
    const childKey = rel.child.toLowerCase();
    const parentKey = rel.parent.toLowerCase();
    if (childKey === parentKey) continue; // self-referential — covered by structure-check

    const childSheet = sheetsByType.get(childKey);
    if (!childSheet || childSheet.rows.length === 0) continue;

    // FK values referenced from the child sheet.
    const referenced = new Set<string>();
    for (const row of childSheet.rows) {
      const v = rowValue(row, rel.fk);
      if (v) referenced.add(v);
    }
    if (referenced.size === 0) continue;

    // Subtract names defined in the parent sheet (if present).
    const parentSheet = sheetsByType.get(parentKey);
    const inFile = new Set<string>();
    if (parentSheet) {
      for (const row of parentSheet.rows) {
        const n = rowValue(row, "Name");
        if (n) inFile.add(n.toLowerCase());
      }
    }
    const notInFile = [...referenced].filter((v) => !inFile.has(v.toLowerCase()));
    if (notInFile.length === 0) continue;

    // Of those, which also don't exist in CMF?
    const ruleset = await loadRuleset(rel.parent);
    let inCmf = new Set<string>();
    if (ruleset?.table) {
      inCmf = await lookupExistingNames(ruleset.table.schema, ruleset.table.name, notInFile);
    }
    const missingEverywhere = notInFile.filter((v) => !inCmf.has(v.toLowerCase()));
    if (missingEverywhere.length === 0) continue;

    // Surface the missing parents in one message.
    const parentEmpty = !parentSheet || parentSheet.rows.length === 0;
    const head = parentEmpty
      ? `Sheet "${rel.child}" references ${rel.parent}s that aren't in this file or in CMF, and the "${rel.parent}" sheet is ${parentSheet ? "empty" : "not present"}.`
      : `Sheet "${rel.child}" references ${rel.parent}s that aren't in "${rel.parent}" sheet or in CMF.`;
    const list = missingEverywhere.slice(0, 20).join(", ");
    const more = missingEverywhere.length > 20 ? ` (+${missingEverywhere.length - 20} more)` : "";
    out.push(
      err(
        rel.child,
        null,
        rel.fk,
        "dependent-sheet",
        `${head} Add these to the "${rel.parent}" sheet (or load them separately first): ${list}${more}.`,
      ),
    );
  }
  return out;
}

/**
 * When a child sheet references a parent value that isn't in the file but IS
 * in CMF, the rule engine accepts it silently. Surface it as `info` so the
 * preparer knows the load will rely on existing CMF data.
 */
async function checkParentsInCmfInfo(
  sheets: ParsedSheet[],
): Promise<ValidationError[]> {
  const out: ValidationError[] = [];
  const fileKeysByType = new Map<string, Set<string>>();
  for (const s of sheets) {
    const keySet = fileKeysByType.get(s.objectType.toLowerCase()) ?? new Set<string>();
    for (const row of s.rows) {
      const v = rowValue(row, "Name");
      if (v) keySet.add(v.toLowerCase());
    }
    fileKeysByType.set(s.objectType.toLowerCase(), keySet);
  }

  for (const s of sheets) {
    const ruleset = await loadRuleset(s.objectType);
    if (!ruleset) continue;
    for (const p of ruleset.properties) {
      if (!isFkReference(p)) continue; // skip CMF's noisy scalar "references" (e.g. Step.Type)
      const targetKey = p.referenceTargetType!.toLowerCase();
      const fileKeys = fileKeysByType.get(targetKey) ?? new Set<string>();
      const refs = new Set<string>();
      for (const row of s.rows) {
        const v = rowValue(row, p.name);
        if (v && !fileKeys.has(v.toLowerCase())) refs.add(v);
      }
      if (refs.size === 0) continue;

      const parentRs = await loadRuleset(p.referenceTargetType);
      if (!parentRs?.table) continue;
      const inCmf = await lookupExistingNames(
        parentRs.table.schema,
        parentRs.table.name,
        [...refs],
      );
      const resolvedFromCmf = [...refs].filter((v) => inCmf.has(v.toLowerCase()));
      if (resolvedFromCmf.length === 0) continue;

      const list = resolvedFromCmf.slice(0, 10).join(", ");
      const more =
        resolvedFromCmf.length > 10 ? ` (+${resolvedFromCmf.length - 10} more)` : "";
      out.push(
        info(
          s.objectType,
          null,
          p.name,
          "parent-fk-in-cmf",
          `Column "${p.name}" references ${resolvedFromCmf.length} ${p.referenceTargetType}${resolvedFromCmf.length === 1 ? "" : "s"} not in this file but already in CMF: ${list}${more}.`,
        ),
      );
    }
  }
  return out;
}

export type CrossCheckOptions = {
  /** Skip rows-vs-CMF diffing (existence/update/no-op). Useful for tests. */
  skipExistence?: boolean;
  /** Skip dependent-sheet missing-parents check. */
  skipDependentSheets?: boolean;
  /** Skip the "parent exists in CMF" info notes. */
  skipParentInCmf?: boolean;
};

/**
 * Top-level entry point. Runs all three cross-checks over already-parsed
 * sheets and returns a flat list of findings to merge into the result map.
 * Best-effort: any single check that throws is logged and skipped; the rest
 * still run.
 */
export async function runCrossChecks(
  sheets: ParsedSheet[],
  opts: CrossCheckOptions = {},
): Promise<ValidationError[]> {
  const out: ValidationError[] = [];
  const sheetsByType = new Map<string, ParsedSheet>();
  for (const s of sheets) sheetsByType.set(s.objectType.toLowerCase(), s);

  if (!opts.skipExistence) {
    for (const sheet of sheets) {
      try {
        const ruleset = await loadRuleset(sheet.objectType);
        if (!ruleset) continue;
        const findings = await checkExistsAndUpdates(sheet, ruleset);
        out.push(...findings);
      } catch (err) {
        console.error(`[cross-check] exists/update failed for ${sheet.objectType}`, err);
      }
    }
  }

  if (!opts.skipDependentSheets) {
    try {
      out.push(...(await checkDependentSheets(sheetsByType)));
    } catch (err) {
      console.error("[cross-check] dependent-sheets check failed", err);
    }
  }

  if (!opts.skipParentInCmf) {
    try {
      out.push(...(await checkParentsInCmfInfo(sheets)));
    } catch (err) {
      console.error("[cross-check] parent-in-cmf check failed", err);
    }
  }

  return out;
}
