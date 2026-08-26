// Tile-patterning opt-in on a condition (#tile). Mirrors the roll-goods
// opt-in (lib/rollTakeoff.js): presence of a usable tile_setup === opted in.
// A condition is trade-agnostic; tile is an object ON the condition, not a
// type. Runtime guard, no load-time sanitizer — corrupt payloads read as
// opted OUT (the hasRollSetup posture).

export type TileSku = {
  id: string; name: string; w_in: number; h_in: number;
  color: string; image?: string; glossiness?: number;
  thickness_in?: number; per_box?: number;
};
export type TileJoint = { width_in: number };
export type TilePattern =
  "grid" | "brick_50" | "brick_33" | "diagonal" | "herringbone" | "basketweave";
export type TileSetup = {
  pattern: TilePattern;
  origin: [number, number];   // FEET, plan space (kept unsuffixed — persisted + in the MCP snapshot config)
  rotation_deg: number;       // DEGREES
  edge_strategy: "balanced" | "start_full";
  // The field is tiled in the FIRST usable SKU (primaryUsableSku); any
  // further entries are band accents (tileTakeoff.summarizeShape resolves a
  // band's own SKU by id). The solve never mixes two SKUs in one field.
  skus: TileSku[];
  joint: TileJoint;
  purchase?: {
    breakage_pct?: number;
    attic_pct?: number;
    reuse?: { enabled: boolean; sliver_threshold_in?: number; kerf_in?: number };
  };
};

const usableSku = (s: unknown): boolean => {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  return "w_in" in s && "h_in" in s && Number(s.w_in) > 0 && Number(s.h_in) > 0;
};

// The condition's FIELD sku — the first usable SKU (positive w×h), or
// undefined when none is. The SOLE usable-SKU resolver: tileConfig, the
// solve's skuId, and the takeoff's order/grout/band all route through it so
// they can never disagree about which SKU the field is tiled in.
export function primaryUsableSku(setup: TileSetup): TileSku | undefined {
  return (setup.skus || []).find(usableSku);
}

// A condition is tile iff it carries a tile_setup with at least one usable SKU.
export function hasTileSetup(c: unknown): boolean {
  if (!c || typeof c !== "object" || !("tile_setup" in c)) return false;
  const ts = c.tile_setup;
  return !!ts && typeof ts === "object" && !Array.isArray(ts) &&
    "skus" in ts && Array.isArray(ts.skus) && ts.skus.some(usableSku);
}

let seq = 0;
const skuId = () => `sku${++seq}`;

export function mintTileSetup(): TileSetup {
  return {
    pattern: "grid",
    origin: [0, 0],
    rotation_deg: 0,
    edge_strategy: "balanced",
    skus: [{ id: skuId(), name: "Tile 1", w_in: 12, h_in: 24, color: "#9333ea" }],
    joint: { width_in: 0.125 },
  };
}

export type TileConfig = {
  // w_in/h_in/joint_in are INCHES; origin is FEET (plan space); rotation_deg
  // is DEGREES. origin stays unsuffixed to match the persisted/snapshot shape.
  w_in: number; h_in: number; joint_in: number;
  pattern: TilePattern; origin: [number, number]; rotation_deg: number;
};

export function tileConfig(ts: TileSetup): TileConfig {
  const s = primaryUsableSku(ts) ?? ts.skus?.[0];
  return {
    w_in: Math.max(0.25, Number(s?.w_in) || 12),
    h_in: Math.max(0.25, Number(s?.h_in) || 12),
    joint_in: Math.max(0, Number(ts.joint?.width_in) || 0),
    pattern: ts.pattern || "grid",
    origin: (Array.isArray(ts.origin) ? ts.origin : [0, 0]) as [number, number],
    rotation_deg: Number(ts.rotation_deg) || 0,
  };
}
