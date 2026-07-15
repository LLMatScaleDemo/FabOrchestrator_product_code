import templateSchema from "@/lib/validation/template-schema.json";

/**
 * Master-data "object composition" — which sub-sheets belong to a parent type.
 * In the CMF master template, sub-sheets have no `<XX>` prefix and follow their
 * parent's prefixed sheet immediately in `$order`. To load a parent fully you
 * load the parent sheet PLUS every sub-sheet (Step has 6 sub-sheets, Resource
 * has 6, Checklist has 5, etc.) — 39 of 170 objects in the template are
 * multi-sheet, accounting for ~23% of all loadable objects.
 *
 * This module reads `$order` and returns the {parent, subSheets} grouping for
 * any object type. Used by the chatbot to:
 *   - Tell the user up-front how many sheets they'll need to fill in
 *   - Bundle every sub-sheet into a single generated .xlsx
 *   - Walk the user through inline forms one sub-sheet at a time
 */

const RESERVED = new Set(["$order", "$ambiguous"]);
type Entry = { raw: string; columns: string[] };
const SCHEMA = templateSchema as unknown as Record<string, Entry>;
const ORDER = (templateSchema as unknown as { $order: string[] }).$order;

const hasPrefix = (raw: string) => /^<[^>]+>/.test(raw);

export type SubSheet = {
  /** Canonical object type (sub-sheet name without any prefix). */
  objectType: string;
  /** Raw sheet tab name as it appears in the master template. */
  raw: string;
  /** Template column order for this sub-sheet. */
  columns: string[];
};

export type Composition = {
  /** Canonical parent object type. */
  parent: string;
  /** Raw parent sheet name, e.g. `<DM>Step`. */
  parentRaw: string;
  /** Parent's columns in canonical order. */
  parentColumns: string[];
  /** Sub-sheets that must be loaded together with the parent (parent-first). */
  subSheets: SubSheet[];
};

const compositionCache = new Map<string, Composition | null>();

function build(parent: string): Composition | null {
  const tpl = SCHEMA[parent];
  if (!tpl || RESERVED.has(parent)) return null;
  if (!hasPrefix(tpl.raw)) {
    // This is a sub-sheet itself, not a parent.
    return null;
  }
  const idx = ORDER.indexOf(parent);
  if (idx < 0) {
    // Type is in the schema but not in $order — treat as single-sheet (no
    // sub-sheets we can detect).
    return { parent, parentRaw: tpl.raw, parentColumns: tpl.columns, subSheets: [] };
  }

  const subSheets: SubSheet[] = [];
  // Dedupe by objectType: `$ambiguous` types (e.g. StepReason) appear twice in
  // $order because they have two backing sheets in the master template, but we
  // only emit one sheet per objectType in the generated workbook.
  const seen = new Set<string>();
  for (let i = idx + 1; i < ORDER.length; i++) {
    const next = ORDER[i];
    const nextTpl = SCHEMA[next];
    if (!nextTpl) continue;
    if (hasPrefix(nextTpl.raw)) break; // hit the next parent — stop
    if (seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    subSheets.push({ objectType: next, raw: nextTpl.raw, columns: nextTpl.columns });
  }
  return { parent, parentRaw: tpl.raw, parentColumns: tpl.columns, subSheets };
}

/** Get the composition (parent + sub-sheets) for any parent object type. */
export function getComposition(parent: string): Composition | null {
  if (compositionCache.has(parent)) return compositionCache.get(parent) ?? null;
  const comp = build(parent);
  compositionCache.set(parent, comp);
  return comp;
}

/** True when an object type has 1+ sub-sheets that belong to it. */
export function isMultiSheet(parent: string): boolean {
  const c = getComposition(parent);
  return !!c && c.subSheets.length > 0;
}

/** Find the canonical parent of a sub-sheet (no-prefix) type, or null. */
export function parentOf(subSheetType: string): string | null {
  const tpl = SCHEMA[subSheetType];
  if (!tpl || hasPrefix(tpl.raw)) return null;
  const idx = ORDER.indexOf(subSheetType);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const cand = ORDER[i];
    const candTpl = SCHEMA[cand];
    if (candTpl && hasPrefix(candTpl.raw)) return cand;
  }
  return null;
}
