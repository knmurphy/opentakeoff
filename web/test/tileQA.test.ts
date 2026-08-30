// web/test/tileQA.test.ts
//
// tileWarnings — the multi-room batch QA aggregator (design §2.I, M5 Task 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintTileSetup, type TileSetup } from "../src/lib/tileSetup.ts";
import { tileWarnings } from "../src/lib/tileQA.ts";

// A 4.25ft x 4ft room sitting inside a 10ft x 10ft sheet (1000x1000px at
// upp=0.01 ft/px), so a sliver quad's nominal center — which can sit just
// past the room's own edge — still lands well inside the [0,1] normalized
// sheet frame the panel pans to.
const DIMS = { w: 1000, h: 1000 };
const UPP = 0.01;
const ROOM_VERTS: [number, number][] = [
  [0, 0],
  [0.425, 0],
  [0.425, 0.4],
  [0, 0.4],
];

function makeCondition(id: string, tile_setup: TileSetup) {
  return { id, finish_tag: "CT-1", tile_setup };
}

function makeShape(id: string, condition_id: string, sheet_id = "sheet1") {
  return { id, condition_id, sheet_id, measure_role: "floor_area", verts_norm: ROOM_VERTS };
}

const dimsFor = (sheetId: string | undefined) => (sheetId === "sheet1" ? DIMS : null);
const uppFor = (sheetId: string | undefined) => (sheetId === "sheet1" ? UPP : null);

test("tileWarnings: no tile conditions → empty array", () => {
  assert.deepEqual(tileWarnings([], [], dimsFor, uppFor), []);
  assert.deepEqual(tileWarnings([{ id: "c1" }], [], dimsFor, uppFor), []);
});

test("tileWarnings: origin [0,0] on a 4.25ft-wide room strands a hairline sliver", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  // start_full HONORS the origin — a balanced setup would let effectiveTileSetup's
  // optimizer rescue this origin (see the balanced test below), so the sliver
  // only stands under a strategy that keeps the origin the user/engine set.
  ts.edge_strategy = "start_full";
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const slivers = warnings.filter((w) => w.kind === "sliver");
  assert.ok(slivers.length > 0, "expected at least one sliver warning");
  for (const w of slivers) {
    assert.equal(w.condition_id, "c1");
    assert.equal(w.shape_id, "s1");
    assert.equal(w.finish_tag, "CT-1");
    assert.equal(w.sheet_id, "sheet1");
    assert.ok(w.at_norm, "sliver warning carries an at_norm focus target");
    const [nx, ny] = w.at_norm as [number, number];
    assert.ok(nx >= 0 && nx <= 1, `at_norm.x ${nx} inside [0,1]`);
    assert.ok(ny >= 0 && ny <= 1, `at_norm.y ${ny} inside [0,1]`);
  }
});

test("tileWarnings: a balanced/centered origin on the same room yields no sliver warning", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  // The balanced origin optimizeOrigin finds for this exact room (see
  // tileOptimize.test.ts) — two ~7.5in cuts, neither sub-half.
  ts.origin = [0.625, 0];
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  assert.equal(warnings.filter((w) => w.kind === "sliver").length, 0);
});

test("tileWarnings: an unscaled sheet yields an 'unscaled' warning and does not crash", () => {
  const ts = mintTileSetup();
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1", "sheet2");
  const warnings = tileWarnings(
    [cond],
    [shape],
    (sheetId) => (sheetId === "sheet2" ? DIMS : null),
    (sheetId) => (sheetId === "sheet2" ? 0 : null),
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "unscaled");
  assert.equal(warnings[0].shape_id, "s1");
  assert.equal(warnings[0].sheet_id, "sheet2");
});

test("tileWarnings: a tile_setup whose layoutWarning is non-null surfaces a 'layout' warning", () => {
  const ts = mintTileSetup();
  ts.pattern = "herringbone";
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12; // 1:1, not the 2:1 herringbone needs — gap-free warning fires
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const layout = warnings.filter((w) => w.kind === "layout");
  assert.equal(layout.length, 1);
  assert.match(layout[0].detail, /herringbone/i);
});

test("tileWarnings: relays a canvas-set stitch_crossing flag as a seam_crossing warning", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const cond = makeCondition("c1", ts);
  // The canvas sets stitch_crossing on a room reaching a stitch's shared butt
  // edge (§5 doctrine: flagged for a HUMAN seam, never auto-joined). QA relays
  // it — it never infers stitch geometry itself.
  const shape = { ...makeShape("s1", "c1"), stitch_crossing: true };
  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const seam = warnings.filter((w) => w.kind === "seam_crossing");
  assert.equal(seam.length, 1);
  assert.equal(seam[0].shape_id, "s1");
});

test("tileWarnings: a band too small for the room emits a band_skipped warning with an at_norm focus target", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const cond = makeCondition("c1", ts);
  const skuId = ts.skus[0].id;
  // ROOM_VERTS is a 4.25ft x 4ft room; min dimension 4ft, half is 2ft. A
  // 3ft-wide band at 0ft offset erodes 3ft off every side of the inner
  // ring — past the collapse threshold, same posture as tileBand.test.ts's
  // own "collapses to null" case.
  const shape = { ...makeShape("s1", "c1"), tile_layout: { band: { sku_id: skuId, width_ft: 3, offset_ft: 0 } } };

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const skipped = warnings.filter((w) => w.kind === "band_skipped");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].shape_id, "s1");
  assert.equal(skipped[0].condition_id, "c1");
  assert.equal(skipped[0].finish_tag, "CT-1");
  assert.match(skipped[0].detail, /too small/i);
  assert.ok(skipped[0].at_norm, "band_skipped warning carries an at_norm focus target");
  const [nx, ny] = skipped[0].at_norm as [number, number];
  assert.ok(nx >= 0 && nx <= 1, `at_norm.x ${nx} inside [0,1]`);
  assert.ok(ny >= 0 && ny <= 1, `at_norm.y ${ny} inside [0,1]`);
});

