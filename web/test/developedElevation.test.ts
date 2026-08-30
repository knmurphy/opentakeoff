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
//
// Task 2 v2 (review follow-up on Task 1 v2) — CLIP-AND-SPLIT replaces
// center-x assignment (WRAP mode's continuous strip has no clamp at
// interior folds, so a tile can straddle one; center-assigning it whole
// produced an out-of-range panel-local x on the far side of the straddle).
// Every existing test's in-range assertion is tightened to the STRONGER,
// two-sided invariant `t.x >= -eps && t.x + t.w <= segWidth_ft + eps`
// (the old `t.x < segWidth_ft + eps` alone would still pass a straddler
// whose local x sits inside range but whose x+w overshoots) and a new
// straddle test pins the split numerically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { developedElevationLayout, developedViewBox, type DevPanel } from "../src/lib/developedElevation.ts";

const EPS = 1e-9;

// Every panel's every tile: panel-local x within [0, segWidth_ft], AND
// x+w within the same bound (the two-sided form a center-assign
// implementation could still slip through on the x-only half).
function assertPanelLocalInRange(panels: DevPanel[]) {
  for (const p of panels) {
    for (const t of p.tiles) {
      assert.ok(t.x >= -EPS, `panel-local x >= 0 (got ${t.x})`);
      assert.ok(t.x + t.w <= p.segWidth_ft + EPS, `panel-local x+w <= segWidth_ft ${p.segWidth_ft} (got ${t.x + t.w})`);
    }
  }
}

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
  assert.ok(Math.abs(Math.min(...d.panels[1].tiles.map(t => t.x)) - 0) < 1e-9);
  // all tiles preserved -- this fixture's tiles land exactly on the fold
  // (grid columns at integer x, fold at integer u=2), so no straddler and
  // no split: still 8 whole tiles total, same as center-assign gave.
  assert.equal(d.panels[0].tiles.length + d.panels[1].tiles.length, 8);
  assert.ok(Math.abs(d.total_width_ft - 4.5) < 1e-9);
  assertPanelLocalInRange(d.panels);
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

  // all tiles preserved across the three panels -- this fixture's tiles
  // (1x1, grid columns at integer x) land exactly on the fold u's (2, 5),
  // so no straddler: still 7 whole tiles total.
  const total = d.panels.reduce((n, p) => n + p.tiles.length, 0);
  assert.equal(total, 7);
  assertPanelLocalInRange(d.panels);

  // total_width_ft = 7 + 2*0.5 = 8
  assert.ok(Math.abs(d.total_width_ft - 8) < 1e-9);
  assert.equal(d.height_ft, 1);
});

