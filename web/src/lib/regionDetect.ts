// Region detector, piece 2a (docs/design/REGION_ANNOTATION_PLAN.md): title
// block vs drawing area on vector sheets. Pure module — no pdf.js, no DOM —
// so the web app and the MCP server feed it the same source-neutral inputs.
//
// This file currently holds the input types and the line adapter only; the
// detection steps (border, strip candidates, repetition, acceptance,
// grouping) land in later tasks.
import type { Bbox } from "./sheetgraph.ts";

/** A positioned text run in image px (RENDER_SCALE, displayed orientation).
 * Same convention as `sheets.ts` `extractPageTokens`: (x, y) is the run's
 * baseline start; the run extends `w` along direction `rot` (degrees,
 * clockwise in device space, y down) and its glyphs rise `h` perpendicular to
 * it (for rot 0: the box is [x, y − h] … [x + w, y]). */
export interface DetectToken { str: string; x: number; y: number; w?: number; h: number; rot?: number }
/** An axis-aligned rule in image px (x0 ≤ x1, y0 ≤ y1; x0 = x1 or y0 = y1). */
export interface DetectLine { x0: number; y0: number; x1: number; y1: number }
export interface DetectSheet {
  key: string;                 // sheetKey.ts convention
  w: number; h: number;        // image px at RENDER_SCALE, displayed orientation
  pageIn?: [number, number];   // page size in inches, when known
  tokens: DetectToken[];
  lines: DetectLine[];
  source: "vector" | "ocr";    // copied onto regions, never used for decisions
}
export type Edge = "top" | "right" | "bottom" | "left";
export interface DetectDiag {  // per sheet; recomputed, not persisted
  border: Bbox | null; edge: Edge | null; d: number | null;
  candidates: { edge: Edge; d: number; frame: boolean; chainCover: number; tokens: number; density: number; sheetno: boolean; sheetnoPos: [number, number] | null; repeat: boolean; accepted: boolean; reason: string }[];
  staticIdx: number[]; fieldIdx: number[];   // token indices, for piece 4 (title-block parts)
}

/** The detector's own sheet-number pattern (a digit may follow the letters:
 * `A1-101`). Deliberately separate from `sheets.ts` `SHEET_NO_RE`. It also
 * matches finish tags such as `LVT-1`; position and glyph height, not the
 * pattern, separate those from sheet numbers. */
export const TB_SHEETNO_RE = /^[A-Z]{1,3}\d?[-. ]?\d{1,3}(\.\d{1,2})?[A-Z]?$/;

// ── line adapter ────────────────────────────────────────────────────────────
/** A segment counts as axis-aligned within this many degrees of an axis. */
export const AXIS_TOL_DEG = 0.5;
/** Collinear pieces join across a gap up to this fraction of the shorter side. */
export const COLLINEAR_GAP_FRAC = 0.005;
/** Parallel rules within this fraction of the perpendicular dimension merge
 * (Dublin draws a cell line 3 px inside its border). */
export const DEDUPE_FRAC = 0.01;
/** Lines shorter than this fraction of the shorter side are dropped. */
export const MIN_LINE_FRAC = 0.15;

interface Piece { pos: number; a: number; b: number }

/** Flat segments `[x0, y0, x1, y1, …]` in image px (as `oneclick.ts`
 * `extractVectorGeometry` returns them in `segs`) → the sheet's long
 * axis-aligned rules:
 *  1. keep segments within AXIS_TOL_DEG of horizontal or vertical, snapped
 *     to the mean of their endpoints' cross coordinate;
 *  2. per orientation, cluster pieces whose cross positions lie within
 *     DEDUPE_FRAC of the perpendicular dimension of the first piece in the
 *     cluster (sorted by position), so a double rule becomes one;
 *  3. inside a cluster, join pieces whose extents overlap or leave a gap of at
 *     most COLLINEAR_GAP_FRAC of the shorter side; a joined run sits at the
 *     length-weighted mean of its pieces' positions;
 *  4. drop runs shorter than MIN_LINE_FRAC of the shorter side.
 * Output: horizontals sorted by y then x0, then verticals sorted by x then y0. */
export function longAxisLines(segs: ArrayLike<number>, w: number, h: number): DetectLine[] {
  const short = Math.min(w, h);
  const gapTol = COLLINEAR_GAP_FRAC * short;
  const minLen = MIN_LINE_FRAC * short;
  const tan = Math.tan((AXIS_TOL_DEG * Math.PI) / 180);
  const hor: Piece[] = [], ver: Piece[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const x0 = segs[i], y0 = segs[i + 1], x1 = segs[i + 2], y1 = segs[i + 3];
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) continue;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    if (dx === 0 && dy === 0) continue;
    if (dy <= dx * tan) hor.push({ pos: (y0 + y1) / 2, a: Math.min(x0, x1), b: Math.max(x0, x1) });
    else if (dx <= dy * tan) ver.push({ pos: (x0 + x1) / 2, a: Math.min(y0, y1), b: Math.max(y0, y1) });
  }
  const runs = (pieces: Piece[], band: number): Piece[] => {
    const out: Piece[] = [];
    pieces.sort((p, q) => p.pos - q.pos || p.a - q.a || p.b - q.b);
    let k = 0;
    while (k < pieces.length) {
      const start = pieces[k].pos;
      let e = k;
      while (e < pieces.length && pieces[e].pos - start <= band) e++;
      const cluster = pieces.slice(k, e).sort((p, q) => p.a - q.a || p.b - q.b);
      k = e;
      let cur: { a: number; b: number; wsum: number; psum: number } | null = null;
      const flush = () => {
        if (cur && cur.b - cur.a >= minLen) out.push({ pos: cur.psum / cur.wsum, a: cur.a, b: cur.b });
      };
      for (const p of cluster) {
        const len = p.b - p.a;
        if (cur && p.a - cur.b <= gapTol) {
          cur.b = Math.max(cur.b, p.b);
          cur.wsum += len; cur.psum += len * p.pos;
        } else {
          flush();
          cur = { a: p.a, b: p.b, wsum: len, psum: len * p.pos };
        }
      }
      flush();
    }
    return out.sort((p, q) => p.pos - q.pos || p.a - q.a);
  };
  return [
    ...runs(hor, DEDUPE_FRAC * h).map((r) => ({ x0: r.a, y0: r.pos, x1: r.b, y1: r.pos })),
    ...runs(ver, DEDUPE_FRAC * w).map((r) => ({ x0: r.pos, y0: r.a, x1: r.pos, y1: r.b })),
  ];
}
