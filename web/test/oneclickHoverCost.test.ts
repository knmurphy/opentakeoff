// A8 — the One-Click HOVER path's cost, pinned.
//
// floodRegionSealed runs once per animation frame while the cursor is over a
// new region, so its wall clock is a UI budget, not a batch one. It used to
// blow that budget spectacularly on the one shape that matters most — a room
// with several drawn door swings — because the door-wedge retry rebuilt the
// whole raster once per arc CLUSTER: a full mask copy, a full distance
// transform, a full-raster search for the room's deepest cell, and a seal
// ladder whose leaking rungs each filled 30% of the sheet before admitting
// they had leaked. Measured on the fixture below (3000 × 3000 mask, 30 ft
// room, six drawn doors, wedges = 6):
//
//     cold 3722 ms → 553 ms   warm 3475 ms → 351 ms   churn 585 MB → 81 MB
//
// THE FIXTURE IS THE TEST. A guard on this engine is worthless at the wrong
// SHAPE: the blowup is per-arc-cluster on a large raster, so a small mask, or
// a large mask with one door, stays cheap under the naive code and the guard
// passes against the very thing it exists to catch (this project has shipped
// exactly that mistake). Both numbers below were checked to FAIL against the
// pre-fix engine — 27.5 raster units and 65 rasters of churn — with the
// budgets set roughly halfway in between on a log scale.
//
// The time budget is denominated in RASTER UNITS, not milliseconds: one
// dilateHardMask call over the same mask (a distance transform plus one
// full-raster pass), measured in-process, so the guard means "a hovered room
// may cost a handful of sweeps of its own raster" on any machine, at any CI
// load. The churn budget is denominated in RASTERS and is fully deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMask, floodRegionSealed, traceRegion, ringArea, dilateHardMask,
  sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, SENS_BALANCED, SEG_CURVE,
  type MaskObj,
} from "../src/lib/oneclick.ts";

const PXFT = 18;                 // 1/4" = 1'-0" at render scale 1 — the corpus convention
const IMG = 3000;                // == MASK_MAX_DIM, so ws = 1 and the mask is the production cap
const SIDE = 540;                // 30 ft room
const DW = 3 * PXFT;             // 3'-0" opening
const R = 3 * PXFT;              // 3 ft leaf

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

/** A 3000 × 3000 sheet holding ONE 30 ft room ringed by `doors` drawn door
 *  swings. Each swing's arc closes its own 3'-0" opening, so the room floods
 *  bounded; opening one arc for the wedge retry lets the fill out onto open
 *  paper (it leaks at the raster edge) until the seal ladder closes the
 *  doorway at the wall plane and the wedge is annexed. That is the shape the
 *  engine is slowest on and the one every hovered room on a real plan has. */
