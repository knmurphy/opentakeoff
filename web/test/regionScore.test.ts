// bench/regionScore.ts — the region bench's scoring helpers, on hand-built
// labels and detections with hand-computed expectations. No PDF.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  median, quantileNearestRank, labelSpread, passTolerance, binomUpper95, meanLabel, scoreSheet, summarize,
  groupingCounts, checkOrder, fmtPass, TOL_FLOOR, jaccard, capJaccardRows, type LabelEntry, type Detected,
} from "../bench/regionScore.ts";
import type { Edge } from "../src/lib/regionDetect.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const L = (key: string, edge: Edge, d: number, family = "F"): LabelEntry =>
  ({ key, border: [0, 0, 1, 1], title_block: { edge, inner: 0, d }, family });
const NONE = (key: string, family = "none"): LabelEntry => ({ key, border: [0, 0, 1, 1], title_block: null, family });
const D = (key: string, edge: Detected["edge"], d: number | null, extra: Partial<Detected> = {}): Detected =>
  ({ key, set: "s", edge, d, rules: edge ? ["A"] : [], confidence: edge ? 0.7 : 0.3, frameless: false, group: edge ? "g1" : null, dimPx: 1000, ...extra });

describe("quantiles", () => {
  test("median of odd and even lists; empty → null", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
  test("nearest-rank p90: rank ⌈0.9·n⌉", () => {
    assert.equal(quantileNearestRank([1, 2, 3], 0.9), 3);           // rank 3
    assert.equal(quantileNearestRank([5, 1, 2, 3, 4, 6, 7, 8, 9, 10], 0.9), 9); // rank 9
    assert.equal(quantileNearestRank([], 0.9), null);
  });
});

describe("labelSpread", () => {
  test("per-sheet |dA − dB| over sheets labeled by both; median, p90, max", () => {
    const a = [L("k1", "bottom", 0.1), L("k2", "bottom", 0.2), L("k3", "right", 0.3)];
    const b = [L("k1", "bottom", 0.1), L("k2", "bottom", 0.21), L("k3", "right", 0.33)];
    const s = labelSpread(a, b);
    assert.equal(s.n, 3);
    near(s.median!, 0.01);
    near(s.p90!, 0.03);
    near(s.max!, 0.03);
    assert.equal(s.edgeDisagree, 0);
  });
  test("an edge disagreement is counted, not measured; both 'none' is a zero spread", () => {
    const a = [L("k1", "bottom", 0.1), NONE("k2"), L("k3", "right", 0.2)];
    const b = [L("k1", "right", 0.1), NONE("k2"), NONE("k3")];
    const s = labelSpread(a, b);
    assert.equal(s.edgeDisagree, 2);
    assert.equal(s.n, 1);
    assert.equal(s.max, 0);
  });
  test("keys present in only one file are ignored", () => {
    const s = labelSpread([L("k1", "top", 0.1), L("x", "top", 0.5)], [L("k1", "top", 0.12)]);
    assert.equal(s.n, 1);
    near(s.max!, 0.02);
  });
});

describe("passTolerance", () => {
  test("max(2 × max(inter-agent, maintainer), 0.5%)", () => {
    assert.equal(TOL_FLOOR, 0.005);
    near(passTolerance(0.001, null), 0.005);   // 2 × 0.001 = 0.002 < floor
    near(passTolerance(0.004, null), 0.008);
    near(passTolerance(0.001, 0.003), 0.006);
    near(passTolerance(0.0025, null), 0.005);  // exactly the floor
  });
});

describe("binomUpper95 (exact one-sided 95%, Clopper-Pearson)", () => {
  test("0 of n: 1 − 0.05^(1/n)", () => {
    near(binomUpper95(0, 1)!, 0.95, 1e-6);
    near(binomUpper95(0, 3)!, 1 - Math.pow(0.05, 1 / 3), 1e-6);  // 0.6316
    near(binomUpper95(0, 4)!, 0.527129, 1e-6);
  });
  test("1 of 2: 1 − p² = 0.05 → p = √0.95", () => {
    near(binomUpper95(1, 2)!, Math.sqrt(0.95), 1e-6);
  });
  test("n of n → 1; n = 0 → null", () => {
    assert.equal(binomUpper95(3, 3), 1);
    assert.equal(binomUpper95(0, 0), null);
  });
});

describe("meanLabel", () => {
  test("same edge: d, inner and border averaged; family kept", () => {
    const a: LabelEntry = { key: "k", border: [0.04, 0.03, 0.98, 0.96], title_block: { edge: "right", inner: 0.889, d: 0.118 }, family: "P" };
    const b: LabelEntry = { key: "k", border: [0.04, 0.03, 0.96, 0.96], title_block: { edge: "right", inner: 0.889, d: 0.104 }, family: "P" };
    const m = meanLabel(a, b);
    assert.equal(m.title_block!.edge, "right");
    near(m.title_block!.d, 0.111);
    near(m.border[2], 0.97);
    assert.equal(m.family, "P");
    assert.equal(m.disagree, false);
  });
  test("different edges or one 'none': flagged, no mean edge", () => {
    assert.equal(meanLabel(L("k", "right", 0.1), L("k", "bottom", 0.1)).disagree, true);
    assert.equal(meanLabel(L("k", "right", 0.1), NONE("k")).title_block, null);
    assert.equal(meanLabel(NONE("k"), NONE("k")).disagree, false);
  });
});

describe("scoreSheet", () => {
  const tol = 0.005;
  test("edge right and |d error| within tolerance → pass", () => {
    const s = scoreSheet(D("k", "bottom", 0.093), L("k", "bottom", 0.091), tol);
    assert.equal(s.edgeOk, true);
    near(s.dErr!, 0.002);
    assert.equal(s.pass, true);
  });
  test("edge right, d off by 1% → edge ok, no pass", () => {
    const s = scoreSheet(D("k", "bottom", 0.101), L("k", "bottom", 0.091), tol);
    assert.equal(s.edgeOk, true);
    assert.equal(s.pass, false);
  });
  test("wrong edge: no d error, no pass; abstain on a labeled strip: edge wrong", () => {
    const w = scoreSheet(D("k", "right", 0.09), L("k", "bottom", 0.09), tol);
    assert.deepEqual([w.edgeOk, w.dErr, w.pass], [false, null, false]);
    const a = scoreSheet(D("k", null, null), L("k", "bottom", 0.09), tol);
    assert.deepEqual([a.edgeOk, a.abstain, a.pass], [false, true, false]);
  });
  test("labeled 'none': abstain is correct and a pass; a strip is a false positive", () => {
    const ok = scoreSheet(D("k", null, null), NONE("k"), tol);
    assert.deepEqual([ok.edgeOk, ok.pass, ok.falsePositive], [true, true, false]);
    const fp = scoreSheet(D("k", "bottom", 0.1), NONE("k"), tol);
    assert.deepEqual([fp.edgeOk, fp.pass, fp.falsePositive], [false, false, true]);
  });
  test("frameless: pass when edge right and |d error| ≤ 25% of the label d", () => {
    const s = scoreSheet(D("k", "bottom", 0.12, { frameless: true }), L("k", "bottom", 0.1), tol);
    assert.equal(s.pass, false);              // 2% > 0.5% tolerance
    assert.equal(s.framelessPass, true);      // 2% ≤ 25% × 10% = 2.5%
    const t = scoreSheet(D("k", "bottom", 0.13, { frameless: true }), L("k", "bottom", 0.1), tol);
    assert.equal(t.framelessPass, false);
  });
});

describe("summarize", () => {
  test("counts, d error median and max, abstain, negatives, tiers, framed vs frameless", () => {
    const tol = 0.005;
    const rows = [
      scoreSheet(D("a", "bottom", 0.1), L("a", "bottom", 0.1), tol),                                         // pass, err 0
      scoreSheet(D("b", "bottom", 0.104), L("b", "bottom", 0.1), tol),                                       // pass, err .004
      scoreSheet(D("c", "bottom", 0.12, { rules: ["A", "B", "C"], confidence: 0.95 }), L("c", "bottom", 0.1), tol), // edge ok, err .02
      scoreSheet(D("d", null, null), L("d", "right", 0.1), tol),                                             // abstain
      scoreSheet(D("e", null, null), NONE("e"), tol),                                                        // negative, correct
      scoreSheet(D("f", "top", 0.2, { frameless: true, rules: ["C"] }), L("f", "top", 0.21), tol),                          // frameless, ok
    ];
    const s = summarize(rows);
    assert.deepEqual([s.n, s.edgeOk, s.pass, s.abstain], [6, 5, 3, 2]);
    // d errors over edge-correct strips: 0, .004, .02, .01 → median .007, max .02
    near(s.dErrMedian!, 0.007);
    near(s.dErrMax!, 0.02);
    assert.deepEqual(s.negatives, { n: 1, falsePositives: 0 });
    assert.deepEqual(s.tiers["A"], { n: 2, pass: 2 });
    assert.deepEqual(s.tiers["A+B+C"], { n: 1, pass: 0 });
    assert.deepEqual(s.framed, { n: 3, pass: 2 });
    assert.deepEqual(s.frameless, { n: 1, edgeOk: 1, pass: 1 });
  });
});

describe("groupingCounts", () => {
  const R = (set: string, key: string, family: string, group: string | null) => ({ set, key, family, group });
  test("splits and merges are counted per set; ungrouped sheets are listed apart", () => {
    const rows = [
      // set s1: family X on 3 sheets in 2 ids (split), family Y shares id g1 with X (merge)
      R("s1", "1", "X", "g1"), R("s1", "2", "X", "g1"), R("s1", "3", "X", "g2"), R("s1", "4", "Y", "g1"),
      // set s2: family X, one id (no split); family Z abstained
      R("s2", "1", "X", "g1"), R("s2", "2", "X", "g1"), R("s2", "3", "Z", null),
    ];
    const g = groupingCounts(rows);
    assert.equal(g.families, 3);                  // X, Y, Z
    // families with ≥ 2 grouped sheets in one set: (s1, X), (s2, X)
    assert.deepEqual([g.splitFamilies, g.familyUnits], [1, 2]);
    // cross-family pairs inside a set, among grouped sheets: s1 (X, Y) only (Z has no group)
    assert.deepEqual([g.mergedPairs, g.crossPairs], [1, 1]);
    // same-family sheet pairs: s1 X 3 pairs (1–2 same, 1–3 and 2–3 split), s2 X 1 pair → 2 of 4 split
    assert.deepEqual([g.splitSheetPairs, g.sameFamilySheetPairs], [2, 4]);
    // cross-family sheet pairs inside a set, among grouped sheets: s1 (1,4) (2,4) (3,4); same id: (1,4) (2,4)
    assert.deepEqual([g.mergedSheetPairs, g.crossSheetPairs], [2, 3]);
    assert.equal(g.ungrouped, 1);
    assert.equal(g.meaningful, true);
  });
  test("fewer than 3 families → not statistically meaningful", () => {
    const g = groupingCounts([R("s", "1", "X", "g1"), R("s", "2", "Y", "g2")]);
    assert.deepEqual([g.families, g.crossPairs, g.mergedPairs, g.meaningful], [2, 1, 0, false]);
  });
});

describe("checkOrder (labels committed before detector code)", () => {
  const git = (table: Record<string, { code: number; out: string }>) => (args: string[]) => table[args.join(" ")] ?? { code: 128, out: "" };
  test("labels commit is an ancestor of the first detector commit → verified", () => {
    const r = checkOrder(git({
      "log -1 --format=%H -- evals/regions/labels": { code: 0, out: "L\n" },
      "log --reverse --format=%H -- web/src/lib/regionDetect.ts": { code: 0, out: "D1\nD2\n" },
      "merge-base --is-ancestor L D1": { code: 0, out: "" },
    }));
    assert.deepEqual(r, { verified: true, labelCommit: "L", detectorCommit: "D1", reason: "labels L is an ancestor of D1" });
  });
  test("not an ancestor, or git cannot tell → unverified with the reason", () => {
    const notAnc = checkOrder(git({
      "log -1 --format=%H -- evals/regions/labels": { code: 0, out: "L" },
      "log --reverse --format=%H -- web/src/lib/regionDetect.ts": { code: 0, out: "D1" },
      "merge-base --is-ancestor L D1": { code: 1, out: "" },
    }));
    assert.equal(notAnc.verified, false);
    assert.match(notAnc.reason, /not an ancestor/);
    const cant = checkOrder(git({
      "log -1 --format=%H -- evals/regions/labels": { code: 0, out: "L" },
      "log --reverse --format=%H -- web/src/lib/regionDetect.ts": { code: 0, out: "D1" },
    }));
    assert.equal(cant.verified, false);
    assert.match(cant.reason, /cannot check/);
    const noLabels = checkOrder(git({}));
    assert.equal(noLabels.verified, false);
  });
  test("fmtPass prints UNVERIFIED ORDER instead of a pass rate", () => {
    assert.equal(fmtPass(3, 4, true), "3/4 (75.0%)");
    assert.equal(fmtPass(3, 4, false), "UNVERIFIED ORDER");
    assert.equal(fmtPass(0, 0, true), "0/0");
  });
});

describe("cap vs uncapped Jaccard", () => {
  test("jaccard: |A ∩ B| / |A ∪ B|; two empty sets → 1", () => {
    near(jaccard(["a", "b", "c"], ["b", "c", "d"]), 0.5);
    assert.equal(jaccard([], []), 1);
    assert.equal(jaccard(["a"], []), 0);
  });
  test("one row per group pair, with and without the cap", () => {
    // g1 uncapped {a, b, c, d}, capped {a, b}; g2 uncapped {c, d, e}, capped {c, d}
    const rows = capJaccardRows("s", [
      { id: "g1", uncapped: ["a", "b", "c", "d"], capped: ["a", "b"] },
      { id: "g2", uncapped: ["c", "d", "e"], capped: ["c", "d"] },
    ]);
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.deepEqual([r.set, r.a, r.b, r.nA, r.nB, r.nCappedA, r.nCappedB], ["s", "g1", "g2", 4, 3, 2, 2]);
    near(r.uncapped, 2 / 5);   // {c, d} / {a, b, c, d, e}
    near(r.capped, 0);         // {} / {a, b, c, d}
  });
});
