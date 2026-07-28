// Batch-fill detection metric tests — pure, DOM-free, pdfjs-free. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { batchMetrics, batchReach, seedStability, TINY_PROPOSAL_SF, type Proposal } from "../bench/batch.ts";
import { polyIoU } from "../bench/score.ts";
import type { Point } from "../src/lib/oneclick.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PXFT = 18;                                    // 1 ft = 18 px, so 18×18 px = 1 SF
const prop = (label: string, ring: Point[], seed: Point = [ring[0][0] + 1, ring[0][1] + 1]): Proposal => ({ label, seed, ring });

test("batchMetrics: neighbors touching along a wall are not double-counted", () => {
  const a = prop("101", rect(0, 0, 180, 180));       // 10×10 ft = 100 SF
  const b = prop("102", rect(180, 0, 360, 180));     // shares the edge only
  const m = batchMetrics([a, b], 2, PXFT);
  assert.equal(m.proposals, 2);
  assert.equal(m.refused, 0);
  assert.ok(Math.abs(m.sumProposedSF - 200) < 1, `Σ ≈ 200 SF, got ${m.sumProposedSF}`);
  assert.ok(m.overlapSF < 1, `edge contact is not overlap, got ${m.overlapSF}`);
  assert.deepEqual(m.duplicates, []);
});

test("batchMetrics: two labels flooding one conjoined space read as duplicates", () => {
  // what an unsealed doorway does: both seeds return the SAME merged region
  const merged = rect(0, 0, 360, 180);
  const m = batchMetrics([prop("101", merged), prop("102", merged)], 2, PXFT);
  assert.deepEqual(m.duplicates, [["101", "102"]]);
  assert.ok(m.overlapFrac > 0.45, `half the proposed floor is double-counted, got ${m.overlapFrac}`);
});

test("batchMetrics: a room fully inside another counts as duplicate, a small clip does not", () => {
  const big = prop("101", rect(0, 0, 360, 360));
  const inside = prop("101A", rect(90, 90, 180, 180));           // wholly contained
  assert.deepEqual(batchMetrics([big, inside], 2, PXFT).duplicates, [["101", "101A"]]);

  const clipped = prop("102", rect(340, 0, 700, 360));           // ~6% of itself overlaps
  assert.deepEqual(batchMetrics([big, clipped], 2, PXFT).duplicates, []);
});

test("batchMetrics: glyph-interior proposals are flagged, and the size spread is reported", () => {
  const room = prop("101", rect(0, 0, 360, 360));                // 400 SF
  const glyph = prop("557", rect(0, 500, 18, 518));              // 1 SF — inside a digit
  const margin = prop("33", rect(1000, 1000, 3000, 3000));       // paper space
  const m = batchMetrics([room, glyph, margin], 5, PXFT);
  assert.deepEqual(m.tiny, ["557"]);
  assert.ok(TINY_PROPOSAL_SF === 4);
  assert.equal(m.refused, 2, "labels that produced no region");
  assert.ok(m.minSF < 2 && m.maxSF > 1000, "min/max expose the outliers the median hides");
  assert.ok(Math.abs(m.medianSF - 400) < 2, `median ≈ the real room, got ${m.medianSF}`);
});

test("batchMetrics: no proposals is not a division by zero", () => {
  const m = batchMetrics([], 7, PXFT);
  assert.equal(m.proposals, 0);
  assert.equal(m.refused, 7);
  assert.equal(m.overlapFrac, 0);
  assert.equal(m.medianSF, 0);
});

test("batchReach: the label-anchor count is the recall ceiling, separate from recall", () => {
  const roomA = rect(0, 0, 180, 180), roomB = rect(200, 0, 380, 180);
  // one proposal covering room A exactly; room B has no label anchor at all
  const proposals = [prop("101", roomA, [90, 90])];
  const r = batchReach(proposals, [roomA, roomB], [[90, 90]], (a, b) => polyIoU(a, b, 2));
  assert.equal(r.goldens, 2);
  assert.equal(r.withLabel, 1, "a corridor with no room-number tag can never be proposed");
  assert.equal(r.recallHalf, 1);
  assert.equal(r.recallNine, 1);
});

test("seedStability: a region that moves with its seed is not a measurement", () => {
  const p = prop("101", rect(0, 0, 180, 180), [90, 90]);          // 100 SF
  const areaSF = () => 100;
  const offs: Array<[number, number]> = [[18, 0], [-18, 0], [0, 18], [0, -18]];

  const solid = seedStability([p], areaSF, () => 100, offs);
  assert.deepEqual(solid, [{ label: "101", held: 4, tried: 4 }]);

  let n = 0;
  const brittle = seedStability([p], areaSF, () => (++n % 2 ? 100 : 4000), offs);
  assert.equal(brittle[0].held, 2, "half the jittered seeds leak somewhere else");

  const refusing = seedStability([p], areaSF, () => null, offs);
  assert.equal(refusing[0].held, 0);
});
