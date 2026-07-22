// One-Click accuracy corpus — synthetic fixtures (#173, epic #171).
//
// Each fixture is a pure descriptor: synthetic wall/hatch geometry (`segs` + the
// per-segment `meta` classifyHatchSegs consumes) plus per-seed CASES. A case
// either ACCEPTS (the flood should return a clean region, scored by polyscore's
// band against a golden) or REFUSES (the flood should return a named non-ok
// status — refusal is a PASSING behavior the corpus locks in, never a hedge).
//
// Sheets are kept small enough that buildMask runs at ws=1 (mask px == image px),
// so goldens authored here are in the same frame the trace returns and the band
// reads directly in mask px. Goldens are exact wall-interior rings computed by
// plain rectangle/L math — INDEPENDENT of the flood engine under test (no
// circularity). Golden rings are simply-connected except the column-island
// fixture, which deliberately carries a hole to MEASURE the known outer-contour
// over-count (traceRegion returns the outer boundary only).
//
// Expectations are PINNED to the engine's current observed behavior (recorded
// once via corpus/record.ts): a fixture that flips accept<->refuse, or whose band
// drifts past its committed baseline, fails loudly. Adding a fixture requires no
// harness change.

import type { Ring } from "../../src/lib/polyscore.ts";
import { SEG_FILLONLY } from "../../src/lib/oneclick.ts";

export type RefuseReason = "leak" | "tiny" | "boundary";
export interface CorpusCase {
  label: string;
  seed: [number, number];
  golden: Ring | Ring[] | null;                 // null ⇒ a KNOWN_LIMITATION refuse case
  expect: { kind: "accept" } | { kind: "refuse"; reason: RefuseReason };
  expectHatchFiltered?: boolean;                 // assert f.hatchFiltered when set
  expectTier?: string;                           // asserted only once D (#175) adds f.tier
  noBleedInto?: Ring;                            // traced region must NOT cover this area
  // A pinned CHARACTERIZATION of a known engine limitation (FM2 breach, the
  // outer-contour column over-count, …). Its band is baselined so a CHANGE is
  // visible, but it is excluded from the accuracy aggregates (it is not a clean
  // trace) and its noBleedInto is NOT asserted. The string names the limitation.
  knownDefect?: string;
}
export interface CorpusFixture {
  id: string;
  bucket: "synthetic" | "real";
  regressionRef?: string;                        // e.g. "#32" for a reproduced real bug
  imgW: number;
  imgH: number;
  build(): { segs: number[]; meta: Uint8Array };
  cases: CorpusCase[];
}

// ── builders ────────────────────────────────────────────────────────────────
/** the 4 wall edges of an axis-aligned rectangle, as flat [x1,y1,x2,y2,…] segs */
export function rectSegs(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
}
/** the golden ring for a rectangular room (wall centerlines) */
export function rectRing(x0: number, y0: number, x1: number, y1: number): Ring {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
/** vertical hatch lines spanning [y0,y1] across [x0,x1] at the given pitch */
export function hatchV(x0: number, x1: number, y0: number, y1: number, pitch: number): number[] {
  const out: number[] = [];
  for (let x = x0; x <= x1; x += pitch) out.push(x, y0, x, y1);
  return out;
}
/** horizontal hatch lines */
export function hatchH(x0: number, x1: number, y0: number, y1: number, pitch: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y += pitch) out.push(x0, y, x1, y);
  return out;
}
/** all-zero meta (plain stroked hairlines — classifyHatchSegs runs normally) */
export function zeroMeta(segs: number[]): Uint8Array {
  return new Uint8Array(segs.length >> 2);
}

// A common sheet: comfortably larger than any room so no room approaches the 30%
// leak fraction, and < 3000 px so buildMask stays at ws=1.
const W = 1400, H = 1000;
const border = rectSegs(4, 4, W - 4, H - 4);

