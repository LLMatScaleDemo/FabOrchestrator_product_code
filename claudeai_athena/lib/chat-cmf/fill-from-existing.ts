import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRuleset } from "@/lib/validation/metadata";
import { isObjectRemoved, getRemovedColumns } from "@/lib/validation/removal-policy";
import { physicalColumns, resolveRefJoins } from "@/lib/chat-cmf/cmf-schema-util";
import { generateFromSkeleton } from "@/lib/validation/ksp-skeleton";
import { createStagedUpload } from "@/lib/repo-cmf/validation";
import templateSchema from "@/lib/validation/template-schema.json";

/**
 * Auto-fill a master-data template from EXISTING CMF records.
 *
 * The user often wants to start from live data — "pre-fill a Resource template
 * with all resources in the Assembly area", "clone these 10 products",
 * "set Type=X on every product in group Y". This reads the real records and maps
 * CMF's PHYSICAL columns to the loadable TEMPLATE columns:
 *   - a template column that IS a physical column → copied straight across;
 *   - a template column that is a relationship → the numeric FK (`FlowId`) is
 *     resolved to the related object's NAME via join (so the template gets the
 *     name it expects, not an id);
 *   - anything with no source → left blank for the user to complete.
 *
 * The retrieved rows are written directly into the file and never pass through
 * the model, so the data is exactly what CMF holds (nothing invented). An
 * optional `set` applies a bulk change to every retrieved row before writing.
 */

const RESERVED = new Set(["$order", "$ambiguous"]);
const SCHEMA = templateSchema as unknown as Record<string, { raw: string; columns: string[] }>;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export type FillSelector = {
  /** Specific records by Name. */
  names?: string[];
  /** Or a filter: exact-match a field (direct column or a related object's Name). */
  filterColumn?: string;
  filterValue?: string;
  /** Or a keyword on Name/Description. */
  search?: string;
  limit?: number;
};

export type FetchTemplateRowsResult = {
  objectType: string;
  /** Template columns we could populate. */
  columnsFilled: string[];
  rows: Record<string, string>[];
  total: number;
  truncated: boolean;
  removed?: boolean;
  metadataMissing?: boolean;
  error?: string;
};

/**
 * Read existing records and return rows keyed by TEMPLATE column names (with
 * relationships resolved to names) — ready to hand to `generateFromSkeleton`.
 */
