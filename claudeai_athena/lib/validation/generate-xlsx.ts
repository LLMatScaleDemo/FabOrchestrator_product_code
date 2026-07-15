import ExcelJS from "exceljs";
import templateSchema from "@/lib/validation/template-schema.json";
import { validateParsedSheets } from "@/lib/validation/template-check";
import { parseWorkbook } from "@/lib/validation/xlsx";
import { getComposition } from "@/lib/validation/composition";

/**
 * Generate a minimal, provably loader-conformant master-data .xlsx from
 * validated in-memory rows — the "validation engine in reverse". We do NOT
 * clone templates/MasterDataTemplate.xlsx (3.8 MB / 254 sheets); we build one
 * data sheet whose name + columns come straight from template-schema.json, then
 * SELF-VERIFY the result through the real template-check engine so that if it
 * parses and conforms here, the loader is guaranteed to accept it.
 */

const RESERVED = new Set(["$order", "$ambiguous"]);
type TemplateEntry = { raw: string; columns: string[] };
const SCHEMA = templateSchema as unknown as Record<string, TemplateEntry>;
const SCHEMA_BY_LOWER = new Map(
  Object.entries(SCHEMA)
    .filter(([k]) => !RESERVED.has(k))
    .map(([k, v]) => [k.toLowerCase(), { objectType: k, ...v }]),
);

/** Excel caps worksheet (tab) names at 31 characters. */
const EXCEL_TAB_LIMIT = 31;

export type GeneratedWorkbook = {
  bytes: Buffer;
  /** The real object type (template key). */
  objectType: string;
  /** The worksheet tab name actually written (may be truncated). */
  sheetName: string;
  /** Columns emitted, in canonical template order. */
  columns: string[];
  rowCount: number;
};

/**
 * Decide the actual worksheet tab name to write, and whether a
 * WorksheetNameMapping sheet is needed so the loader (and our own template-check
 * round-trip) can resolve it back to the canonical object type.
 *
 * Two cases need a mapping:
 *   - `tpl.raw` exceeds 31 chars (Excel's tab-name limit) — we truncate the tab
 *     and the loader needs the mapping to recover the full name.
 *   - `stripPrefix(tpl.raw)` doesn't match the canonical object type — e.g.
 *     `CertificationRequiredQualification` whose sheet is `CertifReqQualif` in
 *     the original master-data template. Without a mapping, template-check
 *     looks up the short tab name in SCHEMA_BY_LOWER (keyed by canonical type)
 *     and fails. The mapping points it back to the canonical type so the
 *     lookup succeeds and the file round-trips cleanly.
 */
function resolveSheetName(tpl: { objectType: string; raw: string }): {
  sheetName: string;
  needsMapping: boolean;
} {
  const truncated = tpl.raw.length > EXCEL_TAB_LIMIT;
  const sheetName = truncated ? tpl.raw.slice(0, EXCEL_TAB_LIMIT) : tpl.raw;
  const strippedRaw = tpl.raw.replace(/^<[^>]+>/, "").trim();
  const needsMapping = truncated || strippedRaw.toLowerCase() !== tpl.objectType.toLowerCase();
  return { sheetName, needsMapping };
}

function valueFor(row: Record<string, string>, column: string): string {
  if (column in row) return row[column] ?? "";
  const lower = column.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k] ?? "";
  return "";
}

/**
 * Build a loader-conformant workbook for `objectType` from `rows`, then verify
 * it. Throws if the type is unknown or if the generated file fails the template
 * check (which would mean the loader would reject it too).
 */
export async function generateMasterDataXlsx(
  objectType: string,
  rows: Record<string, string>[],
): Promise<GeneratedWorkbook> {
  const tpl = SCHEMA_BY_LOWER.get(objectType.toLowerCase());
  if (!tpl) {
    throw new Error(
      `Unknown object type "${objectType}" — it is not part of the master-data template.`,
    );
  }
  if (rows.length === 0) {
    throw new Error("Cannot generate a workbook with zero rows.");
  }

  // Emit only template columns the user actually supplied (subset uploads are
  // allowed; EXTRA columns would be rejected by the template check). Keep the
  // canonical template column order so the structure check passes.
  const provided = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) provided.add(k.toLowerCase());
  const columns = tpl.columns.filter((c) => provided.has(c.toLowerCase()));
  if (columns.length === 0) {
    throw new Error(
      `None of the supplied fields match template columns for "${tpl.objectType}".`,
    );
  }

  const wb = new ExcelJS.Workbook();
  const { sheetName, needsMapping } = resolveSheetName(tpl);

  const ws = wb.addWorksheet(sheetName);
  ws.addRow(columns);
  for (const row of rows) ws.addRow(columns.map((c) => valueFor(row, c)));

  if (needsMapping) {
    const map = wb.addWorksheet("WorksheetNameMapping");
    map.addRow(["Worksheet Name", "Object Type"]);
    map.addRow([sheetName, tpl.objectType]);
  }

  const out = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(out as ArrayBuffer);

  // Self-verify: run the SAME engine the loader runs. If it doesn't conform
  // here, refuse to hand back a file the loader would reject.
  const sheets = await parseWorkbook(bytes);
  const result = validateParsedSheets(sheets);
  if (!result.ok) {
    const flat = Object.values(result.errorsByType)
      .flat()
      .map((e) => e.message)
      .join("; ");
    throw new Error(`Generated workbook failed self-verification: ${flat}`);
  }

  return { bytes, objectType: tpl.objectType, sheetName, columns, rowCount: rows.length };
}

