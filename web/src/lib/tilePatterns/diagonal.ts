// web/src/lib/tilePatterns/diagonal.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { gridGenerator } from "./grid.ts";
import { genBoundsForRotation, rotateQuadsAboutOrigin } from "./pattern.ts";

export const diagonalGenerator: PatternGenerator = {
  name: "diagonal",
  generate(input: GenInput): TileQuad[] {
    // Diagonal is "grid, rotated" — the original special case the shared
    // rotation contract (pattern.ts) generalizes. It still defaults to 45°
    // (the classic diagonal look) when rotation_deg is unset/zero, but an
    // explicit rotation_deg now overrides that default like every other
    // generator.
    const rotDeg = input.rotation_deg || 45;
    const angle = rotDeg * Math.PI / 180;
    // generate over the rotation-correct generation bounds (pattern.ts) so
    // the rotated lattice still fully covers the room from any origin
    const big = genBoundsForRotation(input.bounds, input.origin, angle);
    const flat = gridGenerator.generate({ ...input, bounds: big, rotation_deg: 0 });
    return rotateQuadsAboutOrigin(flat, input.origin, angle);
  },
};
