// A5 — which shapes get treated as DOOR arcs?
//
// Eight fixtures, each fed in BOTH forms CAD actually emits:
//   polyline — straight lineTo chords, meta 0, then markPolylineArcs()
//   bezier   — a real op list through extractVectorGeometry() (which stamps
//              SEG_CURVE on every bezier chord unconditionally)
//
// Two quantities per fixture, both computable on BEFORE and AFTER:
//   curveChords — chords carrying SEG_CURVE after the pipeline. This is
//                 "curved linework", and it is what exempts a chord from hatch
//                 classification, so it is expected to be permissive.
//   doorChords  — chords the engine will treat as a DOOR SWING. On AFTER that
//                 is SEG_CURVE minus flagNonDoorArcs(); on BEFORE flagNonDoorArcs
//                 does not exist, so every curve chord is a door chord. The
//                 probe reads the symbol off the module namespace so the SAME
//                 file runs on both states.
//   maskNoDoorCells — cells carrying MASK_NODOOR_BIT (AFTER only; 0 on BEFORE).
//
// The negative control is the ELLIPSE: it must NOT be marked as a door on either
// state, and the two DOORS must stay marked on both.
import * as OC from "../src/lib/oneclick.ts";
import { cloudBezier } from "../src/lib/geometry.js";

const {
  markPolylineArcs, classifyHatchSegs, extractVectorGeometry, buildMask,
  SEG_CURVE, MASK_CURVE_BIT, MASK_MAX_DIM,
} = OC as any;
const flagNonDoorArcs = (OC as any).flagNonDoorArcs as undefined | ((s: number[], m: Uint8Array) => Uint8Array);
const MASK_NODOOR_BIT = (OC as any).MASK_NODOOR_BIT ?? 0;

const PXFT = 18, IMG_W = 1000, IMG_H = 800;

function arcChords(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): number[] {
  const s: number[] = [];
  let px = cx + r * Math.cos(a0), py = cy + r * Math.sin(a0);
  for (let k = 1; k <= steps; k++) {
    const a = a0 + (a1 - a0) * (k / steps);
    const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
    s.push(px, py, qx, qy); px = qx; py = qy;
  }
  return s;
}
const circleChords = (cx: number, cy: number, r: number, steps: number) => arcChords(cx, cy, r, 0, 2 * Math.PI, steps);

function ellipseChords(cx: number, cy: number, a: number, b: number, steps: number): number[] {
  const s: number[] = [];
  let px = cx + a, py = cy;
  for (let k = 1; k <= steps; k++) {
    const t = (k / steps) * 2 * Math.PI;
    const qx = cx + a * Math.cos(t), qy = cy + b * Math.sin(t);
    s.push(px, py, qx, qy); px = qx; py = qy;
  }
  return s;
}

function revisionCloud(x0: number, y0: number, x1: number, y1: number, r = 18, per = 6): number[] {
  const segs: number[] = [];
  const corners: Array<[number, number]> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = corners[e], [bx, by] = corners[(e + 1) % 4];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / (r * 1.6)));
    for (let i = 0; i < n; i++) {
      const px = ax + (bx - ax) * (i / n), py = ay + (by - ay) * (i / n);
      const qx = ax + (bx - ax) * ((i + 1) / n), qy = ay + (by - ay) * ((i + 1) / n);
      const c = Math.hypot(qx - px, qy - py);
      const ex = (qx - px) / c, ey = (qy - py) / c;
      const h = Math.sqrt(Math.max(0, r * r - (c / 2) ** 2));
      const cx = (px + qx) / 2 + ey * h, cy = (py + qy) / 2 - ex * h;
      const a0 = Math.atan2(py - cy, px - cx), a1 = Math.atan2(qy - cy, qx - cx);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI;
      segs.push(...arcChords(cx, cy, r, a0, a0 + d, per));
    }
  }
  return segs;
}
const singleDoor = (x: number, y: number, R = 3 * PXFT) => arcChords(x, y, R, -Math.PI / 2, 0, 8);
const doubleDoor = (xL: number, yW: number, R = 3 * PXFT) => [
  ...arcChords(xL, yW, R, -Math.PI / 2, 0, 8),
  ...arcChords(xL + 2 * R, yW, R, Math.PI, (3 * Math.PI) / 2, 8),
];
// duct elbow: two concentric 90 deg arcs (inner + outer radius) — a fitting, not a door
const ductElbow = (cx: number, cy: number) => [...arcChords(cx, cy, 1.0 * PXFT, 0, Math.PI / 2, 8), ...arcChords(cx, cy, 2.2 * PXFT, 0, Math.PI / 2, 8)];
// curved millwork: a long gentle sweep — 12 ft chord, 1 ft bulge, R ~ 18.5 ft
const curvedMillwork = () => arcChords(400, 400 + 18.5 * PXFT, 18.5 * PXFT, -Math.PI / 2 - 0.33, -Math.PI / 2 + 0.33, 12);

