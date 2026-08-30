// Tile-patterning opt-in on a condition (#tile). Mirrors the roll-goods
// opt-in (lib/rollTakeoff.js): presence of a usable tile_setup === opted in.
// A condition is trade-agnostic; tile is an object ON the condition, not a
// type. Runtime guard, no load-time sanitizer — corrupt payloads read as
// opted OUT (the hasRollSetup posture).
import { slotKey, type TileCell } from "./tilePatterns/slotKey.ts";

export type TileSku = {
  id: string; name: string; w_in: number; h_in: number;
  color: string; image?: string; glossiness?: number;
  thickness_in?: number; per_box?: number;
};
export type TileJoint = { width_in: number };
export type TilePattern =
  "grid" | "brick_50" | "brick_33" | "diagonal" | "herringbone" | "basketweave";
// A repeat-unit SKU map over the field lattice: `unit` is the tile of the
// map in raw cell-index units (matches slotKey.ts's `{i,j}`, floored-mod
// wrapped), `slots` keys by `slotKey({i,j[,p]}, unit)` → a `skus[].id`.
// Absent, or a slot missing/pointing at a dead id, resolves to the field's
// default SKU (assignedSkuId below) — never left dangling.
export type TileAssignment = { mode: "repeat"; unit: { w: number; h: number }; slots: Record<string, string> };
export type TileSetup = {
  pattern: TilePattern;
  origin: [number, number];   // FEET, plan space (kept unsuffixed — persisted + in the MCP snapshot config)
  rotation_deg: number;       // DEGREES
  edge_strategy: "balanced" | "start_full";
  // The field is tiled in the FIRST usable SKU (primaryUsableSku) by
  // default; `assignment`, when present, distributes further usable SKUs
  // across the field per-cell (assignedSkuId below) — any entries beyond
  // what `assignment` claims are still band accents (tileTakeoff.summarizeShape
  // resolves a band's own SKU by id).
  skus: TileSku[];
  joint: TileJoint;
  assignment?: TileAssignment;
  purchase?: {
    breakage_pct?: number;
    attic_pct?: number;
    reuse?: { enabled: boolean; sliver_threshold_in?: number; kerf_in?: number };
  };
  // Wall-run settings (condition-level — applies to every surface_area shape
  // under this condition). Overage reuses purchase.breakage_pct above; there
  // is no separate wall waste field.
  wall_corner_mode?: "wrap" | "reset";
  wall_edge_finish?: "profile" | "bullnose" | "miter";
};

// Shape-level wall fields (design §8). Keyed by RUN-VERTEX index — a
// DIFFERENT index space than tile_layout.edge_overrides (ring-edge index,
// see tileLayoutSig.ts's TileLayoutOverride) — do not conflate the two.
export type WallShapeFields = {
  face_side?: "left" | "right";
  endpoint_exposed?: [boolean, boolean];
  wall_corner_overrides?: Record<number, { mode?: "wrap" | "reset"; finish?: "profile" | "bullnose" | "miter" }>;
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

// The per-quad SKU resolver: a solved quad's `cell` (slotKey.ts's raw
// lattice index) plus the condition's `assignment` decide which SKU tiles
// that ONE quad. This is the sole multi-SKU field resolver — tileSolve.ts
// calls it once per generated quad, right after generate() and before
// classifyLayout, to turn the generator's single default skuId into a
// per-cell one.
//
// The default is the EXACT chain the pre-assignment solve always used
// (tileSolve.ts:55, historically): primaryUsableSku(...)?.id, falling back
// to the raw first entry, falling back to the literal "sku". Every miss —
// no assignment, no cell (rotation/plank generators only stamp `cell` when
// the generator provides one; absence is defensive, not a real path today),
// an unmapped slot, or a slot naming a SKU no longer in `skus` — resolves
// to that SAME default, never a dangling id and never a placeholder color.
export function assignedSkuId(tile_setup: TileSetup, cell?: TileCell | null): string {
  const fallback = primaryUsableSku(tile_setup)?.id ?? tile_setup.skus?.[0]?.id ?? "sku";
  const assignment = tile_setup.assignment;
  if (!assignment || cell == null) return fallback;
  const id = assignment.slots?.[slotKey(cell, assignment.unit)];
  if (!id) return fallback;
  const sku = (tile_setup.skus || []).find((s) => s.id === id);
  return sku && usableSku(sku) ? id : fallback;
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
    // Wall-only settings — inert on the floor path (nothing reads them for a
    // floor_area shape), so defaulting them here doesn't change floor
    // behavior. `purchase.breakage_pct` is deliberately NOT defaulted here:
    // it's a live floor input (tileCalc/order.ts falls back to 0.05 when
    // absent) and TileSetup carries no wall/floor discriminator, so minting
    // it here would silently change every floor condition's material
    // overage too. Wall overage is threaded explicitly by the wall
    // orchestration path instead (see summarizeWallShape).
    wall_corner_mode: "wrap",
    wall_edge_finish: "profile",
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
