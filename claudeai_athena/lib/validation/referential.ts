import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRulesets } from "@/lib/validation/metadata";
import type { ParentExists } from "@/lib/validation/rule-engine";

/**
 * Builds a synchronous parent-existence resolver for the rule engine. A
 * referenced parent counts as existing if its key value is present in the
 * uploaded file (another sheet) OR already in CMF. CMF lookups are batched per
 * target type against the parent's physical table (key column `Name`).
 */

async function lookupExistingNames(
  schema: string,
  table: string,
  values: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const params: Record<string, string> = {};
    const placeholders = chunk.map((v, idx) => {
      params[`v${idx}`] = v;
      return `@v${idx}`;
    });
    const rows = await cmfQuery<{ Name: string }>(
      `select Name from [${schema}].[${table}] where Name in (${placeholders.join(",")})`,
      params,
    );
    for (const r of rows) found.add(String(r.Name).toLowerCase());
  }
  return found;
}

export async function buildParentIndex(
  references: { targetType: string; values: Set<string> }[],
  fileKeysByType: Map<string, Set<string>>,
): Promise<ParentExists> {
  const known = new Map<string, Set<string>>(); // targetType(lower) -> existing values(lower)

  // Preload all referenced-target rulesets in one bulk call (was: one loadRuleset
  // per target, each up to ~4 sequential CMF round-trips).
  const rulesetMap = await loadRulesets([...new Set(references.map((r) => r.targetType))]);

  for (const ref of references) {
    const key = ref.targetType.toLowerCase();
    const set = known.get(key) ?? new Set<string>();

    // 1) values defined within the uploaded file
    const fileSet = fileKeysByType.get(key);
    if (fileSet) for (const v of fileSet) set.add(v.toLowerCase());

    // 2) the rest: check CMF
    const missing = [...ref.values].filter((v) => !set.has(v.toLowerCase()));
    if (missing.length > 0) {
      const rs = rulesetMap.get(key) ?? null;
      if (rs?.table) {
        const found = await lookupExistingNames(rs.table.schema, rs.table.name, missing);
        for (const v of found) set.add(v);
      }
    }
    known.set(key, set);
  }

  return (targetType, value) =>
    known.get(targetType.toLowerCase())?.has(value.toLowerCase()) ?? false;
}
