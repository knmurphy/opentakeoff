// Region bench — title block vs drawing area on real VA sets, scored against
// the blind labels (docs/design/REGION_ANNOTATION_PLAN.md, "Evaluation data"
// and "Metrics"):
//   npm run bench:regions              tune + in-sample sets (held-out: "not run")
//   npm run bench:regions -- --sensitivity
//                                      also the per-constant sensitivity runs, on
//                                      tune + in-sample (a dry run of the held-out code path)
//   npm run bench:regions -- --held-out --reason "<why>"
//                                      THE held-out run: guarded (bench/regionHeldOut.ts:
//                                      clean tree, HEAD descends from the freeze commit,
//                                      source + constants hash unchanged, no earlier run at
//                                      this hash), logged to evals/regions/heldout-runs.jsonl
//                                      before it starts and after; results go only to
//                                      web/bench/regions-heldout-results.json
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
  binomUpper95, scoreSheet, summarize, groupingCounts, checkOrder, fmtPass, median,
  capJaccardRows, type CapJaccardRow, type ScoreRow, type Summary,
} from "./regionScore.ts";
import { DEFAULT_REGION_PARAMS, REGION_LOGIC_REV, regionParamsCanonical, type RegionParams } from "../src/lib/regionDetect.ts";
import { preflight, logStart, logFinish, resultsPath, sectionRoles, sensitivityPlan, parseArgs, readFreeze, currentFreeze, HELDOUT_LOG, HELDOUT_RESULTS_FILE, type Env } from "./regionHeldOut.ts";
import { appendFileSync } from "fs";
import { toDetected, loadAnswerKeys, toleranceFor, benchSets, keysOf, type BenchSet } from "./regionRun.mts";
import { compareTune } from "./regionCalib.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const argv = process.argv.slice(2);
const args = parseArgs(argv);
const env: Env = {
  git: (a) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" }); return { code: r.status ?? 128, out: r.stdout ?? "" }; },
  readText: (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), "utf8") : null),
  appendText: (p, t) => appendFileSync(join(repo, p), t),
  now: () => new Date().toISOString(),
};
const paramsCanon = regionParamsCanonical(DEFAULT_REGION_PARAMS);
const pre = preflight(argv, env, paramsCanon);
if (pre.mode === "held-out" && !pre.ok) {
  console.error(`bench:regions --held-out refused (logged to ${HELDOUT_LOG}): ${pre.why}`);
  process.exit(2);
}
const heldOut = pre.mode === "held-out";
const mode = heldOut ? "held-out" as const : "normal" as const;

// ── sets ─────────────────────────────────────────────────────────────────────
const allSets = await benchSets(repo);
const fetched = allSets.filter((s) => s.sha256), committed = allSets.filter((s) => !s.sha256);

const bySection: Record<BenchSet["role"], BenchSet[]> = {
  tune: fetched.filter((s) => s.role === "tune"),
  "in-sample": [...fetched.filter((s) => s.role === "in-sample"), ...committed],
  "held-out": fetched.filter((s) => s.role === "held-out"),
};
const sections = sectionRoles(mode).map((role) => ({ name: role, role, sets: bySection[role] }));
// the start entry is appended BEFORE any held-out page is opened
if (pre.mode === "held-out" && pre.ok) logStart(env, pre, argv);

// ── labels: filtered to the keys of the sets in this run, by key only ───────
const allowed = new Set<string>();
for (const sec of sections) for (const s of sec.sets) for (let n = 1; n <= s.pages; n++) allowed.add(sheetKeyFor(s.file, n));
const inSampleKeys = keysOf(allSets.filter((s) => s.role !== "held-out"));
const keysets = loadAnswerKeys(repo, allowed);
const LA = keysets.A, LB = keysets.B, LR = keysets.R;

// ── header ───────────────────────────────────────────────────────────────────
const git = (args: string[]) => {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { code: r.status ?? 128, out: r.stdout ?? "" };
};
const head = git(["rev-parse", "HEAD"]).out.trim();
const dirty = git(["status", "--porcelain", "--", "web/src", "web/bench", "evals/regions/labels", ":!web/bench/regions-results.json"]).out.trim() !== "";
const order = checkOrder(git);
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

