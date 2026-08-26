// web/test/tileSetup.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTileSetup, mintTileSetup, tileConfig } from "../src/lib/tileSetup.ts";

test("hasTileSetup: presence of a usable setup is the opt-in", () => {
  assert.equal(hasTileSetup({ tile_setup: mintTileSetup() }), true);
  assert.equal(hasTileSetup({}), false);
  assert.equal(hasTileSetup(null), false);
});

test("hasTileSetup: corrupt payloads read as opted out (no throw)", () => {
  assert.equal(hasTileSetup({ tile_setup: [] }), false);          // array
  assert.equal(hasTileSetup({ tile_setup: "grid" }), false);      // string
  assert.equal(hasTileSetup({ tile_setup: { skus: [] } }), false); // no usable tile
  assert.equal(hasTileSetup({ tile_setup: { skus: [{ w_in: 0, h_in: 12 }] } }), false); // non-positive size
});

test("mintTileSetup: sensible defaults", () => {
  const ts = mintTileSetup();
  assert.equal(ts.pattern, "grid");
  assert.equal(ts.skus.length, 1);
  assert.ok(ts.skus[0].w_in > 0 && ts.skus[0].h_in > 0);
  assert.ok(ts.joint.width_in > 0);
});

test("tileConfig: coerces the primary SKU + joint, clamps to positive", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 24; ts.skus[0].h_in = 12; ts.joint.width_in = 0.125;
  const cfg = tileConfig(ts);
  assert.equal(cfg.w_in, 24);
  assert.equal(cfg.h_in, 12);
  assert.equal(cfg.joint_in, 0.125);
  // clamps garbage
  const bad = tileConfig({ ...ts, skus: [{ ...ts.skus[0], w_in: -5 }], joint: { width_in: -1 } });
  assert.ok(bad.w_in > 0);
  assert.ok(bad.joint_in >= 0);
});
