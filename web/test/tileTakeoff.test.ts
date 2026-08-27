// web/test/tileTakeoff.test.ts
//
// computeTileTakeoff / tileReportRows — mirrors rollTakeoff's test contract
// (per-condition, per-shape figured takeoff bridge, Task 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { orderTiles } from "../src/lib/tileCalc/order.ts";
import { computeTileTakeoff, tileReportRows, reusePlanForCondition } from "../src/lib/tileTakeoff.js";
import { reusePlan } from "../src/lib/tileCalc/reuse.ts";
import type { Classified } from "../src/lib/tileGeometry/classify.ts";

// A 4ft x 4ft square room: verts_norm in [0,1] against a 100x100px sheet
// rendered at upp=0.04 ft/px => bitmap is 4ft x 4ft.
function makeShape(condId: string) {
  return {
    id: "shape1",
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  };
}

const dimsFor = (sheetId: string) => (sheetId === "sheet1" ? { w: 100, h: 100 } : null);
const uppFor = (sheetId: string) => (sheetId === "sheet1" ? 0.04 : null);

function makeTileCondition() {
  const tile_setup = mintTileSetup();
  tile_setup.skus[0].w_in = 12;
  tile_setup.skus[0].h_in = 12;
  tile_setup.skus[0].per_box = 8;
  tile_setup.joint.width_in = 0;
  return { id: "cond1", finish_tag: "CT-1", multiplier: 1, tile_setup };
}

test("computeTileTakeoff figures a 4x4ft room in 12x12 tile as 16 full tiles", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond, byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);

  const condSummary = byCond.get(cond.id);
  assert.ok(condSummary, "expected a byCond summary for the tile condition");
  assert.equal(condSummary.counts.full, 16);

  const shapeSummary = byShape.get(shape.id);
  assert.ok(shapeSummary, "expected a byShape summary for the shape");
  assert.equal(shapeSummary.counts.full, 16);
});

test("computeTileTakeoff returns empty maps for a condition without tile_setup", () => {
  const cond = { id: "cond2", finish_tag: "VCT-1", multiplier: 1 };
  const shape = makeShape(cond.id);
  const { byCond, byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  assert.equal(byCond.size, 0);
  assert.equal(byShape.size, 0);
});

test("tileReportRows echoes finish_tag/multiplier from rows and carries figured counts", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);

  const rows = [{ id: cond.id, finish_tag: "CT-1", multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].finish_tag, "CT-1");
  assert.equal(out[0].condition_id, cond.id);
  assert.equal(out[0].multiplier, 1);
  assert.equal(out[0].full, 16);
  assert.ok(out[0].safe >= 16);
  assert.ok(out[0].boxes > 0);
  assert.ok(out[0].grout_bags >= 0);
});

// A 3ft x 1ft rectangle placed within the same 4ft x 4ft sheet (upp=0.04),
// positioned by the [x0,y0] corner (in the same [0,1] normalized space) so
// two instances can be placed side by side without overlapping.
function makeRect(id: string, condId: string, x0: number, y0: number) {
  return {
    id,
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [
      [x0, y0],
      [x0 + 0.75, y0],
      [x0 + 0.75, y0 + 0.25],
      [x0, y0 + 0.25],
    ],
  };
}

test("computeTileTakeoff wires tile_setup.purchase breakage/attic margins into byCond order", () => {
  const condDefault = makeTileCondition();
  const condCustom = makeTileCondition();
  condCustom.id = "condCustom";
  condCustom.tile_setup.purchase = { breakage_pct: 0.1, attic_pct: 0.1 };

  const shapeDefault = makeShape(condDefault.id);
  const shapeCustom = { ...makeShape(condCustom.id), id: "shapeCustom" };

  const { byCond: byCondDefault } = computeTileTakeoff([condDefault], [shapeDefault], dimsFor, uppFor);
  const { byCond: byCondCustom } = computeTileTakeoff([condCustom], [shapeCustom], dimsFor, uppFor);

  const defaultSummary = byCondDefault.get(condDefault.id);
  const custom = byCondCustom.get(condCustom.id);
  assert.ok(defaultSummary && custom, "expected byCond summaries for both conditions");
  const orderDefault = defaultSummary.order;

  // Default margins (5%/0%) must NOT match the custom 10%/10% figure.
  assert.ok(custom.order.withMargin > orderDefault.withMargin);

  const expected = orderTiles({
    safeCount: custom.counts.safe,
    sku: condCustom.tile_setup.skus[0],
    breakage_pct: 0.1,
    attic_pct: 0.1,
  });
  assert.equal(custom.order.figured, expected.figured);
  assert.equal(custom.order.withMargin, expected.withMargin);
  assert.equal(custom.order.boxes, expected.boxes);
});