// tolerance: max inter-agent spread over the tune + in-sample sheets after reconciliation
// (fixed before any held-out run)
const T0 = toleranceFor(inSampleKeys, keysets);
const spread = T0.spread, tol = T0.tol;
const maintainer: number | null = null;  // no maintainer labels yet
const pct = (x: number | null, dp = 2) => (x === null ? "—" : `${(100 * x).toFixed(dp)}%`);
console.log("══ bench:regions — title block vs drawing area (piece 2a, vector) ══");
console.log(`commit          ${head}${dirty ? " (+ uncommitted changes)" : ""}`);
console.log(`label commit    ${order.labelCommit ?? "?"}`);
console.log(`order check     ${order.verified ? "verified" : "UNVERIFIED ORDER"} — ${order.reason}`);
const freeze = readFreeze(env);
const cur = currentFreeze(env, paramsCanon);
console.log(`freeze          ${freeze ? `${freeze.frozenAt} at commit ${freeze.commit.slice(0, 12)}, hash ${freeze.hash.slice(0, 16)}… (detector source + constants) — current ${cur.hash === freeze.hash ? "matches" : `DIFFERS (${cur.hash.slice(0, 16)}…)`}` : `none (evals/regions/freeze.json); current hash ${cur.hash.slice(0, 16)}…`}; logic rev ${REGION_LOGIC_REV} (information)`);
console.log(`labels          two agent labelers (A, B); maintainer spread: not available — agent labels only; no human noise floor`);
console.log(`answer key      evals/regions/labels/reconciled.json: mean of A and B; resolved (> 1% apart): ${T0.resolved.join(", ") || "none"} (written definition; pending maintainer confirmation)`);
console.log(`spread A vs B   d over ${spread.n} tune + in-sample sheets after reconciliation: max ${pct(spread.max, 2)} (p90 ${pct(spread.p90, 2)}, median ${pct(spread.median, 2)}; information); edge disagreements ${spread.edgeDisagree}`);
console.log(`tolerance       ${pct(tol, 2)} of the border box across the edge = max(2 × max(inter-agent max ${pct(spread.max, 2)}, maintainer n/a), 0.5%)`);

// ── run ──────────────────────────────────────────────────────────────────────
interface SectionOut { name: string; status: string; sets: Array<{ name: string; pages: number; sha256: string | null; ms: number; summary: Summary | null; skipped?: string }>; total?: Summary; perLabeler?: Record<string, Summary>; grouping?: ReturnType<typeof groupingCounts>; rows?: ScoreRow[]; meanExcluded?: string[]; noTextLayer?: string[]; capJaccard?: { groups: Array<{ set: string; id: string; sheets: number; uncapped: number; capped: number }>; pairs: CapJaccardRow[]; crossSet: CapJaccardRow[] }; pdfs: Record<string, string> }
const results: SectionOut[] = [];
const allRows: ScoreRow[] = [];
const hashes: Record<string, string> = {};

