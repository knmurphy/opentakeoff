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
import { scoreGolden, aggregate, aggregateCross, crossAgreement, polyIoU, caseCoverage, type ProbeScore, type CrossScore, type CrossRun, type CaseCoverage } from "./score.ts";
import { traceConfidence } from "../src/lib/confidence.ts";

const THRESHOLDS = {
  floorIoU: 0.90, meanIoU: 0.95, maxRefusalRate: 0, maxLeakRate: 0, minCorrectRefusal: 1,
  maxCrossDisagreements: 0, crossFloorIoU: 0.90,
  // hard gates for HUMAN-MEASURED cases only (engine-pinned cases would gate
  // trivially against their own output; these numbers only mean something
  // when the answer key is independent):
  humanMaxSfErr: 0.025,        // any single room > 2.5% SF off fails
  humanCoverageBand: 0.02,     // Σ engine vs Σ golden within ±2% (missed/phantom floor)
  // 0.9's adjacency-tiling invariant. Unlike the two above this one is NOT
  // engine-self-referential: two probes' regions claiming the same floor is
  // double-counted SF whoever authored the answer key, so it gates every
  // whole-plan case, engine-pinned included.
  pairwiseOverlapFrac: 0.005,  // double-counted floor ≤ 0.5% of the engine total
};
// 0.2 (audit B4): the corpus is discovered by directory listing, so a deleted
// or unreadable fixture used to shrink the run silently and still exit 0 —
// 21 probes became 13 with "bench passed". Pin the expected shape.
const EXPECT = { goldenProbes: 21, refusalProbes: 3, knownFails: 4, cases: 2 };
const RES_FACTORS = [1, 0.75, 0.5];  // ws multipliers; [0] must stay 1 (production baseline)
const CROSS_CELL = 2;                // image-px sampling cell for cross-scale IoU (4× faster, ±~0.005)
const here = dirname(fileURLToPath(import.meta.url));
const scores: ProbeScore[] = [];
const crossScores: CrossScore[] = [];
const coverages: CaseCoverage[] = [];

interface CaseProbe { name: string; seed: Point; expect: "golden" | "refusal"; golden?: Point[]; tags?: string[]; knownFail?: boolean }

function runCase(caseName: string, segs: number[], imgW: number, imgH: number, meta: Uint8Array | null, ptPerFt: number, probes: CaseProbe[], humanMeasured = false, deductsSF = 0, wholePlan = false) {
  // factor 1 reproduces the production mask exactly: min(cap, image dim)
  const baseDim = Math.min(MASK_MAX_DIM, Math.max(imgW, imgH, 2));
  const masks = RES_FACTORS.map((f) => buildMask(segs, imgW, imgH, Math.max(2, Math.round(baseDim * f)), meta, ptPerFt));
  const coverRows: Array<{ golden: Point[]; ring: Point[] | null }> = [];
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
      if (!p.knownFail) coverRows.push({ golden: p.golden!, ring: base.ring });
    }

    // cross-resolution agreement — gate only where the mask is at or above the
    // engine's determinism floor (below it, half-foot topology quantizes and
    // the engine itself says so via confidence); coarser runs stay visible.
    // A case with FEWER THAN TWO gated resolutions is not cross-checked at
    // all and is reported as such — comparing a run to itself asserts
    // nothing, and pretending otherwise inflated the gate (review round 8).
    const gatingRuns = runs.filter((_, k) => (masks[k].mppf ?? Infinity) >= DETERMINISM_MIN_MPPF);
    const subFloorRes = RES_FACTORS.filter((_, k) => (masks[k].mppf ?? Infinity) < DETERMINISM_MIN_MPPF);
    const ungated = gatingRuns.length < 2;
    const ca = ungated
      ? { statuses: runs.map((r) => r.status), statusAgree: true, minPairIoU: undefined }
      : crossAgreement(gatingRuns, CROSS_CELL);
    const iouByRes = p.expect === "golden" ? runs.map((r) => (r.ring && r.ring.length >= 3 ? polyIoU(r.ring, p.golden!, CROSS_CELL) : 0)) : undefined;
    crossScores.push({ caseName, probeName: p.name, expect: p.expect, resolutions: RES_FACTORS, ...ca, statuses: runs.map((r) => r.status), iouByRes, subFloorRes: subFloorRes.length ? subFloorRes : undefined, ungated: ungated || undefined, knownFail: p.knownFail, tags: p.tags });
  }
  // whole-case accounting: per-room SF error can't see floor NO probe covers
  // or floor counted twice — the case totals and pairwise overlaps can.
  // Real-plan cases only: synthetic cases may probe ONE room from several
  // seeds, which would read as double-counted floor.
  if (wholePlan && (coverRows.length >= 2 || humanMeasured)) {
    const pxPerFt = ptPerFt;                            // golden rings are image px at the case scale
    coverages.push(caseCoverage(caseName, coverRows, pxPerFt, humanMeasured, deductsSF));
  }
}

