// Batch-fill detection metrics — pure core.
//
// RFC item F proposes rooms UNPROMPTED, so per-seed IoU against a hand-picked
// probe is the wrong grade: what matters is what a whole sheet's worth of
// proposals looks like. Room-level precision ("is this proposal a real room?")
// needs a full room census — human truth we don't have yet (issue #184 item
// 2). Everything here is what CAN be measured without an answer key, which is
// also where batch fill actually fails (round-9 research):
//
//   1. double-counted floor — two labels flooding one conjoined space is the
//      classic batch failure, and the bench already treats it as a gate on
//      human-measured cases (humanOverlapFrac 0.5%);
//   2. proposal quality — sub-fixture-sized regions (a seed inside stroke-text
//      glyphs) and outliers that dwarf the median room;
//   3. seed stability — a proposal that changes when the seed moves a foot was
//      never a measurement;
//   4. seeding reach — how many known rooms carry a label anchor at all, the
//      ceiling on recall no flood improvement can lift.
//
// Reported, never gated: these numbers describe a feature that doesn't exist
// yet. They exist so it can be built against them.
import { ringAreaAbs, polyOverlapPx2 } from "./score.ts";
import type { Point } from "../src/lib/oneclick.ts";
import { pointInPoly } from "../src/lib/geometry.js";

/** The canvas's "fixture-sized?" hint threshold — below this a region is an
 *  equipment footprint or a glyph interior, not a room. */
export const TINY_PROPOSAL_SF = 4;
/** Two proposals overlapping more than this share of the smaller one are the
 *  same space proposed twice, not neighbors touching along a wall. */
export const DUPLICATE_FRAC = 0.5;

export interface Proposal { label: string; seed: Point; ring: Point[] }

export interface BatchMetrics {
  labels: number;              // seeds offered to the detector
  proposals: number;           // seeds that produced a region
  refused: number;             // labels the engine declined (the honest ones)
  sumProposedSF: number;
  overlapSF: number;           // floor covered by more than one proposal
  overlapFrac: number;         // as a share of the proposed total
  duplicates: Array<[string, string]>;   // label pairs that are the same space
  tiny: string[];              // labels whose proposal is under TINY_PROPOSAL_SF
  minSF: number; medianSF: number; maxSF: number;
}

export function batchMetrics(proposals: Proposal[], labels: number, pxPerFt: number, cell = 4): BatchMetrics {
  const sf = (px2: number) => px2 / (pxPerFt * pxPerFt);
  const areas = proposals.map((p) => sf(ringAreaAbs(p.ring)));
  const sumProposedSF = areas.reduce((a, b) => a + b, 0);
  let overlapPx2 = 0;
  const duplicates: Array<[string, string]> = [];
  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      const ov = polyOverlapPx2(proposals[i].ring, proposals[j].ring, cell);
      if (ov <= 0) continue;
      overlapPx2 += ov;
      const smaller = Math.min(ringAreaAbs(proposals[i].ring), ringAreaAbs(proposals[j].ring));
      if (smaller > 0 && ov / smaller >= DUPLICATE_FRAC) duplicates.push([proposals[i].label, proposals[j].label]);
    }
  }
  const sorted = [...areas].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  const overlapSF = sf(overlapPx2);
  return {
    labels,
    proposals: proposals.length,
    refused: labels - proposals.length,
    sumProposedSF,
    overlapSF,
    overlapFrac: sumProposedSF > 0 ? overlapSF / sumProposedSF : 0,
    duplicates,
    tiny: proposals.filter((_, i) => areas[i] < TINY_PROPOSAL_SF).map((p) => p.label),
    minSF: sorted[0] ?? 0,
    medianSF: median,
    maxSF: sorted[sorted.length - 1] ?? 0,
  };
}

export interface ReachMetrics {
  goldens: number;             // known rooms in the corpus case
  withLabel: number;           // …that contain a label anchor — the recall ceiling
  recallHalf: number;          // proposals matching a golden at IoU ≥ 0.5
  recallNine: number;          // …at IoU ≥ 0.9
}

/** Seeding reach and recall against the case's pinned goldens. `iou` is passed
 *  in (the bench's rasterized polyIoU) so this core stays arithmetic. */
export function batchReach(
  proposals: Proposal[],
  goldens: Point[][],
  seeds: Point[],
  iou: (a: Point[], b: Point[]) => number,
): ReachMetrics {
  let withLabel = 0, half = 0, nine = 0;
  for (const g of goldens) {
    if (seeds.some(([x, y]) => pointInPoly(x, y, g))) withLabel++;
    let best = 0;
    for (const p of proposals) best = Math.max(best, iou(p.ring, g));
    if (best >= 0.5) half++;
    if (best >= 0.9) nine++;
  }
  return { goldens: goldens.length, withLabel, recallHalf: half, recallNine: nine };
}

export interface StabilityRow { label: string; held: number; tried: number }

/** Jitter each proposal's seed and re-measure: a region that survives a foot
 *  of seed movement is a measurement; one that doesn't is an accident of where
 *  the label happened to sit. `remeasure` returns the area in SF, or null when
 *  the engine refuses. */
export function seedStability(
  proposals: Proposal[],
  areaSF: (p: Proposal) => number,
  remeasure: (x: number, y: number) => number | null,
  offsetsPx: Array<[number, number]>,
  tol = 0.05,
): StabilityRow[] {
  return proposals.map((p) => {
    const base = areaSF(p);
    let held = 0;
    for (const [dx, dy] of offsetsPx) {
      const a = remeasure(p.seed[0] + dx, p.seed[1] + dy);
      if (a != null && base > 0 && Math.abs(a - base) <= tol * base) held++;
    }
    return { label: p.label, held, tried: offsetsPx.length };
  });
}
