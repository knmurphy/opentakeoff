// Region detector (piece 2a): the source-neutral input adapters, then the
// detection steps (docs/design/REGION_ANNOTATION_PLAN.md, "Algorithm") over
// hand-built in-code sheets with hand-computed expectations.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  longAxisLines, TB_SHEETNO_RE, sheetnoCandidates, findBorder, tokenCenter, findCandidates, stripUV, farEnd, confidenceFor, detectTitleBlock,
  MIN_STRIP_TOKENS, classifyRepetition, repetitionBands, repeatOptions, normText, framesBand, FRAME_BAND_RATIO, BAND_GAP,
  REPEAT_POS_TOL, BAND_DEPTH, detectSetRegions, STATIC_MIN_SHEETS, FIELD_MIN_SHEETS, REPEAT_MIN_SHARE, type RepeatInput, type TokenClasses,
  type DetectLine, type DetectSheet, type DetectToken, type Edge, type DetectOptions,
} from "../src/lib/regionDetect.ts";
import { aspectBucket, capStatics, cleanRegions, hitRegion, type SheetRegions } from "../src/lib/regions.ts";
import * as Synth from "./fixtures/regionSynth.ts";

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

// ── detection: hand-built sheets ────────────────────────────────────────────
// Page 3000 × 2000 px. Border rules 2% in: x 60 / 2940, y 40 / 1960, so the
// border box is 2880 × 1920. Depths are fractions of the border dimension
// perpendicular to the edge, from the border: a bottom chain at d = 0.1 sits
// at y = 1960 − 0.1 × 1920 = 1768.
const PW = 3000, PH = 2000;
const BX0 = 60, BY0 = 40, BX1 = 2940, BY1 = 1960, BW = BX1 - BX0, BH = BY1 - BY0;
const hl = (x0: number, x1: number, y: number): DetectLine => ({ x0: Math.min(x0, x1), y0: y, x1: Math.max(x0, x1), y1: y });
const vl = (x: number, y0: number, y1: number): DetectLine => ({ x0: x, y0: Math.min(y0, y1), x1: x, y1: Math.max(y0, y1) });
const BORDER_RULES: DetectLine[] = [hl(BX0, BX1, BY0), hl(BX0, BX1, BY1), vl(BX0, BY0, BY1), vl(BX1, BY0, BY1)];
const mk = (lines: DetectLine[], tokens: DetectToken[] = [], w = PW, h = PH): DetectSheet =>
  ({ key: "t.pdf", w, h, tokens, lines, source: "vector" });
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const assertClose = (a: number, b: number, what = "", eps = 1e-9) => assert.ok(close(a, b, eps), `${what}: ${a} vs ${b}`);
const assertBox = (got: readonly number[], want: readonly number[]) => got.forEach((v, k) => assertClose(v, want[k], `box[${k}]`));
const ruled = (top: boolean, right: boolean, bottom: boolean, left: boolean) => ({ top, right, bottom, left });

describe("findBorder (step 1)", () => {
  test("outermost of a pair of full frames within 8% of the page edge", () => {
    // outer frame at 2%, inner frame at 4% (x 120 / 2880, y 80 / 1920)
    const b = findBorder(mk([...BORDER_RULES, hl(120, 2880, 80), hl(120, 2880, 1920), vl(120, 80, 1920), vl(2880, 80, 1920)]));
    assertBox(b.box, [60, 40, 2940, 1960]);
    assert.deepEqual(b.ruled, ruled(true, true, true, true));
  });

  test("a 5.6% left border (Porterville) is found; a rule at 8.5% is not a border", () => {
    // 0.056 × 3000 = 168
    assertBox(findBorder(mk([hl(168, BX1, BY0), hl(168, BX1, BY1), vl(168, BY0, BY1), vl(BX1, BY0, BY1)])).box, [168, 40, 2940, 1960]);
    // 0.085 × 3000 = 255 → no left border rule → the page edge
    const b = findBorder(mk([hl(255, BX1, BY0), hl(255, BX1, BY1), vl(255, BY0, BY1), vl(BX1, BY0, BY1)]));
    assertBox(b.box, [0, 40, 2940, 1960]);
    assert.deepEqual(b.ruled, ruled(true, true, true, false));
  });

  test("8% of the page edge is the limit: 7.9% kept, 8.1% not", () => {
    // top: 0.079 × 2000 = 158; 0.081 × 2000 = 162
    assertClose(findBorder(mk([hl(BX0, BX1, 158), hl(BX0, BX1, BY1), vl(BX0, 158, BY1), vl(BX1, 158, BY1)])).box[1], 158);
    assertClose(findBorder(mk([hl(BX0, BX1, 162), hl(BX0, BX1, BY1), vl(BX0, 162, BY1), vl(BX1, 162, BY1)])).box[1], 0);
  });

  test("a missing side uses the page edge", () => {
    const b = findBorder(mk([hl(BX0, BX1, BY0), hl(BX0, BX1, BY1), vl(BX0, BY0, BY1)]));
    assertBox(b.box, [60, 40, 3000, 1960]);
    assert.deepEqual(b.ruled, ruled(true, false, true, true));
  });

  test("no rules at all → the page", () => {
    const b = findBorder(mk([]));
    assertBox(b.box, [0, 0, PW, PH]);
    assert.deepEqual(b.ruled, ruled(false, false, false, false));
  });

  test("rules within 1% of the page edge are ignored", () => {
    // page-edge frame at 0.5% (x 15 / 2985, y 10 / 1990) outside the real border
    const pe = [hl(15, 2985, 10), hl(15, 2985, 1990), vl(15, 10, 1990), vl(2985, 10, 1990)];
    assertBox(findBorder(mk([...pe, ...BORDER_RULES])).box, [60, 40, 2940, 1960]);
    // only a page-edge rule on the top side → the page edge, not the rule
    const b = findBorder(mk([hl(15, 2985, 10), hl(BX0, BX1, BY1), vl(BX0, BY0, BY1), vl(BX1, BY0, BY1)]));
    assertClose(b.box[1], 0);
    assert.equal(b.ruled.top, false);
    // 1% exactly (y = 20) is still "within 1%"; 1.1% (y = 22) is a border
    assertClose(findBorder(mk([hl(BX0, BX1, 20)])).box[1], 0);
    assertClose(findBorder(mk([hl(BX0, BX1, 22)])).box[1], 22);
  });

  test("a double rule 3 px apart is de-duplicated into one rule at its mean", () => {
    const b = findBorder(mk([...BORDER_RULES, hl(BX0 + 3, BX1 - 3, BY0 + 3), vl(BX0 + 3, BY0 + 3, BY1 - 3)]));
    // top: pieces 2880 px at y 40 and 2874 px at y 43 → (2880·40 + 2874·43) / 5754
    assertClose(b.box[1], (2880 * 40 + 2874 * 43) / 5754);
    assertClose(b.box[0], (1920 * 60 + 1914 * 63) / 3834);
    assertClose(b.box[2], 2940);
  });

  test("span ≥ 75% of the side: Porterville's 83% top/bottom rules count, 74% do not", () => {
    // 83%: x 60 … 2550 (2490 px = 0.83 × 3000)
    const b = findBorder(mk([hl(60, 2550, BY0), hl(60, 2550, BY1), vl(BX0, BY0, BY1), vl(BX1, BY0, BY1)]));
    assertBox(b.box, [60, 40, 2940, 1960]);
    // 75% exactly: 2250 px
    assertClose(findBorder(mk([hl(60, 2310, BY0)])).box[1], 40);
    // 74%: 2220 px → no top border
    assertClose(findBorder(mk([hl(60, 2280, BY0)])).box[1], 0);
    // vertical side: 75% of the height is 1500 px
    assertClose(findBorder(mk([vl(BX1, 40, 1540)])).box[2], 2940);
    assertClose(findBorder(mk([vl(BX1, 40, 1520)])).box[2], 3000);
  });

  test("the span is measured against the border side, not the page side", () => {
    // left/right borders at 5% (x 150 / 2850): the border is 2700 wide. Top and
    // bottom rules from 150 to 2310 span 2160 px = 72% of the page width but
    // 80% of the border width → found (pass 2 measures against the pass-1 box).
    const lines = [hl(150, 2310, BY0), hl(150, 2310, BY1), vl(150, BY0, BY1), vl(2850, BY0, BY1)];
    assertBox(findBorder(mk(lines)).box, [150, 40, 2850, 1960]);
    // without the side rules the box is the page width: 72% < 75% → page edge
    assertBox(findBorder(mk(lines.slice(0, 2))).box, [0, 0, 3000, 2000]);
  });

  test("a border drawn in two collinear pieces joins across a small gap", () => {
    // 45% + 45% of the width with a 4 px gap (≤ 0.5% × 2000 = 10) → 90% span
    assertClose(findBorder(mk([hl(60, 1410, BY0), hl(1414, 2764, BY0)])).box[1], 40);
    // the same pieces 20 px apart do not join: each is 45% < 75%
    assertClose(findBorder(mk([hl(60, 1410, BY0), hl(1430, 2780, BY0)])).box[1], 0);
  });
});

const BOX: [number, number, number, number] = [BX0, BY0, BX1, BY1];
const fullBorder = { box: BOX, ruled: ruled(true, true, true, true) };
const yB = (d: number) => BY1 - d * BH;          // bottom chain y at depth d
const xU = (u: number) => BX0 + u * BW;          // x at u along a bottom/top edge
const cands = (lines: DetectLine[], border = fullBorder) => findCandidates(mk([...BORDER_RULES, ...lines]), border);

