// web/test/tileGeometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLayout } from "../src/lib/tileGeometry/classify.ts";
import { getPattern } from "../src/lib/tilePatterns/index.ts";

// a 2ft × 2ft room, 1ft tiles, no joint → 4 full tiles, none cut
const room: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
const quads = [
  { cx: 0.5, cy: 0.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 1.5, cy: 0.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 0.5, cy: 1.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 1.5, cy: 1.5, w: 1, h: 1, rot: 0, skuId: "s" },
];

test("a tile fully inside is full; one entirely outside is out", () => {
  const withOut = [...quads, { cx: 5, cy: 5, w: 1, h: 1, rot: 0, skuId: "s" }];
  const c = classifyLayout(withOut, room, [], 0);
  assert.equal(c.filter((x) => x.cls === "full").length, 4);
  assert.equal(c.filter((x) => x.cls === "out").length, 1);
});

test("a half-overhanging tile is cut with the right kept dimension", () => {
  // room 1.5ft wide → the second column is cut to 0.5ft
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 2], [0, 2]];
  const c = classifyLayout(quads, narrow, [], 0);
  const cut = c.find((x) => x.cls === "cut" || x.cls === "corner");
  assert.ok(cut, "a cut tile exists");
  assert.ok(Math.abs(cut!.cut!.w_in - 6) < 1e-3);   // 0.5ft = 6in kept
});

test("a hole punches tiles over it to 'hole'/'cut'", () => {
  const hole: [number, number][] = [[0.75, 0.75], [1.25, 0.75], [1.25, 1.25], [0.75, 1.25]];
  const c = classifyLayout(quads, room, [hole], 0);
  assert.ok(c.some((x) => x.cls === "cut" || x.cls === "hole"));
});

test("a corner tile touches two room edges", () => {
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]];
  const c = classifyLayout(quads, narrow, [], 0);
  assert.ok(c.some((x) => x.cls === "corner"));
});

// ── Task 11: cross-engine integration guard (determinism + kept-area = room-area) ──

// A 4ft × 3ft room (12 sf), tiled edge-to-edge (joint=0) by each gap-free
// M2 pattern. herringbone/basketweave are excluded here — they're only
// gap-free for their specific tile-ratio contract (see layoutWarning),
// not for an arbitrary 1×1 tile.
const bigBounds = { minX: 0, minY: 0, maxX: 4, maxY: 3 };
const bigRoom: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];

for (const pat of ["grid", "brick_50", "brick_33", "diagonal"]) {
  test(`${pat}: kept area sums to the room area (no drift) and is deterministic`, () => {
    const g = getPattern(pat);
    // joint=0 in BOTH calls: kept-area is joint-insensitive (it intersects
    // NOMINAL footprints), so this is the clean invariant check. Units
    // still matter in principle — generate()'s joint is feet, classifyLayout's
    // joint_in is inches — but 0 is 0 in either unit.
    const input = { bounds: bigBounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s" };
    const a = classifyLayout(g.generate(input), bigRoom, [], 0);
    const b = classifyLayout(g.generate(input), bigRoom, [], 0);
    assert.deepEqual(a, b, `${pat} is not deterministic`);
    const kept = a.reduce((sum, x) => sum + x.areaKept_sf, 0);
    assert.ok(Math.abs(kept - 12) < 0.05, `${pat} kept ${kept} sf vs room's 12 sf`);
  });
}

// Nonzero-joint cut-dimension test: generate() takes joint in FEET,
// classifyLayout takes joint_in in INCHES — this pins the correct unit
// conversion between the two call sites (Task 10 review finding). A
// 1/4in joint is 0.25/12 ft to generate() and 0.25 to classifyLayout().
test("grid: a nonzero joint produces a sensible, joint-inset cut dimension, with a FEET-unit lattice", () => {
  const g = getPattern("grid");
  const jointIn = 0.25;
  const jointFt = jointIn / 12;
  const input = {
    bounds: { minX: 0, minY: 0, maxX: 1.5, maxY: 2 },
    w_ft: 1, h_ft: 1, joint_ft: jointFt,
    origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s",
  };
  const quads = g.generate(input);

  // Pin the GENERATOR side of the unit boundary directly: grid's lattice
  // pitch is `w + joint` in generate()'s own (feet) unit, so two tiles in
  // the same row must sit exactly `1 + jointFt` apart. If generate() were
  // ever fed `jointIn` (0.25) as if it were feet — the exact bug this test
  // exists to catch — spacing would be 1.25, not ~1.02083, and this fails.
  const cy0 = quads[0].cy;
  const row = quads.filter((q) => q.cy === cy0).map((q) => q.cx).sort((a, b) => a - b);
  assert.ok(row.length >= 2, "row has at least two tiles to measure lattice spacing");
  const spacing = row[1] - row[0];
  assert.ok(
    Math.abs(spacing - (1 + jointFt)) < 1e-6,
    `lattice spacing (${spacing}) should be tile width + joint-in-FEET (${1 + jointFt})`,
  );

  // Pin the CLASSIFY side of the unit boundary: classifyLayout takes
  // joint_in in INCHES (0.25, not 0.25/12) and insets the installed face
  // by half that joint, so a cut tile's kept width must land strictly
  // between 0 and the 12in nominal face.
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 2], [0, 2]];
  const c = classifyLayout(quads, narrow, [], jointIn);
  const cut = c.find((x) => x.cls === "cut" || x.cls === "corner");
  assert.ok(cut, "a cut/corner tile exists in a 1.5ft-wide room of 1ft tiles");
  const w_in = cut!.cut!.w_in;
  assert.ok(Number.isFinite(w_in), "cut.w_in is finite");
  assert.ok(w_in > 0, `cut.w_in (${w_in}) should be a positive kept width`);
  assert.ok(w_in < 12, `cut.w_in (${w_in}) should be less than the 12in nominal face`);
});

// Optional Task 10 coverage gap: a hole that bisects a tile into two
// disjoint kept fragments, exercising jsts's MultiPolygon overlay result
// (largestPolygonPart / localBBox over a multi-part kept geometry).
test("a hole bisecting a tile classifies as cut with a finite, positive kept area", () => {
  const wholeRoomTile = [{ cx: 1, cy: 1, w: 2, h: 2, rot: 0, skuId: "s" }];
  // a full-width horizontal strip through the middle of the 2x2 room/tile
  const bisectingHole: [number, number][] = [[0, 0.9], [2, 0.9], [2, 1.1], [0, 1.1]];
  const c = classifyLayout(wholeRoomTile, room, [bisectingHole], 0);
  assert.equal(c.length, 1);
  assert.ok(c[0].cls === "cut" || c[0].cls === "hole", `expected cut/hole, got ${c[0].cls}`);
  assert.ok(Number.isFinite(c[0].areaKept_sf));
  assert.ok(Math.abs(c[0].areaKept_sf - 3.6) < 1e-6, `expected ~3.6 sf kept, got ${c[0].areaKept_sf}`);
});