const loaded = new Map<string, DetectSheet[]>();
for (const sec of [...sections, ...(heldOut ? [] : [{ name: "held-out", role: "held-out" as const, sets: [] as BenchSet[] }])]) {
  if (sec.role === "held-out" && !heldOut) {
    results.push({ name: "held-out", status: "not run", sets: [], pdfs: {} });
    continue;
  }
  const out: SectionOut = { name: sec.name, status: "run", sets: [], pdfs: {} };
  const rowsBy: Record<"A" | "B" | "reconciled", ScoreRow[]> = { A: [], B: [], reconciled: [] };
  const groupRows: Array<{ set: string; key: string; family: string; group: string | null }> = [];
  const meanExcluded: string[] = [];
  const noText: string[] = [];
  const capRows: CapJaccardRow[] = [];
  const capAll: Array<{ id: string; uncapped: string[]; capped: string[] }> = [];
  const capGroups: Array<{ set: string; id: string; sheets: number; uncapped: number; capped: number }> = [];
  for (const set of sec.sets) {
    if (!existsSync(set.path)) {
      out.sets.push({ name: set.name, pages: set.pages, sha256: null, ms: 0, summary: null, skipped: "PDF absent (node evals/regions/fetch.mjs)" });
      continue;
    }
    const h = sha(set.path);
    if (set.sha256 && h !== set.sha256) throw new Error(`${set.file}: sha256 ${h} does not match SOURCE.md ${set.sha256}`);
    hashes[set.file] = h; out.pdfs[set.file] = h;
    const sheets: DetectSheet[] = await loadPdfSheets(set.path, set.file);
    loaded.set(set.name, sheets);
    const t0 = performance.now();
    const { regions, diag, groupStatics } = detectSetRegions(sheets);
    const capped = new Map<string, string[]>();
    for (const r of regions.values()) if (r.group && r.group_sig) capped.set(r.group, r.group_sig.statics);
    const groupsHere = [...groupStatics.keys()].sort().map((id) => ({ id, uncapped: groupStatics.get(id)!, capped: capped.get(id) ?? [] }));
    capRows.push(...capJaccardRows(set.name, groupsHere));
    for (const g of groupsHere) capAll.push({ id: `${set.name}:${g.id}`, uncapped: g.uncapped, capped: g.capped });
    for (const g of groupsHere) capGroups.push({ set: set.name, id: g.id, sheets: [...regions.values()].filter((r) => r.group === g.id).length, uncapped: g.uncapped.length, capped: g.capped.length });
    const ms = performance.now() - t0;
    const setRows: ScoreRow[] = [];
    for (const s of sheets) {
      const dg = diag.get(s.key)!, rg = regions.get(s.key)!;
      if (s.tokens.length === 0) { noText.push(s.key); continue; }   // plan: counted and excluded (vector piece; OCR is 2b)
      const la = LA.get(s.key), lb = LB.get(s.key), lr = LR.get(s.key);
      if (!la || !lb || !lr) { console.log(`  (no label for ${s.key}; not scored)`); continue; }
      const m = lr;
      const det = toDetected(set.name, s, rg, dg, m.title_block?.edge ?? null);
      rowsBy.A.push(scoreSheet(det, la, tol));
      rowsBy.B.push(scoreSheet(det, lb, tol));
      if (lr.resolved_by) meanExcluded.push(s.key);
      { const r = scoreSheet(det, lr, tol); rowsBy.reconciled.push(r); setRows.push(r); }
      groupRows.push({ set: set.name, key: s.key, family: m.family, group: det.group });
    }
    out.sets.push({ name: set.name, pages: sheets.length, sha256: h, ms, summary: summarize(setRows) });
  }
  out.total = summarize(rowsBy.reconciled);
  out.perLabeler = { A: summarize(rowsBy.A), B: summarize(rowsBy.B), reconciled: out.total };
  out.grouping = groupingCounts(groupRows);
  out.rows = rowsBy.reconciled;
  out.meanExcluded = meanExcluded;
  out.noTextLayer = noText;
  // pairs of groups from different sets (e.g. a template made on one Dublin part, matched on another)
  const crossSet = capJaccardRows("cross-set", capAll.filter((g) => g.uncapped.length)).filter((r) => r.a.split(":")[0] !== r.b.split(":")[0]);
  out.capJaccard = { groups: capGroups, pairs: capRows, crossSet };
  allRows.push(...rowsBy.reconciled);
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
  const note: Record<string, string> = {
    tune: " (in-sample, tune: constants were calibrated here; not a generalization result)",
    "in-sample": " (in-sample: the rules were designed by looking at these; never tuned on; not a generalization result)",
    "held-out": " (headline numbers come only from this section)",
  };
  console.log(`\n── ${sec.name.toUpperCase()}${note[sec.name] ?? ""} ──`);
  if (sec.status === "not run") { console.log(`  not run here (normal runs never touch held-out; the one guarded run writes ${HELDOUT_RESULTS_FILE} and logs to ${HELDOUT_LOG})`); continue; }
  for (const s of sec.sets) {
    if (!s.summary) console.log(`  ${s.name.padEnd(46)} skipped: ${s.skipped}`);
    else console.log(rowLine(s.name, s.summary) + `  (${s.ms.toFixed(0)} ms)`);
  }
  const t = sec.total!;
  console.log(rowLine(`TOTAL vs reconciled labels`, t));
  console.log(rowLine(`TOTAL vs labeler A`, sec.perLabeler!.A));
  console.log(rowLine(`TOTAL vs labeler B`, sec.perLabeler!.B));
  console.log(`  excluded, no text layer (vector detector; OCR is piece 2b): ${sec.noTextLayer!.length}${sec.noTextLayer!.length ? ` — ${sec.noTextLayer!.join(", ")}` : ""}`);
  if (sec.meanExcluded!.length) console.log(`  resolved in the reconciled key (labelers > 1% apart; written definition, pending maintainer confirmation): ${sec.meanExcluded!.join(", ")}`);
  const neg = t.negatives;
  const up = binomUpper95(neg.falsePositives, neg.n);
  console.log(`  false positives on labeled negatives: ${neg.n === 0 ? "no labeled negatives (n = 0)" : neg.n < 5 ? `${neg.falsePositives}/${neg.n}, 95% upper bound ${pct(up, 1)} (n < 5: not a rate)` : `${neg.falsePositives}/${neg.n} (95% upper bound ${pct(up, 1)})`}`);
  const g = sec.grouping!;
  console.log(`  grouping: ${g.families} label families; families split ${g.splitFamilies}/${g.familyUnits} (set, family) units; cross-family pairs merged ${g.mergedPairs}/${g.crossPairs}; same-family sheet pairs split ${g.splitSheetPairs}/${g.sameFamilySheetPairs}; ungrouped (abstained) ${g.ungrouped}${g.meaningful ? "" : " — not statistically meaningful (< 3 families)"}${g.crossPairs === 0 ? " — merges not measurable (no two families share a set)" : ""}`);
  console.log(`  per rule / confidence tier (rule labels, not calibrated probabilities):`);
  for (const [tier, c] of Object.entries(t.tiers).sort()) console.log(`    ${tier.padEnd(8)} n=${c.n}  pass ${fmtPass(c.pass, c.n, V)}`);
  console.log(`  framed strips: n=${t.framed.n} pass ${fmtPass(t.framed.pass, t.framed.n, V)}; frameless strips: n=${t.frameless.n}, edge ${t.frameless.edgeOk}/${t.frameless.n}, |d err| ≤ 25% of d ${fmtPass(t.frameless.pass, t.frameless.n, V)}`);
  const cj = sec.capJaccard!;
  console.log(`  static-string cap (20 strings, 80 chars) — statics per group, uncapped → capped:`);
  for (const g of cj.groups) console.log(`    ${g.set} ${g.id} (${g.sheets} sheets): ${g.uncapped} → ${g.capped}`);
  if (cj.pairs.length) {
    console.log(`  Jaccard per group pair, uncapped → capped (what matchGroup compares):`);
    for (const r of cj.pairs) console.log(`    ${r.set} ${r.a} × ${r.b}: ${r.uncapped.toFixed(3)} → ${r.capped.toFixed(3)}`);
  } else console.log(`  Jaccard per group pair: no set has two groups`);
  for (const r of cj.crossSet) console.log(`    across sets ${r.a} × ${r.b}: ${r.uncapped.toFixed(3)} → ${r.capped.toFixed(3)}`);
  const bad = sec.rows!.filter((r) => !r.pass);
  if (bad.length) {
    console.log(`  not passing (${bad.length}):`);
    for (const r of bad) console.log(`    ${r.key.padEnd(44)} label ${r.labelEdge ?? "none"} ${r.labelD === null ? "" : r.labelD.toFixed(3)}  detector ${r.detEdge ?? "abstain"} ${r.detD === null ? "" : r.detD.toFixed(3)}  ${r.tier}${r.dErr !== null ? `  err ${pct(r.dErr)}` : ""}`);
  }
}

