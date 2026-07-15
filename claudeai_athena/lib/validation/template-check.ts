import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import templateSchema from "@/lib/validation/template-schema.json";
import { parseWorkbook } from "@/lib/validation/xlsx";
import { checkStructure, type TemplateSchema } from "@/lib/validation/structure-check";
import type { ParsedSheet, ValidationError, ValidationResult } from "@/lib/validation/types";

/**
 * Template-conformance + structure validation: compare an uploaded master-data
 * Excel file against the reference MasterDataTemplate.xlsx (precomputed into
 * template-schema.json), so we get 100% structural conformance BEFORE any CMF
 * object API is called.
 *
 * Two parts, merged into one result:
 *   • Conformance (here): sheets must be in the template; no EXTRA columns.
 *     Missing optional columns are allowed (subset uploads are normal); missing
 *     MANDATORY columns are the deeper CMF-metadata layer's job.
 *   • Structure (structure-check.ts): sheet order, column-header order, and
 *     parent → child relationships (order + in-file referential).
 *
 * The workbook is read with ExcelJS in STREAMING mode (which only emits rows
 * that actually exist) — never `wb.xlsx.load` + getRow, which materializes every
 * row index up to a sheet's (often inflated) rowCount and is pathologically slow
 * on the 200+ sheet master-data files.
 */

// template-schema.json holds per-type column definitions plus reserved keys:
// `$order` (canonical sheet order = physical tab order) and `$ambiguous` (object
// types backed by more than one template sheet — column ORDER isn't checked).
const RAW = templateSchema as Record<string, unknown>;
const RESERVED = new Set(["$order", "$ambiguous"]);
const ORDER = (RAW.$order as string[] | undefined) ?? [];
const AMBIGUOUS = new Set((RAW.$ambiguous as string[] | undefined) ?? []);
const SCHEMA: TemplateSchema = Object.fromEntries(
  Object.entries(RAW).filter(([k]) => !RESERVED.has(k)),
) as TemplateSchema;
const SCHEMA_BY_LOWER = new Map(
  Object.entries(SCHEMA).map(([k, v]) => [k.toLowerCase(), v]),
);

/**
 * For an unrecognized sheet name, suggest the closest template object type — a
 * truncated/typo'd tab name (e.g. "DataColl" → "DataCollection") is the most
 * common cause. Returns the shortest template type the name is a prefix of, or
 * one that is a prefix of the name; null if nothing is close.
 */
function suggestObjectType(name: string): string | null {
  const n = name.toLowerCase();
  if (!n) return null;
  let best: string | null = null;
  for (const key of SCHEMA_BY_LOWER.keys()) {
    if (key === n) continue;
    if (key.startsWith(n) || n.startsWith(key)) {
      if (best === null || key.length < best.length) best = key;
    }
  }
  return best ? SCHEMA_BY_LOWER.get(best)?.raw ?? best : null;
}

const META = new Set([
  "cover", "index", "config", "formats", "assumptions", "worksheetnamemapping", "enums",
]);
const stripPrefix = (n: string) => n.replace(/^<[^>]+>/, "").trim();

function cellStr(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("text" in o) return String(o.text ?? "").trim();
    if ("result" in o) return String(o.result ?? "").trim();
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
    }
  }
  return String(v).trim();
}

/**
 * Stream the workbook into ParsedSheet[] (object type + ordered headers + data
 * rows). Streaming only yields populated rows, so this is fast even on files
 * with hundreds of sheets and inflated row counts.
 */
