// Plan-index recall bench — the measurement "Plan search index: measured recall"
// (issue draft) asks for. Measures the index the app actually builds, through
// the app's actual ingest path (extractRegionText full-rect → buildSheetIndex),
// with five instruments:
//
//   A. coverage   — GT terms derived from RAW pdf.js items (before
//                   extractRegionText's geometry filter) vs the index's
//                   vocabulary. Any miss is a run the rect filter dropped.
//                   Expected 100%: this proves it, and pins it.
//   B. per-sheet  — for every indexed term T, searchPlan([index(S)], T) must
//                   return the sheet with T in matched[]. Pins the retrieval
//                   machinery (match/AND/score) against the vocabulary.
//   C. whole-set  — same probe against ALL sheets at once; the owning sheet
//                   must appear in the results. Pins set-level search.
//   D. variants   — deterministic TYPED forms of real terms (lowercase,
//                   space-for-hyphen, no-hyphen, drop-last-char). This is where
//                   honest losses live: e.g. "CPT 1" (space) must fail the AND,
//                   because "1" is not a searchable term. Reported per class —
//                   a class at 100% is a proven behavior, not an accident.
//                   (Slash-callout halves are NOT a variant class: expandTerm
//                   pre-indexes each part at build time, so querying a part is
//                   an exact hit on existing vocabulary — already covered by
//                   A/B; restating it here would claim a proof it isn't.)
//   E. junk FP    — engineered no-support queries (term+"QZ", verified to
//                   prefix-match nothing in ANY sheet's vocabulary, plus pure
//                   garbage). Any hit is a false positive.
//
// Doctrine (docs/OCR-EVAL-DOCTRINE.md draft): canary — a page with text items
// whose GT set is empty is an ERROR, not a zero; determinism — indexes are
// built twice and must be JSON-identical; n=1 corpus stated in the doc.
//
// Run: node --import tsx scripts/plan-index-recall-bench.mjs [--pdf path] [--json out]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");

// argv
const args = process.argv.slice(2);
const pdfArg = args[args.indexOf("--pdf") + 1];
const jsonArg = args[args.indexOf("--json") + 1];
const PDF = pdfArg && pdfArg !== "--json" ? pdfArg : join(web, "public/demo/sample-finish-plan.pdf");

// the app's own modules — the real pipeline, not a reimplementation
const { RENDER_SCALE, extractRegionText } = await import(join(web, "src/lib/sheets.ts"));
const { buildSheetIndex, searchPlan, splitRun, normalizeTerm, expandTerm, isSearchable } =
  await import(join(web, "src/lib/planIndex.ts"));

// pdf.js: legacy build is the Node-safe one. sheets.ts pulls the browser main
// for Util.transform (pure static math), which loads fine here.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

// ── GT through the same term pipeline the index uses ─────────────────────────
function gtTermsFromStrings(strs) {
  const set = new Set();
  for (const str of strs) {
    for (const raw of splitRun(str)) {
      const token = normalizeTerm(raw);
      if (!token) continue;
      for (const term of expandTerm(token)) if (isSearchable(term)) set.add(term);
    }
  }
  return set;
}

// ── load + index every page through the app's path ───────────────────────────
const data = new Uint8Array(readFileSync(PDF));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
const file = basename(PDF);
const indexes = [];
const rawPerSheet = [];   // GT_A source: raw item strings, pre-geometry-filter
const textlessPages = []; // pages with zero text items (scan-like): recorded, not scored

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const tc = await page.getTextContent();
  const key = `${file}#${p}`;
  const rawItemCount = (tc.items || []).length;

  // canary, two distinct failures: (a) items exist but every str is blank —
  // getTextContent degenerated; broken bench, never a score. (b) no items at
  // all — a genuinely text-less page: recorded below, excluded from every
  // denominator, visible in the report instead of silently absent.
  const rawStrs = (tc.items || []).map((it) => it.str || "").filter((s) => s.trim());
  if (rawItemCount > 0 && rawStrs.length === 0)
    throw new Error(`canary: page ${p} has ${rawItemCount} text items but every str is blank`);
  if (rawItemCount === 0) textlessPages.push(key);
  const gt = gtTermsFromStrings(rawStrs);
  if (rawStrs.length && gt.size === 0)
    throw new Error(`canary: page ${p} has ${rawStrs.length} text runs but zero GT terms`);

  // the app's exact ingest (TakeoffCanvas.indexSheetText / PlanNavigator.indexSheet)
  const items = extractRegionText(tc, viewport, { x0: 0, y0: 0, x1: viewport.width, y1: viewport.height });
  const idx = buildSheetIndex(key, items, "text", 0, { w: viewport.width, h: viewport.height });

  indexes.push(idx);
  rawPerSheet.push({ key, p, gt, runCount: rawStrs.length, itemCount: items.length });
}

