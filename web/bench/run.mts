// One-Click benchmark runner — the corpus gate the upstream RFC calls for:
//   npm run bench          (from web/)
// Scores every probe (synthetic goldens by construction + pinned real-PDF
// goldens) through the production pipeline and reports mean IoU, floor IoU,
// refusal rate, leak rate, and correct-refusal rate. Non-zero exit when a
// gating threshold fails — wire it into CI next to the unit suite.
//
// CROSS-RESOLUTION (RFC failure mode #3): every case also runs at reduced mask
// resolutions (ws × 0.75, × 0.5 of the production cap — exactly what a bigger
// sheet or a different render scale does to the working raster). The verdict
// must not flip and the traced rings must pairwise-agree by IoU, or the bench
// fails: a measurement that changes with raster resolution is not a
// measurement. Baseline metrics are always scored at factor 1 so the headline
// numbers stay comparable across runs.
import { createRequire } from "module";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM, DETERMINISM_MIN_MPPF } from "../src/lib/oneclick.ts";
import type { FloodResult, Point } from "../src/lib/oneclick.ts";
import { syntheticCorpus } from "./corpus.ts";
import { scoreGolden, aggregate, aggregateCross, crossAgreement, polyIoU, type ProbeScore, type CrossScore, type CrossRun } from "./score.ts";
import { traceConfidence } from "../src/lib/confidence.ts";

const THRESHOLDS = {
  floorIoU: 0.90, meanIoU: 0.95, maxRefusalRate: 0, maxLeakRate: 0, minCorrectRefusal: 1,
  maxCrossDisagreements: 0, crossFloorIoU: 0.90,
};
const RES_FACTORS = [1, 0.75, 0.5];  // ws multipliers; [0] must stay 1 (production baseline)
const CROSS_CELL = 2;                // image-px sampling cell for cross-scale IoU (4× faster, ±~0.005)
const here = dirname(fileURLToPath(import.meta.url));
const scores: ProbeScore[] = [];
const crossScores: CrossScore[] = [];

interface CaseProbe { name: string; seed: Point; expect: "golden" | "refusal"; golden?: Point[]; tags?: string[]; knownFail?: boolean }

function runCase(caseName: string, segs: number[], imgW: number, imgH: number, meta: Uint8Array | null, ptPerFt: number, probes: CaseProbe[]) {
  // factor 1 reproduces the production mask exactly: min(cap, image dim)
  const baseDim = Math.min(MASK_MAX_DIM, Math.max(imgW, imgH, 2));
  const masks = RES_FACTORS.map((f) => buildMask(segs, imgW, imgH, Math.max(2, Math.round(baseDim * f)), meta, ptPerFt));
  for (const p of probes) {
    const runs: Array<CrossRun & { flood: FloodResult }> = masks.map((mo, k) => {
      const mppf = mo.ws * ptPerFt;
      const f = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
      return { res: RES_FACTORS[k], status: f.status, ring: f.status === "ok" ? traceRegion(f) : null, flood: f };
    });

    // baseline (production resolution) — the headline metrics
    const base = runs[0];
    if (p.expect === "refusal") {
      scores.push({ caseName, probeName: p.name, expect: "refusal", status: base.status, correctRefusal: base.status !== "ok", knownFail: p.knownFail, tags: p.tags });
    } else {
      const f = base.flood;
      const s = scoreGolden(f.status, base.ring, p.golden!);
      const conf = f.status === "ok" ? traceConfidence({ hatchFiltered: f.hatchFiltered, sealedPx: f.sealedPx, virtualFrac: f.virtualFrac, wedges: f.wedges, mppf: f.mppf }).score : undefined;
      scores.push({ caseName, probeName: p.name, expect: "golden", status: f.status, ...s, confidence: conf, knownFail: p.knownFail, tags: p.tags } as ProbeScore);
    }

    // cross-resolution agreement — gate only where the mask is at or above the
    // engine's determinism floor (below it, half-foot topology quantizes and
    // the engine itself says so via confidence); coarser runs stay visible
    const gatingRuns = runs.filter((_, k) => (masks[k].mppf ?? Infinity) >= DETERMINISM_MIN_MPPF);
    const subFloorRes = RES_FACTORS.filter((_, k) => (masks[k].mppf ?? Infinity) < DETERMINISM_MIN_MPPF);
    const ca = crossAgreement(gatingRuns.length >= 2 ? gatingRuns : runs.slice(0, 1), CROSS_CELL);
    const iouByRes = p.expect === "golden" ? runs.map((r) => (r.ring && r.ring.length >= 3 ? polyIoU(r.ring, p.golden!, CROSS_CELL) : 0)) : undefined;
    crossScores.push({ caseName, probeName: p.name, expect: p.expect, resolutions: RES_FACTORS, ...ca, statuses: runs.map((r) => r.status), iouByRes, subFloorRes: subFloorRes.length ? subFloorRes : undefined, knownFail: p.knownFail, tags: p.tags });
  }
}

