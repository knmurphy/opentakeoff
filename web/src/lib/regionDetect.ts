// Region detector, piece 2a (docs/design/REGION_ANNOTATION_PLAN.md): title
// block vs drawing area on vector sheets. Pure module — no pdf.js, no DOM —
// so the web app and the MCP server feed it the same source-neutral inputs.
//
// Implemented so far: the input types, the line adapter, step 1 (border),
// step 2 (strip candidates), step 3 (statics, fields and repetition bands
// over a set of sheets) and step 4 (signals, acceptance, confidence) per
// sheet; step 3 reaches step 4 through `DetectOptions`; `detectSetRegions`
// runs the set: steps 3–4 twice (the plan's one iteration), step 5
// (grouping, signature ids) and step 6 (regions).
import type { Bbox } from "./sheetgraph.ts";
import { aspectBucket, assignGroupIds, capStatics, cleanRegions, type GroupSig, type Region, type SheetRegions } from "./regions.ts";

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
/** One strip candidate as step 4 judged it. `d`, `chainCover`, `extent`,
 * `area` and `freeEndGap` are fractions of the border box; `tokens` counts the
 * extent-bounded strip (sheetno and density use it), `stripTokens` the full
 * border-to-border strip (the MIN_STRIP_TOKENS floor uses it); `sheetnoPos` is the
 * judged pattern token's center [along, across] as fractions of the strip
 * (along from the near end of the chain's extent, across from the border);
 * `sheetnoIdx` is that token's index in `DetectSheet.tokens`. */
export interface DetectCandidateDiag {
  edge: Edge; d: number; frame: boolean; chainCover: number; extent: [number, number];
  touch: "near" | "far" | "both" | null; freeEndGap: number | null; area: number;
  tokens: number; stripTokens: number; density: number; sheetno: boolean; sheetnoPos: [number, number] | null; sheetnoIdx: number | null;
  repeat: boolean; accepted: boolean; reason: string;
}
export interface DetectDiag {  // per sheet; recomputed, not persisted
  border: Bbox | null; edge: Edge | null; d: number | null;
  candidates: DetectCandidateDiag[];
  staticIdx: number[]; fieldIdx: number[];   // token indices, for piece 4 (title-block parts)
}

/** The detector's own sheet-number pattern (a digit may follow the letters:
 * `A1-101`). Deliberately separate from `sheets.ts` `SHEET_NO_RE`. It also
 * matches finish tags such as `LVT-1`; position and glyph height, not the
 * pattern, separate those from sheet numbers. */
export const TB_SHEETNO_RE = /^[A-Z]{1,3}\d?[-. ]?\d{1,3}(\.\d{1,2})?[A-Z]?$/;

// ── detection constants ─────────────────────────────────────────────────────
// Values as stated in docs/design/REGION_ANNOTATION_PLAN.md ("Algorithm"); none
// is calibrated yet. The calibration sweep on the tune set (task 6, part b)
// may revise them and will name its data here. Fractions are of
// the page (step 1) or of the border box (steps 2–5), as noted.

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

/** Step 4: every candidate strip holds at least this many tokens (every real
 * strip measured has ≥ 58), counted over the full border-to-border strip at
 * the candidate's depth (plan amendment); sheetno and density stay bounded by
 * the chain's extent. */
export const MIN_STRIP_TOKENS = 15;
/** Step 4: the sheet number's center lies in the far-end part of the strip
 * along the edge (the far-end half) … */
export const SHEETNO_FAR_FROM = 0.5;
/** … and in the outer part of the depth, nearest the border (outer 60%; the
 * S501 detail tag "B10" sits at 92% of the depth and fails). */
export const SHEETNO_OUTER = 0.6;
/** Step 4: confidence by the number of rules (A, B, C) satisfied — rule
 * labels, not calibrated probabilities. With no accepted strip: ABSTAIN. */
export const CONFIDENCE_BY_RULES: Readonly<Record<number, number>> = { 3: 0.95, 2: 0.85, 1: 0.7 };
export const ABSTAIN_CONFIDENCE = 0.3;

/** Step 3: two tokens are "at the same position" when their centers,
 * normalized to their sheets' border boxes, lie within this fraction per axis. */
export const REPEAT_POS_TOL = 0.02;
/** Step 3: static (same text) or field (a fixed position whose text changes)
 * on at least this share of the sheets considered … */
export const REPEAT_MIN_SHARE = 0.5;
/** … and a static on at least this many sheets (plan amendment, task 6a: was
 * 3; a 2-sheet family in a larger set then has statics) … */