// canary: a whole plan with zero GT terms is a broken bench (wrong PDF?)
const totalGt = rawPerSheet.reduce((n, s) => n + s.gt.size, 0);
if (totalGt === 0) throw new Error("canary: zero GT terms across the whole plan");

// determinism: rebuild page 1 and compare JSON
{
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const tc = await page.getTextContent();
  const items = extractRegionText(tc, viewport, { x0: 0, y0: 0, x1: viewport.width, y1: viewport.height });
  const again = buildSheetIndex(`${file}#1`, items, "text", 0, { w: viewport.width, h: viewport.height });
  if (JSON.stringify(again) !== JSON.stringify(indexes[0])) throw new Error("determinism: rebuild differs");
}

// ── A. coverage: raw-pipeline GT vs index vocabulary ─────────────────────────
const coverage = [];
for (const s of rawPerSheet) {
  const idx = indexes.find((i) => i.key === s.key);
  const vocab = new Set(Object.keys(idx.terms));
  const misses = [...s.gt].filter((t) => !vocab.has(t));
  coverage.push({ key: s.key, gt: s.gt.size, indexed: vocab.size, misses, runs: s.runCount, items: s.itemCount });
}
const covTotal = coverage.reduce((n, c) => n + c.gt, 0);
const covHit = covTotal - coverage.reduce((n, c) => n + c.misses.length, 0);

// ── B + C. term recall: per-sheet and whole-set probes ───────────────────────
let bMiss = 0, cMiss = 0;
const bExamples = [], cExamples = [];
for (const s of rawPerSheet) {
  const idx = indexes.find((i) => i.key === s.key);
  for (const term of Object.keys(idx.terms)) {
    // B: single-sheet probe — the term must come back in matched[]
    const solo = searchPlan([idx], term);
    if (!(solo.length === 1 && solo[0].key === s.key && solo[0].matched.includes(term))) {
      bMiss++;
      if (bExamples.length < 5) bExamples.push({ key: s.key, term });
    }
    // C: whole-set probe — the owning sheet must be in the results
    const all = searchPlan(indexes, term);
    if (!all.some((h) => h.key === s.key && h.matched.includes(term))) {
      cMiss++;
      if (cExamples.length < 5) cExamples.push({ key: s.key, term });
    }
  }
}
const bTotal = rawPerSheet.reduce((n, s) => n + Object.keys(indexes.find((i) => i.key === s.key).terms).length, 0);

// ── D. typed variants of real terms (the honest-gap instrument) ──────────────
// Deterministic, no RNG: for every (sheet, term) in stable term order, apply
// each class. Classes where a miss is BY DESIGN (documented behavior) are
// still reported — the number is the UX surface of that design.
const variantClasses = [
  { name: "lowercase", make: (t) => t.toLowerCase() },
  { name: "space-for-hyphen", make: (t) => (t.includes("-") ? t.replaceAll("-", " ") : null) },
  { name: "no-hyphen", make: (t) => (t.includes("-") ? t.replaceAll("-", "") : null) },
  { name: "drop-last-char", make: (t) => (t.length > 1 ? t.slice(0, -1) : null) },
];
const variants = variantClasses.map((c) => ({ ...c, hit: 0, miss: 0, misses: [] }));
for (const s of rawPerSheet) {
  const idx = indexes.find((i) => i.key === s.key);
  for (const term of Object.keys(idx.terms).sort()) {
    for (const v of variants) {
      const q = v.make(term);
      if (q == null || !q.trim()) continue;
      const hits = searchPlan(indexes, q);
      const ok = hits.some((h) => h.key === s.key);
      if (ok) v.hit++;
      else {
        v.miss++;
        if (v.misses.length < 5) v.misses.push({ key: s.key, term, typed: q });
      }
    }
  }
}

