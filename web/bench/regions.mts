// Region bench — title block vs drawing area on real VA sets, scored against
// the blind labels (docs/design/REGION_ANNOTATION_PLAN.md, "Evaluation data"
// and "Metrics"):
//   npm run bench:regions              tune + in-sample sets (held-out: "not run")
//   npm run bench:regions -- --held-out --reason "<why>"
//                                      also the held-out sets — refused unless the
//                                      detector constants are frozen and unchanged
//
// NOT in `check` and never run by CI: the PDFs are fetched by hand
// (evals/regions/fetch.mjs) and are not committed. Reports, never gates.
// Held-out label entries are filtered out by key before anything reads them,
// unless --held-out passes its guard.
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { detectSetRegions, type DetectSheet } from "../src/lib/regionDetect.ts";
import { loadPdfSheets } from "./regionSheets.mts";
import { sheetKeyFor } from "./regionSheets.ts";
import {
  labelSpread, passTolerance, binomUpper95, meanLabel, scoreSheet, summarize, groupingCounts, checkOrder, fmtPass, median,
  type LabelEntry, type Detected, type ScoreRow, type Summary,
} from "./regionScore.ts";
import { heldOutGuard } from "./regionGuard.mts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const argv = process.argv.slice(2);
const heldOut = argv.includes("--held-out");
const reasonAt = argv.indexOf("--reason");
const reason = reasonAt >= 0 ? argv[reasonAt + 1] ?? "" : "";

// ── sets ─────────────────────────────────────────────────────────────────────
const { SETS } = await import(join(repo, "evals/regions/fetch.mjs"));
interface BenchSet { name: string; path: string; file: string; pages: number; role: "tune" | "in-sample" | "held-out"; sha256?: string }
const pdfDir = join(repo, "evals/regions/pdfs");
const fetched: BenchSet[] = (SETS as Array<{ file: string; pages: number; role: BenchSet["role"]; sha256: string }>)
  .map((s) => ({ name: s.file, path: join(pdfDir, s.file), file: s.file, pages: s.pages, role: s.role, sha256: s.sha256 }));
