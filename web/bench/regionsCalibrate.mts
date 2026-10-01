// Calibration sweep for the region detector constants (task 6b) — TUNE SET
// ONLY (Shreveport "Combined Drawings"). Never reads in-sample or held-out
// PDFs, and only the tune set's label entries:
//   npm run bench:regions:calibrate     (not in `check`)
//
// Per constant: sweep a range one value at a time (all others at their
// defaults), score each run against the mean of the two agent labels, and
// apply the pre-registered rule (bench/regionCalib.ts): keep the plan's value
// unless the tune result there is worse than elsewhere in the range; then take
// the midpoint of the best plateau. Writes bench/regions-calibration.json,
// which bench:regions copies into its output.
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { detectSetRegions, DEFAULT_REGION_PARAMS, REGION_LOGIC_REV, type DetectSheet, type RegionParams } from "../src/lib/regionDetect.ts";
import { loadPdfSheets } from "./regionSheets.mts";
import { sheetKeyFor } from "./regionSheets.ts";
import { labelSpread, passTolerance, meanLabel, scoreSheet, summarize, groupingCounts } from "./regionScore.ts";
import { chooseValue, compareTune, type TuneResult } from "./regionCalib.ts";
import { toDetected, loadLabels } from "./regionRun.mts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const { SETS } = await import(join(repo, "evals/regions/fetch.mjs"));
const tune = (SETS as Array<{ file: string; pages: number; role: string; sha256: string }>).filter((s) => s.role === "tune");
if (tune.length !== 1) throw new Error("expected exactly one tune set");
const T = tune[0];
const path = join(repo, "evals/regions/pdfs", T.file);
if (!existsSync(path)) { console.error(`tune PDF absent: node evals/regions/fetch.mjs --role tune`); process.exit(1); }
const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
if (sha !== T.sha256) throw new Error(`${T.file}: sha256 mismatch`);

const keys = new Set(Array.from({ length: T.pages }, (_, i) => sheetKeyFor(T.file, i + 1)));
const LA = loadLabels(join(repo, "evals/regions/labels/labeler-A.json"), keys);
const LB = loadLabels(join(repo, "evals/regions/labels/labeler-B.json"), keys);
const spread = labelSpread([...LA.values()], [...LB.values()]);
const tol = passTolerance(spread.p90 ?? 0, null);
const sheets: DetectSheet[] = await loadPdfSheets(path, T.file);

interface RunOut extends TuneResult { dErrMedian: number | null; dErrMax: number | null }
function run(over: Partial<RegionParams>): RunOut {
  const { regions, diag } = detectSetRegions(sheets, over);
  const rows = [], groupRows = [];
  for (const s of sheets) {
    const m = meanLabel(LA.get(s.key)!, LB.get(s.key)!);
    const det = toDetected(T.file, s, regions.get(s.key)!, diag.get(s.key)!, m.title_block?.edge ?? null);
    rows.push(scoreSheet(det, m, tol));
    groupRows.push({ set: T.file, key: s.key, family: m.family, group: det.group });
  }
  const sm = summarize(rows), g = groupingCounts(groupRows);
  return { pass: sm.pass, edgeOk: sm.edgeOk, groupErr: g.splitSheetPairs + g.mergedSheetPairs, abstain: sm.abstain, dErrMedian: sm.dErrMedian, dErrMax: sm.dErrMax };
}

const r3 = (x: number) => Math.round(x * 1e6) / 1e6;
const steps = (a: number, b: number, s: number) => { const o: number[] = []; for (let v = a; v <= b + s / 2; v += s) o.push(r3(v)); return o; };
const SWEEP: Array<{ key: keyof RegionParams; name: string; values: number[]; integer?: boolean }> = [
  { key: "borderMinSpan", name: "BORDER_MIN_SPAN", values: steps(0.5, 0.95, 0.05) },
  { key: "borderMaxFrac", name: "BORDER_MAX_FRAC", values: steps(0.02, 0.15, 0.01) },
  { key: "chainGapFrac", name: "CHAIN_GAP_FRAC", values: [0, 0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03] },
  { key: "minChainCover", name: "MIN_CHAIN_COVER", values: steps(0.4, 0.95, 0.05) },
  { key: "stripDMin", name: "STRIP_D_MIN", values: steps(0.01, 0.1, 0.01) },
  { key: "stripDMax", name: "STRIP_D_MAX", values: steps(0.15, 0.45, 0.025) },
  { key: "touchFrac", name: "TOUCH_FRAC", values: [0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05] },
  { key: "minStripTokens", name: "MIN_STRIP_TOKENS", values: [1, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150], integer: true },
  { key: "sheetnoOuter", name: "SHEETNO_OUTER", values: steps(0.3, 1, 0.1) },
  { key: "sheetnoFarFrom", name: "SHEETNO_FAR_FROM", values: steps(0, 0.9, 0.1) },
  { key: "repeatPosTol", name: "REPEAT_POS_TOL", values: [0.0025, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05] },
  { key: "staticMinSheets", name: "STATIC_MIN_SHEETS", values: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16], integer: true },
  { key: "bandGap", name: "BAND_GAP", values: [0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2] },
  { key: "frameBandRatio", name: "FRAME_BAND_RATIO", values: steps(1, 3, 0.25) },
  { key: "groupMinJaccard", name: "GROUP_MIN_JACCARD", values: steps(0.1, 0.9, 0.1) },
  { key: "groupDTol", name: "GROUP_D_TOL", values: [0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.04] },
  { key: "bandMinCover", name: "BAND_MIN_COVER", values: steps(0.2, 0.9, 0.1) },
];