test("computeTileTakeoff figures purchase boxes once per condition, not summed per shape", () => {
  const cond = makeTileCondition();
  cond.tile_setup.edge_strategy = "start_full";
  const shapeA = makeRect("shapeA", cond.id, 0, 0);
  const shapeB = makeRect("shapeB", cond.id, 0, 0.5);

  const { byCond, byShape } = computeTileTakeoff([cond], [shapeA, shapeB], dimsFor, uppFor);

  const summaryA = byShape.get("shapeA");
  const summaryB = byShape.get("shapeB");
  assert.ok(summaryA && summaryB, "expected both per-shape summaries");
  assert.equal(summaryA.counts.safe, 3);
  assert.equal(summaryB.counts.safe, 3);

  // Per-shape rounding (the bug): each 3-tile shape ceils to its own box at
  // per_box=8, so summing per-shape boxes over-orders to 2.
  const perShapeBoxesSum = summaryA.order.boxes + summaryB.order.boxes;
  assert.equal(perShapeBoxesSum, 2);

  const condSummary = byCond.get(cond.id);
  assert.ok(condSummary, "expected a byCond summary for the condition");
  assert.equal(condSummary.counts.safe, 6);
  // Condition-level: 6 tiles figured together round to a single box on one
  // dye lot (design §3.3) — NOT the sum of per-shape ceils.
  assert.equal(condSummary.order.boxes, 1);
  assert.notEqual(condSummary.order.boxes, perShapeBoxesSum);
});

test("computeTileTakeoff honors a per-room tile_layout origin override (M5 §4.1)", () => {
  const cond = makeTileCondition();   // balanced, 12in tile, 4x4ft room → 16 full
  const base = makeShape(cond.id);
  const baseOut = computeTileTakeoff([cond], [base], dimsFor, uppFor).byShape.get(base.id);
  assert.ok(baseOut, "expected a byShape summary for the base room");
  assert.equal(baseOut.counts.full, 16);
  assert.equal(baseOut.counts.cut, 0);

  // A per-room origin override PINS the grid (effectiveTileSetup skips the
  // balanced optimizer for an explicit override), shifting it half a tile so
  // both x-walls strand cut columns — the figured counts must follow the
  // override, not the condition default, or the drawn grid and the counts
  // would disagree (the M5 estimator-review must-fix).
  const shifted = { ...base, tile_layout: { origin: [0.5, 0] } };
  const shiftedOut = computeTileTakeoff([cond], [shifted], dimsFor, uppFor).byShape.get(shifted.id);
  assert.ok(shiftedOut, "expected a byShape summary for the shifted room");
  assert.notEqual(shiftedOut.counts.full, 16);
  assert.ok(shiftedOut.counts.cut > 0, "a per-room origin override changes the figured layout");

  // The solved layout rides the summary so the canvas overlay reads the SAME
  // classify pass the counts came from (no independent re-solve → no drift).
  assert.ok(shiftedOut.layout && Array.isArray(shiftedOut.layout.classified));
  assert.equal(shiftedOut.layout.classified.filter((c: { cls: string }) => c.cls === "full").length, shiftedOut.counts.full);
});

// M6 Task 6.2/6.3 — With-reuse offcut pool wired into the takeoff bridge.
// A 4.25ft x 4.25ft room in 24x24in tile (no joint, pinned origin via
// "start_full") classifies to 2 full columns/rows, a trailing 3in cut
// column, a trailing 3in cut row, and a 3x3in corner: the two right-edge
// cuts (3x24in) share dims, and the two bottom-edge cuts (24x3in) share
// dims, so the offcut left behind opening the first of each identical pair
// packs the second (design §3.3) — a real, deterministic reuse saving.
function makeReuseCondition() {
  const tile_setup = mintTileSetup();
  tile_setup.skus[0].w_in = 24;
  tile_setup.skus[0].h_in = 24;
  tile_setup.skus[0].per_box = 4;
  tile_setup.joint.width_in = 0;
  tile_setup.edge_strategy = "start_full";
  return { id: "condReuse", finish_tag: "CT-2", multiplier: 1, tile_setup };
}

const dimsFor2 = (sheetId: string) => (sheetId === "sheet2" ? { w: 100, h: 100 } : null);
const uppFor2 = (sheetId: string) => (sheetId === "sheet2" ? 0.0425 : null);

function makeReuseShape(id: string, condId: string) {
  return {
    id,
    sheet_id: "sheet2",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  };
}

test("computeTileTakeoff: reuse enabled exposes byCond reuse.wholeTiles <= safe plus a reuseOrder", () => {
  const cond = makeReuseCondition();
  cond.tile_setup.purchase = { reuse: { enabled: true } };
  const shape = makeReuseShape("reuseShape", cond.id);

  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor2, uppFor2);
  const summary = byCond.get(cond.id);
  assert.ok(summary, "expected a byCond summary for the reuse condition");
  assert.equal(summary.counts.safe, 9);
  assert.ok(summary.reuse, "expected a condition-level reuse plan");
  assert.equal(summary.reuse.wholeTiles, 7, "two identical-dim cut pairs each pack one offcut");
  assert.ok(summary.reuse.wholeTiles <= summary.counts.safe, "With-reuse never exceeds Safe");
  assert.equal(summary.reuse.offcutsUsed, 2);
  assert.equal(summary.reuse.downgraded, undefined, "grid is not an AABB-approximate pattern");

  const expectedReuseOrder = orderTiles({
    safeCount: summary.reuse.wholeTiles,
    sku: cond.tile_setup.skus[0],
    breakage_pct: cond.tile_setup.purchase.breakage_pct,
    attic_pct: cond.tile_setup.purchase.attic_pct,
  });
  assert.deepEqual(summary.reuseOrder, expectedReuseOrder);
});

