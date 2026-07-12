// Takeoff-markup extraction DRIVER (issue #127).
//
// The thin, pdf.js-bound layer: it reads a PDF page, walks the operator list to
// group filled rings by fill color (device px), reads the legend + room-label
// seeds off the text layer, and hands all of it to the PURE, tested module
// (takeoffExtract.ts) for ring reconstruction, reconciliation, and ground-truth
// assembly. It deliberately does NO geometry math of its own beyond CTM
// bookkeeping — the over-merge-prone ring walk lives in reconstructRings, which
// the test suite guards. That keeps the driver's untested surface to: graphics-
// state tracking (save/restore/transform/form-xobject) and fill detection.
//
// Node CLI usage (needs the pdfjs-dist legacy build):
//   node --import tsx src/lib/takeoffExtractDriver.ts <plan.pdf> [page]

import { reconstructRings, parseLegend, buildGroundTruth, type Point, type GroundTruth, type PathOps } from "./takeoffExtract.ts";
import { roomLabelSeeds } from "./detectRooms.ts";

/** Group every FILLED ring on a page by its fill color "r,g,b", in device px.
 *  Pure w.r.t. geometry — the ring walk is reconstructRings; this only tracks
 *  the CTM, the fill color, and which paths are painted as fills. */
export function ringsByFillColor(
  opList: { fnArray: number[]; argsArray: any[] },
  viewportTransform: number[],
  OPS: Record<string, number>,
): Record<string, Point[][]> {
  const P: PathOps = {
    moveTo: OPS.moveTo, lineTo: OPS.lineTo, curveTo: OPS.curveTo,
    curveTo2: OPS.curveTo2, curveTo3: OPS.curveTo3, closePath: OPS.closePath, rectangle: OPS.rectangle,
  };
  const fns = opList.fnArray, A = opList.argsArray;
  const mul = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const apply = (m: number[], p: Point): Point => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

  let m = viewportTransform.slice();
  let fill: [number, number, number] = [0, 0, 0];
  const stack: Array<[number[], [number, number, number]]> = [];
  const out: Record<string, Point[][]> = {};

  // is the path at index i painted as a fill? (fill/eoFill/*FillStroke, skipping
  // any clip ops that sit between the path and its paint op)
  const isFilled = (i: number): boolean => {
    for (let j = i + 1; j < fns.length && j <= i + 3; j++) {
      const f = fns[j];
      if (f === OPS.clip || f === OPS.eoClip) continue;
      if (f === OPS.fill || f === OPS.eoFill || f === OPS.fillStroke ||
          f === OPS.eoFillStroke || f === OPS.closeFillStroke) return true;
      return false;
    }
    return false;
  };

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i], args = A[i];
    if (fn === OPS.save) stack.push([m.slice(), [...fill]]);
    else if (fn === OPS.restore) { const p = stack.pop(); if (p) { m = p[0]; fill = p[1]; } }
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.setFillRGBColor) fill = [args[0], args[1], args[2]];
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([m.slice(), [...fill]]); if (args && args[0]) m = mul(m, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) { const p = stack.pop(); if (p) { m = p[0]; fill = p[1]; } }
    else if (fn === OPS.constructPath) {
      if (!isFilled(i)) continue;
      // reconstruct rings in PATH-LOCAL coords via the tested walker, then map
      // each ring point through the current CTM (constant within one path).
      const localRings = reconstructRings(args[0], args[1], P);
      const key = fill.join(",");
      const dst = out[key] || (out[key] = []);
      for (const ring of localRings) dst.push(ring.map((pt) => apply(m, pt)));
    }
  }
  return out;
}

/** Full per-page extraction: pdf.js page-like object → ground truth. The `page`
 *  must expose getViewport / getOperatorList / getTextContent and pdfjsLib.OPS. */
export async function extractPage(
  plan: string,
  page: { getViewport: (o: { scale: number }) => { transform: number[] }; getOperatorList: () => Promise<any>; getTextContent: () => Promise<any> },
  OPS: Record<string, number>,
): Promise<GroundTruth> {
  const vp = page.getViewport({ scale: 1 });
  const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  const rings = ringsByFillColor(opList, vp.transform, OPS);
  const legend = parseLegend((text.items || []).map((it: any) => ({ str: it.str, transform: it.transform })));
  const seeds = roomLabelSeeds(text, vp.transform);
  return buildGroundTruth(plan, rings, legend, seeds);
}

// ── CLI entry (best-effort; used to validate against the confidential corpus) ─
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , pdfPath, pageArg] = process.argv;
  if (!pdfPath) { console.error("usage: takeoffExtractDriver.ts <plan.pdf> [page]"); process.exit(1); }
  const fs = await import("node:fs");
  const pathMod = await import("node:path");
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const plan = pathMod.basename(pdfPath, ".pdf");
  const pn = pageArg ? parseInt(pageArg, 10) : 1;
  const page = await doc.getPage(pn);
  const gt = await extractPage(plan, page, pdfjs.OPS);
  console.log(JSON.stringify({
    plan: gt.report.plan, page: pn, verdict: gt.report.verdict, k: gt.report.k, recall: gt.report.recall,
    materials: gt.report.materials.filter((m) => m.accept).map((m) => ({ material: m.material, color: m.color, extractedSF: +m.extractedSF.toFixed(2), legendSF: m.legendSF, residualPct: +m.residualPct.toFixed(3) })),
    unmatchedColors: gt.report.unmatchedColors,
    unmatchedLegend: gt.report.unmatchedLegend,
    rowsCount: gt.rows.length,
    roomsLabeled: gt.rows.filter((r) => r.roomNumber).length,
  }, null, 2));
}
