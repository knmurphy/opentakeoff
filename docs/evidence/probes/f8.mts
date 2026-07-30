// F8 — the RESIDUAL render-dependence left after the A1/F3 pin: how much of the
// Hi-Res drift on a cap-bound sheet is `extractVectorGeometry`'s per-chord meta
// rather than the mask grid?
//
// The pin (buildMask's `page`) makes the GRID render-free. It cannot make the
// meta render-free: markPolylineArcs fits circles to polyline chains in IMAGE px
// and its tolerances are image-px constants, and the device line width baked into
// meta's high nibble is a ceil() of an image-px width. So the same drawing yields
// a different meta byte array at a different render scale, and the mask's flag
// planes (hatch-soft, curve, non-door) move even though every cell address is
// pinned.
//
// This probe decomposes the drift on the VA finish plan (cap-bound, and the one
// corpus sheet where Hi-Res is reachable: autoRenderScale 2.0704) into three
// masks built on the SAME pinned grid at each render scale:
//   A  meta = the meta THIS render produced          (production behaviour)
//   B  meta = the meta the BASELINE render produced  (grid-only drift; only
//              possible when the chord COUNT is render-invariant, which is
//              itself reported)
//   C  meta = null                                    (pure geometry raster)
// and reports, per seed, cell SF and ring SF against the rs-2.000 answer of the
// same variant. B's drift is what the pin owns; A−B is what F8 owns.
//
// It also counts meta bytes that differ from baseline and attributes each
// differing byte to the bits that moved: SEG_CURVE|SEG_POLYARC (markPolylineArcs),
// SEG_CURVE alone (bezier tessellation), the device-line-width high nibble, or
// SEG_CLIP/SEG_FILLONLY.
//
// F8 is UNFIXED by design at 7650f68 (fixing it moves corpus goldens), so this
// runs on AFTER/POST only as a baseline; on BEFORE the grid is not pinned, so
// variant B/C there measure the OLD compound defect and are reported as such.
import { createRequire } from "module";
import {
  extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor,
  doorWedgeCapPx, minPassRadiusFor, traceRegion, ringArea, MASK_MAX_DIM,
  SEG_CURVE, SEG_CLIP, SEG_FILLONLY, SEG_POLYARC,
} from "../src/lib/oneclick.ts";

const RENDER_SCALE = 2.0;
const MAX_CANVAS_DIM = 16384, MAX_PANEL_AREA = 28e6, QUALITY_CEILING = 8.0;
const autoRenderScale = (w: number, h: number) => {
  const cap = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h, Math.sqrt(MAX_PANEL_AREA / (w * h)));
  return Math.min(Math.max(RENDER_SCALE, Math.min(QUALITY_CEILING, cap)), cap);
};
const diffCells = (a: Uint8Array, b: Uint8Array) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

const req = createRequire(import.meta.url);
const pdfjs: any = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

const SEEDS: Array<[string, number, number]> = [
  ["patient-room-137", 2592, 756], ["patient-room-137-band", 2550, 900],
  ["patient-toilet-137a", 2668, 1112], ["elevator-e01", 2538, 1566],
  ["ward-room", 4050, 486], ["ward-vestibule", 4045, 1230],
  ["cloud-corridor", 1814, 1814], ["shaded-wing-office", 659, 1551],
];
const PT_PER_FT_AT2 = 18;

async function renderAt(rs: number) {
  const doc = await pdfjs.getDocument({ url: "../demo/sample-finish-plan.pdf", useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: rs });
  const g = extractVectorGeometry(await page.getOperatorList(), vp.transform, pdfjs.OPS);
  return { g, w: Math.ceil(vp.width), h: Math.ceil(vp.height), pageW: vp.width / rs, pageH: vp.height / rs };
}

const base = await renderAt(RENDER_SCALE);
const hiRs = autoRenderScale(base.pageW, base.pageH);
// 2.000 and `hiRs` are the two render scales the product can actually be in on
// this sheet (Hi-Res OFF / ON). 2.070 and 2.0704 are the two roundings of hiRs
// the audit quotes, kept because the published figure is sensitive to them.
// 3.000 and 5.374 are NOT reachable on this sheet (autoRenderScale caps it at
// hiRs) and are included only to bound F8's magnitude.
const SCALES = [RENDER_SCALE, 2.07, 2.0704, hiRs, 3.0, 5.374];
const out: any = { probe: "F8", sheet: "va-finish-plan", pageW: +base.pageW.toFixed(3), pageH: +base.pageH.toFixed(3), autoRenderScale: +hiRs.toFixed(6), rows: [] };

