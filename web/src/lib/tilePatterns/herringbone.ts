// web/src/lib/tilePatterns/herringbone.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";

// Herringbone is interlock-derived (design §3.1): it ignores the free
// `origin`/`rotation_deg` and instead grows outward from a single seed
// plank by repeatedly attaching neighbors at the six joints a plank of
// nominal size w (long) x h (short) offers another perpendicular plank:
//   - four "T-joints": the capped end of a perpendicular neighbor butts
//     against one of the two halves of this plank's long edge (top/bottom
//     x left/right half).
//   - two "end joints": one of this plank's own two short ends butts
//     against the middle of a perpendicular neighbor's long edge.
// Each joint is exact (zero gap, zero overlap) only when w === 2*h, which
// is precisely the classic 2:1 herringbone ratio; layoutWarning (index.ts)
// flags any other ratio. The six local offsets below are derived by
// matching plank corners under a +/-45-style edge-to-cap translation and
// were verified numerically (raster coverage, zero gap/zero overlap) for
// the 2:1 case before landing here.
function neighborOffsets(w: number, h: number): [number, number][] {
  const half = h / 2;
  const edge = (w + h) / 2;
  return [
    [half, edge], [-half, edge], [half, -edge], [-half, -edge],
    [edge, -half], [-edge, half],
  ];
}

type Node = { cx: number; cy: number; rot: number };

function normalizeRot(rot: number): number {
  // A rectangle is identical under a 180deg turn; folding to [0, pi) keeps
  // the two true herringbone orientations (0 and pi/2) distinct without
  // the raw BFS rotation (which accumulates unboundedly) leaking through.
  return ((rot % Math.PI) + Math.PI) % Math.PI;
}

function cornersOf(cx: number, cy: number, rot: number, w: number, h: number): [number, number][] {
  const hw = w / 2, hh = h / 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(
    ([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as [number, number],
  );
}

// SAT overlap test for two oriented w x h rectangles.
function rectsOverlap(a: Node, b: Node, w: number, h: number): boolean {
  const ca = cornersOf(a.cx, a.cy, a.rot, w, h);
  const cb = cornersOf(b.cx, b.cy, b.rot, w, h);
  const eps = 1e-7;
  for (const poly of [ca, cb]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = -(y2 - y1), ny = x2 - x1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [x, y] of ca) { const d = x * nx + y * ny; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const [x, y] of cb) { const d = x * nx + y * ny; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}

export const herringboneGenerator: PatternGenerator = {
  name: "herringbone",
  generate({ bounds, w, h, joint, skuId }: GenInput): TileQuad[] {
    const cell = pitchCell(w, h, joint);
    const offsets = neighborOffsets(cell.w, cell.h);
    // one-cell padded, like grid, so edge planks exist for later clipping
    const pad = cell.w + cell.h;
    const loX = bounds.minX - pad, hiX = bounds.maxX + pad;
    const loY = bounds.minY - pad, hiY = bounds.maxY + pad;
    const seed: Node = { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, rot: 0 };

    const key = (n: Node): string => {
      const r = normalizeRot(n.rot);
      return `${Math.round(n.cx * 1e4)},${Math.round(n.cy * 1e4)},${Math.round(r * 1e4)}`;
    };
    const inBounds = (n: Node): boolean => n.cx >= loX && n.cx <= hiX && n.cy >= loY && n.cy <= hiY;

    const placed = new Map<string, Node>();
    placed.set(key(seed), seed);

    // spatial bucket so overlap checks only scan nearby planks
    const bucketSize = Math.max(cell.w, cell.h) * 2;
    const bucketKey = (n: Node): string => `${Math.floor(n.cx / bucketSize)},${Math.floor(n.cy / bucketSize)}`;
    const buckets = new Map<string, Node[]>();
    const addToBucket = (n: Node): void => {
      const k = bucketKey(n);
      const arr = buckets.get(k);
      if (arr) arr.push(n); else buckets.set(k, [n]);
    };
    addToBucket(seed);

    const overlapsExisting = (cand: Node): boolean => {
      const bx = Math.floor(cand.cx / bucketSize), by = Math.floor(cand.cy / bucketSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(`${bx + dx},${by + dy}`);
          if (!arr) continue;
          for (const q of arr) if (rectsOverlap(q, cand, w, h)) return true;
        }
      }
      return false;
    };

    let frontier: Node[] = [seed];
    let guard = 0;
    while (frontier.length > 0 && guard < 5000) {
      guard++;
      const next: Node[] = [];
      for (const p of frontier) {
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        for (const [lx, ly] of offsets) {
          const cand: Node = { cx: p.cx + lx * c - ly * s, cy: p.cy + lx * s + ly * c, rot: p.rot + Math.PI / 2 };
          if (!inBounds(cand)) continue;
          const k = key(cand);
          if (placed.has(k)) continue;
          if (overlapsExisting(cand)) continue;
          placed.set(k, cand);
          addToBucket(cand);
          next.push(cand);
        }
      }
      frontier = next;
    }

    const out: TileQuad[] = [...placed.values()].map((n) => ({
      cx: n.cx, cy: n.cy, w, h, rot: normalizeRot(n.rot), skuId,
    }));
    out.sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.rot - b.rot);
    return out;
  },
};
