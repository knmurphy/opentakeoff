// Synthetic benchmark corpus — every case constructs its linework AND its
// golden polygon from the same numbers, so the truth is exact by definition.
// One canvas convention throughout: 1000×800 image px, ws = 1, 18 px/ft
// (1/4" = 1'-0" at render scale 1). Each case yields probes: a seed with a
// golden ring, or a seed whose golden answer is "refuse".
//
// These cases encode the failure modes the upstream RFC enumerates: boundary
// gaps (cased openings), unclosed door swings, dense hatch, tile grids,
// curved partitions, and honest refusal on open/oversized space.
import { SEG_CURVE } from "../src/lib/oneclick";
import type { Point } from "../src/lib/oneclick";

export interface Probe {
  name: string;
  seed: Point;                       // image px
  expect: "golden" | "refusal";
  golden?: Point[];                  // image px, when expect === "golden"
  tags?: string[];
  knownFail?: boolean;               // tracked, not gating
}
export interface SyntheticCase {
  name: string;
  imgW: number; imgH: number;
  ptPerFt: number;                   // image px per foot (for radii/wedge caps)
  segs: number[];
  meta?: Uint8Array;
  probes: Probe[];
}

const PXFT = 18;
const sq = (x0: number, y0: number, x1: number, y1: number): number[] => [
  x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0,
];
const border = sq(2, 2, 998, 798);
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const zeroMeta = (segs: number[]) => new Uint8Array(segs.length >> 2);

function mk(name: string, segs: number[], probes: Probe[], meta?: Uint8Array): SyntheticCase {
  return { name, imgW: 1000, imgH: 800, ptPerFt: PXFT, segs: [...border, ...segs], meta, probes };
}

// door-swing linework shared by two cases: 54 px (3 ft) south opening at
// x 208..262, leaf open into the room, quarter arc tip → strike jamb
const R = 54;
function doorSwing(): { segs: number[]; curveFrom: number } {
  const leaf = [208, 280, 208, 280 - R];
  const arc: number[] = [];
  let px = 208, py = 280 - R;
  for (let k = 1; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    const qx = 208 + R * Math.sin(a), qy = 280 - R * Math.cos(a);
    arc.push(px, py, qx, qy); px = qx; py = qy;
  }
  return { segs: [...leaf, ...arc], curveFrom: leaf.length >> 2 };
}

export function syntheticCorpus(): SyntheticCase[] {
  const ROOM = rect(100, 100, 316, 280);            // 12×10 ft
  const cases: SyntheticCase[] = [];

  cases.push(mk("enclosed-room", sq(100, 100, 316, 280), [
    { name: "center", seed: [200, 190], expect: "golden", golden: ROOM },
    { name: "near-wall", seed: [108, 190], expect: "golden", golden: ROOM, tags: ["near-wall-seed"] },
  ]));

  cases.push(mk("cased-opening-3ft", [
    100, 100, 316, 100, 316, 100, 316, 280, 316, 280, 262, 280,
    208, 280, 100, 280, 100, 280, 100, 100,
  ], [
    { name: "center", seed: [200, 190], expect: "golden", golden: ROOM, tags: ["gap-seal"] },
  ]));

  {
    const d = doorSwing();
    const roomSegs = [
      100, 100, 316, 100, 316, 100, 316, 280, 316, 280, 262, 280,
      208, 280, 100, 280, 100, 280, 100, 100, ...d.segs,
    ];
    const meta = zeroMeta([...border, ...roomSegs]);
    const arcStart = (border.length >> 2) + (roomSegs.length >> 2) - 8;
    for (let k = 0; k < 8; k++) meta[arcStart + k] = SEG_CURVE;
    cases.push(mk("door-swing-3ft", roomSegs, [
      { name: "center", seed: [200, 190], expect: "golden", golden: ROOM, tags: ["door-swing", "wedge-included"] },
      { name: "in-doorway", seed: [235, 290], expect: "refusal", tags: ["doorway-interior", "known-limit"] },
    ], meta));
  }

  cases.push(mk("two-doorways", [
    20, 20, 50, 20, 57, 20, 100, 20, 100, 20, 100, 100,
    100, 100, 62, 100, 55, 100, 20, 100, 20, 100, 20, 20,
  ], [
    { name: "center", seed: [60, 60], expect: "golden", golden: rect(20, 20, 100, 100), tags: ["gap-seal", "multi-gap"] },
  ]));

  {
    const room = sq(100, 100, 700, 500);              // 600×400 hatched room
    const hatch: number[] = [];
    for (let x = 104; x <= 696; x += 4) hatch.push(x, 100, x, 500);
    const all = [...room, ...hatch];
    cases.push(mk("hatched-room", all, [
      { name: "center", seed: [400, 300], expect: "golden", golden: rect(100, 100, 700, 500), tags: ["hatch"] },
    ], zeroMeta([...border, ...all])));
  }

  {
    const room = sq(100, 100, 700, 500);
    const grid: number[] = [];
    for (let x = 100; x <= 700; x += 24) grid.push(x, 100, x, 500);
    for (let y = 100; y <= 500; y += 24) grid.push(100, y, 700, y);
    const all = [...room, ...grid];
    cases.push(mk("tile-grid-room", all, [
      { name: "in-cell", seed: [410, 310], expect: "golden", golden: rect(100, 100, 700, 500), tags: ["hatch", "tile-grid"] },
    ], zeroMeta([...border, ...all])));
  }

  {
    // curved partition: the space beyond the arc is a room, not a swing wedge
    const room = sq(100, 100, 316, 280);
    const part: number[] = [];
    let px = 208, py = 100;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const qx = 208 + Math.sin(t * Math.PI) * 24, qy = 100 + t * 180;
      part.push(px, py, qx, qy); px = qx; py = qy;
    }
    const golden: Point[] = [[100, 100], [208, 100]];
    let gx = 208, gy = 100;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      gx = 208 + Math.sin(t * Math.PI) * 24; gy = 100 + t * 180;
      golden.push([gx, gy]);
    }
    golden.push([100, 280]);
    const all = [...room, ...part];
    const meta = zeroMeta([...border, ...all]);
    const partStart = (border.length >> 2) + (room.length >> 2);
    for (let k = 0; k < 8; k++) meta[partStart + k] = SEG_CURVE;
    cases.push(mk("curved-partition", all, [
      { name: "left-half", seed: [150, 190], expect: "golden", golden, tags: ["curved-wall", "no-false-wedge"] },
    ], meta));
  }

  cases.push(mk("open-space", sq(100, 100, 316, 280), [
    { name: "outside-room", seed: [600, 600], expect: "refusal", tags: ["open-space"] },
  ]));

  cases.push(mk("oversized-enclosure", sq(60, 20, 840, 780), [
    // 780×760 interior ≈ 74% of the sheet — the room-size cap must refuse
    { name: "center", seed: [420, 390], expect: "refusal", tags: ["room-size-cap"] },
  ]));

  return cases;
}
