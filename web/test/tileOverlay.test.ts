import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { tileConfig } from "../src/lib/tileSetup.ts";
import {
  tileOverlayPrimitives,
  overlayCellPx,
  shouldShowGrid,
  bandOverlayPrimitives,
} from "../src/lib/tileOverlay.ts";
import { TILE_OVERLAY_MIN_CELL_PX } from "../src/lib/canvasConstants.js";

const colorFor = (skuId: string): string => `#color-${skuId}`;

test("tileOverlayPrimitives: known 4ft square room, 12x12 tile, zero joint — expected count + first-tile px position", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const layout = solveTileLayout({ tile_setup: ts, ring_ft: ring });

  const upp = 0.1; // 0.1 ft/px
  const { tiles, origin } = tileOverlayPrimitives(layout, upp, colorFor);

  const full = tiles.filter((t) => t.cls === "full");
  assert.equal(full.length, 16, "16 full 1ft tiles tile the 4ft square exactly");

  // First full tile is generated at cx=0.5ft, cy=0.5ft (bottom-left cell).
  const first = full[0];
  assert.ok(Math.abs(first.cx - 0.5 / upp) < 1e-9, "cx converted feet -> px via /upp");
  assert.ok(Math.abs(first.cy - 0.5 / upp) < 1e-9, "cy converted feet -> px via /upp");
  // Zero joint: installed face equals the nominal 1ft tile, in px.
  assert.ok(Math.abs(first.w - 1 / upp) < 1e-9);
  assert.ok(Math.abs(first.h - 1 / upp) < 1e-9);
  assert.equal(first.rot, 0);
  assert.equal(first.color, colorFor(ts.skus[0].id));

  assert.deepEqual(origin, { x: 0, y: 0 });
});

test("tileOverlayPrimitives: installed (drawn) face is smaller than nominal by ~the joint (grout gap shows)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0.125;
  ts.origin = [0, 0];
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const layout = solveTileLayout({ tile_setup: ts, ring_ft: ring });

  const upp = 0.1;
  const { tiles } = tileOverlayPrimitives(layout, upp, colorFor);
  const full = tiles.filter((t) => t.cls === "full");
  assert.ok(full.length > 0);

  const nominal_px = 1 / upp; // 1ft nominal tile
  const joint_px = (0.125 / 12) / upp;
  for (const t of full) {
    assert.ok(t.w < nominal_px, "drawn width inset from nominal by the joint");
    assert.ok(Math.abs(nominal_px - t.w - joint_px) < 1e-6, "inset equals the joint width (j/2 each side)");
  }
});

test("tileOverlayPrimitives: 'out' tiles are omitted; cut/corner/full/hole classes are carried through", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0, 0];
  const ring: [number, number][] = [[0, 0], [3.5, 0], [3.5, 4], [0, 4]];
  const layout = solveTileLayout({ tile_setup: ts, ring_ft: ring });

  assert.ok(layout.classified.some((c) => c.cls === "out"), "sanity: generator over-pads, so 'out' tiles exist");

  const { tiles } = tileOverlayPrimitives(layout, 0.1, colorFor);
  assert.equal(tiles.some((t) => t.cls === "out"), false, "'out' tiles never reach the overlay");

  const classesPresent = new Set(tiles.map((t) => t.cls));
  assert.ok(classesPresent.has("full"));
  assert.ok(classesPresent.has("cut") || classesPresent.has("corner"), "partial room produces cut/corner cells");
});

test("overlayCellPx / shouldShowGrid: false below the TILE_OVERLAY_MIN_CELL_PX threshold, true at/above it", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const config = tileConfig(ts);

  // installed face = 1ft (12in, zero joint). At scale=1: cellPx = 1/upp.
  const uppBelow = 1 / (TILE_OVERLAY_MIN_CELL_PX - 1); // cellPx = MIN-1 < MIN
  const uppAtOrAbove = 1 / TILE_OVERLAY_MIN_CELL_PX; // cellPx = MIN

  assert.ok(overlayCellPx(config, uppBelow, 1) < TILE_OVERLAY_MIN_CELL_PX);
  assert.equal(shouldShowGrid(config, uppBelow, 1), false);

  assert.ok(overlayCellPx(config, uppAtOrAbove, 1) >= TILE_OVERLAY_MIN_CELL_PX - 1e-9);
  assert.equal(shouldShowGrid(config, uppAtOrAbove, 1), true);
});

test("bandOverlayPrimitives: outer/inner feet rings convert to px via /upp, ring order preserved", () => {
  const upp = 0.1; // 0.1 ft/px
  const band = {
    outer: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][],
    inner: [[0.5, 0.5], [9.5, 0.5], [9.5, 9.5], [0.5, 9.5]] as [number, number][],
  };
  const { outer, inner } = bandOverlayPrimitives(band, upp);
  assert.deepEqual(outer, [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ]);
  assert.deepEqual(inner, [
    { x: 5, y: 5 }, { x: 95, y: 5 }, { x: 95, y: 95 }, { x: 5, y: 95 },
  ]);
});
