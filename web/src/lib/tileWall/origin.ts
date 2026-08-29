// web/src/lib/tileWall/origin.ts
//
// Wall origin mode (design task 2, 2026-08-29 wall-tile-slice-a): a wall
// tiles its unwrapped L×H strip (unwrap.ts's `wallStripRing`). Unlike the
// floor's 2D balanced optimizer (tileGeometry/optimize.ts, which searches
// BOTH axes for sliver-avoidance), a wall's vertical (V) origin is PINNED to
// the floor datum — origin[1] is always 0, seating a full course flush
// against the floor and pushing any leftover cut to the TOP course (the
// installer's convention: nobody wants a thin sliver at the baseboard).
// Only the horizontal (U) origin gets the floor's center-and-balance
// treatment. This is deliberately a SEPARATE module from optimize.ts, not a
// parameterized variant of it — the floor code stays untouched.
import type { TileSetup } from "../tileSetup.ts";
import { tileConfig } from "../tileSetup.ts";
import { solveTileLayout } from "../tileSolve.ts";
import { installedFace } from "../tilePitch.ts";

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

// The classic balanced-cut origin (mirrors optimize.ts's centerOffset):
// shift the grid so the leftover material beyond the last full tile is
// split evenly between both ends of the strip, instead of dumped on one
// end. min/max are the strip's U-extent (0/L for wallStripRing).
function centerOffset(min: number, max: number, pitch: number): number {
  const span = max - min;
  if (!(span > 0) || !(pitch > 0)) return 0;
  const n = Math.ceil(span / pitch - 1e-9);
  const extra = n * pitch - span;
  return mod(min - extra / 2, pitch);
}

// U-direction end-cut widths from a classified layout: a cell counts only
// when it's actually cut ALONG U — a cell that's full-width-but-cut-in-height
// (the top course, since V is pinned and any height overflow lands there) is
// a vertical cut, not a U end cut, and must not pollute this axis's balance
// search. classifyLayout (tileGeometry/classify.ts) reports every cut/corner
// cell's kept w_in against the INSTALLED FACE width (nominal minus the
// joint's own inset, tilePitch.ts's installedFace) even on an axis the room
// boundary never actually clipped — that baseline face width is not itself
// evidence of a U cut, so the threshold below compares against faceW_in
// (not the nominal tile width) to isolate a genuine additional trim.
function endCutWidths(
  classified: { cls: string; cut?: { w_in: number } }[],
  faceW_in: number,
): number[] {
  const out: number[] = [];
  for (const c of classified) {
    if (c.cls !== "cut" && c.cls !== "corner") continue;
    if (!c.cut) continue;
    const w = c.cut.w_in;
    if (w > 0.1 && w < faceW_in - 0.05) out.push(w);
  }
  return out;
}

// The wall counterpart of tileGeometry/optimize.ts's effectiveTileSetup:
// the ONE place a wall's effective solve-setup is resolved. Precedence
// mirrors the floor's (design §4.1/§3.7): a pinned tile_layout.origin wins
// outright (an estimator placed it — never re-optimized away); otherwise a
// `balanced` edge_strategy auto-optimizes the U origin only. V is NEVER
// searched or centered — origin[1] is always 0, pinned/override or not.
export function wallEffectiveTileSetup(args: {
  tile_setup: TileSetup;
  strip_ring: [number, number][];
  tile_layout?: { origin?: [number, number]; rotation?: number } | null;
}): TileSetup {
  const { tile_setup, strip_ring, tile_layout } = args;
  const rotation_deg = tile_layout?.rotation ?? tile_setup.rotation_deg;

  const pinned = tile_layout?.origin;
  if (pinned) return { ...tile_setup, origin: [pinned[0], 0], rotation_deg };

  if (tile_setup.edge_strategy !== "balanced") {
    return { ...tile_setup, origin: [tile_setup.origin[0], 0], rotation_deg };
  }

  const cfg = tileConfig(tile_setup);
  const pitchW = (cfg.w_in + cfg.joint_in) / 12; // ft
  // wallStripRing(L,H) always starts at x=0, but this loop tolerates any
  // ring shape (mirrors optimize.ts's own xCandidates), so minX/maxX are
  // read from the ring rather than assumed — a strip whose U-extent doesn't
  // start at 0 must still get a correctly-centered candidate.
  const minX = strip_ring.reduce((m, [x]) => Math.min(m, x), Infinity);
  const maxX = strip_ring.reduce((m, [x]) => Math.max(m, x), -Infinity);

  const uCandidates = dedupe([
    0,
    ...strip_ring.map(([x]) => mod(x, pitchW)),
    centerOffset(minX, maxX, pitchW),
  ]);

  // Objective (center-and-balance, spec §4.4): primary = fewest sub-½-tile
  // end cuts; tie-break = most-balanced end cuts (min |maxCutW − minCutW|).
  // Deliberately NOT min-total-cut-area — that routinely produces one thin
  // sliver on one end and a wide clean piece on the other (mirrors
  // optimize.ts's own rationale for the floor).
  const faceW_in = installedFace(cfg.w_in, cfg.h_in, cfg.joint_in).w;
  let best: { ox: number; slivers: number; imbalance: number } | null = null;
  for (const ox of uCandidates) {
    const { classified } = solveTileLayout({
      tile_setup: { ...tile_setup, origin: [ox, 0] },
      ring_ft: strip_ring,
    });
    const widths = endCutWidths(classified, faceW_in);
    const slivers = widths.filter((w) => w < cfg.w_in / 2).length;
    const imbalance = widths.length ? Math.max(...widths) - Math.min(...widths) : 0;
    if (!best || slivers < best.slivers || (slivers === best.slivers && imbalance < best.imbalance)) {
      best = { ox, slivers, imbalance };
    }
  }
  // uCandidates always includes 0, so best is never null.
  return { ...tile_setup, origin: [best!.ox, 0], rotation_deg };
}
