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

import { tileConfig, type TileSetup, type TileSku, type WallShapeFields } from "./tileSetup.js";
import type { EdgeExposureKind } from "./tileEdges/expose.js";

// Per-room layout override state stored on a shape (design §4.1). Only the
// fields that change SOLVED GEOMETRY are hashed here.
export type TileLayoutOverride = {
  origin?: [number, number];
  rotation?: number;
  edge_overrides?: Record<number, { exposure: EdgeExposureKind; confirmed: boolean }>;
  band?: { sku_id: string; width_ft: number; offset_ft: number };
};

export type TileLayoutShape = WallShapeFields & {
  verts_norm: [number, number][];
  verts_norm_holes?: [number, number][][];
  tile_layout?: TileLayoutOverride;
  // Wall shapes only (measure_role === "surface_area"); a floor_area shape
  // never carries these. height_ft/height_override mirror shapeMetrics.js's
  // resolved-height fields, but tileLayoutSig doesn't resolve height itself
  // (it can't see the condition) — see the `resolvedHeight_ft` param below.
  measure_role?: string;
  height_ft?: number;
  height_override?: boolean;
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
 *     active sku, joint_in, origin, rotation_deg), plus `edge_strategy`,
 *     every sku's own `w_in`/`h_in`, and `assignment` (mode/unit + sorted
 *     slots) — a slot edit changes which sku each quad resolves to
 *     (`assignedSkuId`, run inside `solveTileLayout`), so it must flip this
 *     sig. Sku `color` (and a sku's position in the array) stays out: a
 *     recolor doesn't change the solved layout, and its repaint is handled
 *     elsewhere via the `conditions` dependency, not this sig.
 *   - `shape.tile_layout`'s geometry-affecting overrides: `origin`,
 *     `rotation`, `edge_overrides`, `band`
 *   - wall-only inputs (a floor_area shape never carries these, so they're
 *     absent/null and don't perturb a floor's sig): `resolvedHeight_ft` (the
 *     3rd param — tileLayoutSig can't see `cond.height_ft` from `tile_setup`
 *     alone, so the caller resolves override -> shape.height_ft ->
 *     cond.height_ft and threads the result in), `shape.height_override`,
 *     `shape.measure_role`, `shape.face_side`/`endpoint_exposed`/
 *     `wall_corner_overrides`, and `tile_setup.wall_corner_mode`/
 *     `wall_edge_finish`.
 *
 * Same inputs always produce the same string; any of the above changing
 * flips it. Not a cryptographic hash — a normalized JSON tuple is sufficient
 * for an in-memory memo key.
 */
export function tileLayoutSig(shape: TileLayoutShape, tile_setup: TileSetup, resolvedHeight_ft?: number): string {
  const cfg = tileConfig(tile_setup);
  const skuSizes = (tile_setup.skus || []).map((s: TileSku) => [round(s.w_in), round(s.h_in)]);
  const tl = shape.tile_layout;
  const edgeOverrides = tl?.edge_overrides
    ? Object.keys(tl.edge_overrides)
        .map(Number)
        .sort((a, b) => a - b)
        .map((i) => [i, tl.edge_overrides![i].exposure, tl.edge_overrides![i].confirmed])
    : null;
  const cornerOverrides = shape.wall_corner_overrides
    ? Object.keys(shape.wall_corner_overrides)
        .map(Number)
        .sort((a, b) => a - b)
        .map((i) => [i, shape.wall_corner_overrides![i].mode ?? null, shape.wall_corner_overrides![i].finish ?? null])
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
      assignment: tile_setup.assignment
        ? {
            mode: tile_setup.assignment.mode,
            unit: tile_setup.assignment.unit,
            // sort slot entries for order-independence — mirrors the edge_overrides sort above
            slots: Object.entries(tile_setup.assignment.slots || {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
          }
        : null,
      wall_corner_mode: tile_setup.wall_corner_mode ?? null,
      wall_edge_finish: tile_setup.wall_edge_finish ?? null,
    },
    tile_layout: {
      origin: tl?.origin ? roundPt(tl.origin) : null,
      rotation: tl?.rotation !== undefined ? round(tl.rotation) : null,
      edge_overrides: edgeOverrides,
      band: tl?.band
        ? { sku_id: tl.band.sku_id, width_ft: round(tl.band.width_ft), offset_ft: round(tl.band.offset_ft) }
        : null,
    },
    wall: {
      measure_role: shape.measure_role ?? null,
      resolved_height_ft: resolvedHeight_ft !== undefined ? round(resolvedHeight_ft) : null,
      height_override: shape.height_override ?? null,
      face_side: shape.face_side ?? null,
      endpoint_exposed: shape.endpoint_exposed ?? null,
      wall_corner_overrides: cornerOverrides,
    },
  };
  return JSON.stringify(payload);
}
