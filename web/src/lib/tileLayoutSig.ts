// Layout-lifecycle persist/reset hash (design §3.7). `shape.tile_layout`
// (a room's origin/rotation/edge/cut-side overrides) PERSISTS across pure
// zoom and RESETS when the room's solved geometry actually changes — this
// is the memo key the canvas compares before trusting a cached
// `solveTileLayout` result for a room.
//
// Deliberately excludes scale/zoom/upp: there is no scale parameter at all,
// so panning/zooming the sheet can never flip this sig (§3.7 "persists
// across pure zoom"). It also excludes `shape.tile_layout.wet_tags` — an M5
// manual annotation nothing downstream consumes yet (the `tileWetArea`
// engine is M11+); it never changes what `solveTileLayout` draws.

import { tileConfig, type TileSetup, type TileSku } from "./tileSetup.js";
import type { EdgeExposureKind } from "./tileEdges/expose.js";

// Per-room layout override state stored on a shape (design §4.1). Only the
// fields that change SOLVED GEOMETRY are hashed here.
export type TileLayoutOverride = {
  origin?: [number, number];
  rotation?: number;
  edge_overrides?: Record<number, { exposure: EdgeExposureKind; confirmed: boolean }>;
  band?: { sku_id: string; width_ft: number; offset_ft: number };
};

export type TileLayoutShape = {
  verts_norm: [number, number][];
  verts_norm_holes?: [number, number][][];
  tile_layout?: TileLayoutOverride;
};

// 5 decimal places on a normalized (0..1) coordinate is sub-millimeter at
// any real sheet size — enough to ignore float drift from repeated
// normalize/denormalize round-trips without masking a genuine vertex edit.
const SIG_PRECISION = 5;

const round = (n: number): number => {
  const f = 10 ** SIG_PRECISION;
  return Math.round((Number(n) || 0) * f) / f;
};

const roundPt = (p: [number, number]): [number, number] => [round(p[0]), round(p[1])];

const roundRing = (ring: [number, number][]): [number, number][] => (ring || []).map(roundPt);

/**
 * Deterministic cache/reset key for a room's SOLVED tile layout (§3.7).
 *
 * Hashes exactly:
 *   - `shape.verts_norm` / `verts_norm_holes`, rounded to `SIG_PRECISION`
 *   - `tile_setup` identity via `tileConfig()` (pattern, w_in/h_in of the
 *     active sku, joint_in, origin, rotation_deg), plus `edge_strategy` and
 *     every sku's own `w_in`/`h_in` (an id/name/color edit does not change
 *     the drawn grid, so those are left out)
 *   - `shape.tile_layout`'s geometry-affecting overrides: `origin`,
 *     `rotation`, `edge_overrides`, `band`
 *
 * Same inputs always produce the same string; any of the above changing
 * flips it. Not a cryptographic hash — a normalized JSON tuple is sufficient
 * for an in-memory memo key.
 */
export function tileLayoutSig(shape: TileLayoutShape, tile_setup: TileSetup): string {
  const cfg = tileConfig(tile_setup);
  const skuSizes = (tile_setup.skus || []).map((s: TileSku) => [round(s.w_in), round(s.h_in)]);
  const tl = shape.tile_layout;
  const edgeOverrides = tl?.edge_overrides
    ? Object.keys(tl.edge_overrides)
        .map(Number)
        .sort((a, b) => a - b)
        .map((i) => [i, tl.edge_overrides![i].exposure, tl.edge_overrides![i].confirmed])
    : null;
  const payload = {
    verts_norm: roundRing(shape.verts_norm),
    verts_norm_holes: (shape.verts_norm_holes || []).map(roundRing),
    tile_setup: {
      pattern: cfg.pattern,
      w_in: round(cfg.w_in),
      h_in: round(cfg.h_in),
      joint_in: round(cfg.joint_in),
      origin: roundPt(cfg.origin),
      rotation_deg: round(cfg.rotation_deg),
      edge_strategy: tile_setup.edge_strategy || "balanced",
      sku_sizes: skuSizes,
    },
    tile_layout: {
      origin: tl?.origin ? roundPt(tl.origin) : null,
      rotation: tl?.rotation !== undefined ? round(tl.rotation) : null,
      edge_overrides: edgeOverrides,
      band: tl?.band
        ? { sku_id: tl.band.sku_id, width_ft: round(tl.band.width_ft), offset_ft: round(tl.band.offset_ft) }
        : null,
    },
  };
  return JSON.stringify(payload);
}