export const STATIC_MIN_SHEETS = 2;
/** … and a field's position filled on at least this many. */
export const FIELD_MIN_SHEETS = 3;
/** Step 3: the repetition band holds static tokens (plan amendment, task 6a:
 * fields no longer shape it) within this depth of an edge (fraction of the
 * border box across the edge). */
export const BAND_DEPTH = 0.32;
/** Step 3: `repeat` needs the band to cover at least this share of the
 * candidate strip's length along the edge. */
export const BAND_MIN_COVER = 0.5;
/** Step 3: a chain at depth d frames the static band when the deepest static
 * glyph edge inside its strip is ≥ d / this (the static text reaches the
 * strip's last third; plan amendments 5 and 7, task 6a). Synthetic-derived;
 * recalibrated in task 6b. */
export const FRAME_BAND_RATIO = 1.5;
/** Step 3: the contiguous static band grows outward from its shallowest
 * static and stops at the first depth gap larger than this fraction of the
 * dimension across the edge (plan amendments 6 and 7, task 6a); a frameless
 * strip is as deep as that band. Synthetic-derived; recalibrated in task 6b. */
export const BAND_GAP = 0.04;
/** Steps 3 and 5: candidate groups and groups need |Δd| ≤ this (fraction of
 * the border box across the edge; the same 1.5% `matchGroup` uses). */
export const GROUP_D_TOL = 0.015;

/** Step 5: two sheets share a group at Jaccard(distinctive statics) ≥ this. */
export const GROUP_MIN_JACCARD = 0.5;
/** Step 5: page sizes in inches are equal to this, per axis (rounding only). */
const PAGE_TOL_IN = 0.01;

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

// ── step 4: signals and acceptance ──────────────────────────────────────────
/** Far end of a strip along its edge and the outer part of its depth (plan,
 * step 4 table). `stripUV` follows it: u grows toward `far`, v from `outer`. */
export interface FarEnd { along: "x" | "y"; far: "bottom" | "right"; outer: Edge }
const FAR_END: Readonly<Record<Edge, FarEnd>> = {
  right: { along: "y", far: "bottom", outer: "right" },
  bottom: { along: "x", far: "right", outer: "bottom" },
  left: { along: "y", far: "bottom", outer: "left" },
  top: { along: "x", far: "right", outer: "top" },
};
export const farEnd = (edge: Edge): FarEnd => ({ ...FAR_END[edge] });

export const confidenceFor = (rules: number): number => CONFIDENCE_BY_RULES[rules] ?? ABSTAIN_CONFIDENCE;

/** Center of a token's box (DetectToken convention: baseline start, run of
 * width `w` along `rot`, glyphs rising `h` perpendicular). A missing `w` is
 * estimated as 0.6 × h per character. */
