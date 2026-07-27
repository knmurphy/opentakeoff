// Benchmark scorer — the IoU/aggregate math the corpus gate stands on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { polyIoU, scoreGolden, aggregate, crossAgreement, aggregateCross, type ProbeScore, type CrossScore } from "../bench/score.ts";
import type { Point } from "../src/lib/oneclick.ts";

const sq = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test("polyIoU: identical squares ≈ 1, disjoint = 0, half-overlap ≈ 1/3", () => {
  assert.ok(polyIoU(sq(0, 0, 100, 100), sq(0, 0, 100, 100)) > 0.97);
  assert.equal(polyIoU(sq(0, 0, 10, 10), sq(50, 50, 60, 60)), 0);
  const half = polyIoU(sq(0, 0, 100, 100), sq(50, 0, 150, 100));   // overlap 50 of union 150
  assert.ok(Math.abs(half - 1 / 3) < 0.03, `≈1/3, got ${half}`);
});

test("scoreGolden: refusal, leak, and clean trace classify correctly", () => {
  const golden = sq(0, 0, 100, 100);
  assert.deepEqual(scoreGolden("leak", null, golden), { iou: 0, leak: false, refused: true });
  const ballooned = scoreGolden("ok", sq(-100, -100, 300, 300), golden);   // 16× the golden
  assert.ok(ballooned.leak && ballooned.iou < 0.5, "a ballooned trace is a leak");
  const clean = scoreGolden("ok", sq(1, 1, 99, 99), golden);
  assert.ok(!clean.leak && !clean.refused && clean.iou > 0.9);
});

test("aggregate: known-fail probes are tracked but never gate", () => {
  const scores: ProbeScore[] = [
    { caseName: "a", probeName: "p1", expect: "golden", status: "ok", iou: 0.98, leak: false, refused: false },
    { caseName: "a", probeName: "p2", expect: "golden", status: "ok", iou: 0.94, leak: false, refused: false },
    { caseName: "b", probeName: "r1", expect: "refusal", status: "leak", correctRefusal: true },
    { caseName: "c", probeName: "kf", expect: "refusal", status: "ok", correctRefusal: false, knownFail: true },
  ];
  const agg = aggregate(scores);
  assert.equal(agg.goldenProbes, 2);
  assert.ok(Math.abs(agg.meanIoU - 0.96) < 1e-9);
  assert.equal(agg.floorIoU, 0.94);
  assert.equal(agg.refusalRate, 0);
  assert.equal(agg.leakRate, 0);
  assert.equal(agg.correctRefusalRate, 1, "the known-fail wrong refusal must not drag the gate");
  assert.equal(agg.knownFails, 1);
});

test("crossAgreement: same verdict everywhere agrees; a flip disagrees; rings score pairwise", () => {
  const ring = sq(0, 0, 100, 100);
  const allTraced = crossAgreement([
    { res: 1, status: "ok", ring },
    { res: 0.5, status: "ok", ring: sq(1, 1, 99, 99) },
  ]);
  assert.ok(allTraced.statusAgree);
  assert.ok((allTraced.minPairIoU ?? 0) > 0.9);

  const allRefused = crossAgreement([
    { res: 1, status: "leak", ring: null },
    { res: 0.5, status: "tiny", ring: null },
  ]);
  assert.ok(allRefused.statusAgree, "leak vs tiny is the same verdict: refused");
  assert.equal(allRefused.minPairIoU, undefined);

  const flip = crossAgreement([
    { res: 1, status: "ok", ring },
    { res: 0.5, status: "tiny", ring: null },
  ]);
  assert.ok(!flip.statusAgree, "traced at one resolution, refused at another = disagreement");
});

test("crossAgreement: divergent rings drive minPairIoU down", () => {
  const three = crossAgreement([
    { res: 1, status: "ok", ring: sq(0, 0, 100, 100) },
    { res: 0.75, status: "ok", ring: sq(0, 0, 100, 100) },
    { res: 0.5, status: "ok", ring: sq(0, 0, 100, 50) },   // half the room lost
  ]);
  assert.ok(three.statusAgree);
  assert.ok((three.minPairIoU ?? 1) < 0.6, `worst pair must reflect the loss, got ${three.minPairIoU}`);
});

test("aggregateCross: known-fail excluded from gating; floor is the worst gating pair", () => {
  const scores: CrossScore[] = [
    { caseName: "a", probeName: "p1", expect: "golden", resolutions: [1, 0.5], statuses: ["ok", "ok"], statusAgree: true, minPairIoU: 0.98 },
    { caseName: "a", probeName: "p2", expect: "golden", resolutions: [1, 0.5], statuses: ["ok", "ok"], statusAgree: true, minPairIoU: 0.92 },
    { caseName: "b", probeName: "r1", expect: "refusal", resolutions: [1, 0.5], statuses: ["leak", "leak"], statusAgree: true },
    { caseName: "c", probeName: "kf", expect: "golden", resolutions: [1, 0.5], statuses: ["ok", "tiny"], statusAgree: false, minPairIoU: 0.10, knownFail: true },
  ];
  const x = aggregateCross(scores);
  assert.equal(x.crossProbes, 3);
  assert.equal(x.disagreements, 0, "the known-fail flip must not gate");
  assert.equal(x.crossFloorIoU, 0.92);
  assert.equal(x.knownFails, 1);
});
