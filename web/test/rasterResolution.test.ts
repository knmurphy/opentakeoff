// A1 (audit), RASTER half — the scan path's working raster must be a property
// of the SHEET, not of the render scale, and its ceiling must be the SCAN's own
// resolution rather than whatever the app felt like rendering.
//
// The vector half landed first (buildMask's basePxPerFt; see
// resolutionInvariance.test.ts). The scan path still did its own pdf.js render
// at `rs * ws` with the OLD ws formula inlined in the canvas, so on scanned
// sheets the mask still followed the render scale — and could sit on a different
// grid than the same sheet's vector mask.
//
// What is and isn't tested here: rasterMaskScale / scanNativeScale / the mask
// build are pure and are exercised for real, with a simulated pdf.js render (a
// fixed-resolution "scan" bitmap resampled to whatever viewport the plan asks
// for) so the whole scan → mask → flood → trace → SF chain runs. What CANNOT run
// in node is TakeoffCanvas.jsx itself (React + pdf.js + DOM), so the two
// canvas-side edits — ensureRasterMask using the shared helper, and rescaleSheet
// evicting the raster caches — are guarded structurally against the source at the
// bottom of this file. A browser test of the real pdf.js render is still owed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rasterMaskScale, scanNativeScale, buildRasterMask, RASTER_MIN_SCAN_DPI, RASTER_RDP_EPS,
} from "../src/lib/rastermask.ts";
import {
  floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, ringArea,
} from "../src/lib/oneclick.ts";

// The audit's own sheet at quarter linear size, so the pixel work stays cheap:
// an 11×17 at 1/8" = 1'-0", baseline render ×2, working-raster cap scaled to
// match (MASK_MAX_DIM 3000 ÷ 4). Every ratio that decides the regime is
// preserved — the baseline render lands UNDER the cap (the buggy regime, where
// the old formula simply followed the render) and Hi-Res runs into it.
const PAGE_W = 306, PAGE_H = 198;         // pt
const BASE_RS = 2;                        // sheets.RENDER_SCALE
const HI_RS = 5.374;                      // autoRenderScale for an 11×17 under the panel budget
const CAP = 750;                          // MASK_MAX_DIM ÷ 4
const PT_PER_FT = 9;                      // 1/8" = 1'-0"
const SCAN_DPI = 100;
const SW = Math.round((PAGE_W * SCAN_DPI) / 72), SH = Math.round((PAGE_H * SCAN_DPI) / 72);
const dims = (rs: number) => [Math.ceil(PAGE_W * rs), Math.ceil(PAGE_H * rs)] as const;

/** the shipped call, for a sheet whose panel is rendered at `rs` */
const plan = (rs: number, scanPxPerPt = 0) => rasterMaskScale({
  pageW: PAGE_W, pageH: PAGE_H, renderScale: rs, baseScale: BASE_RS, maxDim: CAP, scanPxPerPt,
});

/** the formula ensureRasterMask used to carry inline — kept so the tests can show
 *  what the fix changed rather than only asserting the fixed behaviour */
const legacyPlan = (rs: number) => {
  const [imgW, imgH] = dims(rs);
  const ws = Math.min(1, CAP / Math.max(imgW, imgH, 1));
  return { vs: rs * ws, mw: Math.max(2, Math.ceil(imgW * ws)), mh: Math.max(2, Math.ceil(imgH * ws)), ws };
};

// ── 1.1d, the pure half: the plan is a function of the sheet ────────────────

test("A1 raster: the mask render is identical at every render scale", () => {
  const base = plan(BASE_RS);
  for (const rs of [BASE_RS, 2.07, 3, 4, HI_RS, 7.6]) {
    const p = plan(rs);
    assert.equal(p.vs, base.vs, `viewport scale drifted at rs ${rs}`);
    assert.equal(p.mw, base.mw, `mask width drifted at rs ${rs}`);
    assert.equal(p.mh, base.mh, `mask height drifted at rs ${rs}`);
    assert.equal(p.wsBase, base.wsBase, `baseline ws drifted at rs ${rs}`);
    // ws is the ONE render-dependent number, and only because it converts THIS
    // panel's px: ws × renderScale is mask px per POINT, so it is pinned too.
    assert.ok(Math.abs(p.ws * rs - base.ws * BASE_RS) < 1e-9, `mask px per point drifted at rs ${rs}`);
  }
});