const t0 = performance.now();
const base = run({});
const fmt = (r: RunOut) => `${r.pass}/${r.edgeOk}/${r.groupErr}/${r.abstain}`;
console.log(`══ region constants calibration — tune set only: ${T.file} (${sheets.length} sheets, sha256 ${sha}) ══`);
console.log(`tolerance ${(tol * 100).toFixed(2)}% (inter-agent p90 over the tune labels ${((spread.p90 ?? 0) * 100).toFixed(2)}%, floor 0.5%)`);
console.log(`result = pass/edge/grouping errors/abstain (n = ${sheets.length}); defaults: ${fmt(base)}; |d err| median ${((base.dErrMedian ?? 0) * 100).toFixed(2)}%`);
const out = [];
for (const c of SWEEP) {
  const plan = DEFAULT_REGION_PARAMS[c.key];
  const values = [...new Set([...c.values, plan])].sort((a, b) => a - b);
  const results = values.map((v) => run({ [c.key]: v }));
  const ch = chooseValue(values, results, plan, !!c.integer);
  let check: RunOut | null = null;
  if (ch.changed) check = run({ [c.key]: ch.chosen });
  const best = results.reduce((a, b) => (compareTune(b, a) > 0 ? b : a));
  out.push({
    constant: c.name, key: c.key, plan, range: [values[0], values[values.length - 1]],
    sweep: values.map((v, i) => ({ value: v, ...results[i] })),
    unchangedRange: ch.planPlateau, bestPlateau: ch.bestPlateau, chosen: ch.chosen, changed: ch.changed,
    best: { pass: best.pass, edgeOk: best.edgeOk, groupErr: best.groupErr, abstain: best.abstain },
    ...(check ? { chosenResult: check, chosenMatchesBest: compareTune(check, best) === 0 } : {}),
  });
  console.log(`\n${c.name} (plan ${plan}; swept ${values[0]}–${values[values.length - 1]})`);
  console.log("  " + values.map((v, i) => `${v}:${fmt(results[i])}`).join("  "));
  console.log(`  unchanged over ${ch.planPlateau[0]}–${ch.planPlateau[1]}; ${ch.changed ? `plan value worse than the best (${fmt(best)}); best plateau ${ch.bestPlateau[0]}–${ch.bestPlateau[1]} → chosen ${ch.chosen}${check ? ` (result there ${fmt(check)})` : ""}` : `plan value is best → kept ${plan}`}`);
}
const chosen = Object.fromEntries(out.map((o) => [o.key, o.chosen]));
console.log(`\nswept ${out.reduce((n, o) => n + o.sweep.length, 0)} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`changed: ${out.filter((o) => o.changed).map((o) => `${o.constant} ${o.plan} → ${o.chosen}`).join(", ") || "none"}`);
writeFileSync(join(here, "regions-calibration.json"), JSON.stringify({
  tuneSet: T.file, sha256: sha, sheets: sheets.length, at: new Date().toISOString().slice(0, 16) + "Z",
  commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim(),
  dirty: spawnSync("git", ["status", "--porcelain", "--", "web/src", "web/bench", "evals/regions/labels", ":!web/bench/regions-calibration.json", ":!web/bench/regions-results.json"], { cwd: repo, encoding: "utf8" }).stdout.trim() !== "",
  logicRev: REGION_LOGIC_REV,
  metric: "pass, edgeOk (higher better), groupErr = same-family sheet pairs split + cross-family sheet pairs merged, abstain (lower better); vs the mean of labelers A and B; lexicographic",
  rule: "keep the plan's value unless the tune result there is worse than elsewhere in the swept range; then the midpoint of the best plateau (widest in value span, then nearest the plan value; integers round toward the plan value)",
  tolerance: tol, defaults: base, constants: out, chosen,
}, null, 1) + "\n");
console.log(`wrote ${join(here, "regions-calibration.json")}`);
