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

test("scoreDetection: a lone poly swallowing two truth seeds is a merge that credits NO clean find — recall = precision = 0 (a leak is never rewarded)", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [30, 30] },
    { number: "102", seed: [70, 70] },
  ];
  // ONE poly covers BOTH truth seeds and there is NO tight single-seed poly over
  // either — the pure merge/leak. Under the geometry-counting rule a ≥2-seed poly
  // is under-segmentation: it finds NOTHING (both seeds are merge-only), so
  // neither truth is credited and precision is 0, not 1. This is the incoherence
  // the fix kills: a merge used to score precision = recall = 1.
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50] },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  // NO clean find: the merge poly credits nothing.
  assert.deepEqual(score.found, []);
  assert.equal(score.recall, 0);
  // Both swallowed rooms are surfaced under the under-segmentation error, tied
  // to the offending poly.
  assert.equal(score.underSegmented.length, 1);
  assert.equal(score.underSegmented[0].poly, predicted[0]);
  assert.deepEqual(score.underSegmented[0].truthSeeds, [truth[0], truth[1]]);
  // Precision: 0 distinct-found over 1 predicted poly → 0. A leak that merges two
  // rooms scores zero, never 1.
  assert.equal(score.precision, 0);
  // Both truths are merge-only → both are genuine misses.
  assert.deepEqual(score.missed, truth);
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

test("scoreDetection: matching is ORDER-INDEPENDENT — reversing the prediction list yields identical recall, precision, found, and under-segmentation, and a leak can never score perfect", () => {
  // t0 sits in BOTH polys; t1 sits only in the big (swallowing) poly A.
  //   A = square(0,0,100,100) contains BOTH t0 and t1 → a merge (≥2 seeds): it
  //       credits NO clean find and is flagged under-segmented.
  //   B = square(20,20,40,40) contains ONLY t0 → a clean single-seed poly: it
  //       cleanly finds t0.
  // The geometry-counting rule does not depend on emission order, so [A,B] and
  // [B,A] must produce the SAME numbers. And because t1 is only ever covered by
  // the merge poly, it is a MISS — a leak cannot score a perfect recall.
  const truth: RoomTruth[] = [
    { number: "101", seed: [30, 30] }, // t0 — inside both A and B → found via clean B
    { number: "102", seed: [70, 70] }, // t1 — inside A only (merge-only) → missed
  ];
  const A: PredictedRegion = { label: "A", poly: square(0, 0, 100, 100), seed: [50, 50] };
  const B: PredictedRegion = { label: "B", poly: square(20, 20, 40, 40), seed: [30, 30] };
  const labels: LabelSeed[] = [];

  const forward = scoreDetection(truth, [A, B], labels);
  const reversed = scoreDetection(truth, [B, A], labels);

  // Order independence: the two runs agree on every scoring number.
  assert.equal(forward.recall, reversed.recall);
  assert.equal(forward.precision, reversed.precision);
  assert.deepEqual(forward.found, reversed.found);
  assert.deepEqual(forward.missed, reversed.missed);
  assert.equal(forward.underSegmented.length, reversed.underSegmented.length);
  assert.deepEqual(
    forward.underSegmented[0].truthSeeds,
    reversed.underSegmented[0].truthSeeds,
  );

  // Coherent outcome: t0 found via clean poly B; A flagged under-segmented; t1 a
  // miss → recall 0.5. A leak (merge poly) cannot make the detection score
  // perfect. Distinct-found = 1 truth over 2 predicted polys → precision 0.5.
  assert.deepEqual(forward.found, [truth[0]]);
  assert.deepEqual(forward.missed, [truth[1]]);
  assert.equal(forward.recall, 0.5);
  assert.equal(forward.precision, 0.5);
  assert.equal(forward.underSegmented.length, 1);
  assert.deepEqual(forward.underSegmented[0].truthSeeds, [truth[0], truth[1]]);
  // t1 was covered only by the merge poly, so it is now a genuine miss and flows
  // into the miss buckets (no label near it, no matching label str) → labelless.
  assert.deepEqual(forward.labellessMisses, [truth[1]]);
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

test("scoreDetection: excludes a zero-area truth room from area stats (area_sf:0 must not poison stats to Infinity)", () => {
  // A truth room with area_sf:0 would make pctError = (pred - 0)/0 = Infinity
  // under a `== null` guard (which does NOT catch 0). The zero-area room must be
  // EXCLUDED, and the normal 100 room scored on its own.
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50], area_sf: 0 }, // zero truth area → excluded
    { number: "102", seed: [250, 50], area_sf: 100 }, // normal → scored
  ];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: square(0, 0, 100, 100), seed: [50, 50], area_sf: 80 },
    { label: "102", poly: square(200, 0, 300, 100), seed: [250, 50], area_sf: 100 },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  // Only the 100 room contributes an area row — the zero-area room is dropped.
  assert.equal(score.areaErrors.length, 1);
  assert.deepEqual(score.areaErrors[0], { truth: truth[1], predicted: predicted[1], pctError: 0 });
  // No Infinity leaked into the stats.
  assert.equal(score.areaStats?.meanAbsPctError, 0);
  assert.equal(score.areaStats?.worstAbsPctError, 0);
  assert.ok(Number.isFinite(score.areaStats!.worstAbsPctError));
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

