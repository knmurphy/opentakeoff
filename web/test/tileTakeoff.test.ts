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
import { slotKey } from "../src/lib/tilePatterns/slotKey.ts";
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

test("computeTileTakeoff cache: removing every tile condition clears the cache (no dead entries retained)", () => {
  const cond = makeTileCondition();
  const a = makeRect("rA", cond.id, 0.05, 0.05);
  const b = makeRect("rB", cond.id, 0.05, 0.4);
  const cache = new Map();
  computeTileTakeoff([cond], [a, b], dimsFor, uppFor, cache);
  assert.equal(cache.size, 2);
  // de-tile: the only condition loses its tile_setup — no tiled shape can be live.
  const carpet = { id: cond.id, finish_tag: "CPT-1", multiplier: 1 };
  const { byShape } = computeTileTakeoff([carpet], [a, b], dimsFor, uppFor, cache);
  assert.equal(byShape.size, 0);
  assert.equal(cache.size, 0, "no tile conditions => the cache must hold no dead entries");
});

// ── M8 Task 8: trim + movement-joint wiring (design §3.4/§3.3) ──────────────
// Trim/joints ride the FULL room ring (the same `ring_ft` TakeoffCanvas.jsx's
// tileOverlayForShape hands edgeExposures — not the band-eroded field ring),
// so a room's edge_overrides drive the exact same exposures the overlay inks.
function makeShapeWithOverrides(condId: string, edge_overrides: Record<number, { exposure: string; confirmed: boolean }> | undefined) {
  return {
    id: "shapeTrim",
    sheet_id: "sheet1",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    tile_layout: edge_overrides ? { edge_overrides } : undefined,
  };
}

test("summarizeShape (via byShape): a confirmed trim edge override reports trim LF == that edge's length; no override reports 0", () => {
  const cond = makeTileCondition();
  const shapeNoOverride = makeShapeWithOverrides(cond.id, undefined);
  const { byShape: byShapeNone } = computeTileTakeoff([cond], [shapeNoOverride], dimsFor, uppFor);
  const noneSummary = byShapeNone.get("shapeTrim");
  assert.ok(noneSummary, "expected a byShape summary");
  assert.equal(noneSummary.trim.length_lf, 0);
  assert.equal(noneSummary.trim.pieces, 0);
  assert.deepEqual(noneSummary.trim.byKind, []);

  const shapeWithOverride = makeShapeWithOverrides(cond.id, { 0: { exposure: "trim", confirmed: true } });
  const { byShape } = computeTileTakeoff([cond], [shapeWithOverride], dimsFor, uppFor);
  const summary = byShape.get("shapeTrim");
  assert.ok(summary, "expected a byShape summary");
  assert.equal(summary.trim.length_lf, 4);
  assert.ok(summary.trim.pieces > 0);
});

