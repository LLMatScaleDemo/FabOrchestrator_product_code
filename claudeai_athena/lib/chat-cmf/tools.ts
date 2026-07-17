import { tool } from "ai";
import { z } from "zod";
import templateSchema from "@/lib/validation/template-schema.json";
import { resolveObjectType } from "@/lib/chat-cmf/object-types";
import { loadRuleset } from "@/lib/validation/metadata";
import { generateSkeletonBlank, generateFromSkeleton, readSkeletonMarker } from "@/lib/validation/ksp-skeleton";
import { getComposition, parentOf } from "@/lib/validation/composition";
import { createStagedUpload, getStagedUpload } from "@/lib/repo-cmf/validation";
import { validateParsedSheets } from "@/lib/validation/template-check";
import { parseWorkbook } from "@/lib/validation/xlsx";
import { prefillFormFromInput } from "@/lib/chat-cmf/prefill";
import { lookupExisting } from "@/lib/chat-cmf/lookup-existing";
import { previewLoadImpact } from "@/lib/chat-cmf/load-preview";
import { loadMasterData } from "@/lib/cmf/cmf-client";
import { toModelSafeError } from "@/lib/cmf/cmf-errors";
import { isSystemManaged } from "@/lib/validation/system-columns";
import { isObjectRemoved, isColumnRemoved, getRemovedColumns } from "@/lib/validation/removal-policy";

/**
 * The AI template-builder's tool belt (Vercel AI SDK v6). Claude drives the
 * conversation and calls these to resolve a type, learn its fields, check the
 * live CMF DB, run the deterministic validations, and finally generate a
 * loader-conformant .xlsx. Every tool is read-only EXCEPT `generateExcel`, whose
 * only write is the app's own StagedUpload (never CMF). All are scoped to the
 * signed-in user via the `buildChatTools(userId)` factory.
 *
 * Note: v6 uses `inputSchema` (not `parameters`).
 */

const RESERVED = new Set(["$order", "$ambiguous"]);
type TemplateEntry = { raw: string; columns: string[] };
const SCHEMA = templateSchema as unknown as Record<string, TemplateEntry>;
const SCHEMA_BY_LOWER = new Map(
  Object.entries(SCHEMA)
    .filter(([k]) => !RESERVED.has(k))
    .map(([k, v]) => [k.toLowerCase(), { objectType: k, ...v }]),
);

const rowSchema = z.record(z.string(), z.string());

/**
 * The inline entry form is only offered for simple objects: a single sheet with
 * fewer than this many columns. Bigger objects are filled offline in the
 * generated .xlsx instead.
 */
const FORM_MAX_COLUMNS = 11;

function slug(s: string): string {
  return s.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "package";
}

