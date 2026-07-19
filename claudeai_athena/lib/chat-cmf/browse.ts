import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRuleset, type EntityRuleset } from "@/lib/validation/metadata";
import { isObjectRemoved, getRemovedColumns } from "@/lib/validation/removal-policy";
import templateSchema from "@/lib/validation/template-schema.json";

const SCHEMA = templateSchema as unknown as Record<string, { raw: string; columns: string[] }>;

/** Noisy columns that add no value to a browse list. */
const NOISE_RE = /url$|image|picture|icon|documentation|thumbnail/i;

/**
 * CMF database discovery lookup — the "help me find it" counterpart to
 * `lookupExisting` (which needs exact Names).
 *
 * A user often doesn't remember an exact record name ("what flows exist?",
 * "products and their flow", "which products use flow F1"). This browses ANY
 * object type's live CMF table read-only and returns a capped, ordered list of
 * records with useful fields — Name, Description, and RELATED OBJECT NAMES
 * (e.g. a product's Flow / ProductGroup), plus the total count.
 *
 * The CMF physical model stores references as numeric id columns (`FlowId`,
 * `ProductGroupId`, …), so a related object's NAME only exists after a join.
 * We resolve those joins, but only for references we can TRUST — CMF's property
 * metadata mis-maps many reference targets (e.g. `CapacityClass -> NonWorkingTime`),
 * so we keep a join only when the property name and its target type match
 * (Flow→Flow, ProductGroup→ProductGroup, …). That filters the garbage out.
 *
 * Safety:
 *   - Read-only. Every VALUE (search term, filter value) is a bound parameter.
 *   - Every COLUMN / table identifier is validated against INFORMATION_SCHEMA —
 *     never taken raw from the model — so nothing can inject SQL.
 *   - Client-removed objects and columns are excluded; `limit` is a clamped int.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_COLUMNS = 8;

/** Physical columns CMF manages; never useful to display. */
const SYSTEM_RE =
  /^(Id|Version|UniversalState|RevisionState|IsDefaultRevision|CreatedBy|CreatedOn|ModifiedBy|ModifiedOn|Last[A-Z]|MainState|Locked(By|On)?|IsLocked|Definition(Id)?|ChangeSet(Id)?|EntityPictureId|CorrelationID)/;

export type BrowseResult = {
  objectType: string;
  columns: string[];
  rows: Record<string, string>[];
  total: number;
  returned: number;
  truncated: boolean;
  metadataMissing?: boolean;
  removed?: boolean;
  error?: string;
};

export type BrowseInput = {
  objectType: string;
  search?: string;
  filterColumn?: string;
  filterValue?: string;
  columns?: string[];
  limit?: number;
};

async function physicalColumns(schema: string, table: string): Promise<string[]> {
  const rows = await cmfQuery<{ COLUMN_NAME: string }>(
    `select COLUMN_NAME from INFORMATION_SCHEMA.COLUMNS where TABLE_SCHEMA = @s and TABLE_NAME = @t`,
    { s: schema, t: table },
  );
  return rows.map((r) => String(r.COLUMN_NAME));
}

/** A reference we trust enough to join for the target's Name. */
type RefJoin = {
  /** Display/property name, e.g. "Flow". */
  prop: string;
  /** Physical FK column on the base table, e.g. "FlowId". */
  fkCol: string;
  targetSchema: string;
  targetTable: string;
  /** Target PK column, e.g. "FlowId". */
  targetPk: string;
};

/** prop and target name must overlap — filters CMF's mis-mapped reference metadata. */
function nameMatches(prop: string, target: string): boolean {
  const p = prop.toLowerCase();
  const t = target.toLowerCase();
  return p === t || p.includes(t) || t.includes(p);
}

/**
 * Resolve which reference properties can be joined to show a related NAME.
 * Only keeps references where the FK column exists, the target has a table with
 * a `<Target>Id` PK, and the names match (trustworthy).
 */
async function resolveRefJoins(
  ruleset: EntityRuleset,
  realLower: Map<string, string>,
  removedCols: Set<string>,
): Promise<RefJoin[]> {
  const out: RefJoin[] = [];
  const seenTargets = new Map<string, { schema: string; table: string; pk: string } | null>();

  for (const p of ruleset.properties) {
    const target = p.referenceTargetType;
    if (!target) continue;
    if (removedCols.has(p.name.toLowerCase())) continue;
    if (!nameMatches(p.name, target)) continue;
    const fkCol = realLower.get(`${p.name.toLowerCase()}id`);
    if (!fkCol) continue;

    let tgt = seenTargets.get(target.toLowerCase());
    if (tgt === undefined) {
      tgt = null;
      const tr = await loadRuleset(target);
      if (tr?.table) {
        const tcols = await physicalColumns(tr.table.schema, tr.table.name);
        const pk = tcols.find((c) => c.toLowerCase() === `${target.toLowerCase()}id`);
        if (pk) tgt = { schema: tr.table.schema, table: tr.table.name, pk };
      }
      seenTargets.set(target.toLowerCase(), tgt);
    }
    if (!tgt) continue;
    out.push({ prop: p.name, fkCol, targetSchema: tgt.schema, targetTable: tgt.table, targetPk: tgt.pk });
  }
  return out;
}