describe("findCandidates (step 2)", () => {
  test("a border-to-border rule is one candidate touching both ends; border rules are never candidates", () => {
    const cs = cands([hl(BX0, BX1, 1768)]);
    assert.equal(cs.length, 1);
    const c = cs[0];
    assert.equal(c.edge, "bottom");
    assertClose(c.d, 0.1);
    assert.deepEqual(c.extent, [0, 1]);
    assertClose(c.cover, 1);
    assert.equal(c.touch, "both");
    assert.equal(c.frame, true);
    assert.equal(c.freeEndGap, null);
  });

  test("chains join across a gap ≤ 0.5% of the border length, not at 0.6%", () => {
    // 0.45% × 2880 = 12.96 px; 0.6% × 2880 = 17.28 px; each half alone covers 50%
    const joined = cands([hl(BX0, 1500, 1768), hl(1500 + 12.96, BX1, 1768)]);
    assert.equal(joined.length, 1);
    assertClose(joined[0].cover, 1);
    assert.deepEqual(cands([hl(BX0, 1500, 1768), hl(1500 + 17.28, BX1, 1768)]), []);
  });

  test("a double chain 3 px apart is one candidate", () => {
    const cs = cands([hl(BX0, BX1, 1768), hl(BX0, BX1, 1771)]);
    assert.equal(cs.length, 1);
    assertClose(cs[0].d, (1960 - 1769.5) / 1920);
  });

  test("free end: a rule that fails to reach the border rejects (T-junction); a divider to the border keeps", () => {
    const chain = hl(xU(0.25), BX1, 1768);   // x 780 … 2940: cover 0.75, touches the right border
    const plain = cands([chain]);
    assert.equal(plain.length, 1, "no rule at the free end → kept");
    assert.equal(plain[0].touch, "far");
    assertClose(plain[0].extent[0], 0.25); assertClose(plain[0].extent[1], 1); assertClose(plain[0].cover, 0.75);
    // a column rule from the drawing ending on the free end (T-junction), not reaching the bottom border
    assert.deepEqual(cands([chain, vl(780, 1000, 1768)]), []);
    // a cell divider from the free end down to the border (Dublin)
    assert.equal(cands([chain, vl(780, 1768, BY1)]).length, 1);
    // both: one of the rules at the free end reaches the border → kept
    assert.equal(cands([chain, vl(780, 1000, 1768), vl(780, 1768, BY1)]).length, 1);
    // a rule crossing the free end and running on to the border → kept
    assert.equal(cands([chain, vl(780, 1000, BY1)]).length, 1);
  });

  test("candidates per edge are ordered by d, smallest first", () => {
    const cs = cands([hl(BX0, BX1, yB(0.2)), hl(BX0, BX1, yB(0.12))]);
    assert.deepEqual(cs.map((c) => c.edge), ["bottom", "bottom"]);
    assertClose(cs[0].d, 0.12); assertClose(cs[1].d, 0.2);
  });

  test("depth bounds 6–30% from the border", () => {
    for (const [d, n] of [[0.059, 0], [0.061, 1], [0.299, 1], [0.301, 0]] as const) {
      assert.equal(cands([hl(BX0, BX1, yB(d))]).length, n, `d ${d}`);
    }
  });

  test("cover ≥ 70% of the border length", () => {
    assert.equal(cands([hl(xU(0.31), BX1, 1768)]).length, 0);   // 0.69
    assert.equal(cands([hl(xU(0.29), BX1, 1768)]).length, 1);   // 0.71
  });

  test("touches the border when an end is within 1% of it", () => {
    assert.equal(cands([hl(xU(0.02), xU(0.95), 1768)]).length, 0, "free at both ends");
    const cs = cands([hl(xU(0.009), xU(0.8), 1768)]);
    assert.equal(cs.length, 1);
    assert.equal(cs[0].touch, "near");
    assertClose(cs[0].extent[0], 0.009); assertClose(cs[0].extent[1], 0.8);
  });

  test("a missing border side: the chain touches the page edge", () => {
    // no left rule: the border's left side is x = 0; the border box is 2940 wide
    const border = { box: [0, BY0, BX1, BY1] as [number, number, number, number], ruled: ruled(true, true, true, false) };
    const lines = [hl(60, BX1, BY0), hl(60, BX1, BY1), vl(BX1, BY0, BY1)];
    const toPage = findCandidates(mk([...lines, hl(0, BX1, 1768)]), border);
    assert.equal(toPage.length, 1);
    assert.equal(toPage[0].touch, "both");
    // ending where a left rule would have been (x 60 = 2.04% of 2940) is not touching on that side
    const short = findCandidates(mk([...lines, hl(60, BX1, 1768)]), border);
    assert.equal(short.length, 1);
    assert.equal(short[0].touch, "far");
  });

  test("Porterville: a right chain ending on 83% top/bottom border rules", () => {
    // chain at d 0.15 from the right border: x = 2940 − 0.15 × 2880 = 2508
    const sheet = mk([hl(60, 2508, BY0), hl(60, 2508, BY1), vl(BX0, BY0, BY1), vl(BX1, BY0, BY1), vl(2508, BY0, BY1)]);
    const border = findBorder(sheet);
    assertBox(border.box, BOX);
    const cs = findCandidates(sheet, border);
    assert.equal(cs.length, 1);
    assert.equal(cs[0].edge, "right");
    assertClose(cs[0].d, 0.15);
    assert.equal(cs[0].touch, "both");
  });

  test("each edge maps u along the edge (far end = bottom / right) and v from its border side", () => {
    // right chain at d 0.2 from y 40 to 75% down: near-anchored (top), free end at u 0.75
    const right = cands([vl(BX1 - 0.2 * BW, BY0, BY0 + 0.75 * BH)]);
    assert.equal(right.length, 1);
    assert.equal(right[0].edge, "right"); assert.equal(right[0].touch, "near");
    assertClose(right[0].d, 0.2); assertClose(right[0].extent[1], 0.75);
    const left = cands([vl(BX0 + 0.1 * BW, BY0 + 0.25 * BH, BY1)]);
    assert.equal(left[0].edge, "left"); assert.equal(left[0].touch, "far");
    assertClose(left[0].d, 0.1); assertClose(left[0].extent[0], 0.25);
    const top = cands([hl(BX0, xU(0.8), BY0 + 0.15 * BH)]);
    assert.equal(top[0].edge, "top"); assert.equal(top[0].touch, "near");
    assertClose(top[0].d, 0.15); assertClose(top[0].extent[1], 0.8);
  });

  test("the free end's distance to the nearest other chain is logged", () => {
    // free end at (u 0.25, v 0.1); a vertical grid rule at u 0.275 through the drawing
    const cs = cands([hl(xU(0.25), BX1, 1768), vl(xU(0.275), BY0 + 0.3 * BH, BY1 - 0.05 * BH)]);
    assert.equal(cs.length, 1);
    assertClose(cs[0].freeEndGap!, 0.025, "gap", 1e-9);
  });
});

// ── step 4: signals and acceptance ──────────────────────────────────────────
/** Strip coordinates (u along the edge toward the far end, v depth from the
 * border, fractions of the border box) → image px, for the page above. */
function px(edge: Edge, u: number, v: number): [number, number] {
  switch (edge) {
    case "right": return [BX1 - v * BW, BY0 + u * BH];
    case "left": return [BX0 + v * BW, BY0 + u * BH];
    case "bottom": return [BX0 + u * BW, BY1 - v * BH];
    case "top": return [BX0 + u * BW, BY0 + v * BH];
  }
}
/** A rot-0 token centred on (cx, cy): baseline start (cx − w/2, cy + h/2). */
const tokC = (str: string, cx: number, cy: number, h = 10): DetectToken => {
  const w = 0.6 * h * str.length;
  return { str, x: cx - w / 2, y: cy + h / 2, w, h, rot: 0 };
};
const tokUV = (str: string, edge: Edge, u: number, v: number, h = 10) => tokC(str, ...px(edge, u, v), h);
/** n filler tokens in a strip, spread along u in [u0, u1] at 75% of the depth. */
const fill = (edge: Edge, d: number, n: number, u0 = 0, u1 = 1) =>
  Array.from({ length: n }, (_, k) => tokUV("NOTE", edge, u0 + ((k + 0.5) / n) * (u1 - u0), 0.75 * d));
/** A chain parallel to `edge` at depth d over [u0, u1]. */
function chainAt(edge: Edge, d: number, u0 = 0, u1 = 1): DetectLine {
  const [xa, ya] = px(edge, u0, d), [xb, yb] = px(edge, u1, d);
  return edge === "top" || edge === "bottom" ? hl(xa, xb, ya) : vl(xa, ya, yb);
}
/** 18 drawing tokens in the middle of the sheet (x 900–2100, y 700–1300). */
const DRAWING = Array.from({ length: 18 }, (_, k) => tokC("OFFICE", 900 + (k % 6) * 240, 700 + Math.floor(k / 6) * 300));
const detect = (lines: DetectLine[], tokens: DetectToken[], opts?: DetectOptions) =>
  detectTitleBlock(mk([...BORDER_RULES, ...lines], tokens), opts);
/** The standard sheet: bottom chain at d 0.1 (y 1768), 20 fillers, sheet number
 * A-101 (h 40) at u 0.9, v 0.03 (30% of the depth): (2652, 1902.4). */
const STD_LINES = [hl(BX0, BX1, 1768)];
const NUMBER = tokC("A-101", 2652, 1902.4, 40);
const STD_TOKENS = [...fill("bottom", 0.1, 20), NUMBER, ...DRAWING];
const cand = (r: ReturnType<typeof detectTitleBlock>, edge: Edge, d?: number) =>
  r.diag.candidates.find((c) => c.edge === edge && (d === undefined || close(c.d, d, 1e-6)))!;

describe("farEnd (step 4 table)", () => {
  test("far end along the edge and outer part of the depth, per edge", () => {
    assert.deepEqual(farEnd("right"), { along: "y", far: "bottom", outer: "right" });
    assert.deepEqual(farEnd("bottom"), { along: "x", far: "right", outer: "bottom" });
    assert.deepEqual(farEnd("left"), { along: "y", far: "bottom", outer: "left" });
    assert.deepEqual(farEnd("top"), { along: "x", far: "right", outer: "top" });
  });
  test("stripUV agrees: the far, outer corner of each strip is u = 1, v = 0", () => {
    const corner: Record<Edge, [number, number]> = { right: [BX1, BY1], bottom: [BX1, BY1], left: [BX0, BY1], top: [BX1, BY0] };
    for (const e of ["top", "right", "bottom", "left"] as const) {
      const [u, v] = stripUV(e, BOX, ...corner[e]);
      assertClose(u, 1, `${e} u`); assertClose(v, 0, `${e} v`);
    }
  });
});

