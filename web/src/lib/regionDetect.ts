// Region detector, piece 2a (docs/design/REGION_ANNOTATION_PLAN.md): title
// block vs drawing area on vector sheets. Pure module — no pdf.js, no DOM —
// so the web app and the MCP server feed it the same source-neutral inputs.
//
// Implemented so far: the input types, the line adapter, step 1 (border) and
// step 2 (strip candidates). Repetition, acceptance and grouping land in
// later tasks.
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

// ── detection constants ─────────────────────────────────────────────────────
// Values as stated in docs/design/REGION_ANNOTATION_PLAN.md ("Algorithm"); the
// calibration sweep on the tune set (task 6) may revise them. Fractions are of
// the page (step 1) or of the border box (steps 2 and 4), as noted.

/** Step 1: rules within this fraction of the page edge are ignored (Dublin and
 * the sample plan draw page-edge rules outside the real border). */
export const PAGE_EDGE_FRAC = 0.01;
/** Step 1: a border rule lies within this fraction of its page edge (measured
 * 1.5–5.6%: Porterville's left border 5.6%, Dublin 3.5%). */
export const BORDER_MAX_FRAC = 0.08;
/** Step 1: a border rule spans at least this fraction of its page side (90%
 * missed Porterville, whose top and bottom rules span 83%). */
export const BORDER_MIN_SPAN = 0.75;
/** Step 2: chain pieces join across a gap up to this fraction of the border
 * length along the edge. */
export const CHAIN_GAP_FRAC = 0.005;
/** Step 2: candidate depth from the border, as a fraction of the border
 * dimension perpendicular to the edge (measured real strips 9.0–18.5%;
 * Porterville has a notes-column rule at 29.4%). */
export const STRIP_D_MIN = 0.06;
export const STRIP_D_MAX = 0.30;
/** Step 2: a chain covers at least this fraction of the border length
 * (Dublin's chain is 77%). */
export const MIN_CHAIN_COVER = 0.70;
/** Step 2: a chain end "touches" the border within this fraction of the
 * border box (Porterville's chain ends on its top and bottom border rules). */
export const TOUCH_FRAC = 0.01;

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

/** A rule on one axis: cross position `pos`, extent a ≤ b along the axis. */
interface Piece { pos: number; a: number; b: number }

/** Cluster parallel pieces whose cross positions lie within `band` of the
 * first piece in the cluster (sorted by position); inside a cluster, join
 * pieces whose extents overlap or leave a gap ≤ `gapTol`; a joined run sits at
 * the length-weighted mean of its pieces' positions. Runs shorter than
 * `minLen` are dropped. Sorts `pieces` in place. Output sorted by pos, then a. */
function mergeRuns(pieces: Piece[], band: number, gapTol: number, minLen: number): Piece[] {
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
}

const AXIS_TAN = Math.tan((AXIS_TOL_DEG * Math.PI) / 180);
/** Sort one segment into horizontal / vertical pieces (snapped to the mean of
 * its endpoints' cross coordinate); non-finite, zero-length and off-axis
 * segments are dropped. */
function addPiece(hor: Piece[], ver: Piece[], x0: number, y0: number, x1: number, y1: number): void {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  if (dx === 0 && dy === 0) return;
  if (dy <= dx * AXIS_TAN) hor.push({ pos: (y0 + y1) / 2, a: Math.min(x0, x1), b: Math.max(x0, x1) });
  else if (dx <= dy * AXIS_TAN) ver.push({ pos: (x0 + x1) / 2, a: Math.min(y0, y1), b: Math.max(y0, y1) });
}

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
  const hor: Piece[] = [], ver: Piece[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) addPiece(hor, ver, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
  return [
    ...mergeRuns(hor, DEDUPE_FRAC * h, gapTol, minLen).map((r) => ({ x0: r.a, y0: r.pos, x1: r.b, y1: r.pos })),
    ...mergeRuns(ver, DEDUPE_FRAC * w, gapTol, minLen).map((r) => ({ x0: r.pos, y0: r.a, x1: r.pos, y1: r.b })),
  ];
}

// ── step 1: border ──────────────────────────────────────────────────────────
/** The border box (image px) and which of its sides came from a rule (a side
 * without one is the page edge). */
export interface DetectBorder { box: Bbox; ruled: Record<Edge, boolean> }

/** The sheet's lines as axis pieces, rules within PAGE_EDGE_FRAC of the page
 * edge dropped. `DetectSheet.lines` may be raw axis-aligned lines (not
 * `longAxisLines` output), so every step normalizes them again. */
