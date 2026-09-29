// web/src/lib/tileCalc/reuse.ts
//
// With-reuse offcut pool (design §3.3, plan M6 Task 6.1): a best-fit-
// decreasing guillotine packer that reuses straight rectangular offcuts to
// satisfy other cuts of the SAME sku before opening a new whole tile.
// Grain-locked (no 90° rotation — a directional tile's grain runs one way)
// and scrap-aware (an offcut whose min dimension falls below the sliver
// threshold is unusable and discarded, not pooled). Pure inches throughout,
// matching `Classified.cut` — no feet, no DOM, no re-classification; this
// reads the already-classified cut set (Invariants) and never re-solves it.
//
// Conservative by construction: full cells, corner cells, and L-shaped
// cuts each consume a whole tile and never donate a reusable offcut (a
// corner/L remnant isn't a clean rectangle). Diagonal/herringbone/
// basketweave cut dims are AABB approximations with ambiguous grain
// (design §3.3 "auto-downgraded for AABB-approximate patterns"), so reuse
// is skipped entirely (`downgraded`) rather than claim a saving it can't
// defend.
import type { Classified } from "../tileGeometry/classify.ts";
import type { TileSku, TilePattern } from "../tileSetup.ts";

export type ReuseMapEntry = { from_in: [number, number]; cuts_in: [number, number][] };

export type ReusePlanResult = {
  wholeTiles: number;
  offcutsUsed: number;
  scrapped: number;
  reuseMap: ReuseMapEntry[];
  downgraded?: string;
};

const DEFAULT_SLIVER_THRESHOLD_IN = 2;
const DEFAULT_KERF_IN = 0.125;
const DIM_EPS_IN = 1e-6;

// Patterns whose `Classified.cut` dims are an axis-aligned bounding-box
// approximation of a rotated/interlocked footprint, not a literal rectangle
// cut — grain direction can't be defended for these (design §3.3).
const AABB_APPROXIMATE_PATTERNS: Record<TilePattern, boolean> = {
  grid: false, brick_50: false, brick_33: false,
  diagonal: true, herringbone: true, basketweave: true,
};

type CutPiece = { w_in: number; h_in: number };

// An offcut in the pool, tracking which opened whole tile it (transitively)
// descends from — so a chain of splits still attributes reuse back to the
// tile that was actually purchased (reuseMap provenance).
type Offcut = { w_in: number; h_in: number; origin: number };

// Same-orientation containment with room for the kerf: a dimension fits
// when the offcut equals the piece exactly (no cut needed, nothing left to
// separate) or when the offcut exceeds the piece by at least one kerf
// width (enough slack to make the guillotine cut that frees the piece).
function fits(offcut: Offcut, piece: CutPiece, kerf_in: number): boolean {
  const fitsDim = (offcut_in: number, piece_in: number): boolean => {
    if (offcut_in < piece_in - DIM_EPS_IN) return false;
    const slack = offcut_in - piece_in;
    return slack <= DIM_EPS_IN || slack >= kerf_in - DIM_EPS_IN;
  };
  return fitsDim(offcut.w_in, piece.w_in) && fitsDim(offcut.h_in, piece.h_in);
}

// Best-fit = smallest-area fitting offcut (least waste left behind); ties
// broken by width, then height, then pool position, so the pick never
// depends on incidental array ordering.
function bestFitIndex(pool: readonly Offcut[], piece: CutPiece, kerf_in: number): number {
  let best = -1;
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    if (!fits(candidate, piece, kerf_in)) continue;
    if (best === -1) { best = i; continue; }
    const kept = pool[best];
    const candidateArea = candidate.w_in * candidate.h_in;
    const keptArea = kept.w_in * kept.h_in;
    const better = candidateArea !== keptArea ? candidateArea < keptArea
      : candidate.w_in !== kept.w_in ? candidate.w_in < kept.w_in
      : candidate.h_in !== kept.h_in ? candidate.h_in < kept.h_in
      : false;
    if (better) best = i;
  }
  return best;
}

// Guillotine-split the offcut around the consumed piece into up to two
// leftover rectangles (design §3.3): a width strip (offcut minus the
// piece's width, full offcut height) and a height strip (the piece's own
// width, offcut minus the piece's height), each minus the kerf the
// separating cut consumes. A dimension that matches the piece exactly
// needed no cut, so it leaves no strip in that direction.
function guillotineSplit(offcut: Offcut, piece: CutPiece, kerf_in: number): Offcut[] {
  const leftovers: Offcut[] = [];
  if (offcut.w_in - piece.w_in > DIM_EPS_IN) {
    leftovers.push({ w_in: offcut.w_in - piece.w_in - kerf_in, h_in: offcut.h_in, origin: offcut.origin });
  }
  if (offcut.h_in - piece.h_in > DIM_EPS_IN) {
    leftovers.push({ w_in: piece.w_in, h_in: offcut.h_in - piece.h_in - kerf_in, origin: offcut.origin });
  }
  return leftovers;
}