describe("sheetno signal", () => {
  // the output strip is border to border along its edge at depth d = 0.1
  const STRIP: Record<Edge, number[]> = {
    right: [2652, 40, 2940, 1960], left: [60, 40, 348, 1960], bottom: [60, 1768, 2940, 1960], top: [60, 40, 2940, 232],
  };
  for (const e of ["top", "right", "bottom", "left"] as const) {
    test(`${e}: number in the far-end half and outer 60% → rule A; in the near half → no sheetno`, () => {
      const r = detect([chainAt(e, 0.1)], [...fill(e, 0.1, 20), tokUV("A-101", e, 0.9, 0.03, 40), ...DRAWING]);
      assert.equal(r.decision.edge, e);
      assertClose(r.decision.d!, 0.1, "d", 1e-9);
      assertBox(r.decision.strip!, STRIP[e]);
      const c = cand(r, e);
      assert.equal(c.sheetno, true);
      assertClose(c.sheetnoPos![0], 0.9, "along", 1e-9); assertClose(c.sheetnoPos![1], 0.3, "across", 1e-9);
      const near = detect([chainAt(e, 0.1)], [...fill(e, 0.1, 20), tokUV("A-101", e, 0.1, 0.03, 40), ...DRAWING]);
      assert.equal(near.decision.edge, null);
      assert.equal(cand(near, e).sheetno, false);
      assertClose(cand(near, e).sheetnoPos![0], 0.1, "along", 1e-9);
    });
  }

  test("outer 60% of the depth: 55% passes, 65% fails, an S501-style tag at 92% fails", () => {
    for (const [f, ok] of [[0.55, true], [0.65, false], [0.92, false]] as const) {
      // bottom d 0.1: v = f × 0.1 → y = 1960 − f × 192
      const r = detect(STD_LINES, [...fill("bottom", 0.1, 20), tokC("B10", 2652, 1960 - f * 192, 40), ...DRAWING]);
      assert.equal(cand(r, "bottom").sheetno, ok, `depth ${f}`);
      assertClose(cand(r, "bottom").sheetnoPos![1], f, "across", 1e-9);
    }
  });

  test("the largest pattern token is the one judged", () => {
    const big = tokC("B10", 636, 1902.4, 60);   // u 0.2: near half
    const tokens = [...fill("bottom", 0.1, 20), big, NUMBER, tokC("SHEET", 2400, 1902.4, 90), ...DRAWING];
    const r = detect(STD_LINES, tokens);
    const c = cand(r, "bottom");
    assert.equal(c.sheetnoIdx, tokens.indexOf(big));
    assert.equal(c.sheetno, false);
    const small = tokC("B10", 636, 1902.4, 30);
    const tokens2 = [...fill("bottom", 0.1, 20), small, NUMBER, ...DRAWING];
    const c2 = cand(detect(STD_LINES, tokens2), "bottom");
    assert.equal(c2.sheetnoIdx, tokens2.indexOf(NUMBER));
    assert.equal(c2.sheetno, true);
  });

  test("a vertical (rot 270) number is judged by its rotated box's center", () => {
    // right strip d 0.1; center at u 0.49 (y 980.8), v 0.05 (x 2796); h 40, w = 0.6 × 40 × 6 = 144.
    // rot 270 runs up the page: baseline start (cx + h/2, cy + w/2). Read as rot 0, its
    // center would be (2888, 1032.8): u 0.517, in the far half.
    const t: DetectToken = { str: "A1-101", x: 2816, y: 1052.8, w: 144, h: 40, rot: 270 };
    const c = cand(detect([chainAt("right", 0.1)], [...fill("right", 0.1, 20), t, ...DRAWING]), "right");
    assertClose(c.sheetnoPos![0], 0.49, "along", 1e-9); assertClose(c.sheetnoPos![1], 0.5, "across", 1e-9);
    assert.equal(c.sheetno, false);
  });

  test("extent-bounded strip: a right legend column stopping short of the bottom title block has no sheetno", () => {
    // right column at d 0.1 (x 2652) from the top border to u 0.848 (y 1668.16), closed back to the
    // right border; the sheet number at (2652, 1902.4) is at u 0.97 on the right edge: outside the extent
    const yEnd = BY0 + 0.848 * BH;
    const legend = Array.from({ length: 20 }, (_, k) => tokC("GENERAL NOTE", 2796, 100 + k * 70));
    const r = detect([...STD_LINES, vl(2652, BY0, yEnd), hl(2652, BX1, yEnd)], [...STD_TOKENS, ...legend]);
    const right = cand(r, "right");
    assertClose(right.extent[1], 0.848, "extent", 1e-9);
    assert.equal(right.sheetno, false);
    assert.equal(right.sheetnoIdx, null);
    assert.equal(right.reason, "one-signal:frame");
    assert.equal(r.decision.edge, "bottom");
  });

  test("a split sheet number (\"E\" \"-\" \"001\") is joined and judged as one run", () => {
    // h 40 → join when baselines within 10 px and gaps ≤ 20 px; no space at gap ≤ 6 px.
    // "E" w 24 at x 2600, "-" w 24 at 2626 (gap 2), "001" w 72 at 2652 (gap 2): run x 2600–2724,
    // y 1882.4–1922.4 → center (2662, 1902.4): u (2662 − 60)/2880 = 0.9035, v 0.03 / 0.1 = 0.3
    const parts = [
      { str: "E", x: 2600, y: 1922.4, w: 24, h: 40, rot: 0 },
      { str: "-", x: 2626, y: 1922.4, w: 24, h: 40, rot: 0 },
      { str: "001", x: 2652, y: 1922.4, w: 72, h: 40, rot: 0 },
    ];
    const tokens = [...fill("bottom", 0.1, 20), ...parts, ...DRAWING];
    const c = cand(detect(STD_LINES, tokens), "bottom");
    assert.equal(c.sheetno, true);
    assert.equal(c.sheetnoText, "E-001");
    assert.equal(c.sheetnoIdx, tokens.indexOf(parts[0]));
    assertClose(c.sheetnoPos![0], (2662 - 60) / 2880, "along", 1e-9);
    assertClose(c.sheetnoPos![1], 0.3, "across", 1e-9);
  });

  test("a joined run larger than a single pattern token wins the largest-token rule", () => {
    // single "B10" h 30 in the near half; split "A1" "-101" h 50 in the far half ("A1" alone also
    // fits the pattern at the same h: a run beats its own parts on a tie)
    const small = tokC("B10", 636, 1902.4, 30);
    const a = { str: "A1", x: 2600, y: 1927.4, w: 60, h: 50, rot: 0 };
    const b = { str: "-101", x: 2663, y: 1927.4, w: 120, h: 50, rot: 0 };   // gap 3 ≤ 7.5: no space
    const tokens = [...fill("bottom", 0.1, 20), small, a, b, ...DRAWING];
    const c = cand(detect(STD_LINES, tokens), "bottom");
    assert.equal(c.sheetnoText, "A1-101");
    assert.equal(c.sheetnoIdx, tokens.indexOf(a));
    assert.equal(c.sheetno, true);
  });
  for (const [w, n] of [["REV", "1"], ["NO", "1"], ["SHT", "2"]] as const) {
    test(`a joined label "${w}" "${n}" does not beat a real sheet number of the same height`, () => {
      // label run in the far-end corner, gap 8 px (h 40: spaced join "${w} ${n}" fits the pattern),
      // listed BEFORE the real number; the real A-101 (h 40) must still be judged
      const lw = 0.6 * 40 * w.length;
      const label = [{ str: w, x: 2500, y: 1950, w: lw, h: 40, rot: 0 }, { str: n, x: 2500 + lw + 8, y: 1950, w: 24, h: 40, rot: 0 }];
      const tokens = [...fill("bottom", 0.1, 20), ...label, NUMBER, ...DRAWING];
      const c = cand(detect(STD_LINES, tokens), "bottom");
      assert.equal(c.sheetnoText, "A-101");
      assert.equal(c.sheetnoIdx, tokens.indexOf(NUMBER));
      // and a smaller label run never wins either
      const small = [{ str: w, x: 2500, y: 1950, w: lw / 2, h: 20, rot: 0 }, { str: n, x: 2500 + lw / 2 + 4, y: 1950, w: 12, h: 20, rot: 0 }];
      const c2 = cand(detect(STD_LINES, [...fill("bottom", 0.1, 20), ...small, NUMBER, ...DRAWING]), "bottom");
      assert.equal(c2.sheetnoText, "A-101");
    });
  }

  test("a split detail tag \"B\" \"10\" in the drawing creates no sheetno", () => {
    // no sheet number in the strip; the tag sits in the drawing (y 1000), outside every strip
    const tag = [{ str: "B", x: 1500, y: 1000, w: 24, h: 40, rot: 0 }, { str: "10", x: 1526, y: 1000, w: 48, h: 40, rot: 0 }];
    const c = cand(detect(STD_LINES, [...fill("bottom", 0.1, 20), ...tag, ...DRAWING]), "bottom");
    assert.equal(c.sheetno, false);
    assert.equal(c.sheetnoIdx, null);
    assert.equal(c.sheetnoText, null);
    // next to the inner rule (92% of the depth), the joined tag is judged but fails the outer-60% test
    const deep = [{ str: "B", x: 2600, y: 1803.4, w: 24, h: 40, rot: 0 }, { str: "10", x: 2626, y: 1803.4, w: 48, h: 40, rot: 0 }];
    const d = cand(detect(STD_LINES, [...fill("bottom", 0.1, 20), ...deep, ...DRAWING]), "bottom");
    assert.equal(d.sheetnoText, "B10");
    assert.equal(d.sheetno, false);
  });

  test("density: strip tokens per strip area ÷ rest-of-border-box tokens per rest area", () => {
    // 21 tokens in area 0.1, 18 in 0.9 → (21 / 0.1) / (18 / 0.9) = 10.5
    const c = cand(detect(STD_LINES, STD_TOKENS), "bottom");
    assert.equal(c.tokens, 21);
    assertClose(c.density, 10.5, "density", 1e-9);
    assertClose(c.area, 0.1, "area", 1e-9);
    assertClose(c.chainCover, 1);
  });
});

describe("acceptance (step 4)", () => {
  const repeatAll = { repeat: () => true };

  test("rule A: frame + sheetno", () => {
    const r = detect(STD_LINES, STD_TOKENS);
    assert.deepEqual(r.decision, {
      edge: "bottom", d: 0.1, strip: [60, 1768, 2940, 1960], border: BOX, rules: ["A"], confidence: 0.7,
      evidence: ["rule:A", "frame-line", "sheet-number", "text-density"],
    });
    assert.equal(r.diag.edge, "bottom");
    assert.equal(r.diag.d, 0.1);
    assert.deepEqual(r.diag.border, BOX);
    const c = cand(r, "bottom");
    assert.equal(c.accepted, true);
    assert.equal(c.reason, "chosen");
    assert.deepEqual([r.diag.staticIdx, r.diag.fieldIdx], [[], []]);
  });

  test("rule B: frame + repeat (no sheet number)", () => {
    const r = detect(STD_LINES, [...fill("bottom", 0.1, 20), ...DRAWING], repeatAll);
    assert.deepEqual(r.decision.rules, ["B"]);
    assert.equal(r.decision.confidence, 0.7);
    assert.deepEqual(r.decision.evidence, ["rule:B", "frame-line", "repetition", "text-density"]);
  });

  test("rule C: repeat + sheetno, no frame (a repetition-only strip)", () => {
    const r = detect([], STD_TOKENS, { repeatStrips: [{ edge: "bottom", d: 0.1, extent: [0, 1] }] });
    assert.equal(r.decision.edge, "bottom");
    assert.deepEqual(r.decision.strip, [60, 1768, 2940, 1960]);
    assert.deepEqual(r.decision.rules, ["C"]);
    assert.deepEqual(r.decision.evidence, ["rule:C", "sheet-number", "repetition", "text-density"]);
    const c = cand(r, "bottom");
    assert.equal(c.frame, false);
    assert.equal(c.touch, null);
  });

  test("a repetition-only strip joins its edge's candidates, smallest d first (amended in task 6a)", () => {
    // chain d 0.1 (rule A) is tried before the frameless strip at d 0.2, which is not tried
    const r = detect(STD_LINES, STD_TOKENS, { repeatStrips: [{ edge: "bottom", d: 0.2, extent: [0, 1] }] });
    assert.deepEqual(r.diag.candidates.filter((c) => c.edge === "bottom").map((c) => c.frame), [true, false]);
    assert.equal(r.decision.d, 0.1);
    assert.equal(cand(r, "bottom", 0.2).reason, "not-tried");
  });

  test("a frameless strip under a false chain deeper on the same edge is tried first (a 26% rule)", () => {
    const r = detect([hl(BX0, BX1, yB(0.26))], STD_TOKENS, { frames: () => false, repeatStrips: [{ edge: "bottom", d: 0.1, extent: [0, 1] }] });
    assertClose(r.decision.d!, 0.1);
    assert.deepEqual(r.decision.rules, ["C"]);
    assert.equal(cand(r, "bottom", 0.26).reason, "not-tried");
  });

  test("a chain framing the band drops the edge's frameless strip", () => {
    const strips = [{ edge: "bottom" as Edge, d: 0.09, extent: [0, 1] as [number, number] }];
    const r = detect(STD_LINES, STD_TOKENS, { repeat: () => true, frames: (e, d) => e === "bottom" && d === 0.1, repeatStrips: strips });
    assert.deepEqual(r.diag.candidates.map((c) => c.frame), [true]);
    assertClose(r.decision.d!, 0.1);
    assert.deepEqual(r.decision.rules, ["A", "B", "C"]);
    // no framing chain: the frameless strip is kept and tried first
    const far = detect(STD_LINES, STD_TOKENS, { frames: () => false, repeatStrips: strips });
    assert.deepEqual(far.diag.candidates.map((c) => c.frame), [false, true]);
    assertClose(far.decision.d!, 0.09);
  });

  test("all three signals → rules A, B, C, confidence 0.95", () => {
    const r = detect(STD_LINES, STD_TOKENS, repeatAll);
    assert.deepEqual(r.decision.rules, ["A", "B", "C"]);
    assert.equal(r.decision.confidence, 0.95);
    assert.deepEqual(r.decision.evidence, ["rule:A", "rule:B", "rule:C", "frame-line", "sheet-number", "repetition", "text-density"]);
  });

  test("confidence tiers are rule labels: 3 → 0.95, 2 → 0.85, 1 → 0.7, none → 0.3", () => {
    assert.deepEqual([3, 2, 1, 0].map(confidenceFor), [0.95, 0.85, 0.7, 0.3]);
  });

  test("each single signal alone rejects", () => {
    const frameOnly = detect(STD_LINES, [...fill("bottom", 0.1, 20), ...DRAWING]);
    assert.equal(frameOnly.decision.edge, null);
    assert.equal(cand(frameOnly, "bottom").reason, "one-signal:frame");
    const numberOnly = detect([], STD_TOKENS);
    assert.equal(numberOnly.decision.edge, null);
    assert.equal(numberOnly.diag.candidates.length, 0);
    const repeatOnly = detect([], [...fill("bottom", 0.1, 20), ...DRAWING], { repeatStrips: [{ edge: "bottom", d: 0.1, extent: [0, 1] }] });
    assert.equal(repeatOnly.decision.edge, null);
    assert.equal(cand(repeatOnly, "bottom").reason, "one-signal:repeat");
  });

  test("density alone never accepts: a framed strip holding every token on the sheet", () => {
    const r = detect(STD_LINES, fill("bottom", 0.1, 120));
    const c = cand(r, "bottom");
    assert.equal(c.density, Infinity);
    assert.equal(r.decision.edge, null);
  });

  test("abstain: no title block, confidence 0.3, the border box kept", () => {
    const r = detect([], DRAWING);
    assert.deepEqual(r.decision, { edge: null, d: null, strip: null, border: BOX, rules: [], confidence: 0.3, evidence: [] });
    assert.equal(r.diag.edge, null);
  });

  test(`fewer than ${MIN_STRIP_TOKENS} strip tokens rejects`, () => {
    const r14 = detect(STD_LINES, [...fill("bottom", 0.1, 13), NUMBER, ...DRAWING]);
    assert.equal(r14.decision.edge, null);
    assert.equal(cand(r14, "bottom").tokens, 14);
    assert.equal(cand(r14, "bottom").reason, "few-tokens");
    assert.equal(detect(STD_LINES, [...fill("bottom", 0.1, 14), NUMBER, ...DRAWING]).decision.edge, "bottom");
  });

  test("the token floor counts the full strip; sheetno and density stay extent-bounded", () => {
    // partial chain x 924 … 2940 (extent [0.3, 1], cover 0.7) with a divider down to the border:
    // 9 fillers + the number inside the extent (10 < 15), 6 fillers at u 0.02–0.28 outside
    // it → 16 across the full strip
    const inside = fill("bottom", 0.1, 9, 0.3, 1), outside = fill("bottom", 0.1, 6, 0.02, 0.28);
    const r = detect([hl(924, BX1, 1768), vl(924, 1768, BY1)], [...inside, ...outside, NUMBER, ...DRAWING]);
    const c = cand(r, "bottom");
    assert.equal(c.tokens, 10);
    assert.equal(c.stripTokens, 16);
    assert.equal(c.sheetno, true);
    // density over the extent-bounded strip: 10 / 0.07 ÷ (6 + 18) / 0.93
    assertClose(c.density, (10 / 0.07) / (24 / 0.93), "density", 1e-9);
    assert.equal(r.decision.edge, "bottom");
    assert.deepEqual(r.decision.rules, ["A"]);
    // the sparse strip: 8 fillers + the number = 9 across the whole strip → rejected
    const sparse = detect(STD_LINES, [...fill("bottom", 0.1, 8), NUMBER, ...DRAWING]);
    assert.equal(cand(sparse, "bottom").stripTokens, 9);
    assert.equal(cand(sparse, "bottom").reason, "few-tokens");
    assert.equal(sparse.decision.edge, null);
  });

  test("per edge the smallest d is tried first; a deeper passing candidate is not tried", () => {
    // number at v 0.03: across 0.3 of d 0.1, 0.15 of d 0.2
    const r = detect([...STD_LINES, hl(BX0, BX1, yB(0.2))], STD_TOKENS);
    assertClose(r.decision.d!, 0.1);
    const deep = cand(r, "bottom", 0.2);
    assert.equal(deep.accepted, false);
    assert.equal(deep.reason, "not-tried");
  });

  test("per edge, a narrower candidate that fails gives way to the next one out", () => {
    // chains at d 0.08 and 0.15; the number at v 0.085 lies outside the 0.08 strip, at 57% of 0.15
    const tokens = [...fill("bottom", 0.08, 20), tokC("A-101", 2652, BY1 - 0.085 * BH, 40), ...DRAWING];
    const r = detect([hl(BX0, BX1, yB(0.08)), hl(BX0, BX1, yB(0.15))], tokens);
    assertClose(r.decision.d!, 0.15);
    assert.equal(cand(r, "bottom", 0.08).reason, "one-signal:frame");
  });

  // a full-height rule at u 0.84 of the width (x 2479.2) crossing a bottom title block:
  // right strip d 0.16, area 0.16; bottom strip area 0.1. The number at (2800, 1902.4) is
  // at u 0.951 / across 0.3 of the bottom strip and u 0.97 / across 0.304 of the right one.
  const CROSS = [...STD_LINES, vl(2479.2, BY0, BY1)];
  const CROSS_TOKENS = [
    ...fill("bottom", 0.1, 20), tokC("A-101", 2800, 1902.4, 40), ...DRAWING,
    ...Array.from({ length: 20 }, (_, k) => tokC("NOTE", 2700, 100 + k * 80)),
  ];

  test("between edges: equal rules → the smaller strip area wins", () => {
    const r = detect(CROSS, CROSS_TOKENS);
    assert.equal(r.decision.edge, "bottom");
    const right = cand(r, "right");
    assert.equal(right.accepted, true);
    assert.equal(right.sheetno, true);
    assertClose(right.area, 0.16, "area", 1e-9);
    assert.equal(right.reason, "lost:area");
  });

  test("between edges: more rules win before area", () => {
    const r = detect(CROSS, CROSS_TOKENS, { repeat: (c) => c.edge === "right" });
    assert.equal(r.decision.edge, "right");
    assert.deepEqual(r.decision.rules, ["A", "B", "C"]);
    assert.equal(cand(r, "bottom").reason, "lost:rules");
  });

  test("between edges: equal rules and area → the higher density wins", () => {
    // top and bottom chains both at d 0.1 (y 232 / 1768), both with a number in their zone
    const top = [...fill("top", 0.1, 30), tokUV("A-101", "top", 0.9, 0.03, 40)];
    const r = detect([...STD_LINES, chainAt("top", 0.1)], [...STD_TOKENS, ...top]);
    assert.equal(r.decision.edge, "top");
    assert.equal(cand(r, "bottom").reason, "lost:density");
    assert.ok(cand(r, "top").density > cand(r, "bottom").density);
  });

  test("a partial chain's strip is output border to border along its edge", () => {
    const r = detect([hl(xU(0.25), BX1, 1768)], STD_TOKENS);
    assert.deepEqual(r.decision.strip, [60, 1768, 2940, 1960]);
    const c = cand(r, "bottom");
    assertClose(c.extent[0], 0.25); assertClose(c.chainCover, 0.75); assertClose(c.area, 0.075, "area", 1e-9);
  });

  test("diag logs the free end's distance to the nearest other chain", () => {
    const r = detect([hl(xU(0.25), BX1, 1768), vl(xU(0.275), BY0 + 0.3 * BH, BY1 - 0.05 * BH)], STD_TOKENS);
    assertClose(cand(r, "bottom").freeEndGap!, 0.025, "gap", 1e-9);
  });
});

