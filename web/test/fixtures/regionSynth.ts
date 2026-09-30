// FROZEN: do not change after this commit; detector tests depend on it.
//
// Seeded synthetic sheet sets for the region detector (piece 2a), built as
// `DetectSheet` objects directly — no PDF. Spec: docs/design/
// REGION_ANNOTATION_PLAN.md, "Synthetic sets (unit tests)". Results on these
// sets are self-consistency, never accuracy; left and top title blocks are
// covered only here.
//
// Every generated sheet is `{ sheet, truth, meta }`:
//   - `sheet` is exactly what the detector sees (DetectSheet);
//   - `truth` is `{ edge, d, border, family }`, or null when the sheet has no
//     title block — it never goes inside `sheet`;
//   - `meta` records how the sheet was built (border, frame kind, chain cover,
//     decoys, the sheet number and field strings, the expected group label).
// d is a fraction of the border-box dimension perpendicular to the edge,
// measured from the border (the plan's convention). Coordinates are image px
// at RENDER_SCALE 2 (144 px per inch), displayed orientation.
//
// Layout, varied independently of the detector's features: d in 8–25%,
// border 1–7% per side, optional page-edge rules outside the border, edge,
// page size, token counts, text noise (drawing text, margin grid labels,
// revision rows).
//
// Decoys (DECOY_KINDS). Per sheet, drawn at random (uniformSet24 cycles
// through all of them so each appears there):
//   legend-column      a side column perpendicular to the title-block edge,
//                      6–30% from an adjacent border side, starting at the
//                      opposite border and ending 2–6% short of the
//                      title-block chain (Shreveport style), closed by a rule
//                      back to its side border; title-block sheets only;
//   schedule-table     a wide table (32–45% of the border width) in the
//                      drawing, with finish tags such as LVT-1 in its cells;
//   viewport-frame     a rectangle in the drawing with a "SCALE:" title;
//   top-rule-26        a border-to-border horizontal rule 26% below the top
//                      border (Dublin part 4 style);
//   sheetno-in-drawing a TB_SHEETNO_RE-like detail tag in the drawing, 1–2.5%
//                      from the title-block inner rule (or, with no inner
//                      rule, below a viewport frame), sometimes taller than
//                      the sheet number.
// Per template (family), so every sheet of the family has it or none does:
//   boilerplate        the agency strings BOILERPLATE and "DEPARTMENT OF
//                      VETERANS AFFAIRS" at the same border-normalized spot
//                      for every firm;
//   double-rule        a second rule 3 px inside each border side.
// Partial frames: the inner edge is a chain of cell tops covering 70–80% of
// the border length, touching the far-end border, with a cell divider from
// its free end down to the border (Dublin style). Full frames cover 100%.
//
// Named sets (fixed default seeds): uniformSet24, bottomStripSet5, mixedSet,
// smallConsultantsSet, singleSheetSet, twoSheetSet, noTitleBlockSet,
// borderlessSet, leftEdgeSet, topEdgeSet; randomSet(seed) for sweeps.
import { TB_SHEETNO_RE, type DetectLine, type DetectSheet, type DetectToken, type Edge } from "../../src/lib/regionDetect.ts";

export type Box = [number, number, number, number];
export type DecoyKind =
  | "legend-column" | "schedule-table" | "viewport-frame" | "top-rule-26"
  | "sheetno-in-drawing" | "boilerplate" | "double-rule";
export const DECOY_KINDS: readonly DecoyKind[] = [
  "legend-column", "schedule-table", "viewport-frame", "top-rule-26",
  "sheetno-in-drawing", "boilerplate", "double-rule",
];
const PER_SHEET_DECOYS: readonly DecoyKind[] = [
  "legend-column", "schedule-table", "viewport-frame", "top-rule-26", "sheetno-in-drawing",
];
export const BOILERPLATE = "VA FORM 08-6231";
const BOILERPLATE_2 = "DEPARTMENT OF VETERANS AFFAIRS";

export interface Truth { edge: Edge; d: number; border: Box; family: string }
export interface SynthFields { sheetNo: string; title: string; date: string }
export interface SynthMeta {
  border: Box;                          // the border box (the page when borderless)
  borderless: boolean;
  frame: "full" | "partial" | "none";   // the title block's inner rule
  cover: number | null;                 // chain cover along the edge (1 = full)
  decoys: DecoyKind[];                  // in DECOY_KINDS order
  pageEdgeRules: boolean;               // rules within 1% of the page edge, outside the border
  sheetNo: string | null;
  fields: SynthFields | null;           // the changing title-block fields
  group: string;                        // expected family label ("none": no title block)
}
export interface SynthSheet { sheet: DetectSheet; truth: Truth | null; meta: SynthMeta }
export interface Firm { id: string; statics: string[] }   // statics exclude the shared boilerplate
export interface SynthSet { name: string; seed: number; sheets: SynthSheet[]; firms: Firm[]; expectGroups: number }

