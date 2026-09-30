// FROZEN: do not change after this commit; detector tests depend on it.
//
// Seeded synthetic sheet sets for the region detector (piece 2a), built as
// `DetectSheet` objects directly — no PDF. Spec: docs/design/
// REGION_ANNOTATION_PLAN.md, "Synthetic sets (unit tests)". Results on these
// sets are self-consistency, never accuracy; left and top title blocks are
// covered only here. TB_SHEETNO_RE is copied here on purpose, so a later
// change to the detector's pattern cannot silently change these sets.
//
// Every generated sheet is `{ sheet, truth, meta }`:
//   - `sheet` is exactly what the detector sees (DetectSheet);
//   - `truth` is `{ edge, d, border, family }` for the real title block, or
//     null when the sheet has none. It never goes inside `sheet`;
//   - `meta` records how the sheet was built and what the detector should do:
//     `meta.expect` is
//       "find"            find the truth strip;
//       "no-rule-A"       truth is a real title block, but its number is out of
//                         the far-end/outer zone, so rule A must not fire (a
//                         single sheet then abstains; a ≥3-sheet set may still
//                         accept through rule B);
//       "tie-break-area"  a false candidate also passes rule A with no other
//                         rule; the truth strip must win on smaller area
//                         (`meta.falseStrips` lists the rival);
//       "abstain"         no title block should be output: truth null, or a
//                         real strip with one signal only / < 15 tokens;
//     and `meta.why` is a short code for any expect other than "find":
//       wrong-zone-near, wrong-zone-deep, grid-legal, area-crossing,
//       frame-only, repeat-only, sparse, no-title-block, grid-no-title-block.
// d is a fraction of the border-box dimension perpendicular to the edge,
// measured from the border. Coordinates are image px at RENDER_SCALE 2
// (144 px per inch), displayed orientation. "u" runs along the edge from the
// near border end (0) to the far end (1: bottom for right/left, right for
// top/bottom); "v" is the depth from the edge's border side.
//
// Layout, varied independently of the detector's features:
//   d 8–25%; border 1–7% per side; per-sheet frame jitter ±0.3% (d and each
//   border side); page size; edge; page-edge rules outside the border; a
//   missing border side (the side opposite the title block; truth then uses
//   the page edge there, as step 1 does); Porterville-style top/bottom border
//   rules spanning 80–85% and stopping on a right title strip's inner rule;
//   strip token counts 15–170 (some near 15); drawing noise, margin grid
//   labels, strip filler. Drawing noise never matches TB_SHEETNO_RE, so every
//   pattern match on a sheet is deliberate.
// Sheet number: TB_SHEETNO_RE, the largest match in the strip; its height
//   ratio to other in-strip matches varies (about 1.08–5.6×). Legal placement: u in
//   the far-end half of the chain extent and ≥ 0.5, v in 5–60% of d.
// Frames: full chains of cell tops; partial chains covering 70–80%,
//   anchored at the far end or the near end, with a divider from the free end
//   down to the border; joinable gaps of 0.2–0.45% and breaks of 0.6–0.8%
//   (`meta.chainGaps`, `joins`), a break only where the border-touching run
//   still covers ≥ 70%.
//
// Decoys (`meta.decoys`). Per sheet, drawn at random on "find" sheets
// (uniformSet24 forces each in turn):
//   legend-column      a side column perpendicular to the edge, 6–30% from an
//                      adjacent side, from the opposite border to 2–6% short
//                      of the chain, closed back to its side border;
//   legend-column-t    the same column ending exactly on the chain (T-junction);
//   schedule-table     a 32–45%-wide table in the drawing (finish tags such as
//                      LVT-1 in its cells on title-block sheets);
//   wide-table         a table 85–100% of the drawing width, not touching the
//                      border;
//   flush-table        a table against the top or bottom border, touching a
//                      side border (or ending on a side title block's chain),
//                      its farthest rule at 6–30% from that border; no
//                      pattern text in it;
//   viewport-frame     a rectangle in the drawing with a "SCALE:" title;
//   top-rule-26        a border-to-border rule 26% below the top border;
//   sheetno-in-drawing a sheet-number-like tag in the drawing, 1–2.5% beyond
//                      the chain at u 0.35–0.65 (or above a short rule mid-sheet
//                      when there is no chain), sometimes taller than the
//                      sheet number.
// Per family: boilerplate (BOILERPLATE and "DEPARTMENT OF VETERANS AFFAIRS"
//   at the same border-normalized spot for every firm), double-rule (a second
//   rule 3 px inside each border side).
// Set-specific (SET_DECOY_KINDS), described by `meta.falseStrips`:
//   detail-grid        S501-style false full-span chains at 20–26% depth;
//   crossing-rule      Dublin part 1 p5-style full-height rule crossing a
//                      bottom title block at 83–85% of the border width.
//
// Sets (default seeds fixed):
//   uniformSet24 24/1 family, right, partial far-anchored, all decoys  find
//   bottomStripSet5 5, bottom, full, with a chain break                  find
//   mixedSet 3 right + 2 bottom + letter sketch (3 families)            find/abstain
//   smallConsultantsSet 2 + 2 different bottom blocks, must not merge   find
//   singleSheetSet 1; twoSheetSet 2                                      find
//   noTitleBlockSet 3 bordered covers, each its own group               abstain
//   borderlessSet 4, bottom, no rules at all (rule C only)               find
//   leftEdgeSet 5; topEdgeSet 5 (full); topPartialSet 3 (near-anchored) find
//   wrongZoneSet 3 (number in the near half)                           no-rule-A
//   wrongZoneDeepSet 1 (number at ≥ 70% of the depth)                  no-rule-A
//   gridDecoySet 1: S501 grid, false top/left/right chains, deep tags    find
//   gridLegalDecoySet 1: false top chain with a legal tag     tie-break-area
//   gridNoTitleBlockSet 1: grid on four edges, deep tags, no block      abstain
//   areaTieBreakSet 2: crossing rule, same number in both strips tie-break-area
//   frameOnlySet 1 (dense framed strip, no number)                      abstain
//   repeatOnlySet 4 (no frame, no number; groups undefined)             abstain
//   sparseStripSet 1 (frame + number, < 15 strip tokens)                abstain
//   shortBorderSet 3 (Porterville border); missingSideSet 3              find
//   randomSet(seed): 1–3 random firms, sometimes a cover              find/abstain