describe("steps 2 and 4: edge cases", () => {
  test("tokenCenter: a missing w is estimated as 0.6 × h per character", () => {
    // "ABCD", h 10 → w 24: rot 0 center (100 + 12, 200 − 5); rot 90 center (100 + 5, 200 + 12)
    assert.deepEqual(tokenCenter({ str: "ABCD", x: 100, y: 200, h: 10 }), [112, 195]);
    assert.deepEqual(tokenCenter({ str: "ABCD", x: 100, y: 200, h: 10, rot: 90 }), [105, 212]);
    assert.deepEqual(tokenCenter({ str: "ABCD", x: 100, y: 200, w: 50, h: 10 }), [125, 195]);
  });

  test("free end: a rule on the border side of the chain is a junction only when it ends within 1% of the chain", () => {
    // bottom chain at d 0.1 with its free end at u 0.25 (x 780); a stub from v 0.03 (y 1902.4)
    // toward the chain, not reaching the border: ending at v 0.091 (y 1785.28, 0.9% short) it
    // meets the free end → T-junction, rejected; ending at v 0.089 (y 1789.12, 1.1% short) it
    // does not → a plain free end, kept
    const chain = hl(xU(0.25), BX1, 1768);
    assert.deepEqual(cands([chain, vl(780, 1785.28, 1902.4)]), []);
    assert.equal(cands([chain, vl(780, 1789.12, 1902.4)]).length, 1);
  });

  test("a vertical rot 90 sheet number (left strip) is judged by its rotated box's center", () => {
    // left strip d 0.1; center at u 0.52 (y 1038.4), v 0.03 (x 146.4); "A1-101", h 40, w 144.
    // rot 90 runs down the page: baseline start (cx − h/2, cy − w/2). Read as rot 0, its center
    // would be (198.4, 946.4): u 0.472, in the near half.
    const t: DetectToken = { str: "A1-101", x: 126.4, y: 966.4, w: 144, h: 40, rot: 90 };
    const r = detect([chainAt("left", 0.1)], [...fill("left", 0.1, 20), t, ...DRAWING]);
    const c = cand(r, "left");
    assertClose(c.sheetnoPos![0], 0.52, "along", 1e-9); assertClose(c.sheetnoPos![1], 0.3, "across", 1e-9);
    assert.equal(c.sheetno, true);
    assert.equal(r.decision.edge, "left");
  });

  // top and bottom chains both at d 0.1 with mirrored contents: equal rules, area and density
  const MIRROR = [...STD_TOKENS, ...fill("top", 0.1, 20), tokUV("A-101", "top", 0.9, 0.03, 40)];

  test("between edges: equal rules, area and density → the EDGES order decides (top before bottom)", () => {
    const r = detect([...STD_LINES, chainAt("top", 0.1)], MIRROR);
    assert.equal(cand(r, "top").area, cand(r, "bottom").area);
    assert.equal(cand(r, "top").density, cand(r, "bottom").density);
    assert.equal(r.decision.edge, "top");
    assert.equal(cand(r, "bottom").reason, "lost:order");
  });

  test("between edges: areas within 1e-9 are equal (floating-point noise does not decide)", () => {
    // the top chain 1e-10 px deeper: its area is larger by ~5e-14, which does not decide; the
    // comparison goes on to density (lower on top by the same noise — density has no epsilon)
    const r = detect([...STD_LINES, hl(BX0, BX1, 232 + 1e-10)], MIRROR);
    assert.ok(cand(r, "top").area > cand(r, "bottom").area);
    assert.equal(cand(r, "top").reason, "lost:density");
  });

  test("a repetition-only strip of zero length is ignored (no NaN)", () => {
    for (const extent of [[0.5, 0.5], [0.6, 0.4]] as [number, number][]) {
      const r = detect([], STD_TOKENS, { repeatStrips: [{ edge: "bottom", d: 0.1, extent }] });
      assert.deepEqual(r.diag.candidates, []);
      assert.equal(r.decision.edge, null);
    }
    for (const d of [0, NaN]) {
      const r = detect([], STD_TOKENS, { repeatStrips: [{ edge: "bottom", d, extent: [0, 1] }] });
      assert.deepEqual(r.diag.candidates, []);
    }
  });
});

// ── step 3: repetition across the set ───────────────────────────────────────
/** Reference for classifyRepetition: the plain O(n² · T) definition (every
 * token against every sheet), kept to check the indexed implementation. */
function classifyRepetitionRef(sheets: readonly RepeatInput[]): TokenClasses[] {
  const n = sheets.length;
  const out: TokenClasses[] = sheets.map(() => ({ staticIdx: [], fieldIdx: [] }));
  const half = Math.ceil(REPEAT_MIN_SHARE * n - 1e-9);
  const needStatic = Math.max(STATIC_MIN_SHEETS, half), needField = Math.max(FIELD_MIN_SHEETS, half);
  if (n < needStatic) return out;
  const T = REPEAT_POS_TOL + 1e-9;
  const pts = sheets.map(({ tokens, box }) => tokens.map((t) => {
    const [x, y] = tokenCenter(t);
    return { x: (x - box[0]) / (box[2] - box[0]), y: (y - box[1]) / (box[3] - box[1]), text: normText(t.str) };
  }));
  const ok = (p: { x: number; y: number; text: string }) => !!p.text && Number.isFinite(p.x) && Number.isFinite(p.y);
  pts.forEach((ps, s) => ps.forEach((p, i) => {
    if (!ok(p)) return;
    let same = 0, occupied = 0, changed = 0;
    for (let o = 0; o < n; o++) {
      const hit = pts[o].filter((q) => ok(q) && Math.abs(q.x - p.x) <= T && Math.abs(q.y - p.y) <= T);
      if (!hit.length) continue;
      occupied++;
      if (hit.some((q) => q.text === p.text)) same++;
      else if (o !== s) changed++;
    }
    if (same >= needStatic) out[s].staticIdx.push(i);
    else if (occupied >= needField && changed >= half) out[s].fieldIdx.push(i);
  }));
  return out;
}

describe("classifyRepetition: the indexed implementation equals the reference", () => {
  const inputs = (set: Synth.SynthSet) => set.sheets.map((x) => ({ tokens: x.sheet.tokens, box: findBorder(x.sheet).box }));
  const sets = [Synth.uniformSet24(), Synth.mixedSet(), Synth.smallConsultantsSet(), Synth.borderlessSet(), Synth.repeatOnlySet(),
    ...[1, 3, 5, 11, 18, 19, 4242].map((k) => Synth.randomSet(k))];
  for (const set of sets) {
    test(set.name, () => {
      const all = inputs(set);
      for (const sub of [all, all.slice(0, 2), all.slice(0, 3), all.slice(1, 6)]) {
        assert.deepEqual(classifyRepetition(sub), classifyRepetitionRef(sub));
      }
    });
  }
});