// ── fixtures ──────────────────────────────────────────────────────────────
export const SYNTHETIC_FIXTURES: CorpusFixture[] = [
  {
    id: "synthetic/clean-rect", bucket: "synthetic", imgW: W, imgH: H,
    build() {
      const room = rectSegs(200, 200, 700, 550);
      const segs = [...border, ...room];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{ label: "room", seed: [450, 375], golden: rectRing(200, 200, 700, 550), expect: { kind: "accept" }, expectTier: "strict" }],
  },
  {
    id: "synthetic/hatched-room-vertical", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      const room = rectSegs(200, 200, 700, 550);
      const hatch = hatchV(204, 696, 204, 546, 4);          // dense vertical lining
      const segs = [...border, ...room, ...hatch];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{ label: "hatched room", seed: [450, 375], golden: rectRing(200, 200, 700, 550), expect: { kind: "accept" }, expectHatchFiltered: true, expectTier: "predominant_soft" }],
  },
  {
    id: "synthetic/crosshatch-tile-grid", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      const room = rectSegs(200, 200, 700, 550);
      const grid = [...hatchV(200, 700, 200, 550, 16), ...hatchH(200, 700, 200, 550, 16)];
      const segs = [...border, ...room, ...grid];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{ label: "tile-grid room", seed: [450, 375], golden: rectRing(200, 200, 700, 550), expect: { kind: "accept" }, expectHatchFiltered: true, expectTier: "predominant_soft" }],
  },
  {
    id: "synthetic/poche-wall-riding-rhythm", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      // walls drawn as a SOLID FILLED band whose edges sit on the tile pitch —
      // must stay hard so the escalated fill can't cross solid ink and leak.
      const room = rectSegs(200, 200, 700, 550);
      const grid = [...hatchV(40, 1360, 40, 960, 8), ...hatchH(40, 1360, 40, 960, 8)];
      const segs = [...border, ...room, ...grid];
      const meta = zeroMeta(segs);
      const roomStart = border.length >> 2;
      for (let k = 0; k < 4; k++) meta[roomStart + k] = SEG_FILLONLY;
      return { segs, meta };
    },
    cases: [{ label: "poche room", seed: [450, 375], golden: rectRing(200, 200, 700, 550), expect: { kind: "accept" }, expectHatchFiltered: true, expectTier: "predominant_soft" }],
  },
  {
    id: "synthetic/door-gap-no-swing", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      // a wall opening with NO door-swing chord to close it → the flood leaks.
      // Refusal is the correct, PINNED behavior (a KNOWN_LIMITATION until the
      // gap-closer, direction B, lands).
      const room = [
        200, 200, 700, 200,  700, 200, 700, 550,  700, 550, 200, 550,
        200, 200, 200, 380,  200, 420, 200, 550,           // 40px gap (y 380..420) in the left wall
      ];
      const segs = [...border, ...room];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{ label: "unenclosed room", seed: [450, 375], golden: null, expect: { kind: "refuse", reason: "leak" } }],
  },
  {
    id: "synthetic/two-rooms-thin-wall", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      // two rooms sharing one thin partition — neither seed may bleed into the other.
      const outer = rectSegs(200, 200, 900, 550);
      const partition = [550, 200, 550, 550];
      const segs = [...border, ...outer, ...partition];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [
      { label: "left room", seed: [370, 375], golden: rectRing(200, 200, 550, 550), expect: { kind: "accept" }, expectTier: "strict", noBleedInto: rectRing(560, 210, 890, 540) },
      { label: "right room", seed: [730, 375], golden: rectRing(550, 200, 900, 550), expect: { kind: "accept" }, expectTier: "strict", noBleedInto: rectRing(210, 210, 540, 540) },
    ],
  },
  {
    id: "synthetic/l-shaped-room", bucket: "synthetic", imgW: W, imgH: H,
    build() {
      // an L: full bottom bar + tall left arm (centroid falls in the notch).
      const L: number[] = [
        200, 200, 500, 200,  500, 200, 500, 500,  500, 500, 800, 500,
        800, 500, 800, 800,  800, 800, 200, 800,  200, 800, 200, 200,
      ];
      const segs = [...border, ...L];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{
      label: "L room", seed: [300, 700],
      golden: [[200, 200], [500, 200], [500, 500], [800, 500], [800, 800], [200, 800]],
      expect: { kind: "accept" }, expectTier: "strict",
    }],
  },
  {
    id: "synthetic/column-island", bucket: "synthetic", imgW: W, imgH: H,
    build() {
      // a room with an interior column: the flood goes AROUND it (region has a
      // hole) but traceRegion returns the OUTER contour only → the trace
      // over-counts by the column area. The golden carries the hole so the band
      // MEASURES that over-count (a baselined number that drops when the trace
      // becomes hole-aware).
      const room = rectSegs(200, 200, 700, 550);
      const column = rectSegs(420, 340, 480, 410);
      const segs = [...border, ...room, ...column];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{
      label: "room with column", seed: [260, 260],
      golden: [rectRing(200, 200, 700, 550), rectRing(420, 340, 480, 410)],   // outer + hole
      expect: { kind: "accept" },
      knownDefect: "traceRegion returns the outer contour only, so the trace over-counts by the column area; band drops toward the clean value when the trace becomes hole-aware",
    }],
  },
  {
    id: "synthetic/finish-transition-divider", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      // one room with a drawn mid-room finish-transition line (a thin full-height
      // divider). The escalated fill must NOT silently breach it and return the
      // merged 2× area. Behavior is PINNED to whatever the engine does today
      // (fill one side, or refuse) — a flip to the merged area fails.
      const room = rectSegs(200, 200, 800, 550);
      const divider = [500, 200, 500, 550];
      const segs = [...border, ...room, ...divider];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{ label: "left of divider", seed: [340, 375], golden: rectRing(200, 200, 500, 550), expect: { kind: "accept" }, expectTier: "strict", noBleedInto: rectRing(510, 210, 790, 540) }],
  },
  {
    id: "synthetic/dashed-demising-wall", bucket: "synthetic", imgW: W, imgH: H, regressionRef: "#32",
    build() {
      // a demising wall drawn DASHED (short collinear pieces). It is a real wall
      // and must still bound the room — it must NOT be softened by ROW_EPS
      // row-merging and breached. Behavior pinned.
      const room = rectSegs(200, 200, 900, 550);
      const dashed: number[] = [];
      for (let y = 200; y < 550; y += 20) dashed.push(550, y, 550, y + 12);   // dashed partition
      const segs = [...border, ...room, ...dashed];
      return { segs, meta: zeroMeta(segs) };
    },
    cases: [{
      label: "left of dashed wall", seed: [370, 375], golden: rectRing(200, 200, 550, 550), expect: { kind: "accept" },
      noBleedInto: rectRing(560, 210, 890, 540),
      knownDefect: "FM2: the dashed wall's sub-barrier gaps let the 4-connected flood breach into the adjacent room and return the merged over-region; fixed by gap-closing / dashed-wall detection (direction B)",
    }],
  },
];
