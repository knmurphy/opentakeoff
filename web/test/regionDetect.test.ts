// Region detector (piece 2a): the source-neutral input adapters, then the
// detection steps (docs/design/REGION_ANNOTATION_PLAN.md, "Algorithm") over
// hand-built in-code sheets with hand-computed expectations.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  longAxisLines, TB_SHEETNO_RE, findBorder, findCandidates,
  type DetectLine, type DetectSheet, type DetectToken,
} from "../src/lib/regionDetect.ts";
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