import type { DetectLine, DetectSheet, DetectToken, Edge } from "../../src/lib/regionDetect.ts";

/** Frozen copy of the detector's sheet-number pattern at the time of writing. */
export const TB_SHEETNO_RE = /^[A-Z]{1,3}\d?[-. ]?\d{1,3}(\.\d{1,2})?[A-Z]?$/;

export type Box = [number, number, number, number];
export type DecoyKind =
  | "legend-column" | "legend-column-t" | "schedule-table" | "wide-table" | "flush-table"
  | "viewport-frame" | "top-rule-26" | "sheetno-in-drawing" | "boilerplate" | "double-rule"
  | "detail-grid" | "crossing-rule";
export const DECOY_KINDS: readonly DecoyKind[] = [
  "legend-column", "legend-column-t", "schedule-table", "wide-table", "flush-table",
  "viewport-frame", "top-rule-26", "sheetno-in-drawing", "boilerplate", "double-rule",
  "detail-grid", "crossing-rule",
];
export const SET_DECOY_KINDS: readonly DecoyKind[] = ["detail-grid", "crossing-rule"];
const PER_SHEET_DECOYS: readonly DecoyKind[] = [
  "legend-column", "legend-column-t", "schedule-table", "wide-table", "flush-table",
  "viewport-frame", "top-rule-26", "sheetno-in-drawing",
];
export const BOILERPLATE = "VA FORM 08-6231";
const BOILERPLATE_2 = "DEPARTMENT OF VETERANS AFFAIRS";

export type Expect = "find" | "no-rule-A" | "tie-break-area" | "abstain";
export interface Truth { edge: Edge; d: number; border: Box; family: string }
export interface SynthFields { sheetNo: string | null; title: string; date: string }
export interface ChainGap { u: number; gap: number; joins: boolean }     // hole [u, u + gap] in the chain
export interface FalseStrip { edge: Edge; d: number; u0: number; u1: number; passesA: boolean }
export interface SynthMeta {
  border: Box;                          // the border box as step 1 should find it
  borderless: boolean;
  borderMissing: Edge | null;           // side without a rule (border at the page edge)
  shortBorder: boolean;                 // top/bottom rules stop on a right strip's chain
  frame: "full" | "partial" | "none";
  anchor: "far" | "near" | "both" | null;
  cover: number | null;                 // chain extent along the edge
  chainExtent: [number, number] | null; // [lo, hi] in u
  chainGaps: ChainGap[];
  decoys: DecoyKind[];                  // in DECOY_KINDS order
  falseStrips: FalseStrip[];
  pageEdgeRules: boolean;
  sheetNo: string | null;
  fields: SynthFields | null;
  group: string;                        // expected family label ("none": no title block)
  expect: Expect;
  why: string;                          // "" for "find"
}
export interface SynthSheet { sheet: DetectSheet; truth: Truth | null; meta: SynthMeta }
export interface Firm { id: string; statics: string[] }   // statics exclude the shared boilerplate
export interface SynthSet { name: string; seed: number; sheets: SynthSheet[]; firms: Firm[]; expectGroups: number | null }

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

