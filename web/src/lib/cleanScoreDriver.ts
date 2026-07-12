// CLEAN-truth scoring driver (#127 → the definitive P/R for #123).
//
// Unlike corpusRunnerDriver.ts (which scores against AUTO-EXTRACTED vector-ring
// truth with truthComplete:false — a precision FLOOR), this driver scores room
// detection against the USER's HAND-LABELED CLEAN ground truth: every real room
// on ~23 sheets was clicked in the label harness (example-plans/.labels/*.json).
// Because that truth is COMPLETE-RECALL, unmatched predictions are GENUINE false
// positives and precision is TRUE precision, not a floor. So we score with
// { truthComplete: true }.
//
// ── Frame-alignment law (the landmine) ──────────────────────────────────────
// The label harness renders each sheet at RENDER_SCALE = 2.0 (web/src/lib/sheets)
// and captures seeds in that device-px frame (e.g. 6048×4320). Detection here
// renders the SAME page at getViewport({scale: 2}) so the frames match NATIVELY —
// this is also production-faithful (the app detects at RENDER_SCALE too).
//   • Even plans (AKMS/PNB/TikTok): scale=2 → 6048×4320, EXACTLY the label dims.
//   • REBID: scale=2 → 6048.48×4320.48, but the harness Math.ceil'd to 6049×4321.
//     A sub-pixel gap. We rescale each truth seed by (detW/labelW, detH/labelH) —
//     a no-op for even plans, a ~0.99992 correction for REBID — and assert the
//     ratio is within 1% of 1.0 (catches a real 2× frame bug, tolerates the ceil).
// traceRegion returns polys in the SAME device-px frame (it divides mask coords
// by buildMask's ws), so predicted polys and rescaled truth seeds share one frame.
//
// Node CLI (pdfjs-dist legacy build; Node ≥ 24):
//   node --import tsx src/lib/cleanScoreDriver.ts --labels <dir/.labels> --plans <dir> [--json]

import {
  extractVectorGeometry,
  buildMask,
  traceRegion,
  SENS_BALANCED,
  type Point,
} from "./oneclick.ts";
import { roomLabelSeeds, detectRegions, dedupeRegions } from "./detectRooms.ts";
import {
  scoreDetection, type RoomTruth, type PredictedRegion, type LabelSeed,
} from "./corpusScore.ts";
import { pointInPoly } from "./geometry.js";

// ── the pure per-sheet assembly (pdfjs already resolved to plain inputs) ─────
export interface SheetInputs {
  opList: { fnArray: number[]; argsArray: any[] };
  text: { items: Array<{ str?: string; transform: number[] }> };
  transform: number[];      // getViewport({scale:2}).transform
  detW: number;             // detection frame width  (device px)
  detH: number;             // detection frame height (device px)
  labelW: number;           // label file's captured frame width
  labelH: number;           // label file's captured frame height
  truthSeeds: Array<{ seed: [number, number]; number?: string }>; // in LABEL frame
  OPS: Record<string, number>;
}

export interface SheetResult {
  truthCount: number;
  detectedCount: number;         // deduped predicted region count (= denom of precision)
  detectedRawCount: number;      // pre-dedup, for context
  score: ReturnType<typeof scoreDetection>;
  // frame-alignment proof
  enclosedFound: number;         // #found rooms whose truth seed lies inside its predicted poly
  ratioW: number; ratioH: number;
  // negative-control (seeds ÷2) recall — MUST collapse if the frame is real
  negControlRecall: number;
  predicted: PredictedRegion[];
}

/** ringArea in device-px² — used only for enclosure/area sanity, not SF (labels
 *  carry no truth area, so no SF comparison is possible or attempted). */
function polyFrom(flood: any): Point[] | null {
  const poly = traceRegion(flood) as Point[];
  return poly.length >= 3 ? poly : null;
}

function detect(inp: SheetInputs, seedScaleFactor: number): {
  predicted: PredictedRegion[]; predictedRaw: PredictedRegion[]; labels: LabelSeed[];
} {
  const { opList, text, transform, detW, detH, OPS } = inp;
  const geom = extractVectorGeometry(opList, transform, OPS);
  const maskObj = buildMask(geom.segs, detW, detH, undefined, geom.meta);
  const detSeeds = roomLabelSeeds(text, transform);   // image-px (device) frame
  // Optionally shrink seeds toward origin for the negative control (÷2). For the
  // real run seedScaleFactor === 1 (a no-op).
  const seeds = seedScaleFactor === 1
    ? detSeeds
    : detSeeds.map((s) => ({ str: s.str, seed: [s.seed[0] * seedScaleFactor, s.seed[1] * seedScaleFactor] as [number, number] }));
  const regions = detectRegions(maskObj, seeds, SENS_BALANCED);
  const deduped = dedupeRegions(regions);
  const toPred = (rs: typeof regions): PredictedRegion[] => {
    const out: PredictedRegion[] = [];
    for (const r of rs) {
      const poly = polyFrom(r.flood);
      if (!poly) continue;
      out.push({ label: r.str, poly, seed: r.seed, area_sf: undefined });
    }
    return out;
  };
  return {
    predicted: toPred(deduped),
    predictedRaw: toPred(regions),
    labels: detSeeds.map((s) => ({ str: s.str, seed: s.seed })),
  };
}

