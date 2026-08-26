// web/src/lib/tileSolve.ts
//
// The inch↔foot solve-bridge (design §3.2, M3 Task 1): the ONE place that
// converts between the two unit systems tile-patterning straddles.
// `tileConfig()` reports SKU/joint sizes in INCHES; the pattern generators
// (`tilePatterns/*.ts`) place tiles in FEET (the plan's own coordinate
// space, matching `ring_ft`); `classifyLayout` takes the room ring in feet
// but the joint width back in INCHES (it emits kept-cut dimensions in
// inches for the caller). No other module may re-derive this conversion —
// see plan docs/superpowers/plans/2026-08-26-tile-patterning-m3-m4.md.
import { tileConfig, type TileConfig, type TileSetup } from "./tileSetup.ts";
import { getPattern, type Bounds, type TileQuad } from "./tilePatterns/index.ts";
import { classifyLayout, type Classified } from "./tileGeometry/classify.ts";

export type TileLayout = {
  config: TileConfig;
  bounds: Bounds;
  quads: TileQuad[];
  classified: Classified[];
};

function ringBounds(ring: readonly [number, number][]): Bounds | null {
  if (ring.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function solveTileLayout(args: {
  tile_setup: TileSetup;
  ring_ft: [number, number][];
  holes_ft?: [number, number][][];
}): TileLayout {
  const { tile_setup, ring_ft, holes_ft } = args;
  const config = tileConfig(tile_setup);
  const bounds = ringBounds(ring_ft);
  if (!bounds) {
    return { config, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, quads: [], classified: [] };
  }

  // Generator boundary: inches → feet.
  const w = config.w_in / 12;
  const h = config.h_in / 12;
  const joint = config.joint_in / 12;

  const gen = getPattern(config.pattern) ?? getPattern("grid");
  const skus = Array.isArray(tile_setup.skus) ? tile_setup.skus : [];
  const skuId =
    skus.find((s) => s && Number(s.w_in) > 0 && Number(s.h_in) > 0)?.id ??
    skus[0]?.id ??
    "sku";

  const quads = gen
    ? gen.generate({ bounds, w, h, joint, origin: config.origin, rotation_deg: config.rotation_deg, skuId })
    : [];

  // classifyLayout boundary: back to inches (cfg.joint_in), deliberately —
  // it emits kept-cut dimensions in inches for downstream consumers.
  const classified = classifyLayout(quads, ring_ft, holes_ft ?? [], config.joint_in);

  return { config, bounds, quads, classified };
}
