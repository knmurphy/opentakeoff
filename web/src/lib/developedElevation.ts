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

  // Assign each tile to a panel by its CENTER x, re-keyed PANEL-LOCAL
  // (x - b0) so a panel's own tiles start at 0 regardless of where its
  // segment sat in the original flat strip. Clamp the last boundary index
  // so a tile whose center lands exactly on (or numerically just past)
  // width_ft still lands in the final panel rather than being dropped.
  for (const t of tiles) {
    const cx = t.x + t.w / 2;
    let seg = 0;
    for (let i = 0; i < panelCount; i++) if (cx >= boundaries[i] - 1e-9) seg = i;
    const b0 = boundaries[seg];
    panels[seg].tiles.push({ ...t, x: t.x - b0 });
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
