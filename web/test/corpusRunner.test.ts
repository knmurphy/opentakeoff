// Corpus runner pure-glue tests (#127/#123). These guard the small pieces that
// decide whether the corpus numbers are trustworthy: frame parity, px→SF, a
// guaranteed-interior truth point, and label agreement (the AKMS high-precision
// thesis that corpusScore's geometry-only matcher cannot express). The pdfjs
// walk is integration, verified empirically against the confidential corpus, not
// here. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFramesMatch,
  ringAreaSf,
  poleOfInaccessibility,
  interiorPoint,
  labelAgreement,
} from "../src/lib/corpusRunner.ts";
import { pointInPoly } from "../src/lib/geometry.js";
import { scoreDetection, type RoomTruth, type PredictedRegion, type LabelSeed } from "../src/lib/corpusScore.ts";
import type { Point } from "../src/lib/oneclick.ts";

// ── assertFramesMatch ────────────────────────────────────────────────────────
test("assertFramesMatch: passes on identical dims", () => {
  assert.doesNotThrow(() => assertFramesMatch({ width: 3024, height: 2160 }, { width: 3024, height: 2160 }));
});
test("assertFramesMatch: throws (loudly) on any dimension mismatch — the off-by-scale landmine", () => {
  assert.throws(() => assertFramesMatch({ width: 3024, height: 2160 }, { width: 1512, height: 1080 }), /FRAME MISMATCH/);
  assert.throws(() => assertFramesMatch({ width: 100, height: 200 }, { width: 100, height: 201 }), /FRAME MISMATCH/);
});

// ── ringAreaSf ───────────────────────────────────────────────────────────────
test("ringAreaSf: px² shoelace ÷ k gives SF (10×10 px square at k=1 ⇒ 100 SF)", () => {
  const sq: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(ringAreaSf(sq, 1), 100);
  // at k=81 (≈ 1/8"=1'-0"), a 90×90 px square (8100 px²) ⇒ 100 SF
  const big: Point[] = [[0, 0], [90, 0], [90, 90], [0, 90]];
  assert.ok(Math.abs(ringAreaSf(big, 81)! - 100) < 1e-9);
});
test("ringAreaSf: guards a non-positive / non-finite k (returns undefined, never Infinity)", () => {
  const sq: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(ringAreaSf(sq, 0), undefined);
  assert.equal(ringAreaSf(sq, -5), undefined);
  assert.equal(ringAreaSf(sq, Infinity), undefined);
  assert.equal(ringAreaSf(sq, NaN), undefined);
});

// ── poleOfInaccessibility / interiorPoint ────────────────────────────────────
test("poleOfInaccessibility: returns a point strictly inside a convex square", () => {
  const sq: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const p = poleOfInaccessibility(sq);
  assert.ok(pointInPoly(p[0], p[1], sq), "pole must be inside");
});
test("poleOfInaccessibility: lands INSIDE an L-room where the centroid falls OUTSIDE", () => {
  // An L: full bottom bar, tall left arm. Centroid of this L sits in the notch,
  // OUTSIDE the polygon — the exact case a bare centroid seed breaks on.
  const L: Point[] = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]];
  const cx = L.reduce((s, p) => s + p[0], 0) / L.length;
  const cy = L.reduce((s, p) => s + p[1], 0) / L.length;
  assert.ok(!pointInPoly(cx, cy, L), "sanity: this L's vertex-centroid is outside");
  const p = poleOfInaccessibility(L);
  assert.ok(pointInPoly(p[0], p[1], L), "pole must be inside the L");
});
test("interiorPoint: reuses the label seed when it is inside the ring (miss-bucket fidelity)", () => {
  const sq: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const seed: [number, number] = [20, 80];   // inside, near the printed label
  assert.deepEqual(interiorPoint(sq, seed), [20, 80]);
});
test("interiorPoint: falls back to the pole when there is no label seed (unlabeled ring)", () => {
  const L: Point[] = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]];
  const p = interiorPoint(L);
  assert.ok(pointInPoly(p[0], p[1], L));
});
test("interiorPoint: ignores a label seed that is NOT inside the ring, uses the pole instead", () => {
  const sq: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const outside: [number, number] = [200, 200];
  const p = interiorPoint(sq, outside);
  assert.ok(pointInPoly(p[0], p[1], sq));
  assert.notDeepEqual(p, outside);
});

// ── labelAgreement ───────────────────────────────────────────────────────────
// Build a small scene: two truth rooms, each detected. One detection carries the
// correct number; the other carries a WRONG number (a tag-driven flood into the
// wrong enclosure — the dangerous AKMS false positive corpusScore counts as a
// clean find).
const roomA_poly: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
const roomB_poly: Point[] = [[200, 0], [300, 0], [300, 100], [200, 100]];

test("labelAgreement: splits matched rooms into correct vs wrong vs unlabeled", () => {
  const truth: RoomTruth[] = [
    { number: "101", seed: [50, 50], area_sf: 100 },
    { number: "102", seed: [250, 50], area_sf: 100 },
  ];
  const predicted: PredictedRegion[] = [
    { label: "101", poly: roomA_poly, seed: [50, 50], area_sf: 100 },   // correct
    { label: "230", poly: roomB_poly, seed: [250, 50], area_sf: 100 },  // WRONG label, still a clean geometric find
  ];
  const labels: LabelSeed[] = [
    { str: "101", seed: [50, 50] },
    { str: "230", seed: [250, 50] },
  ];
  const score = scoreDetection(truth, predicted, labels, { truthComplete: false });
  // corpusScore alone: both rooms are FOUND (geometry only) — it cannot see the bad label
  assert.equal(score.found.length, 2);
  const la = labelAgreement(score, predicted);
  assert.equal(la.correct.length, 1);
  assert.equal(la.wrong.length, 1);
  assert.equal(la.correct[0].truth.number, "101");
  assert.equal(la.wrong[0].truth.number, "102");
  assert.equal(la.wrong[0].predicted.label, "230");   // the dangerous mislabel surfaced
});

test("labelAgreement: an unlabeled truth room cannot be judged (goes to unlabeled)", () => {
  const truth: RoomTruth[] = [{ seed: [50, 50], area_sf: 100 }];   // no number
  const predicted: PredictedRegion[] = [{ label: "999", poly: roomA_poly, seed: [50, 50], area_sf: 100 }];
  const score = scoreDetection(truth, predicted, [], { truthComplete: false });
  const la = labelAgreement(score, predicted);
  assert.equal(la.unlabeled.length, 1);
  assert.equal(la.correct.length, 0);
  assert.equal(la.wrong.length, 0);
});

test("labelAgreement: recovers the owning poly for a found room with no area row (containment fallback)", () => {
  // truth carries no area_sf ⇒ no areaError row ⇒ labelAgreement must fall back
  // to containment to find the clean poly. Still correctly matched by label.
  const truth: RoomTruth[] = [{ number: "101", seed: [50, 50] }];
  const predicted: PredictedRegion[] = [{ label: "101", poly: roomA_poly, seed: [50, 50] }];
  const score = scoreDetection(truth, predicted, [{ str: "101", seed: [50, 50] }], { truthComplete: false });
  assert.equal(score.areaErrors.length, 0);   // no area on truth ⇒ no area row
  assert.equal(score.found.length, 1);
  const la = labelAgreement(score, predicted);
  assert.equal(la.correct.length, 1);
});
