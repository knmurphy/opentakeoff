import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

// A 4ft × 4ft room, 12×12 tiles, ZERO joint: exactly 16 full tiles, no cuts.
test("solveTileLayout: exact grid fit yields all-full, no cut (joint bridged correctly)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number,number][] = [[0,0],[4,0],[4,4],[0,4]];
  const { quads, classified } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const full = classified.filter((c) => c.cls === "full").length;
  const kept = classified.filter((c) => c.cls !== "out" && c.cls !== "hole");
  assert.equal(full, 16, "16 full 1ft tiles tile a 4ft square exactly");
  assert.equal(kept.every((c) => c.cls === "full"), true, "no cuts on an exact fit");
  assert.ok(quads.length >= 16);
});

// A 3.5ft × 4ft room: the half-foot strip must classify as cuts, not full.
test("solveTileLayout: partial row produces cut pieces (units bridged, not doubled)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const cuts = classified.filter((c) => c.cls === "cut" || c.cls === "corner");
  assert.equal(cuts.length, 4, "one half-tile cut per row (4 rows)");
  // cut width ≈ 6in (the half foot), not 0.5 or 42
  assert.ok(cuts.every((c) => Math.abs((c.cut?.w_in ?? 0) - 6) < 0.5 || Math.abs((c.cut?.h_in ?? 0) - 6) < 0.5));
});

test("solveTileLayout: degenerate ring returns empty, does not throw", () => {
  const ts = mintTileSetup();
  assert.deepEqual(solveTileLayout({ tile_setup: ts, ring_ft: [] }).classified, []);
});