test("summarizeShape: two trim edges of the same kind merge into one byKind row with summed LF", () => {
  const cond = makeTileCondition();
  const shape = makeShapeWithOverrides(cond.id, {
    0: { exposure: "trim", confirmed: true },
    1: { exposure: "trim", confirmed: true },
  });
  const { byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const summary = byShape.get("shapeTrim");
  assert.ok(summary, "expected a byShape summary");
  assert.equal(summary.trim.byKind.length, 1);
  assert.equal(summary.trim.byKind[0].exposure, "trim");
  assert.equal(summary.trim.byKind[0].length_lf, 8);
});

test("summarizeShape: corner_outside/corner_inside come from cornerTallies over confirmed edges", () => {
  const cond = makeTileCondition();
  // All four edges of the 4x4 square trimmed => 4 convex (outside) corners.
  const shape = makeShapeWithOverrides(cond.id, {
    0: { exposure: "trim", confirmed: true },
    1: { exposure: "trim", confirmed: true },
    2: { exposure: "trim", confirmed: true },
    3: { exposure: "trim", confirmed: true },
  });
  const { byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const summary = byShape.get("shapeTrim");
  assert.ok(summary, "expected a byShape summary");
  assert.equal(summary.trim.corner_outside, 4);
  assert.equal(summary.trim.corner_inside, 0);

  // Only two ADJACENT edges trimmed => exactly one corner (their shared vertex).
  const shape2 = makeShapeWithOverrides(cond.id, {
    0: { exposure: "trim", confirmed: true },
    1: { exposure: "trim", confirmed: true },
  });
  const { byShape: byShape2 } = computeTileTakeoff([cond], [shape2], dimsFor, uppFor);
  const summary2 = byShape2.get("shapeTrim");
  assert.ok(summary2, "expected a byShape summary");
  assert.equal(summary2.trim.corner_outside, 1);
  assert.equal(summary2.trim.corner_inside, 0);
});

// A 30ft x 30ft room (>= 24ft field-grid spacing) placed on a dedicated
// sheet/scale so the movement-joint field grid actually fires.
const dimsForJoints = (sheetId: string) => (sheetId === "sheetJoints" ? { w: 100, h: 100 } : null);
const uppForJoints = (sheetId: string) => (sheetId === "sheetJoints" ? 0.3 : null);
function makeJointsShape(condId: string) {
  return {
    id: "shapeJoints",
    sheet_id: "sheetJoints",
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

test("summarizeShape: joints.total_lf == perimeter + field for a room >= 24ft (field_lf > 0); == perimeter for a small room (field_lf == 0)", () => {
  const cond = makeTileCondition();
  const bigShape = makeJointsShape(cond.id);
  const { byShape: byShapeBig } = computeTileTakeoff([cond], [bigShape], dimsForJoints, uppForJoints);
  const bigSummary = byShapeBig.get("shapeJoints");
  assert.ok(bigSummary, "expected a byShape summary");
  assert.equal(bigSummary.joints.perimeter_lf, 120);
  assert.ok(bigSummary.joints.field_lf > 0, "a 30x30ft room must have a nonzero field grid");
  assert.equal(bigSummary.joints.total_lf, bigSummary.joints.perimeter_lf + bigSummary.joints.field_lf);

  const smallShape = makeShape(cond.id);
  const { byShape: byShapeSmall } = computeTileTakeoff([cond], [smallShape], dimsFor, uppFor);
  const smallSummary = byShapeSmall.get(smallShape.id);
  assert.ok(smallSummary, "expected a byShape summary");
  assert.equal(smallSummary.joints.field_lf, 0);
  assert.equal(smallSummary.joints.total_lf, smallSummary.joints.perimeter_lf);
});

test("tileReportRows: trim_lf (x mult), corner_outside/corner_inside (as-measured), joint_lf (x mult) are carried", () => {
  const cond = makeTileCondition();
  cond.multiplier = 2;
  const shape = makeShapeWithOverrides(cond.id, {
    0: { exposure: "trim", confirmed: true },
    1: { exposure: "trim", confirmed: true },
  });
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const rows = [{ id: cond.id, finish_tag: "CT-1", multiplier: 2 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);

  const condSummary = byCond.get(cond.id);
  assert.ok(condSummary, "expected a byCond summary");
  assert.ok(condSummary.trim, "expected a condition trim aggregate");
  assert.ok(condSummary.joints, "expected a condition joints aggregate");
  assert.equal(out[0].trim_lf, condSummary.trim.length_lf * 2);
  assert.equal(out[0].corner_outside, condSummary.trim.corner_outside);
  assert.equal(out[0].corner_inside, condSummary.trim.corner_inside);
  assert.equal(out[0].joint_lf, condSummary.joints.total_lf * 2);
  assert.ok(Array.isArray(out[0].trim_by_kind));
  assert.equal(out[0].trim_by_kind.length, 1);
  assert.equal(out[0].trim_by_kind[0].length_lf, condSummary.trim.byKind[0].length_lf * 2);
  assert.equal(out[0].trim_by_kind[0].pieces, condSummary.trim.byKind[0].pieces * 2);
});

test("computeTileTakeoff/tileReportRows: a no-trim/no-joints-confirmed room still figures with no NaN (keys absent or zero)", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const condSummary = byCond.get(cond.id);
  assert.ok(condSummary, "expected a byCond summary");
  // No shape carried a confirmed trim edge => trim/joints absent on byCond,
  // mirroring the band absent-when-empty convention.
  assert.equal(condSummary.trim, undefined);
  assert.equal(condSummary.joints, undefined);

  const rows = [{ id: cond.id, finish_tag: "CT-1", multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out[0].trim_lf, 0);
  assert.equal(out[0].corner_outside, 0);
  assert.equal(out[0].corner_inside, 0);
  assert.equal(out[0].joint_lf, 0);
  assert.deepEqual(out[0].trim_by_kind, []);
  assert.ok(!Number.isNaN(out[0].trim_lf));
});

test("summarizeShape: trim pieces are cut at the field SKU's long dimension (12x24 -> 2ft pieces, not 1ft)", () => {
  const cond = makeTileCondition();
  cond.tile_setup.skus[0].h_in = 24;   // 12x24 -> long face 2ft
  const shape = makeShapeWithOverrides(cond.id, { 0: { exposure: "trim", confirmed: true } });
  const { byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const summary = byShape.get("shapeTrim");
  assert.ok(summary, "expected a byShape summary");
  assert.equal(summary.trim.length_lf, 4);   // one 4ft edge
  assert.equal(summary.trim.pieces, 2);      // ceil(4ft / 2ft) = 2, NOT ceil(4/1)=4
});

test("computeTileTakeoff: movement joints accumulate for EVERY room, not only trimmed rooms (mixed condition)", () => {
  const cond = makeTileCondition();
  const trimmed = makeShapeWithOverrides(cond.id, { 0: { exposure: "trim", confirmed: true } });
  const untrimmed = { ...makeShape(cond.id), id: "untrimmed" };
  const { byCond } = computeTileTakeoff([cond], [trimmed, untrimmed], dimsFor, uppFor);
  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.ok(agg.joints, "hasTrim true (one trimmed room) => joints emitted");
  // Both rooms are 4x4ft (perimeter 16ft each, field grid 0) => 32ft total.
  assert.equal(agg.joints.perimeter_lf, 32);
  assert.equal(agg.joints.total_lf, 32);
});

// Slice 1 close-out (2026-08-29 tile-multi-sku-field, Task 3) — herringbone
// and basketweave used to derive their own phasing from the interlock
// geometry alone and silently ignore `origin` (design §3.1's old
// "interlock-derived; free origin ignored" row). Tasks 1/2 (commits
// 92c786c, c2181e2) made both generators honor `origin` as a rigid
// translation. This is the INTEGRATION proof that the shipped per-room
// override — shape.tile_layout.origin — actually reaches that fix: the
// verified path is effectiveTileSetup pinning tile_layout.origin
// (tileGeometry/optimize.ts ~:190-193) into tileConfig.origin into the
// generator (tileSolve.ts). Before Task 1, this override was a silent
// no-op for herringbone; the drawn grid would never move even though the
// estimator asked it to.
function makeHerringboneCondition() {
  const tile_setup = mintTileSetup();     // 12x24in SKU (2:1 long:short — herringbone's own design ratio)
  tile_setup.pattern = "herringbone";
  tile_setup.joint.width_in = 0;
  return { id: "condHb", finish_tag: "CT-HB", multiplier: 1, tile_setup };
}

test("computeTileTakeoff: a per-room tile_layout.origin override moves a herringbone room's solved quads (Slice 1 close-out)", () => {
  const cond = makeHerringboneCondition();
  const base = makeShape(cond.id);
  const shifted = { ...makeShape(cond.id), id: "shapeHbShifted", tile_layout: { origin: [1, 1] } };

  const { byShape } = computeTileTakeoff([cond], [base, shifted], dimsFor, uppFor);
  const baseOut = byShape.get(base.id);
  const shiftedOut = byShape.get(shifted.id);
  assert.ok(baseOut && shiftedOut, "expected byShape summaries for both rooms");

  const baseQuads = baseOut.layout.quads;
  const shiftedQuads = shiftedOut.layout.quads;
  assert.ok(baseQuads.length > 0 && shiftedQuads.length > 0, "expected a non-empty herringbone lattice for both rooms");

  // Match quads present in BOTH runs by rot + the (-1,-1)-shifted center: a
  // plank at (cx, cy, rot) under the override should correspond to a plank
  // at (cx-1, cy-1, rot) with no override, if the origin genuinely moved
  // the lattice. Pre-Task-1, herringbone ignored `origin` entirely, so both
  // runs would generate the IDENTICAL quad set — the lattice's own
  // translation symmetries are (periodX, 0) and (periodX/2, bandH), neither
  // of which is (1,1), so a stale/no-op origin would find zero (-1,-1)
  // matches here and this assertion would fail.
  const EPS = 1e-6;
  const matches: Array<[{ cx: number; cy: number }, { cx: number; cy: number }]> = [];
  for (const s of shiftedQuads) {
    const hit = baseQuads.find(
      (b: { cx: number; cy: number; w: number; h: number; rot: number }) =>
        Math.abs(b.rot - s.rot) < EPS &&
        Math.abs(b.w - s.w) < EPS &&
        Math.abs(b.h - s.h) < EPS &&
        Math.abs(s.cx - 1 - b.cx) < EPS &&
        Math.abs(s.cy - 1 - b.cy) < EPS,
    );
    if (hit) matches.push([s, hit]);
  }

  assert.ok(matches.length >= 5, `expected several overlapping planks between the two runs, got ${matches.length}`);
  for (const [s, b] of matches) {
    assert.ok(Math.abs(s.cx - b.cx - 1) < EPS, "x shift between the two runs must be exactly 1");
    assert.ok(Math.abs(s.cy - b.cy - 1) < EPS, "y shift between the two runs must be exactly 1");
  }
});

// ── Task 6 (2026-08-29 tile-multi-sku-field): multi-SKU purchase ───────────
// A checkerboard assignment paints two DIFFERENT products into one field —
// they can't share a box, so each SKU purchases as its OWN order, rolled up
// at the condition level (byCond finalize). A,B are IDENTICAL size (12x12in,
// 0 joint) so any figured difference below is the resolver's per_box split
// doing the work, never a byproduct of geometry — mirrors the same
// identical-size-SKU discipline tileSolve.test.ts's assignment tests use.
function makeCheckerboardCondition() {
  const tile_setup = mintTileSetup();
  tile_setup.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111", per_box: 8 },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222", per_box: 3 },
  ];
  tile_setup.joint.width_in = 0;
  tile_setup.origin = [0, 0];
  tile_setup.assignment = {
    mode: "repeat",
    unit: { w: 2, h: 2 },
    slots: { "0_0": "A", "1_0": "B", "0_1": "B", "1_1": "A" },
  };
  return { id: "condCheckerboard", finish_tag: "CT-CB", multiplier: 1, tile_setup };
}

test("computeTileTakeoff: a 2x2 checkerboard field figures a SEPARATE order per SKU, summed into the scalar agg.order", () => {
  const cond = makeCheckerboardCondition();
  const shape = makeShape(cond.id); // 4x4ft room, 12x12in tile, 0 joint => 16 full, 0 cut
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);

  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.equal(agg.counts.full, 16);
  assert.equal(agg.counts.safe, 16);

  assert.ok(Array.isArray(agg.orderBySku), "expected a per-SKU order breakdown");
  assert.equal(agg.orderBySku.length, 2, "the 2x2 unit splits the 4x4 grid evenly across A and B");
  const byId = Object.fromEntries(agg.orderBySku.map((o) => [o.sku_id, o]));
  assert.ok(byId.A && byId.B, "expected an order entry for both A and B");
  assert.equal(byId.A.safe, 8);
  assert.equal(byId.B.safe, 8);

  const expectedA = orderTiles({ safeCount: 8, sku: cond.tile_setup.skus[0] });
  const expectedB = orderTiles({ safeCount: 8, sku: cond.tile_setup.skus[1] });
  assert.equal(byId.A.figured, expectedA.figured);
  assert.equal(byId.A.with_margin, expectedA.withMargin);
  assert.equal(byId.A.boxes, expectedA.boxes);
  assert.equal(byId.B.figured, expectedB.figured);
  assert.equal(byId.B.with_margin, expectedB.withMargin);
  assert.equal(byId.B.boxes, expectedB.boxes);
  assert.notEqual(byId.A.boxes, byId.B.boxes, "A's per_box=8 and B's per_box=3 must NOT round to the same whole-box count");

  // Whole boxes are never bought fractionally across two different
  // products — the scalar `agg.order` must equal the SUM of the two
  // separately-rounded per-SKU orders, not a re-round of the pooled Safe
  // count against either SKU alone.
  assert.equal(agg.order.boxes, byId.A.boxes + byId.B.boxes);
  assert.equal(agg.order.figured, byId.A.figured + byId.B.figured);
  assert.equal(agg.order.withMargin, expectedA.withMargin + expectedB.withMargin);

  // Excludes the wrong answer, not just describes the right one: pooling
  // all 16 safe tiles against a SINGLE SKU's per_box (rather than rounding
  // each SKU's own 8 separately) under-orders — boxes=5 (2+3) here, but
  // pooled-against-A would be ceil(ceil(16*1.05)/8)=3 and pooled-against-B
  // would be ceil(17/3)=6. Neither equals the correct per-SKU sum.
  assert.notEqual(
    agg.order.boxes,
    orderTiles({ safeCount: 16, sku: cond.tile_setup.skus[0] }).boxes,
    "16 tiles pooled against ONE SKU's per_box must NOT match the correct per-SKU-summed figure",
  );
  assert.notEqual(
    agg.order.boxes,
    orderTiles({ safeCount: 16, sku: cond.tile_setup.skus[1] }).boxes,
    "16 tiles pooled against the OTHER SKU's per_box must NOT match the correct per-SKU-summed figure either",
  );
});

test("computeTileTakeoff: an assignment that resolves every KEPT cell to one SKU still figures a single order, byte-identical to no assignment at all", () => {
  const condAssigned = makeCheckerboardCondition();
  condAssigned.id = "condSingleColor";
  // A 1x1 unit collapses every cell to the SAME slot key ("0_0") — every
  // quad in the room resolves to "A" even though "B" is a real, usable SKU
  // on this condition and the resolver machinery (assignedSkuId) runs on
  // every quad exactly like the checkerboard test above.
  condAssigned.tile_setup.assignment = { mode: "repeat", unit: { w: 1, h: 1 }, slots: { "0_0": "A" } };

  const condPlain = makeCheckerboardCondition();
  condPlain.id = "condSingleColorPlain";
  delete condPlain.tile_setup.assignment; // no assignment at all: same fallback chain lands on "A" (primaryUsableSku)

  const shapeAssigned = makeShape(condAssigned.id);
  const shapePlain = { ...makeShape(condPlain.id), id: "shapePlain" };

  const aggAssigned = computeTileTakeoff([condAssigned], [shapeAssigned], dimsFor, uppFor).byCond.get(condAssigned.id);
  const aggPlain = computeTileTakeoff([condPlain], [shapePlain], dimsFor, uppFor).byCond.get(condPlain.id);
  assert.ok(aggAssigned && aggPlain, "expected both byCond summaries");

  assert.equal("orderBySku" in aggAssigned, false, "a single effective SKU never emits a per-SKU breakdown");
  assert.deepEqual(aggAssigned.order, aggPlain.order, "one effective SKU (via assignment) must figure byte-identical to no assignment at all");
});

test("computeTileTakeoff: a single-SKU condition (no assignment) figures one order with no orderBySku key (Task 6 regression guard)", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);

  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.equal("orderBySku" in agg, false);
  const expected = orderTiles({
    safeCount: agg.counts.safe,
    sku: cond.tile_setup.skus[0],
    breakage_pct: cond.tile_setup.purchase?.breakage_pct,
    attic_pct: cond.tile_setup.purchase?.attic_pct,
  });
  assert.deepEqual(agg.order, expected);
});

// ── Task 6, fix round 1: the kept-cell filter is genuinely exercised ───────
// The "single-color-in-room" test above (keptBySku.size===1 via a collapsing
// 1x1 unit) never puts a SECOND sku on a hole/out cell, so it can't tell a
// correct `kept = classified.filter(c.cls !== "out" && c.cls !== "hole")`
// from a broken one that forgot the filter entirely — both would produce
// keptBySku.size===1 either way, since NOTHING besides "A" is ever assigned
// anywhere in that fixture. These two tests close that gap: they assign "B"
// ONLY to a cell that classifies "out" (this one) or "hole" (the next test),
// and assert `orderBySku` stays ABSENT — a broken filter that let an
// out/hole cell's skuId leak into `keptBySku` would spawn a spurious second
// "B" entry (safe: 0, since `accumulate` never increments full/cut/corner
// for "out"/"hole" — see tileCalc/tiles.ts), which these assertions catch.
test("computeTileTakeoff: an 'out' cell assigned to a second SKU does NOT spawn a spurious orderBySku entry (kept-cell filter guard)", () => {
  const tile_setup = mintTileSetup();
  tile_setup.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222" },
  ];
  tile_setup.joint.width_in = 0;
  tile_setup.origin = [0, 0];
  tile_setup.edge_strategy = "start_full";
  // grid.ts's generator always pads ONE cell beyond the room on every side
  // (startI = floor(...) - 1, etc.) — cell (i:-1, j:0) sits entirely to the
  // LEFT of this 4x4ft room (x in [-1,0], the room's x starts at 0), so
  // classify.ts's bbox-disjoint fast path marks it "out" (confirmed
  // empirically: solveTileLayout with this exact setup puts (i:-1,j:0) at
  // cls "out", areaKept_sf 0). A {w:100,h:100} unit keeps every (i,j) this
  // small room's padded range touches on its OWN distinct slot key (no
  // mod-wraparound aliasing with any in-room cell), so mapping ONLY that
  // one out-of-room slot to "B" isolates the filter: every cell INSIDE the
  // room stays on the unmapped-slot default ("A"), and "B" is never placed
  // anywhere a correct filter would count.
  const unit = { w: 100, h: 100 };
  tile_setup.assignment = { mode: "repeat", unit, slots: { [slotKey({ i: -1, j: 0 }, unit)]: "B" } };
  const cond = { id: "condOutFilter", finish_tag: "CT-OUT", multiplier: 1, tile_setup };
  const shape = makeShape(cond.id); // 4x4ft room, 12x12in tile, 0 joint => 16 full, 0 cut, 0 hole

  const { byCond, byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const shapeSummary = byShape.get(shape.id);
  assert.ok(shapeSummary, "expected a byShape summary");
  const bCells = shapeSummary.layout.classified.filter((c: Classified) => c.quad.skuId === "B");
  assert.ok(bCells.length > 0, "expected the assignment to actually place a B quad in this solve (a no-op assignment would make the rest of this test meaningless)");
  assert.ok(
    bCells.every((c: Classified) => c.cls === "out"),
    `expected every B quad to classify "out", got ${JSON.stringify(bCells.map((c: Classified) => c.cls))}`,
  );

  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.equal(agg.counts.full, 16, "the room itself is untouched by the out-of-room B assignment");
  assert.equal("orderBySku" in agg, false, "an out-of-room SKU must never spawn a per-SKU order entry");
  const expected = orderTiles({ safeCount: 16, sku: tile_setup.skus[0] });
  assert.deepEqual(agg.order, expected, "byte-identical to a single-SKU figuring — the out cell contributes nothing");
});

test("computeTileTakeoff: a 'hole' cell (interior cutout) assigned to a second SKU does NOT spawn a spurious orderBySku entry (kept-cell filter guard)", () => {
  const tile_setup = mintTileSetup();
  tile_setup.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222" },
  ];
  tile_setup.joint.width_in = 0;
  tile_setup.origin = [0, 0];
  tile_setup.edge_strategy = "start_full";
  // A 1x1ft interior cutout at x in [1,2], y in [1,2] exactly matches cell
  // (i:1, j:1)'s own footprint: that quad has real overlap with the room's
  // OUTER shell (ignoring holes) but zero overlap with the room once the
  // hole is subtracted, so classify.ts marks it "hole", not "out"
  // (confirmed empirically). Same isolation technique as the out-cell test:
  // a large unit keeps every in-range (i,j) on its own slot, so mapping
  // ONLY that hole-straddling slot to "B" leaves every kept cell "A".
  const unit = { w: 100, h: 100 };
  tile_setup.assignment = { mode: "repeat", unit, slots: { [slotKey({ i: 1, j: 1 }, unit)]: "B" } };
  const cond = { id: "condHoleFilter", finish_tag: "CT-HOLE", multiplier: 1, tile_setup };
  const shape = {
    ...makeShape(cond.id),
    id: "shapeHoleFilter",
    verts_norm_holes: [[[0.25, 0.25], [0.5, 0.25], [0.5, 0.5], [0.25, 0.5]]],
  };

  const { byCond, byShape } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const shapeSummary = byShape.get(shape.id);
  assert.ok(shapeSummary, "expected a byShape summary");
  const bCells = shapeSummary.layout.classified.filter((c: Classified) => c.quad.skuId === "B");
  assert.ok(bCells.length > 0, "expected the assignment to actually place a B quad in this solve (a no-op assignment would make the rest of this test meaningless)");
  assert.ok(
    bCells.every((c: Classified) => c.cls === "hole"),
    `expected every B quad to classify "hole", got ${JSON.stringify(bCells.map((c: Classified) => c.cls))}`,
  );

  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.equal(agg.counts.full, 15, "16 cells minus the one hole cutout");
  assert.equal("orderBySku" in agg, false, "a hole-cutout SKU must never spawn a per-SKU order entry");
  const expected = orderTiles({ safeCount: 15, sku: tile_setup.skus[0] });
  assert.deepEqual(agg.order, expected, "byte-identical to a single-SKU figuring — the hole cell contributes nothing");
});

