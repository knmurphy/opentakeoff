// A1 — does the render scale (the per-sheet "Hi-Res render" toggle) change the
// MEASURED square footage of the same room on the same sheet?
//
// Identical file on BEFORE and AFTER. It calls buildMask with a 7th argument
// (basePxPerFt). On BEFORE that parameter does not exist and JS drops it, which
// is exactly the point: BEFORE has no way to pin the raster to the sheet.
//
// PART 1 — the synthetic slit scene, verbatim from the AFTER branch's own
//   web/test/resolutionInvariance.test.ts (11x17 at 1/8" = 1'-0", a room with a
//   0.60-0.63 ft slit in its right wall). Rendered at rs 2.000 (Hi-Res OFF),
//   2.070, 3.000 and 5.374 (Hi-Res ON on an 11x17). This sheet renders BELOW
//   MASK_MAX_DIM at baseline, so it is the "cap does not bind" case.
// PART 2 — the two real corpus PDFs, rendered at the baseline RENDER_SCALE=2 and
//   at the Hi-Res scale the product's autoRenderScale() would pick. sample-plan
//   is below the cap at baseline; va-finish-plan is cap-bound at both.
//   VA is also run at rs 2.070 exactly (the value docs/audit/ISSUE_184_AUDIT.md
//   quotes) as well as the true autoRenderScale 2.0704 — the two differ.
//
// Reported per render: mppf (mask px/ft), mask dims, mask cells that differ from
// the baseline render's mask, and measured SF two ways (both exist on BEFORE):
//   cellSF = flood cell count / mppf^2
//   ringSF = ringArea(traceRegion(f)) / pxPerFt^2   (traceRegion returns image px)
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

const out: any = { probe: "A1", synthetic: [], cases: [] };

// ── PART 1: synthetic slit scene ────────────────────────────────────────────
const A1_PT_PER_FT = 9, A1_BASE_RS = 2;
function a1Scene(rs: number) {
  const k = rs / A1_BASE_RS, segs: number[] = [];
  const L = (a: number, b: number, c: number, d: number) => segs.push(a * k * 2, b * k * 2, c * k * 2, d * k * 2);
  L(100, 100, 400, 100); L(400, 100, 400, 180); L(400, 196, 400, 340);
  L(400, 340, 100, 340); L(100, 340, 100, 100);
  L(150, 150, 380, 150); L(150, 200, 380, 200);
  return { segs, w: 900 * k * 2, h: 700 * k * 2, pxPerFt: A1_PT_PER_FT * rs, base: A1_PT_PER_FT * A1_BASE_RS };
}
let synBase: any = null;
for (const rs of [2.0, 2.07, 3.0, 5.374]) {
  const s = a1Scene(rs);
  const mo = buildMask(s.segs, s.w, s.h, MASK_MAX_DIM, null, s.pxPerFt, s.base);
  const mppf = mo.mppf || 0;
  const f: any = floodRegionSealed(mo, 250 * (rs / A1_BASE_RS) * 2, 220 * (rs / A1_BASE_RS) * 2, 0.5,
    sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  const row: any = {
    rs, imgW: Math.round(s.w), imgH: Math.round(s.h), ws: +mo.ws.toFixed(6), mw: mo.mw, mh: mo.mh,
    mppf: +mppf.toFixed(4), status: f.status,
    sealedPx: f.sealedPx ?? null, virtualFrac: f.virtualFrac != null ? +f.virtualFrac.toFixed(4) : null,
    minPassPx: minPassRadiusFor(mppf),
  };
  if (f.status === "ok") {
    row.cellSF = +(f.count / (mppf * mppf)).toFixed(2);
    row.ringSF = +(ringArea(traceRegion(f)) / (s.pxPerFt * s.pxPerFt)).toFixed(2);
  }
  if (!synBase) synBase = { mask: mo.mask, mw: mo.mw, mh: mo.mh };
  row.diffVsBaseline = (mo.mw === synBase.mw && mo.mh === synBase.mh)
    ? diffCells(synBase.mask, mo.mask) : `N/A dims ${synBase.mw}x${synBase.mh} vs ${mo.mw}x${mo.mh}`;
  out.synthetic.push(row);
}

// ── PART 2: real corpus PDFs ────────────────────────────────────────────────
const req = createRequire(import.meta.url);
const pdfjs: any = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

interface Cfg { name: string; pdf: string; ptPerFtAt2: number; extraRs?: number[]; seedsAt2: Array<[string, number, number]>; }
const CASES: Cfg[] = [
  {
    name: "sample-plan", pdf: "../demo/sample-plan.pdf", ptPerFtAt2: 36,
    seedsAt2: [["break-103", 432, 216], ["corridor-104", 1296, 216], ["office-101", 432, 864], ["office-102", 1296, 864]],
  },
  {
    name: "va-finish-plan", pdf: "../demo/sample-finish-plan.pdf", ptPerFtAt2: 18, extraRs: [2.070],
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

for (const c of CASES) {
  const base = await renderAt(c.pdf, RENDER_SCALE);
  const hiRs = autoRenderScale(base.pageW, base.pageH);
  const scales = [RENDER_SCALE, ...(c.extraRs || []), hiRs];
  const basePxPerFt = c.ptPerFtAt2;
  const rows: any[] = [];
  let ref: any = null;
  for (const rs of scales) {
    const r = rs === RENDER_SCALE ? base : await renderAt(c.pdf, rs);
    const pxPerFt = c.ptPerFtAt2 * (rs / RENDER_SCALE);
    const mo = buildMask(r.g.segs, r.w, r.h, MASK_MAX_DIM, r.g.meta, pxPerFt, basePxPerFt);   // arg 7 absent on BEFORE
    const mppf = mo.mppf || 0;
    const probes = c.seedsAt2.map(([nm, sx, sy]) => {
      const k = rs / RENDER_SCALE;
      const f: any = floodRegionSealed(mo, sx * k, sy * k, 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
      if (f.status !== "ok") return { name: nm, status: f.status };
      const ring = traceRegion(f);
      return { name: nm, status: "ok", cellSF: +(f.count / (mppf * mppf)).toFixed(3), ringSF: +(ringArea(ring) / (pxPerFt * pxPerFt)).toFixed(3), verts: ring.length };
    });
    const row: any = { rs: +rs.toFixed(4), imgW: r.w, imgH: r.h, ws: +mo.ws.toFixed(6), mw: mo.mw, mh: mo.mh, mppf: +mppf.toFixed(4), probes };
    if (!ref) ref = { mask: mo.mask, mw: mo.mw, mh: mo.mh, probes };
    row.diffVsBaseline = (mo.mw === ref.mw && mo.mh === ref.mh) ? diffCells(ref.mask, mo.mask) : `N/A dims ${ref.mw}x${ref.mh} vs ${mo.mw}x${mo.mh}`;
    row.pctVsBaseline = probes.map((p: any, i: number) => {
      const q = ref.probes[i];
      if (p.status !== "ok" || q.status !== "ok") return { name: p.name, note: `${q.status} -> ${p.status}` };
      return { name: p.name, cellPct: +(((p.cellSF - q.cellSF) / q.cellSF) * 100).toFixed(2), ringPct: +(((p.ringSF - q.ringSF) / q.ringSF) * 100).toFixed(2) };
    });
    rows.push(row);
  }
  out.cases.push({ case: c.name, hiResScale: +hiRs.toFixed(4), rows });
}
console.log(JSON.stringify(out, null, 1));
