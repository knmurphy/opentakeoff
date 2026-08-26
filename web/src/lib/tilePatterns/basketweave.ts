// web/src/lib/tilePatterns/basketweave.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { genBoundsForRotation, rotateQuadsAboutOrigin } from "./pattern.ts";
import { degToRad } from "../tileUnits.ts";

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
    const { w_ft, h_ft, joint_ft, origin, skuId } = input;
    const angle = degToRad(input.rotation_deg || 0);
    const bounds = angle === 0 ? input.bounds : genBoundsForRotation(input.bounds, origin, angle);
    // Same (w, h)-order hazard as herringbone.ts: a block's footprint is
    // long x long (two short-side members, each long, paired side by side
    // to span long) and its stride must equal that same long — not
    // whichever of (w, h) happens to be named `w`. The pre-fix bug used
    // `block = w` and `pairGap = h + joint` unconditionally, which is only
    // correct when w is the long side; for a SKU that names its short
    // side first (w=1ft, h=2ft), block collapsed to the SHORT dimension
    // while pairs kept their long-dimension footprint, so blocks tiled at
    // half their true stride and heavily overlapped (5,796 quads / 10,294
    // sf over a 2,580 sf room instead of ~1,290 planks at ~full coverage).
    // Canonicalize to (long, short) for the block geometry, then correct
    // the emitted rot by the same +90° adjustment as herringbone whenever
    // w is actually the short side (a long x short box at rot=θ is the
    // same rectangle as the real w x h box at rot=θ+π/2 in that case).
    const long = Math.max(w_ft, h_ft), short = Math.min(w_ft, h_ft);
    const orientAdjust = w_ft >= h_ft ? 0 : Math.PI / 2;
    const block = long;
    const pairGap = short + joint_ft;
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
          const rot = orientAdjust;
          out.push({ cx: bx, cy: by - pairGap / 2, w: w_ft, h: h_ft, rot, skuId });
          out.push({ cx: bx, cy: by + pairGap / 2, w: w_ft, h: h_ft, rot, skuId });
        } else {
          const rot = Math.PI / 2 + orientAdjust;
          out.push({ cx: bx - pairGap / 2, cy: by, w: w_ft, h: h_ft, rot, skuId });
          out.push({ cx: bx + pairGap / 2, cy: by, w: w_ft, h: h_ft, rot, skuId });
        }
      }
    }
    return angle === 0 ? out : rotateQuadsAboutOrigin(out, origin, angle);
  },
};
