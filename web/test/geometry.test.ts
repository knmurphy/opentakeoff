// Geometry core tests — the One-Click pipeline is pure (no DOM, no pdf.js), so
// it runs straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMask, floodRegion, traceRegion, snapVertices, ringArea, rdpClosed,
  type Point,
} from "../src/lib/oneclick.ts";

// a closed square room, as flat boundary segments in image px
function squareSegs(x0: number, y0: number, x1: number, y1: number): number[] {
  return [
    x0, y0, x1, y0,
    x1, y0, x1, y1,
    x1, y1, x0, y1,
    x0, y1, x0, y0,
  ];
}

test("ringArea: unit square via shoelace", () => {
  const sq: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(ringArea(sq), 100);
});

test("flood + trace: an enclosed room is found and traced to ~its area", () => {
  const segs = squareSegs(20, 20, 100, 100);          // 80×80 interior
  const mask = buildMask(segs, 300, 300);   // room must be < 30% of the sheet, else it reads as a leak
  const res = floodRegion(mask, 60, 60);              // click in the middle
  assert.equal(res.status, "ok");
  if (res.status !== "ok") return;
  assert.ok(res.count > 30, "region should be larger than the tiny-sliver floor");
  const ring = traceRegion(res);
  assert.ok(ring.length >= 4, "a rectangular room should trace at least 4 vertices");
  const area = ringArea(ring);
  // the contour rides just inside the 1px wall, so a touch under 80×80 = 6400
  assert.ok(area > 5000 && area < 6800, `traced area ~6400, got ${area}`);
});

test("flood: clicking outside an enclosure leaks to the sheet edge", () => {
  const segs = squareSegs(20, 20, 100, 100);
  const mask = buildMask(segs, 300, 300);   // room must be < 30% of the sheet, else it reads as a leak
  const res = floodRegion(mask, 5, 5);                // outside the box
  assert.equal(res.status, "leak");
});

test("snapVertices: collapses near-duplicate corners (no snap target)", () => {
  const poly: Point[] = [[10, 10], [10.5, 10.4], [50, 10], [50, 50], [10, 50]];
  const out = snapVertices(poly, () => null);          // nearest returns nothing
  assert.equal(out.length, 4, "the ~0.6px-apart pair should merge to one corner");
});

test("snapVertices: pulls corners onto provided endpoints", () => {
  const poly: Point[] = [[9.7, 10.2], [50.3, 9.8], [50.1, 50.4], [9.6, 49.7]];
  const grid: Point[] = [[10, 10], [50, 10], [50, 50], [10, 50]];
  const nearest = (x: number, y: number, d: number): Point | null => {
    for (const g of grid) if (Math.hypot(g[0] - x, g[1] - y) <= d) return g;
    return null;
  };
  const out = snapVertices(poly, nearest, 6);
  assert.deepEqual(out, grid);
});

test("rdpClosed: a finely-sampled square simplifies toward 4 corners", () => {
  const pts: Point[] = [];
  const corners: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  for (let c = 0; c < 4; c++) {
    const a = corners[c], b = corners[(c + 1) % 4];
    for (let i = 0; i < 10; i++) pts.push([a[0] + (b[0] - a[0]) * (i / 10), a[1] + (b[1] - a[1]) * (i / 10)]);
  }
  const ring = rdpClosed(pts, 1.5);
  assert.ok(ring.length >= 4 && ring.length <= 8, `expected ~4 corners, got ${ring.length}`);
});