export async function fetchTemplateRows(
  objectType: string,
  selector: FillSelector = {},
): Promise<FetchTemplateRowsResult> {
  const limit = Math.min(Math.max(1, Math.floor(selector.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const empty = { objectType, columnsFilled: [], rows: [], total: 0, truncated: false };

  if (isObjectRemoved(objectType)) return { ...empty, removed: true };
  const entry = Object.entries(SCHEMA).find(
    ([k, v]) => !RESERVED.has(k) && k.toLowerCase() === objectType.toLowerCase() && v?.columns,
  );
  const templateCols = entry?.[1].columns;
  const canonical = entry?.[0] ?? objectType;
  if (!templateCols) return { ...empty, metadataMissing: true };

  const ruleset = await loadRuleset(canonical);
  if (!ruleset?.table) return { ...empty, metadataMissing: true };
  const { schema, name: table } = ruleset.table;

  const real = await physicalColumns(schema, table);
  const realLower = new Map(real.map((c) => [c.toLowerCase(), c]));
  const removedCols = getRemovedColumns(canonical);
  const refJoins = await resolveRefJoins(ruleset, realLower, removedCols);
  const refByProp = new Map(refJoins.map((j) => [j.prop.toLowerCase(), j]));

  // Map each template column to a SELECT expression (direct column or joined name).
  const base = "t";
  const selects: { label: string; expr: string }[] = [];
  const joins: string[] = [];
  for (const col of templateCols) {
    if (removedCols.has(col.toLowerCase())) continue;
    const directName = realLower.get(col.toLowerCase());
    if (directName) {
      selects.push({ label: col, expr: `${base}.[${directName}]` });
      continue;
    }
    const ref = refByProp.get(col.toLowerCase());
    if (ref) {
      const alias = `r${joins.length}`;
      joins.push(
        `left join [${ref.targetSchema}].[${ref.targetTable}] ${alias} on ${base}.[${ref.fkCol}] = ${alias}.[${ref.targetPk}]`,
      );
      selects.push({ label: col, expr: `${alias}.[Name]` });
    }
    // else: no source → left blank in the template.
  }
  if (selects.length === 0) return { ...empty, error: `Could not map any columns for "${canonical}".` };

  // ── WHERE ─────────────────────────────────────────────────────────────────
  const params: Record<string, string> = {};
  const where: string[] = [];
  if (selector.names?.length) {
    const ph = selector.names.slice(0, MAX_LIMIT).map((n, i) => {
      params[`n${i}`] = n;
      return `@n${i}`;
    });
    if (realLower.get("name")) where.push(`${base}.[${realLower.get("name")}] in (${ph.join(", ")})`);
  }
  if (selector.search?.trim()) {
    const cols = ["Name", "Description"]
      .map((c) => realLower.get(c.toLowerCase()))
      .filter((c): c is string => !!c);
    if (cols.length) {
      params.q = `%${selector.search.trim()}%`;
      where.push("(" + cols.map((c) => `${base}.[${c}] like @q`).join(" or ") + ")");
    }
  }
  if (selector.filterColumn && selector.filterValue != null) {
    params.fv = selector.filterValue;
    const ref = refByProp.get(selector.filterColumn.toLowerCase());
    const direct = realLower.get(selector.filterColumn.toLowerCase());
    if (ref) {
      const alias = `f${joins.length}`;
      joins.push(
        `left join [${ref.targetSchema}].[${ref.targetTable}] ${alias} on ${base}.[${ref.fkCol}] = ${alias}.[${ref.targetPk}]`,
      );
      where.push(`${alias}.[Name] = @fv`);
    } else if (direct) {
      where.push(`${base}.[${direct}] = @fv`);
    } else {
      return { ...empty, error: `"${canonical}" has no field called "${selector.filterColumn}".` };
    }
  }
  const joinSql = joins.length ? " " + joins.join(" ") : "";
  const whereSql = where.length ? ` where ${where.join(" and ")}` : "";

  const countRows = await cmfQuery<{ n: number }>(
    `select count(*) as n from [${schema}].[${table}] ${base}${joinSql}${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.n ?? 0);

  const orderCol = realLower.get("name");
  const select = selects.map((c) => `${c.expr} as [${c.label}]`).join(", ");
  const dataRows = await cmfQuery<Record<string, unknown>>(
    `select top ${limit} ${select} from [${schema}].[${table}] ${base}${joinSql}${whereSql}${orderCol ? ` order by ${base}.[${orderCol}]` : ""}`,
    params,
  );
  const rows = dataRows.map((r) => {
    const o: Record<string, string> = {};
    for (const c of selects) o[c.label] = r[c.label] == null ? "" : String(r[c.label]);
    return o;
  });

  return {
    objectType: canonical,
    columnsFilled: selects.map((c) => c.label),
    rows,
    total,
    truncated: total > rows.length,
  };
}

export type FillFromExistingResult = {
  stagingId?: string;
  filename?: string;
  objectType: string;
  rowCount: number;
  columnsFilled: string[];
  total: number;
  truncated: boolean;
  /** Columns changed by `set`, if any. */
  applied?: string[];
  removed?: boolean;
  metadataMissing?: boolean;
  error?: string;
};

/**
 * Retrieve existing records, optionally apply a bulk `set`, and generate a
 * pre-filled template staged for download. Single-sheet objects only for now
 * (the requested object's own sheet is filled).
 */
export async function fillFromExisting(input: {
  userId: string;
  objectType: string;
  selector?: FillSelector;
  /** Optional bulk change applied to every retrieved row (column → value). */
  set?: Record<string, string>;
  packageName: string;
  scope?: "full" | "narrow";
}): Promise<FillFromExistingResult> {
  const fetched = await fetchTemplateRows(input.objectType, input.selector);
  if (fetched.removed) return { ...fetched, rowCount: 0 };
  if (fetched.metadataMissing || fetched.error) return { ...fetched, rowCount: 0 };
  if (fetched.rows.length === 0) {
    return { ...fetched, rowCount: 0, error: "No matching records found." };
  }

  // Apply the bulk change to every retrieved row. Match an existing template
  // column case-insensitively when possible; otherwise add the key as-is
  // (generateFromSkeleton maps column names to the template case-insensitively).
  const applied: string[] = [];
  if (input.set) {
    for (const [k, v] of Object.entries(input.set)) {
      const target = fetched.columnsFilled.find((c) => c.toLowerCase() === k.toLowerCase()) ?? k;
      for (const row of fetched.rows) row[target] = v;
      applied.push(target);
    }
  }

  const gen = await generateFromSkeleton({
    rowsByType: { [fetched.objectType]: fetched.rows },
    scope: input.scope,
  });
  const filename = `${fetched.objectType}_${slug(input.packageName)}.xlsx`;
  const staged = await createStagedUpload({
    userId: input.userId,
    filename,
    bytes: gen.bytes,
    packageName: input.packageName,
  });

  return {
    stagingId: staged.id,
    filename,
    objectType: fetched.objectType,
    rowCount: fetched.rows.length,
    columnsFilled: fetched.columnsFilled,
    total: fetched.total,
    truncated: fetched.truncated,
    applied: applied.length ? applied : undefined,
  };
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "template";
}