test("computeTileTakeoff: reuse disabled exposes neither reuse nor reuseOrder", () => {
  const cond = makeReuseCondition();
  const shape = makeReuseShape("reuseShapeOff", cond.id);

  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor2, uppFor2);
  const summary = byCond.get(cond.id);
  assert.ok(summary);
  assert.equal(summary.reuse, undefined);
  assert.equal(summary.reuseOrder, undefined);
});

test("computeTileTakeoff: With-reuse never perturbs the Safe order (byte-identical enabled vs disabled)", () => {
  const condOff = makeReuseCondition();
  const condOn = makeReuseCondition();
  condOn.id = "condReuseOn";
  condOn.tile_setup.purchase = { reuse: { enabled: true } };

  const shapeOff = makeReuseShape("reuseShapeSafeOff", condOff.id);
  const shapeOn = makeReuseShape("reuseShapeSafeOn", condOn.id);

  const offSummary = computeTileTakeoff([condOff], [shapeOff], dimsFor2, uppFor2).byCond.get(condOff.id);
  const onSummary = computeTileTakeoff([condOn], [shapeOn], dimsFor2, uppFor2).byCond.get(condOn.id);
  assert.ok(offSummary && onSummary, "expected byCond summaries for both reuse conditions");

  assert.deepEqual(onSummary.order, offSummary.order);
  assert.deepEqual(onSummary.counts, offSummary.counts);
});

test("tileReportRows: reuse_enabled/reuse_whole/reuse_with_margin/reuse_boxes/reuse_downgraded are additive and scale by the condition multiplier", () => {
  const cond = makeReuseCondition();
  cond.tile_setup.purchase = { reuse: { enabled: true } };
  const shape = makeReuseShape("reuseShapeReport", cond.id);

  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor2, uppFor2);
  const summary = byCond.get(cond.id);
  assert.ok(summary, "expected a byCond summary");
  assert.ok(summary.reuseOrder, "expected a condition-level reuse order");

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 3 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].reuse_enabled, true);
  assert.equal(out[0].reuse_whole, summary.reuseOrder.figured * 3);
  assert.equal(out[0].reuse_with_margin, summary.reuseOrder.withMargin * 3);
  assert.equal(out[0].reuse_boxes, summary.reuseOrder.boxes * 3);
  assert.equal(out[0].reuse_downgraded, null, "grid is not an AABB-approximate pattern");
});

test("tileReportRows: reuse disabled reports reuse_enabled:false, reuse_whole:0, reuse_with_margin:0, reuse_boxes:0, reuse_downgraded:null", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].reuse_enabled, false);
  assert.equal(out[0].reuse_whole, 0);
  assert.equal(out[0].reuse_with_margin, 0);
  assert.equal(out[0].reuse_boxes, 0);
  assert.equal(out[0].reuse_downgraded, null);
});

