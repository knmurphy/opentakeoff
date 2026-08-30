// web/src/lib/developedElevation.ts
//
// Task 1 v2 (2026-08-29 wall-tile-slice-c) — the developed-elevation
// layout that supersedes the 2D fold/bend transform (wallWrapped.ts,
// removed by this same task). Research turned up no prior art or drafting
// source that folds a wall run flat in 2D at its true plan angle; the
// standard "developed elevation" (NKBA convention) is a set of SEPARATE
// flat, true-length panels — one per wall, in plan order — laid side by
// side with a small gap and a break-line (+ inside/outside marker) at each
// corner. This module takes `wallElevationLayout`'s single continuous
// flat strip (tileWallElevation.ts: tiles in u/height feet, folds noted as
// x-positions only) and re-slices it into that panel set. No bending, no
// turn angles — just a split + relabel + re-offset.
//
// Task 2 v2 (same slice, review follow-up on Task 1 v2) — CLIP-AND-SPLIT
// replaces the original center-x assignment. WRAP mode's single continuous
// strip has no clamp at interior folds (unlike RESET mode's independently
// solved, per-segment-clamped sub-strips — see tileWallElevation.ts), so a
// tile can straddle a fold u-position. Center-assigning that tile whole to
// one panel produced an out-of-range panel-local x (negative, or past the
// panel's own segWidth) on the OTHER side of the straddle. Clipping each
// tile to EVERY segment's `[B[i], B[i+1]]` u-range instead: a tile fully
// inside one segment survives as a single (unchanged-width) piece there; a
// straddler is cut into per-segment pieces, each appearing on its own
// panel — the physically correct "corner cut" a developed elevation shows
// (the same offcut a tiler would carry around the corner). A resulting
// panel-local x is therefore always within `[0, segWidth_ft]` with
// `x + w <= segWidth_ft` by construction (it's a strict intersection with
// that panel's own u-range). Only the x-axis is clipped — y/h/cls/color
// pass through a kept piece unchanged; a half-tile still reports its
// original `cls` (e.g. "full"), matching the brief's scope (no
// reclassification here). RESET mode's sub-strips are already clamped to
// their own extent before they ever reach this module (no tile crosses a
// segment boundary there), so this is a no-op widening of the assignment
// rule, not a behavior change for reset.
//
// PURE geometry only (Math, no DOM/React/deps): a caller (TilePanel or a
// future SVG/print renderer) draws each panel as its own flat rect strip
// at `xOffset`, exactly like the existing unwrapped strip draws today,
// just repeated per panel with a gap between.
export type DevPanel = {
  index: number;
  label: string;
  xOffset: number;
  segWidth_ft: number;
  tiles: { x: number; y: number; w: number; h: number; cls: string; color: string }[]; // x is PANEL-LOCAL (0..segWidth_ft)
};
export type DevBreak = { x: number; kind: string }; // x in the laid-out (offset) frame, at each interior corner
export type DevelopedLayout = {
  panels: DevPanel[];
  breaks: DevBreak[];
  total_width_ft: number;
  height_ft: number;
};

const DEFAULT_GAP_FT = 0.5;

