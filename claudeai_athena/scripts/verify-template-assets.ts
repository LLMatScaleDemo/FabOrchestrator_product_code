/**
 * Verify the committed validation assets against the current client template,
 * and stamp provenance — the reproducible, in-repo replacement for the missing
 * ad-hoc extract tooling.
 *
 * What it does (read-only, never overwrites a working asset):
 *   1. Parses templates/KSP_DL_client_final.xlsx with the SAME reader the
 *      validator uses (readUploadSheets) and diffs it against
 *      lib/validation/template-schema.json — reporting any object type or
 *      column that has drifted (added / removed / re-ordered).
 *   2. Sanity-checks lib/validation/template-overrides.json (every removed
 *      object / column references a known template type) and, when the client's
 *      TemplateObjectCatalog.xlsx is available, stamps its hash for provenance.
 *   3. Writes lib/validation/template-assets.meta.json with source file names,
 *      SHA-256 hashes, counts, and the generation timestamp — so "which template
 *      are we on?" is answerable from the repo.
 *
 * Usage:
 *   npx tsx scripts/verify-template-assets.ts            # verify + stamp
 *   npx tsx scripts/verify-template-assets.ts --strict   # exit 1 on any drift
 *   CATALOG=/path/to/TemplateObjectCatalog.xlsx npx tsx scripts/verify-template-assets.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
import { readUploadSheets } from "@/lib/validation/template-check";
import templateSchema from "@/lib/validation/template-schema.json";
import overrides from "@/lib/validation/template-overrides.json";

const ROOT = resolve(__dirname, "..");
const KSP = resolve(ROOT, "templates/KSP_DL_client_final.xlsx");
const SCHEMA_PATH = resolve(ROOT, "lib/validation/template-schema.json");
const OVERRIDES_PATH = resolve(ROOT, "lib/validation/template-overrides.json");
const META_PATH = resolve(ROOT, "lib/validation/template-assets.meta.json");
const CATALOG =
  process.env.CATALOG ??
  resolve(ROOT, "../../Entegris/DataLoader/cmf-loader/templates/TemplateObjectCatalog.xlsx");

const RESERVED = new Set(["$order", "$ambiguous"]);
const strict = process.argv.includes("--strict");

/** Case-insensitive de-dupe preserving first-seen spelling. */
function uniqCI(cols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cols) {
    const lc = c.toLowerCase();
    if (!seen.has(lc)) {
      seen.add(lc);
      out.push(c);
    }
  }
  return out;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type SchemaEntry = { raw: string; columns: string[] };