// ── random ──────────────────────────────────────────────────────────────────
/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  private next: () => number;
  constructor(seed: number) { this.next = mulberry32(seed); }
  u(): number { return this.next(); }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  take<T>(xs: readonly T[], n: number): T[] {
    const pool = [...xs], out: T[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    return out;
  }
}

// ── geometry ────────────────────────────────────────────────────────────────
const PX_PER_IN = 144; // RENDER_SCALE 2 × 72
const COS: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };
const trig = (rot: number): [number, number] =>
  rot in COS ? [COS[rot], SIN[rot]] : [Math.cos((rot * Math.PI) / 180), Math.sin((rot * Math.PI) / 180)];

/** Center of a token's box (DetectToken convention: baseline start, run along
 * `rot`, glyphs rising `h` perpendicular). */
export function tokenCenter(t: DetectToken): [number, number] {
  const w = t.w ?? 0.6 * t.h * t.str.length;
  const [c, s] = trig(t.rot ?? 0);
  return [t.x + (c * w) / 2 + (s * t.h) / 2, t.y + (s * w) / 2 - (c * t.h) / 2];
}

/** Image px → strip coordinates for a truth: u along the edge (0 at the near
 * border end, 1 at the far end: bottom for right/left, right for top/bottom),
 * v the depth from the edge's border side; both as fractions of the border box. */
export function toStripUV(t: { edge: Edge; border: Box }, x: number, y: number): [number, number] {
  const [bx0, by0, bx1, by1] = t.border;
  const bw = bx1 - bx0, bh = by1 - by0;
  switch (t.edge) {
    case "right": return [(y - by0) / bh, (bx1 - x) / bw];
    case "left": return [(y - by0) / bh, (x - bx0) / bw];
    case "bottom": return [(x - bx0) / bw, (by1 - y) / bh];
    case "top": return [(x - bx0) / bw, (y - by0) / bh];
  }
}
const lerp = (a: number, b: number, t: number) => (t === 0 ? a : t === 1 ? b : a + (b - a) * t);
function fromStripUV(edge: Edge, border: Box, u: number, v: number): [number, number] {
  const [bx0, by0, bx1, by1] = border;
  switch (edge) {
    case "right": return [lerp(bx1, bx0, v), lerp(by0, by1, u)];
    case "left": return [lerp(bx0, bx1, v), lerp(by0, by1, u)];
    case "bottom": return [lerp(bx0, bx1, u), lerp(by1, by0, v)];
    case "top": return [lerp(bx0, bx1, u), lerp(by0, by1, v)];
  }
}
function seg(x0: number, y0: number, x1: number, y1: number): DetectLine {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}
function tok(str: string, cx: number, cy: number, h: number, rot = 0): DetectToken {
  const w = 0.6 * h * str.length;
  const [c, s] = trig(rot);
  return { str, x: cx - (c * w) / 2 - (s * h) / 2, y: cy - (s * w) / 2 + (c * h) / 2, w, h, rot };
}

// ── vocabulary ──────────────────────────────────────────────────────────────
const FIRM_NAMES = ["HARBOR", "MERIDIAN", "NORTHGATE", "CEDARLINE", "ALTUS", "BRIGHTWATER", "KESTREL", "IRONWOOD", "SUMMIT", "LANTERN", "BASALT", "COPPERFIELD"];
const FIRM_SUFFIX = ["ARCHITECTS", "ENGINEERING GROUP", "DESIGN STUDIO", "ASSOCIATES", "CONSULTING ENGINEERS", "PARTNERS LLP"];
const STREETS = ["MARKET", "OAK", "HARRISON", "CEDAR", "RIVER", "FIFTH", "MAPLE", "UNION"];
const CITIES = [["DUBLIN", "GA"], ["SHREVEPORT", "LA"], ["PORTERVILLE", "CA"], ["ROSEBURG", "OR"], ["TUCSON", "AZ"], ["BOISE", "ID"], ["DAYTON", "OH"]];
const LABEL_STYLES = [
  ["DRAWN BY", "CHECKED BY", "SHEET TITLE", "DATE", "SHEET NO."],
  ["DRN", "CHK", "TITLE", "ISSUE DATE", "SHEET"],
  ["DRAWN:", "CHECKED:", "DRAWING TITLE", "DATED", "DWG NO."],
  ["DESIGNED", "APPROVED", "SHEET NAME", "ISSUED", "DRAWING NO."],
];
const TITLES = ["FLOOR PLAN", "REFLECTED CEILING PLAN", "ENLARGED PLANS", "EXTERIOR ELEVATIONS", "BUILDING SECTIONS", "WALL SECTIONS", "DETAILS", "FINISH PLAN", "DOOR SCHEDULE", "ROOF PLAN", "SITE PLAN", "DEMOLITION PLAN"];
const NOISE = ["OFFICE", "CORRIDOR", "STOR.", "MECH", "TOILET", "LOBBY", "12'-4\"", "8'-0\"", "101", "102", "EXISTING WALL", "D12", "W3", "TYP.", "EQ", "N.I.C.", "CLOSET", "NURSE STA.", "EXAM", "3'-6\"", "SEE DETAIL"];
const DETAIL_TAGS = ["A5", "B10", "D-3", "A-501", "C4", "S2.1"];
const PAGE_SIZES: [number, number][] = [[36, 24], [42, 30], [34, 22], [48, 36], [17, 11]];
const EDGES: Edge[] = ["right", "bottom", "left", "top"];