// ── calibration (tune set only; bench/regionsCalibrate.mts) ──────────────────
let calibration: { tuneSet: string; constants: Array<{ constant: string; plan: number; range: [number, number]; unchangedRange: [number, number]; chosen: number; changed: boolean; sweep: Array<{ value: number; pass: number; edgeOk: number; groupErr: number; abstain: number }> }> } | null = null;
try { calibration = JSON.parse(readFileSync(join(here, "regions-calibration.json"), "utf8")); } catch { /* not calibrated yet */ }
if (calibration) {
  console.log(`\n── CALIBRATION (tune set only: ${calibration.tuneSet}; result = pass/edge/grouping errors/abstain) ──`);
  console.log(`  ${"constant".padEnd(18)} ${"swept".padEnd(14)} ${"unchanged over".padEnd(15)} chosen   worst result in range`);
  for (const c of calibration.constants) {
    const worst = c.sweep.reduce((a, b) => (compareTune(b, a) < 0 ? b : a));
    console.log(`  ${c.constant.padEnd(18)} ${`${c.range[0]}–${c.range[1]}`.padEnd(14)} ${`${c.unchangedRange[0]}–${c.unchangedRange[1]}`.padEnd(15)} ${String(c.chosen).padEnd(8)} ${worst.pass}/${worst.edgeOk}/${worst.groupErr}/${worst.abstain} at ${worst.value}${c.changed ? `  (changed from ${c.plan})` : ""}`);
  }
} else console.log("\n── CALIBRATION ── not run (node --import tsx bench/regionsCalibrate.mts)");

