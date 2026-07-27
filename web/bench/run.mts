// One-Click benchmark runner — the corpus gate the upstream RFC calls for:
//   npm run bench          (from web/)
// Scores every probe (synthetic goldens by construction + pinned real-PDF
// goldens) through the production pipeline and reports mean IoU, floor IoU,
// refusal rate, leak rate, and correct-refusal rate. Non-zero exit when a
// gating threshold fails — wire it into CI next to the unit suite.
import { createRequire } from "module";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, traceRegion, MASK_MAX_DIM } from "../src/lib/oneclick.ts";
import type { MaskObj, Point } from "../src/lib/oneclick.ts";
import { syntheticCorpus } from "./corpus.ts";
import { scoreGolden, aggregate, type ProbeScore } from "./score.ts";

const THRESHOLDS = { floorIoU: 0.90, meanIoU: 0.95, maxRefusalRate: 0, maxLeakRate: 0, minCorrectRefusal: 1 };
const here = dirname(fileURLToPath(import.meta.url));
const scores: ProbeScore[] = [];

function runProbes(caseName: string, mo: MaskObj, ptPerFt: number, probes: Array<{ name: string; seed: Point; expect: "golden" | "refusal"; golden?: Point[]; tags?: string[]; knownFail?: boolean }>) {
  const mppf = mo.ws * ptPerFt;
  for (const p of probes) {
    const f = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf));
    if (p.expect === "refusal") {
      scores.push({ caseName, probeName: p.name, expect: "refusal", status: f.status, correctRefusal: f.status !== "ok", knownFail: p.knownFail, tags: p.tags });
      continue;
    }
    const traced = f.status === "ok" ? traceRegion(f) : null;
    const s = scoreGolden(f.status, traced, p.golden!);
    scores.push({ caseName, probeName: p.name, expect: "golden", status: f.status, ...s, knownFail: p.knownFail, tags: p.tags });
  }
}

// synthetic cases — goldens by construction
for (const c of syntheticCorpus()) {
  const mo = buildMask(c.segs, c.imgW, c.imgH, MASK_MAX_DIM, c.meta ?? null);
  runProbes(c.name, mo, c.ptPerFt, c.probes);
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
  const mo = buildMask(g.segs, vp.width, vp.height, MASK_MAX_DIM, g.meta);
  runProbes(file.replace(".json", ""), mo, c.ptPerFt, c.probes);   // ptPerFt is image px/ft at the pinned scale
}

// ── report ──────────────────────────────────────────────────────────────────
for (const s of scores) {
  const bits = [
    s.expect === "golden"
      ? (s.refused ? "REFUSED" : `IoU ${(s.iou ?? 0).toFixed(3)}${s.leak ? " LEAK" : ""}`)
      : (s.correctRefusal ? "refused ✓" : `NOT refused (${s.status})`),
    s.knownFail ? "[known-fail]" : "",
    s.tags?.length ? `(${s.tags.join(",")})` : "",
  ].filter(Boolean).join("  ");
  console.log(`${(s.caseName + " / " + s.probeName).padEnd(44)} ${bits}`);
}
const agg = aggregate(scores);
console.log(`\ngolden probes: ${agg.goldenProbes} | mean IoU ${agg.meanIoU.toFixed(3)} | floor IoU ${agg.floorIoU.toFixed(3)} | refusal ${(agg.refusalRate * 100).toFixed(1)}% | leak ${(agg.leakRate * 100).toFixed(1)}%`);
console.log(`refusal probes: ${agg.refusalProbes} | correct ${(agg.correctRefusalRate * 100).toFixed(1)}% | known-fail tracked: ${agg.knownFails}`);
writeFileSync(join(here, "results.json"), JSON.stringify({ scores, aggregate: agg }, null, 1));

const failures: string[] = [];
if (agg.floorIoU < THRESHOLDS.floorIoU) failures.push(`floor IoU ${agg.floorIoU.toFixed(3)} < ${THRESHOLDS.floorIoU}`);
if (agg.meanIoU < THRESHOLDS.meanIoU) failures.push(`mean IoU ${agg.meanIoU.toFixed(3)} < ${THRESHOLDS.meanIoU}`);
if (agg.refusalRate > THRESHOLDS.maxRefusalRate) failures.push(`refusal rate ${(agg.refusalRate * 100).toFixed(1)}%`);
if (agg.leakRate > THRESHOLDS.maxLeakRate) failures.push(`leak rate ${(agg.leakRate * 100).toFixed(1)}%`);
if (agg.correctRefusalRate < THRESHOLDS.minCorrectRefusal) failures.push(`correct-refusal ${(agg.correctRefusalRate * 100).toFixed(1)}%`);
if (failures.length) { console.error(`\nBENCH FAILED: ${failures.join("; ")}`); process.exit(1); }
console.log("\nbench passed");
