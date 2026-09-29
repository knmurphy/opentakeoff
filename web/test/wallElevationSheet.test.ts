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
// Whole-branch-review fix (same date) added a third pure piece: the
// handler's try/catch had no error path at all (silent no-op on a rejected
// buildWallElevationPdf/store.addPdf). elevationErrorMessage (canvasUtil.js)
// is the extracted message-selection logic; covered below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dimsChanged } from "../src/lib/wallElevationSheet.ts";
import { wallElevationSheetName, wallElevationScaleRow, ELEV_POINTS_PER_FT } from "../src/lib/wallElevationPdf.ts";
import { RENDER_SCALE } from "../src/lib/sheets.ts";
import { elevationErrorMessage, isDangerMsg } from "../src/lib/canvasUtil.js";
import { STALE_TAB_MESSAGE } from "../src/lib/store.js";

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

// ── elevationErrorMessage (canvasUtil.js) — the handler's catch, added by
// the whole-branch-review fix: generateWallElevationSheet had no try/catch,
// so a rejected buildWallElevationPdf/store.addPdf was a silent no-op. The
// message-selection logic lives in canvasUtil.js (not inline) precisely so
// it's testable outside React; the property that matters is that BOTH
// branches satisfy isDangerMsg — a message that renders in the positive
// color and auto-expires after 6s is barely a fix for "user sees nothing". ──

test("elevationErrorMessage: stale-tab error (VersionError) -> the sticky STALE_TAB_MESSAGE", () => {
  const msg = elevationErrorMessage({ name: "VersionError" });
  assert.equal(msg, STALE_TAB_MESSAGE);
  assert.equal(isDangerMsg(msg), true);
});

test("elevationErrorMessage: stale-tab error (BlockedError) -> the sticky STALE_TAB_MESSAGE", () => {
  const msg = elevationErrorMessage({ name: "BlockedError" });
  assert.equal(msg, STALE_TAB_MESSAGE);
  assert.equal(isDangerMsg(msg), true);
});

test("elevationErrorMessage: quota error -> \"Couldn't generate…\" + the actionable friendlyStoreError copy, red/sticky", () => {
  const msg = elevationErrorMessage(Object.assign(new Error("raw engine text"), { name: "QuotaExceededError" }));
  assert.match(msg, /^Couldn't generate the elevation sheet: /);
  assert.match(msg, /storage space/);
  assert.equal(isDangerMsg(msg), true);
});

test("elevationErrorMessage: a plain throw (e.g. pdf-lib) -> \"Couldn't generate…\" + its own message, red/sticky", () => {
  const msg = elevationErrorMessage(new Error("boom"));
  assert.equal(msg, "Couldn't generate the elevation sheet: boom");
  assert.equal(isDangerMsg(msg), true);
});