// ── sensitivity: each constant at the chosen value and both ends of its unchanged-on-tune range ──
interface SensRow { constant: string; key: string; value: number; role: string; n: number; edgeOk: number; pass: number; abstain: number; dErrMedian: number | null }
let sensitivity: { scope: string; rows: SensRow[] } | null = null;
if (calibration && (heldOut || args.sensitivity)) {
  const scopeSets = heldOut ? bySection["held-out"] : [...bySection.tune, ...bySection["in-sample"]];
  const scope = heldOut ? "held-out" : "tune + in-sample (dry run of the held-out code path; in-sample, information only)";
  const runAt = (over: Partial<RegionParams>) => {
    const rows: ScoreRow[] = [];
    for (const set of scopeSets) {
      const sheets = loaded.get(set.name);
      if (!sheets) continue;
      const { regions, diag } = detectSetRegions(sheets, over);
      for (const s of sheets) {
        const lr = LR.get(s.key);
        if (s.tokens.length === 0 || !lr) continue;
        rows.push(scoreSheet(toDetected(set.name, s, regions.get(s.key)!, diag.get(s.key)!, lr.title_block?.edge ?? null), lr, tol));
      }
    }
    return summarize(rows);
  };
  const rows: SensRow[] = sensitivityPlan(calibration).map((r) => {
    const sm = runAt({ [r.key]: r.value } as Partial<RegionParams>);
    return { ...r, n: sm.n, edgeOk: sm.edgeOk, pass: sm.pass, abstain: sm.abstain, dErrMedian: sm.dErrMedian };
  });
  sensitivity = { scope, rows };
  console.log(`\n── SENSITIVITY on ${scope} — range-end numbers are sensitivity only; the chosen values stay as frozen ──`);
  for (const c of calibration.constants) {
    const rs = rows.filter((r) => r.constant === c.constant);
    console.log(`  ${c.constant.padEnd(18)} ${rs.map((r) => `${r.role} ${r.value}: pass ${fmtPass(r.pass, r.n, V)} edge ${r.edgeOk}/${r.n} abstain ${r.abstain}`).join("  |  ")}`);
  }
}

// ── output file: normal runs → regions-results.json; the held-out run → its own file only ──
const outPath = join(repo, resultsPath(mode));
writeFileSync(outPath, JSON.stringify({
  mode, commit: head, dirty, labelCommit: order.labelCommit, order,
  ...(pre.mode === "held-out" && pre.ok ? { heldOutRun: { reason: pre.reason, freezeCommit: pre.freeze.commit, hash: pre.hash, rerunOf: pre.rerunOf.map((e) => ({ at: e.at, hash: e.hash })) } } : {}),
  labels: { labelers: ["A", "B"], maintainer: "not available — agent labels only; no human noise floor" },
  answerKey: "evals/regions/labels/reconciled.json", resolved: T0.resolved,
  spread, tolerance: { frac: tol, rule: "max(2 × max(inter-agent max spread after reconciliation, maintainer), 0.5%)", interAgentMax: spread.max, interAgentP90: spread.p90, maintainer, px: tolPx.length ? { min: Math.min(...tolPx), max: Math.max(...tolPx), median: median(tolPx) } : null },
  freeze: freeze ? { frozenAt: freeze.frozenAt, commit: freeze.commit, hash: freeze.hash } : null,
  current: { hash: cur.hash, sources: cur.sources, logicRev: REGION_LOGIC_REV, params: DEFAULT_REGION_PARAMS },
  pdfs: hashes, sections: results, calibration, sensitivity,
}, null, 1) + "\n");
console.log(`\nwrote ${outPath}`);
if (pre.mode === "held-out" && pre.ok) {
  const t = results.find((r) => r.name === "held-out")?.total;
  logFinish(env, pre, { results: resultsPath(mode), heldOut: t ? { n: t.n, edgeOk: t.edgeOk, pass: t.pass, abstain: t.abstain, dErrMedian: t.dErrMedian, dErrMax: t.dErrMax } : null, tolerance: tol });
  console.log(`logged the finish to ${HELDOUT_LOG}; commit it with ${resultsPath(mode)}`);
}
