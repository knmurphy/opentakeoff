// The schedule-OCR harness (docs/SCHEDULE-OCR.md). Invariants:
//   - scoring: CER/detection/row metrics behave on known inputs, and row
//     matching keys on finish_tag as a multiset (a misread tag = a lost row);
//   - the noise oracle is deterministic per seed, identity at zero noise, and
//     its measured corpus CER lands near the nominal request;
//   - the fixture seam: the committed vector text layer parses to the golden
//     28 rows via the SAME parser the app ships — and the two known parser
//     limitations on this real layout are PINNED (category on the MISC.
//     FINISHES section, remarks bleeding into SIZE), so a parser fix shows up
//     here as a deliberate test update, not silent drift;
//   - the collapse mode the oracle sweep exposed: lose a header anchor word
//     and the whole parse returns [] (rows are lost wholesale, not degraded).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedule, type ScheduleRow } from "../src/lib/scheduleParse.js";
import { wordsToTokens, wordBbox, type OcrWord } from "../src/lib/ocr/types.js";
import { degradeWords, mulberry32 } from "../src/lib/ocr/noise.js";
import { levenshtein, cer, corpusCer, normField, matchWords, scoreRows } from "../src/lib/ocr/score.js";

const fixDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "schedule-ocr");
const fixture = JSON.parse(readFileSync(join(fixDir, "material-schedule.words.json"), "utf8")) as { words: OcrWord[] };
const golden = JSON.parse(readFileSync(join(fixDir, "material-schedule.golden.json"), "utf8")) as ScheduleRow[];

// ── scoring primitives ───────────────────────────────────────────────────────

test("levenshtein and cer on known cases", () => {
  assert.equal(levenshtein("", ""), 0);
  assert.equal(levenshtein("CPT-1", "CPT-1"), 0);
  assert.equal(levenshtein("CPT-1", "CP7-1"), 1);
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("CODE", ""), 4);
  assert.equal(cer("CPT-1", "CP7-1"), 1 / 5);
  assert.equal(cer("", ""), 0);
  assert.equal(cer("", "X"), 1); // hallucinated text against an empty ref
  assert.equal(corpusCer([["ABCD", "ABCD"], ["AB", "XB"]]), 1 / 6);
});

test("normField folds case and whitespace, nothing else", () => {
  assert.equal(normField("  Pay   Day "), "PAY DAY");
  assert.equal(normField('12" x 12"'), '12" X 12"');
  assert.equal(normField(""), "");
});

test("matchWords pairs by IoU, reports misses and spurious boxes", () => {
  const gt: OcrWord[] = [
    { str: "CODE", x: 0, y: 20, w: 40, h: 10 },
    { str: "COLOR", x: 100, y: 20, w: 50, h: 10 },
  ];
  const pred: OcrWord[] = [
    { str: "C0DE", x: 1, y: 20, w: 40, h: 10 },     // near-perfect box, one confusion
    { str: "GHOST", x: 300, y: 200, w: 50, h: 10 }, // overlaps nothing
  ];
  const r = matchWords(gt, pred);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].gt.str, "CODE");
  assert.equal(r.missed.length, 1);
  assert.equal(r.missed[0].str, "COLOR");
  assert.equal(r.spurious.length, 1);
  assert.equal(r.detectionRecall, 0.5);
  assert.equal(r.detectionPrecision, 0.5);
  assert.equal(r.matchedCer, 1 / 4);
});

test("wordBbox treats y as the baseline", () => {
  assert.deepEqual(wordBbox({ str: "A", x: 10, y: 30, w: 8, h: 12 }), [10, 18, 18, 30]);
});

test("scoreRows: perfect, lost-row, and field-typo cases", () => {
  const rows = golden.slice(0, 4);
  const perfect = scoreRows(rows, rows);
  assert.equal(perfect.rowRecall, 1);
  assert.equal(perfect.fieldAccOverall, 1);
  assert.equal(perfect.perfectRows, 4);

  // a misread tag is a LOST row (and a spurious one), not a typo
  const misTag = rows.map((r, i) => (i === 0 ? { ...r, finish_tag: "CP7-1" } : r));
  const lost = scoreRows(rows, misTag);
  assert.equal(lost.matched, 3);
  assert.equal(lost.rowRecall, 3 / 4);
  assert.equal(lost.rowPrecision, 3 / 4);

  // a field typo keeps the row but dents exactly one field
  const typo = rows.map((r, i) => (i === 1 ? { ...r, manufacturer: "J+J 1NVISION" } : r));
  const dented = scoreRows(rows, typo);
  assert.equal(dented.rowRecall, 1);
  assert.equal(dented.fieldAcc.manufacturer, 3 / 4);
  assert.equal(dented.fieldAcc.description, 1);
  assert.equal(dented.perfectRows, 3);
});

test("scoreRows matches duplicate tags as a multiset", () => {
  const a = { ...golden[0] };
  const gt = [a, { ...a, description: "SECOND ROW SAME TAG" }];
  const one = scoreRows(gt, [a]);
  assert.equal(one.matched, 1);
  assert.equal(one.rowRecall, 0.5);
});

// ── the noise oracle ─────────────────────────────────────────────────────────

test("mulberry32 is deterministic and uniform-ish", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const seqA = Array.from({ length: 5 }, a);
  assert.deepEqual(seqA, Array.from({ length: 5 }, b));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, c));
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test("degradeWords: zero noise is identity, same seed is same output", () => {
  assert.deepEqual(degradeWords(fixture.words, {}, 7), fixture.words);
  const a = degradeWords(fixture.words, { cer: 0.05, dropRate: 0.05 }, 7);
  const b = degradeWords(fixture.words, { cer: 0.05, dropRate: 0.05 }, 7);
  assert.deepEqual(a, b);
  const c = degradeWords(fixture.words, { cer: 0.05, dropRate: 0.05 }, 8);
  assert.notDeepEqual(a, c);
});

