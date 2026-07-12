// Takeoff-markup extractor (issue #127) — pure geometry + legend reconciliation.
//
// Purpose: auto-extract validated ground truth from the team's hand-drawn STACK
// / UniDoc takeoff PDFs — {polygon in device px, area_sf, material, room#} — so
// the batch-detection corpus gets exact room+area truth cheaply.
//
// This module is DOM-free and pdf.js-free: it takes already-decoded path ops,
// fill colors, and text rows, so it is node-testable. The thin driver
// (takeoffExtractDriver.ts) owns pdf.js and feeds this the decoded inputs.
//
// The killer validation (marked "83 King 7th 8th Floors.pdf"): summing each
// fill color's shoelace ring area and dividing by ONE per-sheet scale k
// (≈81 device-px²/SF = 1/8"=1'-0") reproduces the material-schedule legend to
// the decimal — CPT-3 2674.32, CPT-2 1504.86, CPT-1 9173.05, VCT-1 430.50,
// FT-1 72.13. reconcile() recovers k by consensus and assigns colors to
// materials by that reproduction.

import type { Point } from "./oneclick.ts";
export type { Point };

/** One material-schedule row recovered from the legend text. */
export interface LegendRow { material: string; qty: number; unit: "SF" | "LF" | "EA"; }

/** A pdf.js text item (subset we use): the string and its device-space origin. */
export interface TextItem { str: string; transform: number[]; }

/** pdf.js constructPath op codes this module consumes. Passed in (not imported)
 *  so the module never depends on pdf.js — the driver hands over pdfjsLib.OPS. */
export interface PathOps {
  moveTo: number; lineTo: number;
  curveTo: number; curveTo2: number; curveTo3: number;
  closePath: number; rectangle: number;
}

// ── 1. ring reconstruction ─────────────────────────────────────────────────
// A constructPath carries a flat op stream + a flat coordinate array. Each
// `moveTo` opens a NEW ring; `rectangle` is its own self-contained ring. The
// cardinal rule (the prior spike's over-merge bug): a moveTo must SPLIT — two
// touching sub-paths are two rings, never concatenated into one, or the shared
// edge fuses and the shoelace area inflates.
export function reconstructRings(ops: number[], coords: number[], P: PathOps): Point[][] {
  const rings: Point[][] = [];
  let ring: Point[] = [];
  let c = 0;
  const flush = () => { if (ring.length >= 3) rings.push(ring); ring = []; };
  for (const op of ops) {
    if (op === P.moveTo) { flush(); ring = [[coords[c], coords[c + 1]]]; c += 2; }
    else if (op === P.lineTo) { ring.push([coords[c], coords[c + 1]]); c += 2; }
    else if (op === P.curveTo) { ring.push([coords[c + 4], coords[c + 5]]); c += 6; }
    else if (op === P.curveTo2 || op === P.curveTo3) { ring.push([coords[c + 2], coords[c + 3]]); c += 4; }
    else if (op === P.closePath) { /* ring stays open in the array; shoelace closes it */ }
    else if (op === P.rectangle) {
      flush();
      const x = coords[c], y = coords[c + 1], w = coords[c + 2], h = coords[c + 3]; c += 4;
      ring = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      flush();
    }
  }
  flush();
  return rings;
}

// ── 2. legend parsing ──────────────────────────────────────────────────────
// The measurement text is a MATERIAL-SCHEDULE legend, not per-room labels:
// each row is `<CODE> [ product… ]  <qty> <SF|LF|EA>` with the code and the
// quantity as separate text items on the SAME baseline (y). We pair them by
// row. A row is only a material row if a code IS present next to a quantity —
// bare LF/EA totals (bases, corner-guard counts) whose code lives elsewhere
// are skipped, and prose lines never become rows.
//
// Presence of ANY SF/LF quantity is ALSO the marked-file gate: colored fills
// alone are a false positive (an architect phasing plan). A caller treats
// parseLegend(...).length === 0 as "not a marked takeoff".
const MAT_CODE = /\b([A-Z]{2,5}-\d+[A-Z]?)\b/;                 // CPT-3, VCT-1, FT-1
const QTY = /([\d,]+(?:\.\d+)?)\s*(SF|LF|EA)\b/i;              // 2,674.32 SF
const ROW_Y_TOL = 6;                                          // device px — same baseline

