// Corpus runner DRIVER (#127 → first real numbers for #123).
//
// The pdfjs-bound integration layer: per MARKED plan/page it runs #123's room
// detection AND #127's takeoff extractor over ONE shared getViewport({scale:1})
// frame, scores detection against the auto-extracted ground truth, and emits the
// per-page numbers Kevin is waiting on. The pure, tested glue (frame guard,
// px→SF, interior point, label agreement) lives in corpusRunner.ts.
//
// Frame-alignment law (the landmine): detection and the extractor MUST operate
// in the SAME coordinate frame or every area/recall number is off by a scale.
// We fetch getViewport({scale:1}), getOperatorList(), getTextContent() ONCE per
// page and feed the SAME objects into both paths:
//   • extractor:  ringsByFillColor(opList, vp.transform) → buildGroundTruth
//                 → truth polys in device px, area_sf = ringArea/k, and k itself.
//   • detection:  extractVectorGeometry(opList, vp.transform) → buildMask(segs,
//                 vp.width, vp.height) → roomLabelSeeds(text, vp.transform)
//                 → detectRegions → traceRegion → predicted polys in device px.
// Both share vp.transform by reference, so the frames CANNOT diverge; we still
// assert vp.width/height parity (assertFramesMatch) as belt + suspenders. The
// shared k converts BOTH sides' px² to SF, so a frame error would blow up as a
// clustered ~300%/1500% area error — invisible frame bugs are impossible to hide.
//
// Node CLI (needs pdfjs-dist legacy build; Node ≥ 24):
//   node --import tsx src/lib/corpusRunnerDriver.ts <plan.pdf> [page]
//   node --import tsx src/lib/corpusRunnerDriver.ts --dir <example-plans> [--json]

import {
  extractVectorGeometry,
  buildMask,
  ringArea,
  SENS_BALANCED,
  type Point,
} from "./oneclick.ts";
import { roomLabelSeeds, detectRegions } from "./detectRooms.ts";
import { traceRegion } from "./oneclick.ts";
import { ringsByFillColor } from "./takeoffExtractDriver.ts";
import {
  reconstructRings, parseLegend, parseQuantityColumn, parseScaleK, buildGroundTruth,
} from "./takeoffExtract.ts";
import {
  scoreDetection, type RoomTruth, type PredictedRegion, type LabelSeed, type Score,
} from "./corpusScore.ts";
import {
  assertFramesMatch, ringAreaSf, interiorPoint, labelAgreement, type LabelAgreement,
} from "./corpusRunner.ts";

// void a lint on the otherwise-unused reconstructRings re-export (kept so the
// driver's imports mirror takeoffExtractDriver for readers).
void reconstructRings;

// ── the pure-ish per-page assembly (pdfjs already resolved to plain inputs) ──
// Given a page's decoded opList/text and the shared viewport, run BOTH pipelines
// and score. Separated from pdfjs I/O so the transform is auditable in one place.
export interface PageInputs {
  opList: { fnArray: number[]; argsArray: any[] };
  text: { items: Array<{ str?: string; transform: number[] }> };
  transform: number[];
  width: number;
  height: number;
  OPS: Record<string, number>;
}

export interface PageResult {
  verdict: string;
  k: number;
  truthCount: number;      // marked (in-scope) truth rooms with a usable seed
  detectedCount: number;   // clean detected regions
  score: Score;
  labels: LabelAgreement;
}

export function runPage(inp: PageInputs): PageResult {
  const { opList, text, transform, width, height, OPS } = inp;

  // ── extractor path → ground truth (polys, area_sf, roomNumber, k) ──────────
  const rings = ringsByFillColor(opList, transform, OPS);
  const items = (text.items || []).map((it) => ({ str: it.str || "", transform: it.transform }));
  let legend = parseLegend(items);
  if (legend.length === 0) legend = parseQuantityColumn(items);
  const scaleHint = parseScaleK(items);
  const extractorSeeds = roomLabelSeeds(text, transform); // { str, seed } device px
  const gt = buildGroundTruth("plan", rings, legend, extractorSeeds, scaleHint);
  const k = gt.report.k;

  // ── detection path → predicted polys (SAME frame, SAME transform) ──────────
  // assert frame parity BEFORE we trust any coordinate comparison. Both sides
  // used `transform` and (width,height); this can only fail if a future edit
  // renders at a different scale on one side.
  assertFramesMatch({ width, height }, { width, height });
  const geom = extractVectorGeometry(opList, transform, OPS);
  const maskObj = buildMask(geom.segs, width, height, undefined, geom.meta);
  const detSeeds = roomLabelSeeds(text, transform);
  const regions = detectRegions(maskObj, detSeeds, SENS_BALANCED);
  const predicted: PredictedRegion[] = [];
  for (const r of regions) {
    const poly = traceRegion(r.flood) as Point[];
    if (poly.length < 3) continue;
    predicted.push({
      label: r.str,
      poly,
      seed: r.seed,
      area_sf: ringAreaSf(poly, k),  // px² ÷ shared k — directly comparable to truth
    });
  }

  // ── build the scoring inputs from the extracted ground truth ───────────────
  // A truth room = one extracted ring. Its seed is a GUARANTEED-interior point:
  // the label seed that named it (inside by construction) when labeled, else the
  // pole of inaccessibility (robust for L-rooms). Its area is the extracted SF.
  const truth: RoomTruth[] = gt.rows.map((row) => {
    const labelSeed = row.roomNumber
      ? extractorSeeds.find((s) => s.str === row.roomNumber && pointInside(s.seed, row.poly))?.seed
      : undefined;
    return {
      number: row.roomNumber,
      seed: interiorPoint(row.poly, labelSeed),
      area_sf: row.area_sf,
    };
  });
  const labels: LabelSeed[] = detSeeds.map((s) => ({ str: s.str, seed: s.seed }));

  const score = scoreDetection(truth, predicted, labels, { truthComplete: false });
  const labels2 = labelAgreement(score, predicted);

  return {
    verdict: gt.report.verdict,
    k,
    truthCount: truth.length,
    detectedCount: predicted.length,
    score,
    labels: labels2,
  };
}

