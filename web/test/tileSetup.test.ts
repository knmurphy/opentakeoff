// web/test/tileSetup.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTileSetup, mintTileSetup, tileConfig } from "../src/lib/tileSetup.ts";
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";

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

test("CT-1 seed carries a usable tile_setup", () => {
  const ct1 = FLOORING_DEFAULTS.find((d) => d.finish_tag === "CT-1");
  assert.ok(ct1, "CT-1 seed exists");
  assert.equal(hasTileSetup(ct1), true);
  if (typeof ct1 !== "object" || ct1 === null || !("tile_setup" in ct1)) throw new Error("CT-1 missing tile_setup");
  const ts = ct1.tile_setup;
  if (typeof ts !== "object" || ts === null || !("skus" in ts) || !Array.isArray(ts.skus)) throw new Error("tile_setup malformed");
  const [sku] = ts.skus;
  if (typeof sku !== "object" || sku === null || !("w_in" in sku) || !("h_in" in sku)) throw new Error("sku malformed");
  assert.equal(sku.w_in, 12);
  assert.equal(sku.h_in, 24);
});

test("mintTileSetup: new purchase/thickness/per_box fields are optional, defaulted absent", () => {
  const ts = mintTileSetup();
  assert.equal(ts.purchase, undefined);
  assert.equal(ts.skus[0].thickness_in, undefined);
  assert.equal(ts.skus[0].per_box, undefined);
  // still opted in and usable with the new fields absent
  assert.equal(hasTileSetup({ tile_setup: ts }), true);
  const cfg = tileConfig(ts);
  assert.ok(cfg.w_in > 0 && cfg.h_in > 0);
});

test("hasTileSetup/tileConfig: unaffected when the new optional fields are present", () => {
  const ts = mintTileSetup();
  ts.purchase = { breakage_pct: 0.08, attic_pct: 0.05 };
  ts.skus[0].thickness_in = 0.375;
  ts.skus[0].per_box = 10;
  assert.equal(hasTileSetup({ tile_setup: ts }), true);
  const cfg = tileConfig(ts);
  assert.equal(cfg.w_in, ts.skus[0].w_in);
  assert.equal(cfg.h_in, ts.skus[0].h_in);
});