export async function browseCmfRecords(input: BrowseInput): Promise<BrowseResult> {
  const { objectType } = input;
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const empty = { objectType, columns: [], rows: [], total: 0, returned: 0, truncated: false };

  if (isObjectRemoved(objectType)) return { ...empty, removed: true };

  const ruleset = await loadRuleset(objectType);
  if (!ruleset?.table) return { ...empty, metadataMissing: true };

  const { schema, name: table } = ruleset.table;
  const real = await physicalColumns(schema, table);
  const realLower = new Map(real.map((c) => [c.toLowerCase(), c]));
  const removedCols = getRemovedColumns(objectType);
  const direct = (c: string): string | undefined => {
    const r = realLower.get(c.toLowerCase());
    return r && !removedCols.has(r.toLowerCase()) ? r : undefined;
  };

  const refJoins = await resolveRefJoins(ruleset, realLower, removedCols);
  const refByProp = new Map(refJoins.map((j) => [j.prop.toLowerCase(), j]));

  // ── choose display columns ────────────────────────────────────────────────
  // Each is either a direct base column or a joined reference name.
  type Col = { label: string; expr: string };
  const base = "t";
  const directCol = (c: string): Col => ({ label: c, expr: `${base}.[${c}]` });
  const refCol = (j: RefJoin, alias: string): Col => ({ label: j.prop, expr: `${alias}.[Name]` });

  const chosen: Col[] = [];
  const joins: string[] = [];
  const usedLabels = new Set<string>();
  const addRefJoin = (j: RefJoin): Col => {
    const alias = `r${joins.length}`;
    joins.push(
      `left join [${j.targetSchema}].[${j.targetTable}] ${alias} on ${base}.[${j.fkCol}] = ${alias}.[${j.targetPk}]`,
    );
    return refCol(j, alias);
  };

  if (input.columns?.length) {
    for (const req of input.columns) {
      if (usedLabels.has(req.toLowerCase())) continue;
      const j = refByProp.get(req.toLowerCase());
      const d = direct(req);
      if (j) chosen.push(addRefJoin(j));
      else if (d) chosen.push(directCol(d));
      usedLabels.add(req.toLowerCase());
    }
  } else {
    const push = (c: Col | undefined) => {
      if (c && !usedLabels.has(c.label.toLowerCase())) {
        chosen.push(c);
        usedLabels.add(c.label.toLowerCase());
      }
    };
    push(direct("Name") ? directCol(direct("Name")!) : undefined);
    push(direct("Description") ? directCol(direct("Description")!) : undefined);
    for (const j of refJoins) if (chosen.length < MAX_COLUMNS) push(addRefJoin(j));
    // Fill remaining with meaningful scalar business columns — prefer the
    // client-curated template columns, then others; skip id/system/noise.
    const curated = new Set((SCHEMA[ruleset.objectType]?.columns ?? []).map((c) => c.toLowerCase()));
    const scalarOrder = [
      ...real.filter((c) => curated.has(c.toLowerCase())),
      ...real.filter((c) => !curated.has(c.toLowerCase())),
    ];
    for (const c of scalarOrder) {
      if (chosen.length >= MAX_COLUMNS) break;
      if (SYSTEM_RE.test(c) || /Id$/.test(c) || NOISE_RE.test(c) || removedCols.has(c.toLowerCase())) continue;
      push(directCol(c));
    }
  }
  if (chosen.length === 0 && direct("Name")) chosen.push(directCol(direct("Name")!));
  const display = chosen.slice(0, MAX_COLUMNS);

  // ── WHERE ─────────────────────────────────────────────────────────────────
  const params: Record<string, string> = {};
  const where: string[] = [];
  if (input.search?.trim()) {
    const cols = ["Name", "Description"].map(direct).filter((c): c is string => !!c);
    if (cols.length) {
      params.q = `%${input.search.trim()}%`;
      where.push("(" + cols.map((c) => `${base}.[${c}] like @q`).join(" or ") + ")");
    }
  }
  if (input.filterColumn && input.filterValue != null) {
    params.fv = input.filterValue;
    const j = refByProp.get(input.filterColumn.toLowerCase());
    const d = direct(input.filterColumn);
    if (j) {
      // reverse lookup by related NAME (e.g. products where Flow = 'F1')
      const alias = `f${joins.length}`;
      joins.push(
        `left join [${j.targetSchema}].[${j.targetTable}] ${alias} on ${base}.[${j.fkCol}] = ${alias}.[${j.targetPk}]`,
      );
      where.push(`${alias}.[Name] = @fv`);
    } else if (d) {
      where.push(`${base}.[${d}] = @fv`);
    } else {
      return { ...empty, error: `"${objectType}" has no field called "${input.filterColumn}".` };
    }
  }
  const joinSql = joins.length ? " " + joins.join(" ") : "";
  const whereSql = where.length ? ` where ${where.join(" and ")}` : "";

  // ── query ─────────────────────────────────────────────────────────────────
  const countRows = await cmfQuery<{ n: number }>(
    `select count(*) as n from [${schema}].[${table}] ${base}${joinSql}${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.n ?? 0);

  const orderCol = direct("Name");
  const select = display.map((c) => `${c.expr} as [${c.label}]`).join(", ");
  const dataRows = await cmfQuery<Record<string, unknown>>(
    `select top ${limit} ${select} from [${schema}].[${table}] ${base}${joinSql}${whereSql}${orderCol ? ` order by ${base}.[${orderCol}]` : ""}`,
    params,
  );
  const rows = dataRows.map((r) => {
    const o: Record<string, string> = {};
    for (const c of display) o[c.label] = r[c.label] == null ? "" : String(r[c.label]);
    return o;
  });

  return {
    objectType: ruleset.objectType,
    columns: display.map((c) => c.label),
    rows,
    total,
    returned: rows.length,
    truncated: total > rows.length,
  };
}
