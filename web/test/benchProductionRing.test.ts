// A5b — THE BENCH MUST MEASURE WHAT THE PRODUCT RETURNS.
//
// Production does not return `traceRegion(f)`. Every vector One-Click ring in
// the product is trace-THEN-SNAP and `area_sf` is computed from the SNAPPED
// ring. `bench/run.mts` and `bench/pin-goldens.mts` called bare `traceRegion`
// and never imported `snapVertices` at all, so every engine-pinned golden
// pinned a number the product never displays.
//
// These tests are written so that REMOVING THE SNAP AGAIN BREAKS THEM, in both
// of the ways it could be removed:
//   (1) drop it from the bench side  → the deepEqual against the hand-written
//       production expression fails;
//   (2) drop it from BOTH sides (e.g. neuter `snapVertices`, or make
//       `oneClickRing` return the raw trace) → the ABSOLUTE assertions fail,
//       because they pin the number itself: 120.00 SF, not "whatever both
//       sides agree on". This repo has four times shipped a guard that passed
//       against reverted code; a pure A-equals-B assertion is exactly that
//       guard, so it is never the only one here.
//
// The 120.00 SF is not invented for this test. e2e/make-fixture.cjs draws
// OFFICE 101 as a 216×180 pt rectangle at 1.6 pt stroke and
// e2e/one-click.e2e.cjs asserts the product measures 120 SF through real
// Chromium — which also fixes the corpus's WALL-LINE SEMANTICS as CENTRELINE
// (interior-clear would be 118.05 SF). The fixture below is that room, at the
// canvas's RENDER_SCALE of 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor,
  traceRegion, snapVertices, oneClickRing, snapNearest, ringArea,
  SNAP_CELL_PX, SNAP_TOL_PX, MASK_MAX_DIM,
  type FloodResult, type Point,
} from "../src/lib/oneclick.ts";
import { buildSnapGrid, nearestSnap } from "../src/lib/geometry.js";
import { SNAP_CELL } from "../src/lib/canvasConstants.js";
import { syntheticCorpus, snapPointsFor, WALL_SEMANTICS } from "../bench/corpus.ts";

// ── the fixture: e2e/make-fixture.cjs's OFFICE 101 at RENDER_SCALE 2 ────────
// 216 × 180 pt = 12 × 10 ft. At scale 2 that is 432 × 360 image px and
// 36 image px per foot, so the centreline area is exactly 120.00 SF.
const PX_PER_FT = 36;
const X0 = 200, Y0 = 200, X1 = 200 + 432, Y1 = 200 + 360;
const IMG_W = 1200, IMG_H = 1000;
const ROOM_SF = ((X1 - X0) / PX_PER_FT) * ((Y1 - Y0) / PX_PER_FT);   // 12 × 10 = 120

/** The room, as a moveTo/lineTo chain — one segment per wall. */
const roomSegs = (): number[] => [
  X0, Y0, X1, Y0, X1, Y0, X1, Y1, X1, Y1, X0, Y1, X0, Y1, X0, Y0,
];
/** …and the snap targets its op list would emit: the four corners. */
const roomPoints = (): Point[] => [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];

