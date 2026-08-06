// Door-arc discrimination — the two defects this file exists to pin:
//
//  A4  a curved WALL annexing the space behind it. The claim on record was
//      that "a curved wall's thin box can never admit the closet behind it";
//      it was false. The arc's bounding box was AXIS-ALIGNED (a 30 ft chord at
//      30° boxes 468 × 315 px instead of 540 × its 45 px sagitta), the ceiling
//      was a constant ≈51.05 SF at every scale that ignored the arc's own
//      radius, and the growback rim was denominated in mask px. A 30 ft wall
//      with a 2.5 ft bulge annexed the whole 50 SF behind it, at confidence
//      0.97, labelled "incl. door swing", with NO DOOR ANYWHERE in the scene.
//
//  A5  non-doors detected as door arcs: revision clouds, round columns,
//      callout bubbles, duct elbows and curved millwork all marked. Only the
//      ellipse control held. Detection stays permissive on purpose (SEG_CURVE
//      means "curved linework", which they all are, and it is what exempts
//      them from hatch classification) — door-likelihood is carried
//      separately, in MASK_NODOOR_BIT and in the per-cluster re-fit.
//
// Fixtures come in BOTH polyline and bezier form: extractVectorGeometry stamps
// SEG_CURVE on every bezier chord unconditionally and markPolylineArcs flushes
// on it, so a discriminator scoped to the polyline path would never see a
// bezier-drawn column — and CAD emits circles as beziers.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMask, floodRegionSealed, traceRegion, ringArea, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, markPolylineArcs, flagNonDoorArcs, classifyHatchSegs,
  extractVectorGeometry, arcClusterFit, wedgeAllowance, wedgeRimPx,
  SEG_CURVE, SENS_BALANCED, MASK_CURVE_BIT, MASK_NODOOR_BIT,
  DOOR_R_MAX_FT, WEDGE_SLACK,
  type Point,
} from "../src/lib/oneclick.ts";
import { cloudBezier } from "../src/lib/geometry.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PXFT = 18;                                   // 1/4" = 1'-0" at render scale 1 — the corpus convention
const IMG_W = 1000, IMG_H = 800;
const sq = (x0: number, y0: number, x1: number, y1: number): number[] => [
  x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0,
];
const border = sq(2, 2, 998, 798);
const sf = (cells: number) => cells / (PXFT * PXFT);

/** `steps` chords of the circle (cx,cy,r) from a0 to a1. */
function arcChords(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): number[] {
  const segs: number[] = [];
  let px = cx + r * Math.cos(a0), py = cy + r * Math.sin(a0);
  for (let k = 1; k <= steps; k++) {
    const a = a0 + (a1 - a0) * (k / steps);
    const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
    segs.push(px, py, qx, qy); px = qx; py = qy;
  }
  return segs;
}
const circleChords = (cx: number, cy: number, r: number, steps: number) => arcChords(cx, cy, r, 0, 2 * Math.PI, steps);

/** Revision cloud: outward scallops of radius r along a rect, meeting at cusps
 *  (the r*1.6 chord spacing lib/geometry's own cloudPath uses ⇒ ~106° sweeps). */
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
      const cx = (px + qx) / 2 + ey * h, cy = (py + qy) / 2 - ex * h;   // centre INSIDE ⇒ scallop bulges out
      const a0 = Math.atan2(py - cy, px - cx), a1 = Math.atan2(qy - cy, qx - cx);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI;
      segs.push(...arcChords(cx, cy, r, a0, a0 + d, per));
    }
  }
  return segs;
}

/** Mirrored double door: two equal-radius 90° arcs, opposite turn sign, meeting
 *  at the closed-tip point in the middle of the opening. MUST NOT REGRESS. */
function doubleDoor(xL: number, yWall: number, R: number, per = 8): number[] {
  return [
    ...arcChords(xL, yWall, R, -Math.PI / 2, 0, per),
    ...arcChords(xL + 2 * R, yWall, R, Math.PI, (3 * Math.PI) / 2, per),
  ];
}

// ── bezier plumbing: run a fixture through the real op-list walk ────────────
const OPS = {
  save: 4, restore: 5, transform: 6, setLineWidth: 2, setGState: 3,
  constructPath: 9, moveTo: 10, lineTo: 11, curveTo: 12, curveTo2: 13, curveTo3: 14,
  closePath: 15, rectangle: 16, stroke: 20, fill: 22, eoFill: 23, endPath: 28, clip: 29, eoClip: 30,
  paintFormXObjectBegin: 40, paintFormXObjectEnd: 41,
  paintImageXObject: 50, paintInlineImageXObject: 51, paintImageMaskXObject: 52,
  paintImageXObjectRepeat: 53, paintImageMaskXObjectRepeat: 54,
  paintImageMaskXObjectGroup: 55, paintInlineImageXObjectGroup: 56,
};
/** Stroked paths, each [ops, coords] as pdf.js hands them over. */
function bezierGeometry(paths: Array<[number[], number[]]>) {
  return extractVectorGeometry(
    { fnArray: paths.flatMap(() => [OPS.constructPath, OPS.stroke]), argsArray: paths.flatMap((p) => [p, null]) },
    [1, 0, 0, 1, 0, 0],
    OPS,
  );
}
const K = 0.5522847498;                            // quarter-circle bezier constant
/** A circle as FOUR cubic beziers — how CAD writes one — including the
 *  zero-length lineTo pdf.js emits between the halves of a real plan's column. */
