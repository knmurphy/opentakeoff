// web/test/wallWrapped.test.ts
//
// Task 1 (2026-08-29 wall-tile-slice-c) — wallWrappedLayout, the pure
// bend transform behind the "wrapped/fanned" elevation view: it hinges a
// wall's flat elevation tiles at each plan corner by the corner's turn
// angle. Fixtures are synthetic 1x1ft tile grids (the brief's spec cases),
// not real wallElevationLayout output -- this module only consumes the
// {x,y,w,h,cls,color} shape, so a hand-rolled grid pins the transform math
// without dragging in tileSolve/summarizeWallShape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wallWrappedLayout, runTurnAngles } from "../src/lib/wallWrapped.ts";

const grid = (cols: number, rows: number) => {
  const t = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) t.push({ x: c, y: r, w: 1, h: 1, cls: "full", color: "#000" });
  return t;
};

test("straight run (no folds) → identity: each tile maps to its own axis-aligned rect", () => {
  const tiles = grid(3, 2);
  const w = wallWrappedLayout({ elevationTiles: tiles, width_ft: 3, foldsU: [], foldKinds: [], turnAngles: [] });
  assert.equal(w.tiles.length, 6);
  // first tile [0,0]-[1,1] stays axis-aligned
  const p = w.tiles[0].pts;
  const xs = p.map(q => q[0]).sort(), ys = p.map(q => q[1]).sort();
  assert.ok(Math.abs(xs[0] - 0) < 1e-9 && Math.abs(xs[3] - 1) < 1e-9);
  assert.ok(Math.abs(ys[0] - 0) < 1e-9 && Math.abs(ys[3] - 1) < 1e-9);
});

test("one 90° fold: tiles AFTER the fold are rotated 90° (a right turn), tiles before are not", () => {
  const tiles = grid(4, 2); // 4ft wide, fold at u=2
  const w = wallWrappedLayout({ elevationTiles: tiles, width_ft: 4, foldsU: [2], foldKinds: ["inside"], turnAngles: [Math.PI / 2] });
  const before = w.tiles.find(t => t.pts.every(p => p[0] <= 2 + 1e-6)); // a pre-fold tile
  const after = w.tiles.find(t => t.pts.some(p => p[1] > 1.5)); // a post-fold tile has grown in Y (rotated up)
  assert.ok(before, "pre-fold tile axis-aligned in x∈[0,2]");
  assert.ok(after, "post-fold tile rotated off the horizontal");
  // total tiles preserved
  assert.equal(w.tiles.length, 8);
  // one hinge at the fold
  assert.equal(w.hinges.length, 1);
});

test("turnAngle sign flips the bend direction", () => {
  const tiles = grid(4, 1);
  const up = wallWrappedLayout({ elevationTiles: tiles, width_ft: 4, foldsU: [2], foldKinds: ["inside"], turnAngles: [Math.PI / 2] });
  const down = wallWrappedLayout({ elevationTiles: tiles, width_ft: 4, foldsU: [2], foldKinds: ["inside"], turnAngles: [-Math.PI / 2] });
  const yUp = Math.max(...up.tiles.flatMap(t => t.pts.map(p => p[1])));
  const yDown = Math.min(...down.tiles.flatMap(t => t.pts.map(p => p[1])));
  assert.ok(yUp > 1.5, "positive angle bends up");
  assert.ok(yDown < -0.5, "negative angle bends down");
});

