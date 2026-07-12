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
  area_sf?: number; // truth area (sf) from extracted takeoffs, when available
}

export interface PredictedRegion {
  label: string;
  poly: [number, number][];
  seed: [number, number];
  area_sf?: number; // detector-computed region area (sf), when available
}

export interface LabelSeed {
  str: string;
  seed: [number, number]; // a room-number label seed found on the sheet
}

// One under-segmentation error: a single predicted poly whose interior holds two
// or more truth seeds. The detector merged distinct rooms into one region (a
// leak). `truthSeeds` lists ALL swallowed rooms so a reviewer sees which rooms
// got merged; the matching still credits the poly with only ONE found room, so
// the merge is penalized (the extra rooms are unmatched), never rewarded.
export interface UnderSegmentation {
  poly: PredictedRegion;
  truthSeeds: RoomTruth[];
}

// One found room's area comparison: signed % error of the matched predicted
// region's area against the truth area. Positive = detection is LARGER than
// truth. Only produced for found rooms where BOTH sides carry an `area_sf`.
export interface AreaError {
  truth: RoomTruth;
  predicted: PredictedRegion;
  pctError: number; // (predArea - truthArea) / truthArea * 100
}

// Summary of the |pctError| distribution across all AreaError rows. `null` when
// no found room contributed an area comparison.
export interface AreaStats {
  meanAbsPctError: number;
  medianAbsPctError: number;
  worstAbsPctError: number;
}

// Options controlling how unmatched predictions are interpreted.
export interface ScoreOptions {
  // Whether the truth set covers EVERY room on the sheet.
  //   • true (default) — clicks: truth is exhaustive, so a predicted region over
  //     no truth seed is a genuine false positive and precision is meaningful.
  //   • false — extracted takeoffs covering only in-bid rooms: an unmatched
  //     prediction may be a real out-of-scope room, so it is NOT charged as a
  //     false positive. Those regions go to `unmatchedPredictions`, precision is
  //     `null` (undefined over a partial truth), while recall over the covered
  //     subset and area accuracy are still computed.
  truthComplete?: boolean;
}

export interface Score {
  recall: number;
  precision: number | null;
  found: RoomTruth[];
  missed: RoomTruth[];
  falsePositives: PredictedRegion[];
  unmatchedPredictions: PredictedRegion[];
  labellessMisses: RoomTruth[];
  detectionMisses: RoomTruth[];
  misplacedLabelMisses: RoomTruth[];
  underSegmented: UnderSegmentation[];
  areaErrors: AreaError[];
  areaStats: AreaStats | null;
}

