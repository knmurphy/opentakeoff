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

  const orderDefault = byCondDefault.get(condDefault.id).order;
  const custom = byCondCustom.get(condCustom.id);

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
  assert.equal(baseOut.counts.full, 16);
  assert.equal(baseOut.counts.cut, 0);

  // A per-room origin override PINS the grid (effectiveTileSetup skips the
  // balanced optimizer for an explicit override), shifting it half a tile so
  // both x-walls strand cut columns — the figured counts must follow the
  // override, not the condition default, or the drawn grid and the counts
  // would disagree (the M5 estimator-review must-fix).
  const shifted = { ...base, tile_layout: { origin: [0.5, 0] } };
  const shiftedOut = computeTileTakeoff([cond], [shifted], dimsFor, uppFor).byShape.get(shifted.id);
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

  assert.deepEqual(onSummary.order, offSummary.order);
  assert.deepEqual(onSummary.counts, offSummary.counts);
});

test("tileReportRows: reuse_enabled/reuse_whole/reuse_with_margin/reuse_boxes/reuse_downgraded are additive and scale by the condition multiplier", () => {
  const cond = makeReuseCondition();
  cond.tile_setup.purchase = { reuse: { enabled: true } };
  const shape = makeReuseShape("reuseShapeReport", cond.id);

  const { byCond } = computeTileTakeoff([cond], [shape], dimsFor2, uppFor2);
  const summary = byCond.get(cond.id);

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
  const tile_setup = { pattern: "grid", skus: [skuA, skuB] };

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
