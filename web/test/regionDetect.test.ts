// Region detector (piece 2a) — input adapters. The detection logic itself is
// tested separately once it exists; these cover the source-neutral inputs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { longAxisLines, TB_SHEETNO_RE } from "../src/lib/regionDetect.ts";

// Sheet 2000 × 1000 px: shorter side 1000 →
//   collinear gap  ≤ 0.5% × 1000 = 5 px
//   dedupe band    ≤ 1% of the perpendicular dimension: 10 px (horizontal
//                  rules, 1% of h) / 20 px (vertical rules, 1% of w)
//   minimum length ≥ 15% × 1000 = 150 px
const W = 2000, H = 1000;
const seg = (...s: number[][]) => s.flat();

describe("longAxisLines", () => {
  test("empty input → no lines", () => {
    assert.deepEqual(longAxisLines([], W, H), []);
  });

  test("non-finite coordinates are dropped; the rest survive", () => {
    const good = [0, 100, W * 0.5, 100];
    const out = longAxisLines([0, 1, Infinity, 1, NaN, 5, 10, 5, 0, -Infinity, 0, 500, ...good], W, H);
    assert.equal(out.length, 1);
    for (const l of out) for (const v of [l.x0, l.y0, l.x1, l.y1]) assert.ok(Number.isFinite(v));
  });

  test("axis tolerance: 0.23° kept (snapped to the mean), 0.57° dropped", () => {
    const out = longAxisLines(seg(
      [0, 100, 1000, 104],   // atan(4/1000)  = 0.229° → horizontal at y = 102
      [0, 300, 1000, 310],   // atan(10/1000) = 0.573° → dropped
      [500, 0, 503, 800],    // atan(3/800)   = 0.215° → vertical at x = 501.5
      [900, 0, 909, 800],    // atan(9/800)   = 0.645° → dropped
    ), W, H);
    assert.deepEqual(out, [
      { x0: 0, y0: 102, x1: 1000, y1: 102 },
      { x0: 501.5, y0: 0, x1: 501.5, y1: 800 },
    ]);
  });

  test("diagonal and zero-length segments are dropped", () => {
    assert.deepEqual(longAxisLines(seg([0, 0, 1000, 1000], [10, 10, 10, 10], [0, 500, 800, 900]), W, H), []);
  });

  test("collinear pieces join across a gap ≤ 0.5% of the shorter side, not beyond", () => {
    const out = longAxisLines(seg(
      [0, 300, 400, 300], [404, 300, 900, 300],        // gap 4 ≤ 5 → one line 0..900
      [0, 400, 400, 400], [406, 400, 900, 400],        // gap 6 > 5 → two lines
      [1200, 600, 1000, 600], [1600, 600, 1195, 600],  // reversed + overlapping → 1000..1600
    ), W, H);
    assert.deepEqual(out, [
      { x0: 0, y0: 300, x1: 900, y1: 300 },
      { x0: 0, y0: 400, x1: 400, y1: 400 },
      { x0: 406, y0: 400, x1: 900, y1: 400 },
      { x0: 1000, y0: 600, x1: 1600, y1: 600 },
    ]);
  });

  test("short pieces that join into a long line survive the length floor", () => {
    // 100 + 97 px with a 3 px gap → 0..200 (≥ 150)
    assert.deepEqual(longAxisLines(seg([0, 700, 100, 700], [103, 700, 200, 700]), W, H), [
      { x0: 0, y0: 700, x1: 200, y1: 700 },
    ]);
  });

  test("lines shorter than 15% of the shorter side are dropped", () => {
    const out = longAxisLines(seg(
      [0, 600, 149, 600],    // 149 < 150 → dropped
      [0, 650, 150, 650],    // 150 → kept
      [1800, 0, 1800, 149],  // vertical 149 → dropped (floor uses the shorter side too)
      [1900, 0, 1900, 150],  // vertical 150 → kept
    ), W, H);
    assert.deepEqual(out, [
      { x0: 0, y0: 650, x1: 150, y1: 650 },
      { x0: 1900, y0: 0, x1: 1900, y1: 150 },
    ]);
  });

  test("a 3 px double rule merges into one line at the length-weighted mean", () => {
    const out = longAxisLines(seg(
      [10, 20, 1990, 20], [10, 23, 1990, 23],       // equal lengths → y = 21.5
      [30, 0, 30, 1000], [33, 0, 33, 1000],         // vertical double rule → x = 31.5
    ), W, H);
    assert.deepEqual(out, [
      { x0: 10, y0: 21.5, x1: 1990, y1: 21.5 },
      { x0: 31.5, y0: 0, x1: 31.5, y1: 1000 },
    ]);
  });

  test("parallel rules inside the 1% band merge; outside it they stay apart", () => {
    const out = longAxisLines(seg(
      [0, 100, 1000, 100], [0, 110, 1000, 110],   // 10 px apart = 1% of h → merge at y = 105
      [0, 500, 1000, 500], [0, 511, 1000, 511],   // 11 px apart → two rules
      [100, 0, 100, 400], [119, 0, 119, 400],     // vertical, 19 px < 1% of w (20) → merge at x = 109.5
    ), W, H);
    assert.deepEqual(out, [
      { x0: 0, y0: 105, x1: 1000, y1: 105 },
      { x0: 0, y0: 500, x1: 1000, y1: 500 },
      { x0: 0, y0: 511, x1: 1000, y1: 511 },
      { x0: 109.5, y0: 0, x1: 109.5, y1: 400 },
    ]);
  });

  test("near-parallel pieces that do not meet along the axis are not fused", () => {
    // y 100 and y 104 are within the band but 0..300 and 1000..1300 are 700 px apart
    const out = longAxisLines(seg([0, 100, 300, 100], [1000, 104, 1300, 104]), W, H);
    assert.deepEqual(out, [
      { x0: 0, y0: 100, x1: 300, y1: 100 },
      { x0: 1000, y0: 104, x1: 1300, y1: 104 },
    ]);
  });

  test("merged position is weighted by piece length", () => {
    // 1600 px at y = 200 and 400 px at y = 205, overlapping → (1600·200 + 400·205) / 2000 = 201
    assert.deepEqual(longAxisLines(seg([0, 200, 1600, 200], [1400, 205, 1800, 205]), W, H), [
      { x0: 0, y0: 201, x1: 1800, y1: 201 },
    ]);
  });
});

describe("TB_SHEETNO_RE", () => {
  test("is the plan's pattern, verbatim", () => {
    assert.equal(TB_SHEETNO_RE.source, String.raw`^[A-Z]{1,3}\d?[-. ]?\d{1,3}(\.\d{1,2})?[A-Z]?$`);
  });
  for (const s of ["A-601", "AF101", "A1-101", "C-100", "S401", "G-001", "S1.1", "A-101A", "B10"]) {
    test(`accepts ${s}`, () => assert.ok(TB_SHEETNO_RE.test(s)));
  }
  // A finish tag has the same shape: the pattern alone cannot tell them apart;
  // position and glyph height do (sheetno signal).
  test("accepts LVT-1 (finish-tag lookalike; the pattern does not exclude it)", () => {
    assert.ok(TB_SHEETNO_RE.test("LVT-1"));
  });
  for (const s of ["a-101", "A-1011", "ABCD-1", "SHEET", "101", "A-", "A-101AB", "A1-101.123"]) {
    test(`rejects ${s}`, () => assert.ok(!TB_SHEETNO_RE.test(s)));
  }
});
