// web/src/lib/tileGeometry/optimize.ts
//
// Sliver-avoidance / balance origin optimizer (design §3.2, M3 Task 4).
// The objective is deliberately NOT min-cut: minimizing total cut area
// routinely produces one thin sliver on one wall and a wide clean piece on
// the other (a real installer's nightmare — sub-half-tile slivers are hard
// to cut cleanly and look bad at grout lines). Instead this searches a
// finite, edge-aligned candidate set for the origin that (a) eliminates
// sub-½-tile slivers first, then (b) balances the remaining cut widths
// between opposing walls.
//
// Only origin-honoring patterns (grid, brick_50, brick_33, diagonal)
// participate in the search — herringbone/basketweave ignore `origin`
// entirely (tilePatterns/*), so shifting it can't change their cut set.
import { tileConfig, type TileSetup } from "../tileSetup.ts";
import { solveTileLayout } from "../tileSolve.ts";
import type { Classified } from "./classify.ts";

const EDGE_EPS_FT = 1e-3;
const ORIGIN_HONORING: Record<string, true> = { grid: true, brick_50: true, brick_33: true, diagonal: true };

function mod(v: number, p: number): number {
  if (!(p > 0)) return 0;
  const m = v % p;
  return m < 0 ? m + p : m;
}

function dedupe(vals: number[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const v of vals) {
    const key = v.toFixed(9);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// A cut/corner piece whose smaller kept dimension is under half the
// corresponding nominal tile dimension — the "hard to cut, ugly to look
// at" sliver band this optimizer exists to avoid.
function countSlivers(classified: Classified[]): number {
  let n = 0;
  for (const c of classified) {
    if (c.cls !== "cut" && c.cls !== "corner") continue;
    if (!c.cut) continue;
    const wq = c.quad.w * 12;
    const hq = c.quad.h * 12;
    if (
      (c.cut.w_in > 0.1 && c.cut.w_in < 0.5 * wq) ||
      (c.cut.h_in > 0.1 && c.cut.h_in < 0.5 * hq)
    ) {
      n += 1;
    }
  }
  return n;
}

// Opposing-wall cut-width imbalance for one axis: sum the kept cut widths
// of pieces whose nominal footprint touches the low wall vs the high wall,
// and report the absolute difference of those sums.
function axisImbalance(
  classified: Classified[],
  lo: number,
  hi: number,
  axis: "x" | "y",
): number {
  let lowSum = 0;
  let highSum = 0;
  for (const c of classified) {
    if (c.cls !== "cut" && c.cls !== "corner") continue;
    if (!c.cut) continue;
    const q = c.quad;
    if (axis === "x") {
      const halfW = q.w / 2;
      if (Math.abs(q.cx - halfW - lo) < EDGE_EPS_FT) lowSum += c.cut.w_in;
      if (Math.abs(q.cx + halfW - hi) < EDGE_EPS_FT) highSum += c.cut.w_in;
    } else {
      const halfH = q.h / 2;
      if (Math.abs(q.cy - halfH - lo) < EDGE_EPS_FT) lowSum += c.cut.h_in;
      if (Math.abs(q.cy + halfH - hi) < EDGE_EPS_FT) highSum += c.cut.h_in;
    }
  }
  return Math.abs(lowSum - highSum);
}

function ringBoundsXY(ring: readonly [number, number][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// The classic balanced-cut origin: shift the grid so the leftover material
// beyond the last full tile is split evenly between both walls, instead of
// dumped entirely on one side.
function centerOffset(min: number, max: number, pitch: number): number {
  const span = max - min;
  if (!(span > 0) || !(pitch > 0)) return 0;
  const n = Math.ceil(span / pitch - 1e-9);
  const extra = n * pitch - span;
  return mod(min - extra / 2, pitch);
}

export function optimizeOrigin(args: {
  tile_setup: TileSetup;
  ring_ft: [number, number][];
  holes_ft?: [number, number][][];
}): { origin: [number, number]; score: number; slivers: number } {
  const { tile_setup, ring_ft, holes_ft } = args;
  const config = tileConfig(tile_setup);

  const evaluate = (origin: [number, number]) => {
    const { classified } = solveTileLayout({
      tile_setup: { ...tile_setup, origin },
      ring_ft,
      holes_ft,
    });
    const { minX, minY, maxX, maxY } = ringBoundsXY(ring_ft);
    const slivers = countSlivers(classified);
    const balance =
      axisImbalance(classified, minX, maxX, "x") +
      axisImbalance(classified, minY, maxY, "y");
    return { score: slivers * 1000 + balance, slivers };
  };

  if (!ORIGIN_HONORING[config.pattern]) {
    const { score, slivers } = evaluate(tile_setup.origin);
    return { origin: tile_setup.origin, score, slivers };
  }

  const pitchW = (config.w_in + config.joint_in) / 12;
  const pitchH = (config.h_in + config.joint_in) / 12;
  const { minX, minY, maxX, maxY } = ringBoundsXY(ring_ft);

  const xCandidates = dedupe([
    0,
    ...ring_ft.map(([x]) => mod(x, pitchW)),
    centerOffset(minX, maxX, pitchW),
  ]);
  const yCandidates = dedupe([
    0,
    ...ring_ft.map(([, y]) => mod(y, pitchH)),
    centerOffset(minY, maxY, pitchH),
  ]);

  let best: { origin: [number, number]; score: number; slivers: number } | null = null;
  for (const ox of xCandidates) {
    for (const oy of yCandidates) {
      const { score, slivers } = evaluate([ox, oy]);
      if (!best || score < best.score) {
        best = { origin: [ox, oy], score, slivers };
      }
    }
  }
  // xCandidates/yCandidates always include 0, so best is never null.
  return best as { origin: [number, number]; score: number; slivers: number };
}