// ── bezier plumbing (the same op-list walk production runs) ─────────────────
const OPS: any = {
  save: 4, restore: 5, transform: 6, setLineWidth: 2, setGState: 3,
  constructPath: 9, moveTo: 10, lineTo: 11, curveTo: 12, curveTo2: 13, curveTo3: 14,
  closePath: 15, rectangle: 16, stroke: 20, fill: 22, eoFill: 23, endPath: 28, clip: 29, eoClip: 30,
  paintFormXObjectBegin: 40, paintFormXObjectEnd: 41,
  paintImageXObject: 50, paintInlineImageXObject: 51, paintImageMaskXObject: 52,
  paintImageXObjectRepeat: 53, paintImageMaskXObjectRepeat: 54,
  paintImageMaskXObjectGroup: 55, paintInlineImageXObjectGroup: 56,
};
function bezierGeometry(paths: Array<[number[], number[]]>) {
  return extractVectorGeometry(
    { fnArray: paths.flatMap(() => [OPS.constructPath, OPS.stroke]), argsArray: paths.flatMap((p) => [p, null]) },
    [1, 0, 0, 1, 0, 0], OPS);
}
const K = 0.5522847498;
function bezierArcPath(cx: number, cy: number, r: number, quads: number[][], start: [number, number]): [number[], number[]] {
  const ops: number[] = [OPS.moveTo], co: number[] = [start[0], start[1]];
  for (const q of quads) { ops.push(OPS.curveTo); co.push(...q); }
  return [ops, co];
}
function bezierCircle(cx: number, cy: number, r: number): [number[], number[]] {
  const quads: number[][] = [
    [cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r],
    [cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy],
    [cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r],
    [cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy],
  ];
  const ops: number[] = [OPS.moveTo], co: number[] = [cx + r, cy];
  for (let q = 0; q < 4; q++) { if (q === 2) { ops.push(OPS.lineTo); co.push(cx - r, cy); } ops.push(OPS.curveTo); co.push(...quads[q]); }
  return [ops, co];
}
function bezierEllipse(cx: number, cy: number, a: number, b: number): [number[], number[]] {
  const quads: number[][] = [
    [cx + a, cy + K * b, cx + K * a, cy + b, cx, cy + b],
    [cx - K * a, cy + b, cx - a, cy + K * b, cx - a, cy],
    [cx - a, cy - K * b, cx - K * a, cy - b, cx, cy - b],
    [cx + K * a, cy - b, cx + a, cy - K * b, cx + a, cy],
  ];
  const ops: number[] = [OPS.moveTo], co: number[] = [cx + a, cy];
  for (const q of quads) { ops.push(OPS.curveTo); co.push(...q); }
  return [ops, co];
}
function bezierCloud(x0: number, y0: number, x1: number, y1: number): [number[], number[]] {
  const { start, segments } = cloudBezier(x0, y0, x1, y1) as any;
  const ops: number[] = [OPS.moveTo], co: number[] = [start[0], start[1]];
  for (const [c1, c2, end] of segments) { ops.push(OPS.curveTo); co.push(c1[0], c1[1], c2[0], c2[1], end[0], end[1]); }
  return [ops, co];
}
/** a quarter arc as ONE cubic — how CAD writes a door leaf's swing */
function bezierQuarter(cx: number, cy: number, r: number, quadrant: number): [number[], number[]] {
  const q: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const s = q[quadrant % 4], e = q[(quadrant + 1) % 4];
  const sx = cx + r * s[0], sy = cy + r * s[1], ex = cx + r * e[0], ey = cy + r * e[1];
  const c1x = sx + K * r * e[0], c1y = sy + K * r * e[1];
  const c2x = ex + K * r * s[0], c2y = ey + K * r * s[1];
  return [[OPS.moveTo, OPS.curveTo], [sx, sy, c1x, c1y, c2x, c2y, ex, ey]];
}