test("degradeWords: measured corpus CER lands near the nominal request", () => {
  // boxes are untouched, so IoU matching recovers the pairing exactly
  const noisy = degradeWords(fixture.words, { cer: 0.05 }, 1);
  const { matchedCer, detectionRecall } = matchWords(fixture.words, noisy);
  assert.equal(detectionRecall, 1); // no drops requested
  assert.ok(matchedCer > 0.025 && matchedCer < 0.085, `measured ${matchedCer}`);
});

test("degradeWords: dropRate removes words, boxes of survivors are untouched", () => {
  const noisy = degradeWords(fixture.words, { dropRate: 0.5 }, 3);
  assert.ok(noisy.length < fixture.words.length);
  const { detectionRecall, matchedCer } = matchWords(fixture.words, noisy);
  assert.ok(detectionRecall < 1);
  assert.equal(matchedCer, 0); // drops only — surviving text is pristine
});

// ── the fixture seam: vector text layer → the shipped parser ─────────────────

test("committed words parse to the golden 28 rows through the real parser", () => {
  const rows = parseSchedule(wordsToTokens(fixture.words));
  assert.equal(rows.length, 28);
  assert.deepEqual(rows.map((r) => r.finish_tag), golden.map((g) => g.finish_tag));
  const s = scoreRows(golden, rows);
  assert.equal(s.rowRecall, 1);
  assert.equal(s.rowPrecision, 1);
  // Former limitation #1, now FIXED by parser hardening: "MISC. FINISHES"
  // folds to MISCFINISHES, which the fuzzy section resolver maps to MISC
  // (transition) by prefix. All 28 categories are now correct (was 22/28).
  assert.equal(s.fieldAcc.category, 1);
  // Limitation #2 STILL PINNED (a geometry issue the text-hardening doesn't
  // touch): remarks-column text (grout + sheen notes, 8 rows) sits nearer the
  // SIZE anchor than the REMARKS anchor on this real layout, so nearest-anchor
  // banding smears it into size. This is the next hardening target (anchor
  // geometry), not a noise-tolerance one.
  assert.equal(s.fieldAcc.size, 20 / 28);
  // everything else is exact
  assert.equal(s.fieldAcc.description, 1);
  assert.equal(s.fieldAcc.manufacturer, 1);
  assert.equal(s.fieldAcc.style, 1);
  assert.equal(s.fieldAcc.spec_color, 1);
  assert.equal(s.perfectRows, 20);
});

test("losing the CODE header word collapses the whole parse — the cliff the sweep measures", () => {
  const noCode = fixture.words.filter((w) => !(w.str === "CODE" && w.y < 400));
  assert.equal(noCode.length, fixture.words.length - 1);
  // fuzzy matching helps CHAR noise, not a whole DROPPED anchor word — this
  // stays the drop cliff, and the harness's dropSweep is what measures it
  assert.deepEqual(parseSchedule(wordsToTokens(noCode)), []);
});

// ── parser hardening: fuzzy header / section / code (docs/SCHEDULE-OCR.md) ────

/** Corrupt one character of the first token whose str === `word` near the top
 * of the region (headers/sections live there), simulating a single glyph
 * confusion. Returns a fresh word array. */
function confuseFirst(words: OcrWord[], word: string, replacement: string): OcrWord[] {
  const i = words.findIndex((w) => w.str === word);
  assert.ok(i >= 0, `no "${word}" token to corrupt`);
  return words.map((w, j) => (j === i ? { ...w, str: replacement } : w));
}

test("a confused CODE header (C0DE) no longer drops the schedule", () => {
  // pre-hardening this returned [] — the sharpest cliff Experiment 1 found
  const noisy = confuseFirst(fixture.words, "CODE", "C0DE");
  const rows = parseSchedule(wordsToTokens(noisy));
  assert.equal(rows.length, 28);
  assert.equal(scoreRows(golden, rows).rowRecall, 1);
});

test("a confused section header (FLOORING → FL0ORING) keeps its block's category", () => {
  const noisy = confuseFirst(fixture.words, "FLOORING", "FL0ORING");
  const rows = parseSchedule(wordsToTokens(noisy));
  // CPT-1..C stay floor instead of falling through to the section above
  for (const tag of ["CPT-1", "CPT-2", "VCT-1", "PT-1", "PT-2", "C"]) {
    assert.equal(rows.find((r) => r.finish_tag === tag)?.category, "floor", tag);
  }
});

test("a confused code glyph (CPT-1 → CP7-1) still yields a row", () => {
  const noisy = confuseFirst(fixture.words, "CPT-1", "CP7-1");
  const rows = parseSchedule(wordsToTokens(noisy));
  assert.equal(rows.length, 28);
  // the row survives under its (mis-read) tag rather than vanishing
  assert.ok(rows.some((r) => r.finish_tag === "CP7-1"));
});

test("hardening is conservative: a lone number is never mistaken for a code", () => {
  // inject a stray numeric first-cell row inside the schedule body
  const stray: OcrWord[] = [{ str: "51839", x: 2986, y: 700, w: 90, h: 25 }];
  const rows = parseSchedule(wordsToTokens([...fixture.words, ...stray]));
  assert.ok(!rows.some((r) => r.finish_tag === "51839"));
  assert.equal(rows.length, 28); // nothing invented
});