test("tileWarnings: a band that fits the room emits no band_skipped warning", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const cond = makeCondition("c1", ts);
  const skuId = ts.skus[0].id;
  const shape = { ...makeShape("s1", "c1"), tile_layout: { band: { sku_id: skuId, width_ft: 0.5, offset_ft: 0 } } };

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  assert.equal(warnings.filter((w) => w.kind === "band_skipped").length, 0);
});

test("tileWarnings: no tile_layout.band → no band_skipped warning", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  assert.equal(warnings.filter((w) => w.kind === "band_skipped").length, 0);
});

// FIX 1 (P1) — tileWarnings used to destructure only `{ rings }` from
// fieldRingForBand and then solve against the RAW `ring_ft` (the full room)
// for both effectiveTileSetup and solveTileLayout, instead of the band's
// re-scoped `fieldRing_ft` summarizeShape (tileTakeoff.js) actually orders
// against. A 4.25ft x 4.25ft square room, 1ft tile, origin [0,0] pinned via
// start_full: the raw room ring leaves a 0.25ft leftover strip along the
// far edges (x=[4,4.25], y=[4,4.25]) — under half a tile, a sliver. A
// 0.25ft-wide band at 0ft offset erodes EXACTLY that leftover strip away:
// the field's own inner ring becomes [0.25,4.0]x[0.25,4.0], whose far edge
// (4.0) realigns flush with the tile grid (a grid line at every whole
// foot), leaving only a 0.75ft corner cut (well over half a tile) on the
// near edge — zero slivers. Any sliver reported here is therefore
// necessarily a phantom cell inside the band annulus the takeoff never
// orders (proven repro: 140 "safe" tiles audited vs 126 actually figured
// on the review's 20x14ft/1ft-band example).
test("tileWarnings: FIX 1 — a banded room is audited against the band's inner ring, not the raw room ring (no phantom sliver in the band annulus)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  ts.edge_strategy = "start_full";
  const cond = makeCondition("c1", ts);
  const skuId = ts.skus[0].id;
  const squareRoom: [number, number][] = [
    [0, 0],
    [0.425, 0],
    [0.425, 0.425],
    [0, 0.425],
  ];
  const shape = {
    id: "s1",
    condition_id: "c1",
    sheet_id: "sheet1",
    measure_role: "floor_area",
    verts_norm: squareRoom,
    tile_layout: { band: { sku_id: skuId, width_ft: 0.25, offset_ft: 0 } },
  };

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const slivers = warnings.filter((w) => w.kind === "sliver");
  assert.equal(
    slivers.length,
    0,
    `expected the band-shrunk field to report zero slivers, got ${JSON.stringify(slivers)}`,
  );
});

// FIX 4 (P2) — a band with sku_id set but width_ft <= 0 used to figure
// nothing and warn nothing, silently solving the full ring (the same P1
// posture as an unfixed band gate, minus even the honest "too small"
// warning). It must now be withheld with an explicit warning, agreeing
// with summarizeShape's (tileTakeoff.js) own width<=0 warning.
// Task 11 (2026-08-29 tile-multi-sku-field): solveTileLayout's same-size
// assignment gate (tileSolve.ts) pushes a warning into layout.warnings when
// a painted SKU's footprint differs from the field's — this aggregator used
// to destructure only { config, classified } and silently drop it, so a
// live canvas QA pass never surfaced the exact condition an export already
// reported. Two SKUs of DIFFERENT size so the gate actually trips.
test("tileWarnings: a mismatched-size SKU assignment surfaces a size_mismatch warning (mirrors solveTileLayout's own gate)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const otherId = "sku2";
  ts.skus.push({ id: otherId, name: "Other", w_in: 6, h_in: 6, color: "#000000" });
  ts.assignment = { mode: "repeat", unit: { w: 1, h: 1 }, slots: { "0_0": otherId } };
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const mismatch = warnings.filter((w) => w.kind === "size_mismatch");
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].shape_id, "s1");
  assert.equal(mismatch[0].condition_id, "c1");
  assert.equal(mismatch[0].finish_tag, "CT-1");
  assert.match(mismatch[0].detail, /multi-size/i);
  assert.ok(mismatch[0].at_norm, "size_mismatch warning carries an at_norm focus target");
});

test("tileWarnings: a same-size SKU assignment (the normal case) surfaces no size_mismatch warning", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const otherId = "sku2";
  ts.skus.push({ id: otherId, name: "Other", w_in: 12, h_in: 12, color: "#000000" });
  ts.assignment = { mode: "repeat", unit: { w: 1, h: 1 }, slots: { "0_0": otherId } };
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  assert.equal(warnings.filter((w) => w.kind === "size_mismatch").length, 0);
});

test("tileWarnings: a band with width_ft 0 is withheld with a warning, not a silent full-ring solve", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  const cond = makeCondition("c1", ts);
  const skuId = ts.skus[0].id;
  const shape = { ...makeShape("s1", "c1"), tile_layout: { band: { sku_id: skuId, width_ft: 0, offset_ft: 0 } } };

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const skipped = warnings.filter((w) => w.kind === "band_skipped");
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].detail, /width must be > 0/i);
});
