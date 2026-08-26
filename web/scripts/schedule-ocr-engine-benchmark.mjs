// Experiment 3 of the browser-OCR effort (docs/SCHEDULE-OCR.md): the
// off-the-shelf ENGINE ceiling. Where Experiment 1 fed the parser synthetic
// noise, this feeds it a REAL engine's output on the REAL rasterized region,
// swept across render DPI — the one accuracy knob that costs nothing but pixels
// (rasterizeRegion never upscales today, and small drafting text at 144 DPI is
// the likeliest failure mode).
//
//   npm i -D tesseract.js ppu-paddle-ocr          # engines are opt-in, not committed
//   node --import tsx scripts/schedule-ocr-engine-benchmark.mjs \
//        [--engines tesseract,paddle] [--dpi 144,216,288] [--psm 3] [--json out.json]
//
// For each engine × fixture × DPI it renders the region, recognizes, and scores
// two layers with the SAME functions the oracle used:
//   • word level — detection recall/precision + CER against the vector
//     ground-truth boxes. NOTE this is WORD granularity: a line/cell-level
//     detector (PaddleOCR) is understated here by construction, so read it only
//     WITHIN an engine (does more DPI help?), never as a cross-engine ranking.
//   • row level — parseSchedule(engine words) vs the golden rows: the
//     cross-engine-fair, product-truth metric. A lost row is silent data loss;
//     a field typo is editable — so row recall then field accuracy is the order.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedule } from "../src/lib/scheduleParse.ts";
import { wordsToTokens } from "../src/lib/ocr/types.ts";
import { matchWords, scoreRows } from "../src/lib/ocr/score.ts";
import { openDoc, renderRegion } from "./lib/renderRegion.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = join(here, "..", "test", "fixtures", "schedule-ocr");
const demoDir = join(here, "..", "..", "demo");
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const ENGINES = argOf("--engines", "tesseract,paddle").split(",").map((s) => s.trim()).filter(Boolean);
const DPIS = argOf("--dpi", "144,216,288").split(",").map(Number);
const PSM = Number(argOf("--psm", 3));
const jsonOut = argOf("--json", null);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// Each fixture names its source PDF + page; the rect + RENDER_SCALE baseline
// come from the committed words.json (zoom is derived per DPI).
const SOURCES = { "material-schedule": { pdf: join(demoDir, "sample-finish-plan.pdf"), page: 2 } };

// Engine factories, lazily loaded so a missing opt-in package skips cleanly.
async function makeEngine(name) {
  if (name === "tesseract") {
    const { createTesseractEngine } = await import("./lib/tesseractEngine.mjs");
    return createTesseractEngine({ psm: PSM });
  }
  if (name === "paddle") {
    const { createPaddleEngine } = await import("./lib/paddleEngine.mjs");
    return createPaddleEngine({});
  }
  throw new Error(`unknown engine "${name}"`);
}

const cases = readdirSync(fixDir).filter((f) => f.endsWith(".words.json")).map((f) => f.replace(/\.words\.json$/, ""));
const report = { engines: ENGINES, dpis: DPIS, cases: {} };

for (const name of ENGINES) {
  let engine;
  try {
    engine = await makeEngine(name);
  } catch (e) {
    console.log(`\n# engine ${name}: SKIPPED — ${e.message}\n  (install with: npm i -D ${name === "paddle" ? "ppu-paddle-ocr" : "tesseract.js"})`);
    continue;
  }
  console.log(`\n# engine: ${engine.id}\n`);

  for (const id of cases) {
    const src = SOURCES[id];
    if (!src) { console.log(`(skip ${id}: no source PDF mapping)`); continue; }
    const fixture = JSON.parse(readFileSync(join(fixDir, `${id}.words.json`), "utf8"));
    const golden = JSON.parse(readFileSync(join(fixDir, `${id}.golden.json`), "utf8"));
    const truthWords = fixture.words; // vector text layer = ground truth boxes+text
    const cleanRows = parseSchedule(wordsToTokens(truthWords));
    const baseline = fixture.renderScale; // RENDER_SCALE the rect is expressed in
    const doc = await openDoc(src.pdf);

    console.log(`## ${id} — ${truthWords.length} truth words, ${golden.length} golden rows\n`);
    console.log(`| DPI | px | det. recall (word) | det. prec | matched CER | row recall (vs golden) | field acc | perfect | time |`);
    console.log(`|---|---|---|---|---|---|---|---|---|`);
    const rows = [];
    for (const dpi of DPIS) {
      const zoom = dpi / (72 * baseline); // baseline RENDER_SCALE=2 → 144 DPI at zoom 1
      const t0 = performance.now();
      const rendered = await renderRegion(doc, src.page, { rect: fixture.rect, zoom });
      let words;
      try {
        words = await engine.recognize(rendered, { dpi });
      } finally {
        rendered.release();
      }
      const ms = performance.now() - t0;
      const wm = matchWords(truthWords, words);
      const parsed = parseSchedule(wordsToTokens(words));
      const vsGolden = scoreRows(golden, parsed);
      const row = {
        dpi, px: `${rendered.width}×${rendered.height}`, words: words.length,
        detectionRecall: wm.detectionRecall, detectionPrecision: wm.detectionPrecision, matchedCer: wm.matchedCer,
        rowRecall: vsGolden.rowRecall, fieldAcc: vsGolden.fieldAccOverall, perfect: vsGolden.perfectRows, gtCount: vsGolden.gtCount, ms,
      };
      rows.push(row);
      console.log(`| ${dpi} | ${row.px} | ${pct(row.detectionRecall)} | ${pct(row.detectionPrecision)} | ${pct(row.matchedCer)} | ` +
        `${pct(row.rowRecall)} | ${pct(row.fieldAcc)} | ${row.perfect}/${row.gtCount} | ${(ms / 1000).toFixed(1)}s |`);
    }
    (report.cases[id] ??= {})[engine.id] = rows;
    await doc.destroy();
  }
  await engine.dispose();
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nraw numbers → ${jsonOut}`);
}