export function developedElevationLayout(args: {
  tiles: { x: number; y: number; w: number; h: number; cls: string; color: string }[];
  foldsU: number[];
  foldKinds: string[];
  width_ft: number;
  height_ft: number;
  gap_ft?: number;
}): DevelopedLayout {
  const { tiles, foldsU, foldKinds, width_ft, height_ft } = args;
  const gap_ft = args.gap_ft ?? DEFAULT_GAP_FT;

  // Segment boundaries: [0, ...foldsU, width_ft]. foldsU is ascending,
  // interior (per the brief — not re-sorted/de-duped here).
  const boundaries = [0, ...foldsU, width_ft];
  const panelCount = boundaries.length - 1;

  const panels: DevPanel[] = [];
  for (let i = 0; i < panelCount; i++) {
    const b0 = boundaries[i];
    const b1 = boundaries[i + 1];
    const segWidth_ft = b1 - b0;
    const xOffset = b0 + i * gap_ft;
    panels.push({ index: i, label: `Wall ${i + 1}`, xOffset, segWidth_ft, tiles: [] });
  }

  // CLIP-AND-SPLIT (Task 2 v2): intersect each tile's u-range
  // [t.x, t.x+t.w] against EVERY segment's own [b0, b1], keeping only the
  // pieces with positive width. A tile fully inside one segment yields
  // exactly one piece there (unchanged width); a tile straddling a fold
  // yields one piece per segment it overlaps, each already clamped to that
  // segment's own [0, segWidth_ft] once re-keyed panel-local (x - b0) — so
  // "panel-local x always within [0, segWidth_ft], x+w <= segWidth_ft"
  // holds by construction, not by a downstream guard. A post-clip sliver
  // under ~1e-6 ft (float drift at an exact boundary, e.g. reset mode's
  // sub-strips landing exactly on a fold u_ft) is dropped rather than kept
  // as a near-zero-width rect.
  const SLIVER_EPS_FT = 1e-6;
  for (const t of tiles) {
    const t0 = t.x;
    const t1 = t.x + t.w;
    for (let i = 0; i < panelCount; i++) {
      const b0 = boundaries[i];
      const b1 = boundaries[i + 1];
      const x0 = Math.max(t0, b0);
      const x1 = Math.min(t1, b1);
      const w = x1 - x0;
      if (w <= SLIVER_EPS_FT) continue;
      panels[i].tiles.push({ ...t, x: x0 - b0, w });
    }
  }

  // breaks[k] sits at the gap CENTER between panel k and panel k+1: panel
  // k+1's own xOffset minus half a gap (equivalently B[k+1] + k*gap_ft +
  // gap_ft/2 — the same value, since panel k+1's xOffset is
  // B[k+1] + (k+1)*gap_ft).
  const breaks: DevBreak[] = foldsU.map((_, k) => ({
    x: boundaries[k + 1] + k * gap_ft + gap_ft / 2,
    kind: foldKinds[k],
  }));

  const total_width_ft = width_ft + (panelCount - 1) * gap_ft;

  return { panels, breaks, total_width_ft, height_ft };
}

// developedViewBox — Task 2 v2's small pure helper: the SVG viewBox (in the
// SAME units the caller's `layout` is expressed in — feet, or a renderer's
// already-scaled px, either works since this is unit-agnostic) covering
// every panel's tiles (offset into the laid-out frame by `panel.xOffset`),
// every break line, PLUS `margin` on all four sides for label space (the
// same role `PAD` played around the old flat-strip viewBox — "Wall N"
// labels beneath each panel, inside/outside markers above each break).
// A panel contributes its own [xOffset, xOffset+segWidth_ft] extent even
// with zero tiles (an unfigured/degenerate wall segment still needs its
// label+break-line space) — computed via min/max of BOTH endpoints, not an
// ordering assumption, so a pathological negative segWidth_ft (foldsU
// carrying a u past width_ft — a caller bug upstream, not this module's to
// validate) still yields a well-formed box instead of silently shrinking
// past its sibling panels. Always returns a finite, non-negative-size box,
// even for an empty `panels` array — falls back to a zero-width slice at
// x=0 (still margin-padded) rather than +-Infinity.
export function developedViewBox(
  layout: DevelopedLayout,
  margin: number,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = 0; // the floor line, y=0, is always in frame even with no tiles
  let maxY = Math.max(0, layout.height_ft || 0);

  for (const p of layout.panels) {
    const segMin = Math.min(p.xOffset, p.xOffset + p.segWidth_ft);
    const segMax = Math.max(p.xOffset, p.xOffset + p.segWidth_ft);
    if (segMin < minX) minX = segMin;
    if (segMax > maxX) maxX = segMax;
    for (const t of p.tiles) {
      const x0 = p.xOffset + t.x;
      const x1 = x0 + t.w;
      if (x0 < minX) minX = x0;
      if (x1 > maxX) maxX = x1;
      if (t.y < minY) minY = t.y;
      if (t.y + t.h > maxY) maxY = t.y + t.h;
    }
  }
  for (const b of layout.breaks) {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX > maxX) {
    minX = 0;
    maxX = 0;
  }

  return {
    x: minX - margin,
    y: minY - margin,
    width: (maxX - minX) + margin * 2,
    height: (maxY - minY) + margin * 2,
  };
}
