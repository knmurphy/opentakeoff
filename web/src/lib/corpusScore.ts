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
// got merged; a merge poly credits NO clean find at all (only single-seed polys
// are clean), so the merge is penalized — its rooms are found only if some OTHER
// clean poly also covers them, never by the merge itself.
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
  // ORDER-INDEPENDENT geometry counting. For each predicted poly, count how many
  // truth seeds it geometrically contains (pointInPoly). The seed count alone —
  // not the emission order — decides everything, so reversing `predicted` cannot
  // change any score:
  //   • exactly 1 seed → a CLEAN detection of that one truth room.
  //   • >= 2 seeds → UNDER-SEGMENTATION (a merge/leak): it credits NO clean find
  //     and is flagged under `underSegmented` with every seed it swallowed.
  //   • 0 seeds → a false positive (complete truth) / unmatchedPrediction
  //     (partial truth).
  // A truth seed is FOUND iff it is contained in >= 1 clean (single-seed) poly. A
  // truth seed that is ONLY ever covered by >= 2-seed merge polys is a MISS (and
  // its covering poly is under-segmented). This is provably coherent: a merge can
  // never score a clean find, so a leak can never reach a perfect number.
  const seedsIn = (p: PredictedRegion): RoomTruth[] =>
    truth.filter((room) => pointInPoly(room.seed[0], room.seed[1], p.poly));

  // For each truth (by index) record: was it covered by any CLEAN poly, and the
  // FIRST such clean poly (predicted order) — the one that owns its area row.
  const cleanPolyForTruth = new Array<PredictedRegion | null>(truth.length).fill(null);
  const underSegmented: UnderSegmentation[] = [];
  predicted.forEach((p) => {
    const swallowed = seedsIn(p);
    if (swallowed.length === 1) {
      const ti = truth.indexOf(swallowed[0]);
      if (cleanPolyForTruth[ti] == null) cleanPolyForTruth[ti] = p; // first clean poly wins
    } else if (swallowed.length >= 2) {
      underSegmented.push({ poly: p, truthSeeds: swallowed });
    }
    // 0 seeds → false positive / unmatched, handled below.
  });

  // `found` = truths cleanly detected, in TRUTH order (so deepEqual(found, truth)
  // assertions survive). `missed` = every other truth — including truths covered
  // only by merge polys, which are now genuine misses (a leak does not find a
  // room), so they flow into the miss buckets. Invariant: found + missed = truth.
  const found: RoomTruth[] = [];
  const missed: RoomTruth[] = [];
  truth.forEach((room, ti) => {
    if (cleanPolyForTruth[ti]) found.push(room);
    else missed.push(room);
  });

  // Area accuracy: for each FOUND room whose truth carries an area, compare the
  // clean poly's area against it. "Clean poly" is the FIRST single-seed poly
  // (predicted order) covering that truth — the same poly that credited the
  // found/precision number, so the area row and the precision row can never
  // disagree about which region belongs to the room. (A truth may sit in more
  // than one clean poly when the detector duplicates a region; picking the first
  // is deterministic — area accuracy is not required to be order-independent.) We
  // compare the two provided `area_sf` values directly (this module is in image
  // px with no px→ft scale, so poly-geometry area is meaningless here). Rows
  // require an area on BOTH sides; missing either excludes the room.
  const areaErrors: AreaError[] = [];
  truth.forEach((room, ti) => {
    const poly = cleanPolyForTruth[ti];
    if (!poly) return; // not a found room
    // Guard `room.area_sf > 0`: a zero (or missing) truth area would make
    // pctError = (pred - 0)/0 = Infinity and poison areaStats. `== null` does NOT
    // catch 0, so we test `> 0` explicitly. A zero PREDICTED area is fine — it is
    // the numerator, not the divisor — so poly only needs to be present.
    if (room.area_sf == null || room.area_sf <= 0 || poly.area_sf == null) return;
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

  // Numerator shared by recall AND precision: the count of DISTINCT truth rooms
  // cleanly found. recall = found/|truth|; precision(complete) = found/|predicted|.
  // Provably <= 1 in complete mode: distinct-found <= #clean polys <= |predicted|.
  // Both dedup pathologies fall out of this single numerator:
  //   • duplicate (2 clean polys over 1 truth): the truth counts once, but both
  //     polys sit in the |predicted| denominator → precision diluted to 1/2.
  //   • under-segmentation (1 poly over >= 2 truths): the merge poly is NOT clean,
  //     so it credits nothing and the merged truths are misses → precision falls.
  const foundCount = found.length;
  const recall = truth.length ? foundCount / truth.length : 0;

  // Predictions whose poly contains NO truth seed. (A duplicate clean poly over a
  // truth another clean poly already covers still CONTAINS a seed, so it is
  // excluded here — it only dilutes precision via the denominator. Merge polys
  // also contain seeds, so they too are excluded — they are surfaced under
  // `underSegmented`, not here.)
  const unmatchedByTruth = predicted.filter((p) => seedsIn(p).length === 0);

  // With COMPLETE truth (clicks), an unmatched prediction is a genuine false
  // positive and precision is meaningful. With PARTIAL truth (in-bid-only
  // takeoffs), it may be a real out-of-scope room, so it is NOT charged against
  // precision: it goes to `unmatchedPredictions`, precision is `null`, and
  // recall/area over the covered subset stand on their own.
  //
  // Precision numerator is distinct-found (clean detections), not raw poly hits,
  // so two clean polys over one seed count once (the extra poly costs precision)
  // AND a merge poly over >= 2 seeds counts zero (a leak is penalized, precision
  // stays <= 1). Empty prediction ⇒ precision 1 by convention: zero predictions
  // means zero false positives.
  let falsePositives: PredictedRegion[];
  let unmatchedPredictions: PredictedRegion[];
  let precision: number | null;
  if (truthComplete) {
    falsePositives = unmatchedByTruth;
    unmatchedPredictions = [];
    precision = predicted.length ? foundCount / predicted.length : 1;
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
