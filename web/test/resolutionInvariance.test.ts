// Resolution invariance (RFC failure mode #3): feet-true thresholds and the
// minimum-passage rule keep One-Click verdicts a property of the DRAWING, not
// of the working raster's resolution. Every case here builds one image-space
// scene and probes it at two mask resolutions via buildMask's maxDim knob.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMask, floodRegion, floodRegionSealed, dilateHardMask, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, MIN_PASS_FT, DETERMINISM_MIN_MPPF, MASK_MAX_DIM,
  traceRegion, ringArea, type FloodResult,
} from "../src/lib/oneclick.ts";
import { traceConfidence, floodSignals, CONF_COARSE } from "../src/lib/confidence.ts";

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

// ── A1: the working raster is a property of the SHEET, not of the render ─────
// Audit finding A1: MASK_MAX_DIM is a CAP, not a pin. Below it the mask followed
// the render scale, so the per-sheet "Hi-Res render" toggle changed measured
// square footage on the same click (11×17 at 1/8": 97.8 SF vs 134.0 SF, +37%).
// Above the cap the resolution was pinned but Math.round(seg*ws) still quantized
// in RENDER px, so cap-bound sheets shifted too. buildMask now takes the baseline
// px/ft and maps into the baseline render before choosing the raster and before
// quantizing. Reverting either half fails these.
const A1_PT_PER_FT = 9, A1_BASE_RS = 2;              // 11×17 at 1/8" = 1'-0"
function a1Scene(rs: number) {
  const k = rs / A1_BASE_RS, segs: number[] = [];
  const L = (a: number, b: number, c: number, d: number) => segs.push(a * k * 2, b * k * 2, c * k * 2, d * k * 2);
  L(100, 100, 400, 100); L(400, 100, 400, 180); L(400, 196, 400, 340);   // right wall with a slit
  L(400, 340, 100, 340); L(100, 340, 100, 100);
  L(150, 150, 380, 150); L(150, 200, 380, 200);                          // interior linework
  return { segs, w: 900 * k * 2, h: 700 * k * 2, pxPerFt: A1_PT_PER_FT * rs, base: A1_PT_PER_FT * A1_BASE_RS };
}

test("A1: mask is bit-identical across render scales (Hi-Res cannot change a measurement)", () => {
  const base = a1Scene(A1_BASE_RS);
  const mb = buildMask(base.segs, base.w, base.h, MASK_MAX_DIM, null, base.pxPerFt, base.base);
  // 2.07 is the VA sheet's autoRenderScale; 5.374 is the audit's worked Hi-Res example.
  for (const rs of [2.07, 3, 5.374]) {
    const s = a1Scene(rs);
    const m = buildMask(s.segs, s.w, s.h, MASK_MAX_DIM, null, s.pxPerFt, s.base);
    assert.equal(m.mppf, mb.mppf, `mppf drifted at rs ${rs}: ${m.mppf} vs ${mb.mppf}`);
    assert.equal(m.mw, mb.mw, `mask width drifted at rs ${rs}`);
    assert.equal(m.mh, mb.mh, `mask height drifted at rs ${rs}`);
    let diff = 0;
    for (let i = 0; i < mb.mask.length; i++) if (mb.mask[i] !== m.mask[i]) diff++;
    assert.equal(diff, 0, `${diff} mask cells differ at rs ${rs} — the raster still follows the render scale`);
  }
});