describe("classifyRepetition: scaling", () => {
  // uniformSet24's sheets cloned under new keys (exact copies: every title-block token repeats on
  // every sheet), and jittered copies (every token moved by up to ±1 px, so no two queries match)
  const base = Synth.uniformSet24().sheets.map((x) => x.sheet);
  const clones = (n: number, jitter = 0) => {
    const rng = Synth.mulberry32(7);
    return Array.from({ length: n }, (_, i) => {
      const b = base[i % base.length];
      const tokens = jitter ? b.tokens.map((t) => ({ ...t, x: t.x + (rng() - 0.5) * 2 * jitter, y: t.y + (rng() - 0.5) * 2 * jitter })) : b.tokens;
      return { ...b, key: `c${String(i).padStart(4, "0")}.pdf`, tokens };
    });
  };
  const inputsOf = (sh: DetectSheet[]) => sh.map((x) => ({ tokens: x.tokens, box: findBorder(x).box }));
  const best = (f: () => void) => Math.min(...[0, 1, 2].map(() => { const t = performance.now(); f(); return performance.now() - t; }));

  test("100 → 200 cloned sheets costs < 3× (or under 200 ms)", () => {
    const i100 = inputsOf(clones(100)), i200 = inputsOf(clones(200));
    classifyRepetition(i100);   // warm-up
    const t100 = best(() => classifyRepetition(i100)), t200 = best(() => classifyRepetition(i200));
    assert.ok(t200 < 3 * t100 || t200 < 200, `100 sheets ${t100.toFixed(0)} ms, 200 sheets ${t200.toFixed(0)} ms`);
  });

  test("detectSetRegions: 200 cloned sheets < 3 s, 200 jittered sheets < 6 s (was 27 s)", () => {
    for (const [sheets, limit] of [[clones(200), 3000], [clones(200, 1), 6000]] as const) {
      const t = performance.now();
      const { regions } = detectSetRegions(sheets);
      const ms = performance.now() - t;
      assert.equal(regions.size, 200);
      assert.ok(ms < limit, `${ms.toFixed(0)} ms (limit ${limit})`);
    }
  });

  test("jittered clones classify like the reference", () => {
    const sub = inputsOf(clones(30, 1));
    assert.deepEqual(classifyRepetition(sub), classifyRepetitionRef(sub));
  });
});

describe("step 3: statics and fields (classifyRepetition)", () => {
  // page 1000 × 1000 with the border box at the page edge: normalized = px / 1000
  const B1: [number, number, number, number] = [0, 0, 1000, 1000];
  const on = (...toks: DetectToken[]) => ({ tokens: toks, box: B1 });
  const FIRM = "ACME ARCHITECTS";

  test("static: the same text at the same normalized center on every one of 3 sheets", () => {
    const out = classifyRepetition([0, 1, 2].map((i) => on(tokC(FIRM, 500, 950), tokC("OFFICE", 100 + 300 * i, 300))));
    for (const c of out) assert.deepEqual(c, { staticIdx: [0], fieldIdx: [] });
  });

  test(`position tolerance ${REPEAT_POS_TOL * 100}% per axis: 20 px of 1000 matches, 21 px does not`, () => {
    // four sheets (static needs 2): the third holds the text 20 or 21 px off, the fourth
    // holds it 20 px off the other way — 41/42 px from the third
    const at = (x: number, y: number) => classifyRepetition([
      on(tokC(FIRM, 500, 950)), on(tokC("OTHER", 100, 100)), on(tokC(FIRM, x, y)), on(tokC("OTHER 2", 300, 100)),
    ]);
    assert.deepEqual(at(520, 930).map((c) => c.staticIdx), [[0], [], [0], []]);
    assert.deepEqual(at(521, 950).map((c) => c.staticIdx), [[], [], [], []]);
    assert.deepEqual(at(500, 971).map((c) => c.staticIdx), [[], [], [], []]);
  });

  test("minimum 2 sheets (amended in task 6a): two identical sheets have statics, one sheet none; fields still need 3", () => {
    const two = classifyRepetition([1, 2].map((k) => on(tokC(FIRM, 500, 950), tokC(`A-10${k}`, 900, 970))));
    for (const c of two) assert.deepEqual(c, { staticIdx: [0], fieldIdx: [] });
    assert.deepEqual(classifyRepetition([on(tokC(FIRM, 500, 950))]), [{ staticIdx: [], fieldIdx: [] }]);
  });

  test("≥ 50% of the sheets considered: 4 of 8 is static, 3 of 8 is not", () => {
    const set = (k: number) => Array.from({ length: 8 }, (_, i) => on(...(i < k ? [tokC(FIRM, 500, 950)] : []), tokC("OFFICE", 100 + 90 * i, 300)));
    const four = classifyRepetition(set(4));
    four.forEach((c, i) => assert.deepEqual(c.staticIdx, i < 4 ? [0] : [], `sheet ${i}`));
    for (const c of classifyRepetition(set(3))) assert.deepEqual(c.staticIdx, []);
  });

  test("centers are normalized to each sheet's border box", () => {
    // (0.5, 0.95) of three different border boxes
    const out = classifyRepetition([
      { tokens: [tokC(FIRM, 500, 950)], box: [0, 0, 1000, 1000] },
      { tokens: [tokC(FIRM, 600, 1000)], box: [100, 50, 1100, 1050] },
      { tokens: [tokC(FIRM, 1000, 1900)], box: [0, 0, 2000, 2000] },
    ]);
    for (const c of out) assert.deepEqual(c.staticIdx, [0]);
  });

  test("text is compared trimmed, whitespace-collapsed and upper-cased", () => {
    assert.equal(normText("  Acme   architects "), FIRM);
    const out = classifyRepetition([on(tokC(FIRM, 500, 950)), on(tokC("acme architects", 500, 950)), on(tokC(" Acme  Architects", 500, 950))]);
    for (const c of out) assert.deepEqual(c.staticIdx, [0]);
  });

  test("field: a fixed position whose text changes (sheet numbers A-101 … A-103)", () => {
    const out = classifyRepetition([1, 2, 3].map((k) => on(tokC(FIRM, 500, 950), tokC(`A-10${k}`, 900, 970))));
    for (const c of out) assert.deepEqual(c, { staticIdx: [0], fieldIdx: [1] });
  });

  test("field: text changing on most sheets (three dates over 6 sheets)", () => {
    // each token: same text on 2 sheets (< 3 = 50% of 6, not static), position filled on 6, text differs on 4 ≥ 3
    const out = classifyRepetition(["09/01", "09/01", "10/08", "10/08", "11/15", "11/15"].map((d) => on(tokC(d, 700, 970))));
    for (const c of out) assert.deepEqual(c, { staticIdx: [], fieldIdx: [0] });
  });

  test("a position filled on fewer than 3 sheets is not a field; empty text is neither", () => {
    const out = classifyRepetition([on(tokC("A-101", 900, 970)), on(tokC("A-102", 900, 970)), on(tokC("OFFICE", 200, 200))]);
    for (const c of out) assert.deepEqual(c, { staticIdx: [], fieldIdx: [] });
    // 2 of 5 sheets: static needs ⌈50% × 5⌉ = 3
    const five = classifyRepetition([0, 1, 2, 3, 4].map((i) => on(tokC(i < 2 ? FIRM : `X${i}`, i < 2 ? 500 : 100 * i, i < 2 ? 950 : 100))));
    for (const c of five) assert.deepEqual(c.staticIdx, []);
    const blank = classifyRepetition([0, 1, 2].map(() => on(tokC("  ", 500, 500))));
    for (const c of blank) assert.deepEqual(c, { staticIdx: [], fieldIdx: [] });
  });
});

describe("step 3: repetition band and repeat", () => {
  // standard page (border BOX): bottom-strip tokens at u 0.1 … 0.9, v 0.05 … 0.08
  const T = [
    tokUV("ACME", "bottom", 0.1, 0.05), tokUV("A-101", "bottom", 0.9, 0.08), tokUV("DATE", "bottom", 0.5, 0.06),
    tokUV("DEEP", "bottom", 0.5, 0.4),        // deeper than 32% of the height: out of the bottom band
    tokC("7", 30, 1000),                      // in the left margin, outside the border box
  ];

  test(`the band: the box of the given (static) token centers inside the border box within ${BAND_DEPTH * 100}% of the edge`, () => {
    const b = repetitionBands(T, BOX, [0, 1, 2, 3, 4]);
    const bot = b.bottom!;
    assertClose(bot.u0, 0.1, "u0"); assertClose(bot.u1, 0.9, "u1"); assertClose(bot.v0, 0.05, "v0"); assertClose(bot.v1, 0.08, "v1");
    assertClose(bot.vBox, 0.08 + 5 / 1920, "vBox");
    // top: every token is ≥ 60% from the top border
    assert.equal(b.top, undefined);
    // only the listed indices count
    assert.deepEqual(repetitionBands(T, BOX, []), {});
    assertClose(repetitionBands(T, BOX, [0, 2]).bottom!.u1, 0.5, "u1 of two");
  });

  test(`contiguous band: statics outward from the border up to the first depth gap > ${BAND_GAP * 100}%`, () => {
    // glyph boxes (h 10 → ±5 px = ±0.0026): ACME to v 0.0526, A-101 from 0.0774; a chance static
    // starting 5% past the band's edge (center 0.08 + 0.0026 + 0.05 + 0.0026) is left out; one
    // starting 3% past it is kept
    const edge = 0.08 + 5 / 1920;
    const chance = tokUV("EXAM", "bottom", 0.4, edge + 0.05 + 5 / 1920);
    const near = tokUV("EXAM", "bottom", 0.4, edge + 0.03 + 5 / 1920);
    assertClose(repetitionBands([...T, chance], BOX, [0, 1, 2, 5]).bottom!.vBox, edge, "gap 5%");
    assertClose(repetitionBands([...T, near], BOX, [0, 1, 2, 5]).bottom!.vBox, edge + 0.03 + 10 / 1920, "gap 3%");
    // the band grows from its shallowest static, wherever that is
    assertClose(repetitionBands([tokUV("X", "bottom", 0.5, 0.2)], BOX, [0]).bottom!.vBox, 0.2 + 5 / 1920, "lone static");
  });

  test(`framesBand: the deepest static glyph edge inside the strip ≥ d / ${FRAME_BAND_RATIO}`, () => {
    assert.equal(framesBand(0.2, 0.2), true);
    assert.equal(framesBand(0.2, 0.3), true);
    assert.equal(framesBand(0.2, 0.301), false);
    assert.equal(framesBand(0.0926, 0.26), false);  // a 26% rule above text ending at 9%
    assert.equal(framesBand(0, 0.1), false);
  });

  test("frames and repeat: statics inside the chain's strip reach its last third and span ≥ 50% of the full strip", () => {
    const cand0 = (d: number, extent: [number, number] = [0, 1]) => ({ edge: "bottom" as Edge, d, extent, cover: extent[1] - extent[0], touch: "both" as const, frame: true, freeEndGap: null });
    // a sparse band broken by a gap (statics at v 0.02 and 0.05, then 0.19 after a 13% gap): the
    // contiguous band ends at 0.0526, but the deepest static inside a gap-broken chain at 0.2216
    // (extent [0.068, 1]) reaches 0.1926 ≥ 0.2216 / 1.5 → it frames; coverage along the full strip
    const sparse = [tokUV("S", "bottom", 0.02, 0.02), tokUV("S", "bottom", 0.6, 0.05), tokUV("S", "bottom", 0.9, 0.19)];
    const o = repeatOptions(sparse, BOX, { staticIdx: [0, 1, 2], fieldIdx: [] });
    assertClose(o.repeatStrips![0].d, 0.05 + 5 / 1920, "frameless d: the contiguous band");
    assert.equal(o.frames!("bottom", 0.2216), true);
    assert.equal(o.repeat!(cand0(0.2216, [0.068, 1])), true);
    assert.equal(o.frames!("bottom", 0.29), false);                      // 0.1926 < 0.29 / 1.5
    // statics inside the strip only: a chain at 0.1 holds them to 0.0526 < 0.1 / 1.5 → not framed
    assert.equal(o.frames!("bottom", 0.1), false);
    assert.equal(o.frames!("bottom", 0.075), true);                      // 0.0526 ≥ 0.05
    // the 26% rule over text ending at 9%
    const low = [tokUV("S", "bottom", 0.1, 0.03), tokUV("S", "bottom", 0.9, 0.09)];
    assert.equal(repeatOptions(low, BOX, { staticIdx: [0, 1], fieldIdx: [] }).frames!("bottom", 0.26), false);
    // coverage: statics inside the strip spanning 0.4 → framed, but no repeat
    const narrow = repeatOptions([tokUV("A", "bottom", 0.3, 0.05), tokUV("B", "bottom", 0.7, 0.05)], BOX, { staticIdx: [0, 1], fieldIdx: [] });
    assert.equal(narrow.frames!("bottom", 0.06), true);
    assert.equal(narrow.repeat!(cand0(0.06, [0.2, 0.8])), false);
  });

  test("repeatOptions: a frameless strip where the band spans ≥ 50% of the border length, as deep as the band's glyph boxes", () => {
    // fields do not shape the band: statics ACME (u 0.1) and DATE (u 0.5) span 0.4 → no strip
    assert.deepEqual(repeatOptions(T, BOX, { staticIdx: [0, 2], fieldIdx: [1] }).repeatStrips, []);
    const o = repeatOptions(T, BOX, { staticIdx: [0, 1, 2], fieldIdx: [] });
    assert.equal(o.repeatStrips!.length, 1);
    const s = o.repeatStrips![0];
    // A-101: center v 0.08, glyphs h 10 → box edge 5 px deeper; DEEP (v 0.4) is past a 4% gap
    assert.equal(s.edge, "bottom"); assertClose(s.d, 0.08 + 5 / 1920, "d"); assert.deepEqual(s.extent, [0, 1]);
    // other (non-static) tokens do not deepen it (amendment 7)
    const filler = [tokUV("NOTE", "bottom", 0.3, 0.1), tokUV("NOTE", "bottom", 0.6, 0.12)];
    assertClose(repeatOptions([...T, ...filler], BOX, { staticIdx: [0, 1, 2], fieldIdx: [] }).repeatStrips![0].d, 0.08 + 5 / 1920, "no extension");
    // a band spanning 0.4 of the border length gives no strip and no repeat
    const short = repeatOptions([tokUV("A", "bottom", 0.3, 0.05), tokUV("B", "bottom", 0.7, 0.05)], BOX, { staticIdx: [0, 1], fieldIdx: [] });
    assert.deepEqual(short.repeatStrips, []);
    // a rotated static: the deepest edge of its rotated box counts (rot 90 in a bottom strip:
    // "AB" h 10, w 12 runs down the page, so its box reaches 6 px below the center)
    const rot: DetectToken = { str: "AB", x: 0, y: 0, w: 12, h: 10, rot: 90 };
    const [cx, cy] = px("bottom", 0.5, 0.05);
    const placed = { ...rot, x: cx - 5, y: cy - 6 };
    const r = repeatOptions([tokUV("A", "bottom", 0.1, 0.02), placed, tokUV("B", "bottom", 0.9, 0.02)], BOX, { staticIdx: [0, 1, 2], fieldIdx: [] });
    assertClose(r.repeatStrips![0].d, 0.05 + 6 / 1920, "rot d");
  });

  test("detectTitleBlock with repeatOptions: a borderless strip found by rule C; diag carries the classes", () => {
    const tokens = [...fill("bottom", 0.1, 20), NUMBER, ...DRAWING];
    // statics: fillers at u 0.025 and 0.975 (v 0.075); field: the number
    const classes = { staticIdx: [0, 19], fieldIdx: [20] };
    // the frameless strip: 0.075 + 5 / 1920 deep
    const r = detectTitleBlock(mk([], tokens), repeatOptions(tokens, [0, 0, PW, PH], classes));
    assert.equal(r.decision.edge, "bottom");
    assert.deepEqual(r.decision.rules, ["C"]);
    assert.deepEqual([r.diag.staticIdx, r.diag.fieldIdx], [[0, 19], [20]]);
  });
});