// FIX 4 (M6 adversarial polish) — grain-locked reuse pools each SKU's
// offcuts separately (design §3.3): a condition with two usable SKUs must
// never let one SKU's cut donate/consume an offcut from the other's pool.
// reusePlanForCondition buckets classified cells by `quad.skuId` and calls
// the pure `reusePlan` once per bucket, summing wholeTiles — so the
// condition-level total for a two-SKU classified set must equal the sum of
// running `reusePlan` independently on each SKU's own cells. Cut dims are
// deliberately chosen so, if cross-SKU sharing ever crept in (removing the
// bucketing), the shared/mixed pool would satisfy a cut with fewer whole
// tiles than the bucketed sum — this test would then fail.
test("reusePlanForCondition: two SKUs on one condition never share offcuts", () => {
  const skuA = { id: "skuA", name: "A", w_in: 24, h_in: 24, color: "#111" };
  const skuB = { id: "skuB", name: "B", w_in: 12, h_in: 12, color: "#222" };
  const tile_setup = { ...mintTileSetup(), skus: [skuA, skuB] };

  // Each SKU gets two identical straight cuts — classic same-SKU reuse: the
  // first cut opens a tile and leaves an offcut sized to satisfy the second.
  // areaFull_sf/areaKept_sf are required by the Classified type but ignored
  // by reusePlan (it reads cls/cut/quad.skuId only).
  const cellsA: Classified[] = [
    { cls: "cut", cut: { w_in: 3, h_in: 24, lShaped: false }, quad: { cx: 0, cy: 0, w: 24, h: 24, rot: 0, skuId: "skuA" }, areaFull_sf: 4, areaKept_sf: 1 },
    { cls: "cut", cut: { w_in: 3, h_in: 24, lShaped: false }, quad: { cx: 0, cy: 0, w: 24, h: 24, rot: 0, skuId: "skuA" }, areaFull_sf: 4, areaKept_sf: 1 },
  ];
  const cellsB: Classified[] = [
    { cls: "cut", cut: { w_in: 3, h_in: 12, lShaped: false }, quad: { cx: 0, cy: 0, w: 12, h: 12, rot: 0, skuId: "skuB" }, areaFull_sf: 1, areaKept_sf: 0.25 },
    { cls: "cut", cut: { w_in: 3, h_in: 12, lShaped: false }, quad: { cx: 0, cy: 0, w: 12, h: 12, rot: 0, skuId: "skuB" }, areaFull_sf: 1, areaKept_sf: 0.25 },
  ];

  const independentA = reusePlan({ classified: cellsA, sku: skuA, pattern: "grid" });
  const independentB = reusePlan({ classified: cellsB, sku: skuB, pattern: "grid" });
  const independentSum = independentA.wholeTiles + independentB.wholeTiles;

  const combined = reusePlanForCondition(tile_setup, [...cellsA, ...cellsB], {});
  assert.equal(combined.wholeTiles, independentSum, "bucketed condition total must equal the sum of per-SKU independent runs");
  assert.equal(combined.offcutsUsed, independentA.offcutsUsed + independentB.offcutsUsed);
});

// FIX 5 (M6 adversarial polish) — "figured once per condition" (design §3.3,
// Invariants) means With-reuse pools classified cells from EVERY shape on
// the condition into ONE reusePlan call, not one call per shape summed
// afterward. Two identical 4.25x4.25ft rooms on separate sheets, each
// producing the same right/bottom-edge cut pairs as the single-room reuse
// test above (7 wholeTiles on its own, 2 offcuts reused internally): pooled
// together at the condition level, the SECOND room's cuts can also draw on
// offcuts the FIRST room's pass left in the pool, so the condition total
// must beat the naive sum of each room solved independently (byShape run
// per-shape informational reuse, computed in isolation from the other
// shape's cells — see summarizeShape).
const dimsFor3 = (sheetId: string) => (sheetId === "sheetA" || sheetId === "sheetB" ? { w: 100, h: 100 } : null);
const uppFor3 = (sheetId: string) => (sheetId === "sheetA" || sheetId === "sheetB" ? 0.0425 : null);

function makeReuseShapeOnSheet(id: string, condId: string, sheetId: string) {
  return {
    id,
    sheet_id: sheetId,
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  };
}

test("computeTileTakeoff: With-reuse pools offcuts across shapes on one condition (figured once, not per-shape)", () => {
  const cond = makeReuseCondition();
  cond.tile_setup.purchase = { reuse: { enabled: true } };
  const room1 = makeReuseShapeOnSheet("room1", cond.id, "sheetA");
  const room2 = makeReuseShapeOnSheet("room2", cond.id, "sheetB");

  const { byCond, byShape } = computeTileTakeoff([cond], [room1, room2], dimsFor3, uppFor3);
  const agg = byCond.get(cond.id);
  const s1 = byShape.get("room1");
  const s2 = byShape.get("room2");
  assert.ok(agg && s1 && s2, "expected condition- and shape-level summaries");
  assert.ok(agg.reuse && s1.reuse && s2.reuse, "expected condition- and shape-level reuse plans");

  const perShapeSum = s1.reuse.wholeTiles + s2.reuse.wholeTiles;
  assert.equal(s1.reuse.wholeTiles, 7);
  assert.equal(s2.reuse.wholeTiles, 7);
  assert.equal(perShapeSum, 14);

  // Pooled once across both rooms' classified cells, the condition beats the
  // per-shape-independent sum — cross-room offcut reuse, not summation.
  assert.ok(agg.reuse.wholeTiles < perShapeSum, "condition-level pooling must beat summing each room's independent reuse plan");
  assert.equal(agg.counts.safe, s1.counts.safe + s2.counts.safe, "Safe counts still sum additively across shapes");
});

// M7 Task 7.2 — interior band wired into the takeoff bridge (summarizeShape
// + byCond finalize). A 4ft x 4ft room, 12x12in tile (no joint), pinned
// origin ("start_full" — deterministic, matches the purchase-boxes test
// above): a 1ft-wide band at 0ft offset erodes the room by
// offset_ft+width_ft=1ft on every side, leaving a 2ft x 2ft field ring that
// happens to land exactly on the 1ft tile grid (4 full tiles, 0 cut) — a
// clean, deterministic comparison against the band-free 16-full baseline.
// The band's outer ring is the room boundary itself (offset_ft=0), so its
// perimeter is exactly the room's own 16ft perimeter (4 sides x 4ft).
function makeBandCondition() {
  const tile_setup = mintTileSetup();
  tile_setup.skus[0].w_in = 12;
  tile_setup.skus[0].h_in = 12;
  tile_setup.skus[0].per_box = 8;
  tile_setup.joint.width_in = 0;
  tile_setup.edge_strategy = "start_full";
  return { id: "condBand", finish_tag: "CT-3", multiplier: 1, tile_setup };
}

