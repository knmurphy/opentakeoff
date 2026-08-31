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
import { renderDims, cropBoxToWord, type RenderGeometry } from "../src/lib/ocr/raster.js";

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

// ── rasterization geometry (crop-px ↔ image-px round trip) ───────────────────

test("renderDims scales the rect by zoom", () => {
  const g: RenderGeometry = { rect: { x0: 100, y0: 50, x1: 1100, y1: 550 }, zoom: 2 };
  assert.deepEqual(renderDims(g), { width: 2000, height: 1000 });
  assert.deepEqual(renderDims({ ...g, zoom: 1 }), { width: 1000, height: 500 });
});

test("cropBoxToWord inverts the render transform (a truth word survives a round trip)", () => {
  const g: RenderGeometry = { rect: { x0: 2300, y0: 250, x1: 5050, y1: 2000 }, zoom: 2 };
  // a truth word in image-px @ RENDER_SCALE (x left, y baseline, h cap height)
  const truth: OcrWord = { str: "CPT-1", x: 2986, y: 469, w: 48, h: 17 };
  // forward: image-px → crop-px (what a renderer + engine would report)
  const box = {
    x0: (truth.x - g.rect.x0) * g.zoom,
    y0: (truth.y - truth.h - g.rect.y0) * g.zoom, // box top = baseline − capheight
    x1: (truth.x + truth.w - g.rect.x0) * g.zoom,
    y1: (truth.y - g.rect.y0) * g.zoom,           // box bottom = baseline
  };
  const back = cropBoxToWord(truth.str, box, g);
  assert.equal(back.str, "CPT-1");
  for (const k of ["x", "y", "w", "h"] as const) {
    assert.ok(Math.abs(back[k] - truth[k]) < 1e-6, `${k}: ${back[k]} vs ${truth[k]}`);
  }
});

