/**
 * Lean object-specific template generator — PRESERVE mode (Option B).
 *
 * Produces a master-data .xlsx that keeps ONLY the 6 meta sheets + the requested
 * object's sheet(s), by SURGICALLY editing a copy of `KSP_DL_AI.xlsx` rather than
 * rebuilding from scratch. The kept object sheets are preserved byte-for-byte, so
 * their cell COMMENTS, fills, x14 dropdowns, and column widths survive exactly as
 * the client authored them (the from-scratch generator in lean-template.ts loses
 * those). The Index is trimmed to the 7 default rows + one row per kept sheet.
 *
 * Surgery performed on the KSP_DL_AI zip:
 *   - remove every non-kept object sheet: its <sheet> entry, workbook rel,
 *     worksheet part + _rels, comment/vml/drawing/table parts, content-type
 *     overrides, and its `_xlnm._FilterDatabase` defined name;
 *   - trim the Index: keep header + 7 default rows + kept object rows
 *     (renumbered contiguous), drop the Index table (table1);
 *   - trim WorksheetNameMapping to kept sheets only;
 *   - drop calcChain (stale after edits — Excel rebuilds it);
 *   - optionally inject data rows into the kept object sheet(s).
 *
 * Requires a fresh CMF op=1 re-verification after any change here — sheet removal
 * is the operation that historically broke CMF (see DANISH_CHANGES Change 6/7);
 * this version removes sheets AND trims the Index so the two stay consistent.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import templateSchema from "@/lib/validation/template-schema.json";
import { getComposition } from "@/lib/validation/composition";
import { isObjectRemoved } from "@/lib/validation/removal-policy";

const RESERVED = new Set(["$order", "$ambiguous"]);
type Entry = { raw: string; columns: string[] };
const SCHEMA = templateSchema as unknown as Record<string, Entry>;
const SCHEMA_BY_LOWER = new Map(
  Object.entries(SCHEMA)
    .filter(([k]) => !RESERVED.has(k))
    .map(([k, v]) => [k.toLowerCase(), { objectType: k, ...v }]),
);

const KSP_DL_PATH = path.resolve(process.cwd(), "templates/KSP_DL_AI.xlsx");
const META_NAMES = new Set(["Index", "Config", "Formats", "Assumptions", "WorksheetNameMapping", "Enums"]);
const EXCEL_TAB_LIMIT = 31;

let kspBytesCache: Buffer | null = null;
async function loadKspBytes(): Promise<Buffer> {
  if (!kspBytesCache) kspBytesCache = await readFile(KSP_DL_PATH);
  return kspBytesCache;
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function encAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function encText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

type SheetRef = { name: string; rid: string; path: string; tag: string };

/** Parse workbook.xml + rels into ordered sheet refs (name → part path). */
function parseSheets(wbXml: string, relsXml: string): SheetRef[] {
  const ridTarget = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) ridTarget.set(m[1], m[2]);
  const out: SheetRef[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/>/g)) {
    const tag = m[0];
    const name = decodeXml(/\bname="([^"]+)"/.exec(tag)?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1] ?? "";
    const target = ridTarget.get(rid) ?? "";
    const p = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    out.push({ name, rid, path: p, tag });
  }
  return out;
}

/** Targets referenced from a worksheet's _rels (comments, vml, drawing, table). */
async function sheetRelTargets(zip: JSZip, sheetPath: string): Promise<string[]> {
  const relPath = sheetPath.replace(/worksheets\/(sheet\d+)\.xml$/, "worksheets/_rels/$1.xml.rels");
  const f = zip.file(relPath);
  if (!f) return [];
  const xml = await f.async("string");
  const targets: string[] = [];
  for (const m of xml.matchAll(/Target="([^"]+)"/g)) {
    let t = m[1];
    if (t.startsWith("http")) continue;
    // resolve ../ relative to xl/worksheets/
    t = t.replace(/^\.\.\//, "xl/").replace(/^\.\//, "xl/worksheets/");
    if (!t.startsWith("xl/")) t = `xl/worksheets/${t}`;
    targets.push(t);
  }
  return targets;
}

