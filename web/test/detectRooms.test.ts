// Detect Rooms core tests — pure, DOM-free, pdfjs-free. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomLabelSeeds, detectRegions, ROOM_LABEL_RE } from "../src/lib/detectRooms.ts";
import { buildMask, MASK_MAX_DIM } from "../src/lib/oneclick.ts";

// a closed square room, as flat boundary segments in image px
function squareSegs(x0: number, y0: number, x1: number, y1: number): number[] {
  return [
    x0, y0, x1, y0,
    x1, y0, x1, y1,
    x1, y1, x0, y1,
    x0, y1, x0, y0,
  ];
}

test("ROOM_LABEL_RE: 2-3 digits with an optional trailing letter", () => {
  for (const s of ["10", "134", "139A", "170"]) assert.ok(ROOM_LABEL_RE.test(s), s);
  for (const s of ["1", "1234", "AB12", "104-A", ""]) assert.ok(!ROOM_LABEL_RE.test(s), s);
});

test("roomLabelSeeds: keeps only room-number tokens, ANY token in a multi-word item counts", () => {
  const items = [
    { str: "OFFICE 101", x: 50, y: 60 },
    { str: "CORRIDOR 104", x: 70, y: 80 },
    { str: "FLOOR FINISH PLAN", x: 0, y: 0 },        // no digits — dropped
    { str: "SCALE: 1/4\" = 1'-0\"", x: 10, y: 10 },  // no matching token — dropped
    { str: "139A", x: 90, y: 90 },                    // bare number+letter
  ];
  const seeds = roomLabelSeeds(items);
  assert.deepEqual(seeds, [
    { str: "101", seed: [50, 60] },
    { str: "104", seed: [70, 80] },
    { str: "139A", seed: [90, 90] },
  ]);
});

test("roomLabelSeeds: empty/whitespace-only strings and items with no digits produce no seed", () => {
  assert.deepEqual(roomLabelSeeds([{ str: "", x: 0, y: 0 }, { str: "   ", x: 1, y: 1 }, { str: "LOBBY", x: 2, y: 2 }]), []);
});

test("detectRegions: a clean room floods and is kept, status-gated (leak/tiny dropped)", () => {
  const segs = squareSegs(20, 20, 100, 100); // 80x80 interior
  const mask = buildMask(segs, 300, 300);
  const seeds = [
    { str: "101", seed: [60, 60] as [number, number] },   // inside the room — clean
    { str: "999", seed: [5, 5] as [number, number] },      // outside the enclosure — leaks
  ];
  const found = detectRegions(mask, seeds);
  assert.equal(found.length, 1, "only the clean flood survives the status gate");
  assert.equal(found[0].str, "101");
  assert.equal(found[0].flood.status, "ok");
});

test("detectRegions: an empty seed list detects nothing", () => {
  const mask = buildMask(squareSegs(20, 20, 100, 100), 300, 300);
  assert.deepEqual(detectRegions(mask, []), []);
});

// ── parity with the click path (issue #184 round 9) ────────────────────────
// detectRegions used to call the raw floodRegion, so a batch detection
// measured with the pre-sealing engine while a click on the same room got
// sealing, door wedges and the minimum-passage rule. These two pin the
// halves of that gap that are cheapest to state: a room only reachable
// THROUGH the seal ladder, and two rooms that must not merge into one
// double-counted region.

const PXFT = 18;                                    // 1/4" = 1'-0" at render scale 1
const outer = squareSegs(2, 2, 998, 798);           // sheet border, as in the bench corpus

test("detectRegions: a 3 ft cased opening is sealed, not dropped (click-path parity)", () => {
  // the bench's cased-opening-3ft geometry: a 12×10 ft room whose bottom wall
  // has a 54 px (3 ft) gap. The raw flood walks straight out of it.
  const room = [
    100, 100, 316, 100, 316, 100, 316, 280, 316, 280, 262, 280,
    208, 280, 100, 280, 100, 280, 100, 100,
  ];
  const mask = buildMask([...outer, ...room], 1000, 800, MASK_MAX_DIM, null, PXFT);
  const found = detectRegions(mask, [{ str: "101", seed: [200, 190] }]);
  assert.equal(found.length, 1, "the sealed flood recovers a room the raw flood leaks out of");
  assert.ok((found[0].flood.sealedPx ?? 0) > 0, "the seal ladder actually ran");
});

test("detectRegions: a sub-half-foot slit does not merge two rooms into double-counted floor", () => {
  // two rooms of DIFFERENT size sharing a wall with a 6 px (0.33 ft) slit —
  // under MIN_PASS_FT, so the minimum-passage rule must keep them apart. If
  // they merge, both labels return the same region and the same floor is
  // proposed twice.
  const shell = squareSegs(100, 100, 460, 280);     // 20×10 ft overall
  const wallX = 316;                                 // 12 ft from the left wall
  const sharedWall = [
    wallX, 100, wallX, 187,                          // upper stretch
    wallX, 193, wallX, 280,                          // lower stretch — 6 px slit between
  ];
  const mask = buildMask([...outer, ...shell, ...sharedWall], 1000, 800, MASK_MAX_DIM, null, PXFT);
  const found = detectRegions(mask, [
    { str: "101", seed: [200, 190] },                // the wide room
    { str: "102", seed: [400, 190] },                // the narrow room
  ]);
  assert.equal(found.length, 2, "both rooms detected");
  const [a, b] = found.map((r) => r.flood.count);
  const interior = found[0].flood.mw * found[0].flood.mh;   // generous upper bound
  assert.ok(a !== b, `merged regions would be identical (got ${a} and ${b})`);
  assert.ok(a > b, "the 12 ft room must read larger than the 8 ft one");
  assert.ok(a + b < interior, "neither room may swallow the other's floor");
});