const SHEETNO_STYLES: ((i: number) => string)[] = [
  (i) => `A-${101 + i}`,
  (i) => `A${1 + Math.floor(i / 10)}.${String((i % 10) + 1).padStart(2, "0")}`,
  (i) => `A1-${101 + i}`,
  (i) => `C${101 + i}`,
];
const pad2 = (n: number) => String(n).padStart(2, "0");

// ── templates (one per title-block family) ──────────────────────────────────
interface Slot { str: string; u: number; vf: number; hk: number }   // vf: fraction of d
interface TitleBlock {
  edge: Edge; d: number; frame: "full" | "partial" | "none"; cover: number;
  lo: number; dividers: number[];      // chain starts at lo; dividers in (lo, 1)
  titleStart: number; lastStart: number;
  rot: number;                         // strip text rotation
  statics: Slot[]; sheetNoStyle: number; sheetNoHk: number;
}
interface Template {
  pageIn: [number, number]; W: number; H: number; textH: number;
  borderless: boolean; border: Box; pageEdgeRules: boolean; pageEdgeInset: number;
  doubleRule: boolean; boilerplate: boolean;
  tb: TitleBlock | null; firm: Firm | null;
}
interface TemplateOpts {
  edge?: Edge; pageIn?: [number, number]; borderless?: boolean; frame?: "full" | "partial" | "none";
  border?: Box; d?: number; doubleRule?: boolean; boilerplate?: boolean; pageEdgeRules?: boolean;
  labelStyle?: number; sheetNoStyle?: number; project?: string[]; firmName?: string; noTitleBlock?: boolean;
}

function makeProject(rng: Rng): string[] {
  const [city, st] = rng.pick(CITIES);
  return [`VA MEDICAL CENTER ${city}`, `BLDG ${rng.int(2, 60)} RENOVATION, ${city}, ${st}`];
}

