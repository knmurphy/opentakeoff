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
import type { Classified } from "../tileGeometry/classify.ts";

// Mirrors optimize.ts's own edge epsilon for the "does this cell's nominal
// footprint touch the strip's end" position check below.
const EDGE_EPS_FT = 1e-3;

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

// U-direction end-cut widths from a classified layout, partitioned by which
// END of the strip the piece's NOMINAL footprint overhangs (low-U past
// minX vs high-U past maxX) — adopts optimize.ts's axisImbalance's INTENT
// (optimize.ts:66-89: partition cut widths by end, score
// |lowSum − highSum|) but NOT its exact mechanism. axisImbalance tests
// edge COINCIDENCE (`Math.abs(cx ± halfW − lo/hi) < EDGE_EPS_FT`), which
// looks right but is empirically vacuous for a genuine cut: a cut cell's
// nominal (untrimmed) edge sits past the boundary by EXACTLY the trimmed
// amount (kept = tileW − overhang), so that distance only clears the 1e-3ft
// epsilon when the trim itself is under ~0.012in — i.e. essentially never
// for a real end cut. (Confirmed empirically against both this module's
// own L=17 wall case and the floor's own existing "reduces sub-½ slivers"
// fixture — the floor's `balance` term is likely always 0 too, which its
// test suite doesn't happen to exercise; that's a floor-code question for
// someone else, out of scope here since optimize.ts stays untouched.)
// This instead tests overhang DIRECTION (does the nominal box extend past
// minX on the low side, or past maxX on the high side?), which correctly
// fires for any real cut of any size and reduces to the same "is it near
// the boundary" idea for the degenerate near-zero-cut case.
//
// A cell counts only when it's actually cut ALONG U — a cell that's
// full-width-but-cut-in-height (the top course, since V is pinned and any
// height overflow lands there) is a vertical cut, not a U end cut, and must
// not pollute this axis's balance search. classifyLayout
// (tileGeometry/classify.ts) reports every cut/corner cell's kept w_in
// against the INSTALLED FACE width (nominal minus the joint's own inset,
// tilePitch.ts's installedFace) even on an axis the room boundary never
// actually clipped — that baseline face width is not itself evidence of a U
// cut, so the filter below compares against faceW_in (not the nominal tile
// width) to isolate a genuine additional trim before it's ever attributed
// to an end. (The filter's 0.05in margin is comfortably tighter than the
// overhang epsilon below, so a genuine cut is never missed by one check but
// caught by the other.)
function uEndSums(
  classified: Classified[],
  faceW_in: number,
  minX: number,
  maxX: number,
): { lowSum: number; highSum: number; widths: number[] } {
  let lowSum = 0;
  let highSum = 0;
  const widths: number[] = [];
  for (const c of classified) {
    if (c.cls !== "cut" && c.cls !== "corner") continue;
    if (!c.cut) continue;
    const w = c.cut.w_in;
    if (!(w > 0.1 && w < faceW_in - 0.05)) continue; // not a genuine U cut
    widths.push(w);
    const q = c.quad;
    const halfW = q.w / 2;
    if (q.cx - halfW < minX - EDGE_EPS_FT) lowSum += w;
    if (q.cx + halfW > maxX + EDGE_EPS_FT) highSum += w;
  }
  return { lowSum, highSum, widths };
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
  // end cuts; tie-break = most-balanced opposing-end cuts (min
  // |lowSum − highSum|, see uEndSums above for why this adapts rather than
  // literally mirrors optimize.ts's axisImbalance). Deliberately NOT
  // min-total-cut-area — that routinely produces one thin sliver on one end
  // and a wide clean piece on the other (mirrors optimize.ts's own
  // rationale for the floor).
  const faceW_in = installedFace(cfg.w_in, cfg.h_in, cfg.joint_in).w;
  let best: { ox: number; slivers: number; imbalance: number } | null = null;
  for (const ox of uCandidates) {
    const { classified } = solveTileLayout({
      tile_setup: { ...tile_setup, origin: [ox, 0] },
      ring_ft: strip_ring,
    });
    const { lowSum, highSum, widths } = uEndSums(classified, faceW_in, minX, maxX);
    const slivers = widths.filter((w) => w < cfg.w_in / 2).length;
    const imbalance = Math.abs(lowSum - highSum);
    if (!best || slivers < best.slivers || (slivers === best.slivers && imbalance < best.imbalance)) {
      best = { ox, slivers, imbalance };
    }
  }
  // uCandidates always includes 0, so best is never null.
  return { ...tile_setup, origin: [best!.ox, 0], rotation_deg };
}
