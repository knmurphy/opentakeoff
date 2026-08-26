// web/src/lib/tilePatterns/diagonal.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { gridGenerator } from "./grid.ts";

export const diagonalGenerator: PatternGenerator = {
  name: "diagonal",
  generate(input: GenInput): TileQuad[] {
    const a = Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    const [ox, oy] = input.origin;
    // generate on an expanded bound so the rotated lattice still covers the room
    const pad = Math.hypot(input.bounds.maxX - input.bounds.minX, input.bounds.maxY - input.bounds.minY);
    const big = { minX: input.bounds.minX - pad, minY: input.bounds.minY - pad,
                  maxX: input.bounds.maxX + pad, maxY: input.bounds.maxY + pad };
    return gridGenerator.generate({ ...input, bounds: big }).map((q) => {
      const dx = q.cx - ox, dy = q.cy - oy;
      return { ...q, cx: ox + dx * ca - dy * sa, cy: oy + dx * sa + dy * ca, rot: a };
    });
  },
};
