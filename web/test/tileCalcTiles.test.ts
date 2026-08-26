import { test } from "node:test";
import assert from "node:assert/strict";
import { tileCounts, countsBySku } from "../src/lib/tileCalc/tiles.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("tileCounts: exact fit is all full, safe == full", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[4,0],[4,4],[0,4]] });
  const c = tileCounts(classified);
  assert.equal(c.full, 16); assert.equal(c.cut + c.corner, 0); assert.equal(c.safe, 16);
  assert.ok(Math.abs(c.keptArea_sf - 16) < 1e-6);
});

test("tileCounts: safe buys one whole tile per cut/corner", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const c = tileCounts(classified);
  assert.equal(c.safe, c.full + c.cut + c.corner);
  assert.ok(Math.abs(c.keptArea_sf - 14) < 1e-6, "3.5×4 = 14 sf kept");
});

test("countsBySku: partitions by skuId and sums to the whole", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[4,0],[4,4],[0,4]] });
  const by = countsBySku(classified);
  const total = [...by.values()].reduce((a, c) => a + c.safe, 0);
  assert.equal(total, tileCounts(classified).safe);
});
