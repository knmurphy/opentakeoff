// web/src/lib/tileSolve.ts
//
// The inch→foot solve-bridge (design §3.2, M3 Task 1): the ONE place that
// bridges the two unit systems tile-patterning straddles into the generators.
// `tileConfig()` reports SKU/joint sizes in INCHES; the pattern generators
// (`tilePatterns/*.ts`) place tiles in FEET (the plan's own coordinate
// space, matching `ring_ft`); `classifyLayout` takes the room ring in feet
// but the joint width back in INCHES (it emits kept-cut dimensions in
// inches for the caller). The unit arithmetic itself lives in tileUnits.ts
// (inToFt/ftToIn/degToRad) — the single primitive every tile module shares —
// see plan docs/superpowers/plans/2026-08-26-tile-patterning-m3-m4.md.
import { tileConfig, primaryUsableSku, assignedSkuId, type TileConfig, type TileSetup } from "./tileSetup.ts";
import { getPattern, type Bounds, type TileQuad } from "./tilePatterns/index.ts";
import { classifyLayout, type Classified } from "./tileGeometry/classify.ts";
import { inToFt } from "./tileUnits.ts";

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

  // Generator boundary: inches → feet (tileUnits.inToFt).
  const w_ft = inToFt(config.w_in);
  const h_ft = inToFt(config.h_in);
  const joint_ft = inToFt(config.joint_in);

  const gen = getPattern(config.pattern) ?? getPattern("grid");
  const skuId = primaryUsableSku(tile_setup)?.id ?? tile_setup.skus?.[0]?.id ?? "sku";

  const quads = gen
    ? gen.generate({ bounds, w_ft, h_ft, joint_ft, origin: config.origin, rotation_deg: config.rotation_deg, skuId })
    : [];

  // Per-quad SKU resolution (assignment resolver, design §3.2 M3 Task 5):
  // the generator above always stamps ONE default skuId per quad (it has no
  // notion of a multi-SKU field); assignedSkuId() then overrides that
  // per-quad using the condition's tile_setup.assignment and each quad's own
  // `cell` (slotKey.ts), falling back to that same generator default on any
  // miss. Mutates the freshly-generated quads in place — safe: this runs
  // before the caller's layout cache write, and before classifyLayout below.
  for (const q of quads) q.skuId = assignedSkuId(tile_setup, q.cell);

  // classifyLayout boundary: back to inches (cfg.joint_in), deliberately —
  // it emits kept-cut dimensions in inches for downstream consumers.
  const classified = classifyLayout(quads, ring_ft, holes_ft ?? [], config.joint_in);

  return { config, bounds, quads, classified };
}
