// corpusScore — pure validation scoring for batch room detection (issue #127).
// scoreDetection() compares the user's ground-truth clicks (RoomTruth) against
// the detector's PredictedRegions and reports precision/recall plus the room
// lists a reviewer needs to see WHY a number is what it is. DOM-free and
// pdfjs-free: the only dependency is pointInPoly from geometry.js, so it runs
// straight under node/vitest. All coordinates share one panel-local image-px
// frame.
import { pointInPoly } from "./geometry.js";

// How close (in panel-local image px) a room-number label seed must sit to a
// truth click for us to say "the sheet HAD a label there." A missed truth room
// with a label seed inside this radius is a detectionMiss (the detector had a
// seed and dropped/leaked it); with none, it is a labellessMiss (a structural
// recall floor — no room number to seed from). This is a tunable tolerance for
// click-vs-label placement drift, not a hard geometric truth; widen it if
// hand-labeled clicks land far from the printed numbers.
export const LABEL_MATCH_RADIUS_PX = 40;

export interface RoomTruth {
  number?: string;
  seed: [number, number]; // the user's click = ground truth
}

export interface PredictedRegion {
  label: string;
  poly: [number, number][];
  seed: [number, number];
}

export interface LabelSeed {
  str: string;
  seed: [number, number]; // a room-number label seed found on the sheet
}

export interface Score {
  recall: number;
  precision: number;
  found: RoomTruth[];
  missed: RoomTruth[];
  falsePositives: PredictedRegion[];
  labellessMisses: RoomTruth[];
  detectionMisses: RoomTruth[];
}

export function scoreDetection(
  truth: RoomTruth[],
  predicted: PredictedRegion[],
  labels: LabelSeed[],
): Score {
  const found: RoomTruth[] = [];
  const missed: RoomTruth[] = [];

  for (const room of truth) {
    const [x, y] = room.seed;
    const hit = predicted.some((p) => pointInPoly(x, y, p.poly));
    if (hit) found.push(room);
    else missed.push(room);
  }

  const recall = truth.length ? found.length / truth.length : 0;

  // A predicted region is a false positive when its poly contains NO truth seed.
  // (A duplicate poly over a seed another poly already claimed still CONTAINS a
  // seed, so it is not an FP — it only dilutes precision via the denominator.)
  const falsePositives = predicted.filter(
    (p) => !truth.some((room) => pointInPoly(room.seed[0], room.seed[1], p.poly)),
  );

  // Numerator is DISTINCT truth rooms matched (= |found|), not raw poly hits, so
  // two polys over one seed count the truth once and the extra poly costs
  // precision. That is what makes #123 dedup failures show up in the number.
  // Empty prediction ⇒ precision 1 by convention: with zero predictions there
  // are zero false positives, so precision is vacuously perfect. recall (0 here)
  // still surfaces the total miss, so this hides nothing from a gate comparison,
  // and a real number beats NaN when the score feeds a threshold check.
  const precision = predicted.length ? found.length / predicted.length : 1;

  // Partition the missed rooms: a miss with a label seed within
  // LABEL_MATCH_RADIUS_PX of its click is a detectionMiss (a seed existed and
  // the detector didn't turn it into a kept region); one with no label nearby is
  // a labellessMiss (nothing to seed from — the structural recall floor).
  const detectionMisses: RoomTruth[] = [];
  const labellessMisses: RoomTruth[] = [];
  for (const room of missed) {
    const [x, y] = room.seed;
    const hasLabel = labels.some(
      (l) => Math.hypot(l.seed[0] - x, l.seed[1] - y) <= LABEL_MATCH_RADIUS_PX,
    );
    if (hasLabel) detectionMisses.push(room);
    else labellessMisses.push(room);
  }

  return {
    recall,
    precision,
    found,
    missed,
    falsePositives,
    labellessMisses,
    detectionMisses,
  };
}
