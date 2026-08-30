// web/test/tileWallTakeoff.test.ts
//
// Task 5 (2026-08-29 wall-tile-slice-a): computeTileTakeoff wired for
// `surface_area` (wall) shapes alongside the existing `floor_area` path.
// Three risk areas this file proves:
//  (1) REJECT-BEFORE-LOOP: an unwrappable (reversing) wall run never
//      corrupts the shared aggregation; the floor on the same project still
//      figures and the takeoff never throws.
//  (2) GATE-WIDEN (C1): a wall whose only geometry is an INSIDE fold (no
//      edge finish, so trim.byKind stays empty) still emits joint_lf,
//      because the accumulation gate now also fires on corner_inside/
//      corner_outside -- and this widening is a no-op for floors.
//  (3) A mixed floor+straight-wall condition does NOT fabricate joint_lf
//      out of nothing, and the floor's own counts are untouched by the
//      wall's presence on the same condition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { computeTileTakeoff, tileReportRows } from "../src/lib/tileTakeoff.js";

// Same ft() convention as tileWallUnwrap.test.ts / tileWallSummarize.test.ts:
// dims.w=100, upp=0.1 => 1 normalized unit = 10ft.
const dims = { w: 100, h: 100 };
const upp = 0.1;
const ft = (x: number) => x / 10;
const dimsFor = (sheetId: string) => (sheetId === "sheet1" ? dims : null);
const uppFor = (sheetId: string) => (sheetId === "sheet1" ? upp : null);

function makeCondition(id = "condWall") {
  const tile_setup = mintTileSetup();
  tile_setup.skus[0].w_in = 12;
  tile_setup.skus[0].h_in = 12;
  tile_setup.skus[0].per_box = 8;
  tile_setup.joint.width_in = 0;
  return { id, finish_tag: "CT-W", multiplier: 1, tile_setup };
}

// A 4ft x 4ft floor room -- identical fixture/expectation to
// tileTakeoff.test.ts's own makeShape (16 full 12x12in tiles), just placed
// with the ft() helper so it shares this file's dims/upp fixture.
function makeFloorShape(condId: string, id = "floorShape") {
  return {
    id,
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [
      [ft(0), ft(0)],
      [ft(4), ft(0)],
      [ft(4), ft(4)],
      [ft(0), ft(4)],
    ],
  };
}

function makeStraightWallShape(condId: string, id = "wallStraight") {
  return {
    id,
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "surface_area",
    verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)]],
    face_side: "left",
    height_ft: 8,
    endpoint_exposed: [false, false],
  };
}

// One inside fold (matches tileWallUnwrap.test.ts's L-run fixture).
function makeLRunWallShape(condId: string, id = "wallLRun") {
  return {
    id,
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "surface_area",
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]],
    face_side: "left",
    height_ft: 8,
  };
}

// A reversing (U-turn) run -- unwrapRun returns null for this.
function makeReversalWallShape(condId: string, id = "wallReversal") {
  return {
    id,
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "surface_area",
    verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)], [ft(2), ft(0)]],
    face_side: "left",
    height_ft: 8,
  };
}

test("computeTileTakeoff: a mixed floor+straight-wall condition figures both and does NOT fabricate joint_lf", () => {
  const cond = makeCondition();
  const floor = makeFloorShape(cond.id);
  const wall = makeStraightWallShape(cond.id);
  const { byCond, byShape } = computeTileTakeoff([cond], [floor, wall], dimsFor, uppFor);

  const floorSummary = byShape.get(floor.id);
  assert.ok(floorSummary, "expected a byShape summary for the floor");
  assert.equal(floorSummary.counts.full, 16, "floor counts must be unaffected by the wall on the same condition");

  const wallSummary = byShape.get(wall.id);
  assert.ok(wallSummary, "expected a byShape summary for the straight wall");
  assert.equal(wallSummary.extent_sf, 10 * 8);

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].joint_lf, 0, "a straight wall with unexposed ends contributes no movement-joint LF (not 2*(L+H))");
});