export function runSheet(inp: SheetInputs): SheetResult {
  // ── FRAME PARITY (the anti-landmine assertion) ────────────────────────────
  // Rescale truth seeds from the LABEL frame into the DETECTION frame. For even
  // plans this is ×1.0000; for REBID it's ×0.99992 (sub-pixel). A missing 2×
  // render bug would make this ratio 0.5 or 2.0 and blow the assertion.
  const ratioW = inp.detW / inp.labelW;
  const ratioH = inp.detH / inp.labelH;
  if (Math.abs(ratioW - 1) > 0.01 || Math.abs(ratioH - 1) > 0.01) {
    throw new Error(
      `FRAME MISMATCH — detection ${inp.detW}×${inp.detH} vs label ${inp.labelW}×${inp.labelH} ` +
      `(ratio ${ratioW.toFixed(4)}×${ratioH.toFixed(4)}). An off-by-scale bug would fake every ` +
      `number. Aborting this sheet.`,
    );
  }
  const truth: RoomTruth[] = inp.truthSeeds.map((r) => ({
    number: r.number,
    seed: [r.seed[0] * ratioW, r.seed[1] * ratioH],
  }));

  const { predicted, predictedRaw, labels } = detect(inp, 1);
  const score = scoreDetection(truth, predicted, labels, { truthComplete: true });

  // ── frame-alignment PROOF (a): every found truth seed lies inside a predicted
  // poly. (found rooms are, by scoreDetection's definition, contained in a clean
  // poly — so this must equal found.length; we recompute it independently here as
  // a cross-check that the frames really coincide, not a tautology of the score.)
  let enclosedFound = 0;
  for (const t of score.found) {
    if (predicted.some((p) => pointInPoly(t.seed[0], t.seed[1], p.poly))) enclosedFound++;
  }

  // ── frame-alignment PROOF (b): NEGATIVE CONTROL. Halve the DETECTION seeds
  // (÷2) so they land in the wrong place; recall must collapse. If a broken frame
  // were silently rescaling, halving would NOT collapse recall. We score the
  // halved-seed predictions against the SAME (correct-frame) truth.
  const neg = detect(inp, 0.5);
  const negScore = scoreDetection(truth, neg.predicted, neg.labels, { truthComplete: true });
  const negControlRecall = truth.length ? negScore.found.length / truth.length : 0;

  return {
    truthCount: truth.length,
    detectedCount: predicted.length,
    detectedRawCount: predictedRaw.length,
    score,
    enclosedFound,
    ratioW, ratioH,
    negControlRecall,
    predicted,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const labelsDir = arg("--labels");
  const plansDir = arg("--plans");
  if (!labelsDir || !plansDir) {
    console.error("usage: cleanScoreDriver.ts --labels <dir/.labels> --plans <example-plans> [--json]");
    process.exit(1);
  }
  const fs = await import("node:fs");
  const pathMod = await import("node:path");
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // classify a plan filename into a plan family for the per-plan breakdown
  const family = (planFile: string): string => {
    if (/^AKMS/i.test(planFile)) return "AKMS";
    if (/^REBID/i.test(planFile)) return "REBID";
    if (/^PNB/i.test(planFile)) return "PNB-SoDo";
    if (/^TikTok/i.test(planFile)) return "TikTok";
    return "OTHER";
  };

  const labelFiles = fs.readdirSync(labelsDir).filter((f) => f.endsWith(".json"));
  const docCache = new Map<string, any>();
  const getDoc = async (file: string) => {
    if (docCache.has(file)) return docCache.get(file);
    const data = new Uint8Array(fs.readFileSync(pathMod.join(plansDir, file)));
    const doc = await pdfjs.getDocument({ data }).promise;
    docCache.set(file, doc);
    return doc;
  };

  const rows: any[] = [];
  for (const lf of labelFiles) {
    const lbl = JSON.parse(fs.readFileSync(pathMod.join(labelsDir, lf), "utf8"));
    const [planFile, pageStr] = String(lbl.plan).split("#");
    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const fam = family(planFile);
    if (fam === "OTHER") {
      if (!jsonOut) console.error(`  [skip non-real-plan] ${lf} (${planFile})`);
      continue; // exclude the synthetic sample-finish-plan fixture
    }
    let res: SheetResult;
    try {
      const doc = await getDoc(planFile);
      const pg = await doc.getPage(page);
      const vp = pg.getViewport({ scale: 2 });
      const [opList, text] = await Promise.all([pg.getOperatorList(), pg.getTextContent()]);
      res = runSheet({
        opList, text,
        transform: vp.transform,
        detW: vp.width, detH: vp.height,
        labelW: lbl.width, labelH: lbl.height,
        truthSeeds: lbl.rooms.map((r: any) => ({ seed: r.seed, number: r.number })),
        OPS: pdfjs.OPS,
      });
    } catch (e: any) {
      console.error(`  [err] ${lf}: ${e?.message || e}`);
      continue;
    }
    const s = res.score;
    const row = {
      file: lf,
      plan: fam,
      planFile, page,
      truth: res.truthCount,
      detected: res.detectedCount,
      detectedRaw: res.detectedRawCount,
      found: s.found.length,
      recall: res.truthCount ? +(s.found.length / res.truthCount).toFixed(3) : 0,
      precision: s.precision == null ? null : +s.precision.toFixed(3),
      falsePositives: s.falsePositives.length,
      underSegmented: s.underSegmented.length,
      // miss breakdown
      labellessMiss: s.labellessMisses.length,
      detectionMiss: s.detectionMisses.length,
      misplacedMiss: s.misplacedLabelMisses.length,
      // frame proof
      enclosedFound: res.enclosedFound,
      ratio: `${res.ratioW.toFixed(4)}×${res.ratioH.toFixed(4)}`,
      negControlRecall: +res.negControlRecall.toFixed(3),
    };
    rows.push(row);
    if (!jsonOut) {
      console.error(
        `${fam.padEnd(9)} p${String(page).padStart(2)} | truth=${String(row.truth).padStart(2)} ` +
        `det=${String(row.detected).padStart(2)} found=${String(row.found).padStart(2)} ` +
        `R=${row.recall.toFixed(3)} P=${row.precision == null ? "n/a" : row.precision.toFixed(3)} ` +
        `FP=${String(row.falsePositives).padStart(2)} underSeg=${row.underSegmented} | ` +
        `miss[labelless=${row.labellessMiss} detect=${row.detectionMiss} misplaced=${row.misplacedMiss}] | ` +
        `encl=${row.enclosedFound}/${row.found} negR=${row.negControlRecall.toFixed(3)}`,
      );
    }
  }

  // ── aggregate: micro-averaged (sum found / sum truth, sum found / sum detected)
  const agg = (rs: any[]) => {
    const truth = rs.reduce((a, r) => a + r.truth, 0);
    const found = rs.reduce((a, r) => a + r.found, 0);
    const detected = rs.reduce((a, r) => a + r.detected, 0);
    const fp = rs.reduce((a, r) => a + r.falsePositives, 0);
    const labelless = rs.reduce((a, r) => a + r.labellessMiss, 0);
    const detectMiss = rs.reduce((a, r) => a + r.detectionMiss, 0);
    const misplaced = rs.reduce((a, r) => a + r.misplacedMiss, 0);
    const underSeg = rs.reduce((a, r) => a + r.underSegmented, 0);
    const negFound = rs.reduce((a, r) => a + Math.round(r.negControlRecall * r.truth), 0);
    return {
      sheets: rs.length, truth, found, detected, falsePositives: fp,
      recall: truth ? +(found / truth).toFixed(3) : 0,
      precision: detected ? +(found / detected).toFixed(3) : null,
      missBreakdown: { labelless, detectMiss, misplaced },
      underSegmented: underSeg,
      negControlRecall: truth ? +(negFound / truth).toFixed(3) : 0,
    };
  };

  const byPlan: Record<string, any> = {};
  for (const fam of ["AKMS", "REBID", "PNB-SoDo", "TikTok"]) {
    const rs = rows.filter((r) => r.plan === fam);
    if (rs.length) byPlan[fam] = agg(rs);
  }
  const overall = agg(rows);

  const out = { rows, byPlan, overall };
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.error("\n=== PER-PLAN ===");
    for (const [fam, a] of Object.entries(byPlan)) {
      console.error(
        `${fam.padEnd(9)} sheets=${a.sheets} truth=${a.truth} found=${a.found} det=${a.detected} ` +
        `R=${a.recall} P=${a.precision} FP=${a.falsePositives} ` +
        `miss[labelless=${a.missBreakdown.labelless} detect=${a.missBreakdown.detectMiss}] ` +
        `underSeg=${a.underSegmented} negR=${a.negControlRecall}`,
      );
    }
    console.error("\n=== OVERALL ===");
    console.error(JSON.stringify(overall, null, 2));
    console.log(JSON.stringify(out, null, 2));
  }
}