function makeTemplate(rng: Rng, o: TemplateOpts): Template {
  const pageIn = o.pageIn ?? rng.pick(PAGE_SIZES);
  const W = pageIn[0] * PX_PER_IN, H = pageIn[1] * PX_PER_IN;
  const textH = 0.0045 * Math.min(W, H);
  const borderless = o.borderless ?? false;
  const m = () => rng.range(0.012, 0.068);
  const border: Box = o.border ?? (borderless ? [0, 0, W, H] : [m() * W, m() * H, W - m() * W, H - m() * H]);
  const pageEdgeRules = !borderless && (o.pageEdgeRules ?? rng.chance(0.4));
  const pageEdgeInset = rng.range(0.003, 0.006);
  const doubleRule = !borderless && (o.doubleRule ?? rng.chance(0.3));
  const boilerplate = o.boilerplate ?? rng.chance(0.5);
  if (o.noTitleBlock) return { pageIn, W, H, textH, borderless, border, pageEdgeRules, pageEdgeInset, doubleRule, boilerplate, tb: null, firm: null };

  const edge = o.edge ?? rng.pick(EDGES);
  const d = o.d ?? rng.range(0.085, 0.245);
  const frame = o.frame ?? (rng.chance(0.1) ? "none" : rng.chance(0.5) ? "full" : "partial");
  const cover = frame === "partial" ? rng.range(0.71, 0.79) : 1;
  const lo = frame === "partial" ? 1 - cover : 0;
  const lastStart = 1 - rng.range(0.10, 0.16);
  const titleStart = lastStart - rng.range(0.18, 0.25);
  const nSplit = rng.int(0, 2);
  const splits = Array.from({ length: nSplit }, () => rng.range(lo + 0.05, titleStart - 0.05)).sort((a, b) => a - b);
  const dividers = [...splits, titleStart, lastStart];
  const rot = edge === "right" ? (rng.chance(0.2) ? 270 : 0) : edge === "left" ? (rng.chance(0.2) ? 90 : 0) : 0;

  const name = o.firmName ?? rng.pick(FIRM_NAMES);
  const [city, st] = rng.pick(CITIES);
  const firmStrs = [
    `${name} ${rng.pick(FIRM_SUFFIX)}`,
    `${rng.int(100, 9999)} ${rng.pick(STREETS)} STREET, SUITE ${rng.int(100, 900)}`,
    `${city}, ${st} ${rng.int(10000, 99999)}`,
    `TEL ${rng.int(200, 999)}.${rng.int(200, 999)}.${rng.int(1000, 9999)}`,
    `www.${name.toLowerCase()}.com`,
    `LICENSE NO. ${rng.int(10000, 99999)}`,
  ];
  const project = o.project ?? makeProject(rng);
  const labels = LABEL_STYLES[o.labelStyle ?? rng.int(0, LABEL_STYLES.length - 1)];
  // slots: firm block in the first part of [lo, titleStart], project after it,
  // labels in the title cell, the sheet label in the last cell
  const firmEnd = lo + (titleStart - lo) * 0.55;
  const statics: Slot[] = [
    ...firmStrs.map((s, j) => ({ str: s, u: lo + (firmEnd - lo) * (j < 3 ? 0.3 : 0.7), vf: 0.2 + 0.28 * (j % 3), hk: j === 0 ? 1.8 : 1 })),
    ...project.map((s, j) => ({ str: s, u: firmEnd + (titleStart - firmEnd) * 0.5, vf: 0.3 + 0.35 * j, hk: j === 0 ? 1.6 : 1.1 })),
    { str: labels[0], u: titleStart + (lastStart - titleStart) * 0.3, vf: 0.88, hk: 0.8 },
    { str: labels[1], u: titleStart + (lastStart - titleStart) * 0.7, vf: 0.88, hk: 0.8 },
    { str: labels[2], u: titleStart + (lastStart - titleStart) * 0.5, vf: 0.12, hk: 0.8 },
    { str: labels[3], u: titleStart + (lastStart - titleStart) * 0.25, vf: 0.62, hk: 0.8 },
    { str: labels[4], u: lastStart + (1 - lastStart) * 0.5, vf: 0.8, hk: 0.8 },
  ];
  const tb: TitleBlock = {
    edge, d, frame, cover, lo, dividers, titleStart, lastStart, rot, statics,
    sheetNoStyle: o.sheetNoStyle ?? rng.int(0, SHEETNO_STYLES.length - 1),
    sheetNoHk: rng.range(3.2, 4.2),
  };
  const firm: Firm = { id: `${name.toLowerCase()}-${rng.int(100, 999)}`, statics: statics.map((s) => s.str) };
  return { pageIn, W, H, textH, borderless, border, pageEdgeRules, pageEdgeInset, doubleRule, boilerplate, tb, firm };
}

// ── sheets ──────────────────────────────────────────────────────────────────
function sheetKey(file: string, i: number): string {
  return i === 0 ? `${file}.pdf` : `${file}.pdf#${i + 1}`;
}

function drawingBox(t: Template): Box {
  const [bx0, by0, bx1, by1] = t.border;
  const bw = bx1 - bx0, bh = by1 - by0;
  let [x0, y0, x1, y1] = t.border;
  if (t.tb) {
    const dd = t.tb.d;
    if (t.tb.edge === "right") x1 = bx1 - dd * bw;
    else if (t.tb.edge === "left") x0 = bx0 + dd * bw;
    else if (t.tb.edge === "bottom") y1 = by1 - dd * bh;
    else y0 = by0 + dd * bh;
  }
  return [x0 + 0.02 * bw, y0 + 0.02 * bh, x1 - 0.02 * bw, y1 - 0.02 * bh];
}