test("computeTileTakeoff: an L-run wall (one inside fold) emits joint_lf > 0 via the widened gate", () => {
  const cond = makeCondition("condLRun");
  const wall = makeLRunWallShape(cond.id);
  const { byCond, byShape } = computeTileTakeoff([cond], [wall], dimsFor, uppFor);

  const wallSummary = byShape.get(wall.id);
  assert.ok(wallSummary, "expected a byShape summary for the L-run wall");
  assert.equal(wallSummary.trim.corner_inside, 1);
  assert.deepEqual(wallSummary.trim.byKind, [], "an inside fold alone never emits an edge-finish byKind entry");

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.ok(out[0].joint_lf > 0, "the widened gate must let an inside-only wall's joints emit");
  assert.equal(out[0].joint_lf, 8, "one inside fold contributes exactly H_ft of movement joint");
});

// Regression pin for the fabricated-corner bug: unwrapRun/wallCorners detect
// folds from GEOMETRY alone (H_ft never enters fold detection), so an L-run
// wall on a condition with no height anywhere in the resolve chain (no
// shape.height_ft, no cond.height_ft) resolves to height 0 -- without the
// height reject in summarizeWallShape, this would still report
// corner_inside:1 and trip the widened gate, fabricating a trim/joints block
// for a wall that measures zero area. It must instead land in the excluded
// bucket with NO trim/joints block at all.
test("computeTileTakeoff: an L-run wall with no resolvable height is excluded -- never fabricates a corner/joint on a zero-height wall", () => {
  const cond = makeCondition("condNoHeight"); // no height_ft on the condition
  const wall = { ...makeLRunWallShape(cond.id) };
  delete (wall as { height_ft?: number }).height_ft; // no height anywhere
  const { byCond, byShape } = computeTileTakeoff([cond], [wall], dimsFor, uppFor);

  assert.equal(byShape.has(wall.id), false, "a zero-resolved-height wall must never land a byShape summary");

  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond entry even though the only shape was excluded");
  assert.equal("trim" in agg, false, "no trim block may be fabricated for an excluded, zero-height wall");
  assert.equal("joints" in agg, false, "no joints block may be fabricated for an excluded, zero-height wall");

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out[0].corner_inside, 0);
  assert.equal(out[0].joint_lf, 0);
});

test("computeTileTakeoff: floors are unaffected by the GATE-WIDEN -- a floor with no trimmed edges still reports joint_lf 0", () => {
  const cond = makeCondition("condFloorOnly");
  const floor = makeFloorShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [floor], dimsFor, uppFor);
  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].joint_lf, 0);
  assert.equal(out[0].corner_inside, 0);
  assert.equal(out[0].corner_outside, 0);
});

