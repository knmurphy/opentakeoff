// Resolution invariance (RFC failure mode #3): feet-true thresholds and the
// minimum-passage rule keep One-Click verdicts a property of the DRAWING, not
// of the working raster's resolution. Every case here builds one image-space
// scene and probes it at two mask resolutions via buildMask's maxDim knob.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, MIN_PASS_FT, DETERMINISM_MIN_MPPF, MASK_MAX_DIM,
} from "../src/lib/oneclick.ts";
import { traceConfidence, CONF_COARSE } from "../src/lib/confidence.ts";

const sq = (x0: number, y0: number, x1: number, y1: number): number[] => [
  x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0,
];

test("minPassRadiusFor: off without a scale, feet-consistent with one", () => {
  assert.equal(minPassRadiusFor(0), 0);
  assert.equal(minPassRadiusFor(NaN), 0);
  assert.equal(minPassRadiusFor(-3), 0);
  for (const mppf of [6, 8, 9, 12, 18, 24, 36]) {
    const r = minPassRadiusFor(mppf);
    const closedFt = (2 * r) / mppf;                  // widest passage the rule closes
    // round-to-nearest radius ⇒ the effective threshold sits within ONE cell
    // of MIN_PASS_FT on either side (the tightest band a 2r dilation allows;
    // a floor bias closed a 0.42 ft slit at one resolution and not another)
    assert.ok(Math.abs(closedFt - MIN_PASS_FT) <= 1 / mppf + 1e-9, `mppf ${mppf}: closes ${closedFt} ft — more than a cell off ${MIN_PASS_FT}`);
  }
});

// Room A (10×10 ft) and chamber B (6×6 ft) share a wall with a 0.3 ft slit —
// annotation-tip scale, nothing flooring runs through. With the rule, a click
// in A must measure A alone at EVERY resolution; without it, the slit
// percolates and B rides along. PXFT = 24 keeps the half-res mask (12 px/ft)
// above the determinism floor.
const PXFT = 24;
function slitScene(slitPx: number) {
  const A = { x0: 100, y0: 100, x1: 340, y1: 340 };            // 10×10 ft
  const B = { x0: 340, y0: 100, x1: 484, y1: 244 };            // 6×6 ft
  const gapTop = 160, gapBot = 160 + slitPx;
  const segs = [
    // A's walls, right wall broken by the slit
    A.x0, A.y0, A.x1, A.y0, A.x0, A.y1, A.x1, A.y1, A.x0, A.y0, A.x0, A.y1,
    A.x1, A.y0, A.x1, gapTop, A.x1, gapBot, A.x1, A.y1,
    // B closes off the shared wall's far side
    B.x0, B.y0, B.x1, B.y0, B.x1, B.y0, B.x1, B.y1, B.x1, B.y1, B.x0, B.y1,
  ];
  return { segs, seedA: [220, 220] as [number, number] };
}