test("A1 raster: the OLD inline formula is what drifted (the bug is real, not hypothetical)", () => {
  const base = legacyPlan(BASE_RS), hi = legacyPlan(HI_RS);
  assert.notEqual(hi.vs, base.vs);
  // 11×17 with Hi-Res on: the mask was rendered at 2.451 instead of 2.000 — a
  // 22.5% resolution swing decided by a per-user localStorage toggle. (Uncapped
  // sheets were worse still: there the mask render WAS the panel render.)
  assert.ok(Math.abs(hi.vs - 2.4509) < 1e-3, `legacy hi-res vs ${hi.vs}`);
  assert.ok(Math.abs(base.vs - BASE_RS) < 1e-9);
});

test("A1 raster: at the default render the plan is bit-identical to the old formula", () => {
  // the fix moves the Hi-Res render onto the default's numbers; it must not move
  // the default itself, on either side of the cap.
  for (const [pw, ph, cap] of [[PAGE_W, PAGE_H, CAP], [2000, 1300, CAP], [1, 1, CAP]] as const) {
    const imgW = Math.ceil(pw * BASE_RS), imgH = Math.ceil(ph * BASE_RS);
    const p = rasterMaskScale({ pageW: pw, pageH: ph, renderScale: BASE_RS, baseScale: BASE_RS, maxDim: cap });
    const ws = Math.min(1, cap / Math.max(imgW, imgH, 1));
    assert.equal(p.mw, Math.max(2, Math.ceil(imgW * ws)));
    assert.equal(p.mh, Math.max(2, Math.ceil(imgH * ws)));
    assert.equal(p.ws, ws);
    assert.equal(p.vs, BASE_RS * ws);
    assert.equal(p.dpiLimited, false);
  }
});

test("A1 raster: degenerate inputs fall back, never to NaN", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const p = rasterMaskScale({ pageW: PAGE_W, pageH: PAGE_H, renderScale: bad, baseScale: bad, maxDim: CAP });
    assert.ok(Number.isFinite(p.vs) && p.vs > 0, `vs ${p.vs} with ${bad}`);
    assert.ok(Number.isFinite(p.ws) && p.ws > 0, `ws ${p.ws} with ${bad}`);
    assert.ok(p.mw >= 2 && p.mh >= 2);
  }
});

// ── the DPI ceiling: the honest limit the vector path doesn't have ──────────

test("DPI ceiling: the mask stops at the scan's own resolution", () => {
  const scanPxPerPt = SW / PAGE_W;                       // 100 DPI ⇒ 1.389 px/pt
  const p = plan(BASE_RS, scanPxPerPt);
  assert.equal(p.dpiLimited, true);
  assert.ok(Math.abs(p.scanDpi - SCAN_DPI) < 1, `scanDpi ${p.scanDpi}`);
  assert.ok(Math.abs(p.vs - scanPxPerPt) < 1e-9, "render at exactly the scan's resolution");
  assert.equal(p.mw, SW, "the mask is the scan's own pixel count — no invented pixels");
  // …and the clamp is render-independent too
  const hi = plan(HI_RS, scanPxPerPt);
  assert.equal(hi.mw, p.mw); assert.equal(hi.vs, p.vs);
  // it is a real saving, not a rounding: the unclamped mask is 2.1× the pixels
  const free = plan(BASE_RS);
  assert.ok((free.mw * free.mh) / (p.mw * p.mh) > 2, "the clamp should be worth having");
});

test("DPI ceiling: a scan finer than the render is not clamped, and never upscales the mask", () => {
  const plenty = plan(BASE_RS, 600 / 72);                // a 600 DPI scan
  assert.equal(plenty.dpiLimited, false);
  assert.equal(plenty.mw, plan(BASE_RS).mw, "a fine scan buys no extra mask — the cap still rules");
  assert.equal(plenty.vs, BASE_RS);
});

test("DPI ceiling: an unbelievable measurement is floored, not obeyed", () => {
  // a title-block logo mis-measured as "the scan" would otherwise shrink the
  // working raster to nothing — the floor hands the decision back to the cap.
  const p = plan(BASE_RS, 0.02);                         // "1.4 DPI"
  const effectiveDpi = (p.mw / PAGE_W) * 72;
  assert.ok(effectiveDpi >= RASTER_MIN_SCAN_DPI - 1, `mask collapsed to ${effectiveDpi.toFixed(1)} DPI`);
  assert.equal(plan(BASE_RS, 0).dpiLimited, false, "unknown ⇒ no clamp at all");
  assert.equal(plan(BASE_RS, NaN).dpiLimited, false);
  assert.equal(plan(BASE_RS, -5).dpiLimited, false);
});