function floodRoom(): Extract<FloodResult, { status: "ok" }> {
  const mo = buildMask(roomSegs(), IMG_W, IMG_H, MASK_MAX_DIM, null, PX_PER_FT);
  const mppf = mo.ws * PX_PER_FT;
  const f = floodRegionSealed(mo, (X0 + X1) / 2, (Y0 + Y1) / 2, 0.5,
    sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(f.status, "ok");
  return f as Extract<FloodResult, { status: "ok" }>;
}

const sf = (ring: Point[]) => ringArea(ring) / (PX_PER_FT * PX_PER_FT);

/** EXACTLY the expression TakeoffCanvas.jsx and mcp/src/session.ts compute,
 *  written out by hand rather than routed through the shared helper — so this
 *  is an independent statement of what the product does, not a restatement of
 *  what the helper does. Compare with TakeoffCanvas.jsx `proposeRegion` /
 *  `ocLiveAt` / the agent one-click tool, and mcp/src/session.ts one_click. */
function productionRing(f: Extract<FloodResult, { status: "ok" }>, points: Point[]): Point[] {
  const grid = buildSnapGrid(points, SNAP_CELL);
  return snapVertices(traceRegion(f), (x, y, d) => (grid ? nearestSnap(grid, x, y, d) : null), 7);
}

test("A5b: the bench's ring IS the product's ring — same seed, same mask, same ring", () => {
  const f = floodRoom();
  const points = roomPoints();

  // what bench/run.mts and bench/pin-goldens.mts now compute
  const bench = oneClickRing(f, { nearest: snapNearest(points) });
  // what the product computes, spelled out
  const production = productionRing(f, points);

  assert.deepEqual(bench, production, "the bench and the product must trace the same ring");

  // (2) …and it is THE RIGHT RING, in absolute terms. If the snap were removed
  // from both sides these two assertions fail even though the deepEqual above
  // would still pass.
  assert.equal(+sf(production).toFixed(2), ROOM_SF,
    "the snapped ring measures the drawn room exactly — 120.00 SF, the figure e2e/one-click.e2e.cjs asserts through real Chromium");
  assert.deepEqual(production.map(([x, y]) => [x, y]).sort(), roomPoints().slice().sort(),
    "every corner landed on a true PDF vertex");
});

test("A5b: the un-snapped trace is a DIFFERENT, materially wrong number — so the guard above can fail", () => {
  const f = floodRoom();
  const raw = traceRegion(f);
  const snapped = oneClickRing(f, { nearest: snapNearest(roomPoints()) });

  assert.notDeepEqual(raw, snapped, "if these were equal the parity test could not discriminate");
  const err = Math.abs(sf(raw) - ROOM_SF) / ROOM_SF;
  assert.ok(err > 0.01, `the raw trace is materially off (${(err * 100).toFixed(2)}%) — this is the −2.03% the bench used to report as the product's accuracy`);
  assert.ok(sf(raw) < sf(snapped), "the raster contour sits INSIDE the drawn line; snapping pushes it back out to the centreline");
});

test("A5b: oneClickRing with no snap targets degrades to the raw trace, and says so by returning it", () => {
  const f = floodRoom();
  assert.deepEqual(oneClickRing(f, { nearest: null }), traceRegion(f));
  assert.deepEqual(oneClickRing(f, {}), traceRegion(f));
  // the raster path is a different measurement — no snap, looser eps
  assert.deepEqual(oneClickRing(f, { raster: true, rasterEps: 2.5 }), traceRegion(f, 2.5));
});

test("A5b: the shared helper's constants ARE the production constants", () => {
  assert.equal(SNAP_CELL_PX, SNAP_CELL, "oneclick.SNAP_CELL_PX must track canvasConstants.SNAP_CELL");
  assert.equal(SNAP_TOL_PX, 7, "the canvas passes a literal 7; mcp/src/session.ts's SNAP_TOL is 7");
});

// ── the call sites this test cannot import ─────────────────────────────────
// TakeoffCanvas.jsx is a React component (no DOM here) and mcp/src/session.ts
// has its own dependency tree, so neither can be executed from the web suite.
// What CAN be checked is that they still compose trace-then-snap with the same
// tolerance — i.e. that the parity asserted above still describes the product.
// If a call site is added, removed, or changed to skip the snap, this fires.
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("A5b: every vector One-Click ring in the product is still trace-then-snap at tolerance 7", () => {
  const sites: Array<[string, string, number]> = [
    ["../src/pages/TakeoffCanvas.jsx", "TakeoffCanvas", 3],
    ["../../mcp/src/session.ts", "mcp session", 2],
  ];
  for (const [rel, label, expected] of sites) {
    const text = src(rel);
    // snapVertices(traceRegion(<anything>), <nearest>, <tol>);  — `[^;]*?` keeps
    // each match inside one statement, so the tolerance captured is the LAST
    // argument of snapVertices, not an inner one.
    const calls = [...text.matchAll(/snapVertices\(\s*traceRegion\([^;]*?,\s*(\d+|SNAP_TOL)\s*\)\s*;/g)];
    assert.equal(calls.length, expected,
      `${label}: expected ${expected} trace-then-snap call site(s), found ${calls.length}. If the count changed on purpose, update this test AND re-check bench parity — the bench models these sites.`);
    for (const c of calls) {
      const tol = c[1] === "SNAP_TOL" ? 7 : Number(c[1]);
      assert.equal(tol, SNAP_TOL_PX, `${label}: snap tolerance ${c[1]} is not SNAP_TOL_PX (${SNAP_TOL_PX})`);
    }
    assert.match(text, /buildSnapGrid\(\s*[A-Za-z0-9_.]+\s*,\s*SNAP_CELL\s*\)/,
      `${label}: the snap grid must still be built at SNAP_CELL`);
  }
});

// ── the synthetic corpus's snap targets ────────────────────────────────────
test("A5b: snapPointsFor mirrors extractVectorGeometry's visit() rule", () => {
  const CURVE = 1;   // SEG_CURVE
  // a closed rectangle chain records its four corners once (the closing
  // segment is the `closePath` case and records nothing)
  assert.deepEqual(snapPointsFor(roomSegs()), roomPoints());

  // two disjoint chains: each contributes its own moveTo
  assert.deepEqual(
    snapPointsFor([0, 0, 10, 0, 20, 0, 30, 0]),
    [[0, 0], [10, 0], [20, 0], [30, 0]],
  );

  // a bezier run records ONLY its endpoint — never the chord vertices
  const leafThenArc = [0, 10, 0, 0, /* arc chords: */ 0, 0, 3, 1, 3, 1, 5, 3, 5, 3, 6, 6];
  const meta = Uint8Array.from([0, CURVE, CURVE, CURVE]);
  assert.deepEqual(snapPointsFor(leafThenArc, meta), [[0, 10], [0, 0], [6, 6]],
    "moveTo, the leaf's lineTo, and the arc's endpoint — the 2 interior chord vertices are not PDF vertices");
  // …and with the curve bits cleared the SAME chords are a polyline, so every
  // vertex is recorded. (The corpus reads SEG_CURVE as bezier provenance; this
  // pins that the reading, not an accident of the walk, is what drops them.)
  assert.equal(snapPointsFor(leafThenArc, null).length, 5);
});

test("A5b: every synthetic golden corner that is a drawn vertex is a snap target", () => {
  const cases = syntheticCorpus();
  assert.ok(cases.length >= 9);
  for (const c of cases) {
    assert.equal(c.wallSemantics, WALL_SEMANTICS);
    assert.ok(c.points.length > 0, `${c.name} has no snap targets`);
    const key = new Set(c.points.map(([x, y]) => `${x},${y}`));
    // the border rectangle is on every case
    for (const p of [[2, 2], [998, 2], [998, 798], [2, 798]]) assert.ok(key.has(p.join(",")), `${c.name}: border corner ${p}`);
    // no snap target may sit off the linework: every point must be an endpoint
    // of some segment (this is what makes the derivation checkable at all)
    const ends = new Set<string>();
    for (let i = 0; i < c.segs.length; i += 4) { ends.add(`${c.segs[i]},${c.segs[i + 1]}`); ends.add(`${c.segs[i + 2]},${c.segs[i + 3]}`); }
    for (const k of key) assert.ok(ends.has(k), `${c.name}: snap target ${k} is not a segment endpoint`);
  }
  // the two probes whose goldens are pure rectangles on drawn vertices must
  // snap to them EXACTLY — that is the 117.568 → 120.000 fix, in the corpus
  const room = cases.find((c) => c.name === "enclosed-room")!;
  for (const p of [[100, 100], [316, 100], [316, 280], [100, 280]]) assert.ok(room.points.some(([x, y]) => x === p[0] && y === p[1]), `enclosed-room corner ${p}`);
});
