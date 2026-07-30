// A1c / F3 / F8 — the SAME question a1.mts asks, but asked the way the canvas
// now asks it: with buildMask's 8th argument, `page` (the sheet in POINTS).
//
// a1.mts is preserved unchanged and still calls buildMask with 7 arguments. That
// is deliberate and is itself a finding: the F3 fix is OPT-IN through `page`, so
// a1.mts's numbers are IDENTICAL on 94a5d46 and 7650f68 (verified). This file is
// the adaptation the pack's re-run needed.
//
// It reports, per corpus sheet, at rs 2.000 / 2.070 / 2.0704 / autoRenderScale:
//   (1) the mask GRID   — ws, mw, mh, mppf, and mask px per PDF POINT
//   (2) GRID identity   — cells differing from the rs-2.000 mask with meta=null,
//                         i.e. the pure geometry raster. This is what "byte-
//                         identical across render scales" means.
//   (3) RASTER PARITY   — rasterMaskScale()'s mw/mh for the same sheet, so the
//                         vector and scan masks can be shown to sit on ONE grid.
//   (4) F8 RESIDUAL     — the same three numbers again with PRODUCTION meta
//                         (extractVectorGeometry's own per-chord flags). meta is
//                         render-dependent (markPolylineArcs fits circles in
//                         IMAGE px), so mask CONTENTS still move even though the
//                         grid does not. Differing cells and per-seed SF drift
//                         here are the F8 baseline.
// On BEFORE the 8th argument does not exist and JS drops it, so this file runs
// there too and reproduces a1.mts's BEFORE numbers — the F8 residual columns are
// then not separable from the grid drift, which is stated in the pack.
import { createRequire } from "module";
import {
  extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor,
  doorWedgeCapPx, minPassRadiusFor, traceRegion, ringArea, MASK_MAX_DIM,
} from "../src/lib/oneclick.ts";

const RENDER_SCALE = 2.0;
const MAX_CANVAS_DIM = 16384, MAX_PANEL_AREA = 28e6, QUALITY_CEILING = 8.0;
function autoRenderScale(wPt: number, hPt: number): number {
  const byDim = Math.min(MAX_CANVAS_DIM / wPt, MAX_CANVAS_DIM / hPt);
  const byArea = Math.sqrt(MAX_PANEL_AREA / (wPt * hPt));
  const cap = Math.min(byDim, byArea);
  return Math.min(Math.max(RENDER_SCALE, Math.min(QUALITY_CEILING, cap)), cap);
}
const diffCells = (a: Uint8Array, b: Uint8Array) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

// rasterMaskScale lives only on AFTER; read it off the namespace so BEFORE runs.
let rasterMaskScale: any = null;
try { rasterMaskScale = (await import("../src/lib/rastermask.ts") as any).rasterMaskScale ?? null; } catch { /* absent on BEFORE */ }

const req = createRequire(import.meta.url);
const pdfjs: any = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

interface Cfg { name: string; pdf: string; ptPerFtAt2: number; extraRs: number[]; seedsAt2: Array<[string, number, number]>; }
const CASES: Cfg[] = [
  {
    name: "sample-plan", pdf: "../demo/sample-plan.pdf", ptPerFtAt2: 36, extraRs: [2.07, 2.0704],
    seedsAt2: [["break-103", 432, 216], ["corridor-104", 1296, 216], ["office-101", 432, 864], ["office-102", 1296, 864]],
  },
  {
    name: "va-finish-plan", pdf: "../demo/sample-finish-plan.pdf", ptPerFtAt2: 18, extraRs: [2.07, 2.0704],
    seedsAt2: [["patient-room-137", 2592, 756], ["patient-room-137-band", 2550, 900], ["patient-toilet-137a", 2668, 1112],
      ["elevator-e01", 2538, 1566], ["ward-room", 4050, 486], ["ward-vestibule", 4045, 1230],
      ["cloud-corridor", 1814, 1814], ["shaded-wing-office", 659, 1551]],
  },
];

async function renderAt(pdf: string, rs: number) {
  const doc = await pdfjs.getDocument({ url: pdf, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: rs });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  return { g, w: Math.ceil(vp.width), h: Math.ceil(vp.height), pageW: vp.width / rs, pageH: vp.height / rs };
}

// Does this state HONOUR the 8th argument? Asked behaviourally, not by
// Function.length (default parameters are excluded from it, so buildMask.length
// is 3 on both states). The page dims are deliberately non-integral so the
// render's own ceil() is what separates the two paths — with integral dims the
// legacy px/ft reconstruction is exact and the two agree, which is the very
// reason F3 went undetected. 1224.5x792.3 pt at baseScale 2, rendered at rs 3:
// baseline-from-points = ceil(1224.5*2) = 2449; baseline reconstructed from the
// render = ceil(3674 * 2/3) = 2450.
function honoursPage(): boolean {
  const segs = [0, 0, 100, 100];
  const pg = { pageW: 1224.5, pageH: 792.3, renderScale: 3, baseScale: 2 };
  const iw = Math.ceil(1224.5 * 3), ih = Math.ceil(792.3 * 3);
  const withPg = (buildMask as any)(segs, iw, ih, MASK_MAX_DIM, null, 54, 36, pg);
  const without = (buildMask as any)(segs, iw, ih, MASK_MAX_DIM, null, 54, 36);
  return withPg.mw !== without.mw || withPg.mh !== without.mh || withPg.ws !== without.ws;
}
const out: any = { probe: "A1c", honoursPageArg: honoursPage(), cases: [] };