// GATE-WIDEN safety proof (not just the trivial no-trim case above):
// cornerTallies (tileCalc/borders.ts) counts a corner whenever its TWO
// ADJACENT edges are both confirmed+non-field, regardless of whether the
// two edges share the SAME exposure kind; trimTallies groups every
// confirmed+non-field edge BY kind. Two adjacent edges of DIFFERENT kinds
// (trim + bullnose) still both land in trimTallies' byKind (one entry per
// kind), so corner_outside>0 here can never coincide with an empty byKind
// -- the widened OR clause is provably still a no-op for a floor even in
// this less-obvious mixed-kind case.
test("computeTileTakeoff: GATE-WIDEN stays a no-op for a floor even when adjacent trimmed edges are DIFFERENT exposure kinds", () => {
  const cond = makeCondition("condMixedKind");
  const shape = {
    id: "floorMixedKind",
    sheet_id: "sheet1",
    condition_id: cond.id,
    measure_role: "floor_area",
    verts_norm: [[ft(0), ft(0)], [ft(4), ft(0)], [ft(4), ft(4)], [ft(0), ft(4)]],
    tile_layout: {
      edge_overrides: {
        0: { exposure: "trim", confirmed: true },
        1: { exposure: "bullnose", confirmed: true },
      },
    },
  };
  const { byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const summary = byShape.get(shape.id);
  assert.ok(summary, "expected a byShape summary");
  assert.equal(summary.trim.corner_outside, 1, "two adjacent confirmed edges of different kinds still form one corner");
  assert.ok(summary.trim.byKind.length >= 1, "cornerTallies and trimTallies key off the identical confirmed+non-field predicate");
});

test("computeTileTakeoff: a reversal-run wall in a project with a floor never throws -- floor still figures, wall lands in the excluded/warned bucket", () => {
  const cond = makeCondition("condMixed");
  const floor = makeFloorShape(cond.id);
  const badWall = makeReversalWallShape(cond.id);

  assert.doesNotThrow(() => computeTileTakeoff([cond], [floor, badWall], dimsFor, uppFor));

  const { byCond, byShape } = computeTileTakeoff([cond], [floor, badWall], dimsFor, uppFor);
  const floorSummary = byShape.get(floor.id);
  assert.ok(floorSummary, "the floor must still figure despite the reversing wall on the same condition");
  assert.equal(floorSummary.counts.full, 16);

  assert.equal(byShape.has(badWall.id), false, "a reversing wall run must never land a byShape summary");

  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.ok(
    agg.warnings.some((w: string) => w.includes("excluded from tile figures") && w.includes("degenerate")),
    `expected an excluded/degenerate warning, got ${JSON.stringify(agg.warnings)}`,
  );
});

test("computeTileTakeoff: a standalone reversal wall (no floor) never throws and gets a byCond exclusion warning", () => {
  const cond = makeCondition("condReversalOnly");
  const badWall = makeReversalWallShape(cond.id);
  assert.doesNotThrow(() => computeTileTakeoff([cond], [badWall], dimsFor, uppFor));
  const { byCond, byShape } = computeTileTakeoff([cond], [badWall], dimsFor, uppFor);
  assert.equal(byShape.size, 0);
  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond entry even though the only shape was an unwrappable wall run");
  assert.equal(agg.counts.full, 0);
});

test("computeTileTakeoff: a wall shape needs only 2 verts (not 3) -- a straight 2-vertex run is not treated as degenerate", () => {
  const cond = makeCondition("condTwoVert");
  const wall = makeStraightWallShape(cond.id);
  assert.equal(wall.verts_norm.length, 2);
  const { byShape, byCond } = computeTileTakeoff([cond], [wall], dimsFor, uppFor);
  assert.ok(byShape.get(wall.id), "a 2-vertex wall run must figure, not be excluded as degenerate");
  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.equal(agg.warnings.some((w: string) => w.includes("degenerate")), false);
});

test("computeTileTakeoff: a wall's Safe order applies the 0.10 wall-default breakage, distinct from the floor's 0.05", () => {
  const cond = makeCondition("condBreakage");
  const wall = makeStraightWallShape(cond.id);
  const { byShape } = computeTileTakeoff([cond], [wall], dimsFor, uppFor);
  const summary = byShape.get(wall.id);
  assert.ok(summary);
  const figured = summary.order.figured;
  assert.equal(summary.order.withMargin, Math.ceil(figured * 1.1));
});

// Report-level gap this pins: summarizeWallShape's byShape.order already
// applies the 0.10 wall overage (test above), but tileReportRows reads
// tileByCond's condition-level `agg.order` -- a SEPARATE recompute in
// tileTakeoff.js's finalize that used to pass
// `agg.tile_setup.purchase?.breakage_pct` (undefined for a wall condition)
// straight into orderTiles, silently falling back to orderTiles' own 0.05
// default and losing the wall's 0.10 overage in the actual deliverable.
test("tileReportRows: a wall-only condition's REPORTED order (ti.order, not just byShape) applies the 0.10 wall-default breakage", () => {
  const cond = makeCondition("condWallReport");
  const wall = makeStraightWallShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [wall], dimsFor, uppFor);
  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  // 10ft x 8ft wall, 12x12in tile, no joint width -> safe=figured=80.
  // 0.10 wall default -> withMargin = ceil(80 * 1.10) = 88. The old bug's
  // 0.05 fallback would instead compute ceil(80 * 1.05) = 84.
  assert.equal(out[0].figured, 80);
  assert.equal(out[0].with_margin, 88, "REPORTED with_margin must reflect the 0.10 wall overage, not orderTiles' 0.05 default");
  assert.notEqual(out[0].with_margin, Math.ceil(out[0].figured * 1.05), "must NOT silently fall back to the 0.05 floor default");
});