export function tokenCenter(t: DetectToken): [number, number] {
  const w = t.w ?? 0.6 * t.h * t.str.length;
  const r = ((t.rot ?? 0) * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12, s = Math.round(Math.sin(r) * 1e12) / 1e12;
  return [t.x + (c * w) / 2 + (s * t.h) / 2, t.y + (s * w) / 2 - (c * t.h) / 2];
}

export type TitleBlockRule = "A" | "B" | "C";
/** A strip found by repetition alone (step 3, task 6): used as a candidate
 * without a frame on an edge that has no chain candidate. */
export interface RepeatStrip { edge: Edge; d: number; extent: [number, number] }
export interface DetectOptions {
  /** Step 3's `repeat` for a chain candidate (the chain frames the static
   * band, whose statics in the strip span ≥ 50% of its length). Default: false. */
  repeat?: (c: StripCandidate) => boolean;
  /** Step 3: whether a chain at depth d on an edge frames the static band; a
   * framing chain drops that edge's repetition-only strips. Default: never. */
  frames?: (edge: Edge, d: number) => boolean;
  /** Step 3's repetition-only (frameless) strips; each joins its edge's chain
   * candidates, smallest d first. Default: none. */
  repeatStrips?: RepeatStrip[];
  /** Step 3's static and field token indices, copied into the diagnostics. */
  classes?: TokenClasses;
}
/** The per-sheet title-block decision. `strip` is the accepted strip, border
 * to border along its edge (image px); null when abstaining. */
export interface TitleBlockDecision {
  edge: Edge | null; d: number | null; strip: Bbox | null; border: Bbox;
  rules: TitleBlockRule[]; confidence: number; evidence: string[];
}

/** The strip's box in image px, border to border along its edge. */
function stripBox(edge: Edge, box: Bbox, d: number): Bbox {
  const [bx0, by0, bx1, by1] = box;
  const bw = bx1 - bx0, bh = by1 - by0;
  switch (edge) {
    case "right": return [bx1 - d * bw, by0, bx1, by1];
    case "left": return [bx0, by0, bx0 + d * bw, by1];
    case "bottom": return [bx0, by1 - d * bh, bx1, by1];
    case "top": return [bx0, by0, bx1, by0 + d * bh];
  }
}

interface Judged { c: StripCandidate; diag: DetectCandidateDiag; rules: TitleBlockRule[] }

/** Step 4 for one candidate: signals over the extent-bounded strip (u in the
 * chain's extent, v in [0, d]); acceptance needs MIN_STRIP_TOKENS in the full
 * border-to-border strip (u in [0, 1]), then rule
 * A (frame + sheetno), B (frame + repeat) or C (repeat + sheetno). */
function judge(sheet: DetectSheet, box: Bbox, centers: [number, number][], inBox: boolean[], c: StripCandidate, repeat: boolean): Judged {
  const [e0, e1] = c.extent;
  const area = (e1 - e0) * c.d;
  let n = 0, nFull = 0, nRest = 0, best = -1, bestUV: [number, number] = [0, 0];
  centers.forEach(([x, y], i) => {
    if (!inBox[i]) return;
    const [u, v] = stripUV(c.edge, box, x, y);
    if (u >= 0 && u <= 1 && v >= 0 && v <= c.d) nFull++;
    if (!(u >= e0 && u <= e1 && v >= 0 && v <= c.d)) { nRest++; return; }
    n++;
    const t = sheet.tokens[i];
    if (TB_SHEETNO_RE.test(t.str.trim()) && (best < 0 || t.h > sheet.tokens[best].h)) { best = i; bestUV = [u, v]; }
  });
  const restArea = 1 - area;
  const density = nRest > 0 && restArea > 0 ? (n / area) / (nRest / restArea) : n > 0 ? Infinity : 0;
  const sheetnoPos: [number, number] | null = best < 0 ? null : [(bestUV[0] - e0) / (e1 - e0), bestUV[1] / c.d];
  const sheetno = !!sheetnoPos && sheetnoPos[0] >= SHEETNO_FAR_FROM && sheetnoPos[1] <= SHEETNO_OUTER;
  const rules: TitleBlockRule[] = [];
  let reason: string;
  if (nFull < MIN_STRIP_TOKENS) reason = "few-tokens";
  else {
    if (c.frame && sheetno) rules.push("A");
    if (c.frame && repeat) rules.push("B");
    if (repeat && sheetno) rules.push("C");
    const fired = [c.frame && "frame", sheetno && "sheetno", repeat && "repeat"].filter(Boolean);
    reason = rules.length ? "accepted" : fired.length ? `one-signal:${fired.join("+")}` : "no-signal";
  }
  return {
    c, rules,
    diag: {
      edge: c.edge, d: c.d, frame: c.frame, chainCover: c.cover, extent: [e0, e1], touch: c.touch, freeEndGap: c.freeEndGap,
      area, tokens: n, stripTokens: nFull, density, sheetno, sheetnoPos, sheetnoIdx: best < 0 ? null : best, repeat, accepted: rules.length > 0, reason,
    },
  };
}

/** Strip areas closer than this are equal in `beats` (floating-point noise). */
const AREA_EPS = 1e-9;

/** Between edges: more rules, then the smaller strip area (areas within
 * AREA_EPS are equal), then the higher density; a tie on all three falls
 * back to EDGES order. Returns the first criterion on which `a` beats `b`
 * (null if it does not). */
function beats(a: Judged, b: Judged): "rules" | "area" | "density" | "order" | null {
  if (a.rules.length !== b.rules.length) return a.rules.length > b.rules.length ? "rules" : null;
  if (Math.abs(a.diag.area - b.diag.area) > AREA_EPS) return a.diag.area < b.diag.area ? "area" : null;
  if (a.diag.density !== b.diag.density) return a.diag.density > b.diag.density ? "density" : null;
  return EDGES.indexOf(a.c.edge) < EDGES.indexOf(b.c.edge) ? "order" : null;
}

/** Steps 1, 2 and 4 on one sheet: the title-block decision (or abstain) and
 * the diagnostics. Repetition (step 3) comes in through `opts`. */
export function detectTitleBlock(sheet: DetectSheet, opts: DetectOptions = {}): { decision: TitleBlockDecision; diag: DetectDiag } {
  const border = findBorder(sheet);
  const box = border.box;
  const [bx0, by0, bx1, by1] = box;
  const centers = sheet.tokens.map(tokenCenter);
  const inBox = centers.map(([x, y]) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1);
  const chains = findCandidates(sheet, border);
  const all: StripCandidate[] = [...chains];
  for (const r of opts.repeatStrips ?? []) {
    // a strip of zero length or depth has no area to judge (and would divide by zero)
    if (!(r.extent[1] > r.extent[0]) || !(r.d > 0)) continue;
    // a chain framing the band is the strip's frame: no frameless strip on that edge (amendment 5)
    if (opts.frames && chains.some((c) => c.edge === r.edge && opts.frames!(c.edge, c.d))) continue;
    all.push({ edge: r.edge, d: r.d, extent: [r.extent[0], r.extent[1]], cover: r.extent[1] - r.extent[0], touch: null, frame: false, freeEndGap: null });
  }
  const judged: Judged[] = [];
  const winners: Judged[] = [];
  for (const edge of EDGES) {
    // chains and any repetition-only strip: smallest d first, the first that passes (a frame
    // before a frameless strip at the same d)
    const onEdge = all.filter((c) => c.edge === edge).sort((a, b) => a.d - b.d || Number(b.frame) - Number(a.frame));
    let won: Judged | null = null;
    for (const c of onEdge) {
      const j = judge(sheet, box, centers, inBox, c, c.frame ? opts.repeat?.(c) ?? false : true);
      if (won) { j.diag.accepted = false; j.diag.reason = "not-tried"; }
      else if (j.rules.length) won = j;
      judged.push(j);
    }
    if (won) winners.push(won);
  }
  let win: Judged | null = null;
  for (const j of winners) if (!win || beats(j, win)) win = j;
  for (const j of winners) {
    if (j === win) j.diag.reason = "chosen";
    else j.diag.reason = `lost:${beats(win!, j)}`;
  }
  const decision: TitleBlockDecision = win
    ? {
      edge: win.c.edge, d: win.c.d, strip: stripBox(win.c.edge, box, win.c.d), border: box,
      rules: win.rules, confidence: confidenceFor(win.rules.length),
      evidence: [
        ...win.rules.map((r) => `rule:${r}`),
        ...(win.c.frame ? ["frame-line"] : []),
        ...(win.diag.sheetno ? ["sheet-number"] : []),
        ...(win.diag.repeat ? ["repetition"] : []),
        ...(win.diag.density > 1 ? ["text-density"] : []),
      ],
    }
    : { edge: null, d: null, strip: null, border: box, rules: [], confidence: ABSTAIN_CONFIDENCE, evidence: [] };
  return {
    decision,
    diag: {
      border: box, edge: decision.edge, d: decision.d, candidates: judged.map((j) => j.diag),
      staticIdx: [...(opts.classes?.staticIdx ?? [])], fieldIdx: [...(opts.classes?.fieldIdx ?? [])],
    },
  };
}

// ── step 3: repetition across the set ───────────────────────────────────────
/** The text two tokens are compared by: trimmed, inner whitespace collapsed,
 * upper case. */
export const normText = (s: string): string => s.trim().replace(/\s+/g, " ").toUpperCase();

/** One sheet as step 3 sees it: its tokens and its border box. */
export interface RepeatInput { tokens: readonly DetectToken[]; box: Bbox }
/** Token indices per sheet: static (same text at the same position on enough
 * sheets) and field (a fixed position whose text changes). */
export interface TokenClasses { staticIdx: number[]; fieldIdx: number[] }

/** Step 3 over the sheets considered together (an aspect bucket, then a
 * candidate group). With n sheets, counting the token's own sheet:
 *  - static: max(STATIC_MIN_SHEETS, ⌈REPEAT_MIN_SHARE · n⌉) sheets hold a
 *    token with the same normalized text within REPEAT_POS_TOL (per axis) of
 *    the token's normalized center;
 *  - field (not static): max(FIELD_MIN_SHEETS, ⌈REPEAT_MIN_SHARE · n⌉)
 *    sheets hold some token at that position, and on ≥ ⌈REPEAT_MIN_SHARE · n⌉
 *    other sheets none of the tokens there has this text.
 * Tokens with empty text are neither. Output in input order, indices
 * ascending. */
export function classifyRepetition(sheets: readonly RepeatInput[]): TokenClasses[] {
  const n = sheets.length;
  const out: TokenClasses[] = sheets.map(() => ({ staticIdx: [], fieldIdx: [] }));
  const half = Math.ceil(REPEAT_MIN_SHARE * n - 1e-9);
  const needStatic = Math.max(STATIC_MIN_SHEETS, half), needField = Math.max(FIELD_MIN_SHEETS, half);
  if (n < needStatic) return out;
  const T = REPEAT_POS_TOL, TOL = REPEAT_POS_TOL + 1e-9;
  // every usable token of the set in flat arrays: normalized center, sheet, interned text
  const xs: number[] = [], ys: number[] = [], sheetOf: number[] = [], textOf: number[] = [], idxOf: number[] = [];
  const textIds = new Map<string, number>();
  sheets.forEach(({ tokens, box }, s) => {
    const [bx0, by0, bx1, by1] = box;
    const bw = bx1 - bx0, bh = by1 - by0;
    tokens.forEach((t, i) => {
      const text = normText(t.str);
      const [cx, cy] = tokenCenter(t);
      const x = (cx - bx0) / bw, y = (cy - by0) / bh;
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return;
      let id = textIds.get(text);
      if (id === undefined) { id = textIds.size; textIds.set(text, id); }
      xs.push(x); ys.push(y); sheetOf.push(s); textOf.push(id); idxOf.push(i);
    });
  });
  // one grid of REPEAT_POS_TOL cells for the whole set, keyed by number: a query scans the 3 × 3
  // cells around it, so its work is the neighbourhood, not every sheet
  const KEY = 1_000_003;
  const cellKey = (cx: number, cy: number) => cx * KEY + cy;
  const grid = new Map<number, number[]>();
  for (let k = 0; k < xs.length; k++) {
    const key = cellKey(Math.floor(xs[k] / T), Math.floor(ys[k] / T));
    const cell = grid.get(key);
    if (cell) cell.push(k); else grid.set(key, [k]);
  }
  // per sheet stamps count distinct sheets without clearing between queries
  const occStamp = new Int32Array(n).fill(-1), sameStamp = new Int32Array(n).fill(-1);
  // a query's answer depends only on (position, text) — the token's own sheet always holds
  // it — so identical queries (cloned or reissued sheets) are answered once
  const memo = new Map<string, [number, number]>();
  let q = 0;
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k], y = ys[k], tid = textOf[k];
    const mk = `${x},${y},${tid}`;
    let res = memo.get(mk);
    if (!res) {
      let same = 0, occupied = 0;
      const cx = Math.floor(x / T), cy = Math.floor(y / T);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
        const cell = grid.get(cellKey(a, b));
        if (!cell) continue;
        for (const j of cell) {
          if (Math.abs(xs[j] - x) > TOL || Math.abs(ys[j] - y) > TOL) continue;
          const o = sheetOf[j];
          if (occStamp[o] !== q) { occStamp[o] = q; occupied++; }
          if (textOf[j] === tid && sameStamp[o] !== q) { sameStamp[o] = q; same++; }
        }
      }
      q++;
      res = [same, occupied];
      memo.set(mk, res);
    }
    const [same, occupied] = res;
    // every occupied sheet without this text is a change (the token's own sheet holds it)
    const changed = occupied - same;
    if (same >= needStatic) out[sheetOf[k]].staticIdx.push(idxOf[k]);
    else if (occupied >= needField && changed >= half) out[sheetOf[k]].fieldIdx.push(idxOf[k]);
  }
  return out;
}

