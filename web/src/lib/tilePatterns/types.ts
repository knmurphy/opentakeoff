// web/src/lib/tilePatterns/types.ts
export type TileQuad = { cx: number; cy: number; w: number; h: number; rot: number; skuId: string };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type GenInput = {
  bounds: Bounds; w: number; h: number; joint: number;
  origin: [number, number]; rotation_deg: number; skuId: string;
};
export interface PatternGenerator { name: string; generate(input: GenInput): TileQuad[]; }