function doorScene(doors: number): { mo: MaskObj; seed: [number, number] } {
  const segs: number[] = [], meta: number[] = [];
  const push = (s: number[], curve = false) => {
    for (let i = 0; i + 3 < s.length; i += 4) { segs.push(s[i], s[i + 1], s[i + 2], s[i + 3]); meta.push(curve ? SEG_CURVE : 0); }
  };
  const line = (a: number, b: number, c: number, d: number) => push([a, b, c, d]);
  const X0 = 1500 - SIDE / 2, Y0 = X0, X1 = 1500 + SIDE / 2, Y1 = X1;
  const spots: Array<[number, number]> = [
    [0, 0.25], [0, 0.70], [1, 0.30], [1, 0.75], [2, 0.35], [2, 0.80], [3, 0.40], [3, 0.85],
  ];
  const use = spots.slice(0, doors);
  for (let w = 0; w < 4; w++) {
    const L = SIDE;
    const cuts = use.filter((s) => s[0] === w).map((s) => [s[1] * L - DW / 2, s[1] * L + DW / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
    let at = 0;
    const runs: Array<[number, number]> = [];
    for (const [a, b] of cuts) { runs.push([at, a]); at = b; }
    runs.push([at, L]);
    for (const [a, b] of runs) {              // wall runs between the openings
      if (b <= a) continue;
      if (w === 0) line(X0 + a, Y0, X0 + b, Y0);
      else if (w === 1) line(X1, Y0 + a, X1, Y0 + b);
      else if (w === 2) line(X0 + a, Y1, X0 + b, Y1);
      else line(X0, Y0 + a, X0, Y0 + b);
    }
    for (const [a] of cuts) {                 // leaf + quarter-circle swing, hinged at a jamb
      if (w === 0) { push(arcChords(X0 + a, Y0, R, 0, Math.PI / 2, 12), true); line(X0 + a, Y0, X0 + a, Y0 + R); }
      else if (w === 1) { push(arcChords(X1, Y0 + a, R, Math.PI / 2, Math.PI, 12), true); line(X1, Y0 + a, X1 - R, Y0 + a); }
      else if (w === 2) { push(arcChords(X0 + a, Y1, R, 0, -Math.PI / 2, 12), true); line(X0 + a, Y1, X0 + a, Y1 - R); }
      else { push(arcChords(X0, Y0 + a, R, Math.PI / 2, 0, 12), true); line(X0, Y0 + a, X0 + R, Y0 + a); }
    }
  }
  return { mo: buildMask(segs, IMG, IMG, IMG, Uint8Array.from(meta), PXFT, PXFT), seed: [1500, 1500] };
}

const hover = (mo: MaskObj, seed: [number, number]) => {
  const mppf = mo.mppf || 0;
  return floodRegionSealed(mo, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
};

// ── the measurement, verbatim ──────────────────────────────────────────────
// Every field floodRegionSealed reports, plus a digest of the region bitmap
// and the traced ring, pinned from the pre-A8 engine. A8 was a pure
// performance change: not one of these may move for one.
// RE-PINNED 2026-08-04 (upstream sync) for #191, which offers a door's LEAF as
// its own opening alongside its arc — the only mark that separates an IN-SWING
// sector from the room it belongs to. Each drawn door in this scene carries
// both marks, so `wedges` doubles (1/3/6/8 -> 2/6/12/16) and `virtualFrac`
// rises with the extra synthesized boundary. EVERYTHING THE ESTIMATOR IS SOLD
// IS UNCHANGED, which is what this test is named for: `count`, `hardHits`, the
// region `digest`, `ringLen`, `ringArea` and `wedgeGrowth` are identical on
// every row, byte for byte. Only the two provenance counters moved, and they
// moved because there really are two openings now.
const PINNED = [
  { doors: 0, count: 290521, hardHits: 2116, softHits: 0, sealedPx: null, virtualFrac: null, wedges: null, wedgeGrowth: null, digest: "f9748100:290521", ringLen: 4, ringArea: 289444 },
  { doors: 1, count: 290575, hardHits: 2224, softHits: 0, sealedPx: 32, virtualFrac: 0.027, wedges: 2, wedgeGrowth: 1.008, digest: "909de76a:290575", ringLen: 5, ringArea: 289713 },
  { doors: 3, count: 290683, hardHits: 2440, softHits: 0, sealedPx: 32, virtualFrac: 0.025, wedges: 6, wedgeGrowth: 1.025, digest: "50f3e7d0:290683", ringLen: 5, ringArea: 289713 },
  { doors: 6, count: 290845, hardHits: 2764, softHits: 0, sealedPx: 32, virtualFrac: 0.023, wedges: 12, wedgeGrowth: 1.052, digest: "5b116ac0:290845", ringLen: 5, ringArea: 289713 },
  { doors: 8, count: 290953, hardHits: 2980, softHits: 0, sealedPx: 32, virtualFrac: 0.022, wedges: 16, wedgeGrowth: 1.07, digest: "5b9f8dc0:290953", ringLen: 5, ringArea: 289713 },
];

function digest(a: Uint8Array): string {
  let h = 0x811c9dc5, pop = 0;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v) pop++; h ^= v; h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(16)}:${pop}`;
}

test("multi-door hover: the reported measurement is unchanged", () => {
  for (const p of PINNED) {
    const { mo, seed } = doorScene(p.doors);
    const f = hover(mo, seed);
    assert.equal(f.status, "ok", `doors=${p.doors}`);
    if (f.status !== "ok") return;
    const ring = traceRegion(f);
    assert.deepEqual({
      count: f.count, hardHits: f.hardHits, softHits: f.softHits,
      sealedPx: f.sealedPx ?? null, virtualFrac: f.virtualFrac ?? null,
      wedges: f.wedges ?? null, wedgeGrowth: f.wedgeGrowth ?? null,
      hatchFiltered: f.hatchFiltered ?? null, hatchTier: f.hatchTier ?? null,
      curveFrac: f.curveFrac ?? null, minPassPx: f.minPassPx ?? null, minPassDelta: f.minPassDelta ?? null,
      digest: digest(f.region), ringLen: ring.length, ringArea: +ringArea(ring).toFixed(4),
    }, {
      count: p.count, hardHits: p.hardHits, softHits: p.softHits,
      sealedPx: p.sealedPx, virtualFrac: p.virtualFrac,
      wedges: p.wedges, wedgeGrowth: p.wedgeGrowth,
      hatchFiltered: null, hatchTier: null, curveFrac: null, minPassPx: null, minPassDelta: null,
      digest: p.digest, ringLen: p.ringLen, ringArea: p.ringArea,
    }, `doors=${p.doors}`);
  }
});

// One sweep of THIS raster on THIS machine: a distance transform plus a
// full-raster threshold pass. Nothing in A8 touched dilateHardMask, so it is a
// stable ruler on both sides of the change (measured: 132 ms before, 130 ms
// after, same box).
function rasterUnitMs(mo: MaskObj): number {
  let best = Infinity;
  for (let i = 0; i < 2; i++) { const t = performance.now(); dilateHardMask(mo, 1); best = Math.min(best, performance.now() - t); }
  return best;
}

test("multi-door hover costs a handful of raster sweeps, not dozens", () => {
  const { mo, seed } = doorScene(6);
  hover(mo, seed);                                     // warm the seal cache, as a second hover would find it
  const unit = rasterUnitMs(mo);
  let warm = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const f = hover(mo, seed);
    if (f.status === "ok") traceRegion(f);
    warm = Math.min(warm, performance.now() - t);
  }
  const units = warm / unit;
  // pre-A8: 27.5 units (3475 ms against a 126 ms unit). post-A8: 2.7 units.
  assert.ok(units <= 8, `six-door hover cost ${units.toFixed(1)} raster units (${warm.toFixed(0)} ms / ${unit.toFixed(0)} ms), budget 8`);
});

// Full-raster churn of one call, in RASTERS — the same deterministic probe as
// the churn test below, factored out because the leak-path guards lean on it:
// dilateHard allocates exactly TWO full rasters per call, so "did the bridge
// rungs dilate" is an allocation count, immune to timing flake.
function churnRasters(raster: number, fn: () => void): number {
  const Real = globalThis.Uint8Array;
  let churn = 0;
  class Counted extends Real {
    constructor(...args: unknown[]) {
      super(...(args as [number]));
      if (this.byteLength >= raster >> 3) churn += this.byteLength;   // full-raster-scale buffers only
    }
  }
  (globalThis as { Uint8Array: unknown }).Uint8Array = Counted;
  try { fn(); } finally { (globalThis as { Uint8Array: unknown }).Uint8Array = Real; }
  return churn / raster;
}

test("multi-door hover allocates a handful of rasters, not dozens", () => {
  const { mo, seed } = doorScene(6);
  hover(mo, seed);                                     // caches + JIT warm
  const raster = mo.mw * mo.mh;
  const rasters = churnRasters(raster, () => hover(mo, seed));
  // pre-A8: 65 rasters (585 MB). post-A8: 9 rasters (81 MB). Deterministic.
  assert.ok(rasters <= 20, `six-door hover churned ${rasters.toFixed(1)} rasters (${(rasters * raster / 1e6).toFixed(0)} MB), budget 20`);
});

// ── the LEAK path, pinned (the #184-merge hover regression) ────────────────
// floodRegionSealed re-probes on every cursor step over un-enclosed paper —
// the single most common hover on a real sheet — and for one merge the
// bridging rung ran dilateHard (TWO full-raster copies per call, twice per
// leak) on every such step: 3.3 ms / 0 rasters became 71.9 ms / 4 rasters
// per hover on this fixture, ~4.5× the 16 ms frame budget. The suite was
// blind to it because every guard above pins the OK path. Two mechanisms fix
// it, and each gets its own deterministic churn pin:
//   • futility skip — a seal rung at Manhattan radius r that LEAKED with the
//     click cell clear of the dilated walls (and not soft) proves box
//     bridging at radius ≤ r/2 can only leak too (leakedDilationPx), so an
//     open-paper leak never dilates at all — even the FIRST hover of a fresh
//     mask;
//   • bridgeCache — when bridging must run (no futility evidence, e.g. the
//     cursor sits within a rung radius of linework), the dilated rasters are
//     memoized per (mask, radius), so only the first such hover pays them.

test("open-paper hover-leak: warm cost is a fraction of a raster sweep", () => {
  const { mo } = doorScene(0);
  hover(mo, [300, 300]);               // pays the mask's one-time distance transform
  const unit = rasterUnitMs(mo);
  let warm = Infinity;
  for (let k = 0; k < 8; k++) {
    const t = performance.now();
    const f = hover(mo, [300 + 30 * k, 300]);          // moving seeds, like a real hover
    assert.equal(f.status, "leak");
    warm = Math.min(warm, performance.now() - t);
  }
  const units = warm / unit;
  // pre-#184-merge: 0.02 units (2.5 ms / 130 ms). Regressed: 0.55 units.
  assert.ok(units <= 0.25, `open-paper hover-leak cost ${units.toFixed(2)} raster units (${warm.toFixed(1)} ms / ${unit.toFixed(0)} ms), budget 0.25`);
});

test("open-paper hover-leak never dilates: futility evidence skips the bridge rungs", () => {
  const { mo } = doorScene(0);         // FRESH mask: every per-mask cache empty
  const raster = mo.mw * mo.mh;
  // Cold — the very first hover: the seal ladder's own distance transform
  // (one raster) plus at most a region-pool miss. The two bridge rungs would
  // add four more; leakedDilationPx says they cannot succeed, so they never run.
  const cold = churnRasters(raster, () => assert.equal(hover(mo, [300, 300]).status, "leak"));
  assert.ok(cold <= 3, `cold open-paper hover-leak churned ${cold.toFixed(1)} rasters, budget 3 (bridge rungs dilated?)`);
  // Warm — every later cursor step: nothing full-raster at all.
  const warm = churnRasters(raster, () => assert.equal(hover(mo, [420, 420]).status, "leak"));
  assert.equal(warm, 0, `warm open-paper hover-leak churned ${warm.toFixed(1)} rasters, expected 0`);
});

test("near-linework hover-leak: bridge rasters are paid once, then cached", () => {
  const { mo } = doorScene(0);
  const raster = mo.mw * mo.mh;
  // 3 px outside the room's left wall: too close for futility evidence (the
  // click cell clears no rung's dilation radius), so the bridge rungs RUN —
  // and still leak, since the outside of one room is not an enclosure. The
  // cold hover must pay dilateHard's rasters (proving this fixture exercises
  // the bridge at all); the warm hover must find them in bridgeCache.
  const seed: [number, number] = [1500 - SIDE / 2 - 3, 1500];
  const cold = churnRasters(raster, () => assert.equal(hover(mo, seed).status, "leak"));
  assert.ok(cold >= 4, `cold near-wall hover-leak churned ${cold.toFixed(1)} rasters, expected >= 4 (bridge rungs no longer run — fixture is dead)`);
  const warm = churnRasters(raster, () => assert.equal(hover(mo, seed).status, "leak"));
  assert.equal(warm, 0, `warm near-wall hover-leak churned ${warm.toFixed(1)} rasters, expected 0 (bridgeCache miss)`);
});
