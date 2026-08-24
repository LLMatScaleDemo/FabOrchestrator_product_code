import { isFkReference, type EntityRuleset } from "@/lib/validation/metadata";
import type { ParsedSheet, ValidationError } from "@/lib/validation/types";
import templateSchema from "@/lib/validation/template-schema.json";

const TEMPLATE_SCHEMA = templateSchema as unknown as Record<string, { columns?: string[] }>;

/**
 * The loadable template columns for an object type (case-insensitive set), or
 * null when the type isn't in the template. A mandatory metadata property that
 * is NOT one of these columns is not something a preparer can supply — CMF fills
 * or DERIVES it on load (e.g. ResourceService.Name = `{Source}To{Target}`, a
 * NOT-NULL column the template deliberately omits). Enforcing it would be a false
 * positive, so the required-value check is gated on template membership.
 */
function templateColumnSet(objectType: string): Set<string> | null {
  const entry = Object.entries(TEMPLATE_SCHEMA).find(
    ([k]) => k.toLowerCase() === objectType.toLowerCase(),
  );
  const cols = entry?.[1]?.columns;
  return cols ? new Set(cols.map((c) => c.toLowerCase())) : null;
}

/**
 * Deterministic rule engine — the blocking gate. Pure: given a parsed sheet, a
 * CMF-derived ruleset, and a (precomputed, synchronous) parent-existence
 * resolver, it returns every rule violation. No I/O, no LLM — same input always
 * yields the same result.
 *
 * Severity philosophy:
 *  - Checks that we know are reliable (R1 mandatory for non-system columns,
 *    R2 max length, R5 regex) emit `error` — they block.
 *  - Checks where CMF metadata can't be fully trusted (R3 numeric / R4 boolean
 *    on enum-by-name columns, R6 FK on numeric / mis-mapped targets) emit
 *    `warning` — surfaced to the preparer, but CMF's own dry-run is the
 *    authoritative gate.
 */

/** CMF scalar types that must parse as a number. */
const NUMERIC = new Set([
  "BigInt", "Int", "SmallInt", "TinyInt", "Decimal", "Numeric", "Float", "Real", "Money", "SmallMoney",
]);
const NUMERIC_INT_LIKE = new Set(["BigInt", "Int", "SmallInt", "TinyInt"]);
const BOOL_OK = new Set(["0", "1", "true", "false", "yes", "no", "y", "n"]);

/**
 * Columns CMF auto-populates on insert (cmEntity base + audit). They appear as
 * `IsMandatory=true` in metadata, but preparers must NOT supply them — the
 * loader fills them. Skipping these eliminates the bulk of pre-flight false
 * positives on master-data files exported from CMF.
 */
const SYSTEM_MANAGED = new Set(
  [
    "Id",
    "Version",
    "UniversalState",
    "RevisionState",
    "IsDefaultRevision",
    "CreatedBy",
    "CreatedOn",
    "ModifiedBy",
    "ModifiedOn",
    "LastOperationHistorySeq",
    "LastServiceHistoryId",
    "LastCorrelationID",
    "LastCorrelationId",
    // Relationship counters live across many entity types and are always
    // maintained by CMF, never user-set.
    "HoldCount",
  ].map((s) => s.toLowerCase()),
);

function isSystemManaged(name: string): boolean {
  const lower = name.toLowerCase();
  if (SYSTEM_MANAGED.has(lower)) return true;
  // Generic *Count fields — CMF maintains counts of related entities itself
  // (AttachedDurablesCount, LaneCount, ParentResourcesCount, etc.). These
  // come back as mandatory in metadata but the loader rejects user-supplied
  // values silently.
  if (/count$/.test(lower)) return true;
  return false;
}

/** Returns true if a parent of `targetType` with key `value` exists (file or CMF). */
export type ParentExists = (targetType: string, value: string) => boolean;

function valueFor(row: Record<string, string>, name: string): string {
  // Exact match first, then case-insensitive.
  if (name in row) return row[name] ?? "";
  const lower = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k] ?? "";
  return "";
}

function mkError(
  objectType: string,
  row: number,
  column: string,
  message: string,
): ValidationError {
  return { objectType, row, column, severity: "error", message };
}

function mkWarn(
  objectType: string,
  row: number,
  column: string,
  message: string,
): ValidationError {
  return { objectType, row, column, severity: "warning", message };
}

