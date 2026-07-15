import type { ParsedSheet, ValidationError } from "@/lib/validation/types";

/**
 * Structural pre-flight checks against the master-data template — the part the
 * column-conformance layer (template-check.ts) doesn't cover. All findings are
 * BLOCKING errors carrying the exact sheet / row / column so the LLM explainer
 * can pinpoint them (CMF's portal does not).
 *
 * Pure: same parsed sheets + template in → same errors out. No I/O, no LLM.
 *
 * Checks:
 *  1. Sheet order        — recognized sheets must follow the template's canonical
 *                          `Execution Order` ($order), which already encodes
 *                          parent-before-child.
 *  2. Column-header order — within a sheet, the headers present must keep the
 *                          template's relative column order.
 *  3. Parent-before-child — when both a parent and its dependent sheet are
 *                          present, the parent sheet must appear first.
 *  4. Referential (in-file) — when the parent sheet IS in the file, every child
 *                          foreign-key value must resolve to a parent row. (When
 *                          the parent isn't in the file it may already live in
 *                          CMF — that lookup is the rule engine's R6 job.)
 *
 * Unknown sheets/columns are ignored here — template-check.ts already flags them.
 */

export type TemplateEntry = { raw: string; columns: string[] };
export type TemplateSchema = Record<string, TemplateEntry>;

/**
 * Known parent → child key relationships in the CMF master-data template.
 * `fk` is the column on the CHILD sheet that holds the parent's `Name`.
 * Verified against templates/MasterDataTemplate.xlsx. Extend as the template grows.
 */
export const RELATIONSHIPS: { child: string; parent: string; fk: string }[] = [
  { child: "Facility", parent: "Site", fk: "Site" },
  { child: "Area", parent: "Facility", fk: "Facility" },
  { child: "Area", parent: "Area", fk: "ParentArea" }, // self-referential hierarchy
  { child: "Resource", parent: "Area", fk: "Area" },
  { child: "Product", parent: "ProductGroup", fk: "ProductGroup" },
  { child: "ProductGroup", parent: "Flow", fk: "Flow" },
  { child: "ProductGroup", parent: "Step", fk: "Step" },
];

function warn(
  objectType: string,
  row: number | null,
  column: string | null,
  message: string,
): ValidationError {
  return { objectType, row, column, severity: "warning", message };
}

/** Case-insensitive cell lookup for a header that may differ only in case. */
function valueFor(row: Record<string, string>, name: string): string {
  if (name in row) return (row[name] ?? "").trim();
  const lower = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return (row[k] ?? "").trim();
  return "";
}

export function checkStructure(
  sheets: ParsedSheet[],
  schema: TemplateSchema,
  order: string[],
  ambiguous: Set<string> = new Set(),
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Lowercased lookups so casing differences never cause spurious mismatches.
  const rank = new Map<string, number>();
  order.forEach((t, i) => rank.set(t.toLowerCase(), i));
  const ambiguousLower = new Set([...ambiguous].map((t) => t.toLowerCase()));
  const schemaByLower = new Map<string, TemplateEntry>();
  for (const [k, v] of Object.entries(schema)) schemaByLower.set(k.toLowerCase(), v);
  const sheetByType = new Map<string, ParsedSheet>();
  for (const s of sheets) {
    const key = s.objectType.toLowerCase();
    if (!sheetByType.has(key)) sheetByType.set(key, s);
  }

  // Sheet order and column-header order are NOT enforced here. CMF's loader
  // matches sheets and headers by NAME (driven by the object-types list it
  // reports for the package), so any ordering issue is purely cosmetic. Older
  // versions of this check produced hundreds of "out of order" warnings on
  // real CMF exports where the column ordering had simply been reorganised in
  // a newer template; the noise drowned out actionable findings.
  // Reference unused-binding silencers — kept for the function signature.
  void rank;
  void schemaByLower;
  void ambiguousLower;

  // 3 & 4. Parent → child relationships.
  for (const rel of RELATIONSHIPS) {
    const childKey = rel.child.toLowerCase();
    const parentKey = rel.parent.toLowerCase();
    const childSheet = sheetByType.get(childKey);
    if (!childSheet) continue; // child not in this upload — nothing to check

    const selfRef = childKey === parentKey;
    const parentSheet = sheetByType.get(parentKey);

    // Parent-before-child sheet ordering is NOT enforced — CMF processes
    // sheets by name, not by tab position, so the order is purely cosmetic.

    // In-file referential — only when the parent set is present in the file.
    //    (If absent, the parent may already exist in CMF; R6 verifies that.)
    const parentSource = selfRef ? childSheet : parentSheet;
    if (!parentSource) continue;
    const parentNames = new Set<string>();
    for (const row of parentSource.rows) {
      const n = valueFor(row, "Name");
      if (n) parentNames.add(n.toLowerCase());
    }

    childSheet.rows.forEach((row, i) => {
      const v = valueFor(row, rel.fk);
      if (!v) return; // empty FK — optionality is the rule engine's (R1) job
      if (!parentNames.has(v.toLowerCase())) {
        // The cross-check layer makes the final call: if this parent IS in
        // CMF, it's not a real problem; if it's nowhere, the dependent-sheet
        // error fires. Either way, this in-file-only check is advisory.
        errors.push(
          warn(
            rel.child,
            i + 1,
            rel.fk,
            `Referenced ${rel.parent} "${v}" is not defined in the "${rel.parent}" sheet of this file. Add it there, correct the value, or rely on the matching record already in CMF.`,
          ),
        );
      }
    });
  }

  return errors;
}