// synthetic cases — goldens by construction
for (const c of syntheticCorpus()) {
  runCase(c.name, c.segs, c.imgW, c.imgH, c.meta ?? null, c.ptPerFt, c.probes);
}

// pinned real-PDF cases. corpus/sealed/ holds the run-once protocol cases
// (human-measured plans nobody calibrates against) — included only with
// BENCH_SEALED=1 so day-to-day runs can't overfit to them.
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
const caseFiles = readdirSync(join(here, "corpus")).filter((f) => f.endsWith(".json")).map((f) => join(here, "corpus", f));
if (process.env.BENCH_SEALED) {
  try {
    for (const f of readdirSync(join(here, "corpus", "sealed")).filter((f) => f.endsWith(".json"))) caseFiles.push(join(here, "corpus", "sealed", f));
  } catch { /* no sealed dir yet */ }
}
const realCaseNames: string[] = [];   // 0.7: which cases are engine-pinned
// 0.9: every golden that ever moved more than ±2.5% carries the reason it was
// allowed to, written into the corpus JSON by bench/pin-goldens.mts. Reprint it
// on every run — an adjudication filed once and never seen again is a note, not
// a record, and the −33% re-pin (bug #17) was invisible precisely because the
// justification lived in a commit body nobody re-read.
interface CorpusAdjudication { at?: string; scope?: string; from_sf?: number; to_sf?: number; delta_pct?: number; iou_old_new?: number; overlap_sf?: number; frac_pct?: number; reason: string }
const adjudications: Array<{ caseName: string; subject: string; a: CorpusAdjudication }> = [];
for (const file of caseFiles) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  const doc = await pdfjs.getDocument({ url: join(dirname(file), c.pdf), useSystemFonts: true }).promise;
  const page = await doc.getPage(c.page || 1);
  const vp = page.getViewport({ scale: c.scale });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  const name = file.replace(/^.*[\\/]/, "").replace(".json", "");
  if (!c.humanMeasured) realCaseNames.push(name);   // human-measured cases ARE independent truth
  for (const a of (c.adjudications ?? []) as CorpusAdjudication[]) adjudications.push({ caseName: name, subject: a.scope ?? "case", a });
  for (const p of c.probes as Array<{ name: string; adjudications?: CorpusAdjudication[] }>)
    for (const a of p.adjudications ?? []) adjudications.push({ caseName: name, subject: p.name, a });
  runCase(name, g.segs, vp.width, vp.height, g.meta, c.ptPerFt, c.probes, !!c.humanMeasured, c.deducts_sf || 0, true);   // ptPerFt is image px/ft at the pinned scale
}

// ── report ──────────────────────────────────────────────────────────────────
for (const s of scores) {
  const bits = [
    s.expect === "golden"
      ? (s.refused ? "REFUSED" : `IoU ${(s.iou ?? 0).toFixed(3)}${s.sfErr != null ? `  SF±${(s.sfErr * 100).toFixed(1)}%` : ""}${s.leak ? " LEAK" : ""}${(s as { confidence?: number }).confidence != null ? `  conf ${(s as { confidence?: number }).confidence!.toFixed(2)}` : ""}`)
      : (s.correctRefusal ? "refused ✓" : `NOT refused (${s.status})`),
    s.knownFail ? "[known-fail]" : "",
    s.tags?.length ? `(${s.tags.join(",")})` : "",
  ].filter(Boolean).join("  ");
  console.log(`${(s.caseName + " / " + s.probeName).padEnd(44)} ${bits}`);
}
if (coverages.length) {
  console.log("\n── case coverage (Σ engine vs Σ golden, double-counted floor) ──");
  for (const cv of coverages) {
    const ov = cv.sumEngineSF > 0 ? (cv.overlapSF / cv.sumEngineSF) * 100 : 0;
    console.log(`${cv.caseName.padEnd(28)} ${String(cv.probes).padStart(2)} probes | golden ${cv.sumGoldenSF.toFixed(1)} SF | engine ${cv.sumEngineSF.toFixed(1)} SF (×${cv.ratio.toFixed(3)}) | overlap ${cv.overlapSF.toFixed(2)} SF (${ov.toFixed(3)}%, gate ${THRESHOLDS.pairwiseOverlapFrac * 100}%) | worst room SF±${(cv.maxSfErr * 100).toFixed(1)}%${cv.humanMeasured ? "  [HUMAN-MEASURED — gated]" : ""}`);
  }
  // 0.9: these are whole-CASE figures. They catch floor no probe covers and
  // floor counted twice — they do NOT catch a single room losing a third of
  // its area, because 2730050 → 92c1242 did exactly that while this line would
  // have read +0.5%. The per-probe rule in bench/pin-goldens.mts is that guard.
  console.log("  (whole-case figures — a per-ROOM regression can hide inside them; see bench/pin-goldens.mts)");
}
if (adjudications.length) {
  console.log("\n── re-pin adjudications on record (bench/pin-goldens.mts, task 0.9) ──");
  for (const { caseName, subject, a } of adjudications) {
    const move = a.from_sf != null ? `${a.from_sf.toFixed(2)} → ${a.to_sf!.toFixed(2)} SF (${a.delta_pct}%${a.iou_old_new != null ? `, IoU ${a.iou_old_new.toFixed(3)}` : ""})` : a.overlap_sf != null ? `${a.overlap_sf} SF overlap (${a.frac_pct}%)` : "";
    console.log(`  ${(caseName + " / " + subject).padEnd(42)} ${a.at ?? ""} ${move}\n      ↳ ${a.reason}`);
  }
}
const agg = aggregate(scores);