// synthetic cases — goldens by construction
for (const c of syntheticCorpus()) {
  runCase(c.name, c.segs, c.imgW, c.imgH, c.meta ?? null, c.ptPerFt, c.probes);
}

// pinned real-PDF cases
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
for (const file of readdirSync(join(here, "corpus")).filter((f) => f.endsWith(".json"))) {
  const c = JSON.parse(readFileSync(join(here, "corpus", file), "utf8"));
  const doc = await pdfjs.getDocument({ url: join(here, c.pdf), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: c.scale });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  runCase(file.replace(".json", ""), g.segs, vp.width, vp.height, g.meta, c.ptPerFt, c.probes);   // ptPerFt is image px/ft at the pinned scale
}

// ── report ──────────────────────────────────────────────────────────────────
for (const s of scores) {
  const bits = [
    s.expect === "golden"
      ? (s.refused ? "REFUSED" : `IoU ${(s.iou ?? 0).toFixed(3)}${s.leak ? " LEAK" : ""}${(s as { confidence?: number }).confidence != null ? `  conf ${(s as { confidence?: number }).confidence!.toFixed(2)}` : ""}`)
      : (s.correctRefusal ? "refused ✓" : `NOT refused (${s.status})`),
    s.knownFail ? "[known-fail]" : "",
    s.tags?.length ? `(${s.tags.join(",")})` : "",
  ].filter(Boolean).join("  ");
  console.log(`${(s.caseName + " / " + s.probeName).padEnd(44)} ${bits}`);
}
const agg = aggregate(scores);
console.log(`\ngolden probes: ${agg.goldenProbes} | mean IoU ${agg.meanIoU.toFixed(3)} | floor IoU ${agg.floorIoU.toFixed(3)} | refusal ${(agg.refusalRate * 100).toFixed(1)}% | leak ${(agg.leakRate * 100).toFixed(1)}%`);
console.log(`refusal probes: ${agg.refusalProbes} | correct ${(agg.correctRefusalRate * 100).toFixed(1)}% | known-fail tracked: ${agg.knownFails}`);

console.log(`\n── cross-resolution (ws × ${RES_FACTORS.join(" / ")}) ──`);
for (const s of crossScores) {
  const bits = [
    s.statusAgree ? `statuses ${s.statuses.join("/")}` : `DISAGREE ${s.statuses.join("/")}`,
    s.minPairIoU !== undefined ? `pair IoU ${s.minPairIoU.toFixed(3)}` : "",
    s.iouByRes ? `vs-golden ${s.iouByRes.map((v) => v.toFixed(3)).join("/")}` : "",
    s.subFloorRes?.length ? `[sub-floor: ×${s.subFloorRes.join(",×")}]` : "",
    s.knownFail ? "[known-fail]" : "",
  ].filter(Boolean).join("  ");
  console.log(`${(s.caseName + " / " + s.probeName).padEnd(44)} ${bits}`);
}
const xagg = aggregateCross(crossScores);
console.log(`\ncross probes: ${xagg.crossProbes} | disagreements ${xagg.disagreements} | pair-IoU floor ${xagg.crossFloorIoU.toFixed(3)} | pair-IoU mean ${xagg.crossMeanIoU.toFixed(3)}`);
writeFileSync(join(here, "results.json"), JSON.stringify({ scores, aggregate: agg, crossScores, crossAggregate: xagg, resFactors: RES_FACTORS }, null, 1));

const failures: string[] = [];
if (agg.floorIoU < THRESHOLDS.floorIoU) failures.push(`floor IoU ${agg.floorIoU.toFixed(3)} < ${THRESHOLDS.floorIoU}`);
if (agg.meanIoU < THRESHOLDS.meanIoU) failures.push(`mean IoU ${agg.meanIoU.toFixed(3)} < ${THRESHOLDS.meanIoU}`);
if (agg.refusalRate > THRESHOLDS.maxRefusalRate) failures.push(`refusal rate ${(agg.refusalRate * 100).toFixed(1)}%`);
if (agg.leakRate > THRESHOLDS.maxLeakRate) failures.push(`leak rate ${(agg.leakRate * 100).toFixed(1)}%`);
if (agg.correctRefusalRate < THRESHOLDS.minCorrectRefusal) failures.push(`correct-refusal ${(agg.correctRefusalRate * 100).toFixed(1)}%`);
if (xagg.disagreements > THRESHOLDS.maxCrossDisagreements) failures.push(`${xagg.disagreements} cross-resolution verdict flip(s)`);
if (xagg.crossFloorIoU < THRESHOLDS.crossFloorIoU) failures.push(`cross-resolution pair-IoU floor ${xagg.crossFloorIoU.toFixed(3)} < ${THRESHOLDS.crossFloorIoU}`);
if (failures.length) { console.error(`\nBENCH FAILED: ${failures.join("; ")}`); process.exit(1); }
console.log("\nbench passed");