interface Fixture { name: string; poly: number[]; bez: Array<[number[], number[]]>; }
const FIXTURES: Fixture[] = [
  { name: "revision cloud", poly: revisionCloud(300, 300, 560, 480), bez: [bezierCloud(300, 300, 560, 480)] },
  { name: "round column (r=1 ft)", poly: circleChords(400, 400, 1 * PXFT, 24), bez: [bezierCircle(400, 400, 1 * PXFT)] },
  { name: "callout bubble (r=2 ft)", poly: circleChords(400, 400, 2 * PXFT, 32), bez: [bezierCircle(400, 400, 2 * PXFT)] },
  { name: "duct elbow (two concentric 90deg)", poly: ductElbow(400, 400), bez: [bezierQuarter(400, 400, 1.0 * PXFT, 0), bezierQuarter(400, 400, 2.2 * PXFT, 0)] },
  { name: "curved millwork (12 ft chord, R~18.5 ft)", poly: curvedMillwork(), bez: [bezierQuarter(400, 400, 18.5 * PXFT, 0)] },
  { name: "ellipse 3:1 (NEGATIVE CONTROL)", poly: ellipseChords(400, 400, 3 * PXFT, 1 * PXFT, 32), bez: [bezierEllipse(400, 400, 3 * PXFT, 1 * PXFT)] },
  { name: "single door (r=3 ft)", poly: singleDoor(400, 400), bez: [bezierQuarter(400, 400, 3 * PXFT, 0)] },
  { name: "double door (2 x r=3 ft)", poly: doubleDoor(340, 400), bez: [bezierQuarter(340, 400, 3 * PXFT, 0), bezierQuarter(340 + 6 * PXFT, 400, 3 * PXFT, 2)] },
];

function analyse(segs: number[], meta: Uint8Array, form: string) {
  const n = segs.length >> 2;
  const polyMarked = form === "polyline" ? markPolylineArcs(segs, meta) : 0;
  let curveChords = 0;
  for (let i = 0; i < n; i++) if (meta[i] & SEG_CURVE) curveChords++;
  const noDoor = flagNonDoorArcs ? flagNonDoorArcs(segs, meta) : null;
  let flagged = 0;
  if (noDoor) for (let i = 0; i < n; i++) if ((meta[i] & SEG_CURVE) && noDoor[i]) flagged++;
  const doorChords = curveChords - flagged;
  // and what actually lands in the working mask
  const mo = buildMask(segs, IMG_W, IMG_H, MASK_MAX_DIM, meta, PXFT, PXFT);
  let curveCells = 0, noDoorCells = 0;
  for (let i = 0; i < mo.mask.length; i++) {
    if (mo.mask[i] & MASK_CURVE_BIT) curveCells++;
    if (MASK_NODOOR_BIT && (mo.mask[i] & MASK_NODOOR_BIT)) noDoorCells++;
  }
  // hatch classification must never claim a curve chord
  const soft = classifyHatchSegs(segs, meta, mo.ws, 24);
  let softChords = 0; for (let i = 0; i < n; i++) if (soft[i]) softChords++;
  return { form, chords: n, polylineArcsMarked: polyMarked, curveChords, nonDoorFlagged: flagged, doorChords, curveCells, noDoorCells, softChords, hasFlagNonDoorArcs: !!flagNonDoorArcs };
}

