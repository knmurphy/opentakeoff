// web/test/elevationButtonState.test.ts
//
// Task 3 (2026-08-29 wall-tile-slice-b) — elevationButtonState
// (wallElevationPdf.ts) is the panel button's PURE enabled/label state:
// enabled only for an actually-figured wall selection (a real, non-empty
// wallStrips array — a floor selection or an unfigured wall both pass
// null/empty and read disabled), and label read from whether THIS shape's
// sheet key already exists in the open sheet set. It REUSES
// wallElevationSheetName (Task 1) to derive that key rather than
// re-deriving it, so the button can never disagree with
// generateWallElevationSheet's handler (Task 2) about which sheet a
// regen replaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { elevationButtonState, wallElevationSheetName } from "../src/lib/wallElevationPdf.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

const setup = { ...mintTileSetup(), skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#3b82f6" }], joint: { width_in: 0 } };
const layout = solveTileLayout({ tile_setup: setup, ring_ft: wallStripRing(18, 8) });

test("elevationButtonState: null selectedWall (floor / no selection) -> disabled", () => {
  const s = elevationButtonState({ selectedWall: null, existingSheetKeys: [], tag: "WT-1", shapeId: "shape-a" });
  assert.equal(s.enabled, false);
});

test("elevationButtonState: a wall shape selected but not yet figured (empty wallStrips) -> disabled", () => {
  const s = elevationButtonState({ selectedWall: { wallStrips: [] }, existingSheetKeys: [], tag: "WT-1", shapeId: "shape-a" });
  assert.equal(s.enabled, false);
});

test("elevationButtonState: figured wall, sheet not yet generated -> enabled, \"Generate elevation sheet\"", () => {
  const s = elevationButtonState({ selectedWall: { wallStrips: [layout] }, existingSheetKeys: [], tag: "WT-1", shapeId: "shape-a" });
  assert.equal(s.enabled, true);
  assert.equal(s.label, "Generate elevation sheet");
});

test("elevationButtonState: figured wall, sheet key already present -> \"Regenerate elevation sheet\"", () => {
  const key = wallElevationSheetName("WT-1", "shape-a");
  const s = elevationButtonState({ selectedWall: { wallStrips: [layout] }, existingSheetKeys: [key], tag: "WT-1", shapeId: "shape-a" });
  assert.equal(s.enabled, true);
  assert.equal(s.label, "Regenerate elevation sheet");
});

// C1 guard at the UI layer: two wall shapes sharing one condition tag must
// read INDEPENDENT button state, keyed off the full shapeId (never the tag
// alone) — regenerating one wall's sheet must never relabel the other
// wall's still-ungenerated button as "Regenerate".
test("elevationButtonState: two shapes under one tag -> independent enabled/label state (C1)", () => {
  const keyA = wallElevationSheetName("WT-1", "shape-a"); // only shape-a has been generated so far
  const existingSheetKeys = [keyA];
  const a = elevationButtonState({ selectedWall: { wallStrips: [layout] }, existingSheetKeys, tag: "WT-1", shapeId: "shape-a" });
  const b = elevationButtonState({ selectedWall: { wallStrips: [layout] }, existingSheetKeys, tag: "WT-1", shapeId: "shape-b" });
  assert.equal(a.enabled, true);
  assert.equal(b.enabled, true);
  assert.equal(a.label, "Regenerate elevation sheet");
  assert.equal(b.label, "Generate elevation sheet");
});
