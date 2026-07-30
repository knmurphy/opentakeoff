// Batch-fill detection metric tests — pure, DOM-free, pdfjs-free. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { batchMetrics, batchReach, batchCoverage, seedStability, TINY_PROPOSAL_SF, type Proposal } from "../bench/batch.ts";
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

test("batchMetrics: a closet inside a suite is NESTED, not a duplicate", () => {
  // traceRegion walks the outer contour, so any interior room reads as
  // contained. Calling that a duplicate (the first version did) flagged every
  // legitimate closet, island and interior office as double-counted floor.
  const big = prop("101", rect(0, 0, 360, 360));
  const inside = prop("101A", rect(90, 90, 180, 180));           // wholly contained
  const m = batchMetrics([big, inside], 2, PXFT);
  assert.deepEqual(m.duplicates, [], "containment is not duplication");
  assert.deepEqual(m.nested, [["101", "101A"]]);

  const clipped = prop("102", rect(340, 0, 700, 360));           // ~6% of itself overlaps
  const m2 = batchMetrics([big, clipped], 2, PXFT);
  assert.deepEqual(m2.duplicates, []);
  assert.deepEqual(m2.nested, []);
});

test("batchMetrics: two big rooms leaking into one shared stub ARE caught", () => {
  // the case share-of-the-smaller missed: both rings are huge, the shared part
  // is a small stub, so "share of smaller" is ~0.15 — but these are still two
  // labels proposing overlapping floor
  const a = prop("101", rect(0, 0, 600, 360));
  const b = prop("102", rect(500, 0, 1100, 360));
  const m = batchMetrics([a, b], 2, PXFT);
  assert.ok(m.overlapSF > 0, "the shared stub is double-counted floor");
  assert.deepEqual(m.duplicates, [], "…but they are not the same space");
});

test("batchMetrics: three proposals on one room do not report 300% double-counting", () => {
  // pairwise summing (the first version) counted a 3-way shared cell twice
  const room = rect(0, 0, 360, 360);                              // 400 SF
  const m = batchMetrics([prop("a", room), prop("b", room), prop("c", room)], 3, PXFT);
  assert.ok(m.overlapSF > 700 && m.overlapSF < 850, `800 SF counted twice over, got ${m.overlapSF}`);
  assert.ok(m.overlapFrac <= 1, `a fraction of the proposed total cannot exceed 1, got ${m.overlapFrac}`);
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

test("seedStability: same AREA in a different room is not stability", () => {
  const room = rect(0, 0, 180, 180);                              // 100 SF
  const twin = rect(400, 0, 580, 180);                            // 100 SF, elsewhere
  const p = prop("101", room, [90, 90]);
  const offs: Array<[number, number]> = [[18, 0], [-18, 0], [0, 18], [0, -18]];
  const iou = (a: Point[], b: Point[]) => polyIoU(a, b, 2);

  assert.deepEqual(seedStability([p], () => room, offs, iou), [{ label: "101", held: 4, tried: 4 }]);

  // the real failure this replaced: an identically sized region across the
  // hall scored as "held" because only the AREA was compared
  assert.equal(seedStability([p], () => twin, offs, iou)[0].held, 0,
    "identical area, zero overlap — not the same measurement");

  let n = 0;
  assert.equal(seedStability([p], () => (++n % 2 ? room : twin), offs, iou)[0].held, 2);
  assert.equal(seedStability([p], () => null, offs, iou)[0].held, 0);
});

test("batchCoverage: floor in NO proposal is visible, and every other metric is blind to it", () => {
  const roomA = rect(0, 0, 180, 180);          // 100 SF
  const roomB = rect(200, 0, 380, 180);        // 100 SF — the one that gets dropped
  const known = [{ name: "room-a", ring: roomA }, { name: "room-b", ring: roomB }];

  // a proposal set that covers A perfectly and B not at all
  const cov = batchCoverage([prop("101", roomA, [90, 90])], known, PXFT);
  assert.ok(Math.abs(cov.knownSF - 200) < 2, `known ≈ 200 SF, got ${cov.knownSF}`);
  assert.ok(Math.abs(cov.coveredSF - 100) < 3, `covered ≈ 100 SF, got ${cov.coveredSF}`);
  assert.ok(Math.abs(cov.frac - 0.5) < 0.02);
  assert.equal(cov.rows[0].name, "room-b", "worst-covered room sorts first");
  assert.ok(cov.rows[0].frac < 0.05, "room-b is proposed by nothing");

  // the point of the metric: the OTHER numbers all look perfect here
  const m = batchMetrics([prop("101", roomA, [90, 90])], 1, PXFT);
  assert.equal(m.overlapFrac, 0, "zero double-counting");
  assert.deepEqual(m.duplicates, []);
  assert.deepEqual(m.tiny, []);
});

test("batchCoverage: two proposals over the same half do not add up to full coverage", () => {
  const room = rect(0, 0, 360, 180);                       // 200 SF
  const leftHalf = rect(0, 0, 180, 180);
  const cov = batchCoverage(
    [prop("101", leftHalf, [90, 90]), prop("102", leftHalf, [90, 90])],
    [{ name: "room", ring: room }], PXFT,
  );
  assert.ok(cov.frac < 0.55, `union, not sum — got ${(cov.frac * 100).toFixed(0)}%`);
});

test("batchCoverage: no known floor is 100%, not a division by zero", () => {
  const cov = batchCoverage([], [], PXFT);
  assert.equal(cov.frac, 1);
  assert.deepEqual(cov.rows, []);
});