// 0.7 (audit B1): NEVER print a blended accuracy figure again. 12 of the 21
// gating goldens are the engine graded against its own frozen output and score
// ~1.000 by construction; the 9 synthetic probes carry truth independent of the
// engine. A single mean over both buckets reads as accuracy and is not.
const PINNED_CASES = new Set(realCaseNames);
const synth = aggregate(scores.filter((s) => !PINNED_CASES.has(s.caseName)));
const pinned = aggregate(scores.filter((s) => PINNED_CASES.has(s.caseName)));
console.log(`\nsynthetic (truth by construction — the only independent signal):`);
console.log(`  n=${synth.goldenProbes} | mean IoU ${synth.meanIoU.toFixed(3)} | floor IoU ${synth.floorIoU.toFixed(3)}`);
console.log(`engine-pinned (REGRESSION SAFETY ONLY — not accuracy; these are the engine's own past output):`);
console.log(`  n=${pinned.goldenProbes} | mean IoU ${pinned.meanIoU.toFixed(3)} | floor IoU ${pinned.floorIoU.toFixed(3)}`);
console.log(`\ngolden probes: ${agg.goldenProbes} | mean IoU ${agg.meanIoU.toFixed(3)} | floor IoU ${agg.floorIoU.toFixed(3)} | refusal ${(agg.refusalRate * 100).toFixed(1)}% | leak ${(agg.leakRate * 100).toFixed(1)}% (gating aggregate — see the split above before quoting the mean)`);
console.log(`refusal probes: ${agg.refusalProbes} (all synthetic) | correct ${agg.refusalProbes ? (agg.correctRefusalRate * 100).toFixed(1) + "%" : "n/a"} | known-fail tracked: ${agg.knownFails}`);

// 0.4 (audit B3): known-fails are excluded from every aggregate, so a probe that
// is actively failing right now is invisible in the summary. Print them.
const kf = scores.filter((s) => s.knownFail);
if (kf.length) {
  console.log(`\n── known-fails (EXCLUDED from every metric above) ──`);
  for (const s of kf) {
    const verdict = s.expect === "refusal"
      ? (s.refused ? "correctly refuses" : "*** NOT REFUSED — actively failing ***")
      : `IoU ${s.iou.toFixed(3)} SF±${(s.sfErr * 100).toFixed(1)}%${s.leak ? " LEAK" : ""}`;
    console.log(`  ${(s.caseName + " / " + s.probeName).padEnd(42)} ${verdict}`);
  }
}

console.log(`\n── cross-resolution (ws × ${RES_FACTORS.join(" / ")}) ──`);
for (const s of crossScores) {
  const bits = [
    s.ungated ? `statuses ${s.statuses.join("/")}` : (s.statusAgree ? `statuses ${s.statuses.join("/")}` : `DISAGREE ${s.statuses.join("/")}`),
    s.minPairIoU !== undefined ? `pair IoU ${s.minPairIoU.toFixed(3)}` : "",
    s.iouByRes ? `vs-golden ${s.iouByRes.map((v) => v.toFixed(3)).join("/")}` : "",
    s.ungated ? "[NO GATED PAIR — not cross-checked]" : "",
    s.subFloorRes?.length ? `[sub-floor: ×${s.subFloorRes.join(",×")}]` : "",
    s.knownFail ? "[known-fail]" : "",
  ].filter(Boolean).join("  ");
  console.log(`${(s.caseName + " / " + s.probeName).padEnd(44)} ${bits}`);
}
const xagg = aggregateCross(crossScores);
console.log(`\ncross probes: ${xagg.crossProbes} | disagreements ${xagg.disagreements} | pair-IoU floor ${xagg.crossFloorIoU.toFixed(3)} | pair-IoU mean ${xagg.crossMeanIoU.toFixed(3)}${xagg.ungated ? ` | NOT cross-checked (single gated resolution): ${xagg.ungated}` : ""}`);
writeFileSync(join(here, "results.json"), JSON.stringify({ scores, aggregate: agg, coverages, crossScores, crossAggregate: xagg, resFactors: RES_FACTORS }, null, 1));

