import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { shapeTileCells } from "../src/lib/tileDxf.ts";

// 4ft × 4ft room, 12×12in tiles, zero joint: solveTileLayout yields exactly
// 16 full cells (tileSolve.test.ts's own fixture) — shapeTileCells must keep
// all 16 as "full" DxfTileCell entries, each a closed 4-corner quad.
test("shapeTileCells: exact grid fit yields 16 full cells, 4 corners each", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const layout = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const cells = shapeTileCells(layout);
  assert.equal(cells.length, 16, "16 full 1ft tiles tile a 4ft square exactly");
  assert.ok(cells.every((c) => c.cls === "full"));
  assert.ok(cells.every((c) => Array.isArray(c.pts_ft) && c.pts_ft.length === 4));
  // each cell is a 1ft square (zero joint → face == nominal quad)
  for (const c of cells) {
    const xs = c.pts_ft.map((p) => p[0]);
    const ys = c.pts_ft.map((p) => p[1]);
    assert.ok(Math.max(...xs) - Math.min(...xs) - 1 < 1e-9);
    assert.ok(Math.max(...ys) - Math.min(...ys) - 1 < 1e-9);
  }
});

test("shapeTileCells: null/missing layout returns empty", () => {
  assert.deepEqual(shapeTileCells(null), []);
  assert.deepEqual(shapeTileCells(undefined), []);
});

test("shapeTileCells: partial room drops out/hole cells, keeps cut/corner", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0, 0];
  const layout = solveTileLayout({ tile_setup: ts, ring_ft: [[0, 0], [3.5, 0], [3.5, 4], [0, 4]] });
  const cells = shapeTileCells(layout);
  assert.ok(cells.every((c) => c.cls === "full" || c.cls === "cut" || c.cls === "corner"));
  assert.ok(cells.some((c) => c.cls === "cut" || c.cls === "corner"));
});
