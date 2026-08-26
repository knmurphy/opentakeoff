// web/src/lib/tilePatterns/grid.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";
import { genBoundsForRotation, rotateQuadsAboutOrigin } from "./pattern.ts";
import { degToRad } from "../tileUnits.ts";

export const gridGenerator: PatternGenerator = {
  name: "grid",
  generate(input: GenInput): TileQuad[] {
    const { w_ft, h_ft, joint_ft, origin, skuId } = input;
    const angle = degToRad(input.rotation_deg || 0);
    // Grid is axis-aligned by construction; a nonzero rotation_deg lays the
    // lattice out over the GENERATION bounds for that rotation (the room
    // bbox rotated -angle about the origin, then re-bboxed — see
    // genBoundsForRotation in pattern.ts), then spins the whole set about
    // the origin (shared with offset/diagonal/herringbone/basketweave), so
    // no corner of the room is left uncovered once rotated regardless of
    // where the origin sits. angle===0 skips both steps, keeping today's
    // output byte-identical.
    const bounds = angle === 0 ? input.bounds : genBoundsForRotation(input.bounds, origin, angle);
    const cell = pitchCell(w_ft, h_ft, joint_ft);
    const [ox, oy] = origin;
    // phase the lattice so a tile edge passes through the origin; pad one cell.
    const startI = Math.floor((bounds.minX - ox) / cell.w) - 1;
    const endI = Math.ceil((bounds.maxX - ox) / cell.w) + 1;
    const startJ = Math.floor((bounds.minY - oy) / cell.h) - 1;
    const endJ = Math.ceil((bounds.maxY - oy) / cell.h) + 1;
    const out: TileQuad[] = [];
    for (let i = startI; i <= endI; i++)
      for (let j = startJ; j <= endJ; j++)
        out.push({ cx: ox + (i + 0.5) * cell.w, cy: oy + (j + 0.5) * cell.h, w: w_ft, h: h_ft, rot: 0, skuId });
    return angle === 0 ? out : rotateQuadsAboutOrigin(out, origin, angle);
  },
};
