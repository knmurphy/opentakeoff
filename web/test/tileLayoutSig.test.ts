// Layout-lifecycle persist/reset hash (design §3.7). tileLayoutSig is the
// memo key the canvas uses to know when a room's SOLVED tile layout must be
// thrown away vs kept across a re-render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileLayoutSig, type TileLayoutShape } from "../src/lib/tileLayoutSig.js";
import { mintTileSetup, type TileSetup } from "../src/lib/tileSetup.js";

function shape(overrides: Partial<TileLayoutShape> = {}): TileLayoutShape {
  return {
    verts_norm: [[0, 0], [1, 0], [1, 1], [0, 1]],
    ...overrides,
  };
}

test("tileLayoutSig: deterministic — same shape + tile_setup produce identical sigs across calls", () => {
  const s = shape();
  const ts = mintTileSetup();
  const a = tileLayoutSig(s, ts);
  const b = tileLayoutSig(s, ts);
  assert.equal(a, b);
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
});

test("tileLayoutSig: a verts_norm change flips the sig", () => {
  const ts = mintTileSetup();
  const a = tileLayoutSig(shape(), ts);
  const b = tileLayoutSig(shape({ verts_norm: [[0, 0], [2, 0], [2, 1], [0, 1]] }), ts);
  assert.notEqual(a, b);
});

test("tileLayoutSig: a verts_norm_holes change flips the sig", () => {
  const ts = mintTileSetup();
  const s = shape();
  const withHole = shape({ verts_norm_holes: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]] });
  const a = tileLayoutSig(s, ts);
  const b = tileLayoutSig(withHole, ts);
  assert.notEqual(a, b);

  const withOtherHole = shape({ verts_norm_holes: [[[0.1, 0.1], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]] });
  const c = tileLayoutSig(withOtherHole, ts);
  assert.notEqual(b, c);
});

test("tileLayoutSig: a tile_setup.pattern change flips the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, pattern: "herringbone" };
  assert.notEqual(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});

test("tileLayoutSig: a tile_setup joint width change flips the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, joint: { width_in: ts1.joint.width_in + 0.0625 } };
  assert.notEqual(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});

test("tileLayoutSig: a sku size change flips the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, skus: ts1.skus.map((sku) => ({ ...sku, w_in: sku.w_in + 6 })) };
  assert.notEqual(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});

test("tileLayoutSig: a tile_setup.origin change flips the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, origin: [0.5, 0.25] };
  assert.notEqual(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});

test("tileLayoutSig: a tile_setup.rotation_deg change flips the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, rotation_deg: 45 };
  assert.notEqual(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});

test("tileLayoutSig: a tile_setup.edge_strategy change flips the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, edge_strategy: "start_full" };
  assert.notEqual(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});

test("tileLayoutSig: shape.tile_layout.origin changes flip the sig", () => {
  const ts = mintTileSetup();
  const a = tileLayoutSig(shape(), ts);
  const b = tileLayoutSig(shape({ tile_layout: { origin: [0.1, 0.2] } }), ts);
  const c = tileLayoutSig(shape({ tile_layout: { origin: [0.15, 0.2] } }), ts);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

test("tileLayoutSig: shape.tile_layout.rotation changes flip the sig", () => {
  const ts = mintTileSetup();
  const a = tileLayoutSig(shape({ tile_layout: { origin: [0.1, 0.2] } }), ts);
  const b = tileLayoutSig(shape({ tile_layout: { origin: [0.1, 0.2], rotation: 30 } }), ts);
  assert.notEqual(a, b);
});

test("tileLayoutSig: shape.tile_layout.edge_overrides changes flip the sig", () => {
  const ts = mintTileSetup();
  const a = tileLayoutSig(shape({ tile_layout: { edge_overrides: { 0: { exposure: "trim", confirmed: true } } } }), ts);
  const b = tileLayoutSig(shape({ tile_layout: { edge_overrides: { 0: { exposure: "bullnose", confirmed: true } } } }), ts);
  const c = tileLayoutSig(shape({ tile_layout: { edge_overrides: { 0: { exposure: "bullnose", confirmed: false } } } }), ts);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

test("tileLayoutSig: scale/zoom is not an input — no scale parameter exists, so identical shape+tile_setup always match regardless of any on-screen zoom/scale the caller happens to be at", () => {
  const s = shape();
  const ts = mintTileSetup();
  // tileLayoutSig(shape, tile_setup) takes no upp/scale/zoom argument at
  // all, so a pure zoom (which only changes upp) can never reach this
  // function and can never flip the sig (design §3.7: "persists across
  // pure zoom"). Calling it repeatedly with the same geometry inputs, as a
  // caller would across a zoom gesture, proves it's stable.
  const sigs = [tileLayoutSig(s, ts), tileLayoutSig(s, ts), tileLayoutSig(s, ts)];
  assert.equal(new Set(sigs).size, 1);
});

test("tileLayoutSig: absence — a shape with no tile_layout and no holes still produces a stable sig", () => {
  const s = shape();
  const ts = mintTileSetup();
  const a = tileLayoutSig(s, ts);
  const b = tileLayoutSig(s, ts);
  assert.equal(a, b);
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
});

test("tileLayoutSig: adding a shape.tile_layout.band flips the sig", () => {
  const ts = mintTileSetup();
  const skuId = ts.skus[0].id;
  const a = tileLayoutSig(shape(), ts);
  const b = tileLayoutSig(shape({ tile_layout: { band: { sku_id: skuId, width_ft: 1, offset_ft: 0 } } }), ts);
  assert.notEqual(a, b);
});

test("tileLayoutSig: removing a shape.tile_layout.band flips the sig", () => {
  const ts = mintTileSetup();
  const skuId = ts.skus[0].id;
  const withBand = tileLayoutSig(shape({ tile_layout: { band: { sku_id: skuId, width_ft: 1, offset_ft: 0 } } }), ts);
  const withoutBand = tileLayoutSig(shape({ tile_layout: {} }), ts);
  assert.notEqual(withBand, withoutBand);
});

test("tileLayoutSig: changing a band's width_ft, offset_ft, or sku_id each flips the sig", () => {
  const ts = mintTileSetup();
  const skuId = ts.skus[0].id;
  const base = tileLayoutSig(shape({ tile_layout: { band: { sku_id: skuId, width_ft: 1, offset_ft: 0.5 } } }), ts);
  const widerBand = tileLayoutSig(shape({ tile_layout: { band: { sku_id: skuId, width_ft: 1.5, offset_ft: 0.5 } } }), ts);
  const deeperOffset = tileLayoutSig(shape({ tile_layout: { band: { sku_id: skuId, width_ft: 1, offset_ft: 0.75 } } }), ts);
  const otherSku = tileLayoutSig(shape({ tile_layout: { band: { sku_id: "other-sku", width_ft: 1, offset_ft: 0.5 } } }), ts);
  assert.notEqual(base, widerBand);
  assert.notEqual(base, deeperOffset);
  assert.notEqual(base, otherSku);
});

test("tileLayoutSig: an unrelated tile_setup change (sku color) does NOT flip the sig", () => {
  const s = shape();
  const ts1 = mintTileSetup();
  const ts2: TileSetup = { ...ts1, skus: ts1.skus.map((sku) => ({ ...sku, color: "#00ff00" })) };
  assert.equal(tileLayoutSig(s, ts1), tileLayoutSig(s, ts2));
});