export function parseLegend(items: TextItem[]): LegendRow[] {
  // bucket items by baseline y
  const buckets: { y: number; items: TextItem[] }[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    let b = buckets.find((bb) => Math.abs(bb.y - y) <= ROW_Y_TOL);
    if (!b) { b = { y, items: [] }; buckets.push(b); }
    b.items.push(it);
  }
  const rows: LegendRow[] = [];
  for (const b of buckets) {
    const text = b.items.map((it) => it.str).join(" ");
    const q = text.match(QTY);
    if (!q) continue;                                          // no quantity ⇒ not a schedule row
    const code = text.match(MAT_CODE);
    if (!code) continue;                                       // a bare total with no code ⇒ skip
    const qty = parseFloat(q[1].replace(/,/g, ""));
    if (!isFinite(qty)) continue;
    rows.push({ material: code[1], qty, unit: q[2].toUpperCase() as LegendRow["unit"] });
  }
  return rows;
}

// ── 3. legend-checksum reconciliation (consensus-k RANSAC) ──────────────────
// The scale k (device-px² per SF) varies by sheet, so recover it from the data.
// Naively fitting a SEPARATE k per material trivially matches and proves
// nothing (4 params, 4 constraints). Instead recover ONE k and demand every
// material fall out of it: 4+ colors landing on distinct legend SF values to
// two decimals under a single k is 3×+ over-determined — the RANSAC consensus.
//
// Method: every (colorArea / legendSF) is a candidate k. The true k is the
// value where several pairs agree tightly (the recurring cluster). At that k,
// each color is assigned to the legend row it reproduces; matched ⇒ material
// fill, unmatched ⇒ native/phasing/linework noise (this is why a saturation or
// magnitude predicate is unnecessary AND wrong — the largest fill on 83 King is
// native yellow, which reconciles to nothing).
export interface Assignment {
  color: string; material: string;
  extractedSF: number; legendSF: number; residualPct: number; accept: boolean;
}
export type Verdict = "marked" | "unmarked" | "linear" | "ambiguous";
export interface Reconciliation {
  k: number;
  assignments: Assignment[];
  unmatchedColors: string[];
  unmatchedLegend: string[];
  verdict: Verdict;
}

// accept a color↔row pairing only if it reproduces to within this fraction.
// Tight (1%) on purpose: it (a) rejects near-misses like base gray, and (b)
// turns ring-reconstruction bugs (over-merge, mishandled holes) into visible
// reconciliation FLAGS rather than silent area drift.
export const ACCEPT_TOL = 0.01;
const K_CLUSTER_TOL = 0.02;     // ratios within 2% are the same k
const K_MIN = 1;                // ignore degenerate/near-zero ratios