test("min-passage: a 0.3 ft slit never connects, at any resolution", () => {
  const { segs, seedA } = slitScene(0.3 * PXFT);
  for (const maxDim of [800, 400]) {                            // ws 1 and 0.5 → 24 and 12 px/ft
    const mo = buildMask(segs, 800, 500, maxDim, null, PXFT);
    const mppf = (mo.mppf ?? 0);
    assert.ok(mppf >= DETERMINISM_MIN_MPPF, `test scene must sit above the floor (got ${mppf})`);
    const f = floodRegionSealed(mo, seedA[0], seedA[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    assert.equal(f.status, "ok");
    const sf = (f as { count: number }).count / (mppf * mppf);
    assert.ok(Math.abs(sf - 100) < 8, `ws ${mo.ws}: expected ~100 SF (A alone), got ${sf.toFixed(1)}`);
  }
});

test("min-passage off (no rule): the slit percolates and B rides along — the rule is what does the work", () => {
  const { segs, seedA } = slitScene(0.3 * PXFT);
  const mo = buildMask(segs, 800, 500, 800, null, PXFT);      // canvas big enough that A+B clears the 30% leak cap
  const mppf = mo.mppf ?? 0;
  const f = floodRegionSealed(mo, seedA[0], seedA[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), 0);
  assert.equal(f.status, "ok");
  const sf = (f as { count: number }).count / (mppf * mppf);
  assert.ok(sf > 120, `expected A+B (~136 SF) without the rule, got ${sf.toFixed(1)}`);
});

test("min-passage: a real 3 ft opening still connects, at any resolution", () => {
  const { segs, seedA } = slitScene(3 * PXFT);                  // same scene, door-width break
  for (const maxDim of [800, 400]) {
    const mo = buildMask(segs, 800, 500, maxDim, null, PXFT);
    const mppf = mo.mppf ?? 0;
    const f = floodRegionSealed(mo, seedA[0], seedA[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    assert.equal(f.status, "ok");
    const sf = (f as { count: number }).count / (mppf * mppf);
    assert.ok(sf > 120, `ws ${mo.ws}: expected A+B through the 3 ft opening, got ${sf.toFixed(1)} SF`);
  }
});

test("hatch pitch cap is feet-true: a 1.6 ft rhythm stays hard at every resolution, a 1.0 ft one stays soft", () => {
  // 14 vertical hairlines, tangentially stacked — a classic family shape.
  const family = (pitchPx: number): { segs: number[]; meta: Uint8Array } => {
    const segs: number[] = [];
    for (let k = 0; k < 14; k++) segs.push(200 + k * pitchPx, 100, 200 + k * pitchPx, 500);
    return { segs, meta: new Uint8Array(segs.length >> 2) };
  };
  for (const maxDim of [900, 450]) {                            // ws 1 and 0.5
    const wide = family(1.6 * PXFT);
    const wideMask = buildMask(wide.segs, 900, 600, maxDim, wide.meta, PXFT);
    assert.equal(wideMask.softCount, 0, `ws ${wideMask.ws}: a 1.6 ft rhythm is walls, not hatch`);
    const tight = family(1.0 * PXFT);
    const tightMask = buildMask(tight.segs, 900, 600, maxDim, tight.meta, PXFT);
    assert.ok(tightMask.softCount >= 10, `ws ${tightMask.ws}: a 1 ft hatch family must classify soft (got ${tightMask.softCount})`);
  }
});

test("scale-blind masks keep the legacy px behavior bit-for-bit at the 18 px/ft calibration", () => {
  const segs = [...sq(2, 2, 598, 398), ...sq(100, 100, 316, 280)];
  const meta = new Uint8Array(segs.length >> 2);
  const blind = buildMask(segs, 600, 400, 600, meta);
  const scaled = buildMask(segs, 600, 400, 600, meta, 18);      // ws 1 → mppf 18 = the calibration point
  const fb = floodRegion(blind, 200, 190, 0.5);
  const fs = floodRegion(scaled, 200, 190, 0.5);
  assert.equal(fb.status, "ok");
  assert.equal(fs.status, "ok");
  assert.equal((fb as { count: number }).count, (fs as { count: number }).count);
});

test("confidence: a mask below the determinism floor is called out", () => {
  const coarse = traceConfidence({ mppf: DETERMINISM_MIN_MPPF - 1 });
  assert.equal(coarse.score, CONF_COARSE);
  assert.deepEqual(coarse.factors, ["coarse-mask"]);
  assert.deepEqual(traceConfidence({ mppf: DETERMINISM_MIN_MPPF }).factors, []);
  assert.deepEqual(traceConfidence({}).factors, [], "unknown scale is not penalized");
});

test("MASK_MAX_DIM export still caps ws at 1", () => {
  const mo = buildMask(sq(2, 2, 98, 98), 100, 100, MASK_MAX_DIM, null, 12);
  assert.equal(mo.ws, 1);
  assert.equal(mo.mppf, 12);
});
