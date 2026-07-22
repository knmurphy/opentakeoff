// polyscore — pure, DOM-free polygon overlap scoring for the One-Click accuracy
// corpus (issue #172 / epic #171). Given a TRACED ring set and a GOLDEN ring set
// (both in the same image/mask px frame), it reports how close the trace is to
// the accepted extent. No pdfjs, no DOM — runs straight under `node --test` and
// headless in the MCP server.
//
// WHY A BAND, NOT AN IoU FLOOR (the load-bearing design decision):
// the flood's traced contour rides ~half-a-mask-px INSIDE the drawn wall (the
// single-px Bresenham barrier in oneclick.buildMask). That is a CONSTANT ABSOLUTE
// inset — ~1 px on every edge, independent of room size. A fixed IoU floor is
// dimensionally mismatched to a constant-absolute error: a legit 20×20 room
// scores IoU 0.81 from the inset alone (would fail an 0.85 floor with zero
// regression), while a 300×300 room scores 0.987 and hides a 7%-per-edge error
// under the same floor. The primary metric here is instead
//
//     band = symmetric_difference_area / golden_perimeter        (mask px)
//
// A uniform 1-px inset gives band ≈ 1.0 at EVERY size (a 1-px-wide frame whose
// area is perimeter×1), so the gate is dimensionally matched to the engine's
// known inset. IoU is still computed and returned as a familiar secondary number,
// but it is not the gate.
//
// ROBUSTNESS (each closes a reviewed defect):
//  - All of |A|, |B|, |A∩B|, |A∪B| are counted on ONE shared grid — never mix an
//    analytic shoelace area into the ratio (that breaks IoU==1 on identical rings).
//  - The grid spans the union bbox; the SHORT side always gets ≥512 cells (a hard
//    invariant), so thin corridors stay resolved. The long side is capped at 16384
//    cells (grid goes anisotropic past 32:1 aspect — fine, since A/B/I share it).
//  - Point-in-polygon samples are JITTERED by a non-dyadic offset so no authored
//    integer/half-integer edge ever coincides with a sample → deterministic across
//    platforms (no <, <= tie ambiguity).
//  - Ring[] with even-odd fill: a hole ring (column/shaft) flips parity, so points
//    inside a hole read as outside. Handles non-convex + self-touching rings.
//  - Degenerate guards: rings with <3 verts contribute nothing; an empty union is
//    handled explicitly; a NaN can never enter the returned numbers.

export type Point = [number, number];
/** A polygon: one outer ring plus optional hole rings, filled even-odd. */
export type Ring = Point[];

/** Short side gets at least this many grid cells (hard invariant). */
export const MIN_SHORT_CELLS = 512;
/** Long side is capped here; beyond 32:1 aspect the grid becomes anisotropic. */
export const MAX_LONG_CELLS = 16384;
// Non-dyadic in-cell sample offsets: guarantee no authored edge at integer or
// half-integer coordinates lands exactly on a sample point (kills PIP ties).
const JX = 0.0137, JY = 0.0079;

export interface ScoreResult {
  band: number;          // symdiff_area / golden_perimeter (mask px) — the primary metric
  iou: number;           // |A∩B| / |A∪B| (secondary)
  tracedArea: number;    // grid-measured area of the traced polygon
  goldenArea: number;    // grid-measured area of the golden polygon
  interArea: number;
  unionArea: number;
  symdiffArea: number;
  goldenPerimeter: number;
  grid: { nx: number; ny: number; hx: number; hy: number };  // for determinism audits
}

/** Sum of every edge length across all rings (analytic). The band normalizer. */
export function ringsPerimeter(rings: Ring[]): number {
  let p = 0;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      p += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
    }
  }
  return p;
}

/** Even-odd point membership across ALL rings (holes flip parity). Half-open
 *  crossing test; combined with the jittered sample it is tie-free. */