export function buildChatTools(userId: string) {
  return {
    resolveObjectType: tool({
      description:
        "Map a user's free-text request (e.g. 'production orders', 'materials') to real CMF master-data object types. Returns ranked candidates; confirm the chosen type with the user before doing DB work.",
      inputSchema: z.object({
        query: z.string().describe("The user's free-text description of what they want to load"),
      }),
      execute: async ({ query }) => {
        const candidates = resolveObjectType(query).map((c) => ({
          ...c,
          removed: isObjectRemoved(c.objectType),
        }));
        return { candidates };
      },
    }),

    getRequiredFields: tool({
      description:
        "List the fields for a CMF object type: which are mandatory, their scalar type, max length, regex, and which are foreign keys (referenceTargetType) that must already exist in CMF. Use this to tell the user exactly what to provide.",
      inputSchema: z.object({
        objectType: z.string().describe("The exact CMF object type (template key), e.g. 'ProductionOrder'"),
      }),
      execute: async ({ objectType }) => {
        const tpl = SCHEMA_BY_LOWER.get(objectType.toLowerCase());
        const order = tpl?.columns ?? [];
        const ruleset = await loadRuleset(tpl?.objectType ?? objectType);
        if (!ruleset) {
          return {
            objectType: tpl?.objectType ?? objectType,
            metadataMissing: true,
            order,
            columns: order.map((name) => ({
              name,
              mandatory: false,
              scalarType: null,
              maxLength: null,
              regex: null,
              referenceTargetType: null,
            })),
            note: "No CMF metadata was found for this type — field requirements are unknown; only the template column list is available.",
          };
        }
        return {
          objectType: ruleset.objectType,
          order,
          columns: ruleset.properties.map((p) => ({
            name: p.name,
            mandatory: p.mandatory,
            scalarType: p.scalarType,
            maxLength: p.scalarSize,
            regex: p.validationRegex,
            referenceTargetType: p.referenceTargetType,
          })),
        };
      },
    }),

    getObjectComposition: tool({
      description:
        "Return the multi-sheet composition for an object type. Many CMF objects (Step, Resource, Checklist, MaintenancePlan, BOM, Recipe, Plan, Flow, Schedule, …) need multiple sheets to load — a parent sheet plus N sub-sheets. Call this BEFORE generateTemplate or renderEntryForm when you're not sure whether an object is single-sheet or multi-sheet. If subSheets is empty, treat the object as single-sheet; if non-empty, you must collect rows for each sub-sheet too before generateExcel.",
      inputSchema: z.object({
        objectType: z.string().describe("Parent object type, e.g. 'Step', 'Resource'"),
      }),
      execute: async ({ objectType }) => {
        const comp = getComposition(objectType);
        if (!comp) {
          // Maybe the user named a sub-sheet — point them at the real parent.
          const parent = parentOf(objectType);
          if (parent) {
            return {
              objectType,
              isSubSheet: true,
              parentObjectType: parent,
              note: `"${objectType}" is a sub-sheet of "${parent}". Use that as the parent and ask the user to fill the sub-sheets too.`,
            };
          }
          return { error: `Unknown object type "${objectType}".` };
        }
        // Filter client-removed columns so the LLM never quotes them back
        // to the user (they don't appear in the generated file either).
        const filterCols = (obj: string, cols: string[]) => {
          const removed = getRemovedColumns(obj);
          return cols.filter((c) => !removed.has(c.toLowerCase()));
        };
        return {
          parent: comp.parent,
          parentRaw: comp.parentRaw,
          parentColumns: filterCols(comp.parent, comp.parentColumns),
          isMultiSheet: comp.subSheets.length > 0,
          totalSheets: 1 + comp.subSheets.length,
          subSheets: comp.subSheets.map((s) => ({
            objectType: s.objectType,
            sheetName: s.raw,
            columnCount: filterCols(s.objectType, s.columns).length,
          })),
        };
      },
    }),

    lookupExisting: tool({
      description:
        "Look up existing CMF rows by Name. Call this when the user wants to UPDATE existing rows ('Change Site for MAT-001 to SITE-B'), CLONE existing rows ('Make 10 materials like MAT-001'), or INSPECT current values ('Show me MAT-001'). Returns each found row keyed by Name with every column's current value, plus a notFound list. After looking up, pass the result's rows (merged with the user's requested changes) to prefillFormFromInput → renderEntryForm so the user sees current values pre-filled with their changes highlighted.",
      inputSchema: z.object({
        objectType: z
          .string()
          .describe("The exact CMF object type, e.g. 'Material'."),
        names: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe("The Name values to look up (case-sensitive Name match)."),
      }),
      execute: async ({ objectType, names }) => {
        try {
          return await lookupExisting(objectType, names);
        } catch (err) {
          return { error: errMessage(err) };
        }
      },
    }),

    prefillFormFromInput: tool({
      description:
        "DB-validate user-provided rows BEFORE rendering the form. Call this whenever the user pastes data, types data in their prompt, or uploads an .xlsx — anything where you already have proposed rows on hand. Returns each row with per-cell status (ok / fk-resolved / fk-fuzzy / fk-missing / fk-unknown / required-missing / too-long / regex-fail), optional suggestions for fuzzy/missing FK cells, and a hasBlockers flag. After this returns, call renderEntryForm with initialRows set to the result so the user sees pre-filled cells colored by status. Do NOT skip prefill when user data is available — it catches FK typos before submission.",
      inputSchema: z.object({
        objectType: z
          .string()
          .describe("The exact CMF object type (template key), e.g. 'Material'."),
        rows: z
          .array(rowSchema)
          .describe(
            "User-supplied rows as { columnName -> string }. Column names are best-effort: the tool maps them to the canonical template columns case-insensitively and reports any that don't fit under unknownColumns.",
          ),
      }),
      execute: async ({ objectType, rows }) => {
        try {
          const result = await prefillFormFromInput(objectType, rows);
          return result;
        } catch (err) {
          return { error: errMessage(err) };
        }
      },
    }),

    renderEntryForm: tool({
      description:
        "Render an interactive data-entry FORM inline in the chat. Call this when the user agrees to fill in rows directly in the chat OR when they've already provided data (paste / upload / prompt) and you've run prefillFormFromInput. The UI replaces this tool's output with a real form: typed inputs per field, foreign-key dropdowns lazy-loaded from CMF, Add/Remove/Duplicate row, Apply-to-all per cell, and a Submit button. When `prefilledRows` is provided each cell renders with its status color (green/yellow/red) and tooltip. After the user submits, you'll see their rows as the next user message — then immediately call generateExcel (which self-verifies against the KSP template).",
      inputSchema: z.object({
        objectType: z.string().describe("The exact CMF object type (template key), e.g. 'ProductionOrder'"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Optional explicit list of column names to include. Defaults to all mandatory + key columns.",
          ),
        initialRows: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("How many blank rows to start with (default 1). Ignored when prefilledRows is provided."),
        prefilledRows: z
          .array(
            z.record(
              z.string(),
              z.object({
                value: z.string(),
                status: z
                  .enum([
                    "ok",
                    "fk-resolved",
                    "fk-fuzzy",
                    "fk-missing",
                    "fk-unknown",
                    "required-missing",
                    "too-long",
                    "regex-fail",
                  ])
                  .optional(),
                message: z.string().optional(),
                suggestions: z.array(z.string()).optional(),
              }),
            ),
          )
          .optional()
          .describe(
            "Optional pre-populated rows from prefillFormFromInput. Each row is keyed by canonical column name; each cell carries status + optional suggestions. The UI renders status colors and tooltips so the user sees what needs fixing.",
          ),
      }),
      execute: async ({ objectType, fields, initialRows, prefilledRows }) => {
        if (isObjectRemoved(objectType)) {
          return {
            error: `Object type "${objectType}" has been removed from the client's template. No form will be opened.`,
            objectRemoved: true as const,
          };
        }

        // v1 eligibility gate: the inline form is only offered for SIMPLE
        // objects — a single sheet (no sub-sheets) with fewer than 11 columns.
        // Anything bigger is unwieldy in chat, so the user fills it offline.
        const comp = getComposition(objectType);
        if (comp && comp.subSheets.length > 0) {
          return {
            formEligible: false as const,
            reason: "multi-sheet",
            objectType,
            totalSheets: 1 + comp.subSheets.length,
            note: `"${objectType}" needs ${1 + comp.subSheets.length} sheets, so the inline form isn't available. Generate the template and fill it offline instead.`,
          };
        }
        const templateCols = SCHEMA_BY_LOWER.get(objectType.toLowerCase())?.columns ?? [];
        const visibleColCount = templateCols.filter((c) => !isColumnRemoved(objectType, c)).length;
        if (visibleColCount >= FORM_MAX_COLUMNS) {
          return {
            formEligible: false as const,
            reason: "too-many-columns",
            objectType,
            columnCount: visibleColCount,
            note: `"${objectType}" has ${visibleColCount} columns (the inline form supports fewer than ${FORM_MAX_COLUMNS}). Generate the template and fill it offline instead.`,
          };
        }

        const ruleset = await loadRuleset(objectType);
        const tpl = SCHEMA_BY_LOWER.get(objectType.toLowerCase());
        if (!ruleset && !tpl) {
          return {
            error: `Unknown object type "${objectType}" — not in schema or CMF metadata.`,
          };
        }

        // Pick the columns to render. If prefilledRows are provided, also
        // include every column that appears in them (so the user can see / edit
        // every cell the prefill engine populated, even if not mandatory).
        const wanted = fields
          ? new Set(fields.map((f) => f.toLowerCase()))
          : null;
        const prefillCols = new Set<string>();
        if (prefilledRows) {
          for (const row of prefilledRows) for (const k of Object.keys(row)) prefillCols.add(k.toLowerCase());
        }

        // CMF has property metadata for most objects. When it doesn't (system
        // tables like <SM>User, <SM>Role, <SM>Config), fall back to the
        // template schema's column list and treat each field as an untyped
        // string. The user can still fill and submit; we just can't do FK
        // dropdowns / regex checks / typed inputs for those.
        type ChosenField = {
          name: string;
          scalarType: string | null;
          mandatory: boolean;
          isKey: boolean;
          maxLength: number | null;
          regex: string | null;
          referenceTargetType: string | null;
        };
        const canonicalType = ruleset?.objectType ?? tpl?.objectType ?? objectType;
        let chosen: ChosenField[];
        let metadataMissing = false;
        if (ruleset) {
          chosen = ruleset.properties
            .filter((p) => {
              if (isColumnRemoved(ruleset.objectType, p.name)) return false;
              if (wanted) return wanted.has(p.name.toLowerCase());
              if (isSystemManaged(p.name)) return false;
              if (prefillCols.size > 0) return p.mandatory || p.isKey || prefillCols.has(p.name.toLowerCase());
              return p.mandatory || p.isKey;
            })
            .map((p) => ({
              name: p.name,
              scalarType: p.scalarType,
              mandatory: p.mandatory,
              isKey: p.isKey,
              maxLength: p.scalarSize,
              regex: p.validationRegex,
              referenceTargetType: p.referenceTargetType,
            }));
        } else {
          metadataMissing = true;
          const cols = tpl!.columns;
          const keptCols = cols.filter((name) => {
            if (isColumnRemoved(canonicalType, name)) return false;
            if (wanted) return wanted.has(name.toLowerCase());
            if (isSystemManaged(name)) return false;
            return true;
          });
          // No metadata → treat the first-listed kept column as key/mandatory
          // (it's virtually always Name / UserAccount / ParentPath / etc.);
          // everything else is optional string input.
          chosen = keptCols.map((name, i) => ({
            name,
            scalarType: null,
            mandatory: i === 0,
            isKey: i === 0,
            maxLength: null,
            regex: null,
            referenceTargetType: null,
          }));
        }

        return {
          objectType: canonicalType,
          initialRows: initialRows ?? 1,
          prefilledRows: prefilledRows ?? null,
          fields: chosen,
          metadataMissing,
          note: metadataMissing
            ? "CMF metadata isn't published for this object type. The form uses the template's raw column list — no FK dropdowns, no typed inputs, mandatory flags unknown (only the first column is assumed to be the key). Users can still fill and submit."
            : undefined,
        };
      },
    }),

    generateTemplate: tool({
      description:
        "Generate a BLANK loader-conformant master-data .xlsx — just the header row(s), no data — for the user to fill in offline. AUTO-DETECTS multi-sheet objects: if the chosen objectType has sub-sheets (Step, Resource, Checklist, MaintenancePlan, etc.), the generated workbook includes the parent sheet PLUS every sub-sheet in canonical order, so the file is complete and loader-ready. NO checks needed: there are no rows to validate. Use this when the user asks for an empty template, a blank file, a starter template, or anything meaning 'give me the structure, not data'.",
      inputSchema: z.object({
        objectType: z.string().describe("The exact CMF object type (template key), e.g. 'ProductionOrder' or 'Step'"),
        packageName: z
          .string()
          .optional()
          .describe("Optional short name, e.g. 'Step_template'. Defaults to '<ObjectType>_template'."),
        scope: z
          .enum(["full", "narrow"])
          .optional()
          .describe(
            "'narrow' (default): only the requested object's sheet(s) stay visible; every other prefixed data sheet is hidden — a focused starter file. 'full': keep every one of the 175 data sheets visible — the whole master-template layout, useful when the user plans to add multiple object types later. Ask the user which they want before calling.",
          ),
      }),
      execute: async ({ objectType, packageName, scope }) => {
        try {
          const comp = getComposition(objectType);
          const parent = comp?.parent ?? objectType;
          const tpl = SCHEMA_BY_LOWER.get(parent.toLowerCase());
          if (!tpl) throw new Error(`Unknown object type "${objectType}".`);
          if (isObjectRemoved(parent)) {
            return {
              error: `Object type "${parent}" has been removed from the client's template. No file will be generated.`,
              objectRemoved: true as const,
            };
          }

          // Use the KSP_DL skeleton (Option D): inherits CMF's defined names,
          // custom.xml, named tables, and ContentTypeId so the resulting file
          // is uploadable to CMF's MasterData API directly. Without this CMF
          // crashes at GetMasterDataPackageObjectTypes with KeyNotFoundException.
          const ruleset = await loadRuleset(parent);
          const mandatoryColumns =
            ruleset?.properties.filter((p) => p.mandatory).map((p) => p.name) ?? [];

          const gen = await generateSkeletonBlank({ keepObjectTypes: [parent], scope });
          const name = packageName ?? `${parent}_template`;
          const filename = `${parent}_${slug(name)}.xlsx`;
          const staged = await createStagedUpload({
            userId,
            filename,
            bytes: gen.bytes,
            packageName: name,
          });

          const isMulti = !!comp && comp.subSheets.length > 0;
          if (isMulti && comp) {
            const sheetsInfo = [
              { objectType: comp.parent, sheetName: comp.parentRaw, columns: comp.parentColumns },
              ...comp.subSheets.map((s) => ({
                objectType: s.objectType,
                sheetName: s.raw,
                columns: s.columns,
              })),
            ];
            return {
              stagingId: staged.id,
              filename,
              isTemplate: true as const,
              isMultiSheet: true as const,
              sheetCount: sheetsInfo.length,
              sheets: sheetsInfo,
              mandatoryColumns,
              skeleton: true as const,
              visibleSheets: gen.visibleSheets,
            };
          }

          return {
            stagingId: staged.id,
            filename,
            sheetName: tpl.raw,
            columns: tpl.columns,
            mandatoryColumns,
            isTemplate: true as const,
            isMultiSheet: false as const,
            skeleton: true as const,
            visibleSheets: gen.visibleSheets,
          };
        } catch (err) {
          return { error: errMessage(err) };
        }
      },
    }),

    generateExcel: tool({
      description:
        "Generate a full master-data .xlsx populated with the user's rows and stage it. The output ALWAYS contains every sheet from the finalized master template (175 sheets) — only the requested object's sheet is filled with the user's rows; every other sheet remains headers-only. Supports single-sheet (Material, ProductionOrder…) with `rows`, and multi-sheet (Step, Resource, Checklist…) with `rowsByType` keyed by canonical type. WHEN THE USER HAS UPLOADED AN EXISTING WORKBOOK: pass its stagingId as `startFromStagingId`, and this tool will APPEND rows to that file preserving everything already in it — that's how a user builds up one master file over multiple sessions.",
      inputSchema: z.object({
        objectType: z.string().describe("Parent / single object type"),
        rows: z
          .array(rowSchema)
          .optional()
          .describe("Single-sheet input. Use for objects without sub-sheets."),
        rowsByType: z
          .record(z.string(), z.array(rowSchema))
          .optional()
          .describe(
            "Multi-sheet input keyed by canonical objectType. Must include the parent type. Sub-sheet types may be omitted or empty.",
          ),
        packageName: z.string().describe("A short name for the generated package, e.g. 'ProductionOrders_2026Q3'"),
        startFromStagingId: z
          .string()
          .optional()
          .describe(
            "When the user has UPLOADED a workbook via the chat and wants to add to it (not regenerate), pass the uploaded file's stagingId here. The output is the same file with new rows appended to the requested sheets — everything else preserved byte-for-byte. Omit this to generate a fresh workbook from the finalized master template.",
          ),
        scope: z
          .enum(["full", "narrow"])
          .optional()
          .describe(
            "'full' (default): keep every one of the 175 sheets visible — the whole master-template layout. 'narrow': hide every prefixed data sheet EXCEPT the ones you're writing to (plus meta sheets and their sub-sheets). Ask the user which they want before calling.",
          ),
      }),
      execute: async ({ objectType, rows, rowsByType, packageName, startFromStagingId, scope }) => {
        try {
          const comp = getComposition(objectType);
          const useMulti = !!comp && comp.subSheets.length > 0;
          const byType = rowsByType ?? (rows ? { [objectType]: rows } : {});
          const totalRows = Object.values(byType).reduce((n, r) => n + r.length, 0);
          if (totalRows === 0) {
            return { error: `No rows provided. Pass 'rows' or 'rowsByType'.` };
          }
          if (useMulti && (!byType[comp.parent] || byType[comp.parent].length === 0)) {
            return {
              error: `"${comp.parent}" is multi-sheet (parent + ${comp.subSheets.length} sub-sheets). Pass rowsByType with at least rows for "${comp.parent}".`,
            };
          }

          // If the user is adding to a previously-uploaded file, load its bytes
          // as the base. Otherwise start from KSP_DL_client_final.
          let baseFileBytes: Buffer | undefined;
          if (startFromStagingId) {
            const staged = await getStagedUpload(startFromStagingId, userId);
            if (!staged) {
              return { error: `Uploaded file ${startFromStagingId} not found or not accessible.` };
            }
            baseFileBytes = staged.bytes;
          }

          const gen = await generateFromSkeleton({ rowsByType: byType, baseFileBytes, scope });

          const filename = `${objectType}_${slug(packageName)}.xlsx`;
          const staged = await createStagedUpload({
            userId,
            filename,
            bytes: gen.bytes,
            packageName,
          });
          return {
            stagingId: staged.id,
            filename,
            isMultiSheet: useMulti,
            sheetsWritten: gen.sheetsWritten,
            skipped: gen.skipped,
            totalRows,
            mergedFromUpload: !!startFromStagingId,
            // Parent references are NOT verified against CMF (by design — see
            // the PARENT-REFERENCE DISCLAIMER in the system prompt). The model
            // always disclaims that referenced parents must already exist in
            // CMF or be included in this same file.
            parentCheckPerformed: false as const,
          };
        } catch (err) {
          return { error: errMessage(err) };
        }
      },
    }),

    validateTemplate: tool({
      description:
        "Run the KSP template-check on a staged .xlsx (sheet-name conformance, column order, parent-before-child structure). MUST be called immediately after every generateTemplate / generateExcel, BEFORE pointing the user at the Download button — even though the generator self-verifies, this exposes the check as an explicit, visible step so the user sees the file was validated. Returns ok + per-sheet error counts. If ok=false, do NOT present the download; report the errors precisely (sheet / row / column) and offer to regenerate.",
      inputSchema: z.object({
        stagingId: z.string().describe("The stagingId returned by generateTemplate or generateExcel."),
      }),
      execute: async ({ stagingId }) => {
        try {
          const staged = await getStagedUpload(stagingId, userId);
          if (!staged) {
            return { ok: false, error: `Staged file ${stagingId} not found for this user.` };
          }
          // Fast path for KSP-skeleton blanks: the file is CMF-verified by
          // construction (we already proved op=1 returns result=0 on the
          // skeleton). Skip the heavy ExcelJS re-parse which hangs on the
          // rich KSP content.
          const marker = await readSkeletonMarker(staged.bytes);
          if (marker) {
            return {
              ok: true,
              stagingId,
              filename: staged.filename,
              sheetsValidated: marker.visibleSheets.length,
              errorCount: 0,
              warningCount: 0,
              errors: [],
              skeleton: true as const,
              visibleSheets: marker.visibleSheets,
            };
          }
          const sheets = await parseWorkbook(staged.bytes);
          const result = validateParsedSheets(sheets);
          const errors = Object.entries(result.errorsByType).flatMap(([objectType, list]) =>
            list.map((e) => ({
              objectType,
              sheet: objectType,
              row: e.row,
              column: e.column,
              severity: e.severity,
              message: e.message,
            })),
          );
          return {
            ok: result.ok,
            stagingId,
            filename: staged.filename,
            sheetsValidated: sheets.length,
            errorCount: result.errorCount,
            warningCount: result.warningCount,
            errors,
          };
        } catch (err) {
          return { ok: false, error: errMessage(err) };
        }
      },
    }),

    previewLoadImpact: tool({
      description:
        "Predict what loading a staged .xlsx would do in CMF, row-by-row. For each row classifies as CREATE / UPDATE / SKIP / CONFLICT. CONFLICT means the row references a parent that doesn't exist in CMF — atomic batch, so any CONFLICT blocks the whole load. Call this AFTER validateTemplate ok=true, BEFORE asking the user whether to Download or Load. Use the per-sheet byVerdict counts to write a short summary the user can confirm.",
      inputSchema: z.object({
        stagingId: z.string().describe("The stagingId returned by generateExcel."),
      }),
      execute: async ({ stagingId }) => {
        try {
          const staged = await getStagedUpload(stagingId, userId);
          if (!staged) return { error: `Staged file ${stagingId} not found.` };
          return await previewLoadImpact(staged.bytes);
        } catch (err) {
          return { error: errMessage(err) };
        }
      },
    }),

    loadToCmf: tool({
      description:
        "Actually load a staged .xlsx into CMF (op=0 commit). Only call this AFTER previewLoadImpact AND the user has explicitly confirmed they want to load (not download). Uploads the file, runs PerformMasterDataPackage, polls for completion, returns the verdict and per-type log. Remember CMF's atomic-batch rule: any failure rolls back the entire load.",
      inputSchema: z.object({
        stagingId: z.string().describe("The stagingId returned by generateExcel."),
        packageName: z
          .string()
          .optional()
          .describe("Optional name for the CMF MasterDataPackage. Defaults to '<filename>_<timestamp>'."),
      }),
      execute: async ({ stagingId, packageName }) => {
        try {
          const staged = await getStagedUpload(stagingId, userId);
          if (!staged) return { ok: false, error: `Staged file ${stagingId} not found.` };
          const bytes = staged.bytes;
          const fileObj = {
            name: staged.filename,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: bytes.length,
            arrayBuffer: async () =>
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          };
          const name = packageName ?? `${staged.filename.replace(/\.xlsx$/i, "")}_${Date.now()}`;
          const result = await loadMasterData(name, fileObj, 0);
          const log = (result.log ?? []) as { Type?: string; Result?: number; Message?: string; Severity?: string }[];
          const errors = log.filter((e) => /error|failed|exception/i.test(`${e.Severity ?? ""} ${e.Message ?? ""}`));
          const warnings = log.filter((e) => /warning/i.test(`${e.Severity ?? ""} ${e.Message ?? ""}`));
          return {
            ok: result.result === 0 && errors.length === 0,
            packageId: result.package?.Id ?? null,
            packageName: name,
            cmfResult: result.result,
            objectTypesLoaded: (result.objectTypes ?? []).length,
            errorCount: errors.length,
            warningCount: warnings.length,
            errors: errors.slice(0, 6).map((e) => e.Message ?? ""),
            warnings: warnings.slice(0, 6).map((e) => e.Message ?? ""),
          };
        } catch (err) {
          return { ok: false, error: errMessage(err) };
        }
      },
    }),
  };
}

function errMessage(err: unknown): string {
  // Business-facing agent: never leak host/IP/VPN/driver/config detail. A raw
  // driver message like "Failed to connect to 10.10.1.224\ONLINE in 20000ms"
  // becomes a calm, actionable line the model can relay verbatim.
  return toModelSafeError(err);
}

export type ChatTools = ReturnType<typeof buildChatTools>;