/** Image px → strip coordinates [u, v] for an edge of a border box (see header). */
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
function fromUV(edge: Edge, border: Box, u: number, v: number): [number, number] {
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
function uvSeg(edge: Edge, border: Box, u0: number, v0: number, u1: number, v1: number): DetectLine {
  const [xa, ya] = fromUV(edge, border, u0, v0), [xb, yb] = fromUV(edge, border, u1, v1);
  return seg(xa, ya, xb, yb);
}
function tok(str: string, cx: number, cy: number, h: number, rot = 0): DetectToken {
  const w = 0.6 * h * str.length;
  const [c, s] = trig(rot);
  return { str, x: cx - (c * w) / 2 - (s * h) / 2, y: cy - (s * w) / 2 + (c * h) / 2, w, h, rot };
}
const OPPOSITE: Record<Edge, Edge> = { right: "left", left: "right", top: "bottom", bottom: "top" };

// ── vocabulary (drawing noise and filler never match TB_SHEETNO_RE) ─────────
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
const NOISE = ["OFFICE", "CORRIDOR", "STOR.", "MECH", "TOILET", "LOBBY", "12'-4\"", "8'-0\"", "101", "102", "EXISTING WALL", "TYP.", "EQ", "N.I.C.", "CLOSET", "NURSE STA.", "EXAM", "3'-6\"", "SEE DETAIL", "UP", "DN"];
const FILLER = ["NOT FOR CONSTRUCTION", "ISSUED FOR BID", "CONSULTANT", "KEY PLAN", "STAMP", "REVISIONS", "DESCRIPTION", "NO.", "MARK", "ADDENDUM 1", "BID SET", "PERMIT SET", "RFI RESPONSE", "SEAL", "NORTH", "PROJECT NUMBER", "CAD FILE", "SCALE: AS NOTED"];
const NOTES = ["VERIFY ALL DIMENSIONS IN FIELD.", "PATCH AND PAINT TO MATCH.", "SEE SPECIFICATIONS.", "PROVIDE BLOCKING AS REQUIRED.", "COORDINATE WITH MEP.", "ALL WORK PER CODE."];
const TABLE_WORDS = ["CARPET", "VINYL", "PAINT", "EXIST.", "--", "101", "102", "OAK", "HM"];
const FINISH_TAGS = ["LVT-1", "CPT-2", "RB-1", "PT-3", "ACT-1"];
const DETAIL_TAGS = ["A5", "B10", "D-3", "A-501", "C4", "S2.1"];
const KEY_TAGS = ["A1", "B2", "K-1", "P1.1"];
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
type Special = "grid" | "grid-legal" | "grid-no-tb" | "area" | null;
interface TitleBlock {
  edge: Edge; d: number; frame: "full" | "partial" | "none"; anchor: "far" | "near" | "both" | null;
  lo: number; hi: number; dividers: number[]; gaps: ChainGap[]; rot: number;
  statics: Slot[]; keyTags: Slot[]; title: [number, number]; date: [number, number];
  sheetNoMode: "legal" | "near" | "deep" | "none"; sheetNoUV: [number, number];
  sheetNoStyle: number; sheetNoHk: number; stripTarget: number;
}
interface Template {
  pageIn: [number, number]; W: number; H: number; textH: number;
  borderless: boolean; border: Box; borderMissing: Edge | null; drawnMissing: number; shortBorder: boolean;
  pageEdgeRules: boolean; pageEdgeInset: number; doubleRule: boolean; boilerplate: boolean;
  tb: TitleBlock | null; firm: Firm | null; expect: Expect; why: string;
  randomDecoys: boolean; special: Special; sp: Record<string, number>;
}
interface TemplateOpts {
  edge?: Edge; pageIn?: [number, number]; borderless?: boolean; frame?: "full" | "partial" | "none";
  anchor?: "far" | "near"; border?: Box; d?: number; dRange?: [number, number];
  doubleRule?: boolean; boilerplate?: boolean; pageEdgeRules?: boolean;
  labelStyle?: number; sheetNoStyle?: number; project?: string[]; firmName?: string; noTitleBlock?: boolean;
  borderMissing?: boolean; shortBorder?: boolean; gaps?: "join" | "break" | "none";
  sheetNoMode?: "legal" | "near" | "deep" | "none"; stripTarget?: [number, number];
  expect?: Expect; why?: string; randomDecoys?: boolean; special?: Special;
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
  const m = () => rng.range(0.015, 0.065);
  const border: Box = o.border ? [...o.border] : borderless ? [0, 0, W, H] : [m() * W, m() * H, W - m() * W, H - m() * H];
  const noTB = o.noTitleBlock ?? false;
  const edge = o.edge ?? rng.pick(EDGES);
  const shortBorder = !noTB && !borderless && edge === "right" && (o.shortBorder ?? false);
  const missing = !noTB && !borderless && !shortBorder && (o.borderMissing ?? false);
  const borderMissing = missing ? OPPOSITE[edge] : null;
  let drawnMissing = 0;
  if (borderMissing) {   // the drawn position of the missing rule's neighbours' ends; truth uses the page edge
    const k = { left: 0, top: 1, right: 2, bottom: 3 }[borderMissing];
    drawnMissing = border[k];
    border[k] = k === 0 || k === 1 ? 0 : k === 2 ? W : H;
  }
  const plain = !borderless && !borderMissing;
  const pageEdgeRules = plain && (o.pageEdgeRules ?? rng.chance(0.4));
  const pageEdgeInset = rng.range(0.003, 0.006);
  const doubleRule = plain && !shortBorder && (o.doubleRule ?? rng.chance(0.3));
  const boilerplate = o.boilerplate ?? rng.chance(0.5);
  const base = {
    pageIn, W, H, textH, borderless, border, borderMissing, drawnMissing, shortBorder, pageEdgeRules, pageEdgeInset,
    doubleRule, boilerplate, expect: o.expect ?? "find", why: o.why ?? "", randomDecoys: o.randomDecoys ?? true,
    special: o.special ?? null, sp: {} as Record<string, number>,
  };
  if (noTB) return { ...base, tb: null, firm: null, expect: o.expect ?? "abstain", why: o.why ?? "no-title-block" };

  const [dlo, dhi] = o.dRange ?? (shortBorder ? [0.153, 0.197] : [0.085, 0.245]);
  const d = o.d ?? rng.range(dlo, dhi);
  const frame = borderless ? "none" : o.frame ?? (rng.chance(0.1) ? "none" : rng.chance(0.5) ? "full" : "partial");
  const cover = frame === "partial" ? rng.range(0.71, 0.79) : 1;
  const anchor = frame === "none" ? null : frame === "full" ? "both" : o.anchor ?? (rng.chance(0.5) ? "far" : "near");
  const lo = anchor === "far" ? 1 - cover : 0;
  const hi = anchor === "near" ? cover : 1;
  const nDiv = rng.int(2, 5);
  const dividers = Array.from({ length: nDiv }, () => rng.range(lo + 0.04, hi - 0.04)).sort((a, b) => a - b);
  // chain gaps
  const gaps: ChainGap[] = [];
  const gapMode = o.gaps ?? (rng.chance(0.35) ? "join" : frame === "full" && rng.chance(0.25) ? "break" : "none");
  if (frame !== "none") {
    if (gapMode === "break" && frame === "full") gaps.push({ u: rng.range(0.05, 0.2), gap: rng.range(0.006, 0.0078), joins: false });
    if (gapMode === "join" || gapMode === "break") {
      const n = gapMode === "join" ? rng.int(1, 3) : rng.int(0, 1);
      for (let k = 0; k < n; k++) {
        const u = rng.range(Math.max(lo + 0.05, 0.25), hi - 0.05), gap = rng.range(0.002, 0.0045);
        if (gaps.every((g) => u > g.u + g.gap + 0.02 || u + gap < g.u - 0.02)) gaps.push({ u, gap, joins: true });
      }
    }
    gaps.sort((a, b) => a.u - b.u);
  }
  const rot = edge === "right" ? (rng.chance(0.2) ? 270 : 0) : edge === "left" ? (rng.chance(0.2) ? 90 : 0) : 0;

  // strip content
  const [tlo, thi] = o.stripTarget ?? (rng.chance(0.3) ? [15, 17] : [23, 170]);
  const stripTarget = rng.int(tlo, thi);
  const small = stripTarget <= 22;
  const name = o.firmName ?? rng.pick(FIRM_NAMES);
  const [city, st] = rng.pick(CITIES);
  const firmStrs = [
    `${name} ${rng.pick(FIRM_SUFFIX)}`,
    `${rng.int(100, 9999)} ${rng.pick(STREETS)} STREET, SUITE ${rng.int(100, 900)}`,
    `${city}, ${st} ${rng.int(10000, 99999)}`,
    `TEL ${rng.int(200, 999)}.${rng.int(200, 999)}.${rng.int(1000, 9999)}`,
    `www.${name.toLowerCase()}.com`,
    `LICENSE NO. ${rng.int(10000, 99999)}`,
  ].slice(0, small ? 2 : rng.int(3, 6));
  const project = (o.project ?? makeProject(rng)).slice(0, small ? 1 : 2);
  const labels = LABEL_STYLES[o.labelStyle ?? rng.int(0, LABEL_STYLES.length - 1)].slice(0, small ? 2 : rng.int(3, 5));
  const slot = (str: string, hk: number): Slot => ({ str, u: rng.range(0.03, 0.97), vf: rng.range(0.1, 0.9), hk });
  const statics = [...firmStrs.map((s, j) => slot(s, j === 0 ? 1.7 : 1)), ...project.map((s) => slot(s, 1.3)), ...labels.map((s) => slot(s, 0.8))];

  const sheetNoMode = o.sheetNoMode ?? "legal";
  const sheetNoHk = rng.range(1.8, 4.5);
  let sheetNoUV: [number, number];
  if (sheetNoMode === "near") sheetNoUV = [rng.range(0.05, 0.45), rng.range(0.1, 0.5)];
  else if (sheetNoMode === "deep") sheetNoUV = [rng.range(0.55, 0.95), rng.range(0.72, 0.92)];
  else {
    const uMin = anchor === "far" ? Math.max(0.5, (lo + 1) / 2) : anchor === "near" ? Math.max(0.5, hi / 2) : 0.5;
    const uMax = anchor === "near" ? hi - 0.02 : 0.97;
    sheetNoUV = [rng.range(uMin + 0.005, uMax), rng.range(0.06, 0.58)];
  }
  const nKey = sheetNoMode === "none" || small ? (small && rng.chance(0.5) && sheetNoMode !== "none" ? 1 : 0) : rng.int(0, 2);
  const keyTags = Array.from({ length: nKey }, () => slot(rng.pick(KEY_TAGS), rng.range(0.8, Math.min(2.8, sheetNoHk / 1.08))));
  const tb: TitleBlock = {
    edge, d, frame, anchor, lo, hi, dividers, gaps, rot, statics, keyTags,
    title: [rng.range(0.3, 0.9), rng.range(0.15, 0.85)], date: [rng.range(0.3, 0.9), rng.range(0.15, 0.85)],
    sheetNoMode, sheetNoUV, sheetNoStyle: o.sheetNoStyle ?? rng.int(0, SHEETNO_STYLES.length - 1), sheetNoHk, stripTarget,
  };
  const firm: Firm = { id: `${name.toLowerCase()}-${rng.int(100, 999)}`, statics: statics.map((s) => s.str) };
  return { ...base, tb, firm };
}

// ── sheets ──────────────────────────────────────────────────────────────────
function sheetKey(file: string, i: number): string {
  return i === 0 ? `${file}.pdf` : `${file}.pdf#${i + 1}`;
}

function compatible(k: DecoyKind, set: Set<DecoyKind>, t: Template): boolean {
  const tb = t.tb;
  const plain = !t.borderless && !t.borderMissing;
  const legend = set.has("legend-column") || set.has("legend-column-t");
  switch (k) {
    case "legend-column": case "legend-column-t":
      return !!tb && tb.frame !== "none" && plain && !legend && !set.has("flush-table");
    case "flush-table":
      return plain && !legend && !set.has("top-rule-26") && !set.has("viewport-frame") && !set.has("schedule-table") && !set.has("wide-table");
    case "top-rule-26":
      return !(tb && tb.edge === "top" && tb.d > 0.22) && !set.has("flush-table");
    case "viewport-frame": case "schedule-table": case "wide-table":
      return !set.has("flush-table");
    default:
      return true;
  }
}

function genSheet(t: Template, rng: Rng, i: number, key: string, forced: DecoyKind[] = []): SynthSheet {
  const tokens: DetectToken[] = [];
  const lines: DetectLine[] = [];
  const { W, H, textH, tb } = t;
  // per-sheet frame jitter (±0.3% of the dimension); page-edge sides stay put
  const border: Box = [...t.border];
  const dims = [W, H, W, H];
  for (let k = 0; k < 4; k++) {
    const atEdge = border[k] === 0 || border[k] === dims[k];
    const j = rng.range(-0.003, 0.003);
    if (!atEdge) border[k] += j * dims[k];
  }
  const d = tb ? tb.d + rng.range(-0.003, 0.003) : 0;
  const [bx0, by0, bx1, by1] = border;
  const bw = bx1 - bx0, bh = by1 - by0;
  const edge = tb?.edge ?? "bottom";
  const at = (u: number, v: number) => fromUV(edge, border, u, v);
  const falseStrips: FalseStrip[] = [];

  // border rules
  if (!t.borderless) {
    const chainX = tb && t.shortBorder ? at(0, d)[0] : bx1;
    const sides: Record<Edge, DetectLine> = {
      top: seg(bx0, by0, chainX, by0), bottom: seg(bx0, by1, chainX, by1),
      left: seg(bx0, by0, bx0, by1), right: seg(bx1, by0, bx1, by1),
    };
    if (t.borderMissing) {
      const mJ = t.drawnMissing;   // neighbours stop where the missing rule would be
      if (t.borderMissing === "left") { sides.top = seg(mJ, by0, bx1, by0); sides.bottom = seg(mJ, by1, bx1, by1); }
      if (t.borderMissing === "right") { sides.top = seg(bx0, by0, mJ, by0); sides.bottom = seg(bx0, by1, mJ, by1); }
      if (t.borderMissing === "top") { sides.left = seg(bx0, mJ, bx0, by1); sides.right = seg(bx1, mJ, bx1, by1); }
      if (t.borderMissing === "bottom") { sides.left = seg(bx0, by0, bx0, mJ); sides.right = seg(bx1, by0, bx1, mJ); }
    }
    for (const e of EDGES) if (e !== t.borderMissing) lines.push(sides[e]);
    if (t.doubleRule) {
      lines.push(seg(bx0 + 3, by0 + 3, bx1 - 3, by0 + 3), seg(bx0 + 3, by1 - 3, bx1 - 3, by1 - 3),
        seg(bx0 + 3, by0 + 3, bx0 + 3, by1 - 3), seg(bx1 - 3, by0 + 3, bx1 - 3, by1 - 3));
    }
    if (t.pageEdgeRules) {
      const ex = t.pageEdgeInset * W, ey = t.pageEdgeInset * H;
      lines.push(seg(ex, ey, W - ex, ey), seg(ex, H - ey, W - ex, H - ey), seg(ex, ey, ex, H - ey), seg(W - ex, ey, W - ex, H - ey));
    }
    if (!t.borderMissing && rng.chance(0.5)) {
      const n = rng.int(4, 8);
      for (let k = 0; k < n; k++) {
        const x = bx0 + (bw * (k + 0.5)) / n;
        tokens.push(tok(String(k + 1), x, by0 / 2, textH), tok(String(k + 1), x, (H + by1) / 2, textH));
      }
    }
  }

  // decoys
  const decoys = new Set<DecoyKind>();
  if (t.boilerplate) decoys.add("boilerplate");
  if (t.doubleRule) decoys.add("double-rule");
  for (const k of forced) if (compatible(k, decoys, t)) decoys.add(k);
  if (t.randomDecoys) for (const k of PER_SHEET_DECOYS) if (!decoys.has(k) && rng.chance(0.2) && compatible(k, decoys, t)) decoys.add(k);
  if (t.special === "grid" || t.special === "grid-legal" || t.special === "grid-no-tb") decoys.add("detail-grid");
  if (t.special === "area") decoys.add("crossing-rule");
  const tagTables = !!tb;   // pattern text in tables only on title-block sheets

  let fields: SynthFields | null = null;
  let sheetNo: string | null = null;
  let chainExtent: [number, number] | null = null;
  if (tb) {
    const put = (str: string, u: number, vf: number, hk: number, jitter = true) => {
      const [x, y] = at(jitter ? u + rng.range(-0.002, 0.002) : u, vf * d);
      tokens.push(tok(str, x, y, textH * hk, tb.rot));
    };
    if (tb.frame !== "none") {
      chainExtent = [tb.lo, tb.hi];
      const cuts = new Set<number>([tb.lo, tb.hi, ...tb.dividers]);
      for (const g of tb.gaps) { cuts.add(g.u); cuts.add(g.u + g.gap); }
      const stops = [...cuts].sort((a, b) => a - b);
      for (let k = 0; k + 1 < stops.length; k++) {
        const mid = (stops[k] + stops[k + 1]) / 2;
        if (tb.gaps.some((g) => mid > g.u && mid < g.u + g.gap)) continue;
        lines.push(uvSeg(edge, border, stops[k], d, stops[k + 1], d));
      }
      const free = tb.anchor === "far" ? [tb.lo] : tb.anchor === "near" ? [tb.hi] : [];
      for (const u of [...free, ...tb.dividers]) lines.push(uvSeg(edge, border, u, 0, u, d));
      if (tb.dividers.length >= 2) lines.push(uvSeg(edge, border, tb.dividers[0], 0.5 * d, tb.dividers[1], 0.5 * d));
    }
    // content: statics, fields, key tags, boilerplate, filler to the target count
    let n = 0;
    for (const s of tb.statics) { put(s.str, s.u, s.vf, s.hk); n++; }
    for (const s of tb.keyTags) { put(s.str, s.u, s.vf, s.hk); n++; }
    const title = TITLES[i % TITLES.length] + (i >= TITLES.length ? ` ${Math.floor(i / TITLES.length) + 1}` : "");
    const date = `${pad2(9 + (i % 3))}/${pad2(1 + 7 * (i % 3))}/2026`;
    put(title, tb.title[0], tb.title[1], 1.5); put(date, tb.date[0], tb.date[1], 1); n += 2;
    if (tb.sheetNoMode !== "none") {
      sheetNo = SHEETNO_STYLES[tb.sheetNoStyle](i);
      if (!TB_SHEETNO_RE.test(sheetNo)) throw new Error(`regionSynth: bad sheet number ${sheetNo}`);
      put(sheetNo, tb.sheetNoUV[0], tb.sheetNoUV[1], tb.sheetNoHk, false);
      n++;
    }
    fields = { sheetNo, title, date };
    if (t.boilerplate) {
      const [x1, y1] = at(0.55, 0.03), [x2, y2] = at(0.55, 0.055);
      tokens.push(tok(BOILERPLATE, x1, y1, textH, tb.rot), tok(BOILERPLATE_2, x2, y2, textH, tb.rot));
      n += 2;
    }
    const fill = Math.max(0, tb.stripTarget - n) + (t.why === "sparse" ? 0 : rng.int(0, 2));
    for (let k = 0; k < fill; k++) put(rng.pick(FILLER), rng.range(0.01, 0.99), rng.range(0.05, 0.95), rng.range(0.6, 1.0));
  } else if (t.boilerplate) {
    tokens.push(tok(BOILERPLATE_2, bx0 + 0.75 * bw, by1 - 0.05 * bh, textH), tok(BOILERPLATE, bx0 + 0.75 * bw, by1 - 0.03 * bh, textH));
  }

  // drawing box: border minus strip, inset 2%
  let [dx0, dy0, dx1, dy1] = [bx0, by0, bx1, by1];
  if (tb) {
    if (edge === "right") dx1 = bx1 - d * bw;
    else if (edge === "left") dx0 = bx0 + d * bw;
    else if (edge === "bottom") dy1 = by1 - d * bh;
    else dy0 = by0 + d * bh;
  }
  [dx0, dy0, dx1, dy1] = [dx0 + 0.02 * bw, dy0 + 0.02 * bh, dx1 - 0.02 * bw, dy1 - 0.02 * bh];
  if (!tb && t.special === null) tokens.push(tok(rng.pick(["COVER SHEET", "DRAWING INDEX", "GENERAL INFORMATION"]), (dx0 + dx1) / 2, dy0 + 0.1 * bh, textH * 4));

  const alongX = edge === "top" || edge === "bottom";
  if (tb && (decoys.has("legend-column") || decoys.has("legend-column-t"))) {
    const tJ = decoys.has("legend-column-t");
    const side = rng.range(0.08, 0.14);
    const far = tJ ? (tb.anchor === "far" ? true : tb.anchor === "near" ? false : rng.chance(0.5)) : rng.chance(0.6);
    const uL = far ? 1 - side : side, uB = far ? 1 : 0;
    const vlo = tJ ? d : d + rng.range(0.02, 0.06);
    lines.push(uvSeg(edge, border, uL, 1, uL, vlo));
    if (!tJ) lines.push(uvSeg(edge, border, uL, vlo, uB, vlo));
    const legend = ["LEGEND", "GENERAL NOTES", ...Array.from({ length: rng.int(4, 12) }, (_, k) => `${k + 1}. ${rng.pick(NOTES)}`)];
    legend.forEach((s, k) => {
      const [x, y] = at((uL + uB) / 2, 1 - 0.03 - ((1 - 0.05 - vlo) * k) / legend.length);
      tokens.push(tok(s, x, y, textH * (k < 2 ? 1.3 : 0.9)));
    });
    const [lx, ly] = at(uL, 1);
    if (alongX) { if (far) dx1 = Math.min(dx1, lx - 0.02 * bw); else dx0 = Math.max(dx0, lx + 0.02 * bw); }
    else if (far) dy1 = Math.min(dy1, ly - 0.02 * bh); else dy0 = Math.max(dy0, ly + 0.02 * bh);
  }
  if (decoys.has("viewport-frame")) {
    const vw = Math.min(rng.range(0.18, 0.3) * bw, 0.9 * (dx1 - dx0));
    const vh = Math.min(rng.range(0.18, 0.3) * bh, 0.9 * (dy1 - dy0 - 0.05 * bh));
    const x0 = rng.range(dx0, dx1 - vw), y0 = rng.range(dy0, dy1 - 0.05 * bh - vh);
    lines.push(seg(x0, y0, x0 + vw, y0), seg(x0, y0 + vh, x0 + vw, y0 + vh), seg(x0, y0, x0, y0 + vh), seg(x0 + vw, y0, x0 + vw, y0 + vh));
    tokens.push(tok(rng.pick(["FLOOR PLAN", "ENLARGED PLAN", "PARTIAL PLAN", "SECTION"]), x0 + vw * 0.5, y0 + vh + 0.012 * bh, textH * 1.4),
      tok(`SCALE: ${rng.pick(["1/8\" = 1'-0\"", "1/4\" = 1'-0\"", "1\" = 20'-0\""])}`, x0 + vw * 0.5, y0 + vh + 0.028 * bh, textH));
  }
  const table = (x0: number, y0: number, tw: number, rows: number, tags: boolean) => {
    const cols = rng.int(3, 6), rh = 2.4 * textH, th = rows * rh;
    for (let r = 0; r <= rows; r++) lines.push(seg(x0, y0 + r * rh, x0 + tw, y0 + r * rh));
    for (let c = 0; c <= cols; c++) lines.push(seg(x0 + (tw * c) / cols, y0, x0 + (tw * c) / cols, y0 + th));
    tokens.push(tok(rng.pick(["FINISH SCHEDULE", "DOOR SCHEDULE", "ROOM SCHEDULE"]), x0 + tw / 2, y0 + 0.5 * rh, textH * 1.2));
    for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = c === 0 ? String(100 + r) : tags && rng.chance(0.5) ? rng.pick(FINISH_TAGS) : rng.pick(TABLE_WORDS);
      tokens.push(tok(s, x0 + (tw * (c + 0.5)) / cols, y0 + (r + 0.5) * rh, textH * 0.9));
    }
  };
  if (decoys.has("schedule-table")) {
    const tw = Math.min(rng.range(0.32, 0.45) * bw, dx1 - dx0), rows = rng.int(5, 10);
    table(rng.range(dx0, dx1 - tw), rng.range(dy0, Math.max(dy0, dy1 - rows * 2.4 * textH)), tw, rows, tagTables);
  }
  if (decoys.has("wide-table")) {
    const tw = rng.range(0.85, 1.0) * (dx1 - dx0), rows = rng.int(4, 9);
    table(rng.range(dx0, dx1 - tw), rng.range(dy0, Math.max(dy0, dy1 - rows * 2.4 * textH)), tw, rows, tagTables);
  }
  if (decoys.has("flush-table")) {
    // against the top or bottom border; along x it touches a side border or
    // runs from the opposite border to a side title block's chain
    const atTop = tb ? (edge === "bottom" ? true : edge === "top" ? false : rng.chance(0.5)) : rng.chance(0.5);
    let x0: number, x1: number;
    if (tb && edge === "right") [x0, x1] = [bx0, at(0, d)[0]];
    else if (tb && edge === "left") [x0, x1] = [at(0, d)[0], bx1];
    else {
      const w = rng.chance(0.3) ? 1 : rng.range(0.85, 0.99);
      [x0, x1] = rng.chance(0.5) ? [bx0, bx0 + w * bw] : [bx1 - w * bw, bx1];
      if (w === 1) [x0, x1] = [bx0, bx1];
    }
    const depth = rng.range(0.06, 0.30), rows = rng.int(3, 7), cols = rng.int(3, 8);
    const yAt = (f: number) => (atTop ? by0 + f * bh : by1 - f * bh);
    for (let r = 1; r <= rows; r++) lines.push(seg(x0, yAt((depth * r) / rows), x1, yAt((depth * r) / rows)));
    for (let c = 1; c < cols; c++) { const x = x0 + ((x1 - x0) * c) / cols; lines.push(seg(x, yAt(0), x, yAt(depth))); }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      tokens.push(tok(rng.pick(TABLE_WORDS), x0 + ((x1 - x0) * (c + 0.5)) / cols, yAt((depth * (r + 0.5)) / rows), textH * 0.9));
    }
  }
  if (decoys.has("top-rule-26")) lines.push(seg(bx0, by0 + 0.26 * bh, bx1, by0 + 0.26 * bh));
  if (decoys.has("sheetno-in-drawing")) {
    const s = rng.pick(DETAIL_TAGS);
    const h = textH * (tb ? tb.sheetNoHk : 3) * rng.range(0.9, 1.3);
    if (tb && tb.frame !== "none") {
      let u = rng.range(0.35, 0.65);
      while (tb.gaps.some((g) => u > g.u - 0.01 && u < g.u + g.gap + 0.01)) u += 0.02;
      const [x, y] = at(u, d + rng.range(0.01, 0.025));
      tokens.push(tok(s, x, y, h));
    } else {
      const x0 = bx0 + rng.range(0.4, 0.5) * bw, y = by0 + rng.range(0.4, 0.6) * bh;
      lines.push(seg(x0, y, x0 + 0.1 * bw, y));
      tokens.push(tok(s, x0 + 0.05 * bw, y - 0.012 * bh, h));
    }
  }

  // set-specific geometry
  const sp = t.sp;
  if (t.special === "area" && tb) {
    const c = sp.c;
    const x = lerp(bx0, bx1, c);
    lines.push(seg(x, by0, x, by1));
    const n = rng.int(15, 25);
    for (let k = 0; k < n; k++) tokens.push(tok(rng.pick(NOTES), bx0 + rng.range(c + 0.01, 0.99) * bw, by0 + rng.range(0.03, 1 - d - 0.03) * bh, textH * 0.8));
    falseStrips.push({ edge: "right", d: 1 - c, u0: 0, u1: 1, passesA: true });
  }
  if (t.special === "grid" || t.special === "grid-no-tb") {
    const withTB = t.special === "grid";
    const dT = sp.dT, dL = sp.dL, dR = sp.dR, dB = withTB ? d : sp.dB;
    const yEnd = withTB ? 1 - d : 1;   // left/right chains stop on the real chain
    const top = { edge: "top" as Edge, border }, left = { edge: "left" as Edge, border }, right = { edge: "right" as Edge, border };
    lines.push(uvSeg("top", border, 0, dT, 1, dT), uvSeg("left", border, 0, dL, yEnd, dL), uvSeg("right", border, 0, dR, yEnd, dR));
    falseStrips.push({ edge: "top", d: dT, u0: 0, u1: 1, passesA: false },
      { edge: "left", d: dL, u0: 0, u1: yEnd, passesA: false }, { edge: "right", d: dR, u0: 0, u1: yEnd, passesA: false });
    if (!withTB) {
      lines.push(uvSeg("bottom", border, 0, dB, 1, dB));
      falseStrips.push({ edge: "bottom", d: dB, u0: 0, u1: 1, passesA: false });
    }
    // detail grid lines deeper than 30%
    lines.push(seg(lerp(bx0, bx1, 0.5), by0, lerp(bx0, bx1, 0.5), lerp(by0, by1, yEnd)), seg(bx0, lerp(by0, by1, 0.55), bx1, lerp(by0, by1, 0.55)));
    const deepTags = (s: { edge: Edge; border: Box }, df: number, u0: number, u1: number) => {
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const [x, y] = fromUV(s.edge, s.border, rng.range(u0, u1), df * rng.range(0.86, 0.94));
        tokens.push(tok(rng.pick(DETAIL_TAGS), x, y, textH * rng.range(1.5, 4.5)));
      }
    };
    deepTags(top, dT, dL + 0.03, 1 - dR - 0.03);
    deepTags(left, dL, dT + 0.03, 1 - dB - 0.03);
    deepTags(right, dR, dT + 0.03, 1 - dB - 0.03);
    if (!withTB) deepTags({ edge: "bottom", border }, dB, dL + 0.03, 1 - dR - 0.03);
  }
  if (t.special === "grid-legal") {
    const dT = sp.dT;
    lines.push(uvSeg("top", border, 0, dT, 1, dT));
    const [x, y] = fromUV("top", border, rng.range(0.6, 0.95), dT * rng.range(0.1, 0.5));
    tokens.push(tok(rng.pick(DETAIL_TAGS), x, y, textH * rng.range(2, 4.5)));
    const n = rng.int(15, 25);
    for (let k = 0; k < n; k++) {
      const [nx, ny] = fromUV("top", border, rng.range(0.02, 0.98), dT * rng.range(0.05, 0.95));
      tokens.push(tok(rng.pick(NOTES), nx, ny, textH * 0.8));
    }
    falseStrips.push({ edge: "top", d: dT, u0: 0, u1: 1, passesA: true });
  }

  // drawing-area text noise
  const nNoise = rng.int(20, 150);
  for (let k = 0; k < nNoise; k++) {
    tokens.push(tok(rng.pick(NOISE), rng.range(dx0, dx1), rng.range(dy0, dy1), textH * rng.range(0.8, 1.2), rng.chance(0.15) ? 90 : 0));
  }

  const sheet: DetectSheet = { key, w: W, h: H, pageIn: [t.pageIn[0], t.pageIn[1]], tokens, lines, source: "vector" };
  const truth: Truth | null = tb && t.firm ? { edge, d, border: [...border], family: t.firm.id } : null;
  const meta: SynthMeta = {
    border: [...border], borderless: t.borderless, borderMissing: t.borderMissing, shortBorder: t.shortBorder,
    frame: tb ? tb.frame : "none", anchor: tb ? tb.anchor : null,
    cover: chainExtent ? chainExtent[1] - chainExtent[0] : null, chainExtent,
    chainGaps: tb && tb.frame !== "none" ? tb.gaps.map((g) => ({ ...g })) : [],
    decoys: DECOY_KINDS.filter((k) => decoys.has(k)), falseStrips,
    pageEdgeRules: t.pageEdgeRules, sheetNo, fields,
    group: t.firm ? t.firm.id : "none", expect: t.expect, why: t.why,
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
    meta: {
      border: [0, 0, W, H], borderless: true, borderMissing: null, shortBorder: false, frame: "none", anchor: null,
      cover: null, chainExtent: null, chainGaps: [], decoys: [], falseStrips: [], pageEdgeRules: false,
      sheetNo: null, fields: null, group: "sketch", expect: "abstain", why: "no-title-block",
    },
  };
}