function inRings(px: number, py: number, polys: Ring[]): boolean {
  let inside = false;
  for (const ring of polys) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Bounding box over every vertex of both polygons (rings with <3 verts ignored). */
function unionBBox(a: Ring[], b: Ring[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polys of [a, b]) {
    for (const ring of polys) {
      if (ring.length < 3) continue;
      for (const [x, y] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/** Score a traced polygon against a golden (reference) polygon, both `Ring[]` in
 *  the same px frame. `band` is normalized by the GOLDEN perimeter (asymmetric:
 *  the golden is the reference). */
export function score(traced: Ring[], golden: Ring[]): ScoreResult {
  const goldenPerimeter = ringsPerimeter(golden);
  const empty: ScoreResult["grid"] = { nx: 0, ny: 0, hx: 0, hy: 0 };
  const bbox = unionBBox(traced, golden);

  // Both polygons empty/degenerate ⇒ identical (nothing vs nothing).
  if (!bbox) {
    return { band: 0, iou: 1, tracedArea: 0, goldenArea: 0, interArea: 0, unionArea: 0, symdiffArea: 0, goldenPerimeter, grid: empty };
  }

  const bboxW = bbox.maxX - bbox.minX, bboxH = bbox.maxY - bbox.minY;
  // Cell size: the short side gets AT LEAST MIN_SHORT_CELLS cells, but we refine
  // to a finer h when the total-cell budget (MIN_SHORT_CELLS × MAX_LONG_CELLS)
  // allows — filling the budget resolves the ~1px inset feature much better on
  // low-aspect (square-ish) rooms than the bare 512 floor would. The long side is
  // still hard-capped at MAX_LONG_CELLS, so on very high aspect the grid becomes
  // anisotropic (short axis keeps its ≥512 cells, long axis is coarser).
  const BUDGET = MIN_SHORT_CELLS * MAX_LONG_CELLS;
  let h = Math.min(bboxW, bboxH) / MIN_SHORT_CELLS;         // 512 across the short side
  const hBudget = Math.sqrt((bboxW * bboxH) / BUDGET);
  if (hBudget < h) h = hBudget;                             // more cells when affordable
  let nx = Math.min(MAX_LONG_CELLS, Math.max(1, Math.ceil(bboxW / h)));
  let ny = Math.min(MAX_LONG_CELLS, Math.max(1, Math.ceil(bboxH / h)));
  const hx = bboxW / nx, hy = bboxH / ny;
  const cellArea = hx * hy;

  let aCount = 0, bCount = 0, interCount = 0, unionCount = 0;
  for (let j = 0; j < ny; j++) {
    const py = bbox.minY + (j + 0.5 + JY) * hy;
    for (let i = 0; i < nx; i++) {
      const px = bbox.minX + (i + 0.5 + JX) * hx;
      const inA = inRings(px, py, traced);
      const inB = inRings(px, py, golden);
      if (inA) aCount++;
      if (inB) bCount++;
      if (inA && inB) interCount++;
      if (inA || inB) unionCount++;
    }
  }

  const tracedArea = aCount * cellArea;
  const goldenArea = bCount * cellArea;
  const interArea = interCount * cellArea;
  const unionArea = unionCount * cellArea;
  const symdiffArea = (aCount + bCount - 2 * interCount) * cellArea;
  // union 0 (both empty after rasterization) ⇒ identical. golden perimeter 0 with
  // a non-empty trace ⇒ nothing to normalize against ⇒ Infinity (a hard fail the
  // harness surfaces, never a NaN).
  const iou = unionCount === 0 ? 1 : interCount / unionCount;
  const band = goldenPerimeter === 0 ? (symdiffArea === 0 ? 0 : Infinity) : symdiffArea / goldenPerimeter;

  return { band, iou, tracedArea, goldenArea, interArea, unionArea, symdiffArea, goldenPerimeter, grid: { nx, ny, hx, hy } };
}

/** Convenience: the primary band metric alone (mask px). */
export function band(traced: Ring[], golden: Ring[]): number {
  return score(traced, golden).band;
}

/** Convenience: intersection-over-union alone (secondary metric). */
export function iou(a: Ring[], b: Ring[]): number {
  return score(a, b).iou;
}