// ── E. junk FP: engineered no-support queries ────────────────────────────────
const allVocab = new Set(indexes.flatMap((i) => Object.keys(i.terms)));
const junk = [];
for (const term of [...allVocab].sort()) {
  const q = term + "QZ";
  if ([...allVocab].some((t) => t.startsWith(q))) continue; // must have zero support
  junk.push(q);
}
for (const g of ["ZZQQ", "QQ-99", "XXYYZZ", "WW12ZZ"]) junk.push(g);
const junkHits = junk.filter((q) => searchPlan(indexes, q).length > 0);

// Best-effort parity between the legacy (Node) build this bench drives and the
// main (browser) build the app ships: same pages, same item strings. When the
// main build cannot load under Node, the assumption is stated, not hidden.
async function mainBuildParity() {
  try {
    const main = await import("pdfjs-dist/build/pdf.mjs");
    const d2 = await main.getDocument({ data: new Uint8Array(readFileSync(PDF)), isEvalSupported: false, useSystemFonts: false }).promise;
    for (let p = 1; p <= Math.min(d2.numPages, doc.numPages); p++) {
      const a = (await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join("\u0001");
      const b = (await (await d2.getPage(p)).getTextContent()).items.map((i) => i.str).join("\u0001");
      if (a !== b) return `differs on page ${p} — legacy/main text extraction NOT equivalent`;
    }
    return "verified: legacy and main builds extract identical item strings";
  } catch (e) {
    return `assumed: main build unavailable under Node (${String(e).slice(0, 80)})`;
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const pct = (n, d) => (d ? (100 * n) / d : 100);
const result = {
  pdf: file, pages: indexes.length, textlessPages,
  corpus: "n=1 (demo plan) — engines/pipelines deterministic",
  populations: "A/B/C denominators count terms per SHEET (a term on both sheets counts twice); E queries come from the plan-wide DISTINCT vocabulary",
  tokenCount: indexes.reduce((n, i) => n + i.tokenCount, 0),
  perSheet: coverage.map((c) => ({
    key: c.key, runs: c.runs, itemsAfterRect: c.items,
    gtTerms: c.gt, indexedTerms: c.indexed,
    coverageMisses: c.misses,
  })),
  A_coverage: { gt: covTotal, hit: covHit, recall: +pct(covHit, covTotal).toFixed(2) },
  B_perSheetTermRecall: { probes: bTotal, miss: bMiss, recall: +pct(bTotal - bMiss, bTotal).toFixed(2), examples: bExamples },
  C_wholeSetTermRecall: { probes: bTotal, miss: cMiss, recall: +pct(bTotal - cMiss, bTotal).toFixed(2), examples: cExamples },
  D_typedVariants: variants.map((v) => {
    const n = v.hit + v.miss;
    return { class: v.name, n, hit: v.hit, recall: +pct(v.hit, n).toFixed(2), misses: v.misses };
  }),
  E_junkFP: { queries: junk.length, falseHits: junkHits.length, rate: +pct(junkHits.length, junk.length).toFixed(2), hits: junkHits },
  determinism: "pass (page-1 rebuild JSON-identical; builtAt pinned 0 in both builds)",
  pdfjsParity: await mainBuildParity(),
};

const W = 46;
const line = (k, v) => `${k.padEnd(W)} ${v}`;
console.error(`plan-index recall bench — ${file} (${indexes.length} pages, ${result.tokenCount} tokens, ${textlessPages.length} text-less)`);
console.error(line("A raw-pipeline coverage", `${result.A_coverage.recall}%  (${result.A_coverage.hit}/${result.A_coverage.gt})`));
console.error(line("B per-sheet term recall", `${result.B_perSheetTermRecall.recall}%  (${result.B_perSheetTermRecall.miss} misses)`));
console.error(line("C whole-set term recall", `${result.C_wholeSetTermRecall.recall}%  (${result.C_wholeSetTermRecall.miss} misses)`));
for (const v of result.D_typedVariants) console.error(line(`D variant: ${v.class}`, `${v.recall}%  (${v.hit}/${v.n})`));
console.error(line("E junk false-positive rate", `${result.E_junkFP.rate}%  (${result.E_junkFP.falseHits}/${result.E_junkFP.queries})`));
console.error(line("determinism", result.determinism));
console.error(line("pdf.js legacy/main parity", String(result.pdfjsParity)));

if (jsonArg) { writeFileSync(jsonArg, JSON.stringify(result, null, 2) + "\n"); console.error(`wrote ${jsonArg}`); }