test("two 90° folds accumulate: a tile fully past both folds is rotated ~180°", () => {
  const tiles = grid(6, 1); // 6ft wide, folds at u=2 and u=4
  const w = wallWrappedLayout({
    elevationTiles: tiles,
    width_ft: 6,
    foldsU: [2, 4],
    foldKinds: ["inside", "inside"],
    turnAngles: [Math.PI / 2, Math.PI / 2],
  });
  assert.equal(w.hinges.length, 2);
  // Hinge 0 is fold 0's floor point run through the (still-identity)
  // pre-fold-0 transform: flat (2,0), same as the flat foldsU value here.
  assert.ok(Math.abs(w.hinges[0].x - 2) < 1e-9 && Math.abs(w.hinges[0].y - 0) < 1e-9, "hinge 0 at (2,0)");
  // Hinge 1 is fold 1's floor point (4,0) run through segment 1's matrix
  // (the rotate-90-about-(2,0) already in effect from fold 0) -- NOT the
  // flat (4,0). A flat-pivot implementation would land this at (4,0);
  // the correctly-chained one lands it at (2,2).
  assert.ok(Math.abs(w.hinges[1].x - 2) < 1e-9 && Math.abs(w.hinges[1].y - 2) < 1e-9, "hinge 1 at (2,2), not flat (4,0)");
  // Locate the tile whose ORIGINAL bottom edge (pts[0]->pts[1], a pure
  // +x vector of length 1 pre-transform) now points in -x: only a net
  // ~180° cumulative rotation flips that edge vector's sign, and pivot
  // translations cancel out of a point DIFFERENCE, so this isolates the
  // rotation angle cleanly from the hinge translations.
  const flipped = w.tiles.find(tile => {
    const [x0, y0] = tile.pts[0];
    const [x1, y1] = tile.pts[1];
    return Math.abs(x1 - x0 + 1) < 1e-9 && Math.abs(y1 - y0) < 1e-9;
  });
  assert.ok(flipped, "a post-both-folds tile's bottom edge reversed direction (~180° cumulative rotation)");
  assert.equal(w.tiles.length, 6);
});

// Task 2 (2026-08-29 wall-tile-slice-c) — runTurnAngles: the plan-side
// derivation that feeds wallWrappedLayout's turnAngles above. verts_norm
// here is in this repo's normalized-image convention, y DOWN (screen
// space) — the brief's own worked example.
test("runTurnAngles: a straight run (2 verts, no folds) → []", () => {
  const angles = runTurnAngles([[0, 0], [0.3, 0]], []);
  assert.deepEqual(angles, []);
});

test("runTurnAngles: east→south L-run → one angle, literal sign + magnitude ≈ π/2", () => {
  // in=(0.3,0)-(0,0)=(0.3,0); out=(0.3,0.2)-(0.3,0)=(0,0.2)
  // cross = 0.3*0.2 - 0*0 = 0.06 (>0); dot = 0.3*0 + 0*0.2 = 0
  // atan2(0.06, 0) = +π/2
  const verts_norm: [number, number][] = [[0, 0], [0.3, 0], [0.3, 0.2]];
  const folds = [{ x: 0.3, kind: "inside", vertexIndex: 1 }];
  const angles = runTurnAngles(verts_norm, folds);
  assert.equal(angles.length, 1);
  assert.ok(angles[0] > 0, "positive sign for this east→south geometry");
  assert.ok(Math.abs(angles[0] - Math.PI / 2) < 1e-9, `expected +π/2, got ${angles[0]}`);
});

test("runTurnAngles: the mirror run (east→north) flips the sign, same magnitude", () => {
  const verts_norm: [number, number][] = [[0, 0], [0.3, 0], [0.3, -0.2]];
  const folds = [{ x: 0.3, kind: "outside", vertexIndex: 1 }];
  const angles = runTurnAngles(verts_norm, folds);
  assert.equal(angles.length, 1);
  assert.ok(angles[0] < 0, "negative sign for the mirrored (east→north) geometry");
  assert.ok(Math.abs(angles[0] + Math.PI / 2) < 1e-9, `expected -π/2, got ${angles[0]}`);
});

test("runTurnAngles: multiple folds align 1:1 with the folds array, in order", () => {
  // a run with two 90° turns, same-sense (east→south→east — a dogleg)
  const verts_norm: [number, number][] = [[0, 0], [0.3, 0], [0.3, 0.2], [0.6, 0.2]];
  const folds = [
    { x: 0.3, kind: "inside", vertexIndex: 1 },
    { x: 0.5, kind: "outside", vertexIndex: 2 },
  ];
  const angles = runTurnAngles(verts_norm, folds);
  assert.equal(angles.length, 2);
  assert.ok(Math.abs(angles[0] - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(angles[1] + Math.PI / 2) < 1e-9, "second turn (south→east) bends the opposite way");
});