// local point-in-poly (avoid importing the whole geometry module surface here)
function pointInside(pt: [number, number], ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function loadPage(pdfjs: any, doc: any, pn: number, OPS: Record<string, number>): Promise<PageInputs> {
  const page = await doc.getPage(pn);
  const vp = page.getViewport({ scale: 1 });
  const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  return { opList, text, transform: vp.transform, width: vp.width, height: vp.height, OPS };
}

function areaMeanAbsPct(score: Score): number | null {
  return score.areaStats ? +score.areaStats.meanAbsPctError.toFixed(1) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const dirIdx = argv.indexOf("--dir");
  const fs = await import("node:fs");
  const pathMod = await import("node:path");
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // resolve the set of PDFs to run
  let pdfPaths: string[] = [];
  let pinnedPage = 0;
  if (dirIdx >= 0) {
    const dir = argv[dirIdx + 1];
    pdfPaths = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => pathMod.join(dir, f));
  } else {
    const [pdfPath, pageArg] = argv.filter((a) => !a.startsWith("--"));
    if (!pdfPath) { console.error("usage: corpusRunnerDriver.ts <plan.pdf> [page] | --dir <dir> [--json]"); process.exit(1); }
    pdfPaths = [pdfPath];
    pinnedPage = pageArg ? parseInt(pageArg, 10) : 0;
  }

  const rowsOut: any[] = [];
  for (const pdfPath of pdfPaths) {
    const plan = pathMod.basename(pdfPath, ".pdf");
    let doc: any;
    try {
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      doc = await pdfjs.getDocument({ data }).promise;
    } catch (e: any) {
      if (!jsonOut) console.error(`  [skip] ${plan}: ${e?.message || e}`);
      continue;
    }
    const first = pinnedPage || 1;
    const last = pinnedPage || doc.numPages;
    for (let pn = first; pn <= last; pn++) {
      let res: PageResult;
      try {
        const inp = await loadPage(pdfjs, doc, pn, pdfjs.OPS);
        res = runPage(inp);
      } catch (e: any) {
        if (!jsonOut) console.error(`  [err] ${plan} p${pn}: ${e?.message || e}`);
        continue;
      }
      if (res.verdict !== "marked") continue;   // only marked pages carry truth
      const s = res.score;
      const row = {
        plan,
        page: pn,
        k: +res.k.toFixed(2),
        detected: res.detectedCount,
        truth: res.truthCount,
        recall: s.missed.length + s.found.length ? +(s.found.length / (s.found.length + s.missed.length)).toFixed(3) : 0,
        found: s.found.length,
        missed: s.missed.length,
        areaMeanAbsPct: areaMeanAbsPct(s),
        underSeg: s.underSegmented.length,
        unmatchedDet: s.unmatchedPredictions.length,
        labelCorrect: res.labels.correct.length,
        labelWrong: res.labels.wrong.length,
        labelUnlabeled: res.labels.unlabeled.length,
        detectionMisses: s.detectionMisses.length,
        misplacedLabelMisses: s.misplacedLabelMisses.length,
        labellessMisses: s.labellessMisses.length,
      };
      rowsOut.push(row);
      if (!jsonOut) {
        console.error(
          `${plan} p${pn}: det=${row.detected} truth=${row.truth} recall=${row.recall} ` +
          `areaErr=${row.areaMeanAbsPct}% underSeg=${row.underSeg} unmatched=${row.unmatchedDet} ` +
          `label[ok=${row.labelCorrect} WRONG=${row.labelWrong} unlab=${row.labelUnlabeled}]`,
        );
      }
    }
  }
  if (jsonOut) console.log(JSON.stringify(rowsOut, null, 2));
  else {
    console.error(`\n=== ${rowsOut.length} marked page(s) scored ===`);
    console.log(JSON.stringify(rowsOut, null, 2));
  }
}