// Descending by area; explicit tie-break (width, then height, then the
// piece's original position) so pack order never depends on the input
// array's incidental ordering.
function byAreaDescending(a: { piece: CutPiece; index: number }, b: { piece: CutPiece; index: number }): number {
  const areaA = a.piece.w_in * a.piece.h_in;
  const areaB = b.piece.w_in * b.piece.h_in;
  if (areaA !== areaB) return areaB - areaA;
  if (a.piece.w_in !== b.piece.w_in) return b.piece.w_in - a.piece.w_in;
  if (a.piece.h_in !== b.piece.h_in) return b.piece.h_in - a.piece.h_in;
  return a.index - b.index;
}

export function reusePlan(args: {
  classified: Classified[];
  sku: TileSku;
  pattern: TilePattern;
  sliver_threshold_in?: number;
  kerf_in?: number;
}): ReusePlanResult {
  const { classified, sku, pattern } = args;
  const sliver_threshold_in = args.sliver_threshold_in ?? DEFAULT_SLIVER_THRESHOLD_IN;
  const kerf_in = args.kerf_in ?? DEFAULT_KERF_IN;

  // Step 1: bucket cells. `full` and `corner` cells, and any L-shaped
  // `cut` cell, each consume a whole tile and never donate an offcut.
  // Straight rectangular `cut` cells go into the packing pass below.
  let conservativeWholeTiles = 0;
  const straightCuts: CutPiece[] = [];
  for (const c of classified) {
    if (c.cls === "full" || c.cls === "corner") {
      conservativeWholeTiles += 1;
    } else if (c.cls === "cut" && c.cut) {
      if (c.cut.lShaped) conservativeWholeTiles += 1;
      else straightCuts.push({ w_in: c.cut.w_in, h_in: c.cut.h_in });
    }
  }

  if (AABB_APPROXIMATE_PATTERNS[pattern]) {
    return {
      wholeTiles: conservativeWholeTiles + straightCuts.length,
      offcutsUsed: 0,
      scrapped: 0,
      reuseMap: [],
      downgraded: `${pattern}: cut dims are an AABB approximation, grain direction is ambiguous`,
    };
  }

  const ordered = straightCuts
    .map((piece, index) => ({ piece, index }))
    .sort(byAreaDescending)
    .map((entry) => entry.piece);

  const pool: Offcut[] = [];
  // Indexed by whole-tile-open order; populated lazily, only for a tile
  // that later donates at least one offcut to another cut (reuseMap is
  // reuse provenance for the cut sheet, not a log of every opened tile).
  const donations: (ReuseMapEntry | undefined)[] = [];
  let wholeTilesForCuts = 0;
  let offcutsUsed = 0;
  let scrapped = 0;

  const poolOrScrap = (leftovers: readonly Offcut[]): void => {
    for (const leftover of leftovers) {
      if (Math.min(leftover.w_in, leftover.h_in) + DIM_EPS_IN >= sliver_threshold_in) pool.push(leftover);
      else scrapped += 1;
    }
  };

  for (const piece of ordered) {
    const fitIdx = bestFitIndex(pool, piece, kerf_in);
    if (fitIdx >= 0) {
      const [offcut] = pool.splice(fitIdx, 1);
      offcutsUsed += 1;
      const from_in: [number, number] = [sku.w_in, sku.h_in];
      const entry = donations[offcut.origin] ?? { from_in, cuts_in: [] };
      entry.cuts_in.push([piece.w_in, piece.h_in]);
      donations[offcut.origin] = entry;
      poolOrScrap(guillotineSplit(offcut, piece, kerf_in));
    } else {
      const origin = donations.length;
      donations.push(undefined); // reserve this tile's slot; filled only if it later donates
      wholeTilesForCuts += 1;
      poolOrScrap(guillotineSplit({ w_in: sku.w_in, h_in: sku.h_in, origin }, piece, kerf_in));
    }
  }

  const reuseMap = donations.filter((entry): entry is ReuseMapEntry => entry !== undefined);
  return {
    wholeTiles: conservativeWholeTiles + wholeTilesForCuts,
    offcutsUsed,
    scrapped,
    reuseMap,
  };
}
