// Per-edge exposure derivation (design §3.4) — trim/bullnose/cove/threshold,
// SUGGESTED + CONFIRMED, never auto-committed.
//
// Flood-traced rooms don't share edges (transitions.ts's doctrine, restated
// here for a single shape's own boundary): a room's ring runs to the wall
// linework, so "coincident with another finish" is never literally true. The
// only honest signal is PROXIMITY — an edge sitting within a wall's thickness
// of a different finish's ring is a threshold candidate; everything else is
// an exterior-hull edge and gets the trim default. Both are suggestions only;
// an estimator confirms (or overrides) before either counts toward a bid.

import { distToRing } from "../transitions.ts";
import type { Pt } from "../transitions.ts";

export type EdgeExposureKind = "field" | "trim" | "bullnose" | "cove" | "threshold";

export type EdgeExposure = {
  shapeEdgeIndex: number;
  length_lf: number;
  exposure: EdgeExposureKind;
  finish_neighbor?: string;
  suggested: boolean;
  confirmed: boolean;
  user_override?: string;
};

export type EdgeNeighbor = { finish_tag: string; ring_ft: Pt[] };

const EXPOSURE_KINDS: Record<EdgeExposureKind, true> = {
  field: true, trim: true, bullnose: true, cove: true, threshold: true,
};

// A wall is under a foot thick (mirrors transitions.ts's TRANSITION_DEFAULTS
// max_gap_in: 12) — the same "closer than a wall" proximity reused here as
// the honest-signal threshold for a threshold suggestion.
export const DEFAULT_EDGE_PROXIMITY_FT = 1.0;

export function edgeExposures(args: {
  ring_ft: Pt[];
  neighbors?: EdgeNeighbor[];
  overrides?: Record<number, string>;
  proximity_ft?: number;
}): EdgeExposure[] {
  const { ring_ft, neighbors = [], overrides = {}, proximity_ft = DEFAULT_EDGE_PROXIMITY_FT } = args;
  const n = ring_ft.length;
  const edges: EdgeExposure[] = [];

  for (let i = 0; i < n; i++) {
    const a = ring_ft[i];
    const b = ring_ft[(i + 1) % n];
    const length_lf = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const midpoint: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    // Nearest neighbor within the proximity threshold wins the suggestion.
    let finish_neighbor: string | undefined;
    let bestD = Infinity;
    for (const neighbor of neighbors) {
      const d = distToRing(midpoint, neighbor.ring_ft);
      if (d <= proximity_ft && d < bestD) {
        bestD = d;
        finish_neighbor = neighbor.finish_tag;
      }
    }
    const suggestedKind: EdgeExposureKind = finish_neighbor !== undefined ? "threshold" : "trim";

    const rawOverride = overrides[i];
    const override = rawOverride !== undefined && rawOverride in EXPOSURE_KINDS
      ? (rawOverride as EdgeExposureKind)
      : undefined;
    if (override !== undefined) {
      edges.push({
        shapeEdgeIndex: i,
        length_lf,
        exposure: override,
        ...(finish_neighbor !== undefined ? { finish_neighbor } : {}),
        suggested: false,
        confirmed: true,
        user_override: override,
      });
    } else {
      edges.push({
        shapeEdgeIndex: i,
        length_lf,
        exposure: suggestedKind,
        ...(finish_neighbor !== undefined ? { finish_neighbor } : {}),
        suggested: true,
        confirmed: false,
      });
    }
  }

  return edges;
}
