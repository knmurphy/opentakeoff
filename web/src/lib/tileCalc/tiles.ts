// web/src/lib/tileCalc/tiles.ts
//
// Full/cut/corner tile counts and the "Safe" purchase quantity (design
// §3.3): a whole tile is bought for every full cell AND for every cut or
// corner cell (one whole tile yields one cut piece — never fractional
// buying), so `safe = full + cut + corner`. `hole`/`out` cells are never
// purchased — they fall outside the room or inside a deducted hole.
import type { Classified } from "../tileGeometry/classify.ts";

export type TileCounts = {
  full: number;
  cut: number;
  corner: number;
  hole: number;
  safe: number;
  keptArea_sf: number;
};

function emptyCounts(): TileCounts {
  return { full: 0, cut: 0, corner: 0, hole: 0, safe: 0, keptArea_sf: 0 };
}

function accumulate(counts: TileCounts, c: Classified): void {
  switch (c.cls) {
    case "full":
      counts.full += 1;
      break;
    case "cut":
      counts.cut += 1;
      break;
    case "corner":
      counts.corner += 1;
      break;
    case "hole":
      counts.hole += 1;
      break;
    case "out":
      break;
  }
  counts.keptArea_sf += c.areaKept_sf;
}

export function tileCounts(classified: Classified[]): TileCounts {
  const counts = classified.reduce((acc, c) => {
    accumulate(acc, c);
    return acc;
  }, emptyCounts());
  counts.safe = counts.full + counts.cut + counts.corner;
  return counts;
}

export function countsBySku(classified: Classified[]): Map<string, TileCounts> {
  const bySku = new Map<string, TileCounts>();
  for (const c of classified) {
    const skuId = c.quad.skuId;
    let counts = bySku.get(skuId);
    if (!counts) {
      counts = emptyCounts();
      bySku.set(skuId, counts);
    }
    accumulate(counts, c);
  }
  for (const counts of bySku.values()) {
    counts.safe = counts.full + counts.cut + counts.corner;
  }
  return bySku;
}
