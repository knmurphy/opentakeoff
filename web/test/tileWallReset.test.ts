// web/test/tileWallReset.test.ts
//
// Task 6 (2026-08-29 wall-tile-slice-a): reset-per-wall — summarizeWallShape's
// RESET branch tiles each wall segment (split at every fold, [u_{k-1},u_k])
// as its own balanced sub-strip, instead of wrap's single continuous
// unwrapped strip. `wallStrips` carries the N raw sub-strip layouts;
// `summary.layout.classified` is the CONCATENATION of every sub-strip's
// cells (M5 — tileTakeoff.js's condition-level `agg.classified` and the
// multi-SKU order split both read `summary.layout.classified`, so a merge
// that dropped a sub-strip would silently order a multi-SKU reset wall from
// a fraction of its own cells). Mode selection: a per-corner override wins,
// else tile_setup.wall_corner_mode, else the pattern default — herringbone/
// diagonal default to "reset" (a phase-locked field can't wrap a corner
// without a visible seam break); every other pattern still defaults to
// "wrap".
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeWallShape } from "../src/lib/tileWall/index.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import type { TileSetup } from "../src/lib/tileSetup.ts";
import { slotKey } from "../src/lib/tilePatterns/slotKey.ts";

// Same convention as tileWallUnwrap.test.ts / tileWallSummarize.test.ts:
// dims.w=100, upp=0.1 => 1 norm unit = 10ft; ft(x) places a vertex at x feet.
const dims = { w: 100, h: 100 };
const upp = 0.1;
const ft = (x: number) => x / 10;

function make12x12Setup() {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  return ts;
}

test("summarizeWallShape (reset): a two-wall run (10.5 + 7.5, H=8) produces exactly 2 sub-strips", () => {
  const ts = make12x12Setup();
  ts.wall_corner_mode = "reset";
  // Matches tileWallUnwrap.test.ts's/tileWallSummarize.test.ts's L-run
  // fixture: east 10.5ft then north 7.5ft, one inside fold.
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary, not a failure");
  const summary = s as Exclude<typeof s, { ok: false }>;

  assert.equal(summary.wallStrips.length, 2, "one fold -> 2 sub-strips");

  // M5: summary.layout.classified (what tileTakeoff.js's byCond aggregation
  // and the multi-SKU order split actually read) must be the CONCATENATION
  // of every sub-strip's own classified, never just one of them.
  const expectedLen = summary.wallStrips.reduce((n, w) => n + w.classified.length, 0);
  assert.equal(summary.layout.classified.length, expectedLen);

  // Total kept area is a geometry identity independent of corner mode: a
  // full rectangular strip's kept-cell areas always sum to exactly its own
  // L*H, whether solved as one continuous strip (wrap) or as two
  // independently-solved sub-strips (reset) that partition the same total
  // run length. 10.5*8 + 7.5*8 = 144.
  assert.ok(
    Math.abs(summary.counts.keptArea_sf - 144) < 0.1,
    `merged keptArea_sf ${summary.counts.keptArea_sf} should be close to 144`,
  );

  // Fold counting (corner_inside/joints) is unaffected by corner_mode — a
  // reset wall still reports exactly one inside fold and one H_ft movement
  // joint, same as wrap would for this same geometry.
  assert.equal(summary.trim.corner_inside, 1);
  assert.equal(summary.joints.total_lf, 8);

  // V is pinned to the floor datum on EVERY sub-strip independently — never
  // just the first.
  for (const strip of summary.wallStrips) {
    assert.equal(strip.config.origin[1], 0, "every sub-strip's V origin must stay pinned at 0");
  }
});

test("summarizeWallShape (reset): a single-segment run (no folds) is 1 sub-strip, same as wrap for that shape", () => {
  const ts = make12x12Setup();
  ts.wall_corner_mode = "reset";
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false);
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.equal(summary.wallStrips.length, 1);
  assert.equal(summary.trim.corner_inside, 0);
  assert.equal(summary.joints.total_lf, 0);
});

