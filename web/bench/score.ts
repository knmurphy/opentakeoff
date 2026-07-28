// Benchmark scoring — pure (no DOM, no pdf.js), node-testable.
//
// The upstream RFC's ground rule: engine claims are opinions without corpus
// numbers. Every probe traces a region and is scored against a GOLDEN polygon
// by rasterized IoU; the aggregate reports the RFC's four headline metrics —
// mean IoU, floor IoU, refusal rate, leak rate — plus correct-refusal rate
// for probes whose golden answer is "refuse".
import { pointInPoly } from "../src/lib/geometry.js";
import type { Point } from "../src/lib/oneclick";

/** Rasterized IoU of two polygons (cell centers on the union bbox, 1 px grid).
 *  Exact enough for room-scale rings; dependency-free and orientation-proof. */
export function polyIoU(a: Point[], b: Point[], cell = 1): number {
  if (a.length < 3 || b.length < 3) return 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [...a, ...b]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let inter = 0, union = 0;
  for (let y = y0 + cell / 2; y <= y1; y += cell) {
    for (let x = x0 + cell / 2; x <= x1; x += cell) {
      const inA = pointInPoly(x, y, a), inB = pointInPoly(x, y, b);
      if (inA && inB) inter++;
      if (inA || inB) union++;
    }
  }
  return union ? inter / union : 0;
}

export function ringAreaAbs(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export interface ProbeScore {
  caseName: string;
  probeName: string;
  expect: "golden" | "refusal";
  status: string;              // engine status ("ok" / "leak" / "tiny" / "boundary")
  iou?: number;                // golden probes that traced
  sfErr?: number;              // |engine area − golden area| / golden area — what a bid actually buys
  leak?: boolean;              // traced but ballooned past the golden
  refused?: boolean;           // golden probe the engine declined
  confidence?: number;         // engine's own 0–1 confidence for the trace
  correctRefusal?: boolean;    // refusal probe the engine declined
  knownFail?: boolean;         // tracked but not gating
  tags?: string[];
}

/** Area (px²) of the overlap between two rings — sampled only over the
 *  intersection of their bounding boxes, so disjoint rooms cost nothing.
 *  Used for the per-case tiling check: two probes' engine regions claiming
 *  the same floor is double-counted square footage. */
export function polyOverlapPx2(a: Point[], b: Point[], cell = 1): number {
  if (a.length < 3 || b.length < 3) return 0;
  let ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
  for (const [x, y] of a) { ax0 = Math.min(ax0, x); ax1 = Math.max(ax1, x); ay0 = Math.min(ay0, y); ay1 = Math.max(ay1, y); }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of b) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1), y0 = Math.max(ay0, by0), y1 = Math.min(ay1, by1);
  if (x0 >= x1 || y0 >= y1) return 0;
  let inter = 0;
  for (let y = y0 + cell / 2; y <= y1; y += cell) {
    for (let x = x0 + cell / 2; x <= x1; x += cell) {
      if (pointInPoly(x, y, a) && pointInPoly(x, y, b)) inter++;
    }
  }
  return inter * cell * cell;
}

export interface CaseCoverage {
  caseName: string;
  probes: number;              // golden probes contributing
  sumGoldenSF: number;         // Σ golden areas (the answer key's total floor)
  sumEngineSF: number;         // Σ engine areas
  ratio: number;               // sumEngine / sumGolden — missed or phantom floor shows here
  overlapSF: number;           // Σ pairwise engine-region overlap — double-counted floor
  maxSfErr: number;            // worst per-probe SF error
  humanMeasured: boolean;      // hard gates apply only where truth is human-authored
}

/** Whole-case accounting from golden probes' rings: per-room SF error alone
 *  can't see floor that NO probe covers or floor counted twice — the case's
 *  totals and pairwise overlaps can. pxPerFt converts ring px² to SF;
 *  deductsSF (columns, casework the human deducted) reduces the golden total. */
export function caseCoverage(caseName: string, rows: Array<{ golden: Point[]; ring: Point[] | null }>, pxPerFt: number, humanMeasured: boolean, deductsSF = 0, cell = 2): CaseCoverage {
  const sf = (px2: number) => px2 / (pxPerFt * pxPerFt);
  let sumG = 0, sumE = 0, maxErr = 0;
  const rings: Point[][] = [];
  for (const r of rows) {
    const g = sf(ringAreaAbs(r.golden));
    sumG += g;
    if (r.ring && r.ring.length >= 3) {
      const e = sf(ringAreaAbs(r.ring));
      sumE += e;
      rings.push(r.ring);
      if (g > 0) maxErr = Math.max(maxErr, Math.abs(e - g) / g);
    } else {
      maxErr = Math.max(maxErr, 1);        // refused probe: 100% of that room missing
    }
  }
  let overlapPx2 = 0;
  for (let i = 0; i < rings.length; i++)
    for (let j = i + 1; j < rings.length; j++) overlapPx2 += polyOverlapPx2(rings[i], rings[j], cell);
  const g = Math.max(0, sumG - deductsSF);
  return {
    caseName,
    probes: rows.length,
    sumGoldenSF: g,
    sumEngineSF: sumE,
    ratio: g > 0 ? sumE / g : 1,
    overlapSF: sf(overlapPx2),
    maxSfErr: maxErr,
    humanMeasured,
  };
}

