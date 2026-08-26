// web/src/lib/tileOverlay.ts
//
// Solved TileLayout -> render-ready SVG primitives in PANEL px (design
// §4.1/§4.2, M5 Task 3). Pure: no React, no DOM. The canvas owns exact
// fill/opacity tokens per class; this module only reports geometry + the
// class each tile landed in, plus the caller-resolved SKU color.
//
// Coordinate contract: `layout` (from tileSolve.ts) is entirely in FEET —
// the plan's own coordinate space. `upp` is feet-per-panel-px (the same
// factor the canvas already uses everywhere: px = ft / upp). Every emitted
// tile is CENTER-based (cx, cy, w, h, rot) so an SVG `<rect>` can be drawn
// at (cx - w/2, cy - h/2) sized w×h and rotated with
// `transform="rotate(<rot in degrees>, cx, cy)"` (rot here is radians, as
// carried on TileQuad — convert to degrees at the render call site).
//
// The DRAWN cell is the INSTALLED face (tilePitch.installedFace), not the
// nominal quad footprint: that's what makes the grout gap visible between
// tiles, matching the ordered/classified geometry (§3.0).
import { installedFace } from "./tilePitch.ts";
import type { TileConfig } from "./tileSetup.ts";
import type { TileLayout } from "./tileSolve.ts";
import type { CellClass } from "./tileGeometry/classify.ts";
import { TILE_OVERLAY_MIN_CELL_PX } from "./canvasConstants.js";

export { TILE_OVERLAY_MIN_CELL_PX };

export type TileOverlayTile = {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  cls: CellClass;
  color: string;
};

export type TileOverlayResult = {
  tiles: TileOverlayTile[];
  origin: { x: number; y: number };
};

// Layout -> overlay primitives. `skuColor` resolves a TileQuad's skuId to
// its display color; the same color is returned for every class (full,
// cut, corner, hole) — the canvas tints cut/corner/hole by `cls`, this
// module never bakes an opacity/tint into `color`. `out` tiles (outside
// the room, generator padding) are dropped entirely.
export function tileOverlayPrimitives(
  layout: TileLayout,
  upp: number,
  skuColor: (skuId: string) => string,
): TileOverlayResult {
  const joint_ft = layout.config.joint_in / 12;
  const tiles: TileOverlayTile[] = [];
  for (const c of layout.classified) {
    if (c.cls === "out") continue;
    const q = c.quad;
    const face = installedFace(q.w, q.h, joint_ft);
    tiles.push({
      cx: q.cx / upp,
      cy: q.cy / upp,
      w: face.w / upp,
      h: face.h / upp,
      rot: q.rot,
      cls: c.cls,
      color: skuColor(q.skuId),
    });
  }
  const [ox, oy] = layout.config.origin;
  return { tiles, origin: { x: ox / upp, y: oy / upp } };
}

// On-screen px of the smaller installed-cell dimension, at panel px-per-ft
// `upp` and stage `scale`. The #6 hatch<->grid LOD switch reads this.
export function overlayCellPx(config: TileConfig, upp: number, scale: number): number {
  const w = config.w_in / 12;
  const h = config.h_in / 12;
  const j = config.joint_in / 12;
  const face = installedFace(w, h, j);
  return (Math.min(face.w, face.h) / upp) * scale;
}

// Below the legibility floor, the per-tile grid reads as noise — the
// canvas falls back to a coarser hatch fill instead.
export function shouldShowGrid(config: TileConfig, upp: number, scale: number): boolean {
  return overlayCellPx(config, upp, scale) >= TILE_OVERLAY_MIN_CELL_PX;
}