test("summarizeShape: a room WITH a band figures fewer field tiles than the same room without, and exposes summary.band", () => {
  const cond = makeBandCondition();
  const skuId = cond.tile_setup.skus[0].id;
  const banded = { ...makeShape(cond.id), tile_layout: { band: { sku_id: skuId, width_ft: 1, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [banded], dimsFor, uppFor);
  const summary = byShape.get(banded.id);
  assert.ok(summary, "expected a byShape summary for the banded room");

  // Band-free baseline for the same room/SKU/pattern (existing test above:
  // "figures a 4x4ft room in 12x12 tile as 16 full tiles").
  assert.equal(summary.counts.full, 4, "the field now classifies against the band's inner 2x2ft ring");
  assert.ok(summary.counts.full < 16, "the band consumed the perimeter area the field used to cover");

  assert.ok(summary.band, "expected a band figure on the summary");
  assert.equal(summary.band.sku_id, skuId);
  assert.ok(summary.band.tiles > 0);
  assert.equal(summary.band.corner, 4);
  assert.ok(Math.abs(summary.band.lf - 16) < 1e-6, `band lf ${summary.band.lf} should equal the room's own 16ft perimeter (offset_ft=0)`);
});

test("summarizeShape: no tile_layout.band => no summary.band key and field counts are byte-identical to tile_layout undefined", () => {
  const condNoOverride = makeBandCondition();
  condNoOverride.id = "condBandNoOverride";
  const condEmptyOverride = makeBandCondition();
  condEmptyOverride.id = "condBandEmptyOverride";

  const shapeNoOverride = makeShape(condNoOverride.id); // no tile_layout field at all
  const shapeEmptyOverride = { ...makeShape(condEmptyOverride.id), tile_layout: {} }; // present, but band absent

  const outNoOverride = computeTileTakeoff([condNoOverride], [shapeNoOverride], dimsFor, uppFor).byShape.get(shapeNoOverride.id);
  const outEmptyOverride = computeTileTakeoff([condEmptyOverride], [shapeEmptyOverride], dimsFor, uppFor).byShape.get(shapeEmptyOverride.id);
  assert.ok(outNoOverride && outEmptyOverride, "expected both per-shape summaries");

  assert.equal("band" in outNoOverride, false);
  assert.equal("band" in outEmptyOverride, false);
  assert.deepEqual(outEmptyOverride.counts, outNoOverride.counts);
  assert.deepEqual(outEmptyOverride.cutsheet, outNoOverride.cutsheet);
  assert.deepEqual(outEmptyOverride.order, outNoOverride.order);
  assert.deepEqual(outEmptyOverride.ring_ft, outNoOverride.ring_ft);
});

test("summarizeShape: a band wider than the room is withheld — summary.band absent, a 'too small' warning, field unchanged", () => {
  const cond = makeBandCondition();
  const skuId = cond.tile_setup.skus[0].id;
  // width_ft=5 on a 4ft-square room: half the narrowest span is 2ft, so the
  // inward buffer collapses (bandRings returns null) — the honest "withheld"
  // posture (mcp instructions/plan): never silently drop the requested band.
  const tooWide = { ...makeShape(cond.id), tile_layout: { band: { sku_id: skuId, width_ft: 5, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [tooWide], dimsFor, uppFor);
  const summary = byShape.get(tooWide.id);
  assert.ok(summary);
  assert.equal(summary.band, undefined, "no band figure when the band collapses");
  assert.equal(summary.counts.full, 16, "the field re-solves against the ORIGINAL ring_ft, unchanged");
  assert.ok(
    summary.warnings.some((w: string) => typeof w === "string" && w.includes("too small") && w.includes("5ft")),
    `expected a room-too-small warning, got ${JSON.stringify(summary.warnings)}`,
  );
});

const dimsForBand = (sheetId: string) => (sheetId === "bandSheetA" || sheetId === "bandSheetB" ? { w: 100, h: 100 } : null);
const uppForBand = (sheetId: string) => (sheetId === "bandSheetA" || sheetId === "bandSheetB" ? 0.04 : null);

function makeBandShape(id: string, condId: string, sheetId: string, skuId: string) {
  return {
    id,
    sheet_id: sheetId,
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [[0, 0], [1, 0], [1, 1], [0, 1]],
    tile_layout: { band: { sku_id: skuId, width_ft: 1, offset_ft: 0 } },
  };
}

test("computeTileTakeoff: byCond.band aggregates per sku_id across two banded shapes", () => {
  const cond = makeBandCondition();
  const skuId = cond.tile_setup.skus[0].id;
  const roomA = makeBandShape("bandRoomA", cond.id, "bandSheetA", skuId);
  const roomB = makeBandShape("bandRoomB", cond.id, "bandSheetB", skuId);

  const { byCond, byShape } = computeTileTakeoff([cond], [roomA, roomB], dimsForBand, uppForBand);
  const agg = byCond.get(cond.id);
  const s1 = byShape.get("bandRoomA");
  const s2 = byShape.get("bandRoomB");
  assert.ok(agg && s1 && s2, "expected condition- and shape-level band summaries");
  assert.ok(s1.band && s2.band, "expected both shapes to figure a band");

  assert.ok(Array.isArray(agg.band), "expected a condition-level band array");
  assert.equal(agg.band.length, 1, "both shapes share one sku_id, so one aggregated entry");
  const entry = agg.band[0];
  assert.equal(entry.sku_id, skuId);
  assert.equal(entry.tiles, s1.band.tiles + s2.band.tiles);
  assert.equal(entry.corner, s1.band.corner + s2.band.corner);
  assert.ok(Math.abs(entry.lf - (s1.band.lf + s2.band.lf)) < 1e-6);
});

test("computeTileTakeoff: byCond.band is absent when no shape on the condition carries a band", () => {
  const cond = makeBandCondition();
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const agg = byCond.get(cond.id);
  assert.ok(agg);
  assert.equal("band" in agg, false);
});

// L-shaped room: a 4ft x 4ft bounding box with the top-right quadrant
// bitten out — a genuine 6-corner ring, not a rectangle. verts_norm are
// normalized against the same sheet1 100x100px/upp=0.04 fixture as
// makeShape (=> 4ft x 4ft bitmap).
function makeLShape(condId: string) {
  return {
    id: "shapeL",
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]],
  };
}

test("summarizeShape: an L-shaped banded room reports corner > 4 (not the old hardcoded 4)", () => {
  const cond = makeBandCondition();
  const skuId = cond.tile_setup.skus[0].id;
  const banded = { ...makeLShape(cond.id), tile_layout: { band: { sku_id: skuId, width_ft: 0.25, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [banded], dimsFor, uppFor);
  const summary = byShape.get(banded.id);
  assert.ok(summary?.band, "expected a band figure for the L-shaped room");
  assert.ok(summary.band.corner > 4, `expected the L-shape's real corner count (>4), got ${summary.band.corner}`);
  assert.equal(summary.band.corner, 6, "an L-shape's outer ring has exactly 6 real corners");
});

test("summarizeShape: an invalid band sku_id resolves to the fallback SKU's own id, not the bad id", () => {
  const cond = makeBandCondition();
  const validSkuId = cond.tile_setup.skus[0].id;
  const banded = { ...makeShape(cond.id), tile_layout: { band: { sku_id: "does-not-exist", width_ft: 1, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [banded], dimsFor, uppFor);
  const summary = byShape.get(banded.id);
  assert.ok(summary?.band, "expected a band figure sized off the fallback SKU");
  assert.equal(
    summary.band.sku_id,
    validSkuId,
    "the PO line must aggregate under the SKU that actually sized the band, not the invalid requested id",
  );
});

test("summarizeShape: a resolved band SKU with no positive tile size skips the band with a warning (never Infinity/NaN tiles)", () => {
  const cond = makeBandCondition();
  cond.tile_setup.skus.push({ id: "zero-sku", name: "Zero", w_in: 0, h_in: 0, color: "#000000" });
  const banded = { ...makeShape(cond.id), tile_layout: { band: { sku_id: "zero-sku", width_ft: 1, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [banded], dimsFor, uppFor);
  const summary = byShape.get(banded.id);
  assert.ok(summary);
  assert.equal(summary.band, undefined, "a zero-size SKU can't figure a tile count, so no band figure is emitted");
  assert.ok(
    summary.warnings.some((w: string) => typeof w === "string" && w.includes("usable tile size")),
    `expected a no-usable-tile-size warning, got ${JSON.stringify(summary.warnings)}`,
  );
  // The band's GEOMETRY is still valid (the room isn't too small) — only
  // sizing the band material failed — so the field still re-scopes to the
  // band's inner ring, same as the healthy-SKU band test above.
  assert.equal(summary.counts.full, 4, "field re-scope is independent of band SKU validity");
});

// FIX 3 (P2) — a band sku_id that doesn't resolve on this condition used to
// silently fall back to the primary SKU with no warning (only the
// no-usable-size branch above warned). A stale/mistyped sku_id figuring
// under the WRONG material with no disclosure is a silent PO error.
test("summarizeShape: an unresolved band sku_id warns which SKU it was figured from", () => {
  const cond = makeBandCondition();
  const primary = cond.tile_setup.skus[0];
  const banded = { ...makeShape(cond.id), tile_layout: { band: { sku_id: "does-not-exist", width_ft: 1, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [banded], dimsFor, uppFor);
  const summary = byShape.get(banded.id);
  assert.ok(summary?.band, "expected a band figure sized off the fallback SKU");
  assert.ok(
    summary.warnings.some(
      (w: string) => typeof w === "string" && w.includes('Band SKU "does-not-exist"') && w.includes(primary.name),
    ),
    `expected an unresolved-band-sku warning naming the fallback, got ${JSON.stringify(summary.warnings)}`,
  );
});

// FIX 4 (P2) — a band with sku_id set but width_ft <= 0 (reachable via the
// TilePanel width input's `parseFloat(...)||0` while the band checkbox
// stays checked) used to figure nothing AND warn nothing — the field
// silently solved the full ring with no disclosure at all. It must now be
// withheld with an explicit warning, exactly like a geometrically-collapsed
// band, and the field must NOT re-scope (no band means no re-scope).
test("summarizeShape: a band with width_ft 0 is withheld with a warning, field solves against the ORIGINAL ring unchanged", () => {
  const cond = makeBandCondition();
  const skuId = cond.tile_setup.skus[0].id;
  const zeroWidth = { ...makeShape(cond.id), tile_layout: { band: { sku_id: skuId, width_ft: 0, offset_ft: 0 } } };

  const { byShape } = computeTileTakeoff([cond], [zeroWidth], dimsFor, uppFor);
  const summary = byShape.get(zeroWidth.id);
  assert.ok(summary);
  assert.equal(summary.band, undefined, "no band figure for a zero-width band");
  assert.equal(summary.counts.full, 16, "field solves against the full room ring, unaffected by a zero-width band");
  assert.ok(
    summary.warnings.some((w: string) => typeof w === "string" && /width must be > 0/i.test(w)),
    `expected a band-width warning, got ${JSON.stringify(summary.warnings)}`,
  );
});

// FIX 6 (P2) — computeTileTakeoff's shape-skip guards (unscaled sheet,
// verts<3) used to `continue` with no disclosure at all: a condition whose
// only shape was skipped never got a byCond entry, so export_report/MCP
// snapshot reported "no tile work" instead of the real reason. Every skip
// now lands a warning on the condition's byCond entry (created if needed).
test("computeTileTakeoff: a tile condition whose only shape sits on an unscaled sheet still gets a byCond exclusion warning", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond, byShape } = computeTileTakeoff([cond], [shape], () => null, () => null);
  assert.equal(byShape.size, 0, "the unscaled shape never figures");
  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond entry even though every shape on the condition was excluded");
  assert.equal(agg.counts.full, 0);
  assert.ok(
    agg.warnings.some((w: string) => w.includes("excluded from tile figures") && w.includes("unscaled sheet")),
    `expected an unscaled-sheet exclusion warning, got ${JSON.stringify(agg.warnings)}`,
  );
});

test("computeTileTakeoff: a degenerate ring (verts_norm.length < 3) gets a byCond exclusion warning naming the reason", () => {
  const cond = makeTileCondition();
  const shape = { ...makeShape(cond.id), verts_norm: [[0, 0], [1, 1]] };
  const { byCond, byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  assert.equal(byShape.size, 0, "a 2-vertex ring never figures");
  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond entry even though the only shape was degenerate");
  assert.ok(
    agg.warnings.some((w: string) => w.includes("excluded from tile figures") && w.includes("degenerate ring")),
    `expected a degenerate-ring exclusion warning, got ${JSON.stringify(agg.warnings)}`,
  );
});

// FIX 7 (nit) — the shape-skip guard checked `dims.w > 0` but not
// `dims.h > 0` (tileQA.ts's own unscaled-sheet gate checks both); a
// zero-height bitmap dims would otherwise figure an all-zero room silently
// instead of being excluded with a warning.
test("computeTileTakeoff: a zero-height sheet dims is excluded like a zero-width one", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const dimsZeroH = (sheetId: string) => (sheetId === "sheet1" ? { w: 100, h: 0 } : null);
  const { byCond, byShape } = computeTileTakeoff([cond], [shape], dimsZeroH, uppFor);
  assert.equal(byShape.size, 0, "a zero-height sheet must not figure any tiles");
  const agg = byCond.get(cond.id);
  assert.ok(agg);
  assert.ok(agg.warnings.some((w: string) => w.includes("unscaled sheet")));
});

// ── per-shape solve cache (cross-render accelerator, opt-in 5th arg) ─────────
// computeTileTakeoff takes an optional `cache` Map that lets it reuse a prior
// figuring's per-shape summary whenever that shape's inputs are byte-identical
// (tile_setup, verts_norm, verts_norm_holes, scale, tile_layout). It is a PURE
// accelerator: results must be byte-identical to a fresh no-cache figuring, a
// HIT must reuse the very same summary OBJECT (proving no re-solve), and every
// input that changes the solve must MISS. This is the drawn==counted contract.
test("computeTileTakeoff cache: hits are byte-identical to a fresh figuring and reuse the same summary object", () => {
  const cond = makeTileCondition();
  const a = makeRect("rA", cond.id, 0.05, 0.05);
  const b = makeRect("rB", cond.id, 0.05, 0.4);
  const shapes = [a, b];

  const baseline = computeTileTakeoff([cond], shapes, dimsFor, uppFor);
  const cache = new Map();
  const pass1 = computeTileTakeoff([cond], shapes, dimsFor, uppFor, cache);
  const pass2 = computeTileTakeoff([cond], shapes, dimsFor, uppFor, cache);

  assert.deepStrictEqual(pass1.byShape, baseline.byShape, "cached pass1 byShape must equal a fresh no-cache figuring");
  assert.deepStrictEqual(pass1.byCond, baseline.byCond, "cached pass1 byCond must equal a fresh no-cache figuring");
  assert.deepStrictEqual(pass2.byShape, baseline.byShape, "an all-hit pass must still equal a fresh figuring");
  assert.strictEqual(pass2.byShape.get("rA"), pass1.byShape.get("rA"), "a hit reuses the same summary object");
  assert.strictEqual(pass2.byShape.get("rB"), pass1.byShape.get("rB"), "a hit reuses the same summary object");
});

test("computeTileTakeoff cache: a geometry edit re-solves only the edited shape; the other reuses its summary", () => {
  const cond = makeTileCondition();
  const a = makeRect("rA", cond.id, 0.05, 0.05);
  const b = makeRect("rB", cond.id, 0.05, 0.4);
  const cache = new Map();
  const pass1 = computeTileTakeoff([cond], [a, b], dimsFor, uppFor, cache);

  const bEdited = {
    ...b,
    verts_norm: [[0.05, 0.4], [0.9, 0.4], [0.9, 0.7], [0.05, 0.7]] as [number, number][],
  };
  const pass2 = computeTileTakeoff([cond], [a, bEdited], dimsFor, uppFor, cache);

  assert.strictEqual(pass2.byShape.get("rA"), pass1.byShape.get("rA"), "the unedited shape reuses its cached summary");
  assert.notStrictEqual(pass2.byShape.get("rB"), pass1.byShape.get("rB"), "the edited shape re-solves into a new summary");
  const fresh = computeTileTakeoff([cond], [a, bEdited], dimsFor, uppFor);
  assert.deepStrictEqual(pass2.byShape, fresh.byShape, "the edited-scene cached result must equal a fresh figuring");
});

test("computeTileTakeoff cache: a purchase-only tile_setup edit invalidates (no stale order/grout)", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const cache = new Map();
  const pass1 = computeTileTakeoff([cond], [shape], dimsFor, uppFor, cache);
  const order1 = pass1.byShape.get("shape1")!.order;

  // Change ONLY purchase margins — geometry and tile size untouched. tileLayoutSig
  // omits purchase, so keying on it would go stale here; the input-complete key must not.
  const cond2 = { ...cond, tile_setup: { ...cond.tile_setup, purchase: { breakage_pct: 0.2, attic_pct: 0.15 } } };
  const pass2 = computeTileTakeoff([cond2], [shape], dimsFor, uppFor, cache);
  const order2 = pass2.byShape.get("shape1")!.order;

  assert.notStrictEqual(pass2.byShape.get("shape1"), pass1.byShape.get("shape1"), "a setup edit must re-solve, not reuse");
  assert.ok(order2.withMargin > order1.withMargin, "the higher margins must flow through, not be served stale");
  const fresh = computeTileTakeoff([cond2], [shape], dimsFor, uppFor);
  assert.deepStrictEqual(pass2.byShape, fresh.byShape);
});

test("computeTileTakeoff cache: a scale change (upp) re-solves even with identical verts", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const cache = new Map();
  const pass1 = computeTileTakeoff([cond], [shape], dimsFor, uppFor, cache);
  assert.equal(pass1.byShape.get("shape1")!.counts.full, 16, "4x4ft in 12in tile = 16 full");

  const uppHalf = (sheetId: string) => (sheetId === "sheet1" ? 0.02 : null); // room now 2x2 ft
  const pass2 = computeTileTakeoff([cond], [shape], dimsFor, uppHalf, cache);
  assert.notStrictEqual(pass2.byShape.get("shape1"), pass1.byShape.get("shape1"), "a scale change must re-solve");
  assert.equal(pass2.byShape.get("shape1")!.counts.full, 4, "2x2ft in 12in tile = 4 full");
});

test("computeTileTakeoff cache: a removed shape's entry is pruned", () => {
  const cond = makeTileCondition();
  const a = makeRect("rA", cond.id, 0.05, 0.05);
  const b = makeRect("rB", cond.id, 0.05, 0.4);
  const cache = new Map();
  computeTileTakeoff([cond], [a, b], dimsFor, uppFor, cache);
  assert.equal(cache.size, 2);
  computeTileTakeoff([cond], [a], dimsFor, uppFor, cache);
  assert.equal(cache.size, 1, "the removed shape's cache entry must be pruned");
  assert.ok(cache.has("rA") && !cache.has("rB"));
});