test("scoreDetection: classifies the three miss buckets WITH real polys present (found rooms coexist with each miss kind)", () => {
  // A found room plus one miss of each kind, and REAL polys on the sheet (a
  // clean poly for the found room + one false-positive poly) — so the miss-bucket
  // classifier is exercised alongside live detections, not only under predicted:[].
  const truth: RoomTruth[] = [
    { number: "100", seed: [50, 50] }, // found via clean poly
    { number: "101", seed: [400, 50] }, // label near seed → detectionMiss
    { number: "102", seed: [800, 800] }, // number exists elsewhere → misplacedLabelMiss
    { number: "103", seed: [900, 900] }, // no matching label → labellessMiss
  ];
  const predicted: PredictedRegion[] = [
    { label: "100", poly: square(0, 0, 100, 100), seed: [50, 50] }, // clean find of 100
    { label: "ghost", poly: square(600, 0, 700, 100), seed: [650, 50] }, // covers no seed → FP
  ];
  const labels: LabelSeed[] = [
    { str: "101", seed: [400 + LABEL_MATCH_RADIUS_PX - 1, 50] }, // near 101 → detectionMiss
    { str: "102", seed: [10, 10] }, // "102" on sheet but far from its room → misplacedLabelMiss
    // no label str "103" anywhere → labellessMiss
  ];

  const score = scoreDetection(truth, predicted, labels);

  assert.deepEqual(score.found, [truth[0]]);
  assert.deepEqual(score.missed, [truth[1], truth[2], truth[3]]);
  assert.deepEqual(score.detectionMisses, [truth[1]]);
  assert.deepEqual(score.misplacedLabelMisses, [truth[2]]);
  assert.deepEqual(score.labellessMisses, [truth[3]]);
  assert.deepEqual(score.falsePositives, [predicted[1]]);
  assert.equal(score.recall, 0.25); // 1 of 4
  assert.equal(score.precision, 0.5); // 1 clean find over 2 predicted polys
});

test("scoreDetection: handles empty truth — recall 0, all predictions are false positives, no miss buckets", () => {
  const truth: RoomTruth[] = [];
  const predicted: PredictedRegion[] = [
    { label: "x", poly: square(0, 0, 100, 100), seed: [50, 50] },
  ];
  const labels: LabelSeed[] = [];

  const score = scoreDetection(truth, predicted, labels);

  // No truth → recall convention is 0 (nothing to find). The lone poly covers no
  // truth seed, so it is a false positive → precision 0 (0 found / 1 predicted).
  assert.equal(score.recall, 0);
  assert.equal(score.precision, 0);
  assert.deepEqual(score.found, []);
  assert.deepEqual(score.missed, []);
  assert.deepEqual(score.falsePositives, [predicted[0]]);
  assert.deepEqual(score.underSegmented, []);
  assert.deepEqual(score.detectionMisses, []);
  assert.deepEqual(score.labellessMisses, []);
  assert.equal(score.areaStats, null);
});