function genSheet(t: Template, rng: Rng, i: number, key: string, forced: DecoyKind[] = []): SynthSheet {
  const tokens: DetectToken[] = [];
  const lines: DetectLine[] = [];
  const { W, H, textH, border, tb } = t;
  const [bx0, by0, bx1, by1] = border;
  const bw = bx1 - bx0, bh = by1 - by0;
  const jit = () => rng.range(-0.002, 0.002);

  // border, double rule, page-edge rules, margin grid labels
  if (!t.borderless) {
    lines.push(seg(bx0, by0, bx1, by0), seg(bx0, by1, bx1, by1), seg(bx0, by0, bx0, by1), seg(bx1, by0, bx1, by1));
    if (t.doubleRule) {
      lines.push(seg(bx0 + 3, by0 + 3, bx1 - 3, by0 + 3), seg(bx0 + 3, by1 - 3, bx1 - 3, by1 - 3),
        seg(bx0 + 3, by0 + 3, bx0 + 3, by1 - 3), seg(bx1 - 3, by0 + 3, bx1 - 3, by1 - 3));
    }
    if (t.pageEdgeRules) {
      const ex = t.pageEdgeInset * W, ey = t.pageEdgeInset * H;
      lines.push(seg(ex, ey, W - ex, ey), seg(ex, H - ey, W - ex, H - ey), seg(ex, ey, ex, H - ey), seg(W - ex, ey, W - ex, H - ey));
    }
    if (rng.chance(0.5)) {
      const n = rng.int(4, 8);
      for (let k = 0; k < n; k++) {
        const x = bx0 + (bw * (k + 0.5)) / n;
        tokens.push(tok(String(k + 1), x, by0 / 2, textH), tok(String(k + 1), x, (H + by1) / 2, textH));
      }
    }
  }

  // decoys: template-level first, then per sheet
  const decoys = new Set<DecoyKind>();
  if (t.boilerplate) decoys.add("boilerplate");
  if (t.doubleRule) decoys.add("double-rule");
  for (const k of PER_SHEET_DECOYS) if (forced.includes(k) || rng.chance(0.25)) decoys.add(k);
  if (!tb || tb.frame === "none" || t.borderless) decoys.delete("legend-column");
  if (tb && tb.edge === "top" && tb.d > 0.22) decoys.delete("top-rule-26");
  if (decoys.has("sheetno-in-drawing") && (!tb || tb.frame === "none")) decoys.add("viewport-frame");

  let fields: SynthFields | null = null;
  let sheetNo: string | null = null;
  if (tb) {
    const { edge, d } = tb;
    const at = (u: number, v: number) => fromStripUV(edge, border, u, v);
    const put = (str: string, u: number, vf: number, hk: number) => {
      const [x, y] = at(u + jit(), vf * d);
      tokens.push(tok(str, x, y, textH * hk, tb.rot));
    };
    // frame: chain of cell tops at depth d, dividers down to the border
    if (tb.frame !== "none") {
      const stops = [tb.lo, ...tb.dividers, 1];
      for (let k = 0; k + 1 < stops.length; k++) {
        const [xa, ya] = at(stops[k], d), [xb, yb] = at(stops[k + 1], d);
        lines.push(seg(xa, ya, xb, yb));
      }
      for (const u of tb.frame === "partial" ? [tb.lo, ...tb.dividers] : tb.dividers) {
        const [xa, ya] = at(u, 0), [xb, yb] = at(u, d);
        lines.push(seg(xa, ya, xb, yb));
      }
      const [xa, ya] = at(tb.titleStart, 0.5 * d), [xb, yb] = at(tb.lastStart, 0.5 * d);
      lines.push(seg(xa, ya, xb, yb));
    }
    for (const s of tb.statics) put(s.str, s.u, s.vf, s.hk);
    // changing fields
    sheetNo = SHEETNO_STYLES[tb.sheetNoStyle](i);
    if (!TB_SHEETNO_RE.test(sheetNo)) throw new Error(`regionSynth: bad sheet number ${sheetNo}`);
    const title = TITLES[i % TITLES.length] + (i >= TITLES.length ? ` ${Math.floor(i / TITLES.length) + 1}` : "");
    const date = `${pad2(9 + (i % 3))}/${pad2(1 + 7 * (i % 3))}/2026`;
    fields = { sheetNo, title, date };
    put(sheetNo, tb.lastStart + (1 - tb.lastStart) * 0.5, rng.range(0.3, 0.45), tb.sheetNoHk);
    put(title, tb.titleStart + (tb.lastStart - tb.titleStart) * 0.5, 0.3, 1.8);
    put(date, tb.titleStart + (tb.lastStart - tb.titleStart) * 0.6, 0.62, 1);
    put(`${i + 1} OF ${rng.int(i + 1, i + 40)}`, tb.lastStart + (1 - tb.lastStart) * 0.5, 0.92, 0.8);
    // revision rows (noise)
    const revU = tb.frame === "partial" ? tb.lo * 0.5 : 0.05;
    const nRev = rng.int(0, 3);
    for (let r = 0; r < nRev; r++) {
      const vf = 0.15 + 0.2 * r;
      put(String(r + 1), revU - 0.03, vf, 0.9);
      put(rng.pick(["ADDENDUM 1", "BID SET", "RFI RESPONSE", "PERMIT SET"]), revU, vf, 0.9);
      put(`${pad2(rng.int(1, 12))}/${pad2(rng.int(1, 28))}/2026`, revU + 0.035, vf, 0.9);
    }
    if (t.boilerplate) {
      const [x1, y1] = at(0.55, 0.03), [x2, y2] = at(0.55, 0.055);
      tokens.push(tok(BOILERPLATE, x1, y1, textH, tb.rot), tok(BOILERPLATE_2, x2, y2, textH, tb.rot));
    }
  } else if (t.boilerplate) {
    tokens.push(tok(BOILERPLATE_2, bx0 + 0.75 * bw, by1 - 0.05 * bh, textH), tok(BOILERPLATE, bx0 + 0.75 * bw, by1 - 0.03 * bh, textH));
  }

  const db = drawingBox(t);
  const [dx0, dy0, dx1, dy1] = db;
  // cover / index sheets carry a large project title
  if (!tb) tokens.push(tok(rng.pick(["COVER SHEET", "DRAWING INDEX", "GENERAL INFORMATION"]), (dx0 + dx1) / 2, dy0 + 0.1 * bh, textH * 4));

  if (decoys.has("legend-column") && tb) {
    const side = rng.range(0.08, 0.14);
    const uL = rng.chance(0.6) ? 1 - side : side;
    const uB = uL > 0.5 ? 1 : 0;
    const vlo = tb.d + rng.range(0.02, 0.06);
    const at = (u: number, v: number) => fromStripUV(tb.edge, border, u, v);
    const [xa, ya] = at(uL, 1), [xb, yb] = at(uL, vlo), [xc, yc] = at(uB, vlo);
    lines.push(seg(xa, ya, xb, yb), seg(xb, yb, xc, yc));
    const uc = (uL + uB) / 2;
    const n = rng.int(4, 12);
    const legend = ["LEGEND", "GENERAL NOTES", ...Array.from({ length: n }, (_, k) => `${k + 1}. ${rng.pick(["VERIFY ALL DIMENSIONS IN FIELD.", "PATCH AND PAINT TO MATCH.", "SEE SPECIFICATIONS.", "PROVIDE BLOCKING AS REQUIRED."])}`)];
    legend.forEach((s, k) => {
      const [x, y] = at(uc, 1 - 0.03 - ((1 - 0.03 - vlo - 0.02) * k) / legend.length);
      tokens.push(tok(s, x, y, textH * (k < 2 ? 1.3 : 0.9)));
    });
  }
  let viewport: Box | null = null;
  if (decoys.has("viewport-frame")) {
    const vw = Math.min(rng.range(0.18, 0.3) * bw, 0.9 * (dx1 - dx0));
    const vh = Math.min(rng.range(0.18, 0.3) * bh, 0.9 * (dy1 - dy0 - 0.05 * bh));
    const x0 = rng.range(dx0, dx1 - vw), y0 = rng.range(dy0, dy1 - 0.05 * bh - vh);
    viewport = [x0, y0, x0 + vw, y0 + vh];
    lines.push(seg(x0, y0, x0 + vw, y0), seg(x0, y0 + vh, x0 + vw, y0 + vh), seg(x0, y0, x0, y0 + vh), seg(x0 + vw, y0, x0 + vw, y0 + vh));
    tokens.push(tok(rng.pick(["FLOOR PLAN", "ENLARGED PLAN", "PARTIAL PLAN", "SECTION"]), x0 + vw * 0.5, y0 + vh + 0.012 * bh, textH * 1.4),
      tok(`SCALE: ${rng.pick(["1/8\" = 1'-0\"", "1/4\" = 1'-0\"", "1\" = 20'-0\""])}`, x0 + vw * 0.5, y0 + vh + 0.028 * bh, textH));
  }
  if (decoys.has("schedule-table")) {
    const tw = Math.min(rng.range(0.32, 0.45) * bw, dx1 - dx0);
    const rows = rng.int(5, 10), cols = rng.int(3, 6);
    const rh = 2.4 * textH, th = rows * rh;
    const x0 = rng.range(dx0, dx1 - tw), y0 = rng.range(dy0, Math.max(dy0, dy1 - th));
    for (let r = 0; r <= rows; r++) lines.push(seg(x0, y0 + r * rh, x0 + tw, y0 + r * rh));
    for (let c = 0; c <= cols; c++) lines.push(seg(x0 + (tw * c) / cols, y0, x0 + (tw * c) / cols, y0 + th));
    tokens.push(tok(rng.pick(["FINISH SCHEDULE", "DOOR SCHEDULE", "ROOM SCHEDULE"]), x0 + tw / 2, y0 + 0.5 * rh, textH * 1.2));
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = c === 0 ? String(100 + r) : rng.pick(["LVT-1", "CPT-2", "RB-1", "PT-3", "ACT-1", "EXIST.", "--"]);
        tokens.push(tok(s, x0 + (tw * (c + 0.5)) / cols, y0 + (r + 0.5) * rh, textH * 0.9));
      }
    }
  }
  if (decoys.has("top-rule-26")) lines.push(seg(bx0, by0 + 0.26 * bh, bx1, by0 + 0.26 * bh));
  if (decoys.has("sheetno-in-drawing")) {
    const s = rng.pick(DETAIL_TAGS);
    const h = textH * (tb ? tb.sheetNoHk : 3.5) * rng.range(0.9, 1.3);
    if (tb && tb.frame !== "none") {
      const [x, y] = fromStripUV(tb.edge, border, rng.range(tb.lo + 0.02, 0.95), tb.d + rng.range(0.01, 0.025));
      tokens.push(tok(s, x, y, h));
    } else if (viewport) {
      tokens.push(tok(s, viewport[0] + 0.06 * (viewport[2] - viewport[0]), viewport[3] + 0.012 * bh, h));
    }
  }

  // drawing-area text noise
  const nNoise = rng.int(20, 150);
  for (let k = 0; k < nNoise; k++) {
    tokens.push(tok(rng.pick(NOISE), rng.range(dx0, dx1), rng.range(dy0, dy1), textH * rng.range(0.8, 1.2), rng.chance(0.15) ? 90 : 0));
  }

  const sheet: DetectSheet = { key, w: W, h: H, pageIn: [t.pageIn[0], t.pageIn[1]], tokens, lines, source: "vector" };
  const truth: Truth | null = tb && t.firm ? { edge: tb.edge, d: tb.d, border: [...border], family: t.firm.id } : null;
  const meta: SynthMeta = {
    border: [...border], borderless: t.borderless,
    frame: tb ? tb.frame : "none", cover: tb && tb.frame !== "none" ? tb.cover : null,
    decoys: DECOY_KINDS.filter((k) => decoys.has(k)),
    pageEdgeRules: t.pageEdgeRules, sheetNo, fields,
    group: t.firm ? t.firm.id : "none",
  };
  return { sheet, truth, meta };
}

