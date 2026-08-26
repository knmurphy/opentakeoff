import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeOrigin } from "../src/lib/tileGeometry/optimize.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

const sliverCount = (classified) => classified.filter((c) => {
  if (c.cls !== "cut" && c.cls !== "corner") return false;
  const wq = c.quad.w * 12, hq = c.quad.h * 12;
  return (c.cut && ((c.cut.w_in > 0.1 && c.cut.w_in < 0.5 * wq) || (c.cut.h_in > 0.1 && c.cut.h_in < 0.5 * hq)));
}).length;

// A 4.25ft-wide room with a starting origin at 0 leaves a 3in sliver strip;
// the optimizer should shift the origin so both edges get a larger cut.
test("optimizeOrigin: reduces sub-½ slivers vs the naive origin-0 layout", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const ring: [number,number][] = [[0,0],[4.25,0],[4.25,4],[0,4]];
  const before = sliverCount(solveTileLayout({ tile_setup: ts, ring_ft: ring }).classified);
  const { origin } = optimizeOrigin({ tile_setup: ts, ring_ft: ring });
  const after = sliverCount(solveTileLayout({ tile_setup: { ...ts, origin }, ring_ft: ring }).classified);
  assert.ok(after <= before);
  assert.ok(after === 0, "a 4.25ft room can be centered to two ~1.6in... balanced half-cuts with no sub-½ sliver band");
});

test("optimizeOrigin: herringbone ignores origin (returns setup origin unchanged)", () => {
  const ts = mintTileSetup(); ts.pattern = "herringbone"; ts.skus[0].w_in = 12; ts.skus[0].h_in = 24; ts.origin = [0.3,0.7];
  const { origin } = optimizeOrigin({ tile_setup: ts, ring_ft: [[0,0],[6,0],[6,6],[0,6]] });
  assert.deepEqual(origin, [0.3,0.7]);
});

test("optimizeOrigin: deterministic (same input → same origin)", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const ring: [number,number][] = [[0,0],[4.25,0],[4.25,4.1],[0,4.1]];
  assert.deepEqual(optimizeOrigin({ tile_setup: ts, ring_ft: ring }).origin, optimizeOrigin({ tile_setup: ts, ring_ft: ring }).origin);
});
