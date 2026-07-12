// corpusScore — pure, DOM-free validation scoring for batch room detection
// (issue #127). scoreDetection() compares the user's ground-truth clicks against
// the detector's predicted regions and produces the precision/recall numbers
// that gate #123. Reuses pointInPoly from geometry.js; imports nothing from
// pdfjs/DOM. Uses node:test to match the repo's `npm test` harness (the module
// itself is runner-agnostic — it also runs under `npx vitest run corpusScore`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDetection, LABEL_MATCH_RADIUS_PX } from "../src/lib/corpusScore.ts";
import type { RoomTruth, PredictedRegion, LabelSeed } from "../src/lib/corpusScore.ts";

// A closed square poly in panel-local image px. `[x0,y0]..[x1,y1]` corners.
function square(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

test("scoreDetection: counts a truth room whose seed falls inside a predicted region as found", () => {
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50] }];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [40, 40] },
  ];
  const labels: LabelSeed[] = [{ str: "101", seed: [45, 45] }];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.found, truth);
  assert.deepEqual(score.missed, []);
  assert.equal(score.recall, 1);
});

test("scoreDetection: counts a truth room whose seed falls inside no predicted region as missed", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50] }, // inside the poly
    { number: "102", seed: [500, 500] }, // far outside — no poly covers it
  ];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [40, 40] },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.found, [truth[0]]);
  assert.deepEqual(score.missed, [truth[1]]);
  assert.equal(score.recall, 0.5);
});

test("scoreDetection: counts a predicted region containing no truth seed as a false positive and docks precision", () => {
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50] }];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [40, 40] }, // real
    { label: "ghost", poly: square(200, 200, 300, 300), seed: [250, 250] }, // no truth inside
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.found, truth);
  assert.deepEqual(score.falsePositives, [predicted[1]]);
  // 1 distinct truth matched over 2 predicted regions
  assert.equal(score.precision, 0.5);
});

test("scoreDetection: counts a truth room once when two predicted regions cover its seed, and docks precision for the duplicate", () => {
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50] }];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [40, 40] },
    { label: "101", poly: square(10, 10, 90, 90), seed: [45, 45] }, // duplicate over same seed
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.found, truth); // truth counted exactly once
  assert.equal(score.recall, 1);
  // duplicate contains a truth seed, so it is NOT a false positive...
  assert.deepEqual(score.falsePositives, []);
  // ...but it still dilutes precision: 1 distinct truth / 2 predicted = 0.5
  assert.equal(score.precision, 0.5);
});

test("scoreDetection: splits a missed truth room by whether a label seed sits within the match radius of its seed", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50] }, // has a label seed nearby → detectionMiss
    { number: "102", seed: [500, 500] }, // no label seed nearby → labellessMiss
  ];
  const predicted: PredictedRegion[] = []; // nothing detected: both truth rooms are missed
  const labels: LabelSeed[] = [
    // within the radius of truth 101's seed — the sheet HAD a room number here,
    // so detection had a seed and dropped it.
    { str: "101", seed: [50 + LABEL_MATCH_RADIUS_PX - 1, 50] },
  ];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.missed, truth);
  assert.deepEqual(score.detectionMisses, [truth[0]]);
  assert.deepEqual(score.labellessMisses, [truth[1]]);
});

test("scoreDetection: counts one poly swallowing two truth seeds as ONE match plus an under-segmentation error, keeping precision <= 1", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [30, 30] },
    { number: "102", seed: [70, 70] },
  ];
  // ONE poly covers BOTH truth seeds — the merge/leak we want to penalize.
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50] },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  // Exactly one truth is credited as found (not both) — the poly is one region.
  assert.equal(score.found.length, 1);
  // Both swallowed rooms are surfaced under the under-segmentation error, tied
  // to the offending poly.
  assert.equal(score.underSegmented.length, 1);
  assert.equal(score.underSegmented[0].poly, predicted[0]);
  assert.deepEqual(score.underSegmented[0].truthSeeds, [truth[0], truth[1]]);
  // Precision must NOT exceed 1: a leak that merges two rooms is not rewarded.
  // 1 poly claims 1 truth in the matching → 1/1 = 1 (denominator is |predicted|).
  assert.notEqual(score.precision, null);
  assert.ok(score.precision! <= 1, `precision ${score.precision} should be <= 1`);
  assert.equal(score.precision, 1);
});

test("scoreDetection: discriminates the three miss buckets — detection, misplaced-label, and labelless", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50] }, // label seed WITHIN radius → detectionMiss
    { number: "102", seed: [500, 500] }, // label "102" exists elsewhere on sheet → misplacedLabelMiss
    { number: "103", seed: [900, 900] }, // no matching label anywhere → labellessMiss
  ];
  const predicted: PredictedRegion[] = []; // nothing detected: all three missed
  const labels: LabelSeed[] = [
    // near 101's seed — detector had a seed and dropped it
    { str: "101", seed: [50 + LABEL_MATCH_RADIUS_PX - 1, 50] },
    // "102" IS on the sheet, but tagged far from 102's room seed (real on some
    // plans where the number is placed away from the room)
    { str: "102", seed: [10, 10] },
    // note: no LabelSeed with str "103" anywhere
  ];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.missed, truth);
  assert.deepEqual(score.detectionMisses, [truth[0]]);
  assert.deepEqual(score.misplacedLabelMisses, [truth[1]]);
  assert.deepEqual(score.labellessMisses, [truth[2]]);
});