function bezierCircle(cx: number, cy: number, r: number): [number[], number[]] {
  const quads: number[][] = [
    [cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r],
    [cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy],
    [cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r],
    [cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy],
  ];
  const ops: number[] = [OPS.moveTo], co: number[] = [cx + r, cy];
  for (let q = 0; q < 4; q++) {
    if (q === 2) { ops.push(OPS.lineTo); co.push(cx - r, cy); }   // pdf.js's degenerate joint
    ops.push(OPS.curveTo); co.push(...quads[q]);
  }
  return [ops, co];
}
/** lib/geometry's own revision cloud, as the cubic path a marked-set PDF holds. */
function bezierCloud(x0: number, y0: number, x1: number, y1: number): [number[], number[]] {
  const { start, segments } = cloudBezier(x0, y0, x1, y1) as { start: Point; segments: Point[][] };
  const ops: number[] = [OPS.moveTo], co: number[] = [start[0], start[1]];
  for (const [c1, c2, end] of segments) { ops.push(OPS.curveTo); co.push(c1[0], c1[1], c2[0], c2[1], end[0], end[1]); }
  return [ops, co];
}

const zeroMeta = (segs: number[]) => new Uint8Array(segs.length >> 2);
function markedMeta(segs: number[], curveFrom?: number, curveCount?: number): Uint8Array {
  const meta = zeroMeta(segs);
  if (curveFrom != null) for (let k = 0; k < (curveCount ?? 0); k++) meta[curveFrom + k] = SEG_CURVE;
  return meta;
}

// ════════════════════════════════════════════════════════════════════════════
// A4 — curved walls must not annex the space behind them
// ════════════════════════════════════════════════════════════════════════════

/** The reproduction scene: a 30 ft curved corridor wall bulging 2.5 ft into a
 *  big room (R ≈ 46 ft), drawn diagonally so an axis-aligned box is near-square,
 *  tessellated as 12 chords. Behind it — between the arc and the straight wall
 *  on its chord — is a lune of exactly (2/3)·30·2.5 = 50 SF. NO DOOR anywhere.
 *  50 SF sits just under the old ceiling of 2 × a 5 ft door's wedge (51.05 SF
 *  at every mppf), which is what let the whole space ride in: the fixture is AT
 *  the guard's boundary, not comfortably past it the way the bench's
 *  curved-partition case is (its space-behind is >2× its arc's allowance, so
 *  that case never exercises the guard at all). */
function curvedWallScene(nChords = 12, chordLenPx = 30 * PXFT, sagittaPx = 2.5 * PXFT) {
  const A: Point = [140, 440];
  const ang = -Math.PI / 6;                                    // 30° — diagonal, so the axis box is fat
  const B: Point = [A[0] + chordLenPx * Math.cos(ang), A[1] + chordLenPx * Math.sin(ang)];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const R = (L / 2) ** 2 / (2 * sagittaPx) + sagittaPx / 2;
  const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  const nx = -uy, ny = ux;
  const mid: Point = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const s = ny > 0 ? 1 : -1;                                   // bulge downward, into the room
  const cX = mid[0] - s * nx * (R - sagittaPx), cY = mid[1] - s * ny * (R - sagittaPx);
  const aA = Math.atan2(A[1] - cY, A[0] - cX), aB = Math.atan2(B[1] - cY, B[0] - cX);
  let d = aB - aA; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI;
  const arc = arcChords(cX, cY, R, aA, aA + d, nChords);
  const room = sq(100, 100, 660, 480);
  const chordWall = [A[0], A[1], B[0], B[1]];
  const all = [...border, ...room, ...chordWall, ...arc];
  const meta = markedMeta(all, (all.length - arc.length) >> 2, nChords);
  return { all, meta, R, luneCells: (2 / 3) * L * sagittaPx };
}

test("A4: a 30 ft curved wall (2.5 ft bulge) does not annex the ~50 SF behind it — no door in the scene", () => {
  const { all, meta, R, luneCells } = curvedWallScene();
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const mppf = mask.mppf!;
  assert.equal(mppf, PXFT);
  assert.ok(Math.abs(R / PXFT - 46.25) < 0.2, `R ≈ 46 ft, got ${(R / PXFT).toFixed(1)}`);
  // the fixture sits AT the old guard's boundary, not past it
  assert.ok(luneCells < 2 * doorWedgeCapPx(mppf), `space behind (${sf(luneCells).toFixed(1)} SF) is under the old ${sf(2 * doorWedgeCapPx(mppf)).toFixed(1)} SF ceiling`);
  assert.ok(luneCells > 1.8 * doorWedgeCapPx(mppf), "…and close enough to it to exercise the guard");

  const seed: Point = [150, 150];
  const bare = floodRegionSealed(mask, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), 0, minPassRadiusFor(mppf));
  const withWedge = floodRegionSealed(mask, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(bare.status, "ok");
  assert.equal(withWedge.status, "ok");
  if (bare.status !== "ok" || withWedge.status !== "ok") return;
  assert.ok(!withWedge.wedges, `no wedge may be annexed — got ${withWedge.wedges}`);
  assert.equal(withWedge.count, bare.count, `the curved wall annexed ${sf(withWedge.count - bare.count).toFixed(1)} SF it must not`);
});