export function scoreDetection(
  truth: RoomTruth[],
  predicted: PredictedRegion[],
  labels: LabelSeed[],
  opts?: ScoreOptions,
): Score {
  const truthComplete = opts?.truthComplete ?? true;
  // Build a 1-to-1 matching between predicted polys and truth rooms: each poly
  // claims AT MOST ONE truth (the first not-yet-claimed truth inside it, in
  // truth order) and each truth is claimed by AT MOST ONE poly. The matching
  // size is the numerator for BOTH recall and precision, which unifies the two
  // dedup pathologies:
  //   • duplicate (2 polys over 1 truth): only the first poly claims it → the
  //     second poly matches nothing, diluting precision (numerator 1 / 2 polys).
  //   • under-segmentation (1 poly over 2 truths): the poly claims one truth →
  //     the other truth is unmatched, so precision stays <= 1 and the merge is
  //     penalized instead of rewarded.
  // A greedy claim suffices for these axis-aligned cases; the module never
  // needs max-bipartite because each truth seed sits in at most one "correct"
  // region in practice.
  const truthClaimedBy = new Array<PredictedRegion | null>(truth.length).fill(null);
  const polyClaims = new Array<number | null>(predicted.length).fill(null);
  predicted.forEach((p, pi) => {
    for (let ti = 0; ti < truth.length; ti++) {
      if (truthClaimedBy[ti]) continue;
      const [tx, ty] = truth[ti].seed;
      if (pointInPoly(tx, ty, p.poly)) {
        truthClaimedBy[ti] = p;
        polyClaims[pi] = ti;
        break;
      }
    }
  });

  // `found` = matched truths in TRUTH order (so existing deepEqual(found, truth)
  // assertions survive); `missed` = truths whose seed falls inside NO poly at
  // all. A truth swallowed as an under-segmentation extra is NEITHER found nor
  // missed — it is surfaced only under `underSegmented`, so the cap-2 miss
  // buckets classify only true absences. Invariant: found + missed may be < truth.
  const found: RoomTruth[] = [];
  const missed: RoomTruth[] = [];
  truth.forEach((room, ti) => {
    if (truthClaimedBy[ti]) {
      found.push(room);
      return;
    }
    const [x, y] = room.seed;
    const insideSomePoly = predicted.some((p) => pointInPoly(x, y, p.poly));
    if (!insideSomePoly) missed.push(room);
    // else: swallowed by an already-claimed poly → recorded under underSegmented.
  });

  // Under-segmentation: any poly containing >= 2 truth seeds. It merged rooms.
  const underSegmented: UnderSegmentation[] = [];
  predicted.forEach((p) => {
    const swallowed = truth.filter((room) =>
      pointInPoly(room.seed[0], room.seed[1], p.poly),
    );
    if (swallowed.length >= 2) underSegmented.push({ poly: p, truthSeeds: swallowed });
  });

  // Area accuracy: for each FOUND room whose truth carries an area, compare the
  // matched predicted region's area against it. "Matched predicted region" is
  // the poly the 1-to-1 matching assigned to that truth (truthClaimedBy) — the
  // same poly that credits the found/precision numbers, so the area row and the
  // precision row can never disagree about which region belongs to the room. We
  // compare the two provided `area_sf` values directly (this module is in image
  // px with no px→ft scale, so poly-geometry area is meaningless here). Rows
  // require an area on BOTH sides; missing either excludes the room.
  const areaErrors: AreaError[] = [];
  truth.forEach((room, ti) => {
    const poly = truthClaimedBy[ti];
    if (!poly) return; // not a found room
    if (room.area_sf == null || poly.area_sf == null) return;
    const pctError = ((poly.area_sf - room.area_sf) / room.area_sf) * 100;
    areaErrors.push({ truth: room, predicted: poly, pctError });
  });

  let areaStats: AreaStats | null = null;
  if (areaErrors.length) {
    const abs = areaErrors.map((e) => Math.abs(e.pctError)).sort((a, b) => a - b);
    const meanAbsPctError = abs.reduce((s, v) => s + v, 0) / abs.length;
    const mid = Math.floor(abs.length / 2);
    const medianAbsPctError =
      abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2;
    const worstAbsPctError = abs[abs.length - 1];
    areaStats = { meanAbsPctError, medianAbsPctError, worstAbsPctError };
  }

  const matchSize = polyClaims.filter((c) => c !== null).length;
  const recall = truth.length ? matchSize / truth.length : 0;

  // Predictions whose poly contains NO truth seed. (A duplicate poly over a seed
  // another poly already claimed still CONTAINS a seed, so it is excluded here —
  // it only dilutes precision via the denominator.)
  const unmatchedByTruth = predicted.filter(
    (p) => !truth.some((room) => pointInPoly(room.seed[0], room.seed[1], p.poly)),
  );

  // With COMPLETE truth (clicks), an unmatched prediction is a genuine false
  // positive and precision is meaningful. With PARTIAL truth (in-bid-only
  // takeoffs), it may be a real out-of-scope room, so it is NOT charged against
  // precision: it goes to `unmatchedPredictions`, precision is `null`, and
  // recall/area over the covered subset stand on their own.
  //
  // Precision numerator is the 1-to-1 matching size, not raw poly hits, so two
  // polys over one seed count once (extra poly costs precision) AND one poly
  // over two seeds counts once (precision stays <= 1). Empty prediction ⇒
  // precision 1 by convention: zero predictions means zero false positives.
  let falsePositives: PredictedRegion[];
  let unmatchedPredictions: PredictedRegion[];
  let precision: number | null;
  if (truthComplete) {
    falsePositives = unmatchedByTruth;
    unmatchedPredictions = [];
    precision = predicted.length ? matchSize / predicted.length : 1;
  } else {
    falsePositives = [];
    unmatchedPredictions = unmatchedByTruth;
    precision = null;
  }

  // Partition the missed rooms into three buckets by the label evidence on the
  // sheet, from most-to-least detector-blameworthy:
  //   • detectionMiss — a label seed sits within LABEL_MATCH_RADIUS_PX of the
  //     truth click. The detector HAD a seed at the room and dropped/leaked it.
  //   • misplacedLabelMiss — no label near the click, BUT the room's own number
  //     appears as a LabelSeed ELSEWHERE on the sheet (tag placed away from the
  //     room, real on some plans). Not labelless: the number exists, just not
  //     where the room is — a distinct failure (the AKMS-Lydig case).
  //   • labellessMiss — no matching label anywhere. Nothing to seed from — the
  //     structural recall floor.
  const detectionMisses: RoomTruth[] = [];
  const misplacedLabelMisses: RoomTruth[] = [];
  const labellessMisses: RoomTruth[] = [];
  for (const room of missed) {
    const [x, y] = room.seed;
    const hasLabelNear = labels.some(
      (l) => Math.hypot(l.seed[0] - x, l.seed[1] - y) <= LABEL_MATCH_RADIUS_PX,
    );
    if (hasLabelNear) {
      detectionMisses.push(room);
      continue;
    }
    const numberElsewhere =
      room.number != null && labels.some((l) => l.str === room.number);
    if (numberElsewhere) misplacedLabelMisses.push(room);
    else labellessMisses.push(room);
  }

  return {
    recall,
    precision,
    found,
    missed,
    falsePositives,
    unmatchedPredictions,
    labellessMisses,
    detectionMisses,
    misplacedLabelMisses,
    underSegmented,
    areaErrors,
    areaStats,
  };
}