test("scoreDetection: matching is greedy in prediction order — a swallowing poly claims first, which can leave a tighter poly's only truth unmatched", () => {
  // t0 sits in BOTH polys; t1 sits only in the big (swallowing) poly A.
  // Optimal would be A→t1, B→t0 (recall 1). Greedy walks predictions in order:
  // A claims the first unclaimed truth it contains (t0), so B (which contains
  // only t0) is left with nothing → recall 0.5. This is a DELIBERATE,
  // order-dependent choice: in practice each truth seed lands in exactly one
  // correct region, so max-bipartite optimization is not worth the complexity.
  // This test pins the documented worst case so a future refactor is a conscious
  // decision, not an accident.
  const truth: RoomTruth[] = [
    { number: "101", seed: [30, 30] }, // t0 — inside both A and B
    { number: "102", seed: [70, 70] }, // t1 — inside A only
  ];
  const predicted: PredictedRegion[] = [
    { label: "A", poly: square(0, 0, 100, 100), seed: [50, 50] }, // swallows t0 and t1
    { label: "B", poly: square(20, 20, 40, 40), seed: [30, 30] }, // tight around t0 only
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  // Greedy: A claims t0, t1 unmatched-but-swallowed → 1 found, recall 0.5.
  assert.equal(score.found.length, 1);
  assert.deepEqual(score.found, [truth[0]]);
  assert.equal(score.recall, 0.5);
  // A still swallows two truths → under-segmentation surfaces both.
  assert.equal(score.underSegmented.length, 1);
  assert.deepEqual(score.underSegmented[0].truthSeeds, [truth[0], truth[1]]);
  // t1 is neither found nor missed (swallowed), so the miss buckets stay empty.
  assert.deepEqual(score.missed, []);
});

test("scoreDetection: scores perfect detection — each truth matched by exactly one poly, no extras — as precision = recall = 1", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50] },
    { number: "102", seed: [250, 50] },
  ];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50] },
    { label: "102", poly: square(200, 0, 300, 100), seed: [250, 50] },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  assert.equal(score.recall, 1);
  assert.equal(score.precision, 1);
  assert.deepEqual(score.found, truth);
  assert.deepEqual(score.missed, []);
  assert.deepEqual(score.falsePositives, []);
});

test("scoreDetection: reports per-room signed area % error and summary stats for found rooms with a truth area", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50], area_sf: 100 }, // exact match → 0%
    { number: "102", seed: [250, 50], area_sf: 100 }, // detection is 10% large → +10%
    { number: "103", seed: [450, 50] }, // no truth area → excluded from area stats
  ];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50], area_sf: 100 },
    { label: "102", poly: square(200, 0, 300, 100), seed: [250, 50], area_sf: 110 },
    { label: "103", poly: square(400, 0, 500, 100), seed: [450, 50], area_sf: 200 },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  // Only the two rooms with a truth area appear; 103 is excluded.
  assert.equal(score.areaErrors.length, 2);
  assert.deepEqual(score.areaErrors[0], { truth: truth[0], predicted: predicted[0], pctError: 0 });
  assert.deepEqual(score.areaErrors[1], { truth: truth[1], predicted: predicted[1], pctError: 10 });

  assert.equal(score.areaStats?.meanAbsPctError, 5); // (|0| + |10|) / 2
  assert.equal(score.areaStats?.medianAbsPctError, 5); // median of [0, 10]
  assert.equal(score.areaStats?.worstAbsPctError, 10);
});

test("scoreDetection: reports null area stats when no found room has a truth area", () => {
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50] }]; // no area_sf
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50], area_sf: 100 },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.areaErrors, []);
  assert.equal(score.areaStats, null);
});

test("scoreDetection: truthComplete false vs true — the same unmatched prediction is an out-of-scope region, not a false positive", () => {
  // One in-bid truth room the detector found, plus one extra predicted region
  // over NO truth seed (an out-of-scope room, real when truth covers only in-bid
  // rooms).
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50], area_sf: 100 }];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50], area_sf: 100 },
    { label: "OOS", poly: square(200, 200, 300, 300), seed: [250, 250] },
  ];
  const labels: LabelSeed[] = [];

  // Default (clicks / complete truth): the extra region IS a false positive.
  const complete = scoreDetection(truth, predicted, labels);
  assert.deepEqual(complete.falsePositives, [predicted[1]]);
  assert.equal(complete.precision, 0.5); // 1 match / 2 predicted
  assert.deepEqual(complete.unmatchedPredictions, []);
  assert.equal(complete.recall, 1);

  // Partial truth (extracted takeoffs, in-bid only): the extra region is NOT
  // held against precision — reported separately, precision undefined.
  const partial = scoreDetection(truth, predicted, labels, { truthComplete: false });
  assert.deepEqual(partial.falsePositives, []);
  assert.equal(partial.precision, null);
  assert.deepEqual(partial.unmatchedPredictions, [predicted[1]]);
  // recall over the in-bid subset and area accuracy still computed
  assert.equal(partial.recall, 1);
  assert.equal(partial.areaStats?.meanAbsPctError, 0);
});

test("scoreDetection: treats an empty prediction as recall 0 but precision 1 (no predictions means no false positives)", () => {
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50] }];
  const predicted: PredictedRegion[] = [];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  assert.equal(score.recall, 0);
  // Precision is |false positives| = 0, so precision is vacuously 1. recall 0
  // still makes the total miss visible, so precision 1 hides nothing from a gate
  // comparison — and a number beats NaN when this feeds a threshold.
  assert.equal(score.precision, 1);
});
