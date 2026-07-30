// A5b — did the bench score a ring the product never returned?
//
// The product's one-click ring is snapVertices(traceRegion(f), nearestSnap(grid), 7)
// — three call sites in TakeoffCanvas.jsx and one in mcp/src/session.ts, all
// identical, on BOTH states. The bench's ring on BEFORE is bare traceRegion(f).
// This probe computes BOTH rings for every real-PDF corpus probe on BOTH states,
// so the gap is measured rather than argued.
//
// Restricted to the two real-PDF cases (sample-plan, va-finish-plan) because
// those carry a real extractVectorGeometry point set on both states; BEFORE's
// SyntheticCase type has no `points` field at all, so the synthetic half of the
// corpus HAS no production ring on BEFORE to compare against — that absence is
// itself part of the finding.
import { createRequire } from "module";
import {
  extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, traceRegion, snapVertices, ringArea, MASK_MAX_DIM,
} from "../src/lib/oneclick.ts";
import { buildSnapGrid, nearestSnap } from "../src/lib/geometry.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SNAP_CELL = 24, SNAP_TOL = 7;                 // canvasConstants.js / mcp session.ts
const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const pdfjs: any = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

const out: any = { probe: "A5b", cases: [] };
for (const f of ["sample-plan.json", "va-finish-plan.json"]) {
  const file = join(here, "..", "bench", "corpus", f);
  const c = JSON.parse(readFileSync(file, "utf8"));
  const doc = await pdfjs.getDocument({ url: join(dirname(file), c.pdf), useSystemFonts: true }).promise;
  const page = await doc.getPage(c.page || 1);
  const vp = page.getViewport({ scale: c.scale });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  const mo = buildMask(g.segs, Math.ceil(vp.width), Math.ceil(vp.height), MASK_MAX_DIM, g.meta, c.ptPerFt, c.ptPerFt);
  const mppf = mo.mppf || 0;
  const grid = buildSnapGrid(g.points, SNAP_CELL);
  const rows: any[] = [];
  for (const p of c.probes) {
    const fl: any = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    if (fl.status !== "ok") { rows.push({ name: p.name, status: fl.status }); continue; }
    const bench = traceRegion(fl);
    const prod = snapVertices(traceRegion(fl), (x: number, y: number, d: number) => nearestSnap(grid, x, y, d), SNAP_TOL);
    const bSF = ringArea(bench) / (c.ptPerFt * c.ptPerFt);
    const pSF = ringArea(prod) / (c.ptPerFt * c.ptPerFt);
    const goldenSF = p.golden ? ringArea(p.golden) / (c.ptPerFt * c.ptPerFt) : null;
    rows.push({
      name: p.name, status: "ok",
      benchRingSF: +bSF.toFixed(2), benchVerts: bench.length,
      prodRingSF: +pSF.toFixed(2), prodVerts: prod.length,
      deltaSF: +(pSF - bSF).toFixed(2), deltaPct: +(((pSF - bSF) / bSF) * 100).toFixed(2),
      pinnedGoldenSF: goldenSF == null ? null : +goldenSF.toFixed(2),
      benchErrVsGoldenPct: goldenSF == null ? null : +(((bSF - goldenSF) / goldenSF) * 100).toFixed(2),
      prodErrVsGoldenPct: goldenSF == null ? null : +(((pSF - goldenSF) / goldenSF) * 100).toFixed(2),
    });
  }
  out.cases.push({ case: f.replace(".json", ""), ptPerFt: c.ptPerFt, points: g.points.length, rows });
}
console.log(JSON.stringify(out, null, 1));
