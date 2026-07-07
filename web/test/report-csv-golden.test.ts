// Golden-snapshot test for the report CSV: the full byte-for-byte output of
// totalsToCsv(conditionTotals(...)) against a checked-in fixture. Any change
// to the CSV shape — columns, rounding, escaping, materials section, the
// (unescaped) title line — fails here first, on purpose.
//
// To regenerate after an INTENTIONAL format change: re-run the pipeline below
// against the same fixture and overwrite test/fixtures/report.golden.csv
// (never hand-edit the golden file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// totals.js is plain JS (allowJs); the tsx loader resolves it from the .ts test.
import { conditionTotals, totalsToCsv } from "../src/lib/totals.js";

// ── fixture ──────────────────────────────────────────────────────────────────
// Deterministic (no Date/random), deliberately rich: comma-in-finish-tag CSV
// escaping, comma in the project name (title line is NOT escaped — current
// behavior, snapshotted as-is), multiplier, waste, deducts, all five measure
// roles, all three material bases, round:true and round:false, a note, shapes
// spread across two sheets (sheet_id is unused by the CSV today but present
// for the per-sheet-subtotals work), and a zero-shape condition that must be
// filtered out of the report.

export const projectName = "Golden Plaza, Phase 2";

export const conditions = [
  {
    id: "ct1", finish_tag: "CT-1, honed", waste_pct: 10,
    materials: [
      { id: "m1", name: "Thinset", per: 95, basis: "area", unit: "bag", round: true },
      { id: "m2", name: "Grout", per: 120, basis: "area", unit: "bag", round: false, note: "epoxy" },
    ],
  },
  { id: "lvt2", finish_tag: "LVT-2", multiplier: 2 },
  {
    // thickness on the condition is irrelevant to totals — border SF comes
    // from each linear shape's computed.area_sf.
    id: "rb1", finish_tag: "RB-1", thickness_in: 4, waste_pct: 5,
    materials: [
      { id: "m3", name: "Adhesive", per: 200, basis: "linear", unit: "gal", round: true },
    ],
  },
  { id: "wt1", finish_tag: "WT-1" },
  {
    id: "cnt", finish_tag: "CNT",
    materials: [
      { id: "m4", name: "Transition strip", per: 1, basis: "count", unit: "ea", round: true },
    ],
  },
  // zero shapes → filtered out below; must not appear anywhere in the CSV
  { id: "empty", finish_tag: "ZZ-9" },
];

export const shapes = [
  // CT-1, honed — floor areas on both sheets, plus a deduct on sheet 2
  { id: "s1", condition_id: "ct1", sheet_id: "plan.pdf", measure_role: "floor_area", computed: { area_sf: 123.45, perimeter_lf: 44.4 } },
  { id: "s2", condition_id: "ct1", sheet_id: "plan.pdf#2", measure_role: "floor_area", computed: { area_sf: 456.78, perimeter_lf: 90.12 } },
  { id: "s3", condition_id: "ct1", sheet_id: "plan.pdf#2", measure_role: "deduct", computed: { area_sf: 33.33 } },
  // LVT-2 (multiplier 2)
  { id: "s4", condition_id: "lvt2", sheet_id: "plan.pdf", measure_role: "floor_area", computed: { area_sf: 210.55, perimeter_lf: 61.7 } },
  // RB-1 — linear on both sheets; area_sf is the border SF
  { id: "s5", condition_id: "rb1", sheet_id: "plan.pdf", measure_role: "linear", computed: { perimeter_lf: 88.25, area_sf: 29.42 } },
  { id: "s6", condition_id: "rb1", sheet_id: "plan.pdf#2", measure_role: "linear", computed: { perimeter_lf: 41.6, area_sf: 13.87 } },
  // WT-1 — wall trace (LF × height, precomputed into area_sf)
  { id: "s7", condition_id: "wt1", sheet_id: "plan.pdf", measure_role: "surface_area", height_ft: 9, computed: { area_sf: 305.62, perimeter_lf: 33.96 } },
  // CNT — two count shapes across the sheets
  { id: "s8", condition_id: "cnt", sheet_id: "plan.pdf", measure_role: "count", computed: { count: 3 } },
  { id: "s9", condition_id: "cnt", sheet_id: "plan.pdf#2", measure_role: "count", computed: { count: 4 } },
];

// ── the snapshot ─────────────────────────────────────────────────────────────

test("report CSV matches the golden snapshot byte-for-byte", () => {
  const golden = readFileSync(new URL("./fixtures/report.golden.csv", import.meta.url), "utf8");
  const rows = conditionTotals(conditions, shapes).filter((r: any) => r.shape_count > 0);
  const csv = totalsToCsv(rows, projectName);
  assert.equal(csv, golden);
});
