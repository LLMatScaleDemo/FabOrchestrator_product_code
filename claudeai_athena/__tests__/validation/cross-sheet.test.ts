/**
 * Cross-sheet integrity validator tests — PK uniqueness + FK/key consistency.
 *
 * Run with: npx tsx --test __tests__/validation/cross-sheet.test.ts
 *
 * Uses node:test + node:assert/strict (no framework). The pure `checkCrossSheet`
 * takes injected rulesets + parent existence, so these run without a database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCrossSheet, mergeFindings } from "@/lib/validation/cross-sheet";
import type { EntityRuleset, PropertyRule } from "@/lib/validation/metadata";
import type { ParsedSheet, ValidationResult } from "@/lib/validation/types";

// ── builders ──────────────────────────────────────────────────────────────
function prop(name: string, extra: Partial<PropertyRule> = {}): PropertyRule {
  return {
    name,
    mandatory: false,
    isKey: false,
    scalarType: null,
    scalarSize: null,
    validationRegex: null,
    referenceTargetType: null,
    ...extra,
  };
}

function ruleset(objectType: string, properties: PropertyRule[]): EntityRuleset {
  return { objectType, model: "entity", table: { schema: "dbo", name: `T_${objectType}` }, properties };
}

function sheet(objectType: string, headers: string[], rows: Record<string, string>[]): ParsedSheet {
  return { objectType, headers, rows };
}

function lookup(map: Record<string, EntityRuleset | null>) {
  return (t: string) => map[t.toLowerCase()] ?? null;
}

// ── PK uniqueness ───────────────────────────────────────────────────────────
describe("PK uniqueness", () => {
  it("flags a duplicate Name within a sheet (blocking)", () => {
    const s = sheet("Site", ["Name", "Description"], [
      { Name: "SITE-A", Description: "x" },
      { Name: "SITE-B", Description: "y" },
      { Name: "SITE-A", Description: "z" },
    ]);
    const errs = checkCrossSheet([s], () => null);
    const pk = errs.filter((e) => e.category === "pk-duplicate");
    assert.equal(pk.length, 1);
    assert.equal(pk[0].severity, "error");
    assert.equal(pk[0].row, 3);
    assert.match(pk[0].message, /already used on row 1/);
  });

  it("is case-insensitive (SITE-A vs site-a collide)", () => {
    const s = sheet("Site", ["Name"], [{ Name: "SITE-A" }, { Name: "site-a" }]);
    const errs = checkCrossSheet([s], () => null);
    assert.equal(errs.filter((e) => e.category === "pk-duplicate").length, 1);
  });

  it("passes when all keys are unique", () => {
    const s = sheet("Site", ["Name"], [{ Name: "A" }, { Name: "B" }, { Name: "C" }]);
    assert.equal(checkCrossSheet([s], () => null).length, 0);
  });

  it("supports composite keys from metadata isKey flags", () => {
    const rs = ruleset("Pair", [prop("K1", { isKey: true }), prop("K2", { isKey: true })]);
    const s = sheet("Pair", ["K1", "K2"], [
      { K1: "a", K2: "1" },
      { K1: "a", K2: "2" },
      { K1: "a", K2: "1" }, // dup of row 1
    ]);
    const errs = checkCrossSheet([s], lookup({ pair: rs })).filter((e) => e.category === "pk-duplicate");
    assert.equal(errs.length, 1);
    assert.equal(errs[0].row, 3);
  });

  it("skips a sheet with no key column", () => {
    const s = sheet("NoKey", ["Foo", "Bar"], [{ Foo: "1" }, { Foo: "1" }]);
    assert.equal(checkCrossSheet([s], () => null).length, 0);
  });

  it("ignores blank key rows", () => {
    const s = sheet("Site", ["Name"], [{ Name: "" }, { Name: "" }]);
    assert.equal(checkCrossSheet([s], () => null).length, 0);
  });
});

// ── FK / key consistency across sheets ──────────────────────────────────────
describe("FK / cross-sheet key consistency", () => {
  const stepRs = ruleset("Step", [prop("Name")]);
  const reasonRs = ruleset("StepReason", [prop("Step", { referenceTargetType: "Step" }), prop("Reason")]);

  function multiSheet(childStepValue: string): ParsedSheet[] {
    return [
      sheet("Step", ["Name"], [{ Name: "PS1" }]),
      sheet("StepReason", ["Step", "Reason"], [{ Step: childStepValue, Reason: "R1" }]),
    ];
  }
  const rf = lookup({ step: stepRs, stepreason: reasonRs });

  it("passes when the child FK matches the in-file parent", () => {
    const errs = checkCrossSheet(multiSheet("PS1"), rf, { cmfReachable: true });
    assert.equal(errs.length, 0);
  });

  it("resolves case-insensitively (child ps1 -> parent PS1)", () => {
    const errs = checkCrossSheet(multiSheet("ps1"), rf, { cmfReachable: true });
    assert.equal(errs.length, 0);
  });

  it("BLOCKS a mismatch (parent PS1, child PS2) with a suggestion when CMF confirms absence", () => {
    const errs = checkCrossSheet(multiSheet("PS2"), rf, {
      cmfReachable: true,
      parentInCmf: () => false, // PS2 not in CMF either
    });
    const fk = errs.filter((e) => e.category === "cross-sheet-fk");
    assert.equal(fk.length, 1);
    assert.equal(fk[0].severity, "error");
    assert.equal(fk[0].objectType, "StepReason");
    assert.equal(fk[0].column, "Step");
    assert.equal(fk[0].row, 1);
    assert.match(fk[0].message, /Did you mean "PS1"\?/);
  });

  it("does NOT block when the referenced parent exists in CMF (not in file)", () => {
    const errs = checkCrossSheet(multiSheet("PS9"), rf, {
      cmfReachable: true,
      parentInCmf: (t, v) => t === "Step" && v === "ps9",
    });
    assert.equal(errs.filter((e) => e.category === "cross-sheet-fk").length, 0);
  });

  it("downgrades to a WARNING when CMF is unreachable (can't prove absence)", () => {
    const errs = checkCrossSheet(multiSheet("PS2"), rf, { cmfReachable: false });
    const fk = errs.filter((e) => e.category === "cross-sheet-fk");
    assert.equal(fk.length, 1);
    assert.equal(fk[0].severity, "warning");
    assert.match(fk[0].message, /couldn't be checked/);
  });

  it("skips FK checks for a type with no ruleset (PK still runs)", () => {
    const sheets = multiSheet("PS2");
    const errs = checkCrossSheet(sheets, lookup({ step: stepRs }), { cmfReachable: true });
    // StepReason has no ruleset -> FK skipped; no PK dup -> no errors at all.
    assert.equal(errs.length, 0);
  });

  it("ignores blank FK cells", () => {
    const sheets = [
      sheet("Step", ["Name"], [{ Name: "PS1" }]),
      sheet("StepReason", ["Step", "Reason"], [{ Step: "", Reason: "R1" }]),
    ];
    assert.equal(checkCrossSheet(sheets, rf, { cmfReachable: true }).length, 0);
  });

  it("reports each offending child row separately", () => {
    const sheets = [
      sheet("Step", ["Name"], [{ Name: "PS1" }]),
      sheet("StepReason", ["Step", "Reason"], [
        { Step: "PS1", Reason: "R1" },
        { Step: "PSX", Reason: "R2" },
        { Step: "PSY", Reason: "R3" },
      ]),
    ];
    const fk = checkCrossSheet(sheets, rf, { cmfReachable: true, parentInCmf: () => false })
      .filter((e) => e.category === "cross-sheet-fk");
    assert.equal(fk.length, 2);
    assert.deepEqual(fk.map((e) => e.row).sort(), [2, 3]);
  });
});

// ── mergeFindings ───────────────────────────────────────────────────────────
describe("mergeFindings", () => {
  it("recomputes ok/counts and blocks when a cross-sheet error is added", () => {
    const base: ValidationResult = { ok: true, errorsByType: {}, errorCount: 0, warningCount: 0, infoCount: 0 };
    const merged = mergeFindings(base, [
      { objectType: "StepReason", row: 1, column: "Step", severity: "error", message: "x", category: "cross-sheet-fk" },
    ]);
    assert.equal(merged.ok, false);
    assert.equal(merged.errorCount, 1);
    assert.equal(merged.errorsByType["StepReason"].length, 1);
  });

  it("returns the original result untouched when there are no extra findings", () => {
    const base: ValidationResult = { ok: true, errorsByType: {}, errorCount: 0, warningCount: 0, infoCount: 0 };
    assert.equal(mergeFindings(base, []), base);
  });

  it("a warning alone does not flip ok to false", () => {
    const base: ValidationResult = { ok: true, errorsByType: {}, errorCount: 0, warningCount: 0, infoCount: 0 };
    const merged = mergeFindings(base, [
      { objectType: "StepReason", row: 1, column: "Step", severity: "warning", message: "x", category: "cross-sheet-fk" },
    ]);
    assert.equal(merged.ok, true);
    assert.equal(merged.warningCount, 1);
  });
});
