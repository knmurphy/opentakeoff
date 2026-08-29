// web/test/tileWallSummarize.test.ts
//
// Task 5 (2026-08-29 wall-tile-slice-a): summarizeWallShape — the wall
// counterpart of tileTakeoff.js's summarizeShape. Pipeline: unwrapRun →
// wallEffectiveTileSetup → solveTileLayout → wallCorners (wrap) → the SAME
// tileCounts/countsBySku/grout/cutsheet/order the floor path uses, run over
// wallCorners' RECLASSIFIED classified.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeWallShape } from "../src/lib/tileWall/index.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { computeShapeMetrics } from "../src/lib/shapeMetrics.js";

// Same convention as tileWallUnwrap.test.ts: dims.w=100, upp=0.1 => 1 norm
// unit = 10ft; ft(x) places a vertex at x feet.
const dims = { w: 100, h: 100 };
const upp = 0.1;
const ft = (x: number) => x / 10;

function make12x12Setup() {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  return ts;
}

test("summarizeWallShape: extent identity — extent_sf === L*H, computed from the unwrapped run", () => {
  const ts = make12x12Setup();
  const shape = { verts_norm: [[ft(0), ft(0)], [ft(18), ft(0)]] as [number, number][], face_side: "left" as const };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary, not a failure");
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.ok(Math.abs(summary.extent_sf - 18 * 8) < 1e-6, `extent_sf ${summary.extent_sf} should equal 18*8=144`);

  // Pin the tile figure to the SAME measured figure shapeMetrics.js computes
  // for this shape (the drawn wall_sf) -- directly serves "don't change
  // wall_sf totals": extent_sf must never silently drift from the shape's
  // own measured area_sf.
  const measured = computeShapeMetrics({ ...shape, measure_role: "surface_area", height_ft: 8 }, dims, upp, {});
  assert.ok(typeof measured.area_sf === "number", "expected shapeMetrics to figure an area_sf for this wall");
  assert.ok(Math.abs(summary.extent_sf - measured.area_sf!) < 0.01, `extent_sf ${summary.extent_sf} should match measured area_sf ${measured.area_sf}`);
});

test("summarizeWallShape: coverage — a 0-joint 12x12in field on an 18x8ft strip kept-tiles almost the whole strip (NOT the raw area_sf trivially, it's actually solved)", () => {
  const ts = make12x12Setup();
  const shape = { verts_norm: [[ft(0), ft(0)], [ft(18), ft(0)]] as [number, number][], face_side: "left" as const };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary, not a failure");
  const summary = s as Exclude<typeof s, { ok: false }>;
  // 18ft and 8ft are both exact multiples of the 1ft (12in, 0 joint) pitch,
  // and the balanced-origin search resolves to origin 0 for this exact-fit
  // case, so the strip tiles as 18x8=144 full 1sf tiles with zero cut waste.
  assert.ok(
    Math.abs(summary.counts.keptArea_sf - 144) < 0.1,
    `keptArea_sf ${summary.counts.keptArea_sf} should be close to 144`,
  );
  assert.equal(summary.counts.cut, 0, "an exact-multiple strip at origin 0 has no cut cells");
});

test("summarizeWallShape: a zero (or negative) resolved height rejects with { ok:false }, not a zeroed-but-fold-counted summary", () => {
  const ts = make12x12Setup();
  // An L-run: if height weren't rejected, unwrapRun/wallCorners would still
  // detect the one inside fold and report corner_inside:1 even though the
  // strip has no actual area -- the exact fabricated-corner bug this reject
  // exists to prevent (H_ft plays no part in fold detection).
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
  };
  const zero = summarizeWallShape(ts, shape, dims, upp, 0);
  assert.equal(zero.ok, false);

  const negative = summarizeWallShape(ts, shape, dims, upp, -3);
  assert.equal(negative.ok, false);
});

test("summarizeWallShape: a reversing (U-turn) run rejects with { ok:false }, never a throwing/partial summary", () => {
  const ts = make12x12Setup();
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)], [ft(2), ft(0)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.equal(s.ok, false);
  assert.equal((s as { reason: string }).reason, "reversing_or_degenerate");
});

test("summarizeWallShape: a straight run (no folds), ends not exposed => trim.byKind empty and joints.total_lf === 0", () => {
  const ts = make12x12Setup();
  const shape = { verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)]] as [number, number][], face_side: "left" as const };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false);
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.deepEqual(summary.trim.byKind, []);
  assert.equal(summary.trim.corner_inside, 0);
  assert.equal(summary.trim.corner_outside, 0);
  assert.equal(summary.joints.total_lf, 0, "no inside fold => no movement joint LF");
});

test("summarizeWallShape: an L-run (one inside fold) reports corner_inside=1 and joints.total_lf === H_ft", () => {
  const ts = make12x12Setup();
  // Matches tileWallUnwrap.test.ts's L-run fixture: east 10.5ft then north
  // 7.5ft, face_side left => the fold is classified "inside".
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false);
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.equal(summary.trim.corner_inside, 1);
  assert.equal(summary.joints.total_lf, 8, "one inside fold contributes exactly H_ft of movement joint");
  // The gate this feeds in tileTakeoff.js widens on corner_inside/outside
  // BECAUSE an inside-only wall's byKind stays empty (no edge finish emitted
  // for an inside fold) — assert that's really true here, not assumed.
  assert.deepEqual(summary.trim.byKind, []);
});

test("summarizeWallShape: wallStrips is a one-element array carrying the reclassified layout", () => {
  const ts = make12x12Setup();
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false);
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.equal(summary.wallStrips.length, 1);
  assert.strictEqual(summary.wallStrips[0], summary.layout, "wallStrips[0] is the SAME reclassified layout object");
  assert.ok(
    summary.layout.classified.some((c) => c.cls === "corner"),
    "the inside fold must have reclassified at least one field cell to corner",
  );
});

test("summarizeWallShape: wall order applies the 0.10 fraction default breakage (not the floor's 0.05)", () => {
  const ts = make12x12Setup();
  const shape = { verts_norm: [[ft(0), ft(0)], [ft(18), ft(0)]] as [number, number][], face_side: "left" as const };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false);
  const summary = s as Exclude<typeof s, { ok: false }>;
  const figured = summary.order.figured;
  const expectedWithMargin = Math.ceil(figured * 1.1);
  assert.equal(summary.order.withMargin, expectedWithMargin, "wall order must apply 10% breakage, not the floor's 5%");
});

test("summarizeWallShape: an explicit tile_setup.purchase.breakage_pct overrides the 0.10 wall default", () => {
  const ts = make12x12Setup();
  ts.purchase = { breakage_pct: 0.25 };
  const shape = { verts_norm: [[ft(0), ft(0)], [ft(18), ft(0)]] as [number, number][], face_side: "left" as const };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false);
  const summary = s as Exclude<typeof s, { ok: false }>;
  const figured = summary.order.figured;
  assert.equal(summary.order.withMargin, Math.ceil(figured * 1.25), "an explicit breakage_pct must win over the wall default");
});
