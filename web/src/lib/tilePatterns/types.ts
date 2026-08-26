// web/src/lib/tilePatterns/types.ts
// cx/cy/w/h are FEET (plan space); rot is RADIANS.
export type TileQuad = { cx: number; cy: number; w: number; h: number; rot: number; skuId: string };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
// bounds/origin and w_ft/h_ft/joint_ft are all FEET; rotation_deg is DEGREES
// (each generator converts it through tileUnits.degToRad). The `_ft` suffix
// marks the unit at the generator boundary — tileSolve.ts converts the
// INCHES-authored SKU/joint sizes into these feet before calling generate().
export type GenInput = {
  bounds: Bounds; w_ft: number; h_ft: number; joint_ft: number;
  origin: [number, number]; rotation_deg: number; skuId: string;
};
export interface PatternGenerator { name: string; generate(input: GenInput): TileQuad[]; }