export type GeneratedTemplate = {
  bytes: Buffer;
  objectType: string;
  sheetName: string;
  /** ALL template columns, in canonical order — header row only. */
  columns: string[];
};

/**
 * Build a BLANK loader-conformant master-data .xlsx — just the header row, no
 * data — for the user to fill in offline. Emits every column from the template
 * (not a subset), then runs the same self-verification path so the resulting
 * file is structurally identical to what the loader expects.
 */
export async function generateEmptyTemplateXlsx(
  objectType: string,
): Promise<GeneratedTemplate> {
  const tpl = SCHEMA_BY_LOWER.get(objectType.toLowerCase());
  if (!tpl) {
    throw new Error(
      `Unknown object type "${objectType}" — it is not part of the master-data template.`,
    );
  }

  const wb = new ExcelJS.Workbook();
  const { sheetName, needsMapping } = resolveSheetName(tpl);

  const ws = wb.addWorksheet(sheetName);
  ws.addRow(tpl.columns);

  if (needsMapping) {
    const map = wb.addWorksheet("WorksheetNameMapping");
    map.addRow(["Worksheet Name", "Object Type"]);
    map.addRow([sheetName, tpl.objectType]);
  }

  const out = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(out as ArrayBuffer);

  // Self-verify: a header-only sheet still goes through the structural check
  // (no row-level rule engine — that requires CMF metadata and is the loader's
  // pre-flight job once the user fills the file in).
  const sheets = await parseWorkbook(bytes);
  const result = validateParsedSheets(sheets);
  if (!result.ok) {
    const flat = Object.values(result.errorsByType)
      .flat()
      .map((e) => e.message)
      .join("; ");
    throw new Error(`Generated template failed self-verification: ${flat}`);
  }

  return { bytes, objectType: tpl.objectType, sheetName, columns: tpl.columns };
}

/**
 * Shared helper: add ONE sheet (parent or sub-sheet) to a workbook in canonical
 * column order, and register any required WorksheetNameMapping entries.
 */
function appendSheet(
  wb: ExcelJS.Workbook,
  mapping: { tab: string; canonical: string }[],
  args: { objectType: string; raw: string; columns: string[] },
  rows: Record<string, string>[] | null,
): { sheetName: string; columns: string[] } {
  const truncated = args.raw.length > EXCEL_TAB_LIMIT;
  const sheetName = truncated ? args.raw.slice(0, EXCEL_TAB_LIMIT) : args.raw;
  const strippedRaw = args.raw.replace(/^<[^>]+>/, "").trim();
  const needsMapping = truncated || strippedRaw.toLowerCase() !== args.objectType.toLowerCase();

  const ws = wb.addWorksheet(sheetName);
  // For templates (rows=null) emit ALL columns; for data, emit only columns
  // the user actually supplied in canonical order.
  let cols = args.columns;
  if (rows !== null) {
    const provided = new Set<string>();
    for (const row of rows) for (const k of Object.keys(row)) provided.add(k.toLowerCase());
    cols = args.columns.filter((c) => provided.has(c.toLowerCase()));
    if (cols.length === 0) {
      // Subset uploads are allowed but a zero-column row would write nothing —
      // fall back to the first canonical column (key) so the sheet is non-empty.
      cols = [args.columns[0]];
    }
  }
  ws.addRow(cols);
  if (rows) for (const row of rows) ws.addRow(cols.map((c) => valueFor(row, c)));

  if (needsMapping) mapping.push({ tab: sheetName, canonical: args.objectType });
  return { sheetName, columns: cols };
}

function finalizeWorkbook(
  wb: ExcelJS.Workbook,
  mapping: { tab: string; canonical: string }[],
) {
  if (mapping.length === 0) return;
  const map = wb.addWorksheet("WorksheetNameMapping");
  map.addRow(["Worksheet Name", "Object Type"]);
  for (const m of mapping) map.addRow([m.tab, m.canonical]);
}

