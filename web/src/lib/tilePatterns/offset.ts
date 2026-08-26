// web/src/lib/tilePatterns/offset.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";

export function offsetGenerator(name: string, fraction: number): PatternGenerator {
  return {
    name,
    generate({ bounds, w, h, joint, origin, skuId }: GenInput): TileQuad[] {
      const cell = pitchCell(w, h, joint);
      const [ox, oy] = origin;
      const startJ = Math.floor((bounds.minY - oy) / cell.h) - 1;
      const endJ = Math.ceil((bounds.maxY - oy) / cell.h) + 1;
      const out: TileQuad[] = [];
      for (let j = startJ; j <= endJ; j++) {
        const rowShift = ((j % Math.round(1 / fraction)) * fraction) * cell.w;
        const startI = Math.floor((bounds.minX - ox - rowShift) / cell.w) - 1;
        const endI = Math.ceil((bounds.maxX - ox - rowShift) / cell.w) + 1;
        for (let i = startI; i <= endI; i++)
          out.push({ cx: ox + rowShift + (i + 0.5) * cell.w, cy: oy + (j + 0.5) * cell.h, w, h, rot: 0, skuId });
      }
      return out;
    },
  };
}
export const brick50 = offsetGenerator("brick_50", 0.5);
export const brick33 = offsetGenerator("brick_33", 1 / 3);