function sheetPieces(sheet: DetectSheet): { hor: Piece[]; ver: Piece[] } {
  const hor: Piece[] = [], ver: Piece[] = [];
  for (const l of sheet.lines) addPiece(hor, ver, l.x0, l.y0, l.x1, l.y1);
  const inside = (pos: number, dim: number) => pos > PAGE_EDGE_FRAC * dim && pos < dim - PAGE_EDGE_FRAC * dim;
  return { hor: hor.filter((p) => inside(p.pos, sheet.h)), ver: ver.filter((p) => inside(p.pos, sheet.w)) };
}

/** Step 1. Rules are de-duplicated (parallel rules within DEDUPE_FRAC of the
 * perpendicular page dimension merge) and joined across collinear gaps as
 * `longAxisLines` does; rules within PAGE_EDGE_FRAC of the page edge are
 * ignored. Each side is then the outermost rule lying within BORDER_MAX_FRAC
 * of that page edge and spanning ≥ BORDER_MIN_SPAN of that side; a side with
 * no such rule is the page edge.
 * "That side" is the border box's side, which depends on the perpendicular
 * sides: pass 1 measures spans against the page sides, pass 2 against the
 * sides of the pass-1 box (Porterville-style top/bottom rules stop on the
 * title strip at 80–85% of the border width, under 75% of the page width). */
export function findBorder(sheet: DetectSheet): DetectBorder {
  const { w, h } = sheet;
  const { hor, ver } = sheetPieces(sheet);
  const gapTol = COLLINEAR_GAP_FRAC * Math.min(w, h);
  const H = mergeRuns(hor, DEDUPE_FRAC * h, gapTol, 0), V = mergeRuns(ver, DEDUPE_FRAC * w, gapTol, 0);
  const side = (runs: Piece[], dim: number, span: number, low: boolean): number | null => {
    let best: number | null = null;
    for (const r of runs) {
      if (r.b - r.a < BORDER_MIN_SPAN * span) continue;
      if (low ? r.pos > BORDER_MAX_FRAC * dim : r.pos < dim - BORDER_MAX_FRAC * dim) continue;
      if (best === null || (low ? r.pos < best : r.pos > best)) best = r.pos;
    }
    return best;
  };
  const pass = (sideW: number, sideH: number): DetectBorder => {
    const top = side(H, h, sideW, true), bottom = side(H, h, sideW, false);
    const left = side(V, w, sideH, true), right = side(V, w, sideH, false);
    return {
      box: [left ?? 0, top ?? 0, right ?? w, bottom ?? h],
      ruled: { top: top !== null, right: right !== null, bottom: bottom !== null, left: left !== null },
    };
  };
  const first = pass(w, h);
  const [x0, y0, x1, y1] = first.box;
  return pass(x1 - x0, y1 - y0);
}

// ── strip coordinates ───────────────────────────────────────────────────────
export const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
const alongX = (e: Edge) => e === "top" || e === "bottom";

/** Image px → strip coordinates for an edge of a border box: `u` runs along
 * the edge from its near border end (0) to its far end (1: the bottom for
 * right/left strips, the right for top/bottom strips, see `farEnd`), `v` is
 * the depth from the edge's border side. Both are fractions of the border box. */
export function stripUV(edge: Edge, box: Bbox, x: number, y: number): [number, number] {
  const [bx0, by0, bx1, by1] = box;
  const bw = bx1 - bx0, bh = by1 - by0;
  switch (edge) {
    case "right": return [(y - by0) / bh, (bx1 - x) / bw];
    case "left": return [(y - by0) / bh, (x - bx0) / bw];
    case "bottom": return [(x - bx0) / bw, (by1 - y) / bh];
    case "top": return [(x - bx0) / bw, (y - by0) / bh];
  }
}

// ── step 2: strip candidates ────────────────────────────────────────────────
/** A strip candidate. `extent` is the chain's interval along the edge in `u`
 * (clipped to the border), `cover` its length; `touch` says which end touches
 * the border (null for a candidate that comes from repetition only);
 * `freeEndGap` is the free end's distance (in border-box fractions) to the
 * nearest other rule, for the diagnostics. */
export interface StripCandidate {
  edge: Edge; d: number; extent: [number, number]; cover: number;
  touch: "near" | "far" | "both" | null; frame: boolean; freeEndGap: number | null;
}

/** A rule in the strip coordinates of one edge: parallel rules have a depth
 * `v` and an interval [u0, u1]; perpendicular ones a position `u` and [v0, v1]. */
interface UVRule { par: boolean; u0: number; u1: number; v0: number; v1: number }