/** A letter-size hand sketch: no border, no title block, a few rules. */
function letterSketch(rng: Rng, key: string): SynthSheet {
  const W = 8.5 * PX_PER_IN, H = 11 * PX_PER_IN, th = 0.01 * W;
  const tokens = [tok("SK-1", 0.8 * W, 0.93 * H, th * 2.5), tok("PARTIAL PLAN", 0.5 * W, 0.08 * H, th * 1.5), tok("NOT TO SCALE", 0.5 * W, 0.11 * H, th)];
  const n = rng.int(5, 15);
  for (let k = 0; k < n; k++) tokens.push(tok(rng.pick(NOISE), rng.range(0.15, 0.85) * W, rng.range(0.2, 0.85) * H, th));
  const x0 = rng.range(0.1, 0.2) * W, y0 = rng.range(0.15, 0.25) * H, x1 = rng.range(0.7, 0.9) * W, y1 = rng.range(0.7, 0.85) * H;
  const lines = [seg(x0, y0, x1, y0), seg(x0, y1, x1, y1), seg(x0, y0, x0, y1), seg(x1, y0, x1, y1)];
  return {
    sheet: { key, w: W, h: H, pageIn: [8.5, 11], tokens, lines, source: "vector" },
    truth: null,
    meta: { border: [0, 0, W, H], borderless: true, frame: "none", cover: null, decoys: [], pageEdgeRules: false, sheetNo: null, fields: null, group: "sketch" },
  };
}