test("buildRasterMask carries the DPI verdict onto the mask (provenance, not a silent clamp)", () => {
  const rgba = new Uint8Array(20 * 20 * 4).fill(255);
  const plain = buildRasterMask(rgba, 20, 20, 1);
  assert.equal(plain.dpiLimited, undefined);
  assert.equal(plain.scanDpi, undefined);
  const flagged = buildRasterMask(rgba, 20, 20, 1, { dpiLimited: true, scanDpi: 150 });
  assert.equal(flagged.dpiLimited, true);
  assert.equal(flagged.scanDpi, 150);
});

// ── scanNativeScale: measuring the scan off the op list ─────────────────────

const OPS = {
  save: 10, restore: 11, transform: 12,
  paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83,
} as const;
const VP1 = [1, 0, 0, -1, 0, PAGE_H];      // pdf.js's scale-1 viewport transform
/** place a w×h-native-px image over a pw×ph pt rect at (x, y) */
const place = (fn: number, w: number, h: number, x: number, y: number, pw: number, ph: number) => ({
  fnArray: [OPS.save, OPS.transform, fn, OPS.restore],
  argsArray: [null, [pw, 0, 0, ph, x, y],
    fn === OPS.paintImageXObject ? ["img_1", w, h] : [{ width: w, height: h }], null],
});

test("scanNativeScale: a full-sheet scan reports its own resolution", () => {
  for (const fn of [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]) {
    const nat = scanNativeScale(place(fn, SW, SH, 0, 0, PAGE_W, PAGE_H), VP1, OPS, PAGE_W, PAGE_H);
    assert.ok(Math.abs(nat.pxPerPt * 72 - SCAN_DPI) < 1, `op ${fn}: ${nat.pxPerPt * 72} DPI`);
    assert.ok(nat.areaFrac > 0.99, `op ${fn}: areaFrac ${nat.areaFrac}`);
  }
});

test("scanNativeScale: the plan scan wins over the title-block logo", () => {
  const scan = place(OPS.paintImageXObject, SW, SH, 0, 0, PAGE_W, PAGE_H);
  const logo = place(OPS.paintImageXObject, 1200, 1200, 10, 10, 24, 24);   // 3600 DPI-equivalent
  // both orders — a title-block stamp is as often painted after the plan as before
  for (const [a, b] of [[logo, scan], [scan, logo]]) {
    const both = { fnArray: [...a.fnArray, ...b.fnArray], argsArray: [...a.argsArray, ...b.argsArray] };
    const nat = scanNativeScale(both, VP1, OPS, PAGE_W, PAGE_H);
    assert.ok(Math.abs(nat.pxPerPt * 72 - SCAN_DPI) < 1, `the logo won: ${nat.pxPerPt * 72} DPI`);
    assert.ok(nat.areaFrac > 0.99, `areaFrac ${nat.areaFrac} — the logo's area was reported`);
  }
});

test("scanNativeScale: a form-XObject's matrix rides along; nothing measurable reads 0", () => {
  // the scan placed at half size inside a form scaled ×2 — the same net placement
  const inner = place(OPS.paintImageXObject, SW, SH, 0, 0, PAGE_W / 2, PAGE_H / 2);
  const wrapped = {
    fnArray: [OPS.paintFormXObjectBegin, ...inner.fnArray, OPS.paintFormXObjectEnd],
    argsArray: [[[2, 0, 0, 2, 0, 0]], ...inner.argsArray, null],
  };
  const nat = scanNativeScale(wrapped, VP1, OPS, PAGE_W, PAGE_H);
  assert.ok(Math.abs(nat.pxPerPt * 72 - SCAN_DPI) < 1, `${nat.pxPerPt * 72} DPI through a form XObject`);
  const empty = scanNativeScale({ fnArray: [], argsArray: [] }, VP1, OPS, PAGE_W, PAGE_H);
  assert.equal(empty.pxPerPt, 0, "unmeasurable must read 0 (⇒ no clamp), never a guess");
});