export function reconcile(
  colorAreas: Record<string, number>,
  legend: LegendRow[],
): Reconciliation {
  // area reconciliation only applies to AREA materials (SF). LF/EA rows can't
  // be checked against polygon area.
  const areaRows = legend.filter((r) => r.unit === "SF" && r.qty > 0);
  const colors = Object.keys(colorAreas);

  // 1. candidate ratios (every color × every SF row)
  const cands: number[] = [];
  for (const c of colors) {
    const a = colorAreas[c];
    for (const r of areaRows) { const k = a / r.qty; if (k >= K_MIN) cands.push(k); }
  }

  // 2. consensus k = center of the largest tight cluster of candidate ratios
  const k = consensusK(cands);

  // 3. assign each color to the legend row it best reproduces at k
  const claimed = new Set<string>();
  const assignments: Assignment[] = [];
  // sort colors by area desc so the largest (most reliable) material claims first
  const order = [...colors].sort((x, y) => colorAreas[y] - colorAreas[x]);
  for (const c of order) {
    const extractedSF = k > 0 ? colorAreas[c] / k : 0;
    let best: LegendRow | null = null, bestRes = Infinity;
    for (const r of areaRows) {
      if (claimed.has(r.material)) continue;          // bijection: one row per color
      const res = Math.abs(extractedSF - r.qty) / r.qty;
      if (res < bestRes) { bestRes = res; best = r; }
    }
    if (best && bestRes <= ACCEPT_TOL) {
      claimed.add(best.material);
      assignments.push({ color: c, material: best.material, extractedSF, legendSF: best.qty, residualPct: bestRes * 100, accept: true });
    } else if (best) {
      assignments.push({ color: c, material: best.material, extractedSF, legendSF: best.qty, residualPct: bestRes * 100, accept: false });
    } else {
      // no unclaimed area row left to test against — still a rejected fill, not
      // a silent drop (every input color must appear somewhere in the report).
      assignments.push({ color: c, material: "", extractedSF, legendSF: 0, residualPct: Infinity, accept: false });
    }
  }

  const unmatchedColors = assignments.filter((a) => !a.accept).map((a) => a.color);
  const unmatchedLegend = areaRows.filter((r) => !claimed.has(r.material)).map((r) => r.material);
  const accepted = assignments.filter((a) => a.accept).length;

  // Verdict taxonomy. The ONLY "marked" evidence is over-determination: ≥2
  // colors reproducing distinct legend SF at ONE shared k. A single match is
  // degenerate — k is forced to make its residual 0, which validates nothing —
  // so it never earns "marked". Below that bar, LF/EA legend rows are POSITIVE
  // evidence of a linear/count takeoff (wall protection, corner guards) that has
  // no floor polygons; SF-only-but-underdetermined is "ambiguous" (flag, don't
  // guess); no legend at all is "unmarked" (colored fills alone — VMC phasing).
  const hasLinearRows = legend.some((r) => r.unit === "LF" || r.unit === "EA");
  let verdict: Verdict;
  if (accepted >= 2) verdict = "marked";
  else if (hasLinearRows) verdict = "linear";
  else if (areaRows.length > 0 && accepted === 1) verdict = "ambiguous";  // single SF match can't self-confirm k
  else verdict = "unmarked";

  return { k, assignments, unmatchedColors, unmatchedLegend, verdict };
}

// The recurring cluster: for each candidate ratio, count how many others sit
// within K_CLUSTER_TOL of it; the winner's members average to k. Ties/empties
// fall back to the median (still a reasonable single estimate).
function consensusK(cands: number[]): number {
  if (cands.length === 0) return 0;
  let bestCenter = cands[0], bestCount = -1;
  for (const pivot of cands) {
    const members = cands.filter((v) => Math.abs(v - pivot) / pivot <= K_CLUSTER_TOL);
    if (members.length > bestCount) {
      bestCount = members.length;
      bestCenter = members.reduce((s, v) => s + v, 0) / members.length;
    }
  }
  return bestCenter;
}

// ── 4. per-room association ─────────────────────────────────────────────────
// Per-room area is computed from geometry (the legend is per-material, not
// per-room). We attach a room NUMBER to a polygon when a room-label seed
// (from detectRooms.roomLabelSeeds, in the same device-px frame) falls inside
// the ring. Coverage is scope-partial — only in-bid rooms are marked — so an
// unlabeled ring is normal, not an error; roomNumber stays undefined.
import { pointInPoly } from "./geometry.js";

export interface RoomSeedLike { str: string; seed: [number, number]; }

export function nearestRoomNumber(ring: Point[], seeds: RoomSeedLike[]): string | undefined {
  for (const s of seeds) {
    if (pointInPoly(s.seed[0], s.seed[1], ring)) return s.str;
  }
  return undefined;
}