/** The repetition band on one edge: the box, in that edge's strip
 * coordinates, of the centers of the given (static) tokens that lie inside
 * the border box within BAND_DEPTH of the edge; `vBox` is the deepest corner
 * of those tokens' glyph boxes (the depth of a frameless strip). */
export interface RepeatBand { edge: Edge; u0: number; u1: number; v0: number; v1: number; vBox: number }

/** The four corners of a token's glyph box (DetectToken convention). */
export function tokenCorners(t: DetectToken): [number, number][] {
  const w = t.w ?? 0.6 * t.h * t.str.length;
  const r = ((t.rot ?? 0) * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12, s = Math.round(Math.sin(r) * 1e12) / 1e12;
  // along the run (c, s); the glyphs rise along (s, −c)
  const ax = c * w, ay = s * w, ux = s * t.h, uy = -c * t.h;
  return [[t.x, t.y], [t.x + ax, t.y + ay], [t.x + ux, t.y + uy], [t.x + ax + ux, t.y + ay + uy]];
}

export function repetitionBands(tokens: readonly DetectToken[], box: Bbox, idx: readonly number[]): Partial<Record<Edge, RepeatBand>> {
  const out: Partial<Record<Edge, RepeatBand>> = {};
  if (!(box[2] > box[0] && box[3] > box[1])) return out;
  for (const edge of EDGES) {
    const cands = idx.flatMap((i) => {
      const [u, v] = stripUV(edge, box, ...tokenCenter(tokens[i]));
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= BAND_DEPTH)) return [];
      const [lo, hi] = depthSpan(tokens[i], edge, box);
      return [{ u, v, lo, hi }];
    }).sort((a, b) => a.lo - b.lo);
    let b: RepeatBand | null = null;
    let front = cands.length ? cands[0].lo : 0;
    for (const c of cands) {
      if (c.lo > front + BAND_GAP) break;
      front = Math.max(front, c.hi);
      if (!b) b = { edge, u0: c.u, u1: c.u, v0: c.v, v1: c.v, vBox: c.hi };
      else {
        b.u0 = Math.min(b.u0, c.u); b.u1 = Math.max(b.u1, c.u); b.v0 = Math.min(b.v0, c.v); b.v1 = Math.max(b.v1, c.v);
        b.vBox = Math.max(b.vBox, c.hi);
      }
    }
    if (b) out[edge] = b;
  }
  return out;
}

