import { cmfQuery } from "@/lib/cmf/cmf-sql";
import { loadRuleset, type EntityRuleset } from "@/lib/validation/metadata";
import type { ParsedSheet, ValidationError, ValidationResult } from "@/lib/validation/types";

/**
 * Cross-sheet integrity checks — the layer the per-sheet rule engine can't do,
 * because a violation only shows up when TWO sheets are compared:
 *
 *   1. PK uniqueness  — the key column(s) of a sheet must not repeat within that
 *      sheet (CMF keys are unique; two rows with the same Name always collide).
 *   2. FK / key consistency — every foreign-key value a child sheet references
 *      must resolve to a real parent, in one of: (a) the parent's own sheet in
 *      THIS file, or (b) live CMF. A value that resolves to neither is the
 *      classic "sheet 1 has PS1, sheet 2 says PS2" typo. When a close in-file
 *      parent exists we surface it as a "did you mean …" suggestion.
 *
 * Severity philosophy (kept false-positive-safe):
 *   - PK duplicates are ALWAYS blocking — deterministic, no CMF needed.
 *   - An unresolved FK is blocking ONLY when CMF was reachable and could
 *     confirm the parent is absent. When CMF is unreachable we downgrade to a
 *     warning, because the parent might legitimately already exist in CMF and
 *     we can't prove otherwise. Matching is case-insensitive to mirror CMF's
 *     collation, so casing differences never produce false positives.
 *
 * The core `checkCrossSheet` is PURE (parent existence injected) so it is fully
 * unit-testable without a database; `checkCrossSheetWithMetadata` is the async
 * wrapper that loads CMF rulesets + parent existence for the real callers.
 */

/** Non-printing separator so composite keys can't collide ("a"+"b" vs "ab"). */
const KEY_SEP = String.fromCharCode(1);

const norm = (v: unknown): string => String(v ?? "").trim();

/** Key columns for a type: metadata `isKey` props, else the conventional `Name`. */
function keyColumns(
  ruleset: EntityRuleset | null | undefined,
  headers: string[],
): string[] {
  const keys = ruleset?.properties.filter((p) => p.isKey).map((p) => p.name) ?? [];
  if (keys.length) return keys;
  const name = headers.find((h) => h.toLowerCase() === "name");
  return name ? [name] : [];
}

/** Read a column from a row case-insensitively (headers vary in casing). */
function cell(row: Record<string, string>, column: string): string {
  if (column in row) return norm(row[column]);
  const lc = column.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return norm(row[k]);
  return "";
}

/** Composite key value for a row (key columns joined), or "" if entirely blank. */
function rowKey(row: Record<string, string>, cols: string[]): string {
  const parts = cols.map((c) => cell(row, c));
  return parts.some((p) => p) ? parts.join(KEY_SEP) : "";
}

/** Human-readable form of a composite key value. */
function displayKey(key: string): string {
  return key.split(KEY_SEP).join(" + ");
}