const refs: any = { A: null, B: null, C: null };
for (const rs of SCALES) {
  const r = rs === RENDER_SCALE ? base : await renderAt(rs);
  const pxPerFt = PT_PER_FT_AT2 * (rs / RENDER_SCALE);
  const pg = { pageW: base.pageW, pageH: base.pageH, renderScale: rs, baseScale: RENDER_SCALE };
  const chordsMatch = r.g.segs.length === base.g.segs.length;
  const build = (meta: Uint8Array | null) => (buildMask as any)(r.g.segs, r.w, r.h, MASK_MAX_DIM, meta, pxPerFt, pxPerFt * RENDER_SCALE / rs, pg);
  const variants: any = { A: build(r.g.meta), C: build(null) };
  if (chordsMatch) variants.B = build(base.g.meta);

  // meta byte attribution
  let metaDiff = 0; const attrib: Record<string, number> = {};
  if (chordsMatch) {
    const a = r.g.meta as Uint8Array, b = base.g.meta as Uint8Array;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      metaDiff++;
      const x = a[i] ^ b[i], tags: string[] = [];
      if (x & SEG_POLYARC) tags.push("SEG_POLYARC");
      if (x & SEG_CURVE) tags.push("SEG_CURVE");
      if (x & SEG_CLIP) tags.push("SEG_CLIP");
      if (x & SEG_FILLONLY) tags.push("SEG_FILLONLY");
      if (x & 0xf0) tags.push("lineWidthNibble");
      const key = tags.join("+") || "?";
      attrib[key] = (attrib[key] || 0) + 1;
    }
  }

  const row: any = {
    rs: +rs.toFixed(6), imgW: r.w, imgH: r.h, chords: r.g.segs.length / 4, chordCountMatchesBaseline: chordsMatch,
    metaBytesDiffering: chordsMatch ? metaDiff : "N/A (chord count moved)",
    metaBytesTotal: chordsMatch ? (base.g.meta as Uint8Array).length : null,
    metaAttribution: attrib, variants: {},
  };
  for (const v of ["A", "B", "C"] as const) {
    const mo = variants[v];
    if (!mo) { row.variants[v] = "unavailable"; continue; }
    const mppf = mo.mppf || 0;
    const probes = SEEDS.map(([nm, sx, sy]) => {
      const k = rs / RENDER_SCALE;
      const f: any = floodRegionSealed(mo, sx * k, sy * k, 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
      if (f.status !== "ok") return { name: nm, status: f.status };
      return { name: nm, status: "ok", cellSF: +(f.count / (mppf * mppf)).toFixed(3), ringSF: +(ringArea(traceRegion(f)) / (pxPerFt * pxPerFt)).toFixed(3) };
    });
    if (!refs[v]) refs[v] = { mask: mo.mask, mw: mo.mw, mh: mo.mh, probes };
    row.variants[v] = {
      mw: mo.mw, mh: mo.mh, ws: +mo.ws.toFixed(8), mppf: +mppf.toFixed(6), softCount: mo.softCount,
      maskCellsDiffering: (mo.mw === refs[v].mw && mo.mh === refs[v].mh) ? diffCells(refs[v].mask, mo.mask) : `N/A dims`,
      maskCellsTotal: mo.mw * mo.mh,
      drift: probes.map((p: any, i: number) => {
        const q = refs[v].probes[i];
        if (p.status !== "ok" || q.status !== "ok") return { name: p.name, note: `${q.status} -> ${p.status}` };
        return { name: p.name, cellPct: +(((p.cellSF - q.cellSF) / q.cellSF) * 100).toFixed(2), ringPct: +(((p.ringSF - q.ringSF) / q.ringSF) * 100).toFixed(2), cellSF: p.cellSF, ringSF: p.ringSF };
      }),
    };
  }
  out.rows.push(row);
}
console.log(JSON.stringify(out, null, 1));
