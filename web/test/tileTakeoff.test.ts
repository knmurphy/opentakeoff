// web/test/tileTakeoff.test.ts
//
// computeTileTakeoff / tileReportRows — mirrors rollTakeoff's test contract
// (per-condition, per-shape figured takeoff bridge, Task 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { orderTiles } from "../src/lib/tileCalc/order.ts";
import { computeTileTakeoff, tileReportRows } from "../src/lib/tileTakeoff.js";

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