// M5 regression guard: a two-SKU reset wall's countsBySku must cover cells
// from BOTH sub-strips, not just the first. Construction: two segments, a
// SHORT one first (7.5ft) then a LONG one second (10.5ft), both solved at
// the SAME literal origin (edge_strategy "start_full", origin [0,0], so no
// per-segment balanced-origin search complicates which column index lands
// where). With a 1ft pitch (12in/0-joint) grid, column i=9 (spanning
// x=[9,10)) is entirely BEYOND the short 7.5ft sub-strip's own ring (so it
// classifies "out" there, zero kept area) but fully INSIDE the long 10.5ft
// sub-strip's ring (so it classifies "full" there, real kept area). The
// assignment paints exactly that column to SKU "B" — so bySku.get("B")
// can only show a real (nonzero) count if the SECOND sub-strip's cells
// actually made it into the merge, not just the first.
test("summarizeWallShape (reset): a two-SKU wall's countsBySku covers cells from BOTH sub-strips (M5 regression guard)", () => {
  const ts: TileSetup = {
    pattern: "grid",
    origin: [0, 0],
    rotation_deg: 0,
    edge_strategy: "start_full",
    skus: [
      { id: "A", name: "Tile A", w_in: 12, h_in: 12, color: "#111" },
      { id: "B", name: "Tile B", w_in: 12, h_in: 12, color: "#222" },
    ],
    joint: { width_in: 0 },
    wall_corner_mode: "reset",
  };
  const unit = { w: 100, h: 100 };
  ts.assignment = { mode: "repeat", unit, slots: { [slotKey({ i: 9, j: 3 }, unit)]: "B" } };

  // North 7.5ft (first/short segment), then east 10.5ft (second/long
  // segment) -- swapped from the other fixtures deliberately, so the
  // SECOND sub-strip is the long one column i=9 is reachable in.
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(0), ft(7.5)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary, not a failure");
  const summary = s as Exclude<typeof s, { ok: false }>;

  assert.equal(summary.wallStrips.length, 2);
  assert.ok(summary.wallStrips[0].bounds.maxX < 8, "sub-strip[0] (the short 7.5ft segment) is the FIRST strip");
  assert.ok(summary.wallStrips[1].bounds.maxX > 10, "sub-strip[1] (the long 10.5ft segment) is the SECOND strip");

  const bySku = summary.bySku;
  assert.equal(bySku.size, 2, "expected exactly 2 distinct SKUs in the merged field");
  const bCounts = bySku.get("B");
  assert.ok(bCounts, "expected a bySku entry for SKU B");
  assert.ok(
    bCounts!.full + bCounts!.cut + bCounts!.corner >= 1,
    "SKU B's painted column only has real (kept) cells in the SECOND sub-strip -- a merge that dropped it would show 0 here",
  );

  const aCounts = bySku.get("A");
  assert.ok(aCounts && aCounts.full > 0, "expected SKU A (the field default) to still cover the rest of both sub-strips");
});

test("summarizeWallShape: a herringbone pattern defaults to reset even with wall_corner_mode unset", () => {
  const ts: TileSetup = {
    pattern: "herringbone",
    origin: [0, 0],
    rotation_deg: 0,
    edge_strategy: "balanced",
    skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#000" }],
    joint: { width_in: 0.125 },
    // wall_corner_mode intentionally absent.
  };
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary, not a failure");
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.equal(summary.wallStrips.length, 2, "herringbone with no explicit wall_corner_mode must default to reset");
});

test("summarizeWallShape: a per-corner override {mode:'wrap'} overrides the herringbone reset default", () => {
  const ts: TileSetup = {
    pattern: "herringbone",
    origin: [0, 0],
    rotation_deg: 0,
    edge_strategy: "balanced",
    skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#000" }],
    joint: { width_in: 0.125 },
    // wall_corner_mode intentionally absent -- pattern default (reset) would
    // otherwise apply.
  };
  const shape = {
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]] as [number, number][],
    face_side: "left" as const,
    // Keyed by run-vertex index -- vertexIndex 1 is this L-run's one fold
    // (pinned by tileWallUnwrap.test.ts's own fixture assertion).
    wall_corner_overrides: { 1: { mode: "wrap" as const } },
  };
  const s = summarizeWallShape(ts, shape, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary, not a failure");
  const summary = s as Exclude<typeof s, { ok: false }>;
  assert.equal(summary.wallStrips.length, 1, "the per-corner wrap override must win over the herringbone reset default");
});
