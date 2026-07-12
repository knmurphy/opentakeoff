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