test("A1: measured area is identical across render scales", () => {
  const areas = [A1_BASE_RS, 2.07, 5.374].map((rs) => {
    const s = a1Scene(rs);
    const mo = buildMask(s.segs, s.w, s.h, MASK_MAX_DIM, null, s.pxPerFt, s.base);
    const mppf = mo.mppf ?? 0;
    const f = floodRegionSealed(mo, 250 * (rs / A1_BASE_RS) * 2, 220 * (rs / A1_BASE_RS) * 2, 0.5,
      sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    assert.equal(f.status, "ok");
    return ringArea(traceRegion(f)) / (s.pxPerFt * s.pxPerFt);
  });
  for (const a of areas) assert.ok(Math.abs(a - areas[0]) < 0.01, `SF drifted across render scales: ${areas.map((x) => x.toFixed(2)).join(" / ")}`);
});

test("A1: omitting basePxPerFt keeps the old behaviour exactly (no-op for existing callers)", () => {
  const s = a1Scene(A1_BASE_RS);
  const withBase = buildMask(s.segs, s.w, s.h, MASK_MAX_DIM, null, s.pxPerFt, s.base);
  const without = buildMask(s.segs, s.w, s.h, MASK_MAX_DIM, null, s.pxPerFt);
  assert.equal(without.ws, withBase.ws);
  assert.equal(without.mppf, withBase.mppf);
  assert.deepEqual(Array.from(without.mask), Array.from(withBase.mask));
});

// ── audit A3: the minimum-passage path is a DILATION path, and it must take
// the seal ladder's own two gates and report its own provenance. ────────────
// Before this, `minPassPx > 0` — true on every scaled sheet — returned from
// sealAttempt BEFORE the room-size cap and BEFORE the ≥75%-real-boundary rule,
// and without setting any provenance at all. So the project's advertised
// "guarded by a room-size cap and a >=75%-real-boundary rule" was vacuous on
// the PRIMARY path, and traceConfidence scored the result a verbatim 1.00.

test("A3: the min-passage rule reports how much of the verbatim flood it removed", () => {
  const { segs, seedA } = slitScene(0.3 * PXFT);
  for (const maxDim of [800, 400]) {
    const mo = buildMask(segs, 800, 500, maxDim, null, PXFT);
    const mppf = mo.mppf ?? 0;
    const f = floodRegionSealed(mo, seedA[0], seedA[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf)) as Extract<FloodResult, { status: "ok" }>;
    assert.equal(f.status, "ok");
    assert.equal(f.minPassPx, minPassRadiusFor(mppf), "the radius that ran is on the record");
    // chamber B is 36% of room A's area, so the rule removes ~26% of the
    // verbatim flood's region — the same 35.8% change of the MEASUREMENT the
    // audit reported, expressed against the flood it replaced
    assert.ok(Math.abs((f.minPassDelta ?? 0) - 0.263) < 0.01, `expected ~26.3% removed, got ${f.minPassDelta}`);
    const c = traceConfidence(floodSignals(f, { areaSF: f.count / (mppf * mppf) }));
    assert.ok(c.score < 1, `a measurement the rule moved by a third cannot score 1.00 (got ${c.score})`);
    assert.match(c.factors.join(" "), /min-passage-rule/);
  }
});

test("A3: a rule that changed nothing costs nothing and says nothing", () => {
  const segs = [...sq(100, 100, 340, 340)];
  const mo = buildMask(segs, 800, 500, 800, null, PXFT);
  const mppf = mo.mppf ?? 0;
  const f = floodRegionSealed(mo, 220, 220, 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf)) as Extract<FloodResult, { status: "ok" }>;
  assert.equal(f.status, "ok");
  assert.ok(minPassRadiusFor(mppf) > 0, "the rule really is on for this sheet");
  assert.equal(f.minPassPx, undefined, "provenance for 'a rule ran and did not matter' is noise");
  assert.equal(f.minPassDelta, undefined);
  assert.equal(traceConfidence(floodSignals(f)).score, 1);
});

// Room A's ONLY opening is a sub-½ft slot: the verbatim linework does not
// enclose it at all, so the dilation is not trimming a connection — it is
// BRIDGING an opening, which is the seal ladder's job under another name.
function slottedRoom(slotPx: number) {
  const segs = [
    100, 100, 340, 100, 100, 340, 340, 340, 100, 100, 100, 340,
    340, 100, 340, 200, 340, 200 + slotPx, 340, 340,
  ];
  return { segs, seed: [220, 220] as [number, number] };
}