// ── 1.1d end to end: scan pixels → mask → flood → traced SF ─────────────────

/** the scan: a page-sized 8-bit bitmap at SCAN_DPI, ink laid out in POINTS */
function makeScan(): Uint8Array {
  const g = new Uint8Array(SW * SH).fill(255);
  const px = SCAN_DPI / 72;
  const line = (x0: number, y0: number, x1: number, y1: number, wpt: number, v = 40) => {
    const w = Math.max(1, Math.round(wpt * px));
    const ax = Math.round(x0 * px), ay = Math.round(y0 * px), bx = Math.round(x1 * px), by = Math.round(y1 * px);
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n);
      for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < SW && yy < SH) g[yy * SW + xx] = v;
      }
    }
  };
  const x0 = 40, y0 = 30, x1 = x0 + 14 * PT_PER_FT, y1 = y0 + 9 * PT_PER_FT;   // a 14 × 9 ft room
  line(x0, y0, x1, y0, 1.2); line(x1, y0, x1, y1, 1.2); line(x1, y1, x0, y1, 1.2); line(x0, y1, x0, y0, 1.2);
  line(x1, y0, x1 + 70, y0, 1.2); line(x1 + 70, y0, x1 + 70, y1, 1.2); line(x1 + 70, y1, x1, y1, 1.2);
  for (let i = 0; i < 10; i++) line(200, 170, 280, 170 - i * 5, 0.5);          // title-block clutter
  return g;
}
const SCAN = makeScan();

/** stand-in for pdf.js rendering a scan wrapper: bilinear-resample the scan to
 *  mw×mh RGBA at viewport scale `vs` */