export interface Aggregate {
  goldenProbes: number; meanIoU: number; floorIoU: number;
  refusalRate: number; leakRate: number;
  refusalProbes: number; correctRefusalRate: number;
  knownFails: number;
}

/** Classify one golden probe: refused, leaked (IoU < 0.5 with area overshoot), or scored. */
export function scoreGolden(status: string, traced: Point[] | null, golden: Point[]): { iou: number; sfErr?: number; leak: boolean; refused: boolean } {
  if (status !== "ok" || !traced || traced.length < 3) return { iou: 0, leak: false, refused: true };
  const iou = polyIoU(traced, golden);
  const ag = ringAreaAbs(golden);
  const sfErr = ag > 0 ? Math.abs(ringAreaAbs(traced) - ag) / ag : undefined;
  const leak = iou < 0.5 && ringAreaAbs(traced) > ag * 1.5;
  return { iou, sfErr, leak, refused: false };
}

// ── cross-resolution agreement (RFC failure mode #3) ────────────────────────
// The same click must mean the same thing at every mask resolution: a room the
// engine traces at the production cap but refuses (or traces differently) on a
// half-resolution mask is resolution-dependent behavior, not measurement. Each
// probe runs at several ws factors; agreement is two-part — every resolution
// reaches the same VERDICT (traced vs refused), and the rings traced agree
// pairwise by IoU (rings are in image px, so they compare directly).

export interface CrossRun { res: number; status: string; ring: Point[] | null; }
export interface CrossScore {
  caseName: string;
  probeName: string;
  expect: "golden" | "refusal";
  resolutions: number[];       // ws factors probed (1 = production cap)
  statuses: string[];          // engine status per resolution
  statusAgree: boolean;        // same verdict at every GATING resolution
  minPairIoU?: number;         // worst pairwise ring agreement (≥2 traced, gating res only)
  iouByRes?: number[];         // per-resolution IoU vs the golden (diagnostic, all res)
  subFloorRes?: number[];      // resolutions below the engine's determinism floor — tracked, non-gating
  ungated?: boolean;           // FEWER THAN TWO resolutions at/above the floor: this case is
                               // NOT cross-checked at all — the honest statement, never a
                               // self-comparison dressed up as agreement (review round 8)
  knownFail?: boolean;
  tags?: string[];
}

export function crossAgreement(runs: CrossRun[], cell = 1): { statuses: string[]; statusAgree: boolean; minPairIoU?: number } {
  const statuses = runs.map((r) => r.status);
  // agreement = same VERDICT everywhere (all traced or all refused) — whether
  // that verdict is CORRECT is the baseline gate's job, not this one's
  const traced = runs.filter((r) => r.status === "ok" && r.ring && r.ring.length >= 3);
  const statusAgree = traced.length === runs.length || runs.every((r) => r.status !== "ok");
  let minPairIoU: number | undefined;
  for (let i = 0; i < traced.length; i++)
    for (let j = i + 1; j < traced.length; j++) {
      const iou = polyIoU(traced[i].ring!, traced[j].ring!, cell);
      if (minPairIoU === undefined || iou < minPairIoU) minPairIoU = iou;
    }
  return { statuses, statusAgree, minPairIoU };
}

export interface CrossAggregate {
  crossProbes: number;         // gating probes compared across resolutions
  disagreements: number;       // gating probes whose verdict flips with resolution
  crossFloorIoU: number;       // worst pairwise ring agreement among gating golden probes
  crossMeanIoU: number;
  ungated: number;             // probes with <2 gated resolutions — NOT cross-checked
  knownFails: number;
}

export function aggregateCross(scores: CrossScore[]): CrossAggregate {
  const gating = scores.filter((s) => !s.knownFail && !s.ungated);
  const ious = gating.filter((s) => s.minPairIoU !== undefined).map((s) => s.minPairIoU!);
  return {
    crossProbes: gating.length,
    disagreements: gating.filter((s) => !s.statusAgree).length,
    crossFloorIoU: ious.length ? Math.min(...ious) : 1,
    crossMeanIoU: ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 1,
    ungated: scores.filter((s) => s.ungated).length,
    knownFails: scores.filter((s) => s.knownFail).length,
  };
}

export function aggregate(scores: ProbeScore[]): Aggregate {
  const gating = scores.filter((s) => !s.knownFail);
  const golden = gating.filter((s) => s.expect === "golden");
  const refuse = gating.filter((s) => s.expect === "refusal");
  const traced = golden.filter((s) => !s.refused);
  const ious = traced.map((s) => s.iou ?? 0);
  return {
    goldenProbes: golden.length,
    meanIoU: ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0,
    floorIoU: ious.length ? Math.min(...ious) : 0,
    refusalRate: golden.length ? golden.filter((s) => s.refused).length / golden.length : 0,
    leakRate: golden.length ? golden.filter((s) => s.leak).length / golden.length : 0,
    refusalProbes: refuse.length,
    correctRefusalRate: refuse.length ? refuse.filter((s) => s.correctRefusal).length / refuse.length : 1,
    knownFails: scores.filter((s) => s.knownFail).length,
  };
}
