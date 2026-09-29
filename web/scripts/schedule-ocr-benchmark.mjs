// Experiment 1 of the browser-OCR effort (docs/SCHEDULE-OCR.md): the ORACLE
// sweep. No OCR engine runs here — ground-truth words are degraded with
// OCR-shaped noise (lib/ocr/noise.ts) and fed to the SAME parser the app ships
// (parseSchedule), to answer the question every engine choice hangs on:
//
//   how much character error can the schedule importer absorb before rows
//   are lost — i.e. what CER must a real engine beat to be worth shipping?
//
// Two baselines print first:
//   • absolute — clean text layer vs the hand-authored golden rows: today's
//     parser ceiling on real layout (its known limitations, quantified);
//   • then every sweep point scores against the CLEAN PARSE (relative), so the
//     sweep isolates noise sensitivity from those pre-existing limitations.
//
//   node --import tsx scripts/schedule-ocr-benchmark.mjs [--seeds N] [--json <path>]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedule } from "../src/lib/scheduleParse.ts";
import { wordsToTokens } from "../src/lib/ocr/types.ts";
import { degradeWords } from "../src/lib/ocr/noise.ts";
import { matchWords, scoreRows } from "../src/lib/ocr/score.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = join(here, "..", "test", "fixtures", "schedule-ocr");
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const SEEDS = Number(argOf("--seeds", 25));
const jsonOut = argOf("--json", null);

// Two budgets, because the two failures aren't equal. A LOST ROW is silent
// data loss — it never reaches the approval dialog, so row recall is the
// product-critical line and parser hardening is what defends it. A FIELD TYPO
// is visible and editable in the dialog, and getting the text right is
// genuinely the OCR engine's job — so the combined budget (recall AND fields)
// tracks the whole pipeline's ceiling. We report both.
const ROW_BUDGET = 0.95;
const BUDGET = { rowRecall: 0.95, fieldAccOverall: 0.9 };
const CER_SWEEP = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12];
const DROP_SWEEP = [0.01, 0.02, 0.05, 0.1, 0.2];

const cases = readdirSync(fixDir).filter((f) => f.endsWith(".words.json")).map((f) => f.replace(/\.words\.json$/, ""));
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const report = { seeds: SEEDS, budget: BUDGET, cases: {} };

for (const id of cases) {
  const { words } = JSON.parse(readFileSync(join(fixDir, `${id}.words.json`), "utf8"));
  const golden = JSON.parse(readFileSync(join(fixDir, `${id}.golden.json`), "utf8"));
  const cleanRows = parseSchedule(wordsToTokens(words));

  console.log(`\n## ${id} — ${words.length} words, ${golden.length} golden rows, ${SEEDS} seeds/point\n`);
  const abs = scoreRows(golden, cleanRows);
  console.log(`clean text layer vs GOLDEN (absolute parser ceiling): row recall ${pct(abs.rowRecall)}, ` +
    `field acc ${pct(abs.fieldAccOverall)} (${Object.entries(abs.fieldAcc).map(([f, v]) => `${f} ${pct(v)}`).join(", ")}), ` +
    `perfect rows ${abs.perfectRows}/${abs.gtCount}`);
  console.log(`sweep below scores against the CLEAN PARSE (${cleanRows.length} rows) — noise sensitivity only.\n`);

  // one sweep runner for both axes
  const sweep = (label, points, optsOf) => {
    console.log(`| ${label} | input CER | det. recall | row recall | row precision | field acc | field CER | collapses |`);
    console.log(`|---|---|---|---|---|---|---|---|`);
    const out = [];
    for (const p of points) {
      const m = { inCer: [], detRecall: [], rowRecall: [], rowPrecision: [], fieldAcc: [], fieldCer: [], collapse: 0 };
      for (let seed = 0; seed < SEEDS; seed++) {
        const noisy = degradeWords(words, optsOf(p), seed * 7919 + 1);
        // boxes are untouched by the oracle, so IoU matching recovers the
        // word pairing exactly; achieved CER is measured, not assumed
        const wm = matchWords(words, noisy);
        const rows = parseSchedule(wordsToTokens(noisy));
        const rs = scoreRows(cleanRows, rows);
        if (rows.length === 0) m.collapse++;
        m.inCer.push(wm.matchedCer);
        m.detRecall.push(wm.detectionRecall);
        m.rowRecall.push(rs.rowRecall);
        m.rowPrecision.push(rs.rowPrecision);
        m.fieldAcc.push(rs.fieldAccOverall);
        m.fieldCer.push(rs.fieldCer);
      }
      const row = {
        point: p, inputCer: mean(m.inCer), detectionRecall: mean(m.detRecall),
        rowRecall: mean(m.rowRecall), rowPrecision: mean(m.rowPrecision),
        fieldAccOverall: mean(m.fieldAcc), fieldCer: mean(m.fieldCer), collapses: m.collapse,
      };
      out.push(row);
      console.log(`| ${p} | ${pct(row.inputCer)} | ${pct(row.detectionRecall)} | ${pct(row.rowRecall)} | ` +
        `${pct(row.rowPrecision)} | ${pct(row.fieldAccOverall)} | ${pct(row.fieldCer)} | ${row.collapses}/${SEEDS} |`);
    }
    return out;
  };

  const cerRows = sweep("char noise", CER_SWEEP, (cer) => ({ cer }));
  console.log();
  const dropRows = sweep("word drop", DROP_SWEEP, (dropRate) => ({ dropRate }));

  const passesRow = (r) => r.rowRecall >= ROW_BUDGET;
  const passesBoth = (r) => r.rowRecall >= BUDGET.rowRecall && r.fieldAccOverall >= BUDGET.fieldAccOverall;
  const lastCerRow = [...cerRows].reverse().find(passesRow);
  const lastCerBoth = [...cerRows].reverse().find(passesBoth);
  const lastDropRow = [...dropRows].reverse().find(passesRow);
  const noCollapse = [...cerRows].reverse().find((r) => r.collapses === 0);
  console.log(`\n**Row-survival budget** (row recall ≥ ${pct(ROW_BUDGET)} — the product-critical line, defended by the parser):`);
  console.log(lastCerRow
    ? `- char noise: rows survive through nominal ${lastCerRow.point} (measured input CER ${pct(lastCerRow.inputCer)})`
    : `- char noise: fails at every swept level`);
  console.log(lastDropRow
    ? `- word drops: rows survive through ${pct(lastDropRow.point)} detection miss rate`
    : `- word drops: fails at every swept level`);
  console.log(`- no whole-parse collapse observed through nominal ${noCollapse ? [...cerRows].filter((r) => r.collapses === 0).at(-1).point : "—"}`);
  console.log(`\n**Combined budget** (row recall ≥ ${pct(BUDGET.rowRecall)} AND field acc ≥ ${pct(BUDGET.fieldAccOverall)} — whole-pipeline ceiling, gated by OCR text fidelity):`);
  console.log(lastCerBoth
    ? `- char noise: holds through nominal ${lastCerBoth.point} (measured input CER ${pct(lastCerBoth.inputCer)})`
    : `- char noise: fails at every swept level`);

  report.cases[id] = { absolute: abs, cerSweep: cerRows, dropSweep: dropRows,
    rowBudgetCer: lastCerRow?.point ?? null, combinedBudgetCer: lastCerBoth?.point ?? null,
    rowBudgetDrop: lastDropRow?.point ?? null };
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nraw numbers → ${jsonOut}`);
}