function oneFirm(name: string, seed: number, n: number, o: TemplateOpts, cycleDecoys = false): SynthSet {
  const rng = new Rng(seed);
  const t = makeTemplate(rng, o);
  const sheets = Array.from({ length: n }, (_, i) =>
    genSheet(t, rng, i, sheetKey(name, i), cycleDecoys ? [PER_SHEET_DECOYS[i % PER_SHEET_DECOYS.length]] : []));
  return { name, seed, sheets, firms: [t.firm!], expectGroups: 1 };
}

// ── named sets ──────────────────────────────────────────────────────────────
/** One firm, 24 sheets, right-edge partial frame, every decoy kind present → 1 group. */
export function uniformSet24(seed = 24001): SynthSet {
  return oneFirm("uniform24", seed, 24, { edge: "right", frame: "partial", pageIn: [36, 24], doubleRule: true, boilerplate: true, pageEdgeRules: true }, true);
}
/** One firm, bottom strip, 5 sheets → 1 group. */
export function bottomStripSet5(seed = 5001): SynthSet {
  return oneFirm("bottom5", seed, 5, { edge: "bottom", frame: "full" });
}
/** 3 sheets of firm A (right) + 2 of firm B (bottom) + 1 letter sketch → 3 groups. */
export function mixedSet(seed = 6001): SynthSet {
  const rng = new Rng(seed);
  const [na, nb] = rng.take(FIRM_NAMES, 2);
  const a = makeTemplate(rng, { edge: "right", frame: "partial", firmName: na, boilerplate: true, pageIn: [36, 24] });
  const b = makeTemplate(rng, { edge: "bottom", frame: "full", firmName: nb, boilerplate: true, pageIn: [42, 30] });
  const sheets = [
    ...[0, 1, 2].map((i) => genSheet(a, rng, i, sheetKey("mixed", i))),
    ...[0, 1].map((i) => genSheet(b, rng, i, sheetKey("mixed", 3 + i))),
    letterSketch(rng, sheetKey("mixed", 5)),
  ];
  return { name: "mixed", seed, sheets, firms: [a.firm!, b.firm!], expectGroups: 3 };
}
/** 2 + 2 small consultants: same page, border and edge, d within 1.2%, the
 * same project and agency boilerplate, different firms and bottom blocks →
 * 2 groups (must not merge). */
