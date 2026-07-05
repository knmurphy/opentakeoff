// Canvas geometry helpers — pure (no DOM), extracted to lib/geometry.js so
// they finally have a test home. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { angleSnap, ANGLE_TOL, pointInPoly, distToSeg, hitShape, closedMetrics, openLen, buildSnapGrid, nearestSnap } from "../src/lib/geometry.js";

test("angleSnap: locks within tolerance of a 45° multiple, exact on-axis point", () => {
  const s = angleSnap([0, 0], [100, 3], false);      // ~1.7° off horizontal
  assert.ok(s, "should lock");
  assert.equal(s!.deg, 0);
  assert.equal(s!.pt[1], 0);                          // projected exactly onto the axis
  assert.ok(Math.abs(s!.pt[0] - 100) < 0.2, "length along the ray preserved");
});

test("angleSnap: passes through outside tolerance, unless forced", () => {
  const off = [100, Math.tan(((ANGLE_TOL + 3) * Math.PI) / 180) * 100] as [number, number];
  assert.equal(angleSnap([0, 0], off, false), null);
  const forced = angleSnap([0, 0], off, true);
  assert.ok(forced, "Shift forces the lock at any angle");
  assert.equal(forced!.deg, 0);
});

test("angleSnap: 45° family, degrees folded to [0,180)", () => {
  assert.equal(angleSnap([0, 0], [100, 99], false)!.deg, 45);
  assert.equal(angleSnap([0, 0], [-100, -99], false)!.deg, 45);   // opposite ray, same family
  assert.equal(angleSnap([0, 0], [2, 100], false)!.deg, 90);
  assert.equal(angleSnap([0, 0], [0, 0], false), null);           // zero-length
});

test("pointInPoly: concave polygon and outside points", () => {
  const L: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];  // L-shape
  assert.equal(pointInPoly(1, 3, L), true);   // in the vertical arm
  assert.equal(pointInPoly(3, 1, L), true);   // in the horizontal arm
  assert.equal(pointInPoly(3, 3, L), false);  // in the notch
  assert.equal(pointInPoly(5, 5, L), false);
});

test("distToSeg: perpendicular foot vs clamped endpoint", () => {
  assert.equal(distToSeg(5, 3, 0, 0, 10, 0), 3);      // foot inside the segment
  assert.equal(distToSeg(-4, 3, 0, 0, 10, 0), 5);     // clamps to endpoint (3-4-5)
  assert.equal(distToSeg(2, 2, 1, 1, 1, 1), Math.hypot(1, 1));  // degenerate segment
});

test("hitShape: per-role hit rules", () => {
  const w = 100, h = 100, thr = 3;
  const poly = { measure_role: "floor_area", verts_norm: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]] };
  assert.equal(hitShape(poly, 30, 30, w, h, thr), true);            // inside
  assert.equal(hitShape(poly, 10, 30, w, h, thr), true);            // on the edge
  assert.equal(hitShape(poly, 80, 80, w, h, thr), false);
  const lin = { measure_role: "linear", verts_norm: [[0.1, 0.8], [0.9, 0.8]] };
  assert.equal(hitShape(lin, 50, 81, w, h, thr), true);             // near the run
  assert.equal(hitShape(lin, 50, 70, w, h, thr), false);            // interior of nothing
  const cnt = { measure_role: "count", verts_norm: [[0.2, 0.2]] };
  assert.equal(hitShape(cnt, 24, 20, w, h, thr), true);             // within 2×thr
  assert.equal(hitShape(cnt, 30, 20, w, h, thr), false);
});

test("closedMetrics/openLen: shoelace area + perimeter vs open run length", () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const m = closedMetrics(sq);
  assert.equal(m.area, 100);
  assert.equal(m.perim, 40);
  assert.equal(openLen(sq), 30);                       // open: no closing edge
  assert.equal(closedMetrics([[0, 0], [3, 4]]).area, 0);  // degenerate → length only
});

test("snap grid: nearest endpoint within maxDist, across cell borders", () => {
  const grid = buildSnapGrid([[10, 10], [100, 100], [26, 10]], 24);
  assert.deepEqual(nearestSnap(grid, 12, 11, 8), [10, 10]);
  assert.deepEqual(nearestSnap(grid, 23, 10, 8), [26, 10]);  // neighbor cell wins
  assert.equal(nearestSnap(grid, 50, 50, 8), null);          // nothing in range
  assert.equal(nearestSnap(null, 50, 50, 8), null);
});