const out: any = { probe: "A5", flagNonDoorArcsExists: !!flagNonDoorArcs, fixtures: [] };
for (const f of FIXTURES) {
  const pm = new Uint8Array(f.poly.length >> 2);
  const polyRow = analyse(f.poly, pm, "polyline");
  const g = bezierGeometry(f.bez);
  const bezRow = analyse(g.segs, g.meta, "bezier");
  out.fixtures.push({ name: f.name, polyline: polyRow, bezier: bezRow });
}
console.log(JSON.stringify(out, null, 1));

// ── second table: how much floor may each shape hand over? ──────────────────
// The chord flags above are only an input. What decides whether a shape can
// annex floor is the PER-CLUSTER growth allowance inside floodRegionSealed.
//
//  legacyAllowance — BEFORE's rule, re-implemented here verbatim from
//    oneclick.ts@21e57a0 lines 1105-1112 (axis-aligned bbox + 3-cell rim, x
//    WEDGE_SLACK, capped at 2 x doorWedgeCapPx). Computed on BOTH states from
//    each state's own mask cells, so it isolates the guard from the mask.
//  engineAllowance — AFTER's wedgeAllowance(arcClusterFit(...)); absent on
//    BEFORE, where the legacy figure IS the engine's.
const cap = (OC as any).doorWedgeCapPx(PXFT);
const WEDGE_SLACK = (OC as any).WEDGE_SLACK;
const arcClusterFit = (OC as any).arcClusterFit;
const wedgeAllowance = (OC as any).wedgeAllowance;
const allow: any[] = [];
for (const f of FIXTURES) {
  for (const [form, segs, meta] of [
    ["polyline", f.poly, (() => { const m = new Uint8Array(f.poly.length >> 2); markPolylineArcs(f.poly, m); return m; })()] as const,
    ["bezier", ...(() => { const g = bezierGeometry(f.bez); return [g.segs, g.meta] as const; })()] as const,
  ]) {
    const mo = buildMask(segs as number[], IMG_W, IMG_H, MASK_MAX_DIM, meta as Uint8Array, PXFT, PXFT);
    const cl: number[] = [];
    for (let i = 0; i < mo.mask.length; i++) if (mo.mask[i] & MASK_CURVE_BIT) cl.push(i);
    if (!cl.length) { allow.push({ name: f.name, form, cells: 0, legacyAllowanceCells: 0, legacyAllowanceSF: 0, engineAllowanceCells: null, engineAllowanceSF: null }); continue; }
    let x0 = mo.mw, x1 = 0, y0 = mo.mh, y1 = 0;
    for (const i of cl) { const x = i % mo.mw, y = (i / mo.mw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const legacy = Math.min(2 * cap, Math.round((bw * bh + 3 * 2 * (bw + bh)) * WEDGE_SLACK));
    let eng: number | null = null, fitInfo: any = null;
    if (arcClusterFit && wedgeAllowance) {
      const fit = arcClusterFit(cl, mo.mw, mo.mask);
      eng = wedgeAllowance(fit, PXFT, cap);
      fitInfo = { good: fit.good, rFt: +(fit.r / PXFT).toFixed(2), sweepDeg: +((fit.sweep * 180) / Math.PI).toFixed(1), noDoorFrac: +fit.noDoorFrac.toFixed(3) };
    }
    allow.push({
      name: f.name, form, cells: cl.length, bbox: `${bw}x${bh}`,
      legacyAllowanceCells: legacy, legacyAllowanceSF: +(legacy / (PXFT * PXFT)).toFixed(1),
      engineAllowanceCells: eng, engineAllowanceSF: eng == null ? null : +(eng / (PXFT * PXFT)).toFixed(1), fit: fitInfo,
    });
  }
}
console.log("---ALLOWANCE---");
console.log(JSON.stringify({ doorWedgeCapPx: cap, ceilingSF: +((2 * cap) / (PXFT * PXFT)).toFixed(2), rows: allow }, null, 1));