test("A4: the arc's own fitted radius is what refuses it — a 46 ft radius is not a door leaf", () => {
  const { all, meta } = curvedWallScene();
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  // every curve cell of the scene is the one wall arc
  const cl: number[] = [];
  for (let i = 0; i < mask.mask.length; i++) if (mask.mask[i] & MASK_CURVE_BIT) cl.push(i);
  const fit = arcClusterFit(cl, mask.mw, mask.mask);
  assert.ok(fit.good, `a tessellated arc fits one circle (rms ${fit.rms.toFixed(2)})`);
  assert.ok(fit.r / mask.mppf! > DOOR_R_MAX_FT, `fitted radius ${(fit.r / mask.mppf!).toFixed(1)} ft is past the ${DOOR_R_MAX_FT} ft leaf cap`);
  assert.equal(wedgeAllowance(fit, mask.mppf!, doorWedgeCapPx(mask.mppf!)), 0, "so it gets no door allowance at all");
  // and the CHORD-FRAME box is the arc's true thin extent, not a fat square
  assert.ok(fit.bn < 3 * 2.5 * PXFT, `chord-frame depth ${fit.bn.toFixed(0)} px ≈ the 45 px sagitta, not the 315 px axis-aligned height`);
  assert.ok(fit.bu > 0.9 * 30 * PXFT, `chord-frame length ${fit.bu.toFixed(0)} px ≈ the 540 px chord`);
});

