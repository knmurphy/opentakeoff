// web/test/tileTakeoff.test.ts
//
// computeTileTakeoff / tileReportRows — mirrors rollTakeoff's test contract
// (per-condition, per-shape figured takeoff bridge, Task 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
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
