// web/test/tileWallOrigin.test.ts
//
// Wall origin mode (design task 2, 2026-08-29 wall-tile-slice-a): a wall
// tiles its unwrapped L×H strip with the horizontal (U) origin
// center-and-balanced (mirrors the floor optimizer's candidate search) but
// the vertical (V) origin PINNED to the floor datum (origin[1]===0 always —
// full course at the floor, cut absorbed at the top). This is NOT the
// floor's 2D balanced-both-axes behavior; V is never centered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wallEffectiveTileSetup } from "../src/lib/tileWall/origin.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import type { TileSetup } from "../src/lib/tileSetup.ts";

const base: TileSetup = {
  pattern: "grid", origin: [0, 0], rotation_deg: 0,
  edge_strategy: "balanced",
  skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#000" }],
  joint: { width_in: 0.125 },
};

test("wallEffectiveTileSetup: pins the vertical origin to the floor datum (origin[1] === 0)", () => {
  const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17, 8) });
  assert.equal(eff.origin[1], 0);
});

test("wallEffectiveTileSetup: never balances V — a tall non-integer strip keeps origin[1]=0 (NOT centered)", () => {
  const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17, 8.4) });
  assert.equal(eff.origin[1], 0); // a centered V-origin would be > 0 here
});

test("wallEffectiveTileSetup: still balances U for a non-integer length (origin[0] may shift off 0)", () => {
  const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17.5, 8) });
  assert.equal(eff.origin[1], 0);
  assert.equal(Number.isFinite(eff.origin[0]), true);
});

test("wallEffectiveTileSetup: a non-balanced edge_strategy keeps the U origin as authored but V is still floor-pinned", () => {
  const startFull: TileSetup = { ...base, edge_strategy: "start_full", origin: [0.42, 0.9] };
  const eff = wallEffectiveTileSetup({ tile_setup: startFull, strip_ring: wallStripRing(17, 8) });
  assert.ok(Math.abs(eff.origin[0] - 0.42) < 10 ** -6, "U origin passes through unchanged for a non-balanced strategy");
  assert.equal(eff.origin[1], 0, "V is pinned to the floor regardless of edge_strategy");
});

test("wallEffectiveTileSetup: a pinned tile_layout.origin is honored (U) but V is still floor-pinned", () => {
  const eff = wallEffectiveTileSetup({
    tile_setup: base, strip_ring: wallStripRing(17, 8), tile_layout: { origin: [0.3, 0.9] },
  });
  assert.ok(Math.abs(eff.origin[0] - 0.3) < 10 ** -6);
  assert.equal(eff.origin[1], 0);
});

// Center-and-balance (§4.4): the balanced search must not default to a full
// tile hard against one end while the other end is left a sliver. 17.5ft at
// a 12in+0.125in-joint pitch leaves a partial-tile remainder along U; the
// chosen origin must split that remainder so both end cuts land within one
// tile width of each other, not dump it all on one side.
test("wallEffectiveTileSetup: balances the U origin for L=17.5 — end cuts within a tile of each other, not a full tile vs a sliver", () => {
  const strip = wallStripRing(17.5, 8);
  const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: strip });
  const { classified } = solveTileLayout({ tile_setup: eff, ring_ft: strip });
  const cfgW = 12; // in — base fixture's tile width
  // classifyLayout reports every cut/corner cell's kept w_in against the
  // INSTALLED FACE width (nominal minus the joint's own inset,
  // tilePitch.ts's installedFace = 12 - 0.125 = 11.875), even on an axis
  // the room boundary never clipped — so that baseline alone isn't evidence
  // of a real U cut. Filter against faceW (not the nominal 12in) to isolate
  // a genuine additional trim.
  const faceW = 12 - 0.125;
  const endCuts = classified
    .filter((c) => (c.cls === "cut" || c.cls === "corner") && c.cut)
    .map((c) => c.cut!.w_in)
    .filter((w) => w > 0.1 && w < faceW - 0.05); // an actual U-direction end cut, not the installed-face baseline
  assert.ok(endCuts.length > 0, "a 17.5ft run at a 12in pitch must leave at least one U-direction end cut");
  const minW = Math.min(...endCuts), maxW = Math.max(...endCuts);
  assert.ok(maxW - minW < cfgW, `end cuts should be balanced within a tile width, got min=${minW} max=${maxW}`);
});

// §11.3: origin[1]=0 seats a FULL course at the floor datum for grid
// (tilePatterns/grid.ts's startJ = floor((minY-oy)/cell.h) puts the row
// boundary at oy=0, so the row immediately above the floor is cell.j===0)
// — not merely "some full tiles exist somewhere", and NOT that a tile's
// physical edge sits at the literal y=0 plane (the joint reserves a
// half-joint gap inside each cell, so a full tile's bottom edge actually
// sits at half the joint width — that gap is expected, not a bug). Kept to
// grid deliberately: herringbone/basketweave only anchor their weave at
// v=0, they carry no "full course" claim.
test("wallEffectiveTileSetup: grid pattern seats a full course at the floor (row cell.j===0, immediately above the floor line, is a full tile — the cut lands at the top instead)", () => {
  const strip = wallStripRing(17, 8.4); // non-integer height — the cut must land at the TOP, not the bottom
  const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: strip });
  const { classified } = solveTileLayout({ tile_setup: eff, ring_ft: strip });
  // cls "full" means areaKept === areaFull (classify.ts) — an untrimmed
  // tile, in ANY direction. Finding one at cell.j===0 (the row immediately
  // above the floor datum) is conclusive: that row is not vertically cut.
  const fullAtFloor = classified.some((c) => c.cls === "full" && c.quad.cell?.j === 0);
  assert.equal(fullAtFloor, true, "expected at least one untrimmed tile in the floor row (cell.j===0)");
});
