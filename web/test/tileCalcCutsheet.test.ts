import { test } from "node:test";
import assert from "node:assert/strict";
import { cutSheet } from "../src/lib/tileCalc/cutsheet.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("cutSheet: consolidates identical cuts into counted rows", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const rows = cutSheet(classified);
  // 4 identical 6"-wide half cuts (one per row) collapse to a single counted row.
  const half = rows.find((r) => Math.abs(r.w_in - 6) < 0.2 || Math.abs(r.h_in - 6) < 0.2);
  assert.ok(half && half.count === 4);
  assert.equal(rows.some((r) => r.count === 16), false, "full tiles never appear on the cut sheet");
});