// ── steps 5 and 6: grouping and output (detectSetRegions) ───────────────────
/** A sheet of the standard page with a bottom title block at depth d: border
 * rules, the chain, `statics` at u 0.05 + 0.1·k (v 0.7·d), 15 per-sheet
 * fillers (text unique to the sheet), the sheet number `num` at u 0.9, v 0.3·d
 * (h 40), and the DRAWING tokens. `boiler` adds "VA FORM 08-6231" at u 0.55,
 * v 0.03 (inside any strip deeper than 3%); `sv` puts the statics at that
 * depth instead; `extra` adds tokens. */
function tbSheet(key: string, d: number, statics: string[], num: string, o: { boiler?: boolean; pageIn?: [number, number]; sv?: number; extra?: DetectToken[] } = {}): DetectSheet {
  const tokens: DetectToken[] = [
    ...statics.map((t, k) => tokUV(t, "bottom", 0.05 + 0.1 * k, o.sv ?? 0.7 * d)),
    ...Array.from({ length: 15 }, (_, k) => tokUV(`${key}/${k}`, "bottom", (k + 0.5) / 15, 0.75 * d)),
    tokUV(num, "bottom", 0.9, 0.3 * d, 40),
    ...(o.boiler ? [tokUV(Synth.BOILERPLATE, "bottom", 0.55, 0.03)] : []),
    ...DRAWING,
    ...(o.extra ?? []),
  ];
  return { key, w: PW, h: PH, ...(o.pageIn ? { pageIn: o.pageIn } : {}), tokens, lines: [...BORDER_RULES, chainAt("bottom", d)], source: "vector" };
}
const firmX = (n: number, o: { boiler?: boolean; d?: number; key?: string } = {}) =>
  Array.from({ length: n }, (_, i) => tbSheet(`${o.key ?? "x"}.pdf#${i + 1}`, o.d ?? 0.1, ["XRAY ARCHITECTS", "12 MAIN ST", "DRAWN BY"], `A-10${i + 1}`, o));
const firmY = (n: number, o: { boiler?: boolean; d?: number } = {}) =>
  Array.from({ length: n }, (_, i) => tbSheet(`y.pdf#${i + 1}`, o.d ?? 0.1, ["YANKEE ENGINEERS", "40 OAK AVE", "CHECKED"], `M-20${i + 1}`, o));
/** Group ids of a map, by sheet key. */
const groupsOf = (m: Map<string, SheetRegions>) => Object.fromEntries([...m].map(([k, r]) => [k, r.group ?? null]));
const distinct = (m: Map<string, SheetRegions>) => new Set([...m.values()].map((r) => r.group ?? `alone:${r.key}`)).size;

describe("detectSetRegions: output (step 6)", () => {
  const set = firmX(3, { boiler: true });
  const { regions, diag } = detectSetRegions(set);
  const r = regions.get("x.pdf#1")!;

  test("title_block (the strip, border to border) and drawing_area (the border box minus the strip)", () => {
    assert.deepEqual(r.border, BOX);
    assert.equal(r.w, PW); assert.equal(r.h, PH); assert.equal(r.key, "x.pdf#1");
    const tb = r.regions.find((x) => x.kind === "title_block")!, da = r.regions.find((x) => x.kind === "drawing_area")!;
    assertBox(tb.bbox, [60, 1768, 2940, 1960]);
    assertBox(da.bbox, [60, 40, 2940, 1768]);
    assert.equal(tb.parent, null); assert.equal(da.parent, null);
    assert.equal(tb.source, "vector"); assert.equal(da.source, "vector");
    const dg = diag.get("x.pdf#1")!;
    assert.equal(dg.edge, "bottom");
    assert.ok(tb.evidence.includes("rule:A"));
    assert.ok(tb.evidence.includes("repetition"), "fillers are fields, statics static: the band repeats");
    assert.equal(tb.confidence, 0.95);
    assert.equal(da.confidence, tb.confidence);
  });

  test("cleanRegions really runs: a degenerate sheet (w 0) keeps no zero-area region", () => {
    const m = detectSetRegions([{ key: "flat.pdf", w: 0, h: PH, tokens: [], lines: [], source: "vector" }]).regions.get("flat.pdf")!;
    assert.deepEqual(m.regions, []);
    assert.deepEqual(m.border, [0, 0, 0, PH]);
  });

  test("the regions pass cleanRegions (with dims) unchanged", () => {
    for (const s of regions.values()) assert.deepEqual(cleanRegions(s.regions, { w: s.w, h: s.h }), s.regions);
  });

  test("margin text falls in no region; strip and drawing text do", () => {
    assert.equal(hitRegion(r, 30, 1000), null);          // left margin (border at x 60)
    assert.equal(hitRegion(r, 1500, 1990), null);        // bottom margin (border at y 1960)
    assert.equal(hitRegion(r, 2652, 1902.4)!.kind, "title_block");
    assert.equal(hitRegion(r, 1500, 1000)!.kind, "drawing_area");
  });

  test("group_sig: edge, d, aspect bucket, page size when known, the group's statics", () => {
    const withPage = detectSetRegions(firmX(3, { boiler: true }).map((s) => ({ ...s, pageIn: [36, 24] as [number, number] })));
    for (const m of [regions, withPage.regions]) {
      const sig = m.get("x.pdf#1")!.group_sig!;
      assert.equal(sig.edge, "bottom");
      assertClose(sig.d, 0.1, "d");
      assert.equal(sig.aspect, aspectBucket(PW, PH));
      // one candidate group: the boilerplate is kept
      assert.deepEqual(sig.statics, ["VA FORM 08-6231", "XRAY ARCHITECTS", "12 MAIN ST", "DRAWN BY"]);
    }
    assert.equal(regions.get("x.pdf#1")!.group_sig!.page_in, undefined);
    assert.deepEqual(withPage.regions.get("x.pdf#1")!.group_sig!.page_in, [36, 24]);
  });

  test("diag carries the static and field token indices", () => {
    const dg = diag.get("x.pdf#2")!;
    // tbSheet order: 3 statics (0–2), 15 fillers (3–17), the number (18), the boilerplate (19), DRAWING
    assert.deepEqual(dg.staticIdx.filter((i) => i < 20), [0, 1, 2, 19]);
    assert.ok(dg.fieldIdx.includes(18), "the sheet number is a field");
    // DRAWING: the same "OFFICE" at the same 18 spots on every sheet — static too
    assert.deepEqual(dg.staticIdx.filter((i) => i >= 20), Array.from({ length: 18 }, (_, k) => 20 + k));
  });

  test("a sheet without a title block: drawing area = border box, confidence 0.3, no group", () => {
    const cover: DetectSheet = { key: "cover.pdf", w: PW, h: PH, tokens: DRAWING, lines: BORDER_RULES, source: "ocr" };
    const m = detectSetRegions([...set, cover]).regions.get("cover.pdf")!;
    assert.deepEqual(m.regions, [{ id: "drawing_area", kind: "drawing_area", bbox: BOX, parent: null, evidence: ["border", "no-title-block"], confidence: 0.3, source: "ocr" }]);
    assert.equal(m.group, undefined); assert.equal(m.group_sig, undefined);
    assert.deepEqual(m.border, BOX);
  });
});

