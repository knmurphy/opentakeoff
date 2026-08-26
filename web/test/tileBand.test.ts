// web/test/tileBand.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandRings } from "../src/lib/tileEdges/band.ts";

// bbox extents (width/height) of an OPEN [x,y][] ring, for comparing
// buffered rectangles without depending on exact vertex count/order (a
// mitre-joined buffer can renode a straight edge with extra collinear
// points — see classify.ts's own simplifyCollinear rationale).
function bboxDims(ring: [number, number][]): { w: number; h: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

// Shoelace area of an OPEN ring (feet) — used to show a hole materially
// shrinks the buffered result, not just to compare bounding boxes.
function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

const TOL = 1e-6;

// 20ft × 12ft rectangular room.
const room20x12: [number, number][] = [[0, 0], [20, 0], [20, 12], [0, 12]];

test("rectangular room, offset 0, width 0.5ft: outer ~= room, inner inset 0.5ft/side", () => {
  const result = bandRings({ ring_ft: room20x12, offset_ft: 0, width_ft: 0.5 });
  assert.ok(result, "band should be produced for a room this size");
  const outerDims = bboxDims(result!.outer);
  const innerDims = bboxDims(result!.inner);
  assert.ok(Math.abs(outerDims.w - 20) < TOL, `outer width ${outerDims.w}`);
  assert.ok(Math.abs(outerDims.h - 12) < TOL, `outer height ${outerDims.h}`);
  assert.ok(Math.abs(innerDims.w - 19) < TOL, `inner width ${innerDims.w}`); // 20 - 2*0.5
  assert.ok(Math.abs(innerDims.h - 11) < TOL, `inner height ${innerDims.h}`); // 12 - 2*0.5
  // open rings: first point must not repeat the last.
  const [ox0, oy0] = result!.outer[0];
  const [oxn, oyn] = result!.outer[result!.outer.length - 1];
  assert.ok(ox0 !== oxn || oy0 !== oyn, "outer ring must be open");
  const [ix0, iy0] = result!.inner[0];
  const [ixn, iyn] = result!.inner[result!.inner.length - 1];
  assert.ok(ix0 !== ixn || iy0 !== iyn, "inner ring must be open");
});

test("width_ft larger than half the room's min dimension collapses to null", () => {
  // min dimension is 12ft (height); half is 6ft. width_ft=7 with offset_ft=0
  // erodes 7ft off every side of a 12ft-tall room -> negative remaining
  // height -> the inward buffer collapses to empty.
  const result = bandRings({ ring_ft: room20x12, offset_ft: 0, width_ft: 7 });
  assert.equal(result, null);
});

test("offset alone too deep for the room also collapses to null", () => {
  const result = bandRings({ ring_ft: room20x12, offset_ft: 6.5, width_ft: 0.5 });
  assert.equal(result, null);
});

test("a room with a hole: the hole is folded into the buffer (inner ring shrinks)", () => {
  // Hole centered in the room, big enough that once inner's erosion (3ft)
  // grows the hole by 3ft on every side, the grown hole swallows most of
  // the eroded solid, splitting it into two 2ft x 6ft strips (24 sf total)
  // instead of the hole-free 14ft x 6ft = 84 sf rectangle.
  const hole: [number, number][] = [[8, 4], [12, 4], [12, 8], [8, 8]];
  const noHole = bandRings({ ring_ft: room20x12, offset_ft: 0, width_ft: 3 });
  const withHole = bandRings({ ring_ft: room20x12, holes_ft: [hole], offset_ft: 0, width_ft: 3 });
  assert.ok(noHole, "no-hole band should be produced");
  assert.ok(withHole, "with-hole band should still be produced (split solid, not collapsed)");

  const noHoleInnerArea = ringArea(noHole!.inner);
  const withHoleInnerArea = ringArea(withHole!.inner);
  assert.ok(Math.abs(noHoleInnerArea - 84) < 1e-3, `no-hole inner area ${noHoleInnerArea}`);
  // The hole strictly reduces the retained inner area (it doesn't just pass
  // through untouched) — a materially different, deterministic result.
  assert.ok(withHoleInnerArea < noHoleInnerArea - 1, `with-hole inner area ${withHoleInnerArea} should be well under ${noHoleInnerArea}`);
  assert.ok(Math.abs(withHoleInnerArea - 12) < 1e-3, `with-hole inner area ${withHoleInnerArea} should be one 2x6 strip`);

  // outer (offset_ft=0, no erosion) is unaffected by the hole either way.
  const outerDims = bboxDims(withHole!.outer);
  assert.ok(Math.abs(outerDims.w - 20) < TOL && Math.abs(outerDims.h - 12) < TOL, "outer unaffected by a hole at distance 0");
});
