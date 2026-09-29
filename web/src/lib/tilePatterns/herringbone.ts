// web/src/lib/tilePatterns/herringbone.ts
import type { GenInput, PatternGenerator, TileQuad } from "./types.ts";
import { genBoundsForRotation, rotateQuadsAboutOrigin } from "./pattern.ts";
import { degToRad } from "../tileUnits.ts";

// Herringbone is interlock-derived (design §3.1): a repeating period cell of
// 2 vertical planks (long axis along y) plus a stacked pair of horizontal
// planks (long axis along x) — the classic "T-joint" contact where a
// perpendicular plank's capped end butts against the middle of another
// plank's long edge. Adjacent period cells alternate a half-period stagger
// row to row, producing the diagonal chevron look.
//
// This used to be grown by a 6-offset BFS flood fill with a SAT overlap
// veto (still the mental model above), but that discovery graph is
// over-connected: composing offsets over multiple hops reaches genuinely
// overlapping candidates (not just near-duplicates) for positions far from
// the seed, and the BFS's first-come-first-served accept/reject order then
// starves large regions of the room, undercounting coverage by ~40% for a
// realistic room (verified by raster sampling — the gap fraction grows with
// distance from the seed, the signature of this kind of path-order
// artifact, not a numerical-precision issue). A period cell placed by
// closed-form arithmetic can't suffer that: every period tiles the plane
// exactly once by construction, so coverage is complete regardless of room
// size or how far `origin`/the room sit from the pattern's own anchor.
//
// The weave's own phasing now honors the free `origin` too — the band/
// column ranges and the period-cell anchor are all offset by `origin`
// before the closed-form arithmetic runs, so the whole lattice translates
// rigidly with it (byte-identical to the old anchored-at-[0,0] output when
// `origin` is [0,0]). rotation_deg is still honored separately via the
// same shared whole-pattern post-rotation as every other generator
// (pattern.ts): the assembled interlock is spun about `origin` after it's
// built, over an expanded generation bound so a rotated pattern still
// covers every corner of the room. The sliver-avoidance optimizer
// (tileGeometry/optimize.ts) doesn't search over this phase yet — it just
// picks up whatever `origin` it's given.
export const herringboneGenerator: PatternGenerator = {
  name: "herringbone",
  generate(input: GenInput): TileQuad[] {
    const { w_ft, h_ft, joint_ft, origin, skuId } = input;
    const angle = degToRad(input.rotation_deg || 0);
    const bounds = angle === 0 ? input.bounds : genBoundsForRotation(input.bounds, origin, angle);
    // GenInput makes no promise about which of (w, h) names the long side
    // (a 12x24in SKU can arrive as w=1ft/h=2ft just as easily as
    // w=2ft/h=1ft — tileSolve.ts just divides w_in/h_in by 12 in schedule
    // order, and grid.ts is symmetric so it never had to care). Canonicalize
    // to (long, short) for the lattice geometry, then correct for it once
    // on the way out: a long x short box at rot=θ is the same physical
    // rectangle as the real w x h box at rot=θ+π/2 whenever w is actually
    // the short side.
    const long = Math.max(w_ft, h_ft), short = Math.min(w_ft, h_ft);
    const orientAdjust = w_ft >= h_ft ? 0 : Math.PI / 2;

    // Pitch: one plank-width "module" including its joint margin. A period
    // cell is 2 modules wide (the two vertical planks) plus one long-plank
    // width wide (the horizontal pair) — by exactly one long-plank height
    // (the stacked horizontal pair's combined height, with a single joint
    // gap, equals a long plank's height plus one joint precisely when
    // long === 2*short — the 2:1 design assumption). Each plank keeps a
    // symmetric joint/2 margin against its slot boundary, matching how
    // grid.ts phases a tile inside its own pitch cell, so exactly one
    // joint's worth of gap is ever reserved per seam — never double-
    // counted the way naively pitching the two stacked planks by their own
    // independent (short+joint) slots would (that double-counts the joint
    // between them, inflating the internal grout loss to ~2x grid's own).
    const pShort = short + joint_ft;
    const pLong = long + joint_ft;
    const bandH = pLong;
    const periodX = 2 * pShort + pLong;

    const pad = long + short;
    const loX = bounds.minX - pad, hiX = bounds.maxX + pad;
    const loY = bounds.minY - pad, hiY = bounds.maxY + pad;
    const [ox, oy] = origin;

    const rotH = normalizeRot(orientAdjust);
    const rotV = normalizeRot(Math.PI / 2 + orientAdjust);

    const out: TileQuad[] = [];
    const bandStart = Math.floor((loY - oy) / bandH) - 1;
    const bandEnd = Math.ceil((hiY - oy) / bandH) + 1;
    for (let bi = bandStart; bi <= bandEnd; bi++) {
      const bandY0 = bi * bandH + oy;
      const shift = (((bi % 2) + 2) % 2) === 1 ? periodX / 2 : 0;
      const colStart = Math.floor((loX - ox - shift) / periodX) - 1;
      const colEnd = Math.ceil((hiX - ox - shift) / periodX) + 1;
      for (let ci = colStart; ci <= colEnd; ci++) {
        const x0 = ci * periodX + shift + ox;
        // leading vertical plank
        out.push({ cx: x0 + pShort / 2, cy: bandY0 + bandH / 2, w: w_ft, h: h_ft, rot: rotV, skuId, cell: { i: ci, j: bi, p: 0 } });
        // stacked horizontal pair, one joint gap between them, joint/2
        // margin against the band's own top/bottom (matching the vertical
        // planks' own symmetric margin within their band)
        const hhCx = x0 + pShort + pLong / 2;
        out.push({ cx: hhCx, cy: bandY0 + joint_ft / 2 + short / 2, w: w_ft, h: h_ft, rot: rotH, skuId, cell: { i: ci, j: bi, p: 1 } });
        out.push({ cx: hhCx, cy: bandY0 + pLong - joint_ft / 2 - short / 2, w: w_ft, h: h_ft, rot: rotH, skuId, cell: { i: ci, j: bi, p: 2 } });
        // trailing vertical plank
        out.push({ cx: x0 + pShort + pLong + pShort / 2, cy: bandY0 + bandH / 2, w: w_ft, h: h_ft, rot: rotV, skuId, cell: { i: ci, j: bi, p: 3 } });
      }
    }
    out.sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.rot - b.rot);
    return angle === 0 ? out : rotateQuadsAboutOrigin(out, origin, angle);
  },
};

function normalizeRot(rot: number): number {
  // A rectangle is identical under a 180deg turn; folding to [0, pi) keeps
  // the two true herringbone orientations (0 and pi/2) distinct.
  return ((rot % Math.PI) + Math.PI) % Math.PI;
}