describe("detectSetRegions: grouping (step 5)", () => {
  test("one firm → one group; ids from the signature", () => {
    const m = detectSetRegions(firmX(4)).regions;
    assert.equal(new Set(Object.values(groupsOf(m))).size, 1);
    assert.match(m.get("x.pdf#1")!.group!, /^g:[0-9a-f]{8}$/);
  });

  test("two firms with the same geometry but different statics → two groups", () => {
    const m = detectSetRegions([...firmX(3, { boiler: true }), ...firmY(3, { boiler: true })]).regions;
    const g = groupsOf(m);
    assert.equal(distinct(m), 2);
    assert.equal(g["x.pdf#1"], g["x.pdf#3"]); assert.equal(g["y.pdf#1"], g["y.pdf#3"]);
    assert.notEqual(g["x.pdf#1"], g["y.pdf#1"]);
    // one candidate group (same geometry): the shared boilerplate stays in both signatures
    assert.ok(m.get("y.pdf#1")!.group_sig!.statics.includes(Synth.BOILERPLATE));
  });

  test("shared boilerplate is left out of the signatures when there are ≥ 2 candidate groups", () => {
    // X at d 0.1, Y at d 0.15: two candidate groups; VA FORM is static in both
    const m = detectSetRegions([...firmX(3, { boiler: true }), ...firmY(3, { boiler: true, d: 0.15 })]).regions;
    assert.equal(distinct(m), 2);
    assert.deepEqual(m.get("x.pdf#1")!.group_sig!.statics, ["XRAY ARCHITECTS", "12 MAIN ST", "DRAWN BY"]);
    assert.ok(!m.get("y.pdf#1")!.group_sig!.statics.includes(Synth.BOILERPLATE));
  });

  test("|Δd| > 1.5% splits the same statics; ≤ 1.5% does not", () => {
    // 1.6% apart: two candidate groups whose statics are all the same strings, so none is
    // distinctive and every sheet is its own group
    const apart = detectSetRegions([...firmX(3, { d: 0.1 }), ...firmX(3, { d: 0.116, key: "x2" })]).regions;
    assert.equal(distinct(apart), 6);
    assert.deepEqual(apart.get("x.pdf#1")!.group_sig!.statics, []);
    const near = detectSetRegions([...firmX(3, { d: 0.1 }), ...firmX(3, { d: 0.114, key: "x2" })]).regions;
    assert.equal(distinct(near), 1);
  });

  test("a sheet without distinctive statics is its own group, even with the same geometry", () => {
    // three sheets with no static text in the strip (every token unique to its sheet)
    const lone = [1, 2, 3].map((i) => tbSheet(`z.pdf#${i}`, 0.1, [], `A-10${i}`, { pageIn: [36, 24] }));
    const m = detectSetRegions(lone).regions;
    assert.equal(distinct(m), 3);
    for (const r of m.values()) assert.deepEqual(r.group_sig!.statics, []);
    // equal signatures: disambiguated by the smallest member key
    assert.deepEqual([...m.values()].map((r) => r.group!.slice(-2)), ["-1", "-2", "-3"]);
  });

  test("fewer than 3 sheets: same page size, edge and |Δd| ≤ 1.5% share a group", () => {
    const two = (a?: [number, number], b?: [number, number], d2 = 0.1) =>
      distinct(detectSetRegions([tbSheet("p.pdf", 0.1, [], "A-101", { pageIn: a }), tbSheet("q.pdf", d2, [], "A-102", { pageIn: b })]).regions);
    assert.equal(two([36, 24], [36, 24]), 1);
    assert.equal(two([36, 24], [42, 30]), 2);
    assert.equal(two(undefined, undefined), 2);        // page size unknown: no anchor
    assert.equal(two([36, 24], [36, 24], 0.12), 2);    // |Δd| 2%
  });

  test("ids are unique within a map and do not depend on the input order", () => {
    const set = [...firmX(3, { boiler: true }), ...firmY(3, { boiler: true, d: 0.15 }), ...[1, 2].map((i) => tbSheet(`z.pdf#${i}`, 0.1, [], `A-10${i}`))];
    const a = detectSetRegions(set).regions, b = detectSetRegions([...set].reverse()).regions;
    const ids = new Set([...a.values()].map((r) => r.group));
    assert.equal(ids.size, 4);
    assert.deepEqual([...b].sort(), [...a].sort());
  });

  test("the maps iterate in sheet-key order, whatever the input order", () => {
    const set = [...firmY(2), ...firmX(3), tbSheet("a.pdf", 0.1, [], "A-101")];
    const want = set.map((x) => x.key).sort();
    for (const input of [set, [...set].reverse()]) {
      const { regions, diag } = detectSetRegions(input);
      assert.deepEqual([...regions.keys()], want);
      assert.deepEqual([...diag.keys()], want);
    }
  });

  test("duplicate sheet keys are an error", () => {
    assert.throws(() => detectSetRegions([...firmX(2), firmX(1)[0]]), /duplicate sheet key "x\.pdf#1"/);
  });

  test("a sheet alone in its candidate group keeps its pass-1 statics (amendment 7)", () => {
    // statics at v 0.09 on four sheets: three with the chain at 0.1, one at 0.13 (|Δd| 3%: its own
    // candidate group). Classified alone it would have no statics; it keeps the bucket's.
    const lone = tbSheet("x.pdf#4", 0.13, ["XRAY ARCHITECTS", "12 MAIN ST", "DRAWN BY"], "A-104", { sv: 0.09 });
    const set = [...[1, 2, 3].map((i) => tbSheet(`x.pdf#${i}`, 0.1, ["XRAY ARCHITECTS", "12 MAIN ST", "DRAWN BY"], `A-10${i}`, { sv: 0.09 })), lone];
    const { diag } = detectSetRegions(set);
    const dg = diag.get("x.pdf#4")!;
    assertClose(dg.d!, 0.13, "d", 1e-6);
    assert.deepEqual(dg.staticIdx.filter((i) => i < 3), [0, 1, 2]);
  });

  test("group_sig d is the lower median of the members' depths", () => {
    // two sheets of one firm (statics on both) at d 0.10 and 0.11
    const two = [tbSheet("m.pdf#1", 0.1, ["XRAY ARCHITECTS", "12 MAIN ST"], "A-101", { sv: 0.09 }), tbSheet("m.pdf#2", 0.11, ["XRAY ARCHITECTS", "12 MAIN ST"], "A-102", { sv: 0.09 })];
    const m = detectSetRegions(two).regions;
    assert.equal(m.get("m.pdf#1")!.group, m.get("m.pdf#2")!.group);
    assertClose(m.get("m.pdf#1")!.group_sig!.d, 0.1, "d", 1e-6);
  });

  test("group_sig statics: strings held by at least half the members", () => {
    // one candidate group of 6: firm X (4 sheets), firm Y (2). "HALF" sits on X1, X2 and Y1 (3 of 6:
    // static), "QUARTER" on X1, Y1 and Y2 (static). In X's signature HALF (2 of 4) is kept and
    // QUARTER (1 of 4) is not; in Y's both (1 of 2 and 2 of 2) are kept.
    const at = (str: string, u: number) => tokUV(str, "bottom", u, 0.09);
    const H = at("HALF", 0.6), Q = at("QUARTER", 0.75);
    const xs = [[H, Q], [H], [], []].map((extra, i) => tbSheet(`x.pdf#${i + 1}`, 0.1, ["XRAY ARCHITECTS", "12 MAIN ST", "DRAWN BY"], `A-10${i + 1}`, { sv: 0.09, extra }));
    const ys = [[H, Q], [Q]].map((extra, i) => tbSheet(`y.pdf#${i + 1}`, 0.1, ["YANKEE ENGINEERS", "40 OAK AVE", "CHECKED"], `M-20${i + 1}`, { sv: 0.09, extra }));
    const m = detectSetRegions([...xs, ...ys]).regions;
    assert.equal(distinct(m), 2);
    const sx = m.get("x.pdf#1")!.group_sig!.statics, sy = m.get("y.pdf#1")!.group_sig!.statics;
    assert.ok(sx.includes("HALF") && !sx.includes("QUARTER"), `X: ${sx}`);
    assert.ok(sy.includes("HALF") && sy.includes("QUARTER"), `Y: ${sy}`);
  });

  test("frameless sheets share a candidate group on aspect bucket and edge alone (amendment 4)", () => {
    // three borderless sheets (border = page 3000 × 2000), bottom, no rules. Common statics at v
    // 0.02–0.06; "DEEP NOTE" at v 0.10 on A and B only (static: 2 of 3), so A and B are 0.1026
    // deep and C 0.0626. One candidate group keeps the common statics in every signature; split
    // by d, the common statics would be static in every candidate group and dropped.
    const P = (u: number, v: number): [number, number] => [u * PW, PH - v * PH];
    const common = ["ALPHA ARCHITECTS", "1 PARK ROW", "DRAWN BY", "CHECKED BY", "PROJECT NO", "SHEET TITLE"];
    const fl = (key: string, deep: boolean, num: string): DetectSheet => ({
      key, w: PW, h: PH, lines: [], source: "vector",
      tokens: [
        ...common.map((t, k) => tokC(t, ...P(0.05 + 0.18 * k, 0.02 + 0.02 * (k % 3)))),
        ...(deep ? [tokC("DEEP NOTE", ...P(0.5, 0.1))] : []),
        ...Array.from({ length: 16 }, (_, k) => tokC(`${key}/${k}`, ...P((k + 0.5) / 16, 0.03))),
        tokC(num, ...P(0.9, 0.015), 20),
        ...Array.from({ length: 12 }, (_, k) => tokC(`${key}:${k}`, ...P(0.1 + 0.07 * k, 0.6))),
      ],
    });
    const { regions, diag } = detectSetRegions([fl("a.pdf", true, "A-101"), fl("b.pdf", true, "A-102"), fl("c.pdf", false, "A-103")]);
    assertClose(diag.get("a.pdf")!.d!, 0.1 + 5 / 2000, "a d", 1e-6);
    assertClose(diag.get("c.pdf")!.d!, 0.06 + 5 / 2000, "c d", 1e-6);
    assert.ok(regions.get("c.pdf")!.group_sig!.statics.includes("ALPHA ARCHITECTS"));
    assert.notEqual(regions.get("a.pdf")!.group, regions.get("c.pdf")!.group);   // step 5 still tests |Δd|
  });

  test("small sets count only sheets with a title block: two title blocks and a cover are small", () => {
    // two statics-free title-block sheets with the same page size share a group (the < 3 rule)
    const cover: DetectSheet = { key: "cover.pdf", w: PW, h: PH, pageIn: [36, 24], tokens: DRAWING, lines: BORDER_RULES, source: "vector" };
    const two = [tbSheet("p.pdf", 0.1, [], "A-101", { pageIn: [36, 24] }), tbSheet("q.pdf", 0.1, [], "A-102", { pageIn: [36, 24] })];
    const m = detectSetRegions([...two, cover]).regions;
    assert.equal(m.get("cover.pdf")!.group, undefined);
    assert.ok(m.get("p.pdf")!.group && m.get("p.pdf")!.group === m.get("q.pdf")!.group);
  });

  test("known limitation: 2-sheet sets can't tell firms apart when they share only boilerplate", () => {
    // two firms, one sheet each, both with the VA boilerplate: with 2 sheets only the boilerplate
    // is static (each firm's strings are on 1 sheet), one candidate group keeps it, Jaccard 1
    const m = detectSetRegions([...firmX(1, { boiler: true }), ...firmY(1, { boiler: true })]).regions;
    assert.equal(m.get("x.pdf#1")!.group, m.get("y.pdf#1")!.group);
    assert.deepEqual(m.get("x.pdf#1")!.group_sig!.statics, [Synth.BOILERPLATE]);
  });
});

// ── the frozen synthetic sets (fixtures/regionSynth.ts): self-consistency ────
const SYNTH_SETS: [string, () => Synth.SynthSet][] = [
  ["uniformSet24", Synth.uniformSet24], ["bottomStripSet5", Synth.bottomStripSet5], ["mixedSet", Synth.mixedSet],
  ["smallConsultantsSet", Synth.smallConsultantsSet], ["singleSheetSet", Synth.singleSheetSet], ["twoSheetSet", Synth.twoSheetSet],
  ["noTitleBlockSet", Synth.noTitleBlockSet], ["borderlessSet", Synth.borderlessSet], ["leftEdgeSet", Synth.leftEdgeSet],
  ["topEdgeSet", Synth.topEdgeSet], ["topPartialSet", Synth.topPartialSet], ["wrongZoneSet", Synth.wrongZoneSet],
  ["wrongZoneDeepSet", Synth.wrongZoneDeepSet], ["gridDecoySet", Synth.gridDecoySet], ["gridLegalDecoySet", Synth.gridLegalDecoySet],
  ["gridNoTitleBlockSet", Synth.gridNoTitleBlockSet], ["areaTieBreakSet", Synth.areaTieBreakSet], ["frameOnlySet", Synth.frameOnlySet],
  ["repeatOnlySet", Synth.repeatOnlySet], ["sparseStripSet", Synth.sparseStripSet], ["shortBorderSet", Synth.shortBorderSet],
  ["missingSideSet", Synth.missingSideSet],
  ...Array.from({ length: 20 }, (_, i) => [`randomSet(${i + 1})`, () => Synth.randomSet(i + 1)] as [string, () => Synth.SynthSet]),
  ["randomSet(4242)", () => Synth.randomSet(4242)],
];

describe("synthetic sets: border and candidates (steps 1–2)", () => {
  for (const [name, build] of SYNTH_SETS) {
    test(name, () => {
      for (const x of build().sheets) {
        const where = `${name} ${x.sheet.key}`;
        const b = findBorder(x.sheet);
        // within 0.5% of the page dimension: the 1% de-duplication may merge a
        // flush table's first row into the border rule (randomSet(4242) #6: 0.29%)
        b.box.forEach((v, k) => {
          const dim = k % 2 ? x.sheet.h : x.sheet.w;
          assert.ok(Math.abs(v - x.meta.border[k]) <= 0.005 * dim, `${where}: border[${k}] ${v} vs ${x.meta.border[k]}`);
        });
        if (x.truth && x.meta.frame !== "none") {
          const t = x.truth;
          const hit = findCandidates(x.sheet, b).find((c) => c.edge === t.edge && Math.abs(c.d - t.d) <= 0.01);
          assert.ok(hit, `${where}: no candidate at ${t.edge} ${t.d}`);
          // the chain splits at gaps that do not join (0.6–0.8%); the candidate is the longest run
          const [lo, hi] = x.meta.chainExtent!;
          const cuts = [lo, ...x.meta.chainGaps.filter((g) => !g.joins).flatMap((g) => [g.u, g.u + g.gap]), hi];
          let want = 0;
          for (let k = 0; k + 1 < cuts.length; k += 2) want = Math.max(want, cuts[k + 1] - cuts[k]);
          assert.ok(Math.abs(hit.cover - want) <= 0.01, `${where}: cover ${hit.cover} vs ${want}`);
        }
      }
    });
  }
});