export type LeanSheet = { objectType: string; raw: string; columns: string[]; tab: string };
export type GenerateLeanResult = { bytes: Buffer; objectSheets: LeanSheet[]; allSheets: string[] };

export async function generateLeanPreserved(
  objectType: string,
  rowsByType?: Record<string, Record<string, string>[]>,
): Promise<GenerateLeanResult> {
  const tpl = SCHEMA_BY_LOWER.get(objectType.toLowerCase());
  if (!tpl) throw new Error(`Unknown object type "${objectType}".`);
  const canonical = tpl.objectType;
  if (isObjectRemoved(canonical)) throw new Error(`Object type "${canonical}" has been removed from the client's template.`);

  // kept object sheets (parent + sub-sheets), by raw tab name
  const comp = getComposition(canonical);
  const keptObjects: { objectType: string; raw: string; columns: string[] }[] = comp
    ? [{ objectType: comp.parent, raw: comp.parentRaw, columns: comp.parentColumns },
       ...comp.subSheets.map((s) => ({ objectType: s.objectType, raw: s.raw, columns: s.columns }))]
    : [{ objectType: canonical, raw: tpl.raw, columns: tpl.columns }];
  const keptObjectRaw = new Set(keptObjects.map((k) => k.raw));

  const zip = await JSZip.loadAsync(await loadKspBytes());
  let wbXml = await zip.file("xl/workbook.xml")!.async("string");
  let wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  let ct = await zip.file("[Content_Types].xml")!.async("string");

  const sheets = parseSheets(wbXml, wbRels);
  const removed = sheets.filter((s) => !META_NAMES.has(s.name) && !keptObjectRaw.has(s.name));

  // ── 1. remove each non-kept object sheet + all its parts/refs ──
  const partsToDelete = new Set<string>();
  for (const s of removed) {
    // its own part + _rels
    partsToDelete.add(s.path);
    const relPath = s.path.replace(/worksheets\/(sheet\d+)\.xml$/, "worksheets/_rels/$1.xml.rels");
    if (zip.file(relPath)) partsToDelete.add(relPath);
    // comment/vml/drawing/table parts it links to
    for (const t of await sheetRelTargets(zip, s.path)) partsToDelete.add(t);
    // remove <sheet> from workbook.xml + its rel
    wbXml = wbXml.replace(s.tag, "");
    wbRels = wbRels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${s.rid}"[^>]*/>`), "");
  }

  // Clean defined names: drop every `_xlnm._FilterDatabase` (autofilter ranges —
  // their localSheetId indices are invalidated by sheet removal) and any other
  // defined name whose referenced sheet is gone. Sheet names inside definedNames
  // are XML-encoded (e.g. '&lt;DM&gt;Flow'!…), so decode before matching.
  const keptNamesSet = new Set<string>([...META_NAMES, ...keptObjectRaw]);
  wbXml = wbXml.replace(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g, (dn) => {
    if (/name="_xlnm\._FilterDatabase"/.test(dn)) return "";
    const inner = decodeXml(/<definedName\b[^>]*>([\s\S]*?)<\/definedName>/.exec(dn)?.[1] ?? "");
    const m = /'?([^'!]+?)'?!/.exec(inner);
    if (m && !keptNamesSet.has(m[1])) return "";
    return dn;
  });
  // If the definedNames block is now empty, drop the empty container.
  wbXml = wbXml.replace(/<definedNames>\s*<\/definedNames>/, "");

  // delete parts + their content-type overrides
  for (const p of partsToDelete) {
    zip.remove(p);
    const pn = `/${p}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    ct = ct.replace(new RegExp(`<Override\\b[^>]*\\bPartName="${pn}"[^>]*/>`, "g"), "");
  }

  // ── 2. trim the Index (sheet1.xml): header + 7 default rows + kept object rows ──
  const indexRef = sheets.find((s) => s.name === "Index")!;
  let ixXml = await zip.file(indexRef.path)!.async("string");
  // shared strings for reading col-A values
  const shared: string[] = [];
  const ssF = zip.file("xl/sharedStrings.xml");
  if (ssF) { const ss = await ssF.async("string"); for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""))); }
  const cellText = (c: string): string => {
    const t = /\bt="([^"]+)"/.exec(c)?.[1];
    const is = /<is>([\s\S]*?)<\/is>/.exec(c); if (is) return decodeXml([...is[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
    const v = /<v>([\s\S]*?)<\/v>/.exec(c); if (!v) return ""; if (t === "s") return shared[Number(v[1])] ?? ""; return decodeXml(v[1]);
  };
  const idxRows = [...ixXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].map((m) => ({ n: Number(m[1]), xml: m[0] }));
  const colAOf = (rowXml: string): string => {
    const c = /<c\b[^>]*\br="A\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/.exec(rowXml);
    return c ? cellText(c[0]).trim() : "";
  };
  const rowByRaw = new Map<string, { n: number; xml: string }>();
  for (const r of idxRows) { const a = colAOf(r.xml); if (a) rowByRaw.set(a, r); }
  const keep: { n: number; xml: string }[] = idxRows.filter((r) => r.n <= 8); // header + 7 default
  let nextRow = 9;
  const renumberRow = (rowXml: string, newN: number): string =>
    rowXml.replace(/\br="\d+"/, `r="${newN}"`).replace(/(<c\b[^>]*\br=")([A-Z]+)\d+(")/g, `$1$2${newN}$3`);
  for (const k of keptObjects) {
    const src = rowByRaw.get(k.raw);
    if (src) keep.push({ n: nextRow, xml: renumberRow(src.xml, nextRow) });
    else keep.push({ n: nextRow, xml: `<row r="${nextRow}" spans="1:4"><c r="A${nextRow}" t="inlineStr"><is><t>${encText(k.raw)}</t></is></c></row>` });
    nextRow++;
  }
  // trimmed rows + a plain autofilter (the header dropdowns previously came from
  // the Index table, which we drop below).
  const newSheetData = `<sheetData>${keep.map((r) => r.xml).join("")}</sheetData><autoFilter ref="A1:D${nextRow - 1}"/>`;
  ixXml = ixXml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>|<sheetData\b[^>]*\/>/, newSheetData);
  ixXml = ixXml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:D${nextRow - 1}"/>`);
  // drop the Index table (its ref would dangle after trim): remove tableParts + delete table1 + rel + CT
  ixXml = ixXml.replace(/<tableParts\b[\s\S]*?<\/tableParts>|<tableParts\b[^>]*\/>/, "");
  const ixRelPath = indexRef.path.replace(/worksheets\/(sheet\d+)\.xml$/, "worksheets/_rels/$1.xml.rels");
  const ixRelFile = zip.file(ixRelPath);
  if (ixRelFile) {
    let ixRel = await ixRelFile.async("string");
    const tbl = /Target="([^"]*tables\/table\d+\.xml)"/.exec(ixRel);
    if (tbl) {
      const tblPart = ("xl/" + tbl[1].replace(/^\.\.\//, "")).replace(/xl\/xl\//, "xl/");
      zip.remove(tblPart);
      ct = ct.replace(new RegExp(`<Override\\b[^>]*\\bPartName="/${tblPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`, "g"), "");
    }
    ixRel = ixRel.replace(/<Relationship\b[^>]*Type="[^"]*\/table"[^>]*\/>/g, "");
    zip.file(ixRelPath, ixRel);
  }
  zip.file(indexRef.path, ixXml);

  // ── 3. trim WorksheetNameMapping (sheet5.xml): keep header + kept-sheet mappings ──
  const wnmRef = sheets.find((s) => s.name === "WorksheetNameMapping");
  if (wnmRef) {
    let wnmXml = await zip.file(wnmRef.path)!.async("string");
    const wnmRows = [...wnmXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].map((m) => ({ n: Number(m[1]), xml: m[0] }));
    const keptWnm: string[] = [];
    let wn = 1;
    for (const r of wnmRows) {
      if (r.n === 1) { keptWnm.push(renumberRow(r.xml, wn++)); continue; }
      // col B holds the full <XX>Name target; keep only if that sheet is kept
      const cells = [...r.xml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
      const bCell = cells.find((c) => c[1] === "B");
      const target = bCell ? cellText(bCell[0]).trim() : "";
      if (target && keptObjectRaw.has(target)) keptWnm.push(renumberRow(r.xml, wn++));
    }
    wnmXml = wnmXml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>|<sheetData\b[^>]*\/>/, `<sheetData>${keptWnm.join("")}</sheetData>`);
    zip.file(wnmRef.path, wnmXml);
  }

  // ── 4. inject data rows into kept object sheet(s) (if provided) ──
  const emitted: LeanSheet[] = [];
  for (const k of keptObjects) {
    const ref = sheets.find((s) => s.name === k.raw);
    const truncated = k.raw.length > EXCEL_TAB_LIMIT;
    const tab = truncated ? k.raw.slice(0, EXCEL_TAB_LIMIT) : k.raw;
    emitted.push({ objectType: k.objectType, raw: k.raw, columns: k.columns, tab });
    const rows = rowsByType?.[k.objectType] ?? [];
    if (!ref || rows.length === 0) continue;
    let sx = await zip.file(ref.path)!.async("string");
    // highest existing row
    let maxRow = 1;
    for (const m of sx.matchAll(/<row\b[^>]*\br="(\d+)"/g)) maxRow = Math.max(maxRow, Number(m[1]));
    let rn = maxRow + 1;
    const valueFor = (row: Record<string, string>, col: string): string => {
      if (col in row) return row[col] ?? "";
      const lower = col.toLowerCase(); for (const kk of Object.keys(row)) if (kk.toLowerCase() === lower) return row[kk] ?? ""; return "";
    };
    const newRows = rows.map((row) => {
      const cells = k.columns.map((c, i) => { const v = valueFor(row, c); return v === "" ? "" : `<c r="${colLetter(i + 1)}${rn}" t="inlineStr"><is><t>${encText(String(v))}</t></is></c>`; }).filter(Boolean).join("");
      const xml = `<row r="${rn}" spans="1:${k.columns.length}">${cells}</row>`;
      rn++; return xml;
    }).join("");
    sx = sx.replace(/<\/sheetData>/, `${newRows}</sheetData>`);
    zip.file(ref.path, sx);
  }

  // ── 5. drop stale calcChain ──
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    ct = ct.replace(/<Override\b[^>]*\bPartName="\/xl\/calcChain\.xml"[^>]*\/>/g, "");
    wbRels = wbRels.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, "");
  }

  // ── GC: delete orphan parts + prune content-type overrides for missing parts ──
  zip.file("xl/workbook.xml", wbXml);
  zip.file("xl/_rels/workbook.xml.rels", wbRels);
  const resolveRel = (baseDir: string, target: string): string => {
    const stack: string[] = [];
    for (const p of `${baseDir}/${target}`.split("/")) { if (p === "..") stack.pop(); else if (p !== "." && p !== "") stack.push(p); }
    return stack.join("/");
  };
  const referenced = new Set<string>(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"]);
  const collect = (relsXml: string, baseDir: string) => {
    for (const m of relsXml.matchAll(/Target="([^"]+)"/g)) { if (!m[1].startsWith("http")) referenced.add(resolveRel(baseDir, m[1])); }
  };
  collect(wbRels, "xl");
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) collect(await zip.file(name)!.async("string"), "xl/worksheets");
  }
  // delete unreferenced tables/comments/drawings/vml/printerSettings parts
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    if (/^xl\/(tables|drawings|printerSettings)\//.test(name) || /^xl\/comments\d+\.xml$/.test(name)) {
      if (!referenced.has(name)) zip.remove(name);
    }
  }
  // prune content-type Overrides whose part no longer exists
  const exists = new Set(Object.keys(zip.files));
  ct = ct.replace(/<Override\b[^>]*\bPartName="([^"]+)"[^>]*\/>/g, (ov, pn) => (exists.has(String(pn).replace(/^\//, "")) ? ov : ""));
  zip.file("[Content_Types].xml", ct);

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const bytes = Buffer.from(out);
  const allSheets = parseSheets(wbXml, wbRels).map((s) => s.name);
  return { bytes, objectSheets: emitted, allSheets };
}