function oneFirm(name: string, seed: number, n: number, o: TemplateOpts, cycle = false, sp?: (rng: Rng, t: Template) => void): SynthSet {
  const rng = new Rng(seed);
  const t = makeTemplate(rng, o);
  sp?.(rng, t);
  const sheets = Array.from({ length: n }, (_, i) =>
    genSheet(t, rng, i, sheetKey(name, i), cycle ? [PER_SHEET_DECOYS[i % PER_SHEET_DECOYS.length]] : []));
  return { name, seed, sheets, firms: [t.firm!], expectGroups: 1 };
}

// ── named sets ──────────────────────────────────────────────────────────────
export function uniformSet24(seed = 24001): SynthSet {
  return oneFirm("uniform24", seed, 24, { edge: "right", frame: "partial", anchor: "far", pageIn: [36, 24], doubleRule: true, boilerplate: true, pageEdgeRules: true, gaps: "join" }, true);
}
export function bottomStripSet5(seed = 5001): SynthSet {
  return oneFirm("bottom5", seed, 5, { edge: "bottom", frame: "full", gaps: "break" });
}
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
export function smallConsultantsSet(seed = 4001): SynthSet {
  const rng = new Rng(seed);
  const [na, nb] = rng.take(FIRM_NAMES, 2);
  const project = makeProject(rng);
  const [la, lb] = rng.take([0, 1, 2, 3], 2);
  const a = makeTemplate(rng, { edge: "bottom", frame: "full", firmName: na, labelStyle: la, project, boilerplate: true, pageIn: [36, 24], stripTarget: [40, 90] });
  const b = makeTemplate(rng, {
    edge: "bottom", frame: "partial", firmName: nb, labelStyle: lb, project, boilerplate: true, pageIn: [36, 24], stripTarget: [40, 90],
    border: a.border, pageEdgeRules: a.pageEdgeRules, doubleRule: a.doubleRule,
    d: Math.min(0.24, Math.max(0.09, a.tb!.d + rng.range(-0.008, 0.008))),
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
export function noTitleBlockSet(seed = 3001): SynthSet {
  const rng = new Rng(seed);
  const sheets = [0, 1, 2].map((i) => genSheet(makeTemplate(rng, { noTitleBlock: true, pageIn: [36, 24] }), rng, i, sheetKey("notb", i),
    i === 0 ? ["sheetno-in-drawing", "schedule-table"] : i === 1 ? ["flush-table"] : []));
  return { name: "notb", seed, sheets, firms: [], expectGroups: 3 };
}
export function borderlessSet(seed = 7001): SynthSet {
  return oneFirm("borderless", seed, 4, { edge: "bottom", frame: "none", borderless: true });
}
export function leftEdgeSet(seed = 8001): SynthSet {
  return oneFirm("left5", seed, 5, { edge: "left", frame: "partial" });
}
export function topEdgeSet(seed = 9001): SynthSet {
  return oneFirm("top5", seed, 5, { edge: "top", frame: "full", dRange: [0.085, 0.2] });
}
export function topPartialSet(seed = 9101): SynthSet {
  return oneFirm("toppartial", seed, 3, { edge: "top", frame: "partial", anchor: "near", dRange: [0.085, 0.2] });
}
export function wrongZoneSet(seed = 1101): SynthSet {
  return oneFirm("wrongzone", seed, 3, { edge: "bottom", frame: "full", sheetNoMode: "near", expect: "no-rule-A", why: "wrong-zone-near", randomDecoys: false });
}
export function wrongZoneDeepSet(seed = 1201): SynthSet {
  return oneFirm("wrongdeep", seed, 1, { edge: "right", frame: "full", sheetNoMode: "deep", expect: "no-rule-A", why: "wrong-zone-deep", randomDecoys: false });
}
export function gridDecoySet(seed = 1301): SynthSet {
  return oneFirm("grid", seed, 1, { edge: "bottom", frame: "full", dRange: [0.09, 0.16], randomDecoys: false, boilerplate: false, doubleRule: false, special: "grid", gaps: "none" },
    false, (rng, t) => { t.sp = { dT: rng.range(0.2, 0.26), dL: rng.range(0.2, 0.26), dR: rng.range(0.2, 0.26) }; });
}
export function gridLegalDecoySet(seed = 1401): SynthSet {
  return oneFirm("gridlegal", seed, 1, {
    edge: "bottom", frame: "full", dRange: [0.085, 0.16], randomDecoys: false, boilerplate: false, doubleRule: false,
    special: "grid-legal", expect: "tie-break-area", why: "grid-legal",
  }, false, (rng, t) => { t.sp = { dT: rng.range(0.2, 0.26) }; });
}
export function gridNoTitleBlockSet(seed = 1501): SynthSet {
  const rng = new Rng(seed);
  const t = makeTemplate(rng, { noTitleBlock: true, randomDecoys: false, boilerplate: false, doubleRule: false, special: "grid-no-tb", why: "grid-no-title-block" });
  t.sp = { dT: rng.range(0.2, 0.26), dL: rng.range(0.2, 0.26), dR: rng.range(0.2, 0.26), dB: rng.range(0.2, 0.26) };
  return { name: "gridnotb", seed, sheets: [genSheet(t, rng, 0, sheetKey("gridnotb", 0))], firms: [], expectGroups: 1 };
}
export function areaTieBreakSet(seed = 1601): SynthSet {
  return oneFirm("areatie", seed, 2, {
    edge: "bottom", frame: "full", dRange: [0.085, 0.125], randomDecoys: false, special: "area", gaps: "none",
    expect: "tie-break-area", why: "area-crossing",
  }, false, (rng, t) => {
    const c = rng.range(0.832, 0.848);
    t.sp = { c };
    t.tb!.sheetNoUV = [rng.range(1 - 0.5 * (1 - c), 0.97), rng.range(0.06, 0.58)];
    t.tb!.keyTags = t.tb!.keyTags.filter((k) => k.hk < t.tb!.sheetNoHk);
  });
}
export function frameOnlySet(seed = 1701): SynthSet {
  return oneFirm("frameonly", seed, 1, { edge: "bottom", frame: "full", sheetNoMode: "none", stripTarget: [60, 170], randomDecoys: false, expect: "abstain", why: "frame-only" });
}
export function repeatOnlySet(seed = 1801): SynthSet {
  const s = oneFirm("repeatonly", seed, 4, { edge: "bottom", frame: "none", sheetNoMode: "none", randomDecoys: false, expect: "abstain", why: "repeat-only" });
  return { ...s, expectGroups: null };
}
export function sparseStripSet(seed = 1901): SynthSet {
  return oneFirm("sparse", seed, 1, { edge: "bottom", frame: "full", stripTarget: [8, 13], boilerplate: false, randomDecoys: false, expect: "abstain", why: "sparse" });
}
export function shortBorderSet(seed = 2101): SynthSet {
  return oneFirm("shortborder", seed, 3, { edge: "right", frame: "full", shortBorder: true, pageEdgeRules: false });
}
export function missingSideSet(seed = 2201): SynthSet {
  return oneFirm("missingside", seed, 3, { edge: "bottom", frame: "full", borderMissing: true });
}
/** 1–3 firms with random edge, page, border, d, frame and variants, 1–6
 * sheets each, plus sometimes a cover sheet without a title block. */
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
    const edge = rng.pick(EDGES);
    const n = rng.int(1, 6);
    const short = edge === "right" && rng.chance(0.25);
    // without a frame only repetition can find the block, which needs ≥ 3 sheets
    const frame = short ? "full" : n < 3 ? rng.pick(["full", "partial"] as const) : undefined;
    const t = makeTemplate(rng, { firmName, edge, shortBorder: short, frame, borderMissing: !short && rng.chance(0.15) });
    firms.push(t.firm!);
    for (let i = 0; i < n; i++) sheets.push(genSheet(t, rng, i, sheetKey(`random${seed}`, sheets.length)));
  }
  return { name: `random${seed}`, seed, sheets, firms, expectGroups: firms.length + covers };
}