// Task 2 v2's discriminating straddle test (review follow-up, ruling 1):
// a fold at a NON-integer u so an existing 1x1 grid tile no longer lands
// exactly on a boundary. width=4, fold at u=2.5 -> boundaries [0,2.5,4],
// panel 0 segWidth 2.5, panel 1 segWidth 1.5. The tile spanning global
// [2,3] (grid column c=2) straddles u=2.5: clipped against panel 0's own
// range [0,2.5] it survives as [2,2.5] (panel-local x = 2, width 0.5,
// x+w = 2.5 = segWidth_ft exactly); clipped against panel 1's range
// [2.5,4] it survives as [2.5,3] (panel-local x = 0, width 0.5). Both
// pieces keep the tile's original `cls`/`color` (no reclassification here
// -- this module only clips the x-axis).
//
// This is deliberately checked two ways that a center-assign
// implementation would fail:
//  - piece COUNT: center-assign keeps every tile whole (4 pieces total for
//    this 4-tile row); clip-and-split produces 5 (the straddler splits in
//    two).
//  - NEGATIVE panel-local x: center-assign keys the straddler by its
//    center (2.5, dead on the fold) into panel 1, re-offset by panel 1's
//    b0 (2.5) -> local x = 2 - 2.5 = -0.5, failing the in-range invariant
//    outright.
test("fold at non-integer u (2.5) → straddling tile splits into two clipped pieces", () => {
  const d = developedElevationLayout({
    tiles: grid(4, 1),
    foldsU: [2.5],
    foldKinds: ["inside"],
    width_ft: 4,
    height_ft: 1,
    gap_ft: 0.5,
  });
  assert.equal(d.panels.length, 2);
  assert.equal(d.panels[0].segWidth_ft, 2.5);
  assert.equal(d.panels[1].segWidth_ft, 1.5);

  // panel 0: whole tiles at local x 0 and 1 (columns c=0,1, both < 2.5),
  // plus the straddler's clipped-left piece at local x 2 (width 0.5).
  const p0xs = d.panels[0].tiles.map(t => t.x).sort((a, b) => a - b);
  assert.equal(d.panels[0].tiles.length, 3);
  assert.deepEqual(p0xs, [0, 1, 2]);
  const p0Piece = d.panels[0].tiles.find(t => Math.abs(t.x - 2) < EPS);
  assert.ok(p0Piece, "panel 0 has a piece at local x=2");
  assert.ok(Math.abs(p0Piece.w - 0.5) < EPS);
  // pass-through, not a literal claim: this fixture's own tiles are all
  // "full" (the `grid` helper hardcodes it), and the split piece keeps
  // that SAME value unchanged -- no reclassification here. Real solver
  // output classifies a fold-adjacent tile "corner" instead (verified via
  // a real summarizeWallShape run through this exact pipeline during
  // implementation, u=10.5 fold on a 1ft grid); this assertion is only
  // pinning "clip doesn't touch cls," not "a split piece is always full."
  assert.equal(p0Piece.cls, "full");

  // panel 1: whole tile at local x 0.5 (column c=3, global [3,4]),
  // plus the straddler's clipped-right piece at local x 0 (width 0.5).
  const p1xs = d.panels[1].tiles.map(t => t.x).sort((a, b) => a - b);
  assert.equal(d.panels[1].tiles.length, 2);
  assert.equal(p1xs.length, 2);
  assert.ok(Math.abs(p1xs[0] - 0) < EPS);
  assert.ok(Math.abs(p1xs[1] - 0.5) < EPS);
  const p1Piece = d.panels[1].tiles.find(t => Math.abs(t.x - 0) < EPS);
  assert.ok(p1Piece, "panel 1 has a piece at local x=0");
  assert.ok(Math.abs(p1Piece.w - 0.5) < EPS);

  // total kept width per row (both pieces of the straddler + the 3 whole
  // tiles) still sums to width_ft -- nothing dropped, nothing duplicated.
  const totalKeptWidth = d.panels.reduce((n, p) => n + p.tiles.reduce((m, t) => m + t.w, 0), 0);
  assert.ok(Math.abs(totalKeptWidth - 4) < EPS);

  // discriminating: 5 pieces total (not 4 -- a center-assign impl keeps
  // every tile whole and would never split one).
  const totalPieces = d.panels.reduce((n, p) => n + p.tiles.length, 0);
  assert.equal(totalPieces, 5);

  assertPanelLocalInRange(d.panels);
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

// developedViewBox — Task 2 v2's small pure SVG-viewBox helper: the union
// bbox of every panel's tiles (offset into the laid-out frame) + break x's
// + margin on all four sides.
test("developedViewBox: straight run, no margin -> tight bbox at [0,width]x[0,height]", () => {
  const d = developedElevationLayout({ tiles: grid(3, 2), foldsU: [], foldKinds: [], width_ft: 3, height_ft: 2 });
  const vb = developedViewBox(d, 0);
  assert.equal(vb.x, 0);
  assert.equal(vb.y, 0);
  assert.equal(vb.width, 3);
  assert.equal(vb.height, 2);
});

test("developedViewBox: margin pads all four sides", () => {
  const d = developedElevationLayout({ tiles: grid(3, 2), foldsU: [], foldKinds: [], width_ft: 3, height_ft: 2 });
  const vb = developedViewBox(d, 5);
  assert.equal(vb.x, -5);
  assert.equal(vb.y, -5);
  assert.equal(vb.width, 3 + 10);
  assert.equal(vb.height, 2 + 10);
});

test("developedViewBox: L-run unions BOTH panels' offset tile extents and the break x", () => {
  const d = developedElevationLayout({ tiles: grid(4, 2), foldsU: [2], foldKinds: ["inside"], width_ft: 4, height_ft: 2, gap_ft: 0.5 });
  const vb = developedViewBox(d, 0);
  // panel 1 spans up to xOffset(2.5) + segWidth(1.5) = total_width_ft (4.5)
  assert.ok(Math.abs(vb.x - 0) < 1e-9);
  assert.ok(Math.abs(vb.width - 4.5) < 1e-9);
  assert.ok(Math.abs(vb.height - 2) < 1e-9);
  // the break (x=2.25, per the L-run test above) sits well inside the
  // panels' own union -- doesn't widen it further here.
  assert.ok(d.breaks[0].x > vb.x && d.breaks[0].x < vb.x + vb.width);
});

test("developedViewBox: empty panels -> finite, non-negative zero-size box (not +-Infinity)", () => {
  const vb = developedViewBox({ panels: [], breaks: [], total_width_ft: 0, height_ft: 0 }, 0);
  assert.equal(vb.x, 0);
  assert.equal(vb.y, 0);
  assert.equal(vb.width, 0);
  assert.equal(vb.height, 0);
  for (const v of [vb.x, vb.y, vb.width, vb.height]) assert.ok(Number.isFinite(v));
});

test("developedViewBox: empty panels with nonzero height_ft still yields the floor-to-height extent", () => {
  const vb = developedViewBox({ panels: [], breaks: [], total_width_ft: 0, height_ft: 8 }, 2);
  assert.ok(Number.isFinite(vb.x) && Number.isFinite(vb.y) && Number.isFinite(vb.width) && Number.isFinite(vb.height));
  assert.equal(vb.y, -2);
  assert.equal(vb.height, 8 + 4);
});

test("developedViewBox: a panel with negative segWidth_ft (upstream foldsU past width_ft) still yields a well-formed, non-negative box", () => {
  // Pathological input, not something developedElevationLayout's own
  // fixtures produce -- but the helper must not throw or silently shrink
  // past its sibling panel's own extent (advisor-flagged edge case).
  const layout = {
    panels: [
      { index: 0, label: "Wall 1", xOffset: 0, segWidth_ft: 5, tiles: [] },
      { index: 1, label: "Wall 2", xOffset: 5, segWidth_ft: -1, tiles: [] }, // b1 (4) < b0 (5)
    ],
    breaks: [],
    total_width_ft: 4,
    height_ft: 2,
  };
  const vb = developedViewBox(layout, 0);
  assert.ok(Number.isFinite(vb.x) && Number.isFinite(vb.width) && vb.width >= 0);
  // union of [0,5] (panel 0) and [4,5] (panel 1, since 5 + -1 = 4) is [0,5]
  assert.equal(vb.x, 0);
  assert.equal(vb.width, 5);
});