test("A3: a room bounded only by the min-passage rule reports itself as SEALED, not as verbatim", () => {
  const { segs, seed } = slottedRoom(0.4 * PXFT);
  const mo = buildMask(segs, 800, 500, 800, null, PXFT);
  const mppf = mo.mppf ?? 0;
  assert.equal(floodRegion(mo, seed[0], seed[1], 0.5).status, "leak", "without the rule this space is not enclosed");
  const f = floodRegionSealed(mo, seed[0], seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf)) as Extract<FloodResult, { status: "ok" }>;
  assert.equal(f.status, "ok");
  assert.equal(f.minPassDelta, 1, "the verbatim flood bounded nothing — the rule is the whole measurement");
  assert.equal(f.sealedPx, minPassRadiusFor(mppf), "so it reports a seal, and the readout says 'sealed'");
  assert.equal(typeof f.virtualFrac, "number", "with the ladder's own virtual-boundary fraction");
  const c = traceConfidence(floodSignals(f, { areaSF: f.count / (mppf * mppf) }));
  assert.ok(c.score <= 0.90, `an unenclosed space must not come back confidently bounded (got ${c.score})`);
  assert.match(c.factors.join(" "), /undecidable-passage/);
});

// D-1: the room-size cap and the ≥75%-real-boundary rule now apply to the
// min-passage path too. This scene is where that BITES: a rectangle drawn as a
// picket line of 4-px dashes 18 px apart. The min-passage dilation closes every
// gap, so the primary flood comes back a clean "ok" — and the region it returns
// has most of its boundary sitting in open space, which is exactly what the
// ≥75% rule exists to refuse. Before A3 this returned that region, unguarded,
// with no provenance, at confidence 1.00.
function picketRoom(gapPx: number, dashPx: number) {
  const segs: number[] = [];
  const dashes = (x0: number, y0: number, x1: number, y1: number) => {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / (dashPx + gapPx)));
    for (let k = 0; k < n; k++) {
      const t0 = (k * (dashPx + gapPx)) / L, t1 = Math.min(1, (k * (dashPx + gapPx) + dashPx) / L);
      segs.push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
    }
  };
  dashes(200, 200, 800, 200); dashes(800, 200, 800, 700); dashes(800, 700, 200, 700); dashes(200, 700, 200, 200);
  return segs;
}

test("A3/D-1: the min-passage path takes the ladder's ≥75%-real-boundary rule — a region it refuses is refused", () => {
  const PICKET_PXFT = 72;                       // ⇒ minPassRadiusFor = 18 px
  const segs = picketRoom(18, 4);
  const mo = buildMask(segs, 1400, 1000, 1400, null, PICKET_PXFT);
  const mppf = mo.mppf ?? 0;
  const r = minPassRadiusFor(mppf);
  assert.ok(r > 0);
  // the dilated flood itself succeeds — so it is the GUARD, not the flood,
  // that must refuse here. Without the guard this returns "ok".
  const dilated = floodRegion(dilateHardMask(mo, r), 500, 450, 0.5);
  assert.equal(dilated.status, "ok", "the min-passage flood is clean; only the guard stands between it and a bogus room");
  const f = floodRegionSealed(mo, 500, 450, 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), r);
  assert.notEqual(f.status, "ok", `a region >25% synthetic boundary must be refused, not measured (got ${f.status})`);
});

test("A3/D-1: the guard does not fire on ordinary rooms — the corpus refusal rate stays 0", () => {
  // the same construction with a SOLID boundary: the guard must be silent.
  const segs = picketRoom(0, 600);
  const mo = buildMask(segs, 1400, 1000, 1400, null, 72);
  const mppf = mo.mppf ?? 0;
  const f = floodRegionSealed(mo, 500, 450, 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(f.status, "ok");
});
