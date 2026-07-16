# CMF Master-Data — Sample Input Files

A mix of **loader-conformant** sample `.xlsx` files for testing the Modeling Agent
(Master Data Load). Every row uses **real data pulled from the CMF database**
(Enterprise = Entegris; the real Site → Facility → Area hierarchy; real Reason and
Step names). Structure is guaranteed by the same generate/validate engine the
chatbot uses — each file self-verified against the template on build.

Upload any of these in **Master data loader** (or attach them in the chat to add
more rows). Regenerate with `claudeai_athena/scripts/build-cmf-samples.ts`.

| # | File | Category | What it contains |
|---|------|----------|------------------|
| 1 | `01_single-sheet_Reason.xlsx` | **Single sheet** | One `Reason` sheet, 5 real reason codes (0001 Bubbles/Blisters/Voids, 0002 Carbon/Embed Charred Resin, …). No parent dependency. |
| 2 | `02_parent-only_Enterprise.xlsx` | **Parent only** | One `Enterprise` row (Entegris) — a top-level parent with no children. |
| 3 | `03_parent+child_Enterprise+Site.xlsx` | **Parent + child (both in file)** | `Enterprise` (Entegris) **and** its `Site` rows (KSP-S, Rockrimmon). Each Site references the Enterprise **by name**, and the parent is included in the same workbook, so the load is self-contained. |
| 4 | `04_child-only_Site-refs-existing-Enterprise.xlsx` | **Child only (parent already in CMF)** | Two `Site` rows referencing Enterprise = Entegris, which already exists in CMF and is **not** in the file. This is the "disclaimer only" path — the loader trusts the parent exists. |
| 5 | `05_multi-sheet_Step.xlsx` | **Multi-sheet object** | `Step` (a 7-sheet object): the parent `Step` sheet filled with 4 real steps, plus its sub-sheets (StepReason, StepSamplingPlan, StepLogicalName, …) present and visible. |
| 6 | `06_hierarchy_Enterprise-Site-Facility-Area.xlsx` | **Deep parent + child chain** | The full real 4-level hierarchy in one file: Enterprise (Entegris) → Site (KSP-S, Rockrimmon) → Facility (4266, Production, Test1) → Area (Assembly, Boxing, Cleaning, EUV Assembly, …), each level referencing its parent by name. |

## Notes

- Files 3, 5 and 6 are built on the **full KSP client template** (~735 KB, all 175
  object sheets present, non-relevant sheets hidden) — exactly what the chatbot's
  "Full template" produces, so they exercise the real loader path.
- Files 1, 2 and 4 are **lean single-object** workbooks (~6 KB) — just the one
  sheet (plus a `WorksheetNameMapping` helper sheet where the tab name is
  prefixed), ideal for a quick single-object load test.
- Reference columns hold the **parent's Name** (e.g. `Site.Enterprise = Entegris`),
  which is what Master Data Load expects.
- These are **test inputs** — loading files 3 and 6 will attempt to create/update
  Entegris, its sites, facilities and areas. Load against a test environment, or
  use files 1/2/5 for a lighter touch.
- Known: the three full-template files (3, 5, 6) currently trip a CMF-side
  register error (`Unk10000 — Sequence contains no matching element`); the lean
  single-object files (1, 2, 4) register and validate cleanly.
