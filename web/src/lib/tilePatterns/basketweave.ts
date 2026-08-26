// web/src/lib/tilePatterns/basketweave.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { genBoundsForRotation, rotateQuadsAboutOrigin } from "./pattern.ts";

// Basketweave is interlock-derived (design §3.1). It lays a checkerboard of
// square-ish blocks, alternating a horizontal pair (two rot-0 planks
// stacked) and a vertical pair (two rot-90 planks side by side) — the
// classic subway/parquet basketweave look. Each block's footprint is
// nominal w x w (the plank's long dimension), which tiles cleanly for the
// common 2:1 plank ratio; other ratios still produce a deterministic
// alternating weave. It ignores the free `origin` for the weave's own
// phasing (the checkerboard is always anchored at the plan's [0,0]) — but
// rotation_deg is honored via the same shared whole-pattern post-rotation
// as every other generator (pattern.ts): the assembled weave is spun about
// `origin` after it's built, over an expanded generation bound so a
// rotated pattern still covers every corner of the room.
export const basketweaveGenerator: PatternGenerator = {
  name: "basketweave",
  generate(input: GenInput): TileQuad[] {
    const { w, h, joint, origin, skuId } = input;
    const angle = (input.rotation_deg || 0) * Math.PI / 180;
    const bounds = angle === 0 ? input.bounds : genBoundsForRotation(input.bounds, origin, angle);
    const block = w;
    const pairGap = h + joint;
    const startI = Math.floor(bounds.minX / block) - 1;
    const endI = Math.ceil(bounds.maxX / block) + 1;
    const startJ = Math.floor(bounds.minY / block) - 1;
    const endJ = Math.ceil(bounds.maxY / block) + 1;
    const out: TileQuad[] = [];
    for (let i = startI; i <= endI; i++) {
      for (let j = startJ; j <= endJ; j++) {
        const bx = (i + 0.5) * block, by = (j + 0.5) * block;
        const horizontal = ((i + j) % 2 + 2) % 2 === 0;
        if (horizontal) {
          out.push({ cx: bx, cy: by - pairGap / 2, w, h, rot: 0, skuId });
          out.push({ cx: bx, cy: by + pairGap / 2, w, h, rot: 0, skuId });
        } else {
          out.push({ cx: bx - pairGap / 2, cy: by, w, h, rot: Math.PI / 2, skuId });
          out.push({ cx: bx + pairGap / 2, cy: by, w, h, rot: Math.PI / 2, skuId });
        }
      }
    }
    return angle === 0 ? out : rotateQuadsAboutOrigin(out, origin, angle);
  },
};
