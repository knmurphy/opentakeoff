// web/test/wallElevationSheet.test.ts
//
// Task 2 (2026-08-29 wall-tile-slice-b) — generateWallElevationSheet
// (TakeoffCanvas.jsx) is UI-glue (store.addPdf, setScales/setOpenTabs,
// goToSheet — verified by the browser smoke), so this file tests the
// pure pieces it's built on: the dims-change comparator this task adds
// (dimsChanged, the I1 confirm guard), plus the two Task-1 helpers
// (wallElevationPdf.ts) the handler consumes verbatim — re-asserted here
// as Task 2's own record of the contract it depends on (already covered
// in full in wallElevationPdf.test.ts; these are the two guarantees this
// task's handler actually leans on, not a repeat of that whole suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dimsChanged } from "../src/lib/wallElevationSheet.ts";
import { wallElevationSheetName, wallElevationScaleRow, ELEV_POINTS_PER_FT } from "../src/lib/wallElevationPdf.ts";
import { RENDER_SCALE } from "../src/lib/sheets.ts";

// ── dimsChanged (I1 guard) ──────────────────────────────────────────────

test("dimsChanged: no prior record -> false (nothing to compare, never confirm on first generation)", () => {
  assert.equal(dimsChanged(null, { width_ft: 10, height_ft: 8 }), false);
  assert.equal(dimsChanged(undefined, { width_ft: 10, height_ft: 8 }), false);
});

test("dimsChanged: identical dims -> false (a SKU/color-only regen must NEVER prompt — binding ruling M4)", () => {
  assert.equal(dimsChanged({ width_ft: 10, height_ft: 8 }, { width_ft: 10, height_ft: 8 }), false);
});

test("dimsChanged: width changed -> true", () => {
  assert.equal(dimsChanged({ width_ft: 10, height_ft: 8 }, { width_ft: 12, height_ft: 8 }), true);
});

test("dimsChanged: height changed -> true", () => {
  assert.equal(dimsChanged({ width_ft: 10, height_ft: 8 }, { width_ft: 10, height_ft: 9 }), true);
});

test("dimsChanged: float noise within EPS -> false (regen determinism can differ by less than a float ULP, never a real size change)", () => {
  assert.equal(dimsChanged({ width_ft: 18, height_ft: 8 }, { width_ft: 18 + 1e-12, height_ft: 8 - 1e-12 }), false);
});

// ── wallElevationSheetName / wallElevationScaleRow — Task 1 helpers the
// handler calls verbatim (wallElevationPdf.ts); fully covered already in
// wallElevationPdf.test.ts. Re-asserted narrowly here as the contract
// Task 2's handler actually depends on. ──

test("wallElevationSheetName: two shapeIds under the same tag -> distinct sheet keys (C1)", () => {
  const n1 = wallElevationSheetName("WT-1", "shape-aaaa");
  const n2 = wallElevationSheetName("WT-1", "shape-bbbb");
  assert.notEqual(n1, n2);
});

test("wallElevationScaleRow: exact upp, a source string, no scale_confirmed key (a known scale, not an agent guess)", () => {
  const upp = 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE);
  const row = wallElevationScaleRow(upp);
  assert.equal(row.units_per_px, upp);
  assert.equal(typeof row.scale_source, "string");
  assert.equal("scale_confirmed" in row, false);
});
