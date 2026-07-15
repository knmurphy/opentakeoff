// Corpus runner — pure glue for the headless detection-quality harness (#127/#123).
//
// The integration walk (pdfjs getOperatorList/getTextContent → extractor +
// detector) lives in the CLI driver (corpusRunnerDriver.ts). THIS module holds
// the small, error-prone, DOM-free/pdfjs-free pieces that decide whether the
// numbers are trustworthy, so they can be TDD'd one behavior at a time:
//
//   • assertFramesMatch  — the anti-landmine guard: detection and the extractor
//     MUST share one getViewport({scale:1}) frame or every area/recall number is
//     a lie. We fetch ONE viewport per page and feed it to both paths, so this
//     can only ever pass — but we assert it anyway (belt + suspenders).
//   • ringAreaSf         — the SF conversion both sides use: ringArea(px) / k,
//     with the same guards corpusScore applies (k > 0, finite).
//   • interiorPoint      — a point GUARANTEED inside a ring. For a labeled truth
//     ring we reuse the label seed that named it (inside by construction); for an
//     unlabeled ring we compute the pole of inaccessibility (robust for L-rooms,
//     where a bare centroid can fall OUTSIDE the polygon and break pointInPoly
//     matching).
//   • labelAgreement     — the AKMS high-precision thesis. corpusScore's matcher
//     is PURELY geometric (pointInPoly): a region seeded from tag "230" that
//     floods room 104's enclosure counts as a clean find with a SILENTLY WRONG
//     label. Score never compares predicted.label to truth.number, so we do it
//     here: per matched room, is the detected label the room's real number? That
//     column is the graceful-vs-dangerous distinction.

import { pointInPoly } from "./geometry.js";
import { ringArea, type Point } from "./oneclick.ts";
import type { RoomTruth, PredictedRegion, Score } from "./corpusScore.ts";

/** A viewport's device-px extent (what both the extractor and the detector see).
 *  Only width/height matter for frame parity — the transform is shared by
 *  reference, so it can't diverge. */
export interface FrameDims { width: number; height: number; }

/** Hard guard against the frame-alignment landmine: the extractor and the
 *  detector must render the SAME getViewport({scale:1}). We pass ONE viewport to
 *  both, so this is trivially true — but an off-by-scale bug would fake EVERY
 *  number, so we assert it explicitly and loudly. Throws on any mismatch. */
export function assertFramesMatch(a: FrameDims, b: FrameDims): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `FRAME MISMATCH — detection and extractor viewports differ ` +
        `(${a.width}×${a.height} vs ${b.width}×${b.height}). ` +
        `Every area/recall number would be off by a scale factor. Aborting.`,
    );
  }
}

/** Ring area in SF: shoelace px² ÷ k (px²/SF). Mirrors buildGroundTruth's
 *  area_sf and corpusScore's area guards — k must be a positive finite number or
 *  the conversion is meaningless (returns undefined so the row is simply
 *  excluded from area stats rather than poisoning them with Infinity/NaN). */
export function ringAreaSf(poly: Point[], k: number): number | undefined {
  if (!(k > 0) || !isFinite(k)) return undefined;
  const a = ringArea(poly) / k;
  return isFinite(a) ? a : undefined;
}

/** Pole of inaccessibility (the interior point farthest from any edge) via a
 *  coarse grid probe + local refinement. Unlike a centroid, this is ALWAYS
 *  strictly inside the polygon — critical for L-shaped / concave rooms where a
 *  centroid can land outside and silently break every pointInPoly match. */
export function poleOfInaccessibility(ring: Point[]): [number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX, h = maxY - minY;
  // distance from a point to the polygon boundary (0 if outside)
  const dist = (px: number, py: number): number => {
    if (!pointInPoly(px, py, ring)) return -1;
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) best = d;
    }
    return best;
  };
  let best: [number, number] = [minX + w / 2, minY + h / 2];
  let bestD = dist(best[0], best[1]);
  // coarse grid then progressively finer local search around the incumbent
  let step = Math.max(w, h) / 16 || 1;
  for (let iter = 0; iter < 8; iter++) {
    const cx = best[0], cy = best[1];
    for (let gy = -4; gy <= 4; gy++) {
      for (let gx = -4; gx <= 4; gx++) {
        const px = cx + gx * step, py = cy + gy * step;
        const d = dist(px, py);
        if (d > bestD) { bestD = d; best = [px, py]; }
      }
    }
    step /= 2;
  }
  return best;
}

/** A point GUARANTEED inside `ring`. When the truth ring carries a room number,
 *  the label seed that named it is inside the ring BY CONSTRUCTION (extractor's
 *  nearestRoomNumber used pointInPoly), so we reuse it — it doubles as the
 *  point the miss-bucket classifier keys off (a synthesized pole could drift
 *  >LABEL_MATCH_RADIUS_PX away and misclassify a detectionMiss as labelless).
 *  For an unlabeled ring we fall back to the pole of inaccessibility. */
export function interiorPoint(ring: Point[], labelSeed?: [number, number]): [number, number] {
  if (labelSeed && pointInPoly(labelSeed[0], labelSeed[1], ring)) return labelSeed;
  return poleOfInaccessibility(ring);
}

/** Per matched (found) room: did the detector attach the room's REAL number?
 *  corpusScore matches purely on geometry, so a clean find can carry a wrong
 *  label (a tag-driven flood into the wrong enclosure — the AKMS danger). We
 *  reconstruct each match from Score: `found` are the truths cleanly detected,
 *  and `areaErrors[i].predicted` is the clean poly that owns each found truth.
 *  A found truth without an area row (no area on one side) still matched, so we
 *  fall back to locating its owning clean poly by containment.
 *
 *   • correct   — predicted.label === truth.number (and truth HAS a number)
 *   • wrong     — both sides have a label but they disagree (DANGEROUS: a
 *                 confident detected room with the wrong room number)
 *   • unlabeled — truth has no room number to check against (can't judge) */
export interface LabelAgreement {
  correct: Array<{ truth: RoomTruth; predicted: PredictedRegion }>;
  wrong: Array<{ truth: RoomTruth; predicted: PredictedRegion }>;
  unlabeled: Array<{ truth: RoomTruth; predicted: PredictedRegion }>;
}

export function labelAgreement(
  score: Score,
  predicted: PredictedRegion[],
): LabelAgreement {
  const out: LabelAgreement = { correct: [], wrong: [], unlabeled: [] };
  // fast lookup: for a found truth, its owning clean predicted poly. Prefer the
  // areaErrors linkage (already the first clean poly); fall back to containment.
  const byTruth = new Map<RoomTruth, PredictedRegion>();
  for (const e of score.areaErrors) byTruth.set(e.truth, e.predicted);
  for (const truth of score.found) {
    let pred = byTruth.get(truth);
    if (!pred) {
      // find the clean poly (single truth seed) that contains this truth's seed
      pred = predicted.find(
        (p) => pointInPoly(truth.seed[0], truth.seed[1], p.poly),
      );
    }
    if (!pred) continue; // defensive: a found truth always has a covering poly
    const row = { truth, predicted: pred };
    if (truth.number == null) { out.unlabeled.push(row); continue; }
    if (pred.label === truth.number) out.correct.push(row);
    else out.wrong.push(row);
  }
  return out;
}
