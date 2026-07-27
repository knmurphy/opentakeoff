// Trace confidence — the upstream RFC's item D: surface the engine's internal
// state per trace as a 0–1 score plus the factors behind it, for UI and
// provenance. Pure and deliberately TRANSPARENT: multiplicative deductions
// from documented signals, no opaque weighting. A score of 1.0 means the
// boundary is the plan's own vector linework, verbatim; every deduction names
// the inference that made the trace less than verbatim.
//
// Signals (all emitted by oneclick.ts today):
//   raster        — traced from scanned pixels, no vector truth        ×0.90
//   hatchFiltered — the fill crossed classified-hatch linework          ×0.95
//   sealedPx      — a gap was sealed; deduct by the VIRTUAL fraction
//                   of the boundary (how much is synthetic seal line):  ×(1 − virtualFrac)
//                   guards cap virtualFrac at 0.25, so this floors ×0.75
//   wedges        — door linework was crossed under grow-but-verify     ×0.97
//
// The deductions compose: a raster-traced, sealed room multiplies both. The
// score is a REVIEW PRIORITIZER, not a probability — 1.0 traces need a
// glance, low scores deserve the estimator's eyes on the flagged edge.
export interface ConfidenceInput {
  raster?: boolean;
  hatchFiltered?: boolean;
  sealedPx?: number;
  virtualFrac?: number;
  wedges?: number;
  wedgeGrowth?: number;
}
export interface Confidence { score: number; factors: string[]; }

export const CONF_RASTER = 0.90;
export const CONF_HATCH = 0.95;
export const CONF_WEDGE = 0.97;
export const SEAL_VIRTUAL_DEFAULT = 0.10;   // sealed result missing its fraction (old data): assume a door's worth

export function traceConfidence(s: ConfidenceInput): Confidence {
  let score = 1;
  const factors: string[] = [];
  if (s.raster) { score *= CONF_RASTER; factors.push("raster-traced"); }
  if (s.hatchFiltered) { score *= CONF_HATCH; factors.push("hatch-filtered"); }
  if (s.sealedPx) {
    const vf = typeof s.virtualFrac === "number" ? Math.min(Math.max(s.virtualFrac, 0), 0.25) : SEAL_VIRTUAL_DEFAULT;
    score *= 1 - vf;
    factors.push(`sealed-opening(${Math.round(vf * 100)}% synthetic boundary)`);
  }
  if (s.wedges) { score *= CONF_WEDGE; factors.push("door-swing-crossed"); }
  return { score: +score.toFixed(2), factors };
}
