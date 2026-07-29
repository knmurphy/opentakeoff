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
//
// AUDIT A5b — WHAT THIS BENCH MEASURES. Production does not return
// `traceRegion(f)`. Every vector One-Click ring in the product is trace-THEN-
// SNAP (corners pulled onto true PDF vertices) and `area_sf` comes off the
// SNAPPED ring. This file used to call bare `traceRegion` and never imported
// `snapVertices` at all, so every number it printed — and every engine-pinned
// golden it graded against — was a quantity the product never returns
// (enclosed-room: bench 117.568 SF, product 120.000, which
// e2e/one-click.e2e.cjs independently confirms through real Chromium). Both the
// bench and bench/pin-goldens.mts now go through `oneClickRing`, the single
// shared composition in src/lib/oneclick.ts.
//
// The snap costs the corpus something, so it is bought back explicitly: pulling
// corners onto exact vertices makes the synthetic probes' rings identical
// across mask resolutions, which would have turned the 9 truth-by-construction
// probes into ~1.000-by-construction and voided the cross-resolution signal on
// them. So every probe is ALSO traced un-snapped, and that reading is reported
// as MASK FIDELITY (ungated) beside the production one — rasterisation error
// stays visible, it just stops being mistaken for the product's accuracy.
import { createRequire } from "module";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, oneClickRing, snapNearest, MASK_MAX_DIM, DETERMINISM_MIN_MPPF } from "../src/lib/oneclick.ts";
import type { FloodResult, Point, NearestFn } from "../src/lib/oneclick.ts";
import { syntheticCorpus, WALL_SEMANTICS } from "./corpus.ts";
import { scoreGolden, aggregate, aggregateCross, crossAgreement, polyIoU, ringAreaAbs, caseCoverage, confidenceGate, humanSfGate, seedPairGate, CONF_GATE, CONF_GATE_EXEMPT, type ProbeScore, type CrossScore, type CrossRun, type CaseCoverage, type HumanSfRow, type SeedPairRow } from "./score.ts";
import { traceConfidence, floodSignals } from "../src/lib/confidence.ts";

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
// Re-pinned 2026-07-28 (corridor cases): +2 gating corridor goldens
// (corridor-min-pass-segment, corridor-dashed-boundary), +1 known-fail
// (corridor-open-ends — the VA annexation failure, tracked for item A).
// Re-pinned again 2026-07-28 (seed-instability + human-SF rows): +1 gating
// engine-pinned corridor golden (va-finish-plan/t1-corridor), +1 seed-pair
// stability row, +2 human-SF reference rows (SF-only hand truth, known-fail).
const EXPECT = { goldenProbes: 24, refusalProbes: 3, knownFails: 5, cases: 2, humanSfRows: 2, seedPairs: 1 };
const RES_FACTORS = [1, 0.75, 0.5];  // ws multipliers; [0] must stay 1 (production baseline)
const CROSS_CELL = 2;                // image-px sampling cell for cross-scale IoU (4× faster, ±~0.005)
const here = dirname(fileURLToPath(import.meta.url));
const scores: ProbeScore[] = [];
const crossScores: CrossScore[] = [];
const coverages: CaseCoverage[] = [];
const humanRows: HumanSfRow[] = [];
const pairRows: SeedPairRow[] = [];

interface CaseProbe { name: string; seed: Point; expect: "golden" | "refusal"; golden?: Point[]; tags?: string[]; knownFail?: boolean; shapeClass?: string }

// Task-1 (corridor work): every golden probe must declare its metric shape
// class, and a probe tagged "corridor" may not claim another class — a
// misclassified probe silently launders its failures into another class's mean.
const classFailures: string[] = [];

/** Un-snapped reading of a probe, kept beside the production one. */
interface MaskFidelity { caseName: string; probeName: string; iou: number; sfErr: number; prodIou: number; prodSfErr: number; minPairIoU?: number; knownFail?: boolean }
const fidelity: MaskFidelity[] = [];