/** Cheap bounded edit distance for "did you mean" suggestions. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/** Nearest in-file parent name to `value`, within a small edit distance. */
function nearest(value: string, candidates: string[]): string | undefined {
  const v = value.toLowerCase();
  let best: string | undefined;
  let bestD = Infinity;
  const cap = Math.max(2, Math.floor(v.length / 3));
  for (const c of candidates) {
    const d = editDistance(v, c.toLowerCase());
    if (d < bestD && d <= cap) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Parent-existence probe: is `valueLower` a known parent of `targetType` in CMF? */
export type ParentInCmf = (targetType: string, valueLower: string) => boolean;

export type CrossSheetOptions = {
  /** Case-insensitive CMF existence probe. Omit when CMF wasn't consulted. */
  parentInCmf?: ParentInCmf;
  /** False when CMF lookups failed/were skipped — unresolved FKs become warnings. */
  cmfReachable?: boolean;
};

/**
 * Pure cross-sheet validator. `rulesetFor` supplies (possibly null) CMF metadata
 * per object type; when null for a type, FK checks for that type are skipped and
 * only the `Name`-based PK check runs.
 */
export function checkCrossSheet(
  sheets: ParsedSheet[],
  rulesetFor: (objectType: string) => EntityRuleset | null | undefined,
  opts: CrossSheetOptions = {},
): ValidationError[] {
  const errors: ValidationError[] = [];
  const cmfReachable = opts.cmfReachable ?? false;

  // Index each type's in-file key values (lower -> canonical spelling) so FK
  // checks in other sheets can resolve against them.
  const parentKeys = new Map<string, Map<string, string>>();
  for (const sheet of sheets) {
    const cols = keyColumns(rulesetFor(sheet.objectType), sheet.headers);
    if (!cols.length) continue;
    const idx = parentKeys.get(sheet.objectType.toLowerCase()) ?? new Map<string, string>();
    for (const row of sheet.rows) {
      const k = rowKey(row, cols);
      if (k) idx.set(k.toLowerCase(), k);
    }
    parentKeys.set(sheet.objectType.toLowerCase(), idx);
  }

  // 1. PK uniqueness within each sheet.
  for (const sheet of sheets) {
    const cols = keyColumns(rulesetFor(sheet.objectType), sheet.headers);
    if (!cols.length) continue;
    const firstSeen = new Map<string, number>();
    sheet.rows.forEach((row, i) => {
      const k = rowKey(row, cols);
      if (!k) return;
      const lk = k.toLowerCase();
      const prior = firstSeen.get(lk);
      if (prior === undefined) {
        firstSeen.set(lk, i + 1);
        return;
      }
      const label = cols.length > 1 ? "key" : cols[0];
      errors.push({
        objectType: sheet.objectType,
        row: i + 1,
        column: cols.join(" + "),
        severity: "error",
        category: "pk-duplicate",
        message: `Duplicate ${label} "${displayKey(k)}" — already used on row ${prior}. Each ${sheet.objectType} must have a unique key.`,
      });
    });
  }

  // 2. FK / key consistency across sheets.
  for (const sheet of sheets) {
    const ruleset = rulesetFor(sheet.objectType);
    if (!ruleset) continue;
    const fkProps = ruleset.properties.filter((p) => p.referenceTargetType);
    if (!fkProps.length) continue;

    for (const prop of fkProps) {
      const target = prop.referenceTargetType!;
      const inFile = parentKeys.get(target.toLowerCase());
      const candidates = inFile ? [...inFile.values()] : [];

      sheet.rows.forEach((row, i) => {
        const v = cell(row, prop.name);
        if (!v) return;
        const lv = v.toLowerCase();

        if (inFile?.has(lv)) return; // resolves to a parent in this file
        if (opts.parentInCmf?.(target, lv)) return; // resolves to a parent in CMF

        // Unresolved. Suggest the nearest in-file parent, if any.
        const hint = nearest(v, candidates);
        const suggestion = hint ? ` Did you mean "${hint}"?` : "";
        const where = cmfReachable
          ? `isn't defined in the ${target} sheet or in CMF`
          : `isn't defined in the ${target} sheet (and CMF couldn't be checked)`;
        errors.push({
          objectType: sheet.objectType,
          row: i + 1,
          column: prop.name,
          severity: cmfReachable ? "error" : "warning",
          category: "cross-sheet-fk",
          message: `${prop.name} "${v}" ${where}.${suggestion}`,
        });
      });
    }
  }

  return errors;
}

/**
 * Async wrapper for real callers: loads CMF rulesets for every sheet's type and
 * a case-insensitive CMF parent-existence probe, then runs `checkCrossSheet`.
 * Degrades gracefully — if CMF is unreachable, rulesets are null (FK skipped,
 * PK still enforced) and any unresolved FK becomes a warning, never a false
 * blocking error.
 */
/** Default cap on how long the CMF-metadata cross-sheet work may take before
 *  we fall back to the offline (PK-only) check, so an upload never hangs on a
 *  slow/unreachable CMF (the single connect timeout can be ~20s). */
const CROSS_SHEET_TIMEOUT_MS = Number(process.env.CROSS_SHEET_TIMEOUT_MS ?? "8000");

export async function checkCrossSheetWithMetadata(
  sheets: ParsedSheet[],
  timeoutMs: number = CROSS_SHEET_TIMEOUT_MS,
): Promise<ValidationError[]> {
  // Only sheets that actually contain data can have PK/FK problems. A full
  // master-data workbook has ~250 sheets but a real upload fills only a handful;
  // loading CMF metadata for every empty sheet is what made validation crawl.
  const dataSheets = sheets.filter((s) => s.rows.length > 0);
  if (dataSheets.length === 0) return [];

  // If CMF is slow/unreachable, don't block the upload — fall back to the
  // offline PK-uniqueness check (no metadata) once the timeout elapses.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offlineFallback = new Promise<ValidationError[]>((resolve) => {
    timer = setTimeout(() => resolve(checkCrossSheet(dataSheets, () => null, { cmfReachable: false })), timeoutMs);
  });
  const result = await Promise.race([runWithMetadata(dataSheets), offlineFallback]);
  if (timer) clearTimeout(timer);
  return result;
}

