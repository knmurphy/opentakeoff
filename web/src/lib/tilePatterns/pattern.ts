// web/src/lib/tilePatterns/pattern.ts
import type { Bounds, PatternGenerator, TileQuad } from "./types.ts";
export const registry = new Map<string, PatternGenerator>();
export function register(g: PatternGenerator) { registry.set(g.name, g); }
export function getPattern(name: string): PatternGenerator {
  const g = registry.get(name);
  if (!g) throw new Error(`unknown tile pattern: ${name}`);
  return g;
}

// Shared rotation contract (P1 fix, design §3.1 follow-up): every generator
// — axis-aligned (grid/offset/diagonal) and interlock-derived
// (herringbone/basketweave) alike — honors `rotation_deg` the same way: lay
// the pattern out normally about the room, then spin the WHOLE assembled
// quad set by `angleRad` about the layout origin (diagonal.ts pioneered this
// for its fixed 45°; this generalizes it to an arbitrary angle for every
// generator, with 5 real callsites, so it lives here rather than being
// duplicated per file).
export function rotateQuadsAboutOrigin(quads: TileQuad[], origin: [number, number], angleRad: number): TileQuad[] {
  const [ox, oy] = origin;
  const ca = Math.cos(angleRad), sa = Math.sin(angleRad);
  return quads.map((q) => {
    const dx = q.cx - ox, dy = q.cy - oy;
    return { ...q, cx: ox + dx * ca - dy * sa, cy: oy + dx * sa + dy * ca, rot: q.rot + angleRad };
  });
}

// Generation bounds for a rotated lattice: the region an AXIS-ALIGNED
// generator must fill so that rotating its output by `angleRad` about
// `origin` still covers the whole room. Rotate the room bbox's 4 corners
// by -angleRad about `origin` (the inverse of the rotation the generator
// will apply afterward) and take their axis-aligned bbox. Every point of
// `bounds` maps into this region under the +angleRad rotation about
// `origin`, so generating over it and then rotating +angleRad guarantees
// full coverage — regardless of where `origin` sits relative to `bounds`
// (a room corner, not just its center, per the P1 coverage-bug fix).
// Replaces the old grow-by-diagonal `expandBoundsForRotation`, which
// assumed the pivot was the bbox center and under-covered (and
// over-generated) whenever it wasn't.
export function genBoundsForRotation(bounds: Bounds, origin: [number, number], angleRad: number): Bounds {
  const [ox, oy] = origin;
  const ca = Math.cos(angleRad), sa = Math.sin(angleRad);
  const corners: [number, number][] = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    const dx = x - ox, dy = y - oy;
    // inverse rotation: apply -angleRad
    const rx = ox + dx * ca + dy * sa;
    const ry = oy - dx * sa + dy * ca;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { minX, minY, maxX, maxY };
}