for (const c of CASES) {
  const base = await renderAt(c.pdf, RENDER_SCALE);
  const hiRs = autoRenderScale(base.pageW, base.pageH);
  const scales = [RENDER_SCALE, ...c.extraRs, hiRs];
  const rows: any[] = [];
  let refGeom: any = null, refMeta: any = null;
  for (const rs of scales) {
    const r = rs === RENDER_SCALE ? base : await renderAt(c.pdf, rs);
    const pxPerFt = c.ptPerFtAt2 * (rs / RENDER_SCALE);
    const pg = { pageW: base.pageW, pageH: base.pageH, renderScale: rs, baseScale: RENDER_SCALE };
    // exactly TakeoffCanvas.jsx:2855 — pxPerFt, basePxPerFt, page
    const mkArgs = [r.g.segs, r.w, r.h, MASK_MAX_DIM, null, pxPerFt, pxPerFt * RENDER_SCALE / rs, pg] as const;
    const moGeom = (buildMask as any)(...mkArgs);                             // meta = null: pure grid
    const moMeta = (buildMask as any)(r.g.segs, r.w, r.h, MASK_MAX_DIM, r.g.meta, pxPerFt, pxPerFt * RENDER_SCALE / rs, pg);
    const mppf = moMeta.mppf || 0;
    const probes = c.seedsAt2.map(([nm, sx, sy]) => {
      const k = rs / RENDER_SCALE;
      const f: any = floodRegionSealed(moMeta, sx * k, sy * k, 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
      if (f.status !== "ok") return { name: nm, status: f.status };
      const ring = traceRegion(f);
      return { name: nm, status: "ok", cellSF: +(f.count / (mppf * mppf)).toFixed(3), ringSF: +(ringArea(ring) / (pxPerFt * pxPerFt)).toFixed(3), verts: ring.length };
    });
    const rp = rasterMaskScale ? rasterMaskScale({ pageW: base.pageW, pageH: base.pageH, renderScale: rs, baseScale: RENDER_SCALE, maxDim: MASK_MAX_DIM }) : null;
    const row: any = {
      rs: +rs.toFixed(4), imgW: r.w, imgH: r.h,
      ws: +moGeom.ws.toFixed(8), mw: moGeom.mw, mh: moGeom.mh, mppf: +mppf.toFixed(6),
      maskPxPerPt: +(moGeom.mw / base.pageW).toFixed(9),
      softCountMeta: moMeta.softCount,
      raster: rp ? { mw: rp.mw, mh: rp.mh, vs: +rp.vs.toFixed(6), ws: +rp.ws.toFixed(8) } : "rasterMaskScale absent",
      rasterGridMatchesVector: rp ? (rp.mw === moGeom.mw && rp.mh === moGeom.mh) : null,
      probes,
    };
    if (!refGeom) { refGeom = { mask: moGeom.mask, mw: moGeom.mw, mh: moGeom.mh }; refMeta = { mask: moMeta.mask, mw: moMeta.mw, mh: moMeta.mh, probes }; }
    row.gridDiffVsBaseline_noMeta = (moGeom.mw === refGeom.mw && moGeom.mh === refGeom.mh)
      ? diffCells(refGeom.mask, moGeom.mask) : `N/A dims ${refGeom.mw}x${refGeom.mh} vs ${moGeom.mw}x${moGeom.mh}`;
    row.f8DiffVsBaseline_withMeta = (moMeta.mw === refMeta.mw && moMeta.mh === refMeta.mh)
      ? diffCells(refMeta.mask, moMeta.mask) : `N/A dims ${refMeta.mw}x${refMeta.mh} vs ${moMeta.mw}x${moMeta.mh}`;
    row.f8PctVsBaseline = probes.map((p: any, i: number) => {
      const q = refMeta.probes[i];
      if (p.status !== "ok" || q.status !== "ok") return { name: p.name, note: `${q.status} -> ${p.status}` };
      return { name: p.name, cellPct: +(((p.cellSF - q.cellSF) / q.cellSF) * 100).toFixed(2), ringPct: +(((p.ringSF - q.ringSF) / q.ringSF) * 100).toFixed(2) };
    });
    rows.push(row);
  }
  out.cases.push({ case: c.name, pageW: +base.pageW.toFixed(3), pageH: +base.pageH.toFixed(3), hiResScale: +hiRs.toFixed(4), rows });
}
console.log(JSON.stringify(out, null, 1));