/** A token's glyph box as a depth interval [lo, hi] from an edge's border. */
function depthSpan(t: DetectToken, edge: Edge, box: Bbox): [number, number] {
  const vs = tokenCorners(t).map(([x, y]) => stripUV(edge, box, x, y)[1]);
  return [Math.min(...vs), Math.max(...vs)];
}

/** Whether a chain at depth d frames the static band, given the deepest
 * static glyph edge inside its strip: deepest ≥ d / FRAME_BAND_RATIO. */
export const framesBand = (deepest: number, d: number): boolean =>
  deepest > 0 && deepest >= d / FRAME_BAND_RATIO - 1e-9;

/** Step 3's inputs to detectTitleBlock for one sheet, from its token
 * classes (statics only shape the band; plan amendments 2, 5–7):
 *  - `frames(edge, d)`: the deepest static glyph edge among statics centred in
 *    the strip (v ≤ d, border to border) is ≥ d / FRAME_BAND_RATIO;
 *  - `repeat(c)`: the chain frames the band, and those statics span
 *    ≥ BAND_MIN_COVER of the full strip's length;
 *  - per edge whose contiguous static band spans ≥ BAND_MIN_COVER of the
 *    border length, a frameless strip border to border along the edge, as
 *    deep as the band's deepest glyph edge (detectTitleBlock drops it when a
 *    chain on the edge frames the band, else tries it with the chains,
 *    smallest d first). */