async function selfVerify(bytes: Buffer, kind: "template" | "data") {
  // ExcelJS's streaming reader trips on zip-entry ordering in workbooks it just
  // wrote (`Cannot read properties of undefined (reading 'sheets')`). Generated
  // workbooks are tiny, so go direct to the non-streaming parser.
  const sheets = await parseWorkbook(bytes);
  const result = validateParsedSheets(sheets);
  if (!result.ok) {
    const flat = Object.values(result.errorsByType)
      .flat()
      .map((e) => e.message)
      .join("; ");
    throw new Error(`Generated ${kind} failed self-verification: ${flat}`);
  }
}

export type GeneratedMultiSheetTemplate = {
  bytes: Buffer;
  parent: string;
  /** All sheets emitted (parent first, then sub-sheets in $order). */
  sheets: { objectType: string; sheetName: string; columns: string[] }[];
};

/**
 * Build a header-only workbook that includes the parent sheet AND every
 * sub-sheet that belongs to it (Step + StepReason + StepSamplingPlan + …),
 * in canonical $order. Each sheet has its full column header row.
 */
export async function generateMultiSheetTemplateXlsx(
  parentObjectType: string,
): Promise<GeneratedMultiSheetTemplate> {
  const comp = getComposition(parentObjectType);
  if (!comp) {
    throw new Error(
      `Unknown or non-parent object type "${parentObjectType}" — can't compose a multi-sheet template.`,
    );
  }

  const wb = new ExcelJS.Workbook();
  const mapping: { tab: string; canonical: string }[] = [];
  const emitted: GeneratedMultiSheetTemplate["sheets"] = [];

  const parent = appendSheet(
    wb,
    mapping,
    { objectType: comp.parent, raw: comp.parentRaw, columns: comp.parentColumns },
    null,
  );
  emitted.push({ objectType: comp.parent, ...parent });

  for (const sub of comp.subSheets) {
    const s = appendSheet(
      wb,
      mapping,
      { objectType: sub.objectType, raw: sub.raw, columns: sub.columns },
      null,
    );
    emitted.push({ objectType: sub.objectType, ...s });
  }

  finalizeWorkbook(wb, mapping);
  const out = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(out as ArrayBuffer);
  await selfVerify(bytes, "template");

  return { bytes, parent: comp.parent, sheets: emitted };
}

export type GeneratedMultiSheetWorkbook = {
  bytes: Buffer;
  parent: string;
  sheets: {
    objectType: string;
    sheetName: string;
    columns: string[];
    rowCount: number;
  }[];
};

/**
 * Build a multi-sheet workbook from user data: parent rows + per-sub-sheet rows.
 * `rowsByType` is keyed by canonical object type — any type not in the
 * composition is ignored. Empty sub-sheets emit a header-only sheet so the
 * structure check still passes (sub-sheets with no data are allowed).
 */
export async function generateMultiSheetDataXlsx(
  parentObjectType: string,
  rowsByType: Record<string, Record<string, string>[]>,
): Promise<GeneratedMultiSheetWorkbook> {
  const comp = getComposition(parentObjectType);
  if (!comp) {
    throw new Error(
      `Unknown or non-parent object type "${parentObjectType}" — can't generate a multi-sheet workbook.`,
    );
  }
  const parentRows = rowsByType[comp.parent] ?? [];
  if (parentRows.length === 0) {
    throw new Error(
      `No rows provided for the parent type "${comp.parent}". At minimum the parent sheet must have data.`,
    );
  }

  const wb = new ExcelJS.Workbook();
  const mapping: { tab: string; canonical: string }[] = [];
  const emitted: GeneratedMultiSheetWorkbook["sheets"] = [];

  const parent = appendSheet(
    wb,
    mapping,
    { objectType: comp.parent, raw: comp.parentRaw, columns: comp.parentColumns },
    parentRows,
  );
  emitted.push({ objectType: comp.parent, ...parent, rowCount: parentRows.length });

  for (const sub of comp.subSheets) {
    const rows = rowsByType[sub.objectType] ?? [];
    // For sub-sheets with no rows, write header only (matches generic template).
    const s = appendSheet(
      wb,
      mapping,
      { objectType: sub.objectType, raw: sub.raw, columns: sub.columns },
      rows.length > 0 ? rows : null,
    );
    emitted.push({ objectType: sub.objectType, ...s, rowCount: rows.length });
  }

  finalizeWorkbook(wb, mapping);
  const out = await wb.xlsx.writeBuffer();
  const bytes = Buffer.from(out as ArrayBuffer);
  await selfVerify(bytes, "data");

  return { bytes, parent: comp.parent, sheets: emitted };
}
