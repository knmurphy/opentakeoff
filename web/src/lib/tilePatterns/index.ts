// web/src/lib/tilePatterns/index.ts
import { register, registry, getPattern } from "./pattern.ts";
import { gridGenerator } from "./grid.ts";
import { brick50, brick33 } from "./offset.ts";
import { diagonalGenerator } from "./diagonal.ts";
import { herringboneGenerator } from "./herringbone.ts";
import { basketweaveGenerator } from "./basketweave.ts";
register(gridGenerator);
register(brick50); register(brick33); register(diagonalGenerator);
register(herringboneGenerator); register(basketweaveGenerator);
export { registry, getPattern };
export * from "./types.ts";

// Herringbone is gap-free only for 2:1 tiles (design §3.1); every other
// pattern's layout tolerates arbitrary tile ratios, so this only ever
// warns for herringbone.
export function layoutWarning(setup: { pattern?: string; skus?: { w_in: number; h_in: number }[] }): string | null {
  if (setup?.pattern === "herringbone") {
    const s = setup.skus?.[0];
    const ratio = s ? Math.max(s.w_in, s.h_in) / Math.min(s.w_in, s.h_in) : 0;
    if (Math.abs(ratio - 2) > 1e-6)
      return "Herringbone is gap-free only for 2:1 tiles; this tile's aspect ratio will leave gaps or need custom cuts.";
  }
  return null;
}