export function repeatOptions(tokens: readonly DetectToken[], box: Bbox, classes: TokenClasses): DetectOptions {
  const bands = repetitionBands(tokens, box, classes.staticIdx);
  const statics = EDGES.map((edge) => classes.staticIdx.flatMap((i) => {
    const [u, v] = stripUV(edge, box, ...tokenCenter(tokens[i]));
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [{ u, v, hi: depthSpan(tokens[i], edge, box)[1] }] : [];
  }));
  const inStrip = (edge: Edge, d: number) => statics[EDGES.indexOf(edge)].filter((t) => t.v <= d);
  const frames = (edge: Edge, d: number) => framesBand(Math.max(0, ...inStrip(edge, d).map((t) => t.hi)), d);
  const repeat = (c: StripCandidate) => {
    if (!frames(c.edge, c.d)) return false;
    const us = inStrip(c.edge, c.d).map((t) => t.u);
    return Math.max(...us) - Math.min(...us) >= BAND_MIN_COVER;
  };
  const repeatStrips: RepeatStrip[] = [];
  for (const edge of EDGES) {
    const b = bands[edge];
    if (b && b.vBox > 0 && b.u1 - b.u0 >= BAND_MIN_COVER) repeatStrips.push({ edge, d: b.vBox, extent: [0, 1] });
  }
  return { repeat, frames, repeatStrips, classes };
}

// ── steps 5 and 6: grouping and output ──────────────────────────────────────
interface Prepared { sheet: DetectSheet; box: Bbox; aspect: number }

/** Step 3 over each list of sheet indices; indices in no list keep `prev`. */
function classifyWithin(prep: readonly Prepared[], lists: readonly number[][], prev?: readonly TokenClasses[]): TokenClasses[] {
  const out: TokenClasses[] = prep.map((_, i) => prev?.[i] ?? { staticIdx: [], fieldIdx: [] });
  for (const list of lists) {
    const cls = classifyRepetition(list.map((i) => ({ tokens: prep[i].sheet.tokens, box: prep[i].box })));
    list.forEach((i, k) => { out[i] = cls[k]; });
  }
  return out;
}

function detectWith(prep: readonly Prepared[], cls: readonly TokenClasses[]) {
  return prep.map((p, i) => detectTitleBlock(p.sheet, repeatOptions(p.sheet.tokens, p.box, cls[i])));
}