function renderPage(vs: number, mw: number, mh: number): Uint8Array {
  const out = new Uint8Array(mw * mh * 4).fill(255);
  const s = SCAN_DPI / 72;
  for (let y = 0; y < mh; y++) {
    const sy = ((y + 0.5) / vs) * s - 0.5;
    const ya = Math.max(0, Math.min(SH - 1, Math.floor(sy))), yb = Math.min(SH - 1, ya + 1);
    const fy = Math.max(0, Math.min(1, sy - ya));
    for (let x = 0; x < mw; x++) {
      const sx = ((x + 0.5) / vs) * s - 0.5;
      const xa = Math.max(0, Math.min(SW - 1, Math.floor(sx))), xb = Math.min(SW - 1, xa + 1);
      const fx = Math.max(0, Math.min(1, sx - xa));
      const v = Math.round(
        (SCAN[ya * SW + xa] * (1 - fx) + SCAN[ya * SW + xb] * fx) * (1 - fy) +
        (SCAN[yb * SW + xa] * (1 - fx) + SCAN[yb * SW + xb] * fx) * fy);
      const i = (y * mw + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
    }
  }
  return out;
}

/** the shipped raster path for one render scale: render → mask → sealed flood at
 *  the same POINT on the drawing → traced ring → square feet */
function measure(p: { vs: number; mw: number; mh: number; ws: number }, rs: number) {
  const mo = buildRasterMask(renderPage(p.vs, p.mw, p.mh), p.mw, p.mh, p.ws);
  const upp = 1 / (PT_PER_FT * rs);                       // feet per panel px at this render
  const mppf = mo.ws / upp;
  const f = floodRegionSealed(mo, 100 * rs, 70 * rs, undefined,
    sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(f.status, "ok", `flood failed at rs ${rs} (status ${f.status})`);
  return { mppf: +mppf.toFixed(6), sf: +(ringArea(traceRegion(f as never, RASTER_RDP_EPS)) * upp * upp).toFixed(2) };
}

test("A1 raster, end to end: the same click on the same scan measures the same SF at every render scale", () => {
  const base = measure(plan(BASE_RS), BASE_RS);
  assert.ok(base.sf > 100 && base.sf < 130, `scene sanity: a 14×9 ft room read ${base.sf} SF`);
  for (const rs of [2.07, 3, HI_RS]) {
    const m = measure(plan(rs), rs);
    assert.equal(m.mppf, base.mppf, `mask px per foot drifted at rs ${rs}: ${m.mppf} vs ${base.mppf}`);
    assert.equal(m.sf, base.sf, `measured SF drifted at rs ${rs}: ${m.sf} vs ${base.sf}`);
  }
});

test("A1 raster, end to end: the OLD formula did drift — this scene can tell the difference", () => {
  // Keeps the test above from going vacuous. The raster path's SF drift is far
  // smaller than the vector path's measured +37%: the mask always lands inside
  // the cap, and the feet-true seal / min-passage rules absorb the topology
  // differences. What swings hard is the mask RESOLUTION, and the SF follows it.
  const base = measure(legacyPlan(BASE_RS), BASE_RS);
  const hi = measure(legacyPlan(HI_RS), HI_RS);
  assert.notEqual(hi.mppf, base.mppf, "legacy mask resolution must follow the render — else the fix is untested");
  assert.ok(hi.mppf / base.mppf > 1.2, `legacy mppf ${base.mppf} → ${hi.mppf}`);
  assert.notEqual(hi.sf, base.sf, `legacy SF ${base.sf} → ${hi.sf}`);
});

test("A1 raster: the DPI-clamped mask is render-independent too, and still measures the room", () => {
  const scanPxPerPt = SW / PAGE_W;
  const base = measure(plan(BASE_RS, scanPxPerPt), BASE_RS);
  for (const rs of [3, HI_RS]) {
    const m = measure(plan(rs, scanPxPerPt), rs);
    assert.equal(m.mppf, base.mppf, `clamped mppf drifted at rs ${rs}`);
    assert.equal(m.sf, base.sf, `clamped SF drifted at rs ${rs}`);
  }
  // and clamping costs no more than the scan's own blur
  const unclamped = measure(plan(BASE_RS), BASE_RS);
  assert.ok(Math.abs(base.sf - unclamped.sf) / unclamped.sf < 0.01,
    `clamping moved the answer ${unclamped.sf} → ${base.sf}`);
});

// ── the canvas-side edits, guarded against the source ───────────────────────
// TakeoffCanvas.jsx cannot be imported here (React + pdf.js + DOM), and these two
// edits are exactly the kind that rot silently. Structural assertions are the
// guard available in this harness; each is written so that reverting its edit
// fails it. They are a stand-in for a browser test, not a substitute.
const CANVAS = readFileSync(new URL("../src/pages/TakeoffCanvas.jsx", import.meta.url), "utf8");
const between = (from: string, to: string) => {
  const a = CANVAS.indexOf(from);
  assert.ok(a >= 0, `TakeoffCanvas.jsx no longer contains "${from}"`);
  const b = CANVAS.indexOf(to, a);
  assert.ok(b > a, `TakeoffCanvas.jsx no longer contains "${to}" after "${from}"`);
  return CANVAS.slice(a, b);
};

test("1.1d: ensureRasterMask derives its render from the shared helper, not an inline formula", () => {
  const body = between("function ensureRasterMask(", "// The propose tail");
  assert.match(body, /rasterMaskScale\(\{/, "the raster mask must be planned by rasterMaskScale");
  assert.match(body, /baseScale: RENDER_SCALE/, "…pinned to the BASELINE render scale");
  assert.match(body, /maxDim: MASK_MAX_DIM/, "…under the working-raster cap");
  assert.match(body, /scale: plan\.vs/, "…and rendered at the scale the plan chose");
  assert.doesNotMatch(body, /MASK_MAX_DIM \/ Math\.max/, "the old inline ws formula is back");
  assert.doesNotMatch(body, /scale: rs \*/, "the panel's render scale is back in the mask viewport");
});

test("1.1g: rescaleSheet evicts every per-sheet mask cache the render effect clears", () => {
  // The general invariant, not just this instance: a cache the render effect
  // drops on a sheet change is scale-bearing, so a recalibration must drop it
  // too. A fourth mask cache added to the render effect fails this test until
  // rescaleSheet is taught about it.
  const names = [...new Set([...CANVAS.matchAll(/(\w*[Mm]ask\w*Ref)\.current\.clear\(\)/g)].map((m) => m[1]))];
  for (const want of ["maskCacheRef", "rasterMaskCacheRef", "rasterMaskReadyRef"]) {
    assert.ok(names.includes(want), `expected ${want} among the render effect's mask caches, found ${names.join(", ")}`);
  }
  const body = between("function rescaleSheet(", "function revertScale(");
  for (const n of names) {
    assert.ok(body.includes(`${n}.current.delete(key)`),
      `rescaleSheet does not evict ${n} — a recalibrated sheet would keep a mask built at the old scale`);
  }
});
