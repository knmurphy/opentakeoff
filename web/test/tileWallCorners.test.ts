// web/test/tileWallCorners.test.ts
//
// Task 3 (2026-08-29 wall-tile-slice-a): run-keyed corners/trim/joints.
// Corner counting is LAYOUT-DRIVEN — a WRAP inside fold reclassifies the
// ACTUAL straddling field cells (phase-aware: a fold on a tile boundary
// contains 0 cells, no phantom cut), and edge finishes emit REAL `byKind`
// entries (tileTakeoff.js only aggregates trim/joints when `byKind.length`
// is non-empty — see corners.ts's own header for the full citation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { wallCorners } from "../src/lib/tileWall/corners.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { tileCounts } from "../src/lib/tileCalc/tiles.ts";
import type { TileSetup } from "../src/lib/tileSetup.ts";

// 12"×12", zero joint: moduleH_ft = 1, so H=8 → courses=8 exactly (no
// partial top course) — keeps the straddle math in each test's comment
// verifiable by hand.
const setup = {
  pattern: "grid", origin: [0, 0], rotation_deg: 0, edge_strategy: "start_full",
  skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#000" }], joint: { width_in: 0 },
} as TileSetup;
const H = 8;
const layout18 = solveTileLayout({ tile_setup: setup, ring_ft: wallStripRing(18, H) });

test("wallCorners: WRAP mid-tile inside fold (u=10.5) reclassifies 8 straddlers full→corner; joint 8 LF", () => {
  const r = wallCorners({
    folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
    layout: layout18, corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false],
  });
  assert.equal(tileCounts(r.classified).corner, 8, "pinned as a COUNT (spec §11.4), phase-aware");
  assert.equal(r.trim.corner_inside, 1);
  assert.ok(Math.abs(r.joints.total_lf - 8) < 10 ** -6);
  assert.equal(r.trim.byKind.length, 0, "no outside/endpoint finish here");
});

test("wallCorners: WRAP boundary inside fold (u=10.0) reclassifies 0 straddlers (phase-aware, no phantom cuts)", () => {
  const r = wallCorners({
    folds: [{ u_ft: 10.0, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
    layout: layout18, corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false],
  });
  assert.equal(tileCounts(r.classified).corner, 0);
});

test("wallCorners: RESET inside fold does not reclassify; joint still 8 LF", () => {
  // Baseline: 18ft × 8ft with exact 1ft tiles (0 joint) is an exact fit —
  // classifyLayout produces 0 "corner" cells before any fold is applied.
  const baseline = tileCounts(layout18.classified).corner;
  assert.equal(baseline, 0, "sanity: an exact-fit 18x8 grid has no room-boundary corner cells to begin with");
  const r = wallCorners({
    folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
    layout: layout18, corner_mode: "reset", edge_finish: "profile", endpoint_exposed: [false, false],
  });
  // Discriminates against wrap mode: wrap at this same u=10.5 reclassifies
  // 8 straddlers (first test above) — reset must leave the count at baseline.
  assert.equal(tileCounts(r.classified).corner, baseline, "reset reclassifies nothing at the same u wrap changes 8 cells at");
  assert.ok(Math.abs(r.joints.total_lf - 8) < 10 ** -6);
});

test("wallCorners: outside fold, profile — a byKind entry of 2*H LF, corner_outside=1 (emits, non-empty byKind)", () => {
  const r = wallCorners({
    folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
    layout: layout18, corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false],
  });
  assert.equal(r.trim.byKind.length, 1);
  assert.ok(Math.abs(r.trim.byKind[0].length_lf - 16) < 10 ** -6);
  assert.equal(r.trim.corner_outside, 1);
});

test("wallCorners: outside fold, bullnose — byKind pieces = 2*courses, length_lf 0, corner_outside=1", () => {
  const r = wallCorners({
    folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
    layout: layout18, corner_mode: "wrap", edge_finish: "bullnose", endpoint_exposed: [false, false],
  });
  assert.equal(r.trim.byKind[0].pieces, 16);
  assert.equal(r.trim.byKind[0].length_lf, 0);
});

test("wallCorners: outside fold, miter — a byKind entry of 2*H LF (labor), corner_outside=1", () => {
  const r = wallCorners({
    folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
    layout: layout18, corner_mode: "wrap", edge_finish: "miter", endpoint_exposed: [false, false],
  });
  assert.equal(r.trim.byKind.length, 1);
  assert.ok(Math.abs(r.trim.byKind[0].length_lf - 16) < 10 ** -6);
  assert.equal(r.trim.byKind[0].pieces, 0);
  assert.equal(r.trim.corner_outside, 1);
});

test("wallCorners: exposed endpoints — one byKind entry per exposed end (one face each)", () => {
  const r = wallCorners({
    folds: [], H_ft: H, tile_setup: setup, layout: layout18,
    corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [true, true],
  });
  assert.ok(Math.abs(r.trim.byKind.reduce((s, k) => s + k.length_lf, 0) - 16) < 10 ** -6); // H each end
});

test("wallCorners: exposed endpoint, bullnose — pieces=courses per end, no length_lf", () => {
  const r = wallCorners({
    folds: [], H_ft: H, tile_setup: setup, layout: layout18,
    corner_mode: "wrap", edge_finish: "bullnose", endpoint_exposed: [true, false],
  });
  assert.equal(r.trim.byKind.length, 1);
  assert.equal(r.trim.byKind[0].pieces, 8);
  assert.equal(r.trim.byKind[0].length_lf, 0);
});

test("wallCorners: trim.length_lf/pieces are the sum over byKind; joints are inside-only zeros elsewhere", () => {
  const r = wallCorners({
    folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }, { u_ft: 5, kind: "outside", vertexIndex: 2 }],
    H_ft: H, tile_setup: setup, layout: layout18,
    corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [true, false],
  });
  const wantLen = r.trim.byKind.reduce((s, k) => s + k.length_lf, 0);
  const wantPieces = r.trim.byKind.reduce((s, k) => s + k.pieces, 0);
  assert.ok(Math.abs(r.trim.length_lf - wantLen) < 10 ** -9);
  assert.equal(r.trim.pieces, wantPieces);
  assert.equal(r.joints.perimeter_lf, 0);
  assert.equal(r.joints.field_lf, 0);
  assert.equal(r.joints.transition_lf, 0);
  assert.equal(r.joints.fieldGridSpacing_ft, 0);
  assert.ok(Math.abs(r.joints.total_lf - H) < 10 ** -6, "one inside fold only");
});