function runCase(caseName: string, segs: number[], points: Point[], imgW: number, imgH: number, meta: Uint8Array | null, ptPerFt: number, probes: CaseProbe[], humanMeasured = false, deductsSF = 0, wholePlan = false) {
  // factor 1 reproduces the production mask exactly: min(cap, image dim)
  const baseDim = Math.min(MASK_MAX_DIM, Math.max(imgW, imgH, 2));
  const masks = RES_FACTORS.map((f) => buildMask(segs, imgW, imgH, Math.max(2, Math.round(baseDim * f)), meta, ptPerFt));
  // A5b: the snap grid is built from op-list vertices in IMAGE px, so it is the
  // same object at every mask resolution — exactly as in production, where the
  // canvas caches one grid per sheet independent of the working raster.
  const nearest: NearestFn = snapNearest(points);
  const coverRows: Array<{ golden: Point[]; ring: Point[] | null }> = [];
  for (const p of probes) {
    const runs: Array<CrossRun & { flood: FloodResult; rawRing: Point[] | null }> = masks.map((mo, k) => {
      const mppf = mo.ws * ptPerFt;
      const f = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
      return {
        res: RES_FACTORS[k], status: f.status, flood: f,
        // `ring` is THE PRODUCTION RING — traced and snapped, the thing the
        // product puts on screen and in area_sf. Everything gating reads it.
        ring: f.status === "ok" ? oneClickRing(f, { nearest }) : null,
        // ...and the un-snapped trace, for the mask-fidelity report only.
        rawRing: f.status === "ok" ? traceRegion(f) : null,
      };
    });

    // baseline (production resolution) — the headline metrics
    const base = runs[0];
    // A2: confidence for EVERY probe that traced, refusal probes included.
    // It used to be computed only in the golden branch, so the four refusal
    // probes reported none — which put va-finish-plan/open-margin (a real-plan
    // probe that traces 23,831 SF of sheet margin instead of refusing) outside
    // any confidence gate at all. The signal set is the WHOLE FloodResult; a
    // caller that drops a field silently disables that deduction.
    const conf = (f: FloodResult, ring: Point[] | null) => (f.status !== "ok" ? undefined : traceConfidence(floodSignals(f, {
      areaSF: ring && ring.length >= 3 ? ringAreaAbs(ring) / (ptPerFt * ptPerFt) : undefined,
    })).score);
    if (p.expect === "golden" && !p.shapeClass) classFailures.push(`${caseName}/${p.name}: golden probe missing shapeClass`);
    if (p.expect === "golden" && p.tags?.includes("corridor") && p.shapeClass !== "corridor") classFailures.push(`${caseName}/${p.name}: tagged corridor but shapeClass=${p.shapeClass}`);
    if (p.expect === "refusal") {
      scores.push({ caseName, probeName: p.name, expect: "refusal", status: base.status, correctRefusal: base.status !== "ok", confidence: conf(base.flood, base.ring), knownFail: p.knownFail, tags: p.tags, shapeClass: p.shapeClass });
    } else {
      const f = base.flood;
      const s = scoreGolden(f.status, base.ring, p.golden!);
      scores.push({ caseName, probeName: p.name, expect: "golden", status: f.status, ...s, confidence: conf(f, base.ring), knownFail: p.knownFail, tags: p.tags, shapeClass: p.shapeClass } as ProbeScore);
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

    // ── MASK FIDELITY (A5b) — the same probe read UN-SNAPPED ─────────────────
    // Reported, never gated. Snapping pulls corners onto exact PDF vertices, so
    // a snapped ring can be byte-identical across resolutions while the
    // underlying raster contour is not — which is precisely how a corpus loses
    // its rasterisation signal without anyone noticing. This row is what keeps
    // that error on screen: the un-snapped IoU/SF error vs the same golden, and
    // the un-snapped cross-resolution pair-IoU beside the snapped one.
    if (p.expect === "golden" && base.rawRing && base.rawRing.length >= 3) {
      const ag = ringAreaAbs(p.golden!);
      const rawRuns = runs.filter((r) => r.rawRing && r.rawRing.length >= 3);
      let rawPair: number | undefined;
      if (!ungated) {
        const gatedRaw = rawRuns.filter((r) => (masks[RES_FACTORS.indexOf(r.res)].mppf ?? Infinity) >= DETERMINISM_MIN_MPPF);
        for (let i = 0; i < gatedRaw.length; i++)
          for (let j = i + 1; j < gatedRaw.length; j++) {
            const v = polyIoU(gatedRaw[i].rawRing!, gatedRaw[j].rawRing!, CROSS_CELL);
            if (rawPair === undefined || v < rawPair) rawPair = v;
          }
      }
      fidelity.push({
        caseName, probeName: p.name,
        iou: polyIoU(base.rawRing, p.golden!),
        sfErr: ag > 0 ? Math.abs(ringAreaAbs(base.rawRing) - ag) / ag : 0,
        prodIou: base.ring && base.ring.length >= 3 ? polyIoU(base.ring, p.golden!) : 0,
        prodSfErr: ag > 0 && base.ring && base.ring.length >= 3 ? Math.abs(ringAreaAbs(base.ring) - ag) / ag : 1,
        minPairIoU: rawPair,
        knownFail: p.knownFail,
      });
    }
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
  runCase(c.name, c.segs, c.points, c.imgW, c.imgH, c.meta ?? null, c.ptPerFt, c.probes);
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
const caseSemanticsFailures: string[] = [];
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
  // A5b: a corpus case that does not declare its wall-line semantics cannot be
  // read (centreline vs interior-clear is a ~1.6% difference on the sample plan
  // and 8.5% on a narrow band). Loud, not assumed.
  if (c.wallSemantics !== WALL_SEMANTICS) caseSemanticsFailures.push(`${name}: wallSemantics is ${JSON.stringify(c.wallSemantics ?? null)} — the corpus is pinned "${WALL_SEMANTICS}" (see bench/corpus.ts)`);
  runCase(name, g.segs, g.points, vp.width, vp.height, g.meta, c.ptPerFt, c.probes, !!c.humanMeasured, c.deducts_sf || 0, true);   // ptPerFt is image px/ft at the pinned scale

  // ── auxiliary SF rows (no golden polygon): human-SF reference + seed-pair
  // stability. Both flood the PRODUCTION path (factor-1 mask, trace+snap) and
  // are gated by the pure functions in score.ts. Fields are optional per case;
  // the EXPECT counts below keep an absent field from vanishing silently.
  const auxHuman = (c.humanSfProbes ?? []) as Array<{ name: string; seed: Point; hand_sf: number; knownFail?: boolean }>;
  const auxPairs = (c.seedPairs ?? []) as Array<{ name: string; seedA: Point; seedB: Point; knownFail?: boolean; xpassRatio: number }>;
  if (auxHuman.length || auxPairs.length) {
    const mo = buildMask(g.segs, vp.width, vp.height, Math.min(MASK_MAX_DIM, Math.max(vp.width, vp.height, 2)), g.meta, c.ptPerFt);
    const mppf = mo.ws * c.ptPerFt;
    const nearest = snapNearest(g.points);
    const sfAt = (s: Point): number | null => {
      const f = floodRegionSealed(mo, s[0], s[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
      if (f.status !== "ok") return null;
      const ring = oneClickRing(f, { nearest });
      return ring && ring.length >= 3 ? ringAreaAbs(ring) / (c.ptPerFt * c.ptPerFt) : null;
    };
    for (const h of auxHuman) humanRows.push({ probe: `${name}/${h.name}`, handSF: h.hand_sf, engineSF: sfAt(h.seed), knownFail: h.knownFail });
    for (const p of auxPairs) pairRows.push({ pair: `${name}/${p.name}`, sfA: sfAt(p.seedA), sfB: sfAt(p.seedB), knownFail: p.knownFail, xpassRatio: p.xpassRatio });
  }
}

// ── report ──────────────────────────────────────────────────────────────────
for (const s of scores) {
  const bits = [
    s.expect === "golden"
      ? (s.refused ? "REFUSED" : `IoU ${(s.iou ?? 0).toFixed(3)}${s.sfErr != null ? `  SF±${(s.sfErr * 100).toFixed(1)}%` : ""}${s.leak ? " LEAK" : ""}${(s as { confidence?: number }).confidence != null ? `  conf ${(s as { confidence?: number }).confidence!.toFixed(2)}` : ""}`)
      : (s.correctRefusal ? "refused ✓" : `NOT refused (${s.status})${s.confidence != null ? `  conf ${s.confidence.toFixed(2)}` : ""}`),
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

// ── MASK FIDELITY (A5b) — printed BEFORE the headline, on purpose ───────────
// The synthetic goldens are still independent of the engine (linework and
// golden come from the same authored numbers), but since A5b the engine's ring
// is SNAPPED onto those very numbers, so a synthetic probe scores ~1.000
// whenever its golden corners are drawn vertices — by construction OF THE SNAP,
// not by the raster getting them right. That is what the product returns and it
// is the right thing to gate; it is NOT a measurement of how well the flood
// approximates the room. This block is the measurement that still is.
const fidGate = fidelity.filter((f) => !f.knownFail);
const fidMeanIoU = fidGate.length ? fidGate.reduce((a, f) => a + f.iou, 0) / fidGate.length : 1;
const fidFloorIoU = fidGate.length ? Math.min(...fidGate.map((f) => f.iou)) : 1;
const fidWorstSf = fidGate.length ? Math.max(...fidGate.map((f) => f.sfErr)) : 0;
const fidPairs = fidGate.map((f) => f.minPairIoU).filter((v): v is number => v !== undefined);
console.log(`\n── mask fidelity: the SAME probes traced UN-SNAPPED (REPORTED, NOT GATED) ──`);
console.log(`   ${"probe".padEnd(42)} ${"raw IoU".padStart(8)} ${"raw SF±".padStart(9)}   ${"prod IoU".padStart(8)} ${"prod SF±".padStart(9)}   raw x-res pair IoU`);
for (const f of fidelity) {
  console.log(`   ${(f.caseName + " / " + f.probeName).padEnd(42)} ${f.iou.toFixed(3).padStart(8)} ${(`${(f.sfErr * 100).toFixed(2)}%`).padStart(9)}   ${f.prodIou.toFixed(3).padStart(8)} ${(`${(f.prodSfErr * 100).toFixed(2)}%`).padStart(9)}   ${f.minPairIoU !== undefined ? f.minPairIoU.toFixed(3) : "—"}${f.knownFail ? "  [known-fail]" : ""}`);
}
console.log(`   raw (rasterisation only, known-fails excluded): n=${fidGate.length} | mean IoU ${fidMeanIoU.toFixed(3)} | floor IoU ${fidFloorIoU.toFixed(3)} | worst SF ${(fidWorstSf * 100).toFixed(2)}%`);
console.log(`   raw cross-resolution pair-IoU floor: ${fidPairs.length ? Math.min(...fidPairs).toFixed(3) : "n/a"} (${fidPairs.length} probe(s) with ≥2 gated resolutions)`);
console.log(`   ↑ this is the rasterisation error the snap hides. It is deliberately UNGATED: the`);
console.log(`     product ships the snapped ring, so gating the raw one would gate a quantity nobody buys.`);

console.log(`\nsynthetic — PRODUCTION RINGS (trace+snap) vs goldens authored from the same numbers.`);
console.log(`  Independent of the engine's own past output, but NOT a raw accuracy figure: the snap`);
console.log(`  lands corners on the authored vertices, so this says "the flood found the right drawn`);
console.log(`  boundary", not "the raster is this good" — for that, read mask fidelity above.`);
console.log(`  n=${synth.goldenProbes} | mean IoU ${synth.meanIoU.toFixed(3)} | floor IoU ${synth.floorIoU.toFixed(3)}  [wall semantics: ${WALL_SEMANTICS}]`);
console.log(`engine-pinned (REGRESSION SAFETY ONLY — not accuracy; these are the engine's own past output):`);
console.log(`  n=${pinned.goldenProbes} | mean IoU ${pinned.meanIoU.toFixed(3)} | floor IoU ${pinned.floorIoU.toFixed(3)}`);
console.log(`by shape class × provenance (accuracy = synthetic only; engine-pinned = regression-only):`);
const classes = [...new Set(scores.filter((s) => s.expect === "golden").map((s) => s.shapeClass!))].sort();
const byClass: Record<string, { synthetic: ReturnType<typeof aggregate>; enginePinned: ReturnType<typeof aggregate>; knownFails: string[] }> = {};
const fmtCls = (a: ReturnType<typeof aggregate>): string =>
  a.goldenProbes === 0 ? "n=0 gating — NO accuracy claim"
  : a.goldenProbes === 1 ? `n=1 (single observation) IoU ${a.meanIoU.toFixed(3)}`
  : `n=${a.goldenProbes} | mean IoU ${a.meanIoU.toFixed(3)} | floor ${a.floorIoU.toFixed(3)}`;
for (const cls of classes) {
  const inCls = scores.filter((s) => s.shapeClass === cls);
  const synthCls = aggregate(inCls.filter((s) => !PINNED_CASES.has(s.caseName)));
  const pinnedCls = aggregate(inCls.filter((s) => PINNED_CASES.has(s.caseName)));
  const kf = inCls.filter((s) => s.knownFail).map((s) => `${s.caseName}/${s.probeName}`);
  byClass[cls] = { synthetic: synthCls, enginePinned: pinnedCls, knownFails: kf };
  console.log(`  ${cls.padEnd(9)} accuracy(synthetic): ${fmtCls(synthCls)}`);
  if (pinnedCls.goldenProbes) console.log(`  ${"".padEnd(9)} regression(pinned):  ${fmtCls(pinnedCls)} — self-graded, NOT accuracy`);
  if (kf.length) console.log(`  ${"".padEnd(9)} known-fail: ${kf.join(", ")}`);
}
console.log(`\ngolden probes: ${agg.goldenProbes} | mean IoU ${agg.meanIoU.toFixed(3)} | floor IoU ${agg.floorIoU.toFixed(3)} | refusal ${(agg.refusalRate * 100).toFixed(1)}% | leak ${(agg.leakRate * 100).toFixed(1)}% (blended across provenance AND shape class — quote the splits above, never this line alone)`);
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
// ── human-SF reference rows + seed-pair stability (see score.ts) ────────────
// Hand SF is WALL-TO-WALL; the engine measures the snapped CENTERLINE ring —
// a 3–11% convention gap on corridors, wider than the 2.5% band. So these rows
// are knownFail and the gate is xpass-only: NOT a binding human-truth gate yet.
const hres = humanSfGate(humanRows, THRESHOLDS.humanMaxSfErr);
const pres = seedPairGate(pairRows);
if (hres.rows.length) {
  console.log(`\n── human-measured SF reference rows (SF-only hand truth; convention-UNMATCHED: hand wall-to-wall vs engine centerline — xpass-monitored, not binding) ──`);
  for (const r of hres.rows)
    console.log(`  ${r.probe.padEnd(42)} hand ${r.handSF.toFixed(1)} SF | engine ${r.engineSF != null ? r.engineSF.toFixed(1) + " SF" : "NO TRACE"}${r.errFrac != null ? ` (${r.engineSF! >= r.handSF ? "+" : "−"}${(r.errFrac * 100).toFixed(1)}%)` : ""}${r.knownFail ? "  [known-fail]" : ""}`);
}
if (pres.rows.length) {
  console.log(`\n── seed-pair stability (two clicks in the SAME space must agree) ──`);
  for (const r of pres.rows)
    console.log(`  ${r.pair.padEnd(42)} ${r.sfA != null ? r.sfA.toFixed(1) : "refused"} vs ${r.sfB != null ? r.sfB.toFixed(1) : "refused"} SF${r.ratio != null ? ` — ${r.ratio.toFixed(2)}× (xpass < ${r.xpassRatio}×)` : ""}${r.knownFail ? "  [known-fail]" : ""}`);
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
// ── confidence vs error (audit A2's anti-correlation gate) ──────────────────
// Evaluated over EVERY probe, known-fails included — see confidenceGate.
const cgate = confidenceGate(scores);
console.log(`\n── confidence vs SF error (gate: >${CONF_GATE.ceilSfErr * 100}% SF ⇒ conf ≤ ${CONF_GATE.ceilConf}; ≤${CONF_GATE.floorSfErr * 100}% SF ⇒ conf ≥ median-of-inaccurate + ${CONF_GATE.floorMargin}, and ≥ ${CONF_GATE.floorAbs}) ──`);
console.log(`  INACCURATE (n=${cgate.inaccurate.length}, median conf ${cgate.medianInaccurate?.toFixed(2) ?? "n/a"}):`);
for (const p of cgate.inaccurate) console.log(`    ${p.probe.padEnd(40)} conf ${p.confidence.toFixed(2)}   ${p.why}`);
console.log(`  ACCURATE   (n=${cgate.accurate.length}, worst conf ${cgate.minAccurate?.toFixed(2) ?? "n/a"}):`);
for (const p of [...cgate.accurate].sort((a, b) => a.confidence - b.confidence)) console.log(`    ${p.probe.padEnd(40)} conf ${p.confidence.toFixed(2)}`);
for (const p of cgate.exempt) {
  const x = CONF_GATE_EXEMPT[p.probe];
  const dir = [
    x.xfailAbove != null ? `must stay > ${x.xfailAbove}` : "",
    x.xfailAtMost != null ? `must stay ≤ ${x.xfailAtMost}` : "",
    x.xfailEquals != null ? `must stay EQUAL to ${x.xfailEquals}` : "",
  ].filter(Boolean).join("; ");
  console.log(`  EXEMPT     ${p.probe.padEnd(40)} conf ${p.confidence?.toFixed(2) ?? "n/a"}  (xfail: ${dir})`);
  console.log(`      ↳ ${x.reason}`);
}

writeFileSync(join(here, "results.json"), JSON.stringify({ scores, aggregate: agg, split: { synthetic: synth, enginePinned: pinned, byClass }, coverages, humanSf: hres.rows, seedPairs: pres.rows, crossScores, crossAggregate: xagg, confidenceGate: cgate, resFactors: RES_FACTORS, wallSemantics: WALL_SEMANTICS, maskFidelity: { probes: fidelity, meanIoU: fidMeanIoU, floorIoU: fidFloorIoU, worstSfErr: fidWorstSf, crossFloorIoU: fidPairs.length ? Math.min(...fidPairs) : null, gated: false } }, null, 1));

const failures: string[] = [...caseSemanticsFailures, ...classFailures];
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
if (humanRows.length !== EXPECT.humanSfRows) failures.push(`expected ${EXPECT.humanSfRows} human-SF rows, found ${humanRows.length} — a humanSfProbes field was added or lost`);
if (pairRows.length !== EXPECT.seedPairs) failures.push(`expected ${EXPECT.seedPairs} seed-pair rows, found ${pairRows.length} — a seedPairs field was added or lost`);
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
failures.push(...cgate.failures, ...hres.failures, ...pres.failures);
if (failures.length) { console.error(`\nBENCH FAILED: ${failures.join("; ")}`); process.exit(1); }
console.log("\nbench passed");
