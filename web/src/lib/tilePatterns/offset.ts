// web/src/lib/tilePatterns/offset.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { pitchCell } from "../tilePitch.ts";
import { genBoundsForRotation, rotateQuadsAboutOrigin } from "./pattern.ts";
import { degToRad } from "../tileUnits.ts";

export function offsetGenerator(name: string, fraction: number): PatternGenerator {
  return {
    name,
    generate(input: GenInput): TileQuad[] {
      const { w_ft, h_ft, joint_ft, origin, skuId } = input;
      const angle = degToRad(input.rotation_deg || 0);
      const bounds = angle === 0 ? input.bounds : genBoundsForRotation(input.bounds, origin, angle);
      const cell = pitchCell(w_ft, h_ft, joint_ft);
      const [ox, oy] = origin;
      const startJ = Math.floor((bounds.minY - oy) / cell.h) - 1;
      const endJ = Math.ceil((bounds.maxY - oy) / cell.h) + 1;
      const out: TileQuad[] = [];
      for (let j = startJ; j <= endJ; j++) {
        // Floored mod, not raw `%`: raw `%` keeps JS's sign-of-dividend
        // behavior, so a negative j got a DIFFERENT rowShift than its
        // positive same-phase row (e.g. brick_50 j=-1 shifted -0.5 pitch
        // instead of +0.5 like j=1), which relabeled `cell.i` by a full
        // cell.w for the same physical tile — a real bug once `cell` feeds
        // slotKey.ts for multi-SKU assignment (Task 5). Geometry itself is
        // unaffected (this only renumbers `i`; the emitted cx/cy set for a
        // given row is byte-identical — see tileSolve.test.ts).
        const n = Math.round(1 / fraction);
        const rowShift = (((((j % n) + n) % n)) * fraction) * cell.w;
        const startI = Math.floor((bounds.minX - ox - rowShift) / cell.w) - 1;
        const endI = Math.ceil((bounds.maxX - ox - rowShift) / cell.w) + 1;
        for (let i = startI; i <= endI; i++)
          out.push({ cx: ox + rowShift + (i + 0.5) * cell.w, cy: oy + (j + 0.5) * cell.h, w: w_ft, h: h_ft, rot: 0, skuId, cell: { i, j } });
      }
      return angle === 0 ? out : rotateQuadsAboutOrigin(out, origin, angle);
    },
  };
}
export const brick50 = offsetGenerator("brick_50", 0.5);
export const brick33 = offsetGenerator("brick_33", 1 / 3);
