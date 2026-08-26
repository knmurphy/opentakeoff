// Purchase-unit order math: figured Safe count → margin → whole boxes on one
// dye lot. Mirrors the roll-goods purchase seam (rollTakeoff.js) but for
// discrete tile units. Order.ts NEVER re-applies the condition waste_pct —
// the Safe count (tileCalc/tiles.ts) already replaced the pattern heuristic;
// PATTERN_WASTE below is exported for the *display* seam (M8), not
// multiplied into the order here (design §4.1).
import type { TileSku, TilePattern } from "../tileSetup.ts";

export const PATTERN_WASTE: Record<TilePattern, number> = {
  grid: 0.10,
  brick_50: 0.10,
  brick_33: 0.10,
  diagonal: 0.15,
  herringbone: 0.15,
  basketweave: 0.12,
};

// Large-format bump: min dim >= 15in OR max dim >= 24in => more breakage risk
// during handling/cutting (stone/large-format, design §2.D).
export function materialWasteMultiplier(sku: TileSku): number {
  const w = Number(sku.w_in) || 0;
  const h = Number(sku.h_in) || 0;
  const min = Math.min(w, h);
  const max = Math.max(w, h);
  return min >= 15 || max >= 24 ? 1.15 : 1.0;
}

export type TileOrder = {
  figured: number;
  withMargin: number;
  boxes: number;
  perBox: number;
  dyeLots: 1;
};

export function orderTiles(args: {
  safeCount: number;
  sku: TileSku;
  breakage_pct?: number;
  attic_pct?: number;
}): TileOrder {
  const { safeCount, sku, breakage_pct, attic_pct } = args;
  const figured = Math.ceil(safeCount * materialWasteMultiplier(sku));
  const breakage = breakage_pct ?? 0.05;
  const attic = attic_pct ?? 0;
  const withMargin = Math.ceil(figured * (1 + breakage) + figured * attic);
  // A non-positive per_box (0, negative, or a garbage import value) would
  // otherwise ceil to Infinity or a negative box count (MCP edit_condition /
  // import_takeoff both accept untrusted per_box values) — fall back to
  // sold-each (1 per "box") instead of propagating the bad value.
  const perBox = typeof sku.per_box === "number" && sku.per_box > 0 ? sku.per_box : 1;
  const boxes = Math.ceil(withMargin / perBox);
  return { figured, withMargin, boxes, perBox, dyeLots: 1 };
}
