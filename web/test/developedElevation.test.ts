// web/test/developedElevation.test.ts
//
// Task 1 v2 (2026-08-29 wall-tile-slice-c) — developedElevationLayout, the
// pure per-wall-panel layout that supersedes the 2D fold/bend transform
// (wallWrapped.ts, now removed). Research found no prior art or drafting
// source folds walls flat in 2D at true angle; the standard "developed
// elevation" is separate FLAT true-length per-wall panels, one per wall in
// plan order, gap-separated, with a break-line + inside/outside marker at
// each corner. Fixtures are synthetic 1x1ft tile grids (the brief's spec
// cases), not real wallElevationLayout output -- this module only consumes
// the {x,y,w,h,cls,color} shape, so a hand-rolled grid pins the layout math
// without dragging in tileSolve/summarizeWallShape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { developedElevationLayout } from "../src/lib/developedElevation.ts";

const grid = (cols: number, rows: number) => {
  const t = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) t.push({ x: c, y: r, w: 1, h: 1, cls: "full", color: "#000" });
  return t;
};

test("straight run → one panel 'Wall 1', no breaks", () => {
  const d = developedElevationLayout({ tiles: grid(3, 2), foldsU: [], foldKinds: [], width_ft: 3, height_ft: 2 });
  assert.equal(d.panels.length, 1);
  assert.equal(d.panels[0].label, "Wall 1");
  assert.equal(d.breaks.length, 0);
  assert.equal(d.panels[0].tiles.length, 6);
  assert.equal(d.panels[0].xOffset, 0);
  assert.equal(d.panels[0].segWidth_ft, 3);
  assert.equal(d.total_width_ft, 3);
  assert.equal(d.height_ft, 2);
});

test("L-run (fold at u=2) → two labeled panels, one break, gap-separated, panel-local x", () => {
  const d = developedElevationLayout({ tiles: grid(4, 2), foldsU: [2], foldKinds: ["inside"], width_ft: 4, height_ft: 2, gap_ft: 0.5 });
  assert.equal(d.panels.length, 2);
  assert.deepEqual(d.panels.map(p => p.label), ["Wall 1", "Wall 2"]);
  assert.equal(d.breaks.length, 1);
  assert.equal(d.breaks[0].kind, "inside");
  // panel 2 offset by seg1 width (2) + one gap (0.5)
  assert.ok(Math.abs(d.panels[1].xOffset - 2.5) < 1e-9);
  // panel-local x: panel 2's tiles start at local x 0 (not 2)
  assert.ok(Math.min(...d.panels[1].tiles.map(t => t.x)) < 1e-9);
  // all tiles preserved
  assert.equal(d.panels[0].tiles.length + d.panels[1].tiles.length, 8);
  assert.ok(Math.abs(d.total_width_ft - 4.5) < 1e-9);
});

// Not in the brief's Step 1 fixture list -- the brief's own Step 4 calls
// for "one 2-fold test (3 panels 'Wall 1/2/3', 2 breaks, accumulating
// gaps)" alongside the two spec cases above.
test("two folds (u=2, u=5) → three labeled panels, two breaks, gaps accumulate", () => {
  const d = developedElevationLayout({
    tiles: grid(7, 1),
    foldsU: [2, 5],
    foldKinds: ["inside", "outside"],
    width_ft: 7,
    height_ft: 1,
    gap_ft: 0.5,
  });
  assert.equal(d.panels.length, 3);
  assert.deepEqual(d.panels.map(p => p.label), ["Wall 1", "Wall 2", "Wall 3"]);
  assert.equal(d.breaks.length, 2);
  assert.deepEqual(d.breaks.map(b => b.kind), ["inside", "outside"]);

  // Segment boundaries: [0, 2, 5, 7] -> seg widths 2, 3, 2.
  assert.equal(d.panels[0].xOffset, 0);
  assert.equal(d.panels[0].segWidth_ft, 2);
  // panel 1: xOffset = B[1] + 1*gap = 2 + 0.5 = 2.5
  assert.ok(Math.abs(d.panels[1].xOffset - 2.5) < 1e-9);
  assert.equal(d.panels[1].segWidth_ft, 3);
  // panel 2: xOffset = B[2] + 2*gap = 5 + 1.0 = 6.0
  assert.ok(Math.abs(d.panels[2].xOffset - 6) < 1e-9);
  assert.equal(d.panels[2].segWidth_ft, 2);

  // break 0 at the gap center between panel 0 and panel 1:
  // B[1] + 0*gap + gap/2 = 2 + 0.25 = 2.25
  assert.ok(Math.abs(d.breaks[0].x - 2.25) < 1e-9);
  // break 1 at the gap center between panel 1 and panel 2:
  // B[2] + 1*gap + gap/2 = 5 + 0.5 + 0.25 = 5.75
  assert.ok(Math.abs(d.breaks[1].x - 5.75) < 1e-9);

  // all tiles preserved across the three panels, each panel-local
  const total = d.panels.reduce((n, p) => n + p.tiles.length, 0);
  assert.equal(total, 7);
  for (const p of d.panels) {
    for (const t of p.tiles) {
      assert.ok(t.x >= -1e-9 && t.x < p.segWidth_ft + 1e-9, `panel-local x within [0,${p.segWidth_ft}]`);
    }
  }

  // total_width_ft = 7 + 2*0.5 = 8
  assert.ok(Math.abs(d.total_width_ft - 8) < 1e-9);
  assert.equal(d.height_ft, 1);
});

test("no input mutation: original tiles array/objects untouched", () => {
  const tiles = grid(4, 2);
  const snapshot = JSON.parse(JSON.stringify(tiles));
  developedElevationLayout({ tiles, foldsU: [2], foldKinds: ["inside"], width_ft: 4, height_ft: 2, gap_ft: 0.5 });
  assert.deepEqual(tiles, snapshot);
});

test("default gap_ft is 0.5 when omitted", () => {
  const d = developedElevationLayout({ tiles: grid(4, 2), foldsU: [2], foldKinds: ["inside"], width_ft: 4, height_ft: 2 });
  assert.ok(Math.abs(d.panels[1].xOffset - 2.5) < 1e-9);
  assert.ok(Math.abs(d.total_width_ft - 4.5) < 1e-9);
});