export function runRules(
  sheet: ParsedSheet,
  ruleset: EntityRuleset,
  parentExists: ParentExists,
): ValidationError[] {
  const errors: ValidationError[] = [];
  // Only fields that are actual template columns can be user-supplied; a
  // mandatory metadata property outside the template is CMF-derived on load.
  const tplCols = templateColumnSet(sheet.objectType);
  const isTemplateColumn = (name: string) => !tplCols || tplCols.has(name.toLowerCase());
  // Count only USER-fillable mandatories — system columns are auto-filled, and
  // non-template columns are CMF-derived.
  const userMandatoryNames = ruleset.properties
    .filter((p) => p.mandatory && !isSystemManaged(p.name) && isTemplateColumn(p.name))
    .map((p) => p.name);

  sheet.rows.forEach((row, i) => {
    const rowNum = i + 1;
    const missingMandatory: string[] = [];
    let anyMissingHardError = false;
    for (const p of ruleset.properties) {
      const val = valueFor(row, p.name).trim();
      const sysCol = isSystemManaged(p.name);

      if (!val) {
        // Required-value check skips system-managed columns (CMF auto-fills) and
        // non-template columns (CMF derives them on load — e.g. the NOT-NULL
        // ResourceService.Name, absent from the template on purpose).
        if (p.mandatory && !sysCol && isTemplateColumn(p.name)) {
          missingMandatory.push(p.name);
          // CMF defaults numeric / boolean columns on insert, and the
          // referenceTargetType from `metadata.ts` is unreliable for some
          // columns (notably `Type` — the join mis-resolves) so we can't
          // be sure the column is really a hard reference. Surface those
          // misses as warnings; keep text columns with no FK metadata as
          // hard errors (Description / free-text fields the preparer
          // genuinely needs to fill).
          const isNumericish =
            p.scalarType === "Bit" || (p.scalarType ? NUMERIC.has(p.scalarType) : false);
          const looksLikeFk = !!p.referenceTargetType;
          const downgrade = isNumericish || looksLikeFk;
          const factory = downgrade ? mkWarn : mkError;
          if (!downgrade) anyMissingHardError = true;
          errors.push({
            ...factory(sheet.objectType, rowNum, p.name, "Required value is missing."),
            category: "required",
          });
        }
        continue; // no further checks on an empty optional cell
      }

      // Skip downstream checks on system columns — values there are advisory
      // and CMF overwrites them anyway.
      if (sysCol) continue;

      if (p.scalarSize && val.length > p.scalarSize) {
        errors.push(mkError(sheet.objectType, rowNum, p.name, `Value exceeds maximum length ${p.scalarSize}.`));
      }

      // R3 numeric: when the column ALSO has a referenceTargetType, the value
      // is the parent's Name (CMF resolves to an integer ID on load) — a
      // string value here is correct, not an error. Same for known enum-style
      // columns whose ScalarType is Int but the loader takes a name. Emit a
      // warning so the preparer sees it, but don't gate.
      if (p.scalarType && NUMERIC.has(p.scalarType) && !Number.isFinite(Number(val))) {
        // For Int-family columns the loader frequently accepts a string
        // enum/reference name and resolves it server-side. Surface as a
        // warning so CMF's own dry-run is the authoritative gate.
        const downgrade = p.referenceTargetType || NUMERIC_INT_LIKE.has(p.scalarType);
        const factory = downgrade ? mkWarn : mkError;
        errors.push(
          factory(
            sheet.objectType,
            rowNum,
            p.name,
            `Expected a ${p.scalarType} number, got "${val}"${downgrade ? " — if this is an enum or reference name, CMF will resolve it on load." : "."}`,
          ),
        );
      }
      if (p.scalarType === "Bit" && !BOOL_OK.has(val.toLowerCase())) {
        errors.push(
          mkWarn(
            sheet.objectType,
            rowNum,
            p.name,
            `Expected a boolean (0/1/true/false), got "${val}". CMF may coerce; verify on load.`,
          ),
        );
      }
      if (p.validationRegex) {
        try {
          if (!new RegExp(p.validationRegex).test(val)) {
            errors.push(mkError(sheet.objectType, rowNum, p.name, `Value "${val}" does not match the required format.`));
          }
        } catch {
          /* ignore an invalid stored regex rather than block */
        }
      }
      // R6 FK: the metadata join in `metadata.ts` mis-maps the target for
      // some columns (e.g. `Type` is resolved to wildly different
      // EntityTypes because ReferencedObjectId collides across tables),
      // and numeric FKs are loaded by ID, not Name. The cross-check layer
      // does the authoritative per-target lookup; here we surface as a
      // warning so the preparer sees the hint without being gated by a
      // potentially wrong metadata join.
      // Only genuine FK references (BigInt id columns) — CMF tags many scalar
      // columns (e.g. Step.Type = "Standard") with a bogus reference target.
      if (isFkReference(p) && !parentExists(p.referenceTargetType!, val)) {
        errors.push({
          ...mkWarn(
            sheet.objectType,
            rowNum,
            p.name,
            `Referenced ${p.referenceTargetType} "${val}" was not found in the file or in CMF.`,
          ),
          category: "parent-fk",
        });
      }
    }

    // Row-level summary when several user-fillable mandatories are blank —
    // one line that names every missing field, so the preparer can see the
    // full list at a glance without scanning the per-cell errors. Severity
    // tracks the worst individual finding: if every miss is a numeric
    // default (warning), the summary is a warning too.
    if (missingMandatory.length >= 3) {
      errors.push({
        objectType: sheet.objectType,
        row: rowNum,
        column: null,
        severity: anyMissingHardError ? "error" : "warning",
        category: "required-summary",
        message: `Row ${rowNum} is missing ${missingMandatory.length} of ${userMandatoryNames.length} required fields: ${missingMandatory.join(", ")}.`,
      });
    }
  });

  return errors;
}
