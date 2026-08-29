// web/src/lib/tilePatterns/slotKey.ts
export type TileCell = { i: number; j: number; p?: number };
const fmod = (n: number, m: number) => ((n % m) + m) % m; // floored; raw % mis-keys negatives
export function slotKey(cell: TileCell, unit: { w: number; h: number }): string {
  const base = `${fmod(cell.i, unit.w)}_${fmod(cell.j, unit.h)}`;
  return cell.p == null ? base : `${base}_${cell.p}`;
}
export const PLANK_ARITY: Record<string, number> = {
  grid: 1, brick_50: 1, brick_33: 1, diagonal: 1, herringbone: 4, basketweave: 2,
};