const failures: string[] = [];
for (const cv of coverages) {
  // 0.9: adjacency tiling gates every whole-plan case (see THRESHOLDS above).
  if (cv.sumEngineSF > 0 && cv.overlapSF > cv.sumEngineSF * THRESHOLDS.pairwiseOverlapFrac) failures.push(`${cv.caseName}: ${cv.overlapSF.toFixed(1)} SF double-counted (> ${THRESHOLDS.pairwiseOverlapFrac * 100}% of total)`);
  if (!cv.humanMeasured) continue;                     // the rest gate human-measured cases only
  if (cv.maxSfErr > THRESHOLDS.humanMaxSfErr) failures.push(`${cv.caseName}: worst room SF error ${(cv.maxSfErr * 100).toFixed(1)}% > ${THRESHOLDS.humanMaxSfErr * 100}%`);
  if (Math.abs(cv.ratio - 1) > THRESHOLDS.humanCoverageBand) failures.push(`${cv.caseName}: engine total ×${cv.ratio.toFixed(3)} of the human total (band ±${THRESHOLDS.humanCoverageBand * 100}%)`);
}
// 0.2: a shrinking corpus must be loud, not green.
if (caseFiles.length !== EXPECT.cases && !process.env.BENCH_SEALED) failures.push(`expected ${EXPECT.cases} corpus case files, found ${caseFiles.length}`);
if (agg.goldenProbes !== EXPECT.goldenProbes) failures.push(`expected ${EXPECT.goldenProbes} golden probes, found ${agg.goldenProbes} — a fixture was added or lost`);
if (agg.refusalProbes !== EXPECT.refusalProbes) failures.push(`expected ${EXPECT.refusalProbes} refusal probes, found ${agg.refusalProbes}`);
if (agg.knownFails !== EXPECT.knownFails) failures.push(`expected ${EXPECT.knownFails} known-fails, found ${agg.knownFails} — re-pin EXPECT deliberately`);
// 0.3 (audit B3): nothing checked that a known-fail still fails, so a fixed
// limitation could silently re-break, and any regression could be neutralised
// with one knownFail:true. A known-fail that passes is a result, not a pass.
for (const s of scores) {
  if (!s.knownFail) continue;
  if (s.expect === "refusal" && s.refused) failures.push(`known-fail ${s.caseName}/${s.probeName} now REFUSES correctly — re-pin it or drop the flag`);
  if (s.expect === "golden" && s.iou >= THRESHOLDS.floorIoU && !s.leak) failures.push(`known-fail ${s.caseName}/${s.probeName} now passes (IoU ${s.iou.toFixed(3)}) — re-pin it or drop the flag`);
}
if (agg.floorIoU < THRESHOLDS.floorIoU) failures.push(`floor IoU ${agg.floorIoU.toFixed(3)} < ${THRESHOLDS.floorIoU}`);
if (agg.meanIoU < THRESHOLDS.meanIoU) failures.push(`mean IoU ${agg.meanIoU.toFixed(3)} < ${THRESHOLDS.meanIoU}`);
if (agg.refusalRate > THRESHOLDS.maxRefusalRate) failures.push(`refusal rate ${(agg.refusalRate * 100).toFixed(1)}%`);
// 0.5 (audit B5): maxLeakRate can never be the binding gate — leak is defined as
// IoU < 0.5 AND area > 1.5×, and any IoU < 0.5 already fails floorIoU 0.90. It is
// kept as a diagnostic, not reported as independent evidence.
if (agg.leakRate > THRESHOLDS.maxLeakRate) failures.push(`leak rate ${(agg.leakRate * 100).toFixed(1)}% (diagnostic — floorIoU should already have fired)`);
if (agg.correctRefusalRate < THRESHOLDS.minCorrectRefusal) failures.push(`correct-refusal ${(agg.correctRefusalRate * 100).toFixed(1)}%`);
if (xagg.disagreements > THRESHOLDS.maxCrossDisagreements) failures.push(`${xagg.disagreements} cross-resolution verdict flip(s)`);
if (xagg.crossFloorIoU < THRESHOLDS.crossFloorIoU) failures.push(`cross-resolution pair-IoU floor ${xagg.crossFloorIoU.toFixed(3)} < ${THRESHOLDS.crossFloorIoU}`);
if (failures.length) { console.error(`\nBENCH FAILED: ${failures.join("; ")}`); process.exit(1); }
console.log("\nbench passed");