async function runWithMetadata(dataSheets: ParsedSheet[]): Promise<ValidationError[]> {
  const rulesets = new Map<string, EntityRuleset | null>();
  let cmfReachable = true;

  // Load each distinct type's ruleset once, in parallel, so latency doesn't
  // stack up across the (few) data sheets.
  const distinctTypes = [...new Set(dataSheets.map((s) => s.objectType.toLowerCase()))];
  const typeByLower = new Map(dataSheets.map((s) => [s.objectType.toLowerCase(), s.objectType]));
  await Promise.all(
    distinctTypes.map(async (key) => {
      try {
        rulesets.set(key, await loadRuleset(typeByLower.get(key)!));
      } catch {
        rulesets.set(key, null);
        cmfReachable = false;
      }
    }),
  );

  const rulesetFor = (t: string) => rulesets.get(t.toLowerCase()) ?? null;

  // Build a case-insensitive CMF existence set for every referenced parent type.
  // Batched Name lookups against the parent's physical table.
  const cmfParents = new Map<string, Set<string>>();
  if (cmfReachable) {
    const wantedByTarget = new Map<string, Set<string>>();
    for (const s of dataSheets) {
      const rs = rulesetFor(s.objectType);
      if (!rs) continue;
      for (const p of rs.properties) {
        if (!p.referenceTargetType) continue;
        const set = wantedByTarget.get(p.referenceTargetType) ?? new Set<string>();
        for (const row of s.rows) {
          const v = cell(row, p.name);
          if (v) set.add(v);
        }
        wantedByTarget.set(p.referenceTargetType, set);
      }
    }

    for (const [target, values] of wantedByTarget) {
      if (values.size === 0) continue;
      try {
        const parentRs = rulesetFor(target) ?? (await loadRuleset(target));
        if (!parentRs?.table) continue;
        const found = new Set<string>();
        const list = [...values];
        for (let i = 0; i < list.length; i += 500) {
          const chunk = list.slice(i, i + 500);
          const params: Record<string, string> = {};
          const ph = chunk.map((v, idx) => {
            params[`v${idx}`] = v;
            return `@v${idx}`;
          });
          const rows = await cmfQuery<{ Name: string }>(
            `select Name from [${parentRs.table.schema}].[${parentRs.table.name}] where Name in (${ph.join(",")})`,
            params,
          );
          for (const r of rows) found.add(String(r.Name).toLowerCase());
        }
        cmfParents.set(target.toLowerCase(), found);
      } catch {
        cmfReachable = false;
      }
    }
  }

  const parentInCmf: ParentInCmf = (target, valueLower) =>
    cmfParents.get(target.toLowerCase())?.has(valueLower) ?? false;

  return checkCrossSheet(dataSheets, rulesetFor, { parentInCmf, cmfReachable });
}

/**
 * Fold cross-sheet findings into an existing structural ValidationResult,
 * recomputing counts and the `ok` gate. Returns the original result unchanged
 * when there are no extra findings.
 */
export function mergeFindings(
  result: ValidationResult,
  extra: ValidationError[],
): ValidationResult {
  if (extra.length === 0) return result;

  const errorsByType: Record<string, ValidationError[]> = {};
  for (const [k, v] of Object.entries(result.errorsByType)) errorsByType[k] = [...v];
  for (const e of extra) (errorsByType[e.objectType] ??= []).push(e);

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
