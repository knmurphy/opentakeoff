// Perimeter trim quantities (design §2.E) — an installer's border order isn't
// just a running length: it's LF grouped by trim kind (a bullnose SKU is not a
// cove-base SKU), a piece count from that LF, and a separate corner count that
// LF alone can never carry — an outside (convex) corner piece and an inside
// (reflex) corner piece are different cuts even at the same trim height.
//
// Both read Task 9's EdgeExposure[] rather than re-deriving exposure: this
// module is pure arithmetic over an already-classified boundary, same
// division of labor as totals.js reading shape.computed.

import type { EdgeExposure } from "../tileEdges/expose.ts";

export type TrimTally = {
  exposure: string;
  length_lf: number;
  pieces: number;
  finish_neighbor?: string;
};

export type CornerTally = { outside: number; inside: number };

// A bare fallback for callers with no tile SKU on hand yet; real callers pass
// the tile's long dimension in feet (e.g. a 24in bullnose piece = 2.0).
const DEFAULT_PIECE_LF = 1.0;

/**
 * Group the non-`field` edges by exposure kind and turn each group's summed
 * LF into a piece count. Tallies CONFIRMED edges only unless `includeSuggested`
 * opts a suggested-but-unconfirmed edge in too — an unconfirmed suggestion is
 * not yet a bid line (§3.4 "never auto-committed").
 */
export function trimTallies(
  exposures: EdgeExposure[],
  opts?: { piece_lf?: number; includeSuggested?: boolean },
): TrimTally[] {
  const piece_lf = opts?.piece_lf ?? DEFAULT_PIECE_LF;
  const includeSuggested = opts?.includeSuggested ?? false;

  const groups = new Map<string, { length_lf: number; finish_neighbor?: string; sharedNeighbor: boolean }>();
  for (const e of exposures) {
    if (e.exposure === "field") continue;
    if (!e.confirmed && !(includeSuggested && e.suggested)) continue;

    const group = groups.get(e.exposure);
    if (group === undefined) {
      groups.set(e.exposure, { length_lf: e.length_lf, finish_neighbor: e.finish_neighbor, sharedNeighbor: true });
    } else {
      group.length_lf += e.length_lf;
      if (group.finish_neighbor !== e.finish_neighbor) group.sharedNeighbor = false;
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([exposure, g]) => ({
      exposure,
      length_lf: g.length_lf,
      pieces: Math.ceil(g.length_lf / piece_lf),
      ...(g.sharedNeighbor && g.finish_neighbor !== undefined ? { finish_neighbor: g.finish_neighbor } : {}),
    }));
}

/**
 * Corner EA at each ring vertex where both adjacent edges are trimmed
 * (design §2.E) — convex vertices need an outside-corner piece, reflex
 * vertices (a notch cutting into the room) need an inside-corner piece.
 * Uses the ring's signed area to tell convex from reflex regardless of
 * winding direction.
 *
 * Gates on the SAME confirmed/includeSuggested rule as `trimTallies`: an
 * edge only counts toward a corner unless it's `field`, and only if it's
 * `confirmed` (or `includeSuggested` opts a suggestion in) — a corner EA
 * must never be more committed than the trim LF it sits between (§3.4
 * "never auto-committed").
 */
export function cornerTallies(
  ring_ft: [number, number][],
  exposures: EdgeExposure[],
  opts?: { includeSuggested?: boolean },
): CornerTally {
  const includeSuggested = opts?.includeSuggested ?? false;
  const n = ring_ft.length;
  const trimmed = new Set<number>();
  for (const e of exposures) {
    if (e.exposure !== "field" && (e.confirmed || includeSuggested)) trimmed.add(e.shapeEdgeIndex);
  }

  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring_ft[i];
    const [x2, y2] = ring_ft[(i + 1) % n];
    signedArea += x1 * y2 - x2 * y1;
  }
  const ccw = signedArea > 0;

  let outside = 0;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const prevEdge = (i - 1 + n) % n; // edge (i-1 -> i)
    const nextEdge = i; // edge (i -> i+1)
    if (!trimmed.has(prevEdge) || !trimmed.has(nextEdge)) continue;

    const prev = ring_ft[prevEdge];
    const cur = ring_ft[i];
    const next = ring_ft[(i + 1) % n];
    const inX = cur[0] - prev[0];
    const inY = cur[1] - prev[1];
    const outX = next[0] - cur[0];
    const outY = next[1] - cur[1];
    const cross = inX * outY - inY * outX;
    if (cross === 0) continue; // collinear vertex — not actually a corner

    const isConvex = ccw ? cross > 0 : cross < 0;
    if (isConvex) outside++;
    else inside++;
  }

  return { outside, inside };
}