function uvRules(edge: Edge, box: Bbox, hor: Piece[], ver: Piece[]): UVRule[] {
  const out: UVRule[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number, par: boolean) => {
    const [ua, va] = stripUV(edge, box, x0, y0), [ub, vb] = stripUV(edge, box, x1, y1);
    out.push({ par, u0: Math.min(ua, ub), u1: Math.max(ua, ub), v0: Math.min(va, vb), v1: Math.max(va, vb) });
  };
  for (const r of hor) add(r.a, r.pos, r.b, r.pos, alongX(edge));
  for (const r of ver) add(r.pos, r.a, r.pos, r.b, !alongX(edge));
  return out;
}

/** Distance in strip coordinates from a point to a rule. */
function uvDist(u: number, v: number, r: UVRule): number {
  const du = u < r.u0 ? r.u0 - u : u > r.u1 ? u - r.u1 : 0;
  const dv = v < r.v0 ? r.v0 - v : v > r.v1 ? v - r.v1 : 0;
  return Math.hypot(du, dv);
}

/** Step 2. Per edge, chains (collinear rules parallel to the edge,
 * de-duplicated within DEDUPE_FRAC and joined across gaps ≤ CHAIN_GAP_FRAC of
 * the border length) whose depth from the border lies in
 * [STRIP_D_MIN, STRIP_D_MAX], which cover ≥ MIN_CHAIN_COVER of the border
 * length and touch the border at one end or both (within TOUCH_FRAC; the
 * border side is the page edge where no border rule was found). A free end
 * that meets rules perpendicular to the chain (within TOUCH_FRAC) must meet
 * at least one that reaches the border; otherwise the chain is rejected
 * (T-junction). Border rules sit at depth ≈ 0 or ≈ 1, outside the depth
 * bounds, so they never count as strip boundaries. Output: per edge in EDGES
 * order, smallest d first. */
export function findCandidates(sheet: DetectSheet, border: DetectBorder): StripCandidate[] {
  const box = border.box;
  const bw = box[2] - box[0], bh = box[3] - box[1];
  if (!(bw > 0 && bh > 0)) return [];
  const { hor, ver } = sheetPieces(sheet);
  // chain joining uses the border length along the rule's own axis
  const H = mergeRuns(hor, DEDUPE_FRAC * sheet.h, CHAIN_GAP_FRAC * bw, 0);
  const V = mergeRuns(ver, DEDUPE_FRAC * sheet.w, CHAIN_GAP_FRAC * bh, 0);
  const out: StripCandidate[] = [];
  for (const edge of EDGES) {
    const rules = uvRules(edge, box, H, V);
    // border rules (parallel at depth ≈ 0 / ≈ 1, perpendicular at u ≈ 0 / ≈ 1) are not "other chains"
    const isBorderRule = (r: UVRule) => (r.par
      ? r.v0 <= TOUCH_FRAC || r.v0 >= 1 - TOUCH_FRAC
      : r.u0 <= TOUCH_FRAC || r.u0 >= 1 - TOUCH_FRAC);
    const found: StripCandidate[] = [];
    for (const c of rules) {
      if (!c.par) continue;
      const d = c.v0;
      if (d < STRIP_D_MIN || d > STRIP_D_MAX) continue;
      const lo = Math.max(0, c.u0), hi = Math.min(1, c.u1);
      const cover = hi - lo;
      if (cover < MIN_CHAIN_COVER) continue;
      const near = c.u0 <= TOUCH_FRAC, far = c.u1 >= 1 - TOUCH_FRAC;
      if (!near && !far) continue;
      let freeEndGap: number | null = null;
      if (!(near && far)) {
        const uf = near ? c.u1 : c.u0;
        const junction = rules.filter((r) => !r.par && Math.abs(r.u0 - uf) <= TOUCH_FRAC &&
          r.v0 <= d + TOUCH_FRAC && r.v1 >= d - TOUCH_FRAC);
        if (junction.length > 0 && !junction.some((r) => r.v0 <= TOUCH_FRAC)) continue;
        let gap = Infinity;
        for (const r of rules) {
          if (r === c || isBorderRule(r)) continue;
          const g = uvDist(uf, d, r);
          if (g > TOUCH_FRAC && g < gap) gap = g;
        }
        freeEndGap = Number.isFinite(gap) ? gap : null;
      }
      found.push({
        edge, d, extent: [lo, hi], cover, touch: near && far ? "both" : near ? "near" : "far", frame: true, freeEndGap,
      });
    }
    out.push(...found.sort((a, b) => a.d - b.d));
  }
  return out;
}