/** Connected components of `link` over `idx` (sorted lists, sorted by first member). */
function components(idx: readonly number[], link: (a: number, b: number) => boolean): number[][] {
  const parent = new Map(idx.map((i) => [i, i]));
  const find = (i: number): number => { let r = i; while (parent.get(r)! !== r) r = parent.get(r)!; parent.set(i, r); return r; };
  for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
    if (link(idx[a], idx[b])) { const ra = find(idx[a]), rb = find(idx[b]); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); }
  }
  const by = new Map<number, number[]>();
  for (const i of idx) { const r = find(i); by.set(r, [...(by.get(r) ?? []), i]); }
  return [...by.values()].map((l) => l.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

const sameGeom = (p: readonly Prepared[], dec: readonly TitleBlockDecision[], a: number, b: number) =>
  p[a].aspect === p[b].aspect && dec[a].edge === dec[b].edge && Math.abs(dec[a].d! - dec[b].d!) <= GROUP_D_TOL + 1e-9;

/** Whether a sheet's accepted strip is a repetition-only (frameless) one. */
const isFrameless = (r: { decision: TitleBlockDecision }) => !!r.decision.edge && !r.decision.evidence.includes("frame-line");

/** Step 3's candidate groups: sheets with a title block, linked by the same
 * aspect bucket and edge and |Δd| ≤ GROUP_D_TOL (geometry only); two sheets
 * with frameless strips need no d test (plan amendment, task 6a: their
 * pass-1 depths scatter). */
function candidateGroups(prep: readonly Prepared[], det: readonly { decision: TitleBlockDecision }[]): number[][] {
  const dec = det.map((r) => r.decision);
  const withTB = dec.flatMap((d, i) => (d.edge ? [i] : []));
  return components(withTB, (a, b) => sameGeom(prep, dec, a, b) ||
    (isFrameless(det[a]) && isFrameless(det[b]) && prep[a].aspect === prep[b].aspect && dec[a].edge === dec[b].edge));
}

const samePageIn = (a?: [number, number], b?: [number, number]) =>
  !!a && !!b && Math.abs(a[0] - b[0]) <= PAGE_TOL_IN + 1e-9 && Math.abs(a[1] - b[1]) <= PAGE_TOL_IN + 1e-9;

function jaccardOf(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  const union = a.size + b.size - both;
  return union ? both / union : 1;
}

/** Steps 1–6 over a plan set.
 *
 * Step 3 runs twice (the plan's one iteration): statics and fields per aspect
 * bucket → detect → candidate groups (same aspect bucket and edge, |Δd| ≤
 * GROUP_D_TOL; frameless sheets: bucket and edge only) → statics and fields
 * per candidate group (sheets without a title block, and a sheet alone in its
 * candidate group, keep their bucket's) → detect again. Step 5 then groups
 * on the second pass.
 *
 * A sheet's statics for grouping are the normalized texts of its static
 * tokens inside its title-block strip. With two or more candidate groups, a
 * string static in every candidate group is not distinctive and is dropped.
 * Two sheets with distinctive statics share a group when they have the same
 * aspect bucket and edge, |Δd| ≤ GROUP_D_TOL and Jaccard ≥ GROUP_MIN_JACCARD
 * (transitively). A sheet without distinctive statics is its own group; in a
 * set with fewer than 3 sheets that have a title block, such sheets with the
 * same page size in inches,
 * edge and |Δd| ≤ GROUP_D_TOL share one. A sheet without a title block has
 * no group and no signature (a signature needs an edge).
 *
 * Output (step 6): per sheet `border`, and for a sheet with a title block a
 * `title_block` region (the strip, border to border) and `group` / `group_sig`;
 * always a `drawing_area` (the border box minus the strip). Regions pass
 * through `cleanRegions` with the sheet's dims. The result does not depend on
 * the input order; the maps iterate in sheet-key order. Duplicate sheet keys
 * throw. */
export function detectSetRegions(sheets: readonly DetectSheet[]): { regions: Map<string, SheetRegions>; diag: Map<string, DetectDiag> } {
  const order = [...sheets].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (let i = 1; i < order.length; i++) {
    if (order[i].key === order[i - 1].key) throw new Error(`detectSetRegions: duplicate sheet key "${order[i].key}"`);
  }
  const prep: Prepared[] = order.map((sheet) => ({ sheet, box: findBorder(sheet).box, aspect: aspectBucket(sheet.w, sheet.h) }));
  const all = prep.map((_, i) => i);
  // pass 1: per aspect bucket
  const buckets = components(all, (a, b) => prep[a].aspect === prep[b].aspect);
  const cls1 = classifyWithin(prep, buckets);
  const det1 = detectWith(prep, cls1);
  // pass 2: per candidate group
  // a sheet alone in its candidate group keeps its bucket's classes (amendment 7)
  const cls = classifyWithin(prep, candidateGroups(prep, det1).filter((g) => g.length > 1), cls1);
  const det = detectWith(prep, cls);
  const dec = det.map((r) => r.decision);
  const cgroups = candidateGroups(prep, det);

  // step 5: statics inside each sheet's strip; distinctive ones only with ≥ 2 candidate groups
  const statics: Set<string>[] = prep.map((p, i) => {
    const out = new Set<string>();
    const d = dec[i];
    if (!d.edge || d.d === null) return out;
    for (const k of cls[i].staticIdx) {
      const t = p.sheet.tokens[k];
      const [u, v] = stripUV(d.edge, p.box, ...tokenCenter(t));
      if (u >= 0 && u <= 1 && v >= 0 && v <= d.d) out.add(normText(t.str));
    }
    return out;
  });
  if (cgroups.length >= 2) {
    const per = cgroups.map((g) => new Set(g.flatMap((i) => [...statics[i]])));
    const common = [...per[0]].filter((s) => per.every((p) => p.has(s)));
    for (const s of statics) for (const c of common) s.delete(c);
  }
  // the < 3 rule counts the sheets with a title block (a cover does not make a set "large")
  const small = dec.filter((d) => d.edge).length < 3;
  const groups = components(dec.flatMap((d, i) => (d.edge ? [i] : [])), (a, b) => {
    if (!sameGeom(prep, dec, a, b)) return false;
    const sa = statics[a], sb = statics[b];
    if (sa.size && sb.size) return jaccardOf(sa, sb) >= GROUP_MIN_JACCARD;
    return small && !sa.size && !sb.size && samePageIn(prep[a].sheet.pageIn, prep[b].sheet.pageIn);
  });
  const sigs: GroupSig[] = groups.map((g) => {
    const ds = g.map((i) => dec[i].d!).sort((a, b) => a - b);
    const pages = g.map((i) => prep[i].sheet.pageIn);
    const page = pages.every((p) => samePageIn(p, pages[0])) ? pages[0] : undefined;
    const count = new Map<string, number>();
    for (const i of g) for (const s of statics[i]) count.set(s, (count.get(s) ?? 0) + 1);
    return {
      edge: dec[g[0]].edge!, d: ds[(ds.length - 1) >> 1], aspect: prep[g[0]].aspect,
      ...(page ? { page_in: [page[0], page[1]] as [number, number] } : {}),
      statics: capStatics([...count].filter(([, n]) => n * 2 >= g.length).map(([s]) => s)),
    };
  });
  const ids = assignGroupIds(groups.map((g, k) => ({ sig: sigs[k], keys: g.map((i) => prep[i].sheet.key) })));
  const groupOfSheet = new Map<number, number>();
  groups.forEach((g, k) => g.forEach((i) => groupOfSheet.set(i, k)));

  // step 6
  const regions = new Map<string, SheetRegions>();
  const diag = new Map<string, DetectDiag>();
  prep.forEach((p, i) => {
    const { sheet, box } = p;
    const d = dec[i];
    const raw: Region[] = [];
    let area: Bbox = [...box];
    if (d.strip && d.edge) {
      raw.push({ id: "title_block", kind: "title_block", bbox: [...d.strip], parent: null, evidence: [...d.evidence], confidence: d.confidence, source: sheet.source });
      const [sx0, sy0, sx1, sy1] = d.strip;
      if (d.edge === "right") area = [box[0], box[1], sx0, box[3]];
      else if (d.edge === "left") area = [sx1, box[1], box[2], box[3]];
      else if (d.edge === "bottom") area = [box[0], box[1], box[2], sy0];
      else area = [box[0], sy1, box[2], box[3]];
    }
    raw.push({
      id: "drawing_area", kind: "drawing_area", bbox: area, parent: null,
      evidence: d.strip ? ["border", "title-block"] : ["border", "no-title-block"], confidence: d.confidence, source: sheet.source,
    });
    const k = groupOfSheet.get(i);
    regions.set(sheet.key, {
      key: sheet.key, w: sheet.w, h: sheet.h, border: [...box],
      ...(k !== undefined ? { group: ids[k], group_sig: sigs[k] } : {}),
      regions: cleanRegions(raw, { w: sheet.w, h: sheet.h }),
    });
    diag.set(sheet.key, det[i].diag);
  });
  return { regions, diag };
}