test("cropBoxToWord carries confidence when given", () => {
  const g: RenderGeometry = { rect: { x0: 0, y0: 0, x1: 100, y1: 100 }, zoom: 1 };
  assert.equal(cropBoxToWord("X", { x0: 0, y0: 0, x1: 10, y1: 10 }, g, 0.9).confidence, 0.9);
  assert.equal(cropBoxToWord("X", { x0: 0, y0: 0, x1: 10, y1: 10 }, g).confidence, undefined);
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

// ── cell-level / section-independent parsing (docs/SCHEDULE-CELL-PARSING-SPEC.md)
// A row's existence must NOT depend on a section header — the single most
// droppable token on the sheet. These score REAL PaddleOCR output captured at
// three DPIs (material-schedule.paddle-<dpi>.json), where section-header
// detection is erratic but the data rows are all present.

const PADDLE_DPIS = [144, 216, 288] as const;
const paddleWords = (dpi: number): OcrWord[] =>
  (JSON.parse(readFileSync(join(fixDir, `material-schedule.paddle-${dpi}.json`), "utf8")) as { words: OcrWord[] }).words;

// The acceptance bars the adversarial review insisted on: NOT a single exact-tag
// recall number (which double-charges the parser for the engine's code-cell
// CER), but rows-emitted + fuzzy-tag recall + precision, PLUS category — lifted
// by the blank-band section reset (step 5a, docs/SCHEDULE-SECTION-RESET-SPEC.md)
// but still pinned as a floor so it can't silently worsen or be hidden behind a
// blended average. All figures are the demo material schedule only (n=1).
// Category floor per DPI: the reset fixes the stale-latch DPIs (144: 50.0→59.1%,
// 288: 38.5→53.8%) and is a no-op where the failure is pure inference, not a
// stale latch (216 unchanged at 57.7% — most section words dropped, nothing to
// reset). These are FLOORS below the measured values, not the values themselves.
const CATEGORY_FLOOR: Record<(typeof PADDLE_DPIS)[number], number> = { 144: 0.55, 216: 0.55, 288: 0.5 };
for (const dpi of PADDLE_DPIS) {
  test(`PaddleOCR @ ${dpi}dpi: rows survive the engine (emitted + fuzzy recall + precision)`, () => {
    const rows = parseSchedule(wordsToTokens(paddleWords(dpi)));
    const exact = scoreRows(golden, rows);
    const fuzzy = scoreRows(golden, rows, { tagEdits: 1 });
    // rows emitted: the gate removal must keep producing rows (24/28 floor).
    assert.ok(rows.length >= 24, `${dpi}dpi emitted only ${rows.length}/28 rows`);
    // fuzzy-tag recall isolates "row emitted & matchable" from the engine's
    // tag CER (a misread CT-2→C-2 is the engine's error, not the parser's).
    assert.ok(fuzzy.rowRecall >= 0.87, `${dpi}dpi fuzzy recall ${(fuzzy.rowRecall * 100).toFixed(1)}% < 87%`);
    // precision guards against invented rows now the section gate is gone.
    assert.ok(exact.rowPrecision >= 0.85, `${dpi}dpi precision ${(exact.rowPrecision * 100).toFixed(1)}% < 85%`);
    // category floor, lifted by the section reset (was a flat 0.35 "documented
    // bad"); the reset converts confidently-wrong latched categories into the
    // correct one (prefix-inferable) or an honest "other". Still a KNOWN GAP on
    // the OCR path — 216's pure-inference misses are out of scope (the spec).
    assert.ok(exact.fieldAcc.category >= CATEGORY_FLOOR[dpi], `${dpi}dpi category ${(exact.fieldAcc.category * 100).toFixed(1)}% < ${CATEGORY_FLOOR[dpi] * 100}%`);
  });
}

test("the section-header collapse is gone: exact recall no longer craters at any DPI", () => {
  // Pre-fix spread was 75 points (17.9% at 216 → 92.9% at 288). The claim of
  // step 4 is that the spread collapses — recall is bounded by the engine's
  // read rate, not by which isolated section words survived detection.
  const recalls = PADDLE_DPIS.map((d) => scoreRows(golden, parseSchedule(wordsToTokens(paddleWords(d)))).rowRecall);
  // A regression TRIPWIRE, not a target: 0.75 sits just under the observed 78.6%
  // so a genuine collapse trips it, without flaking on a 1-row jitter.
  assert.ok(Math.min(...recalls) >= 0.75, `min recall ${(Math.min(...recalls) * 100).toFixed(1)}% — a DPI collapsed`);
  assert.ok(Math.max(...recalls) - Math.min(...recalls) <= 0.2, `recall spread ${((Math.max(...recalls) - Math.min(...recalls)) * 100).toFixed(1)}pts still wide`);
});

test("a data row with NO section header above it is still emitted", () => {
  // header + two data rows, but no FLOORING/BASE/... line at all
  const H = 14;
  const words: OcrWord[] = [
    // header row
    { str: "CODE", x: 40, y: 40, w: 40, h: H }, { str: "MANUFACTURER", x: 360, y: 40, w: 120, h: H }, { str: "COLOR", x: 960, y: 40, w: 60, h: H },
    // data rows, no section header anywhere
    { str: "CPT-1", x: 40, y: 90, w: 48, h: H }, { str: "SHAW", x: 360, y: 90, w: 60, h: H }, { str: "GREY 12", x: 960, y: 90, w: 70, h: H },
    { str: "RB-1", x: 40, y: 140, w: 44, h: H }, { str: "JOHNSONITE", x: 360, y: 140, w: 90, h: H }, { str: "BLACK", x: 960, y: 140, w: 50, h: H },
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.deepEqual(rows.map((r) => r.finish_tag), ["CPT-1", "RB-1"]);
  // conservative prefix inference fills category when no section is active
  assert.equal(rows.find((r) => r.finish_tag === "CPT-1")?.category, "floor");
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category, "base");
});

test("prefix inference is conservative: ambiguous prefixes fall back to 'other'", () => {
  const H = 14;
  const words: OcrWord[] = [
    { str: "CODE", x: 40, y: 40, w: 40, h: H }, { str: "MANUFACTURER", x: 360, y: 40, w: 120, h: H }, { str: "COLOR", x: 960, y: 40, w: 60, h: H },
    // PT (porcelain — floor OR wall) and P (paint — wall) are ambiguous; no guess
    { str: "PT-9", x: 40, y: 90, w: 44, h: H }, { str: "DALTILE", x: 360, y: 90, w: 70, h: H }, { str: "TAN", x: 960, y: 90, w: 40, h: H },
  ];
  const pt = parseSchedule(wordsToTokens(words)).find((r) => r.finish_tag === "PT-9");
  assert.equal(pt?.category, "other");
  assert.equal(pt?.suggested, false);
});

test("prefix inference never overrides a detected section (clean-path safety)", () => {
  // A BASE section over a CT code: prefix CT is ambiguous, but even a confident
  // prefix must never beat the section. CT-3 under BASE must be `base`.
  const H = 14;
  const words: OcrWord[] = [
    { str: "CODE", x: 40, y: 40, w: 40, h: H }, { str: "MANUFACTURER", x: 360, y: 40, w: 120, h: H }, { str: "COLOR", x: 960, y: 40, w: 60, h: H },
    { str: "BASE", x: 40, y: 90, w: 40, h: H },
    { str: "CPT-9", x: 40, y: 140, w: 48, h: H }, { str: "SHAW", x: 360, y: 140, w: 60, h: H }, { str: "RED", x: 960, y: 140, w: 40, h: H },
  ];
  // CPT prefix says floor, but the BASE section is authoritative
  assert.equal(parseSchedule(wordsToTokens(words)).find((r) => r.finish_tag === "CPT-9")?.category, "base");
});

test("the header row is never emitted as a data row", () => {
  // "CODE" is code-shaped (4 caps); with the section gate gone it must still be
  // skipped as the header, not turned into a finish_tag.
  const rows = parseSchedule(wordsToTokens(fixture.words));
  assert.ok(!rows.some((r) => r.finish_tag === "CODE"));
  assert.equal(rows.length, 28); // clean path unchanged
});

// ── adversarial-review hardening (junk suppression after the section gate went)
// Removing the section gate broadened what emits as a row; these pin the
// spec's "nothing is invented" invariant on the inputs that actually stress it.

const hdrRow = (y: number): OcrWord[] => [
  { str: "CODE", x: 40, y, w: 40, h: 14 }, { str: "MANUFACTURER", x: 360, y, w: 120, h: 14 }, { str: "COLOR", x: 960, y, w: 60, h: 14 },
];
const dataRow = (tag: string, y: number): OcrWord[] => [
  { str: tag, x: 40, y, w: 48, h: 14 }, { str: "ACME", x: 360, y, w: 60, h: 14 }, { str: "GREY", x: 960, y, w: 50, h: 14 },
];

test("multi-table marquee: a second table's header never emits a CODE row", () => {
  const words = [
    ...hdrRow(40), ...dataRow("CPT-1", 90), ...dataRow("VCT-1", 140),
    ...hdrRow(300), ...dataRow("RB-1", 350), // a second stacked table
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.ok(!rows.some((r) => ["CODE", "MANUFACTURER", "COLOR"].includes(r.finish_tag)), "header words leaked as rows");
  assert.deepEqual(rows.map((r) => r.finish_tag).sort(), ["CPT-1", "RB-1", "VCT-1"]);
});

test("a finish code whose prefix is a section word still emits and does not latch a section", () => {
  // "BASE-1" folds to section key BASE — but the "-1" makes it a CODE, not a
  // section header. It must emit, and must NOT set the current section (which
  // would mis-categorize the row beneath it).
  const words = [...hdrRow(40), ...dataRow("BASE-1", 90), ...dataRow("VCT-1", 140)];
  const rows = parseSchedule(wordsToTokens(words));
  assert.deepEqual(rows.map((r) => r.finish_tag), ["BASE-1", "VCT-1"]);
  // VCT-1 must not have inherited a "base" section from BASE-1
  assert.equal(rows.find((r) => r.finish_tag === "VCT-1")?.category, "floor");
});

test("a stray lone letter / short note below the header does not emit a row", () => {
  // a revision bubble "A" and a two-letter note "GC", each alone on their line
  const words = [
    ...hdrRow(40), ...dataRow("CPT-1", 90),
    { str: "A", x: 40, y: 140, w: 20, h: 14 },   // revision bubble, no other cells
    { str: "GC", x: 40, y: 190, w: 24, h: 14 },  // stray note, no other cells
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.deepEqual(rows.map((r) => r.finish_tag), ["CPT-1"]);
});

test("no valid header anywhere → [] (body-only text invents nothing)", () => {
  const words = [...dataRow("CPT-1", 40), ...dataRow("RB-1", 90)]; // data shapes, no header row
  assert.deepEqual(parseSchedule(wordsToTokens(words)), []);
});

test("a section label ABOVE the column header still drives category (layout invariance)", () => {
  // FLOORING sits above the CODE/... header row; PT-1's category must come from
  // it, not fall to prefix inference (which deliberately returns "other" for PT).
  const words = [
    { str: "FLOORING", x: 40, y: 20, w: 120, h: 14 },
    ...hdrRow(60), ...dataRow("PT-1", 110),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.equal(rows.find((r) => r.finish_tag === "PT-1")?.category, "floor");
});

// ── blank-band section reset (docs/SCHEDULE-SECTION-RESET-SPEC.md, step 5a) ────
// A DROPPED mid-table section header must not latch its predecessor's category
// onto the rows beneath it. The signal is the blank band the header left behind:
// a vertical gap larger than K× the table's median data-row gap. The rule keys on
// the MEDIAN-RELATIVE gap, never an absolute k·h — the vector text layer and
// PaddleOCR measure token height differently, so an absolute multiple that fires
// on an OCR band also fires on every vector row. Below the header a vector table's
// gaps are ≤ 1.36× its median (so the reset never fires on the shipped path);
// an OCR dropped-section band is ≥ 2.7× (so it always does). All real-fixture
// figures are the demo material schedule only (n=1).

test("the section reset never fires on the vector path: golden-28 category is still 100%", () => {
  // The shipped invariant. On a vector schedule every section header is present
  // and every below-header gap is ≤ 1.36× the median, so K=1.6 means no reset —
  // category comes from the real section headers exactly as before, byte-for-byte.
  const rows = parseSchedule(wordsToTokens(fixture.words));
  const s = scoreRows(golden, rows);
  assert.equal(rows.length, 28);
  assert.equal(s.rowRecall, 1);
  assert.equal(s.rowPrecision, 1);
  assert.equal(s.fieldAcc.category, 1);
  assert.equal(s.perfectRows, 20);
});

// Emission is category-only: the reset must not change WHICH rows are emitted at
// any DPI, only their category. Pinned tag counts + recall/precision guard that.
const EMITTED_ROWS: Record<(typeof PADDLE_DPIS)[number], number> = { 144: 25, 216: 27, 288: 27 };
for (const dpi of PADDLE_DPIS) {
  test(`section reset is category-only: emission at ${dpi}dpi is unchanged`, () => {
    const rows = parseSchedule(wordsToTokens(paddleWords(dpi)));
    assert.equal(rows.length, EMITTED_ROWS[dpi], `${dpi}dpi emitted ${rows.length}, expected ${EMITTED_ROWS[dpi]}`);
    // RB-1 and CBT-1 (the BASE section) must read `base`, NOT the stale `floor`
    // latched from FLOORING when the BASE header is dropped — the exact defect.
    const rb = rows.find((r) => r.finish_tag === "RB-1");
    const cbt = rows.find((r) => r.finish_tag === "CBT-1");
    if (rb) assert.equal(rb.category, "base", `${dpi}dpi RB-1 latched ${rb.category}`);
    if (cbt) assert.equal(cbt.category, "base", `${dpi}dpi CBT-1 latched ${cbt.category}`);
    // and no base row is emitted default-checked as a floor (a silent wrong bid)
    for (const tag of ["RB-1", "CBT-1"]) {
      const r = rows.find((x) => x.finish_tag === tag);
      if (r) assert.notEqual(r.category, "floor", `${dpi}dpi ${tag} still bids as floor`);
    }
  });
}

test("a dropped mid-table section header + a blank band: rows below do NOT inherit the prior category", () => {
  // FLOORING present, BASE header dropped but its band (a 100px gap vs the 40px
  // row pitch) remains. RB-1/CBT-1 must reset off FLOORING → prefix-inferred base.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    w("CPT-2", 40, 160), w("SHAW", 360, 160), w("TAN", 960, 160),
    w("VCT-1", 40, 200), w("ARMSTRONG", 360, 200), w("WHITE", 960, 200),
    // BASE header dropped by OCR — only the blank band (gap 100 ≫ 1.6×40) is left
    w("RB-1", 40, 300), w("VPI", 360, 300), w("FAWN", 960, 300),
    w("CBT-1", 40, 340), w("JJ", 360, 340), w("ROLLER", 960, 340),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // floor rows above the band keep FLOORING's category
  assert.equal(rows.find((r) => r.finish_tag === "CPT-1")?.category, "floor");
  assert.equal(rows.find((r) => r.finish_tag === "VCT-1")?.category, "floor");
  // rows below the band shed the stale FLOORING and infer base from the prefix
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category, "base");
  assert.equal(rows.find((r) => r.finish_tag === "CBT-1")?.category, "base");
});

test("the reset keys on the band, not the code: a dropped header with NO band still latches (residual #1)", () => {
  // Same as above but the rows are uniformly spaced (no blank band where BASE
  // would sit). With no band signal, RB-1 inherits FLOORING — the documented,
  // unrecoverable case. Pinning it keeps the reset honest about what it can see.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    w("CPT-2", 40, 160), w("SHAW", 360, 160), w("TAN", 960, 160),
    w("VCT-1", 40, 200), w("ARMSTRONG", 360, 200), w("WHITE", 960, 200),
    // BASE dropped AND no band — uniform 40px pitch continues
    w("RB-1", 40, 240), w("VPI", 360, 240), w("FAWN", 960, 240),
    w("CBT-1", 40, 280), w("JJ", 360, 280), w("ROLLER", 960, 280),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // no band → stale FLOORING latches (the honest limit; better signal is future work)
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category, "floor");
});

test("a PRESENT mid-table section header wins over the reset (reset is a no-op there)", () => {
  // Band present AND the BASE header survived: category comes from the real
  // header, not from prefix inference — the reset clears then the header re-sets.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    w("CPT-2", 40, 160), w("SHAW", 360, 160), w("TAN", 960, 160),
    w("VCT-1", 40, 200), w("ARM", 360, 200), w("WHITE", 960, 200),
    w("BASE", 40, 300), // header survived, after the band
    w("CT-3", 40, 340), w("DAL", 360, 340), w("WHITE", 960, 340), // CT prefix is ambiguous
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // CT-3's prefix is ambiguous ("other"), but the BASE header is authoritative
  assert.equal(rows.find((r) => r.finish_tag === "CT-3")?.category, "base");
});

test("the <4-gaps guard disables the reset on a tiny table", () => {
  // Only 3 gaps below the header → the median is too small a sample to trust, so
  // the reset is off and behavior is exactly step 4's (stale section latches).
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    // a big gap, but too few rows to compute a stable median → reset suppressed
    w("RB-1", 40, 260), w("VPI", 360, 260), w("FAWN", 960, 260),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category, "floor");
});