export function smallConsultantsSet(seed = 4001): SynthSet {
  const rng = new Rng(seed);
  const [na, nb] = rng.take(FIRM_NAMES, 2);
  const project = makeProject(rng);
  const [la, lb] = rng.take([0, 1, 2, 3], 2);
  const a = makeTemplate(rng, { edge: "bottom", frame: "full", firmName: na, labelStyle: la, project, boilerplate: true, pageIn: [36, 24] });
  const b = makeTemplate(rng, {
    edge: "bottom", frame: "partial", firmName: nb, labelStyle: lb, project, boilerplate: true, pageIn: [36, 24],
    border: [...a.border], pageEdgeRules: a.pageEdgeRules, doubleRule: a.doubleRule,
    d: Math.min(0.245, Math.max(0.085, a.tb!.d + rng.range(-0.012, 0.012))),
  });
  const sheets = [
    ...[0, 1].map((i) => genSheet(a, rng, i, sheetKey("consultants", i))),
    ...[0, 1].map((i) => genSheet(b, rng, i, sheetKey("consultants", 2 + i))),
  ];
  return { name: "consultants", seed, sheets, firms: [a.firm!, b.firm!], expectGroups: 2 };
}
export function singleSheetSet(seed = 1001): SynthSet {
  return oneFirm("single", seed, 1, { edge: "bottom", frame: "full" });
}
export function twoSheetSet(seed = 2001): SynthSet {
  return oneFirm("two", seed, 2, { edge: "right", frame: "partial" });
}
/** 3 bordered sheets without a title block (cover, index) → truth null; each
 * is its own group. */
export function noTitleBlockSet(seed = 3001): SynthSet {
  const rng = new Rng(seed);
  const sheets = [0, 1, 2].map((i) => genSheet(makeTemplate(rng, { noTitleBlock: true, pageIn: [36, 24] }), rng, i, sheetKey("notb", i),
    i === 0 ? ["sheetno-in-drawing", "schedule-table"] : []));
  return { name: "notb", seed, sheets, firms: [], expectGroups: 3 };
}
/** 4 borderless sheets of one firm: bottom title block with no rules at all
 * (repetition is the only evidence) → 1 group. */
export function borderlessSet(seed = 7001): SynthSet {
  return oneFirm("borderless", seed, 4, { edge: "bottom", frame: "none", borderless: true });
}
export function leftEdgeSet(seed = 8001): SynthSet {
  return oneFirm("left5", seed, 5, { edge: "left", frame: "partial" });
}
export function topEdgeSet(seed = 9001): SynthSet {
  return oneFirm("top5", seed, 5, { edge: "top", frame: "full" });
}
/** 1–3 firms with random edge, page, border, d and frame, 1–6 sheets each,
 * plus sometimes a cover sheet without a title block. */
export function randomSet(seed: number): SynthSet {
  const rng = new Rng(seed);
  const names = rng.take(FIRM_NAMES, rng.int(1, 3));
  const sheets: SynthSheet[] = [];
  const firms: Firm[] = [];
  let covers = 0;
  if (rng.chance(0.3)) {
    sheets.push(genSheet(makeTemplate(rng, { noTitleBlock: true }), rng, 0, sheetKey(`random${seed}`, 0)));
    covers++;
  }
  for (const firmName of names) {
    const t = makeTemplate(rng, { firmName });
    firms.push(t.firm!);
    const n = rng.int(1, 6);
    for (let i = 0; i < n; i++) sheets.push(genSheet(t, rng, i, sheetKey(`random${seed}`, sheets.length)));
  }
  return { name: `random${seed}`, seed, sheets, firms, expectGroups: firms.length + covers };
}
