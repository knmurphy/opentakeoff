// web/src/lib/tileWallElevation.ts
//
// Wall elevation-strip layout (Task 8, 2026-08-29 wall-tile-slice-a) — pure
// geometry, no React/DOM: `summarizeWallShape`'s per-shape `wallStrips` +
// `folds` -> SVG-ready rect/line data in ELEVATION space (x = u along the
// wall, 0..width_ft; y = height up the wall, 0..height_ft, floor at y=0,
// natural/un-flipped — the caller's SVG does its own V-flip so the floor
// line lands at the bottom of the drawn box). This is NOT plan placement:
// the strip's quad geometry is already in FEET (wallStripRing/
// solveTileLayout both work in feet, never px), so it draws into its own
// small panel box independent of the canvas's upp/pan/zoom.
//
// Reuses tileOverlayPrimitives (tileOverlay.ts) with upp=1 -- a no-op unit
// pass-through -- so the SAME installed-face/joint-inset math the plan
// overlay uses (grout-gap inset, per-class color) runs here without a
// second, parallel conversion to maintain.
//
// RESET mode (M4/ruling 4): `wallStrips` holds N independently-solved
// sub-strips, each in LOCAL u (0..segment length) -- drawing them naively
// would stack every sub-strip's tiles on top of each other at u=0. This
// module lays each sub-strip out LEFT TO RIGHT by an x-offset accumulated
// from the PRECEDING sub-strips' own widths (`bounds.maxX - bounds.minX`).
// Those accumulated offsets land exactly on the WRAP run's fold u_ft
// positions: summarizeWallShape's reset branch splits the run at
// `[0, ...folds.map(u_ft), L_ft]`, so sub-strip i's own width is precisely
// `boundaries[i+1] - boundaries[i]` -- the same arithmetic this module
// repeats independently from each sub-strip's own solved bounds. WRAP
// mode's single-element `wallStrips` degenerates to one pass at offset 0,
// byte-identical to drawing that one strip directly.
//
// CLAMP TO THE SUB-STRIP'S OWN EXTENT: tileOverlayPrimitives draws a `cut`
// cell's FULL nominal footprint (the plan canvas relies on a per-room
// clip-path to trim it visually) -- an edge column's balanced cut tile can
// therefore overshoot a sub-strip's own [0, width] by a fraction of a
// tile. Left unclamped, two adjacent reset sub-strips' edge tiles would
// visually overlap at the shared corner. This is also the PHYSICALLY
// correct behavior, not just a drawing nicety: in reset mode the run
// literally turns a corner there, onto a different wall plane, so a tile
// cannot really span across it. Clamped in LOCAL (pre-offset) feet, then
// shifted by `offset`; a tile that clamps to zero width/height (fully
// outside its own sub-strip, generator over-padding) is dropped.
import { tileOverlayPrimitives } from "./tileOverlay.ts";
import type { TileLayout } from "./tileSolve.ts";
import type { CellClass } from "./tileGeometry/classify.ts";
import type { Fold } from "./tileWall/unwrap.ts";

export type ElevationTile = {
  x: number; y: number; w: number; h: number;
  cls: CellClass; color: string;
};
export type ElevationFold = { x: number; kind: "inside" | "outside" };
export type WallElevationLayout = {
  width_ft: number;
  height_ft: number;
  tiles: ElevationTile[];
  folds: ElevationFold[];
};

const stripWidth = (strip: TileLayout): number =>
  Math.max(0, (strip.bounds?.maxX ?? 0) - (strip.bounds?.minX ?? 0));
const stripHeight = (strip: TileLayout): number =>
  Math.max(0, (strip.bounds?.maxY ?? 0) - (strip.bounds?.minY ?? 0));

// `wallStrips`/`folds` are read verbatim off `selectedWall` (a TilePanel
// prop that is `null` on a floor selection / no wall selected) -- accepts
// null/undefined defensively so a caller need not guard before calling in,
// and always returns a real (possibly empty) layout, never throws.
export function wallElevationLayout(
  wallStrips: TileLayout[] | null | undefined,
  folds: Fold[] | null | undefined,
  skuColor: (skuId: string) => string,
): WallElevationLayout {
  const strips = Array.isArray(wallStrips) ? wallStrips : [];
  const tiles: ElevationTile[] = [];
  let offset = 0;
  let height_ft = 0;
  for (const strip of strips) {
    const stripW = stripWidth(strip);
    const stripH = stripHeight(strip);
    height_ft = Math.max(height_ft, stripH);
    // upp=1: a sub-strip's quad cx/cy/w/h are already in FEET (strip
    // space) -- dividing by 1 is the identity, so this is purely reusing
    // tileOverlayPrimitives' installed-face/class/color math, not a real
    // unit conversion.
    const { tiles: prim } = tileOverlayPrimitives(strip, 1, skuColor);
    for (const t of prim) {
      const x0 = Math.max(0, t.cx - t.w / 2);
      const x1 = Math.min(stripW, t.cx + t.w / 2);
      const y0 = Math.max(0, t.cy - t.h / 2);
      const y1 = Math.min(stripH, t.cy + t.h / 2);
      if (x1 <= x0 || y1 <= y0) continue; // fully outside this sub-strip's own extent
      tiles.push({ x: offset + x0, y: y0, w: x1 - x0, h: y1 - y0, cls: t.cls, color: t.color });
    }
    offset += stripW;
  }
  const foldLines: ElevationFold[] = (Array.isArray(folds) ? folds : [])
    .map((f) => ({ x: f.u_ft, kind: f.kind }));
  return { width_ft: offset, height_ft, tiles, folds: foldLines };
}
