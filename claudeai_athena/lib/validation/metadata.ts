import { cmfQuery } from "@/lib/cmf/cmf-sql";

/**
 * Pre-flight validation rulesets sourced from CMF's OWN metadata, so the rules
 * we enforce are exactly CMF's rules. Handles the three object-model types:
 * Smart Table, Generic Table, and Entity. Each property carries the mandatory
 * flag, scalar type/size, optional regex, key flag, and — for reference columns
 * — the target entity type (used for parent/child key existence checks).
 */

export type PropertyRule = {
  name: string;
  mandatory: boolean;
  isKey: boolean;
  scalarType: string | null;
  scalarSize: number | null;
  validationRegex: string | null;
  /** Entity type this column references (parent), or null if not a reference. */
  referenceTargetType: string | null;
};

export type EntityModel = "smart" | "generic" | "entity";

export type EntityRuleset = {
  objectType: string;
  model: EntityModel;
  /** Physical table backing this object type, for live parent lookups. */
  table: { schema: string; name: string } | null;
  properties: PropertyRule[];
};

type RawProp = {
  Name: string;
  IsMandatory: boolean;
  IsKey: boolean | null;
  ScalarType: string | null;
  ScalarSize: number | null;
  ValidationRegex: string | null;
  RefTarget: string | null;
};

const SMART_SQL = `
  select p.Name, p.IsMandatory, p.IsKey, sc.Name as ScalarType, p.ScalarSize,
         p.ValidationRegex, ref.Name as RefTarget
  from dbo.T_SmartTableProperty p
  join dbo.T_SmartTable st on st.SmartTableId = p.SmartTableId
  left join dbo.T_ScalarType sc on sc.ScalarTypeId = p.ScalarTypeId
  left join dbo.T_EntityType ref on ref.EntityTypeId = p.ReferenceTypeId
  where st.Name = @name order by p.Position`;

const GENERIC_SQL = `
  select p.Name, p.IsMandatory, p.IsKey, sc.Name as ScalarType, p.ScalarSize,
         p.ValidationRegex, ref.Name as RefTarget
  from dbo.T_GenericTableProperty p
  join dbo.T_GenericTable gt on gt.GenericTableId = p.GenericTableId
  left join dbo.T_ScalarType sc on sc.ScalarTypeId = p.ScalarTypeId
  left join dbo.T_EntityType ref on ref.EntityTypeId = p.ReferenceTypeId
  where gt.Name = @name order by p.Position`;

const ENTITY_SQL = `
  select p.Name, p.IsMandatory, cast(0 as bit) as IsKey, sc.Name as ScalarType, p.ScalarSize,
         p.ValidationRegex, ref.Name as RefTarget
  from dbo.T_EntityTypeProperty p
  join dbo.T_EntityType et on et.EntityTypeId = p.EntityTypeId
  left join dbo.T_ScalarType sc on sc.ScalarTypeId = p.ScalarTypeId
  left join dbo.T_EntityType ref on ref.EntityTypeId = p.ReferencedObjectId
  where et.Name = @name and p.IsEnabled = 1 order by p.[Order]`;

function mapProps(rows: RawProp[]): PropertyRule[] {
  return rows.map((r) => ({
    name: r.Name,
    mandatory: !!r.IsMandatory,
    isKey: !!r.IsKey,
    scalarType: r.ScalarType,
    scalarSize: r.ScalarSize,
    validationRegex: r.ValidationRegex && r.ValidationRegex.trim() ? r.ValidationRegex : null,
    referenceTargetType: r.RefTarget,
  }));
}

async function resolvePhysicalTable(
  objectType: string,
  model: EntityModel,
): Promise<{ schema: string; name: string } | null> {
  const prefix = model === "smart" ? "T_ST_" : model === "generic" ? "T_GT_" : "T_";
  const rows = await cmfQuery<{ TABLE_SCHEMA: string; TABLE_NAME: string }>(
    `select TABLE_SCHEMA, TABLE_NAME from INFORMATION_SCHEMA.TABLES
     where TABLE_TYPE='BASE TABLE' and TABLE_NAME = @t`,
    { t: `${prefix}${objectType}` },
  );
  return rows[0] ? { schema: rows[0].TABLE_SCHEMA, name: rows[0].TABLE_NAME } : null;
}

const cache = new Map<string, EntityRuleset | null>();

/**
 * Build the ruleset for an object type, trying Smart → Generic → Entity. Cached
 * in-memory for the process lifetime; call `clearRulesetCache()` to refresh.
 */
export async function loadRuleset(objectType: string): Promise<EntityRuleset | null> {
  if (cache.has(objectType)) return cache.get(objectType) ?? null;

  const attempts: { model: EntityModel; sql: string }[] = [
    { model: "smart", sql: SMART_SQL },
    { model: "generic", sql: GENERIC_SQL },
    { model: "entity", sql: ENTITY_SQL },
  ];

  let ruleset: EntityRuleset | null = null;
  for (const a of attempts) {
    const rows = await cmfQuery<RawProp>(a.sql, { name: objectType });
    if (rows.length > 0) {
      ruleset = {
        objectType,
        model: a.model,
        table: await resolvePhysicalTable(objectType, a.model),
        properties: mapProps(rows),
      };
      break;
    }
  }

  cache.set(objectType, ruleset);
  return ruleset;
}

export function clearRulesetCache(): void {
  cache.clear();
}

/**
 * Columns to compare when deciding "is the incoming row an actual update or
 * a no-op?" — excludes the key (Name) and any column we can't meaningfully
 * diff (reference columns are kept; CMF stores parent's Name there too).
 * Returns the column names in the order CMF lists them.
 */
export function getDiffableColumns(ruleset: EntityRuleset): string[] {
  return ruleset.properties
    .filter((p) => p.name.toLowerCase() !== "name" && !p.isKey)
    .map((p) => p.name);
}
