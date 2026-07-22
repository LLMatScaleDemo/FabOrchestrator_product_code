/**
 * Excel package-integrity tests for Modeling Agent blank templates.
 *
 * These checks cover the OOXML inconsistencies that make desktop Excel show
 * "We found a problem with some content" even though the ZIP itself is valid.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { generateSkeletonBlank, generateFromSkeleton } from "@/lib/validation/ksp-skeleton";

const META_SHEETS = new Set([
  "Index",
  "Formats",
  "Assumptions",
  "Enums",
  "Config",
  "WorksheetNameMapping",
]);

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function lastRow(ref: string): number {
  const matches = [...ref.matchAll(/[A-Za-z]+(\d+)/g)];
  assert.ok(matches.length > 0, `Expected an A1-style reference, got "${ref}"`);
  return Math.max(...matches.map((match) => Number(match[1])));
}

async function assertDesktopExcelCompatible(bytes: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const contentTypes = await zip.file("[Content_Types].xml")!.async("text");
  assert.match(contentTypes, /<Default Extension="json" ContentType="application\/json"\/>/);
  assert.match(
    contentTypes,
    /<Default Extension="vml" ContentType="application\/vnd\.openxmlformats-officedocument\.vmlDrawing"\/>/,
  );

  const workbookXml = await zip.file("xl/workbook.xml")!.async("text");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("text");
  const targetById = new Map(
    [...workbookRelsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)]
      .map((match) => [match[1], match[2]] as const),
  );

  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    const name = decodeXml(sheet[1]);
    const target = targetById.get(sheet[2]);
    assert.ok(target, `Workbook relationship ${sheet[2]} is missing for sheet ${name}`);
    const worksheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const worksheetEntry = zip.file(worksheetPath);
    assert.ok(worksheetEntry, `Worksheet part ${worksheetPath} is missing for sheet ${name}`);
    const worksheetXml = await worksheetEntry.async("text");
    const rowNumbers = [...worksheetXml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    const maxRow = rowNumbers.length > 0 ? Math.max(...rowNumbers) : 0;

    // All non-meta sheets are blank templates: row 1 is the only surviving
    // row, so merged ranges into deleted rows must not remain.
    if (!META_SHEETS.has(name)) {
      for (const merge of worksheetXml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)) {
        assert.ok(
          lastRow(merge[1]) <= maxRow,
          `${name} merge ${merge[1]} extends past its last row ${maxRow}`,
        );
      }
    }

    const relsPath = worksheetPath.replace(
      /worksheets\/(sheet\d+\.xml)$/,
      "worksheets/_rels/$1.rels",
    );
    for (const row of worksheetXml.matchAll(/<row\b[^>]*\bspans="(\d+):(\d+)"/g)) {
      assert.ok(
        Number(row[1]) <= Number(row[2]),
        `${name} has an invalid row span ${row[1]}:${row[2]}`,
      );
    }

    const worksheetRels = zip.file(relsPath);
    if (!worksheetRels) continue;
    const worksheetRelsXml = await worksheetRels.async("text");
    for (const tableRel of worksheetRelsXml.matchAll(/Target="([^"]*tables\/table\d+\.xml)"/g)) {
      const tablePath = `xl/${tableRel[1].replace(/^(\.\.\/)+/, "")}`;
      const tableEntry = zip.file(tablePath);
      assert.ok(tableEntry, `Table part ${tablePath} is missing for sheet ${name}`);
      const tableXml = await tableEntry.async("text");
      const tableRef = tableXml.match(/<table\b[^>]*\bref="([^"]+)"/)?.[1];
      const filterRef = tableXml.match(/<autoFilter\b[^>]*\bref="([^"]+)"/)?.[1];
      assert.ok(tableRef, `Table ${tablePath} has no range`);
      // Excel tables cannot be header-only. The source workbook intentionally
      // keeps its original (mostly blank) table extent even after cell rows are
      // stripped, which desktop Excel accepts. Collapsing a table to row 1
      // makes Excel remove the table during recovery.
      const tableRows = [...tableRef.matchAll(/[A-Za-z]+(\d+)/g)].map((match) => Number(match[1]));
      assert.equal(tableRows.length, 2, `${tablePath} must use a rectangular range`);
      assert.ok(tableRows[1] > tableRows[0], `${tablePath} must include a data row below its header`);
      if (filterRef) assert.equal(filterRef, tableRef, `${tablePath} autofilter range must match table`);
    }

  }
}

describe("Modeling Agent Excel template compatibility", () => {
  for (const objectType of ["Flow", "Config"]) {
    it(`${objectType} template has no dangling OOXML ranges`, async () => {
      const generated = await generateSkeletonBlank({
        keepObjectTypes: [objectType],
        scope: "narrow",
      });
      await assertDesktopExcelCompatible(generated.bytes);
    });
  }
});

/** Assert content types declared and no impossible row spans anywhere. */
async function assertPrefilledValid(bytes: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const ct = await zip.file("[Content_Types].xml")!.async("text");
  assert.match(ct, /<Default Extension="json"/);
  assert.match(ct, /<Default Extension="vml"/);
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("text");
    for (const s of xml.matchAll(/spans="(\d+):(\d+)"/g)) {
      assert.ok(Number(s[1]) <= Number(s[2]), `${name} has an invalid row span ${s[1]}:${s[2]}`);
    }
  }
}

describe("Modeling Agent pre-filled template compatibility", () => {
  it("single-sheet Site fills its rows and stays Excel-valid", async () => {
    const gen = await generateFromSkeleton({
      rowsByType: {
        Site: [
          { Name: "SITE-A", Description: "Plant A" },
          { Name: "SITE-B", Description: "Plant B" },
        ],
      },
      scope: "narrow",
    });
    await assertPrefilledValid(gen.bytes);
    const site = gen.sheetsWritten.find((s) => s.objectType === "Site");
    assert.ok(site && site.rowsAppended === 2, "Site sheet should have 2 rows appended");
  });

  it("multi-sheet Step fills parent + sub-sheet and stays Excel-valid", async () => {
    const gen = await generateFromSkeleton({
      rowsByType: {
        Step: [{ Name: "PS1", Type: "Process" }],
        StepReason: [{ Step: "PS1", Reason: "R1" }],
      },
      scope: "narrow",
    });
    await assertPrefilledValid(gen.bytes);
    assert.ok(gen.sheetsWritten.some((s) => s.objectType === "Step"), "Step parent sheet written");
  });
});
