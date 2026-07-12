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
import { roomLabelSeeds, detectRegions, dedupeRegions } from "./detectRooms.ts";
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

// One scored variant (BEFORE = raw detectRegions, AFTER = dedupeRegions applied).
// Carries the objects needed to diff FOUND-ROOM IDENTITY across variants — the
// whole measurement hinges on comparing which truth rooms were cleanly found,
// not merely how many. Because BOTH variants score against the SAME `truth`
// array (same object references), `found` can be diffed by identity exactly.
export interface Variant {
  detectedCount: number;   // clean detected regions (= predicted.length)
  score: Score;
  labels: LabelAgreement;
  predicted: PredictedRegion[];
}

export interface PageResult {
  verdict: string;
  k: number;
  truthCount: number;      // marked (in-scope) truth rooms with a usable seed
  truth: RoomTruth[];      // the shared truth array (identity anchor for diffs)
  before: Variant;         // predicted = detectRegions(...)
  after: Variant;          // predicted = dedupeRegions(detectRegions(...))
}

function scoreVariant(
  predicted: PredictedRegion[],
  truth: RoomTruth[],
  labels: LabelSeed[],
): Variant {
  const score = scoreDetection(truth, predicted, labels, { truthComplete: false });
  return { detectedCount: predicted.length, score, labels: labelAgreement(score, predicted), predicted };
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

  // ONE detection call. We score it TWICE — raw (BEFORE) and deduped (AFTER) —
  // from this single set of regions so that any change in `found` is attributable
  // to dedup ALONE, not to a re-derivation that might differ for other reasons.
  const regions = detectRegions(maskObj, detSeeds, SENS_BALANCED);
  const dedupedRegions = dedupeRegions(regions);

  const toPredicted = (rs: typeof regions): PredictedRegion[] => {
    const out: PredictedRegion[] = [];
    for (const r of rs) {
      const poly = traceRegion(r.flood) as Point[];
      if (poly.length < 3) continue;
      out.push({
        label: r.str,
        poly,
        seed: r.seed,
        area_sf: ringAreaSf(poly, k),  // px² ÷ shared k — directly comparable to truth
      });
    }
    return out;
  };
  const predictedBefore = toPredicted(regions);
  const predictedAfter = toPredicted(dedupedRegions);

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

  return {
    verdict: gt.report.verdict,
    k,
    truthCount: truth.length,
    truth,
    before: scoreVariant(predictedBefore, truth, labels),
    after: scoreVariant(predictedAfter, truth, labels),
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
      const b = res.before.score;
      const a = res.after.score;
      const T = res.truthCount;

      // FOUND-SET IDENTITY DIFF — the crux. Both scores ran against the SAME
      // `truth` array, so found rooms share object identity across variants.
      // Dedup only REMOVES regions, so found_after ⊆ found_before must hold; a
      // room in after-but-not-before would be a harness bug (assert loudly). Any
      // room in before-but-not-after is a REAL recall regression — dedup dropped
      // a room a clean poly had found. That is the number Kevin is watching.
      const beforeSet = new Set(b.found);
      const afterSet = new Set(a.found);
      const droppedFound = b.found.filter((t) => !afterSet.has(t));   // recall regressions
      const gainedFound = a.found.filter((t) => !beforeSet.has(t));   // must be empty
      if (gainedFound.length) {
        throw new Error(
          `HARNESS BUG ${plan} p${pn}: dedup ADDED found room(s) ` +
          `${gainedFound.map((t) => t.number ?? "?").join(",")} — dedup only removes regions, ` +
          `so found_after must be a subset of found_before.`,
        );
      }

      const recall = (s: Score): number =>
        s.missed.length + s.found.length ? +(s.found.length / (s.found.length + s.missed.length)).toFixed(3) : 0;
      // precision proxy = found / detected (the complete-truth precision FLOOR).
      const prec = (s: Score, det: number): number | null => (det ? +(s.found.length / det).toFixed(3) : null);

      const row = {
        plan,
        page: pn,
        k: +res.k.toFixed(2),
        truth: T,
        // BEFORE (raw detectRegions)
        detBefore: res.before.detectedCount,
        foundBefore: b.found.length,
        recallBefore: recall(b),
        precBefore: prec(b, res.before.detectedCount),
        // AFTER (dedupeRegions)
        detAfter: res.after.detectedCount,
        foundAfter: a.found.length,
        recallAfter: recall(a),
        precAfter: prec(a, res.after.detectedCount),
        // dedup effect
        collapsed: res.before.detectedCount - res.after.detectedCount,
        droppedFound: droppedFound.map((t) => t.number ?? "(unlabeled)"),
        recallRegression: droppedFound.length > 0,
        // context
        underSegBefore: b.underSegmented.length,
        underSegAfter: a.underSegmented.length,
        areaMeanAbsPctBefore: areaMeanAbsPct(b),
        areaMeanAbsPctAfter: areaMeanAbsPct(a),
      };
      rowsOut.push(row);
      if (!jsonOut) {
        console.error(
          `${plan} p${pn}: truth=${T} | BEFORE det=${row.detBefore} found=${row.foundBefore} ` +
          `recall=${row.recallBefore} prec=${row.precBefore} | AFTER det=${row.detAfter} ` +
          `found=${row.foundAfter} recall=${row.recallAfter} prec=${row.precAfter} | ` +
          `collapsed=${row.collapsed} REGRESSION=${row.recallRegression ? row.droppedFound.join(",") : "none"}`,
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
