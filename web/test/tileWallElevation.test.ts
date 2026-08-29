// web/test/tileWallElevation.test.ts
//
// Task 8 (2026-08-29 wall-tile-slice-a) — wallElevationLayout, the pure
// helper behind TilePanel's per-shape elevation-strip preview. Fixtures
// route through the REAL summarizeWallShape (same L-run geometry
// tileWallReset.test.ts/tileWallUnwrap.test.ts already pin) so this suite
// also exercises the `folds` field this task added to WallSummary, not a
// hand-rolled TileLayout stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeWallShape } from "../src/lib/tileWall/index.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { wallElevationLayout } from "../src/lib/tileWallElevation.ts";

const dims = { w: 100, h: 100 };
const upp = 0.1; // 1 norm unit = 10ft
const ft = (x: number) => x / 10;
const colorFor = (skuId: string): string => `#color-${skuId}`;

function make12x12Setup() {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  return ts;
}

// The same east-10.5ft-then-north-7.5ft L-run tileWallUnwrap/tileWallReset
// pin: face_side "left" -> the one fold is INSIDE (the absolute convention
// test); face_side "right" -> the SAME geometry folds OUTSIDE.
const lRun = { verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][] };

test("wallElevationLayout: WRAP (single strip) — tiles cover 0..L, one inside fold at u=10.5", () => {
  const ts = make12x12Setup();
  ts.wall_corner_mode = "wrap";
  const s = summarizeWallShape(ts, { ...lRun, face_side: "left" }, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary");
  const summary = s as Exclude<typeof s, { ok: false }>;

  const elev = wallElevationLayout(summary.wallStrips, summary.folds, colorFor);
  assert.ok(Math.abs(elev.width_ft - 18) < 1e-6, "10.5 + 7.5 = 18ft total run length");
  assert.ok(Math.abs(elev.height_ft - 8) < 1e-6);
  assert.ok(elev.tiles.length > 0, "the field solved real tiles");
  for (const t of elev.tiles) {
    assert.ok(t.x >= -1e-6 && t.x + t.w <= elev.width_ft + 1e-6, "every tile stays within the drawn strip");
  }
  assert.equal(elev.folds.length, 1);
  assert.equal(elev.folds[0].kind, "inside");
  assert.ok(Math.abs(elev.folds[0].x - 10.5) < 1e-6, "fold sits at u=10.5, the first segment's length");
});

test("wallElevationLayout: flipping face_side flips the SAME fold to outside, same geometry", () => {
  const ts = make12x12Setup();
  const s = summarizeWallShape(ts, { ...lRun, face_side: "right" }, dims, upp, 8);
  const summary = s as Exclude<typeof s, { ok: false }>;
  const elev = wallElevationLayout(summary.wallStrips, summary.folds, colorFor);
  assert.equal(elev.folds.length, 1);
  assert.equal(elev.folds[0].kind, "outside");
});

test("wallElevationLayout: RESET — sub-strips lay left-to-right, never overlapping", () => {
  const ts = make12x12Setup();
  ts.wall_corner_mode = "reset";
  const s = summarizeWallShape(ts, { ...lRun, face_side: "left" }, dims, upp, 8);
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.equal(summary.wallStrips.length, 2, "one fold -> 2 sub-strips");

  const elev = wallElevationLayout(summary.wallStrips, summary.folds, colorFor);
  assert.ok(Math.abs(elev.width_ft - 18) < 1e-6);

  // The first sub-strip (10.5ft) and the second (7.5ft) must never share x
  // range: every tile is entirely on ONE side of the 10.5ft boundary.
  const firstHalf = elev.tiles.filter((t) => t.x < 10.5 - 1e-6);
  const secondHalf = elev.tiles.filter((t) => t.x + t.w > 10.5 + 1e-6);
  assert.ok(firstHalf.length > 0 && secondHalf.length > 0, "both sub-strips contributed tiles");
  for (const t of firstHalf) assert.ok(t.x + t.w <= 10.5 + 1e-6, "a first-substrip tile never crosses into the second");
  for (const t of secondHalf) assert.ok(t.x >= 10.5 - 1e-6, "a second-substrip tile never starts before its own segment");

  // The fold line lands at the SAME boundary the sub-strip offsets used —
  // both derive from the same upstream [0, fold.u_ft, L_ft] split.
  assert.equal(elev.folds.length, 1);
  assert.ok(Math.abs(elev.folds[0].x - 10.5) < 1e-6);
});

test("wallElevationLayout: a straight run (no folds) draws one strip, empty folds array", () => {
  const ts = make12x12Setup();
  const s = summarizeWallShape(ts, { verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)]] as [number, number][], face_side: "left" as const }, dims, upp, 8);
  const summary = s as Exclude<typeof s, { ok: false }>;
  const elev = wallElevationLayout(summary.wallStrips, summary.folds, colorFor);
  assert.ok(Math.abs(elev.width_ft - 10) < 1e-6);
  assert.deepEqual(elev.folds, []);
});

test("wallElevationLayout: RESET — a sub-strip's over-drawn edge cut tile clamps to its own segment, not dropped", () => {
  // Same fixture as the non-overlap test above: 12x12in/0-joint field over
  // a balanced 10.5ft segment produces a `cut` column at the edge whose
  // nominal (uninstalled) footprint straddles the 10.5ft boundary before
  // clamping (verified via a debug run: raw cx=10.25, w=1 -> [9.75,10.75)).
  const ts = make12x12Setup();
  ts.wall_corner_mode = "reset";
  const s = summarizeWallShape(ts, { ...lRun, face_side: "left" }, dims, upp, 8);
  const summary = s as Exclude<typeof s, { ok: false }>;
  const elev = wallElevationLayout(summary.wallStrips, summary.folds, colorFor);

  const edgeTiles = elev.tiles.filter((t) => Math.abs(t.x + t.w - 10.5) < 1e-6);
  assert.ok(edgeTiles.length > 0, "the first sub-strip's edge cut column survives, clamped flush to the boundary");
  for (const t of edgeTiles) assert.ok(t.w < 1 - 1e-6, "clamped narrower than the nominal 1ft tile, not dropped to 0");
});

test("wallElevationLayout: never throws on null/undefined/empty input — returns a real, empty layout", () => {
  assert.deepEqual(wallElevationLayout(null, null, colorFor), { width_ft: 0, height_ft: 0, tiles: [], folds: [] });
  assert.deepEqual(wallElevationLayout(undefined, undefined, colorFor), { width_ft: 0, height_ft: 0, tiles: [], folds: [] });
  assert.deepEqual(wallElevationLayout([], [], colorFor), { width_ft: 0, height_ft: 0, tiles: [], folds: [] });
});