// Single-sheet signals only (no repetition: Step 3 is task 6). Branches on
// meta.expect, never on truth (truth is non-null on some abstain sheets).
describe("synthetic sets: single-sheet decisions (step 4, repeat off)", () => {
  for (const [name, build] of SYNTH_SETS) {
    test(name, () => {
      for (const x of build().sheets) {
        const where = `${name} ${x.sheet.key} (${x.meta.expect}${x.meta.why ? " " + x.meta.why : ""})`;
        const { decision } = detectTitleBlock(x.sheet);
        switch (x.meta.expect) {
          case "find":
          case "tie-break-area": {
            // a frameless title block is found by repetition only: see the set tests below
            if (x.meta.frame === "none") continue;
            const t = x.truth!;
            assert.equal(decision.edge, t.edge, `${where}: edge`);
            assert.ok(Math.abs(decision.d! - t.d) <= 0.01, `${where}: d ${decision.d} vs ${t.d}`);
            break;
          }
          case "abstain":
            assert.equal(decision.edge, null, `${where}: expected no title block, got ${decision.edge} ${decision.d}`);
            assert.equal(decision.confidence, 0.3);
            break;
          case "no-rule-A":
            assert.ok(!decision.evidence.includes("rule:A"), `${where}: rule A fired`);
            break;
        }
      }
    });
  }
});

// ── the frozen synthetic sets with repetition on (detectSetRegions) ──────────
// Branches on meta (expect, frame), never on truth. Framed title blocks: edge
// correct and |d error| ≤ 1% of the dimension. Frameless ones are a known
// limitation (plan amendments 3 and 8): found (edge correct, |d error| ≤ 25%
// of d) or abstained — never a wrong edge or a strip off by more.
function checkDetection(x: Synth.SynthSheet, dg: { edge: Edge | null; d: number | null }, tbEvidence: string[]) {
  const where = `${x.sheet.key} (${x.meta.expect}${x.meta.why ? " " + x.meta.why : ""})`;
  switch (x.meta.expect) {
    case "find":
    case "tie-break-area": {
      const t = x.truth!;
      const frameless = x.meta.frame === "none";
      if (frameless && dg.edge === null) break;   // abstaining is allowed (amendment 8)
      const tol = frameless ? 0.25 * t.d : 0.01;
      assert.equal(dg.edge, t.edge, `${where}: edge`);
      assert.ok(Math.abs(dg.d! - t.d) <= tol, `${where}: d ${dg.d} vs ${t.d} (tolerance ${tol})`);
      break;
    }
    case "abstain":
      assert.equal(dg.edge, null, `${where}: expected no title block, got ${dg.edge} ${dg.d}`);
      break;
    case "no-rule-A":
      assert.ok(!tbEvidence.includes("rule:A"), `${where}: rule A fired`);
      break;
  }
}

/** The fixture's families against the detected groups (amendment 8: only
 * sheets that were detected): the detected members of a family share one
 * group, no group holds two families; sheets without a title block (family
 * "none", the sketch) have no group. Returns [the group count, a sheet without
 * a group counting as its own; the count expected on that basis: families
 * with a detected member plus sheets without a group]. */
function checkGroups(set: Synth.SynthSet, m: Map<string, SheetRegions>): [number, number] {
  const famGroups = new Map<string, Set<string>>(), groupFams = new Map<string, Set<string>>();
  for (const x of set.sheets) {
    const r = m.get(x.sheet.key)!;
    if (x.meta.expect === "abstain" && x.truth === null) { assert.equal(r.group, undefined, `${x.sheet.key}: no title block, no group`); continue; }
    if (!r.group) continue;
    (famGroups.get(x.meta.group) ?? famGroups.set(x.meta.group, new Set()).get(x.meta.group)!).add(r.group);
    (groupFams.get(r.group) ?? groupFams.set(r.group, new Set()).get(r.group)!).add(x.meta.group);
  }
  for (const [g, f] of groupFams) assert.equal(f.size, 1, `group ${g} holds families ${[...f].join(", ")}`);
  for (const [f, g] of famGroups) assert.equal(g.size, 1, `family ${f} split over ${g.size} groups`);
  return [distinct(m), famGroups.size + [...m.values()].filter((r) => !r.group).length];
}

describe("synthetic sets: detectSetRegions (steps 1–6, repetition on)", () => {
  for (const [name, build] of SYNTH_SETS) {
    const set = build();
    const { regions, diag } = detectSetRegions(set.sheets.map((x) => x.sheet));
    const ev = (key: string) => regions.get(key)!.regions.find((r) => r.kind === "title_block")?.evidence ?? [];
    test(`${name}: detection`, () => {
      for (const x of set.sheets) checkDetection(x, diag.get(x.sheet.key)!, ev(x.sheet.key));
    });
    test(`${name}: outputs are clean, ids unique`, () => {
      const ids = new Map<string, string>();
      for (const r of regions.values()) {
        assert.deepEqual(cleanRegions(r.regions, { w: r.w, h: r.h }), r.regions);
        assert.ok(r.regions.some((x) => x.kind === "drawing_area"));
        if (r.group) {
          const sig = JSON.stringify(r.group_sig);
          assert.ok(!ids.has(r.group) || ids.get(r.group) === sig, `${r.group}: one id, two signatures`);
          ids.set(r.group, sig);
        }
      }
    });
  }
});

describe("synthetic sets: grouping (step 5)", () => {
  // every set: the detected members of each family in one group, no group with two families; the
  // fixture's group count wherever every sheet expected to be found was found
  for (const [name, build] of SYNTH_SETS) {
    test(name, () => {
      const set = build();
      const { regions } = detectSetRegions(set.sheets.map((x) => x.sheet));
      const [n, want] = checkGroups(set, regions);
      assert.equal(n, want, `${name}: groups`);
      const allFound = set.sheets.every((x) => x.meta.expect !== "find" || regions.get(x.sheet.key)!.group);
      if (set.expectGroups !== null && allFound) assert.equal(n, set.expectGroups, `${name}: fixture group count`);
    });
  }

  test("uniformSet24: one group; the same set shuffled gives identical ids and regions", () => {
    const set = Synth.uniformSet24();
    const sheets = set.sheets.map((x) => x.sheet);
    const a = detectSetRegions(sheets).regions;
    assert.equal(new Set([...a.values()].map((r) => r.group)).size, 1);
    const rng = Synth.mulberry32(99);
    const shuffled = [...sheets];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const b = detectSetRegions(shuffled).regions;
    assert.deepEqual([...b].sort(), [...a].sort());
  });

  test("twoSheetSet: one group on its statics (2 sheets suffice since the task 6a amendment)", () => {
    const set = Synth.twoSheetSet();
    const { regions } = detectSetRegions(set.sheets.map((x) => x.sheet));
    const [p, q] = [...regions.values()];
    assert.ok(p.group && p.group === q.group);
    assert.ok(p.group_sig!.statics.includes(set.firms[0].statics[0]));
    assert.deepEqual(p.group_sig!.page_in, set.sheets[0].sheet.pageIn);
  });

  test("the same set in any order: identical ids and regions (mixed, consultants, random sets)", () => {
    for (const set of [Synth.mixedSet(), Synth.smallConsultantsSet(), Synth.randomSet(5), Synth.randomSet(18)]) {
      const sheets = set.sheets.map((x) => x.sheet);
      const a = detectSetRegions(sheets).regions, b = detectSetRegions([...sheets].reverse()).regions;
      assert.deepEqual([...b].sort(), [...a].sort(), set.name);
    }
  });
});

describe("sheetnoCandidates (split sheet numbers)", () => {
  const T = (str: string, x: number, y: number, w: number, h = 20, rot = 0): DetectToken => ({ str, x, y, w, h, rot });
  // h 20: baselines within 5 px, gap ≤ 10 px; no space at gap ≤ 3 px
  test("single pattern tokens are kept, in token order", () => {
    const c = sheetnoCandidates([T("A-101", 0, 100, 60), T("NOTES", 200, 100, 60), T("S501", 400, 300, 50)]);
    assert.deepEqual(c.map((x) => [x.str, x.idx]), [["A-101", [0]], ["S501", [2]]]);
  });
  test("\"E\" \"-\" \"001\" → E-001; h is the parts' max; center is the union box's center", () => {
    const c = sheetnoCandidates([T("E", 100, 200, 12, 20), T("-", 113, 200, 12, 18), T("001", 126, 201, 36, 20)]);
    const run = c.find((x) => x.str === "E-001")!;
    assert.deepEqual(run.idx, [0, 1, 2]);
    assert.equal(run.h, 20);
    // union: x 100–162, y 180–201
    assertClose(run.center[0], 131, "cx", 1e-9);
    assertClose(run.center[1], 190.5, "cy", 1e-9);
  });
  test("\"A1\" \"-101\" → A1-101", () => {
    const c = sheetnoCandidates([T("A1", 0, 50, 24), T("-101", 26, 50, 48)]);
    // "A1" alone also fits the pattern and stays a single-token candidate
    assert.deepEqual(c.map((x) => [x.str, x.idx]), [["A1", [0]], ["A1-101", [0, 1]]]);
  });
  test("a gap over 0.15·h joins with a space; the space-free string is also tried", () => {
    // gap 6 px > 3: joined "E 001", which the pattern accepts as is ([-. ]?)
    const spaced = sheetnoCandidates([T("E", 0, 50, 12), T("001", 18, 50, 36)]);
    assert.deepEqual(spaced.map((x) => x.str), ["E 001"]);
    // "A1" + "-101" at gap 6: "A1 -101" fails, "A1-101" (spaces removed) matches
    const removed = sheetnoCandidates([T("A1", 0, 50, 24), T("-101", 30, 50, 48)]);
    assert.deepEqual(removed.filter((x) => x.idx.length > 1).map((x) => x.str), ["A1-101"]);
  });
  test("different baselines or a gap over 0.5·h do not join", () => {
    assert.deepEqual(sheetnoCandidates([T("E", 0, 50, 12), T("-001", 13, 56, 48)]), []);   // baselines 6 px apart
    assert.deepEqual(sheetnoCandidates([T("E", 0, 50, 12), T("-001", 23, 50, 48)]), []);   // gap 11 px
    assert.deepEqual(sheetnoCandidates([T("E", 0, 50, 12, 20, 0), T("-001", 13, 50, 48, 20, 90)]), []); // direction differs
  });
  test("rot 90 (reading down the page) split number joins along y", () => {
    // rot 90: run along +y, glyphs rise toward +x. "E" from y 100 (w 12), "-001" from y 113 (gap 1)
    const c = sheetnoCandidates([T("E", 500, 100, 12, 20, 90), T("-001", 500, 113, 48, 20, 90)]);
    const run = c.find((x) => x.str === "E-001")!;
    assert.deepEqual(run.idx, [0, 1]);
    // union box: x 500–520, y 100–161 → center (510, 130.5)
    assertClose(run.center[0], 510, "cx", 1e-9);
    assertClose(run.center[1], 130.5, "cy", 1e-9);
  });
  test("a sheet number inside a longer row is found as a sub-run", () => {
    const c = sheetnoCandidates([T("DWG", 0, 50, 36), T("E", 44, 50, 12), T("-", 57, 50, 12), T("001", 70, 50, 36)]);
    assert.ok(c.some((x) => x.str === "E-001" && x.idx.join() === "1,2,3"));
  });
});

describe("detectSetRegions groupStatics (uncapped statics per group)", () => {
  test("capping a group's uncapped statics gives its signature's statics", () => {
    for (const set of [Synth.uniformSet24(), Synth.mixedSet(), Synth.smallConsultantsSet()]) {
      const r = detectSetRegions(set.sheets.map((x) => x.sheet));
      const ids = new Set([...r.regions.values()].flatMap((g) => (g.group ? [g.group] : [])));
      assert.deepEqual(new Set(r.groupStatics.keys()), ids, set.name);
      for (const g of r.regions.values()) {
        if (!g.group) continue;
        const raw = r.groupStatics.get(g.group)!;
        assert.deepEqual(capStatics(raw), g.group_sig!.statics, set.name);
        assert.deepEqual(raw, [...raw].sort(), "sorted");
      }
    }
  });
});