test("A4: a POOR-fitting (wavy) diagonal wall is bounded by its CHORD-FRAME box, not its axis-aligned one", () => {
  // Two arcs of different radius joined into one shallow diagonal wall — no
  // single circle explains it, so the feet-true radius test cannot fire and the
  // box is the whole guard. It cuts a ~45 SF closet off the room's corner:
  // under the 51 SF ceiling (so the old ceiling admitted it), and well over the
  // chord-frame box (so the arc's own extent refuses it) — while the
  // axis-aligned box of the same diagonal arc is 4× larger and admitted it.
  const bowed = (from: Point, to: Point, sag: number, steps: number): number[] => {
    const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const R = (L / 2) ** 2 / (2 * sag) + sag / 2;
    const ux = (to[0] - from[0]) / L, uy = (to[1] - from[1]) / L;
    const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const cX = mid[0] + uy * (R - sag), cY = mid[1] - ux * (R - sag);   // bulge away from the corner
    const a0 = Math.atan2(from[1] - cY, from[0] - cX), a1 = Math.atan2(to[1] - cY, to[0] - cX);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI;
    return arcChords(cX, cY, R, a0, a0 + d, steps);
  };
  const A: Point = [100, 255], M: Point = [177.5, 177.5], B: Point = [255, 100];
  const wave = [...bowed(A, M, 12, 7), ...bowed(M, B, 24, 7)];
  const room = sq(100, 100, 560, 500);
  const all = [...border, ...room, ...wave];
  const meta = markedMeta(all, (all.length - wave.length) >> 2, wave.length >> 2);
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const mppf = mask.mppf!;
  const cl: number[] = [];
  for (let i = 0; i < mask.mask.length; i++) if (mask.mask[i] & MASK_CURVE_BIT) cl.push(i);
  const fit = arcClusterFit(cl, mask.mw, mask.mask);
  assert.equal(fit.good, false, "a two-radius wave fits no single circle");
  const axisArea = (() => {                                    // what the old guard measured
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of cl) { const x = i % mask.mw, y = (i / mask.mw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    return Math.round((bw * bh + 3 * 2 * (bw + bh)) * WEDGE_SLACK);
  })();
  const allow = wedgeAllowance(fit, mppf, doorWedgeCapPx(mppf));
  assert.ok(allow < axisArea / 2, `chord-frame allowance ${allow} is far under the axis-aligned ${axisArea}`);
  assert.ok(Math.min(axisArea, 2 * doorWedgeCapPx(mppf)) > allow * 1.5, "…and the OLD guard (axis box, capped at 51 SF) was looser");

  const seed: Point = [400, 400];
  const bare = floodRegionSealed(mask, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), 0, minPassRadiusFor(mppf));
  const wedged = floodRegionSealed(mask, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(bare.status, "ok");
  assert.equal(wedged.status, "ok");
  if (bare.status !== "ok" || wedged.status !== "ok") return;
  assert.ok(!wedged.wedges, `the closet behind a wavy wall must not annex — got ${sf(wedged.count - bare.count).toFixed(1)} SF`);
});

test("A4: the growback rim is FEET-true — the same arc gets the same allowance in SF at 2× raster", () => {
  // The rim used to be a flat 3 mask cells: its AREA is width × perimeter, so
  // with the perimeter growing as mppf the rim shrank as 1/mppf in SF and the
  // same drawing got a different allowance at a different raster.
  assert.equal(wedgeRimPx(PXFT), 3, "3 cells at the 18 px/ft calibration — the historical value");
  assert.equal(wedgeRimPx(2 * PXFT), 6, "…and 2× the cells at 2× the raster, so the FEET stay put");
  assert.equal(wedgeRimPx(4), 3, "raster-honesty floor: never under 3 cells");

  const allowSF = (mppf: number) => {
    const R = 3 * mppf;                                        // a 3 ft door leaf
    const mw = 1200;
    const cl: number[] = [];
    const steps = Math.ceil(2 * Math.PI * R);
    for (let k = 0; k <= steps / 4; k++) {
      const a = (k / steps) * 2 * Math.PI;
      cl.push(Math.round(400 + R * Math.sin(a)) + mw * Math.round(400 - R * Math.cos(a)));
    }
    const uniq = [...new Set(cl)].sort((a, b) => a - b);
    const fit = arcClusterFit(uniq, mw, new Uint8Array(mw * 900));
    return wedgeAllowance(fit, mppf, doorWedgeCapPx(mppf)) / (mppf * mppf);
  };
  const a18 = allowSF(PXFT), a36 = allowSF(2 * PXFT);
  assert.ok(Math.abs(a18 - a36) / a18 < 0.05, `allowance ${a18.toFixed(2)} SF vs ${a36.toFixed(2)} SF at 2× raster`);
});

test("A4: a real 3 ft door swing still annexes its wedge (the guard must not eat doors)", () => {
  const R = 3 * PXFT;
  const room = [
    100, 100, 316, 100, 316, 100, 316, 280, 316, 280, 262, 280,
    208, 280, 100, 280, 100, 280, 100, 100,
  ];
  const leaf = [208, 280, 208, 280 - R];
  const arc = arcChords(208, 280, R, -Math.PI / 2, 0, 8);
  const all = [...border, ...room, ...leaf, ...arc];
  const meta = markedMeta(all, (all.length - arc.length) >> 2, arc.length >> 2);
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const f = floodRegionSealed(mask, 200, 200, SENS_BALANCED, sealRadiiFor(PXFT), doorWedgeCapPx(PXFT));
  assert.equal(f.status, "ok");
  if (f.status !== "ok") return;
  // RE-PINNED 2026-08-04 (upstream sync): 1 -> 2 wedges, and the MEASUREMENT is
  // unchanged (the wall-to-wall assertion below is the same). Upstream's #191
  // offers a door's LEAF as its own opening as well as its arc — the correct
  // mark for an IN-SWING door, whose sector sits behind the leaf where opening
  // the arc can never reach. This fixture draws both marks, so both openings are
  // now tried and both are accepted; the sector they admit is the same floor.
  // What the guard here is for — that the wedge is annexed at all, and bounded
  // by the arc's own fitted radius — is asserted unchanged.
  assert.equal(f.wedges, 2, "the swing wedge is annexed (arc opening + leaf opening, #191)");
  assert.ok(Math.abs(ringArea(traceRegion(f)) - 214 * 178) / (214 * 178) < 0.04, "reads wall-to-wall");

  // …and it is bounded by the arc's OWN radius: the sector the leaf sweeps
  // about the fitted centre (the hinge), not the box that has to contain it.
  const cl: number[] = [];
  for (let i = 0; i < mask.mask.length; i++) if (mask.mask[i] & MASK_CURVE_BIT) cl.push(i);
  const fit = arcClusterFit(cl, mask.mw, mask.mask);
  assert.ok(fit.good && Math.abs(fit.r - R) < 2, `fitted radius ${fit.r.toFixed(1)} ≈ the ${R} px leaf`);
  const sector = 0.5 * fit.sweep * fit.r * fit.r;
  const rim = wedgeRimPx(PXFT), rimArea = 2 * rim * (fit.buH + fit.bnH) + 4 * rim * rim;
  assert.ok(fit.buH * fit.bnH > sector * 1.4, "the box that reaches the hinge is much larger than the wedge inside it");
  assert.equal(
    wedgeAllowance(fit, PXFT, doorWedgeCapPx(PXFT)),
    Math.min(2 * doorWedgeCapPx(PXFT), Math.round((sector + rimArea) * WEDGE_SLACK)),
    "allowance = the fitted sector + a feet-true rim, with slack",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// A5 — non-doors must not be taken for door arcs
// ════════════════════════════════════════════════════════════════════════════

const vetoCount = (segs: number[], meta?: Uint8Array) => {
  const m = meta ?? zeroMeta(segs);
  if (!meta) markPolylineArcs(segs, m);
  const v = flagNonDoorArcs(segs, m);
  let marked = 0, vetoed = 0;
  for (let i = 0; i < m.length; i++) { if (m[i] & SEG_CURVE) marked++; if (v[i]) vetoed++; }
  return { n: m.length, marked, vetoed };
};

test("A5.1 closed circles (round column, callout bubble) are refused as door arcs — polyline form", () => {
  for (const [name, segs] of [
    ["round column, 4 ft dia", circleChords(400, 400, 2 * PXFT, 24)],
    ["callout bubble, 3 ft dia", circleChords(600, 200, 1.5 * PXFT, 16)],
  ] as const) {
    const r = vetoCount(segs as number[]);
    assert.equal(r.marked, r.n, `${name}: still SEG_CURVE (curved linework it is)`);
    assert.equal(r.vetoed, r.n, `${name}: every chord refused as a door arc`);
  }
});

test("A5.1 a BEZIER-drawn circle — how CAD writes one — is refused too, degenerate joint and all", () => {
  // pdf.js emits a ZERO-LENGTH lineTo between the halves of a real plan's
  // column; letting that break the chain split the circle into two 180° arcs,
  // neither of which closes, and the column read as two door-sized swings.
  const g = bezierGeometry([bezierCircle(400, 400, 2 * PXFT)]);
  let curve = 0;
  for (const m of g.meta) if (m & SEG_CURVE) curve++;
  assert.ok(curve >= 32, `bezier chords carry SEG_CURVE unconditionally (${curve})`);
  const v = flagNonDoorArcs(g.segs, g.meta);
  let vetoed = 0;
  for (let i = 0; i < v.length; i++) if (v[i]) vetoed++;
  assert.ok(vetoed >= curve - 1, `the bezier circle is refused as a door arc (${vetoed}/${curve})`);
  // …and it reaches the mask as such
  const mask = buildMask(g.segs, IMG_W, IMG_H, 3000, g.meta, PXFT, PXFT);
  let curveCells = 0, noDoorCells = 0;
  for (const c of mask.mask) { if (c & MASK_CURVE_BIT) curveCells++; if (c & MASK_NODOOR_BIT) noDoorCells++; }
  assert.ok(curveCells > 0 && noDoorCells > curveCells * 0.9, `mask carries MASK_NODOOR_BIT (${noDoorCells}/${curveCells})`);
});

test("A5.3 a revision cloud is refused as a cusp chain — polyline AND bezier form", () => {
  const poly = revisionCloud(200, 200, 340, 300, 18, 6);
  const rp = vetoCount(poly);
  assert.equal(rp.marked, rp.n, "cloud scallops are still curved linework");
  assert.equal(rp.vetoed, rp.n, "…and every one is refused as a door arc");

  const g = bezierGeometry([bezierCloud(200, 400, 400, 520)]);
  const v = flagNonDoorArcs(g.segs, g.meta);
  let curve = 0, vetoed = 0;
  for (let i = 0; i < g.meta.length; i++) { if (g.meta[i] & SEG_CURVE) curve++; if (v[i]) vetoed++; }
  assert.ok(curve > 20, `bezier cloud tessellates to ${curve} chords`);
  assert.ok(vetoed >= curve * 0.9, `bezier cloud refused as a door arc (${vetoed}/${curve})`);
});

test("A5.3 a MIRRORED DOUBLE DOOR is NOT a cusp chain — must-not-regress", () => {
  // Two 90° arcs, equal radius, opposite turn sign, shared meeting point:
  // the same signature as a cloud scallop pair. The naive cusp rule deletes
  // it; requiring similar radius AND small radius AND >= 3 reversals spares it.
  const segs = doubleDoor(200, 500, 3 * PXFT, 8);
  const r = vetoCount(segs);
  assert.equal(r.marked, r.n, "both leaves detected as arcs (16/16)");
  assert.equal(r.vetoed, 0, "and neither is refused as a door");

  // end to end: a room with a double door annexes BOTH wedges. A 4'-6" pair,
  // because the seal ladder only bridges DOOR_SEAL_MAX_FT of open wall.
  const R = 2.25 * PXFT;
  const xL = 154;
  const room = [
    100, 100, 316, 100, 316, 100, 316, 280, 316, 280, xL + 2 * R, 280,
    xL, 280, 100, 280, 100, 280, 100, 100,
  ];
  const leaves = [xL, 280, xL, 280 - R, xL + 2 * R, 280, xL + 2 * R, 280 - R];
  const arcs = doubleDoor(xL, 280, R, 8);
  const all = [...border, ...room, ...leaves, ...arcs];
  const meta = markedMeta(all, (all.length - arcs.length) >> 2, arcs.length >> 2);
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const bare = floodRegionSealed(mask, 200, 200, SENS_BALANCED, sealRadiiFor(PXFT), 0);
  const f = floodRegionSealed(mask, 200, 200, SENS_BALANCED, sealRadiiFor(PXFT), doorWedgeCapPx(PXFT));
  assert.equal(f.status, "ok");
  assert.equal(bare.status, "ok");
  if (f.status !== "ok" || bare.status !== "ok") return;
  assert.ok((f.wedges ?? 0) >= 1, "the double door's swing is annexed");
  const twoWedges = 2 * (Math.PI / 4) * R * R;
  assert.ok(f.count - bare.count > twoWedges * 0.7, `both leaves' floor is counted (${f.count - bare.count} vs ${Math.round(twoWedges)})`);
});

test("A5 a revision cloud drawn ACROSS a wall cannot open it — the refusal, not the arithmetic, is the guard", () => {
  // The failure the growth allowance was silently standing in for: a cloud
  // over a demising wall. Its scallops share cells with the wall, so opening
  // the cluster punches a hole and the fill walks into the next room. The
  // cloud fits no single circle, so nothing about its geometry bounds the
  // growth — only the cusp-chain refusal does, and the neighbour here is
  // comfortably inside the old ceiling.
  const roomA = sq(100, 100, 500, 400);
  const roomB = sq(500, 150, 560, 300);
  const cloud = revisionCloud(460, 180, 540, 270, 18, 6);
  const all = [...border, ...roomA, ...roomB, ...cloud];
  const meta = markedMeta(all, (all.length - cloud.length) >> 2, cloud.length >> 2);
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const mppf = mask.mppf!;
  const cl: number[] = [];
  for (let i = 0; i < mask.mask.length; i++) if (mask.mask[i] & MASK_CURVE_BIT) cl.push(i);
  const fit = arcClusterFit(cl, mask.mw, mask.mask);
  assert.equal(fit.good, false, "a cloud fits no single circle — its geometry bounds nothing");
  assert.ok(fit.noDoorFrac > 0.9, `…and it is flagged as a non-door (${fit.noDoorFrac.toFixed(2)})`);
  const neighbourCells = 58 * 148;
  assert.ok(neighbourCells < 2 * doorWedgeCapPx(mppf), `the neighbour (${sf(neighbourCells).toFixed(1)} SF) fits under the old ${sf(2 * doorWedgeCapPx(mppf)).toFixed(1)} SF ceiling`);

  const bare = floodRegionSealed(mask, 300, 250, SENS_BALANCED, sealRadiiFor(mppf), 0);
  const f = floodRegionSealed(mask, 300, 250, SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf));
  assert.equal(bare.status, "ok");
  assert.equal(f.status, "ok");
  if (bare.status !== "ok" || f.status !== "ok") return;
  const probe = Math.round(225 * mask.ws) * mask.mw + Math.round(530 * mask.ws);
  assert.equal(bare.region[probe], 0, "control: the neighbouring room is outside the fill");
  assert.equal(f.region[probe], 0, `the cloud must not open the wall — it annexed ${sf(f.count - bare.count).toFixed(1)} SF`);
});

test("A5.2 the door-leaf radius band is FEET-true and applied at CLUSTER time, not at render time", () => {
  // The decision on record: markPolylineArcs runs inside extractVectorGeometry
  // at render time, with no sheet scale, often before calibration — and
  // rescaleSheet evicts only the mask cache, so render-time arc marks are never
  // recomputed. So the marks stay scale-free and the feet-true test moves to
  // cluster time, where MaskObj.mppf exists and where a recalibration (which
  // rebuilds the mask) automatically re-decides. This test pins BOTH halves.
  const room = [
    100, 100, 700, 100, 700, 100, 700, 500, 700, 500, 100, 500, 100, 500, 100, 100,
  ];
  const elbow = arcChords(400, 500, 12 * PXFT, -Math.PI / 2, -Math.PI / 6, 8);   // 12 ft duct elbow on the boundary
  const all = [...border, ...room, ...elbow];
  const meta = markedMeta(all, (all.length - elbow.length) >> 2, elbow.length >> 2);

  const uncal = buildMask(all, IMG_W, IMG_H, 3000, meta);                 // no scale yet
  const cal = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);       // after calibration
  assert.equal(uncal.mppf, 0);
  assert.equal(cal.mppf, PXFT);
  // the render-time marks are identical either way — nothing physical was
  // tested there, so no arc mark can go stale across a recalibration
  assert.deepEqual(Array.from(uncal.mask), Array.from(cal.mask), "the mask's curve/no-door planes do not depend on the scale");

  const cl: number[] = [];
  for (let i = 0; i < cal.mask.length; i++) if (cal.mask[i] & MASK_CURVE_BIT) cl.push(i);
  const fit = arcClusterFit(cl, cal.mw, cal.mask);
  assert.ok(fit.good && fit.r / PXFT > DOOR_R_MAX_FT, `12 ft elbow: fitted ${(fit.r / PXFT).toFixed(1)} ft`);
  assert.equal(wedgeAllowance(fit, PXFT, doorWedgeCapPx(PXFT)), 0, "refused once the scale is known");
  assert.ok(wedgeAllowance(fit, 0, doorWedgeCapPx(PXFT)) > 0, "…and honestly NOT refused while the scale is unknown");
});

test("A5 the wedge budget is spent on the most door-like clusters, not the first ones in scanline order", () => {
  // 14 small round fixture symbols across the top of a room + one real door on
  // the bottom wall. Taken in scanline order the 12-wedge budget is gone before
  // the door is ever reached, and the room silently loses its swing.
  const YW = 460;
  const room = [
    100, 100, 640, 100, 640, 100, 640, YW, 640, YW, 424, YW,
    370, YW, 100, YW, 100, YW, 100, 100,
  ];
  const R = 3 * PXFT;
  const leaf = [370, YW, 370, YW - R];
  const door = arcChords(370, YW, R, -Math.PI / 2, 0, 8);
  const columns: number[] = [];
  for (let k = 0; k < 14; k++) columns.push(...circleChords(140 + k * 30, 180, 0.6 * PXFT, 20));
  const all = [...border, ...room, ...columns, ...leaf, ...door];
  const meta = zeroMeta(all);
  const colStart = (border.length + room.length) >> 2;
  for (let j = 0; j < columns.length >> 2; j++) meta[colStart + j] = SEG_CURVE;
  for (let j = 0; j < door.length >> 2; j++) meta[((all.length - door.length) >> 2) + j] = SEG_CURVE;

  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const bare = floodRegionSealed(mask, 400, 400, SENS_BALANCED, sealRadiiFor(PXFT), 0);
  const f = floodRegionSealed(mask, 400, 400, SENS_BALANCED, sealRadiiFor(PXFT), doorWedgeCapPx(PXFT));
  assert.equal(bare.status, "ok");
  assert.equal(f.status, "ok");
  if (bare.status !== "ok" || f.status !== "ok") return;
  assert.ok((f.wedges ?? 0) >= 10, `the budget is essentially fully spent (${f.wedges} wedges)`);
  // A point squarely inside the door's swing pocket — outside the plain fill,
  // inside it only if the DOOR is one of the clusters the budget reached.
  const probe = Math.round((YW - 20) * mask.ws) * mask.mw + Math.round(390 * mask.ws);
  assert.equal(bare.region[probe], 0, "control: the swing pocket is outside the plain fill");
  assert.equal(f.region[probe], 1, "the door's wedge survives 14 columns ahead of it in scanline order");
});

test("A5 refusing an arc must NOT un-mark it — un-marked chords become hatch-eligible", () => {
  // The choice on record: keep SEG_CURVE on every detected arc (so
  // classifyHatchSegs' load-bearing skip still applies) and carry the refusal
  // in MASK_NODOOR_BIT. The alternative — un-marking refused chords — puts them
  // straight back into hatch classification, and a large tessellated circle
  // laid over a fill has chords that sit in the fill's own lattice: they would
  // classify soft and the escalated flood would walk out through the hole.
  const hatch: number[] = [];
  for (let y = 100; y <= 180; y += 4) hatch.push(200, y, 400, y);        // pitch-4 fill
  const circle = circleChords(300, 300, 160, 96);                        // apex chord runs along the fill
  const segs = [...hatch, ...circle];
  const meta = zeroMeta(segs);
  const arcFrom = hatch.length >> 2;
  markPolylineArcs(segs, meta);
  const veto = flagNonDoorArcs(segs, meta);
  let vetoed = 0;
  for (let i = arcFrom; i < veto.length; i++) if (veto[i]) vetoed++;
  assert.ok(vetoed > (circle.length >> 2) * 0.9, `the big circle is refused as a door arc (${vetoed})`);
  for (let i = arcFrom; i < meta.length; i++) assert.ok(meta[i] & SEG_CURVE, `chord ${i} keeps SEG_CURVE`);

  const kept = classifyHatchSegs(segs, meta, 1, 24);
  for (let i = arcFrom; i < kept.length; i++) assert.equal(kept[i], 0, `chord ${i} is exempt from hatch classification`);
  // …and the hazard is real: strip the mark and the arc's own chords soften
  const soft = classifyHatchSegs(segs, zeroMeta(segs), 1, 24);
  let softened = 0;
  for (let i = arcFrom; i < soft.length; i++) if (soft[i]) softened++;
  assert.ok(softened > 0, `un-marking would make ${softened} of the circle's chords hatch — which is why refusal keeps the mark`);
});

test("A5 the ellipse negative control still holds, and a plain door arc is untouched", () => {
  const ellipse: number[] = [];
  let px = 260, py = 300;
  for (let k = 1; k <= 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    const qx = 200 + 60 * Math.cos(a), qy = 300 + 30 * Math.sin(a);
    ellipse.push(px, py, qx, qy); px = qx; py = qy;
  }
  const e = vetoCount(ellipse);
  assert.equal(e.marked, 0, "an ellipse is not an arc at all");
  const d = vetoCount(arcChords(200, 500, 3 * PXFT, -Math.PI / 2, 0, 8));
  assert.equal(d.marked, d.n, "a 3 ft door swing is detected");
  assert.equal(d.vetoed, 0, "…and not refused");
});

// ── F7(g): the round-column wedge — PINNED, not decided ────────────────────
// A round column drawn as a closed circle inside a room is flagged a non-door
// (MASK_NODOOR_BIT, test A5.1 above) — and it STILL gets a full wedge, because
// `wedgeAllowance` refuses a flagged cluster only when it fits no clean circle.
// A circle fits itself, so its own sector (0.5·2π·r² = its interior) bounds the
// growth, the retry is accepted, and the column's interior is annexed as FLOOR.
//
// This is deliberate and corpus-pinned: on the VA finish plan the floor inside a
// drawn ring counts as floor (bench probe `annotation-ring-room`, and its 1.00
// confidence is a separate known finding). For flooring practice, though, a
// structural column is usually a DEDUCT, not covered floor — that is a
// measurement-POLICY question for the operator, not an engine bug, and this
// change does not answer it. So:
//   • the MEASUREMENT is pinned here exactly as it behaves today;
//   • the CLAIM is corrected — `ringWedges` counts wedges that annexed a closed
//     ring's interior, and the canvas readout no longer says "incl. door swing"
//     for a full circle with no door in the scene (there was none: the wedge is
//     the circle's own interior). `mcp` reports it as `ring_interiors`.
// If the policy is ever decided the other way, the fix is at `wedgeAllowance`
// (refuse `noDoorFrac > 0.5` unconditionally, or mint a deduct) — and THIS TEST
// is what will fail and have to be rewritten, which is the point of pinning it.
test("F7(g) a round column's interior is annexed as floor, and is counted as a RING, not a door swing", () => {
  const room = sq(100, 100, 500, 400);
  const R = 1.5 * PXFT;                                    // 3 ft dia column
  const col = circleChords(300, 250, R, 32);
  const all = [...border, ...room, ...col];
  const meta = markedMeta(all, (all.length - col.length) >> 2, col.length >> 2);
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const mppf = mask.mppf!;

  // the cluster is exactly the case wedgeAllowance lets through: flagged as a
  // non-door AND a clean circle fit
  const cl: number[] = [];
  for (let i = 0; i < mask.mask.length; i++) if (mask.mask[i] & MASK_CURVE_BIT) cl.push(i);
  const fit = arcClusterFit(cl, mask.mw, mask.mask);
  assert.ok(fit.noDoorFrac > 0.5, `the column is flagged a non-door (${fit.noDoorFrac.toFixed(2)})`);
  assert.ok(fit.good, `…and fits one clean circle (rms ${fit.rms.toFixed(2)})`);
  assert.ok((fit.sweep * 180) / Math.PI > 350, `…closing (sweep ${((fit.sweep * 180) / Math.PI).toFixed(0)}°)`);
  assert.ok(wedgeAllowance(fit, mppf, doorWedgeCapPx(mppf)) >= 1, "…so it receives an allowance, not a refusal");

  const bare = floodRegionSealed(mask, 150, 150, SENS_BALANCED, sealRadiiFor(mppf), 0);
  const f = floodRegionSealed(mask, 150, 150, SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(bare.status, "ok");
  assert.equal(f.status, "ok");
  if (bare.status !== "ok" || f.status !== "ok") return;

  // MEASUREMENT, pinned: the wedge is taken and the column's interior is inside
  // the region. (Without the retry the flood goes AROUND the column: traceRegion
  // takes the outer contour, so the ring already spans it — what the wedge moves
  // is the CELL COUNT, i.e. anything reading f.count/f.region.)
  assert.equal(f.wedges, 1, "the column gets exactly one wedge");
  const centre = Math.round(250 * mask.ws) * mask.mw + Math.round(300 * mask.ws);
  assert.equal(bare.region[centre], 0, "control: without the retry the column's interior is NOT floor");
  assert.equal(f.region[centre], 1, "with the retry it is — pinned behaviour, the operator's policy call");
  const annexed = sf(f.count - bare.count);
  const colSF = (Math.PI * R * R) / (PXFT * PXFT);         // ≈ 7.07 SF
  assert.ok(Math.abs(annexed - colSF) / colSF < 0.20,
    `what was annexed is the column's own interior (${annexed.toFixed(2)} SF vs πr² = ${colSF.toFixed(2)} SF), not the space beyond it`);

  // CLAIM, corrected: every wedge here is a ring interior, so no surface may say
  // "door swing". This is the assertion that fails if `ringWedges` is dropped.
  assert.equal(f.ringWedges, 1, "the wedge is recorded as a closed-ring interior");
  assert.equal(f.ringWedges, f.wedges, "…and there is no door in this scene at all");
});

test("F7(g) a real door swing is NOT counted as a ring — the discriminator has to discriminate", () => {
  // Same room, a 3 ft door leaf + swing arc in the right wall. `ringWedges` must
  // stay absent, or the corrected messaging would call every door a column.
  const room = [
    ...sq(100, 100, 500, 400).slice(0, 8),                 // top + right-upper
    500, 100, 500, 200, 500, 200 + 3 * PXFT, 500, 400,     // right wall, 3 ft opening
    500, 400, 100, 400, 100, 400, 100, 100,
  ];
  const leaf = [500, 200, 500 + 3 * PXFT, 200];
  const arc = arcChords(500, 200, 3 * PXFT, 0, Math.PI / 2, 8);
  const all = [...border, ...room, ...leaf, ...arc];
  const meta = markedMeta(all, (all.length - arc.length) >> 2, arc.length >> 2);
  const mask = buildMask(all, IMG_W, IMG_H, 3000, meta, PXFT, PXFT);
  const mppf = mask.mppf!;
  const f = floodRegionSealed(mask, 300, 250, SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(f.status, "ok");
  if (f.status !== "ok") return;
  assert.ok((f.wedges ?? 0) >= 1, `the door's wedge is taken (wedges ${f.wedges})`);
  assert.equal(f.ringWedges, undefined, "a door swing is not a closed ring — nothing to correct here");
});

// The messaging half of F7(g), which no test in this suite can execute:
// TakeoffCanvas.jsx is a React component and there is no DOM here. Reverting the
// engine's `ringWedges` counter fails the test above; reverting only the STRINGS
// would leave every assertion green while the product went back to telling the
// estimator a round column's interior was "incl. door swing" — with no door
// anywhere in the scene. So the strings are scanned. (Same device as
// benchProductionRing.test.ts's call-site guard.)
test("F7(g) the canvas never calls a closed ring's interior a door swing", () => {
  const canvas = readFileSync(fileURLToPath(new URL("../src/pages/TakeoffCanvas.jsx", import.meta.url)), "utf8");
  // 1. the hover/live badge branches on ringWedges before it says "door swing"
  assert.match(canvas, /res\.wedges \? \(res\.ringWedges >= res\.wedges \? " · incl\. ring interior"/,
    "the live One-Click badge must read 'incl. ring interior' when every wedge was a closed ring");
  assert.match(canvas, /res\.ringWedges \? " · incl\. door swing \+ ring interior"/,
    "…and name both when a room has a real door AND a column");
  // 2. the commit-message ladder has an all-rings branch, and it does not
  //    mention a door swing — that is the whole correction.
  const allRings = canvas.match(/else if \(f\.wedges && f\.ringWedges >= f\.wedges\) setCommitMsg\([\s\S]*?\);\n/);
  assert.ok(allRings, "no all-rings commit-message branch — a full-circle cluster would fall through to the door-swing text");
  // it may MENTION a door swing only to deny one; it may not assert one happened
  assert.doesNotMatch(allRings[0], /the swing area is included|through the drawn door/,
    "the all-rings message must not claim a door swing was measured through: a closed circle is not a door");
  assert.match(allRings[0], /no door swing was involved/, "…it has to say so out loud");
  assert.match(allRings[0], /closed ring/, "…and say what it actually measured");
  // …and hand the deduct-vs-floor policy question to the estimator with the
  // gesture that answers it, rather than deciding it in the engine
  assert.match(allRings[0], /⌥-click carves/, "the operator's policy call needs the carve gesture named");
  // 3. …and the plain door-swing message is only reachable when no wedge was a ring
  const doorOnly = canvas.match(/else if \(f\.wedges\) setCommitMsg\([\s\S]*?\);\n/);
  assert.ok(doorOnly && /door/.test(doorOnly[0]), "the real door-swing message must still exist");
  const ladder = canvas.slice(0, canvas.indexOf(doorOnly![0]));
  assert.ok(ladder.includes("f.ringWedges >= f.wedges") && ladder.lastIndexOf("f.wedges && f.ringWedges)") > ladder.lastIndexOf("f.ringWedges >= f.wedges"),
    "both ring branches must sit ABOVE the bare door-swing branch, or they are unreachable");
});
