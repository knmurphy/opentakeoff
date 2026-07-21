// Multi-select marquee containment (#113). Center-in-rect selection in STAGE px
// (panel xOffset applied), so one marquee spans side-by-side panels. Same
// center-point convention as shapesInZone: a shape is "in" when its center is —
// count (1 vertex) and linear (2 vertices) fall to the bbox center via
// shapeCenter, polygons get the shoelace centroid. Documented caveat (shared
// with zone): a concave L whose centroid falls outside the rect is not
// selected — that's the established containment convention, not a bug.
import { shapeCenter } from "./zone.js";

/**
 * @param {Array}   shapes      shapes to test (caller pre-filters to visible)
 * @param {Array}   corners     [[x,y],[x,y]] two opposite rect corners, stage px, any order
 * @param {Function} panelByKey sheet_id -> { img: {w,h}, xOffset } or null when not visible
 * @returns {string[]} ids of contained shapes
 */
export function shapesInStageRect(shapes, [a, b], panelByKey) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const out = [];
  for (const s of shapes || []) {
    const sp = panelByKey(s.sheet_id);
    if (!sp || !sp.img?.w || !sp.img?.h) continue;   // sheet not on screen / degenerate panel
    const c = shapeCenter(s);
    if (!c) continue;
    const X = c[0] * sp.img.w + sp.xOffset, Y = c[1] * sp.img.h;
    if (X >= x0 && X <= x1 && Y >= y0 && Y <= y1) out.push(s.id);
  }
  return out;
}
