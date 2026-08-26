// web/src/lib/tilePatterns/grid.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";

export const gridGenerator: PatternGenerator = {
  name: "grid",
  generate({ bounds, w, h, joint, origin, skuId }: GenInput): TileQuad[] {
    const cell = pitchCell(w, h, joint);
    const [ox, oy] = origin;
    // phase the lattice so a tile edge passes through the origin; pad one cell.
    const startI = Math.floor((bounds.minX - ox) / cell.w) - 1;
    const endI = Math.ceil((bounds.maxX - ox) / cell.w) + 1;
    const startJ = Math.floor((bounds.minY - oy) / cell.h) - 1;
    const endJ = Math.ceil((bounds.maxY - oy) / cell.h) + 1;
    const out: TileQuad[] = [];
    for (let i = startI; i <= endI; i++)
      for (let j = startJ; j <= endJ; j++)
        out.push({ cx: ox + (i + 0.5) * cell.w, cy: oy + (j + 0.5) * cell.h, w, h, rot: 0, skuId });
    return out;
  },
};