// committed single sheets: each its own set (in-sample)
const committed: BenchSet[] = [
  ["evals/four-asks-2026-09-02/sheets/va-dublin-bldg9a-finish-plan-A601.pdf", 1],
  ["evals/four-asks-2026-09-02/sheets/va-shreveport-fisher-house-site-utility-C300.pdf", 1],
  ["web/public/demo/sample-finish-plan.pdf", 2],
  ["evals/mcp-workflow-bench/plan-set/porterville/porterville-adu-a1-101.pdf", 1],
  ["evals/mcp-workflow-bench/plan-set/roseburg/va-roseburg-a03a.pdf", 1],
].map(([p, n]) => {
  const file = String(p).replace(/^.*\//, "");
  return { name: file, path: join(repo, String(p)), file, pages: Number(n), role: "in-sample" as const };
});

if (heldOut) {
  const g = heldOutGuard();
  if (!g.ok) {
    console.error(`bench:regions --held-out refused: ${g.reason}`);
    process.exit(2);
  }
  if (!reason.trim()) {
    console.error("bench:regions --held-out refused: give --reason \"<why this run>\" (every held-out run is logged)");
    process.exit(2);
  }
}
const sections: Array<{ name: string; role: BenchSet["role"]; sets: BenchSet[] }> = [
  { name: "tune", role: "tune", sets: fetched.filter((s) => s.role === "tune") },
  { name: "in-sample", role: "in-sample", sets: [...fetched.filter((s) => s.role === "in-sample"), ...committed] },
  ...(heldOut ? [{ name: "held-out", role: "held-out" as const, sets: fetched.filter((s) => s.role === "held-out") }] : []),
];

// ── labels: filtered to the keys of the sets in this run, by key only ───────
const allowed = new Set<string>();
for (const sec of sections) for (const s of sec.sets) for (let n = 1; n <= s.pages; n++) allowed.add(sheetKeyFor(s.file, n));
const inSampleKeys = new Set<string>();
for (const sec of sections.filter((x) => x.role !== "held-out")) for (const s of sec.sets) for (let n = 1; n <= s.pages; n++) inSampleKeys.add(sheetKeyFor(s.file, n));
function loadLabels(which: "A" | "B"): Map<string, LabelEntry> {
  const raw = JSON.parse(readFileSync(join(repo, `evals/regions/labels/labeler-${which}.json`), "utf8"));
  const out = new Map<string, LabelEntry>();
  for (const e of raw.sheets as Array<{ key: string }>) if (allowed.has(e.key)) out.set(e.key, e as unknown as LabelEntry);
  return out;
}
const LA = loadLabels("A"), LB = loadLabels("B");

// ── header ───────────────────────────────────────────────────────────────────
const git = (args: string[]) => {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { code: r.status ?? 128, out: r.stdout ?? "" };
};
const head = git(["rev-parse", "HEAD"]).out.trim();
const dirty = git(["status", "--porcelain", "--", "web/src", "web/bench", "evals/regions/labels"]).out.trim() !== "";
const order = checkOrder(git);
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

// tolerance: inter-agent spread over the tune + in-sample sheets only (fixed before any held-out run)
const inA = [...LA.values()].filter((e) => inSampleKeys.has(e.key)), inB = [...LB.values()].filter((e) => inSampleKeys.has(e.key));
const spread = labelSpread(inA, inB);
const interAgent = spread.p90 ?? 0;
const maintainer: number | null = null;  // no maintainer labels yet
const tol = passTolerance(interAgent, maintainer);
const tolIfMax = passTolerance(spread.max ?? 0, maintainer);

const pct = (x: number | null, dp = 2) => (x === null ? "—" : `${(100 * x).toFixed(dp)}%`);
console.log("══ bench:regions — title block vs drawing area (piece 2a, vector) ══");
console.log(`commit          ${head}${dirty ? " (+ uncommitted changes)" : ""}`);
console.log(`label commit    ${order.labelCommit ?? "?"}`);
console.log(`order check     ${order.verified ? "verified" : "UNVERIFIED ORDER"} — ${order.reason}`);
console.log(`labels          two agent labelers (A, B); maintainer spread: not available — agent labels only; no human noise floor`);
console.log(`spread A vs B   d over ${spread.n} tune + in-sample sheets: median ${pct(spread.median, 2)}, p90 ${pct(spread.p90, 2)}, max ${pct(spread.max, 2)}; edge disagreements ${spread.edgeDisagree}`);
console.log(`tolerance       ${pct(tol, 2)} of the border box across the edge = max(2 × max(inter-agent p90 ${pct(interAgent, 2)}, maintainer n/a), 0.5%)`);
console.log(`                (with the max spread instead of p90 it would be ${pct(tolIfMax, 2)})`);

// ── run ──────────────────────────────────────────────────────────────────────
interface SectionOut { name: string; status: string; sets: Array<{ name: string; pages: number; sha256: string | null; ms: number; summary: Summary | null; skipped?: string }>; total?: Summary; perLabeler?: Record<string, Summary>; grouping?: ReturnType<typeof groupingCounts>; rows?: ScoreRow[]; meanExcluded?: string[]; pdfs: Record<string, string> }
const results: SectionOut[] = [];
const allRows: ScoreRow[] = [];
const hashes: Record<string, string> = {};

for (const sec of [...sections, ...(heldOut ? [] : [{ name: "held-out", role: "held-out" as const, sets: [] as BenchSet[] }])]) {
  if (sec.role === "held-out" && !heldOut) {
    results.push({ name: "held-out", status: "not run", sets: [], pdfs: {} });
    continue;
  }
  const out: SectionOut = { name: sec.name, status: "run", sets: [], pdfs: {} };
  const rowsBy: Record<"A" | "B" | "mean", ScoreRow[]> = { A: [], B: [], mean: [] };
  const groupRows: Array<{ set: string; key: string; family: string; group: string | null }> = [];
  const meanExcluded: string[] = [];
  for (const set of sec.sets) {
    if (!existsSync(set.path)) {
      out.sets.push({ name: set.name, pages: set.pages, sha256: null, ms: 0, summary: null, skipped: "PDF absent (node evals/regions/fetch.mjs)" });
      continue;
    }
    const h = sha(set.path);
    if (set.sha256 && h !== set.sha256) throw new Error(`${set.file}: sha256 ${h} does not match SOURCE.md ${set.sha256}`);
    hashes[set.file] = h; out.pdfs[set.file] = h;
    const sheets: DetectSheet[] = await loadPdfSheets(set.path, set.file);
    const t0 = performance.now();
    const { regions, diag } = detectSetRegions(sheets);
    const ms = performance.now() - t0;
    const setRows: ScoreRow[] = [];
    for (const s of sheets) {
      const dg = diag.get(s.key)!, rg = regions.get(s.key)!;
      const tb = rg.regions.find((r) => r.kind === "title_block");
      const la = LA.get(s.key), lb = LB.get(s.key);
      if (!la || !lb) { console.log(`  (no label for ${s.key}; not scored)`); continue; }
      const m = meanLabel(la, lb);
      const edgeForDim = m.title_block?.edge ?? dg.edge ?? "bottom";
      const box = dg.border!;
      const dimPx = edgeForDim === "top" || edgeForDim === "bottom" ? box[3] - box[1] : box[2] - box[0];
      const det: Detected = {
        key: s.key, set: set.name, edge: dg.edge, d: dg.d,
        rules: (tb?.evidence ?? []).filter((e) => e.startsWith("rule:")).map((e) => e.slice(5)),
        confidence: tb?.confidence ?? rg.regions[0]?.confidence ?? 0,
        frameless: !!tb && !tb.evidence.includes("frame-line"),
        group: rg.group ?? null, dimPx,
      };
      rowsBy.A.push(scoreSheet(det, la, tol));
      rowsBy.B.push(scoreSheet(det, lb, tol));
      if (m.disagree) meanExcluded.push(s.key);
      else { const r = scoreSheet(det, m, tol); rowsBy.mean.push(r); setRows.push(r); }
      groupRows.push({ set: set.name, key: s.key, family: m.family, group: det.group });
    }
    out.sets.push({ name: set.name, pages: sheets.length, sha256: h, ms, summary: summarize(setRows) });
  }
  out.total = summarize(rowsBy.mean);
  out.perLabeler = { A: summarize(rowsBy.A), B: summarize(rowsBy.B), mean: out.total };
  out.grouping = groupingCounts(groupRows);
  out.rows = rowsBy.mean;
  out.meanExcluded = meanExcluded;
  allRows.push(...rowsBy.mean);
  results.push(out);
}

console.log("pdfs (sha256)");
for (const [f, h] of Object.entries(hashes)) console.log(`  ${h}  ${f}`);
const tolPx = allRows.flatMap((r) => (r.tolPx === null ? [] : [r.tolPx]));
if (tolPx.length) console.log(`tolerance in px  ${pct(tol, 2)} at RENDER_SCALE = ${Math.min(...tolPx).toFixed(1)}–${Math.max(...tolPx).toFixed(1)} px across the edge (median ${median(tolPx)!.toFixed(1)} px) over the scored sheets`);

// ── report ───────────────────────────────────────────────────────────────────
const V = order.verified;
const rowLine = (name: string, s: Summary) =>
  `  ${name.padEnd(46)} n=${String(s.n).padStart(2)}  edge ${String(s.edgeOk).padStart(2)}/${s.n}  |d err| med ${pct(s.dErrMedian).padStart(6)} max ${pct(s.dErrMax).padStart(6)}  pass ${fmtPass(s.pass, s.n, V).padEnd(14)}  abstain ${s.abstain}/${s.n}`;
for (const sec of results) {
  console.log(`\n── ${sec.name.toUpperCase()}${sec.name === "held-out" ? "" : " (in-sample: the rules were designed on these; not a generalization result)"} ──`);
  if (sec.status === "not run") { console.log("  not run (constants not yet run on held-out; `--held-out` is the one held-out run)"); continue; }
  for (const s of sec.sets) {
    if (!s.summary) console.log(`  ${s.name.padEnd(46)} skipped: ${s.skipped}`);
    else console.log(rowLine(s.name, s.summary) + `  (${s.ms.toFixed(0)} ms)`);
  }
  const t = sec.total!;
  console.log(rowLine(`TOTAL vs mean label`, t));
  console.log(rowLine(`TOTAL vs labeler A`, sec.perLabeler!.A));
  console.log(rowLine(`TOTAL vs labeler B`, sec.perLabeler!.B));
  if (sec.meanExcluded!.length) console.log(`  labelers disagree on the edge (excluded from the mean): ${sec.meanExcluded!.join(", ")}`);
  const neg = t.negatives;
  const up = binomUpper95(neg.falsePositives, neg.n);
  console.log(`  false positives on labeled negatives: ${neg.n === 0 ? "no labeled negatives (n = 0)" : neg.n < 5 ? `${neg.falsePositives}/${neg.n}, 95% upper bound ${pct(up, 1)} (n < 5: not a rate)` : `${neg.falsePositives}/${neg.n} (95% upper bound ${pct(up, 1)})`}`);
  const g = sec.grouping!;
  console.log(`  grouping: ${g.families} label families; families split ${g.splitFamilies}/${g.familyUnits} (set, family) units; cross-family pairs merged ${g.mergedPairs}/${g.crossPairs}; same-family sheet pairs split ${g.splitSheetPairs}/${g.sameFamilySheetPairs}; ungrouped (abstained) ${g.ungrouped}${g.meaningful ? "" : " — not statistically meaningful (< 3 families)"}`);
  console.log(`  per rule / confidence tier (rule labels, not calibrated probabilities):`);
  for (const [tier, c] of Object.entries(t.tiers).sort()) console.log(`    ${tier.padEnd(8)} n=${c.n}  pass ${fmtPass(c.pass, c.n, V)}`);
  console.log(`  framed strips: n=${t.framed.n} pass ${fmtPass(t.framed.pass, t.framed.n, V)}; frameless strips: n=${t.frameless.n}, edge ${t.frameless.edgeOk}/${t.frameless.n}, |d err| ≤ 25% of d ${fmtPass(t.frameless.pass, t.frameless.n, V)}`);
  const bad = sec.rows!.filter((r) => !r.pass);
  if (bad.length) {
    console.log(`  not passing (${bad.length}):`);
    for (const r of bad) console.log(`    ${r.key.padEnd(44)} label ${r.labelEdge ?? "none"} ${r.labelD === null ? "" : r.labelD.toFixed(3)}  detector ${r.detEdge ?? "abstain"} ${r.detD === null ? "" : r.detD.toFixed(3)}  ${r.tier}${r.dErr !== null ? `  err ${pct(r.dErr)}` : ""}`);
  }
}

// ── output file ──────────────────────────────────────────────────────────────
const outPath = join(here, "regions-results.json");
let runLog: unknown[] = [];
try { runLog = JSON.parse(readFileSync(outPath, "utf8")).runLog ?? []; } catch { /* first run */ }
runLog.push({ at: new Date().toISOString(), commit: head, dirty, heldOut, ...(heldOut ? { reason } : {}) });
let calibration: unknown = null;
try { calibration = JSON.parse(readFileSync(join(here, "regions-calibration.json"), "utf8")); } catch { /* not calibrated yet */ }
writeFileSync(outPath, JSON.stringify({
  commit: head, dirty, labelCommit: order.labelCommit, order,
  labels: { labelers: ["A", "B"], maintainer: "not available — agent labels only; no human noise floor" },
  spread, tolerance: { frac: tol, interAgentP90: interAgent, maintainer, ifMaxSpread: tolIfMax, px: tolPx.length ? { min: Math.min(...tolPx), max: Math.max(...tolPx), median: median(tolPx) } : null },
  pdfs: hashes, sections: results, calibration, runLog,
}, null, 1) + "\n");
console.log(`\nwrote ${outPath}`);
