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
  leak?: boolean;              // traced but ballooned past the golden
  refused?: boolean;           // golden probe the engine declined
  confidence?: number;         // engine's own 0–1 confidence for the trace
  correctRefusal?: boolean;    // refusal probe the engine declined
  knownFail?: boolean;         // tracked but not gating
  tags?: string[];
}

export interface Aggregate {
  goldenProbes: number; meanIoU: number; floorIoU: number;
  refusalRate: number; leakRate: number;
  refusalProbes: number; correctRefusalRate: number;
  knownFails: number;
}

/** Classify one golden probe: refused, leaked (IoU < 0.5 with area overshoot), or scored. */
export function scoreGolden(status: string, traced: Point[] | null, golden: Point[]): { iou: number; leak: boolean; refused: boolean } {
  if (status !== "ok" || !traced || traced.length < 3) return { iou: 0, leak: false, refused: true };
  const iou = polyIoU(traced, golden);
  const leak = iou < 0.5 && ringAreaAbs(traced) > ringAreaAbs(golden) * 1.5;
  return { iou, leak, refused: false };
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