async function main() {
  const schema = templateSchema as Record<string, unknown>;
  const schemaTypes = Object.entries(schema).filter(([k]) => !RESERVED.has(k)) as [string, SchemaEntry][];
  const ambiguous = new Set(((schema.$ambiguous as string[] | undefined) ?? []).map((s) => s.toLowerCase()));

  // ── 1. schema vs live template ────────────────────────────────────────────
  // A type may be backed by MORE THAN ONE template sheet ($ambiguous) — the
  // schema stores the UNION of their columns and doesn't check column order, so
  // we compare against the union of every sheet mapping to the type.
  const parsed = await readUploadSheets(readFileSync(KSP));
  const sheetsByType = new Map<string, string[][]>();
  for (const s of parsed) {
    const key = s.objectType.toLowerCase();
    (sheetsByType.get(key) ?? sheetsByType.set(key, []).get(key)!).push(s.headers);
  }

  const missingFromTemplate: string[] = []; // in schema, not in template
  const columnDrift: { type: string; added: string[]; removed: string[]; reordered: boolean }[] = [];

  for (const [type, entry] of schemaTypes) {
    const headerSets = sheetsByType.get(type.toLowerCase());
    if (!headerSets) {
      missingFromTemplate.push(type);
      continue;
    }
    const isAmbiguous = ambiguous.has(type.toLowerCase()) || headerSets.length > 1;
    const schemaCols = entry.columns ?? [];
    // Single-sheet types keep raw headers (some sheets legitimately repeat a
    // column name, e.g. FromDate/ToDate); only union+dedupe across sheets.
    const tplCols = headerSets.length === 1 ? headerSets[0] : uniqCI(headerSets.flat());
    const schemaSet = new Set(schemaCols.map((c) => c.toLowerCase()));
    const tplSet = new Set(tplCols.map((c) => c.toLowerCase()));
    const added = tplCols.filter((c) => !schemaSet.has(c.toLowerCase())); // in template, not in schema
    const removed = schemaCols.filter((c) => !tplSet.has(c.toLowerCase())); // in schema, not in template
    // Order only matters for single-sheet (non-ambiguous) types.
    const reordered =
      !isAmbiguous &&
      added.length === 0 &&
      removed.length === 0 &&
      schemaCols.join("|").toLowerCase() !== tplCols.join("|").toLowerCase();
    if (added.length || removed.length || reordered) {
      columnDrift.push({ type, added, removed, reordered });
    }
  }

  const schemaTypeSet = new Set(schemaTypes.map(([k]) => k.toLowerCase()));
  const missingFromSchema = parsed // in template, not in schema
    .map((s) => s.objectType)
    .filter((t) => !schemaTypeSet.has(t.toLowerCase()));

  // ── 2. overrides sanity ───────────────────────────────────────────────────
  const ov = overrides as { removedObjects?: string[]; removedColumns?: Record<string, string[]> };
  const removedObjects = ov.removedObjects ?? [];
  const removedColumns = ov.removedColumns ?? {};
  const unknownRemovedObjects = removedObjects.filter((o) => !schemaTypeSet.has(o.toLowerCase()));
  const unknownRemovedColumnObjects = Object.keys(removedColumns).filter(
    (o) => !schemaTypeSet.has(o.toLowerCase()),
  );

  // ── 3. provenance ─────────────────────────────────────────────────────────
  const catalogPresent = existsSync(CATALOG);
  const meta = {
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/verify-template-assets.ts",
    assets: {
      "template-schema.json": {
        sha256: sha256(SCHEMA_PATH),
        objectTypes: schemaTypes.length,
        derivedFrom: "templates/KSP_DL_client_final.xlsx",
        sourceSha256: sha256(KSP),
      },
      "template-overrides.json": {
        sha256: sha256(OVERRIDES_PATH),
        removedObjects: removedObjects.length,
        removedColumnObjects: Object.keys(removedColumns).length,
        derivedFrom: "TemplateObjectCatalog.xlsx",
        sourceSha256: catalogPresent ? sha256(CATALOG) : null,
        sourceFile: catalogPresent ? basename(CATALOG) : "(not available at generation time)",
      },
    },
    sources: {
      "KSP_DL_client_final.xlsx": { sha256: sha256(KSP), objectSheetsParsed: parsed.length },
      "TemplateObjectCatalog.xlsx": catalogPresent
        ? { sha256: sha256(CATALOG) }
        : { status: "absent" },
    },
  };
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n");

  // ── report ────────────────────────────────────────────────────────────────
  const drift =
    missingFromTemplate.length +
    columnDrift.length +
    missingFromSchema.length +
    unknownRemovedObjects.length +
    unknownRemovedColumnObjects.length;

  console.log("── Template asset verification ──────────────────────────────");
  console.log(`schema object types      : ${schemaTypes.length}`);
  console.log(`template object sheets   : ${parsed.length}`);
  console.log(`removed objects (client) : ${removedObjects.length}`);
  console.log(`removed-column objects   : ${Object.keys(removedColumns).length}`);
  console.log(`TemplateObjectCatalog    : ${catalogPresent ? CATALOG : "absent"}`);
  console.log("");
  const line = (label: string, arr: string[]) =>
    console.log(`${arr.length ? "⚠ " : "✓ "}${label}: ${arr.length}${arr.length ? " — " + arr.slice(0, 15).join(", ") : ""}`);
  line("schema types missing from template", missingFromTemplate);
  line("template sheets missing from schema", missingFromSchema);
  line("unknown removed objects", unknownRemovedObjects);
  line("unknown removed-column objects", unknownRemovedColumnObjects);
  if (columnDrift.length) {
    console.log(`⚠ column drift: ${columnDrift.length} type(s)`);
    for (const d of columnDrift.slice(0, 20)) {
      console.log(
        `   ${d.type}: ${d.added.length ? "+[" + d.added.join(",") + "] " : ""}${d.removed.length ? "-[" + d.removed.join(",") + "] " : ""}${d.reordered ? "(reordered)" : ""}`,
      );
    }
  } else {
    console.log("✓ column drift: 0");
  }
  console.log("");
  console.log(`provenance written → ${META_PATH}`);
  console.log(drift === 0 ? "RESULT: PASS — assets match the current template." : `RESULT: DRIFT — ${drift} discrepancy group(s).`);

  if (strict && drift > 0) process.exit(1);
}

main().catch((err) => {
  console.error("verify-template-assets failed:", err);
  process.exit(1);
});