// ── 5. ground-truth assembly ────────────────────────────────────────────────
// The public entry the driver calls once per sheet with decoded inputs:
//   ringsByColor — every filled ring grouped by its fill color "r,g,b" (device px)
//   legend       — parseLegend(text)
//   seeds        — roomLabelSeeds(text, viewport.transform) (device px, same frame)
// Returns per-ring ground-truth records for the materials that RECONCILE, plus a
// per-sheet reconciliation report (extracted Σ per material vs legend SF).
//
// Recall is PARTIAL by construction: only in-bid rooms are marked, so this is
// confirmed-rooms-and-areas truth, not a complete room list. report.recall says so.
import { ringArea } from "./oneclick.ts";

export interface GroundTruthRow {
  plan: string;
  material: string;
  poly: Point[];           // device px, viewport.transform frame (see mapPolyToScale)
  area_sf: number;         // this RING's area (geometry ÷ k), not the material total
  roomNumber?: string;
}
export interface MaterialCheck {
  material: string; color: string;
  extractedSF: number; legendSF: number; residualPct: number; accept: boolean;
}
export interface SheetReport {
  plan: string;
  k: number;
  verdict: Verdict;
  recall: "partial";       // scope-partial by construction — never implies completeness
  materials: MaterialCheck[];
  unmatchedColors: string[];
  unmatchedLegend: string[];
}
export interface GroundTruth { rows: GroundTruthRow[]; report: SheetReport; }

export function buildGroundTruth(
  plan: string,
  ringsByColor: Record<string, Point[][]>,
  legend: LegendRow[],
  seeds: RoomSeedLike[] = [],
): GroundTruth {
  // Σ area per color drives reconciliation: ABS area PER RING, summed. This
  // reproduces the 83 King legend to the decimal (12 CPT-3 rings → 2674.32).
  // NOTE — do NOT switch to signed-area/winding netting: STACK winds separate
  // positive rooms inconsistently (some CW, some CCW), so signed-sum CANCELS
  // legitimate separate regions (verified: CPT-3 collapses 2674→317). abs-per-
  // ring is correct here because the fills carry no reverse-wound interior
  // holes. If a future sheet genuinely has holes (a column cut out of carpet),
  // the safe fix is point-in-polygon containment (inner ring inside outer ⇒
  // subtract), NOT winding.
  const colorAreas: Record<string, number> = {};
  for (const color of Object.keys(ringsByColor)) {
    colorAreas[color] = ringsByColor[color].reduce((s, ring) => s + ringArea(ring), 0);
  }
  const rec = reconcile(colorAreas, legend);
  const k = rec.k || 1;

  // Emit ground-truth rings ONLY for a "marked" sheet (≥2 over-determined
  // matches). A "linear"/"ambiguous"/"unmarked" verdict yields ZERO rows — the
  // task's hard requirement that DD-GMP (linear) and VMC (unmarked) never emit
  // garbage rings from a lone degenerate match.
  const rows: GroundTruthRow[] = [];
  if (rec.verdict === "marked") for (const a of rec.assignments) {
    if (!a.accept) continue;
    for (const ring of ringsByColor[a.color] || []) {
      rows.push({
        plan,
        material: a.material,
        poly: ring,
        area_sf: ringArea(ring) / k,
        roomNumber: nearestRoomNumber(ring, seeds),
      });
    }
  }

  const materials: MaterialCheck[] = rec.assignments.map((a) => ({
    material: a.material, color: a.color,
    extractedSF: a.extractedSF, legendSF: a.legendSF, residualPct: a.residualPct, accept: a.accept,
  }));

  return {
    rows,
    report: {
      plan, k: rec.k, verdict: rec.verdict, recall: "partial",
      materials, unmatchedColors: rec.unmatchedColors, unmatchedLegend: rec.unmatchedLegend,
    },
  };
}

// Detection works at getViewport({ scale: rs }); this module's polys come from
// getViewport({ scale: 1 }) (PDF points). area_sf is scale-invariant (k lives
// in the same frame the polys do). To hand a poly to detection's device-px
// frame, multiply every coordinate by rs.
export function mapPolyToScale(poly: Point[], rs: number): Point[] {
  return poly.map(([x, y]) => [x * rs, y * rs] as Point);
}