async function readSheetsStreaming(bytes: ArrayBuffer | Buffer): Promise<ParsedSheet[]> {
  const tmp = join(tmpdir(), `mdv-${randomUUID()}.xlsx`);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes));
  await writeFile(tmp, buf);
  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(tmp, {
      worksheets: "emit",
      sharedStrings: "cache",
      entries: "emit",
    });
    const nameMap = new Map<string, string>();
    // Resolve object types AFTER the pass: WorksheetNameMapping may stream after
    // the data sheets, so collect raw sheets first then map names.
    const raw: { rawName: string; headers: string[]; rows: Record<string, string>[] }[] = [];

    for await (const ws of reader) {
      const name = (ws as { name?: string }).name ?? "";
      if (name.toLowerCase() === "worksheetnamemapping") {
        for await (const row of ws) {
          if (row.number === 1) continue;
          const cells: string[] = [];
          row.eachCell({ includeEmpty: false }, (c) => cells.push(cellStr(c.value)));
          if (cells.length >= 2 && cells[0] && cells[1]) {
            nameMap.set(cells[0].toLowerCase(), cells[1]);
            nameMap.set(stripPrefix(cells[0]).toLowerCase(), cells[1]);
          }
        }
        continue;
      }
      if (!name || name.startsWith("_xlnm") || META.has(name.toLowerCase())) continue;

      // header name -> 1-based column number (positional, so blank gaps don't shift)
      const headerCols = new Map<number, string>();
      const headers: string[] = [];
      const rows: Record<string, string>[] = [];
      for await (const row of ws) {
        if (row.number === 1) {
          row.eachCell({ includeEmpty: false }, (c, col) => {
            const s = cellStr(c.value);
            if (s) {
              headerCols.set(col, s);
              headers.push(s);
            }
          });
          continue;
        }
        if (headerCols.size === 0) break; // no headers — nothing to map rows onto
        const obj: Record<string, string> = {};
        let hasValue = false;
        for (const [col, h] of headerCols) {
          const s = cellStr(row.getCell(col).value);
          if (s) hasValue = true;
          obj[h] = s;
        }
        if (hasValue) rows.push(obj);
      }
      if (headers.length === 0) continue;
      raw.push({ rawName: name, headers, rows });
    }

    return raw.map((r) => {
      const mapped =
        nameMap.get(r.rawName.toLowerCase()) ?? nameMap.get(stripPrefix(r.rawName).toLowerCase());
      return { objectType: stripPrefix(mapped ?? r.rawName), headers: r.headers, rows: r.rows };
    });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

async function readUpload(bytes: ArrayBuffer | Buffer): Promise<ParsedSheet[]> {
  try {
    return await readSheetsStreaming(bytes);
  } catch (err) {
    // Robust (slower) fallback for unusual workbooks the streaming reader chokes on.
    console.warn("[template-check] streaming read failed; falling back to full parse", err);
    return parseWorkbook(bytes);
  }
}

export async function validateAgainstTemplate(
  bytes: ArrayBuffer | Buffer,
): Promise<ValidationResult> {
  let sheets: ParsedSheet[];
  try {
    sheets = await readUpload(bytes);
  } catch (err) {
    console.error("[template-check] failed to read workbook", err);
    return {
      ok: false,
      errorsByType: {
        File: [
          {
            objectType: "File",
            row: null,
            column: null,
            severity: "error",
            message: "The file could not be read as an Excel workbook. Re-export it and try again.",
          },
        ],
      },
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
    };
  }
  return validateParsedSheets(sheets);
}

/** Read an uploaded workbook into sheets using the fast streaming path. */
export function readUploadSheets(bytes: ArrayBuffer | Buffer): Promise<ParsedSheet[]> {
  return readUpload(bytes);
}

/**
 * Conformance + structure checks over already-read sheets. Exposed so a caller
 * that has read the workbook (e.g. to also generate LLM explanations) doesn't
 * have to read it twice.
 */
export function validateParsedSheets(sheets: ParsedSheet[]): ValidationResult {
  const errorsByType: Record<string, ValidationError[]> = {};
  const add = (e: ValidationError) => {
    (errorsByType[e.objectType] ??= []).push(e);
  };

  let recognized = 0;
  for (const s of sheets) {
    const tpl = SCHEMA_BY_LOWER.get(s.objectType.toLowerCase());
    if (!tpl) {
      const suggestion = suggestObjectType(s.objectType);
      add({
        objectType: s.objectType,
        row: null,
        column: null,
        severity: "error",
        message: suggestion
          ? `Sheet "${s.objectType}" is not a valid master-data sheet name. Did you mean "${suggestion}"? (a tab name was renamed or truncated).`
          : `Sheet "${s.objectType}" is not part of the master-data template.`,
      });
      continue;
    }
    recognized++;

    // Extra columns (in the upload but not in our template snapshot) are
    // intentionally NOT flagged. CMF matches by header name and ignores
    // unknown headers; fresh CMF exports routinely include columns added to
    // a newer template version than our snapshot. Surfacing these only
    // generated noise — every Resource export added 15+ such warnings.
  }

  if (sheets.length > 0 && recognized === 0) {
    add({
      objectType: "File",
      row: null,
      column: null,
      severity: "error",
      message:
        "No sheets in this file match the master-data template. Check you uploaded the correct template.",
    });
  }
  if (sheets.length === 0) {
    add({
      objectType: "File",
      row: null,
      column: null,
      severity: "error",
      message: "The file has no data sheets to validate.",
    });
  }

  // Structural checks (sheet order, column order, parent/child) — only worth
  // running when at least one sheet was recognized.
  if (recognized > 0) {
    for (const e of checkStructure(sheets, SCHEMA, ORDER, AMBIGUOUS)) add(e);
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