test("tileReportRows: a floor-only condition's REPORTED order stays at the 0.05 default (no regression from the wall-overage fix)", () => {
  const cond = makeCondition("condFloorReport");
  const floor = makeFloorShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [floor], dimsFor, uppFor);
  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  // 16 full 12x12in tiles, no joint width -> safe=figured=16. Must stay at
  // the 0.05 default -> withMargin = ceil(16 * 1.05) = 17, byte-identical
  // to before this fix.
  assert.equal(out[0].figured, 16);
  assert.equal(out[0].with_margin, 17, "floor REPORTED order must remain at the 0.05 default, unaffected by the wall-only fix");
  assert.notEqual(out[0].with_margin, Math.ceil(out[0].figured * 1.10), "must NOT pick up the wall's 0.10 overage");
});

// A cache hit skips the per-shape summarizeWallShape/summarizeShape call
// (:358 `cached.sig === sig` branch), but the hasWallShape/hasFloorShape
// flag set sits at `const agg = aggFor(cond)` AFTER that branch -- so a
// cached wall-only pass must still mark the flag and still recompute the
// REPORTED order at 0.10, not silently regress to 84 on the second render
// (the canvas always calls computeTileTakeoff with a shared cache).
test("tileReportRows: a wall-only condition's REPORTED 0.10 breakage survives a cache hit on the second pass", () => {
  const cond = makeCondition("condWallReportCache");
  const wall = makeStraightWallShape(cond.id);
  const cache = new Map();
  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  computeTileTakeoff([cond], [wall], dimsFor, uppFor, cache); // pass 1: populates cache
  const pass2 = computeTileTakeoff([cond], [wall], dimsFor, uppFor, cache); // pass 2: cache hit
  const out = tileReportRows(pass2.byCond, rows);
  assert.equal(out[0].figured, 80);
  assert.equal(out[0].with_margin, 88, "a cache hit must not bypass the hasWallShape flag / 0.10 breakage");
});

test("computeTileTakeoff cache: a wall shape hits the cache on an unchanged pass and reuses the same summary object", () => {
  const cond = makeCondition("condWallCache");
  const wall = makeLRunWallShape(cond.id);
  const cache = new Map();
  const pass1 = computeTileTakeoff([cond], [wall], dimsFor, uppFor, cache);
  const pass2 = computeTileTakeoff([cond], [wall], dimsFor, uppFor, cache);
  assert.strictEqual(pass2.byShape.get(wall.id), pass1.byShape.get(wall.id), "an unchanged wall shape must hit the cache");
});

test("computeTileTakeoff cache: changing a wall's height re-solves (does not stay stale)", () => {
  const cond = makeCondition("condWallCacheHeight");
  const wall = makeLRunWallShape(cond.id);
  const cache = new Map();
  const pass1 = computeTileTakeoff([cond], [wall], dimsFor, uppFor, cache);
  const taller = { ...wall, height_ft: 10 };
  const pass2 = computeTileTakeoff([cond], [taller], dimsFor, uppFor, cache);
  assert.notStrictEqual(pass2.byShape.get(wall.id), pass1.byShape.get(wall.id), "a height change must invalidate the cache");
  const taller_summary = pass2.byShape.get(wall.id);
  assert.ok(taller_summary, "expected a byShape summary for the taller wall");
  assert.equal(taller_summary.extent_sf, 18 * 10);
});