// ── Task 7 (2026-08-29 tile-multi-sku-field): tile_goods `by_sku[]` rows ───
// Task 6 put the per-SKU purchase split on the byCond aggregate
// (`agg.orderBySku`); this surfaces it in the report row tileReportRows
// builds, additive and ×N-scaled the SAME way the scalar purchase fields
// already are (safe/boxes/figured/with_margin) — mirrors the trim/joint ×N
// precedent above (line 888).
test("tileReportRows: a mixed (2+ kept SKU) condition emits by_sku[] with one entry per SKU, ×N scaled, summing to the row's scalars", () => {
  const cond = makeCheckerboardCondition();
  cond.multiplier = 2;
  const shape = makeShape(cond.id); // 4x4ft room, 12x12in tile, 0 joint => 16 full, split 8/8 across A/B
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const agg = byCond.get(cond.id);
  assert.ok(agg?.orderBySku, "expected a per-SKU order breakdown to build the report row from");

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 2 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  const row = out[0];

  assert.ok(Array.isArray(row.by_sku), "expected a by_sku[] array on the report row");
  assert.equal(row.by_sku.length, 2);
  const byId = Object.fromEntries(row.by_sku.map((o) => [o.sku_id, o]));
  assert.ok(byId.A && byId.B, "expected a by_sku entry for both A and B");

  // name/color resolve from the condition's tile_setup.skus by sku_id
  assert.equal(byId.A.name, "A");
  assert.equal(byId.A.color, "#111111");
  assert.equal(byId.B.name, "B");
  assert.equal(byId.B.color, "#222222");

  // ×N scaling mirrors the scalar purchase fields — each entry's safe/
  // boxes/figured/with_margin equal the byCond per-SKU figure × multiplier.
  const bySkuAgg = Object.fromEntries(agg.orderBySku.map((o) => [o.sku_id, o]));
  for (const id of ["A", "B"]) {
    assert.equal(byId[id].safe, bySkuAgg[id].safe * 2);
    assert.equal(byId[id].boxes, bySkuAgg[id].boxes * 2);
    assert.equal(byId[id].figured, bySkuAgg[id].figured * 2);
    assert.equal(byId[id].with_margin, bySkuAgg[id].with_margin * 2);
  }

  // the row's scalar purchase fields stay the SUM across by_sku — never a
  // separate pooled figuring.
  assert.equal(row.safe, byId.A.safe + byId.B.safe);
  assert.equal(row.boxes, byId.A.boxes + byId.B.boxes);
  assert.equal(row.figured, byId.A.figured + byId.B.figured);
  assert.equal(row.with_margin, byId.A.with_margin + byId.B.with_margin);
});

test("tileReportRows: a single-SKU/no-assignment condition's row has NO by_sku key (byte-identical to today)", () => {
  const cond = makeTileCondition();
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);
  const agg = byCond.get(cond.id);
  assert.ok(agg, "expected a byCond summary");
  assert.equal("orderBySku" in agg, false, "sanity: no per-SKU breakdown on this fixture");

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal("by_sku" in out[0], false, "a single-SKU condition must never emit a by_sku key");
});

test("tileReportRows: an assignment that resolves every kept cell to one SKU also emits NO by_sku key", () => {
  const cond = makeCheckerboardCondition();
  cond.id = "condSingleColorReport";
  cond.tile_setup.assignment = { mode: "repeat", unit: { w: 1, h: 1 }, slots: { "0_0": "A" } };
  const shape = makeShape(cond.id);
  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor, uppFor);

  const rows = [{ id: cond.id, finish_tag: cond.finish_tag, multiplier: 1 }];
  const out = tileReportRows(byCond, rows);
  assert.equal(out.length, 1);
  assert.equal("by_sku" in out[0], false, "one effective SKU (via assignment) must never emit a by_sku key");
});
