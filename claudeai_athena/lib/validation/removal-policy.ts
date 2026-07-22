import overrides from "@/lib/validation/template-overrides.json";

/**
 * Client-driven template overrides.
 *
 * `template-overrides.json` captures the client's TemplateObjectCatalog.xlsx
 * strike-through rows (= object removal) and red-font column names (= column
 * removal). Provenance for this file and its source catalog is recorded in
 * `template-assets.meta.json`; run `npm run verify:templates` (which executes
 * scripts/verify-template-assets.ts) to re-check both assets against the
 * current template and refresh the provenance stamp.
 *
 * This module is the SINGLE consumer of that file. Every chatbot
 * touch-point reads from these helpers so the same blacklist applies
 * everywhere: generation, form rendering, prefill, preview, lookups.
 */

type Overrides = {
  removedObjects?: string[];
  removedColumns?: Record<string, string[]>;
};
const data = overrides as Overrides;

const removedObjectSet = new Set((data.removedObjects ?? []).map((s) => s.toLowerCase()));
const removedColumnsByObject = new Map<string, Set<string>>(
  Object.entries(data.removedColumns ?? {}).map(([obj, cols]) => [
    obj.toLowerCase(),
    new Set(cols.map((c) => c.toLowerCase())),
  ]),
);

/** True when the client has marked an object for removal from the template. */
export function isObjectRemoved(objectType: string): boolean {
  return removedObjectSet.has(objectType.toLowerCase());
}

/** True when a specific column on an object has been removed. */
export function isColumnRemoved(objectType: string, columnName: string): boolean {
  const set = removedColumnsByObject.get(objectType.toLowerCase());
  return set ? set.has(columnName.toLowerCase()) : false;
}

/** Lowercase set of removed columns for an object, for batch filtering. */
export function getRemovedColumns(objectType: string): Set<string> {
  return removedColumnsByObject.get(objectType.toLowerCase()) ?? new Set();
}
