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
// Category floor per DPI. NOTE what this number does and doesn't capture: the
// reset's category-accuracy gain (144: 50.0→59.1%, 288: 38.5→53.8%) is entirely
// the handful of rows whose code prefix is unambiguous (RB/CBT→base, ACT→ceiling)
// — the band DETECTION contributes nothing to THIS metric; its real work (turning
// the other latched rows from confidently-wrong-and-checked into honest "other")
// is measured by the checked-wrong differential below, not here. 216 is a pure
// regression pin, NOT a result the change moved (reset is a no-op there — most
// headers dropped, no stale latch). Floors sit below the measured values (n=1).
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
// between two ADJACENT data rows, a gap larger than K=1.6× the table's data-row
// PITCH (the median of adjacent data→data gaps). Keyed on the pitch-relative gap,
// never an absolute k·h — the vector text layer (cap-height) and PaddleOCR (full
// glyph extent) measure token height differently. On the demo sheet the largest
// non-section data→data gap is 1.06× the pitch and the smallest dropped-section
// band is 1.94×, so 1.6 separates them — a ~0.34 margin to the nearest firing
// band, NOT a wide valley (n=1; the constant is not yet corpus-validated).
// These tests read the reset's effect by comparing sectionReset on vs off.

test("the section reset never fires on the vector path: golden-28 category is still 100%", () => {
  // The shipped invariant. It holds NOT because vector gaps are small — a vector
  // section boundary gap reaches ~1.94× the pitch — but because those large gaps
  // land on recognized section-label rows, which break the data→data adjacency
  // the reset requires. So on the shipped path category comes from the real
  // headers exactly as before, byte-for-byte, and the reset is a no-op.
  const off = parseSchedule(wordsToTokens(fixture.words), { sectionReset: false });
  const on = parseSchedule(wordsToTokens(fixture.words));
  assert.deepEqual(on, off, "reset changed the vector parse");
  const s = scoreRows(golden, on);
  assert.equal(on.length, 28);
  assert.equal(s.rowRecall, 1);
  assert.equal(s.rowPrecision, 1);
  assert.equal(s.fieldAcc.category, 1);
  assert.equal(s.perfectRows, 20);
});

// The differential: parse each fixture with the reset OFF and ON. This is what
// pins the spec's claims — that the reset is a section-ATTRIBUTION change only
// (emission + content cells identical), that it strictly reduces confidently-
// wrong default-checked rows on the stale-latch DPIs, and that 216 (a pure-
// inference miss, no stale latch) is genuinely untouched. All figures n=1.
const contentFields = (r: ScheduleRow) =>
  [r.finish_tag, r.description, r.manufacturer, r.style, r.spec_color, r.size];
// "checked-and-wrong": a row default-checked in the import dialog (suggested) whose
// category disagrees with golden — a SILENT wrong bid, the exact failure the reset
// exists to remove. This measures the honesty win the category % can't see.
const goldenCat = new Map(golden.map((g) => [g.finish_tag, g.category]));
const checkedWrong = (rows: ScheduleRow[]) =>
  rows.filter((r) => r.suggested && goldenCat.get(r.finish_tag) !== r.category).length;
// The DPIs where a stale section actually latches (FLOORING carries onto BASE/
// WALLS); 216 drops nearly every header, so there is no stale latch to clear.
const STALE_LATCH_DPIS = new Set([144, 288]);
for (const dpi of PADDLE_DPIS) {
  test(`section reset is a category-only change at ${dpi}dpi (emission + content identical off vs on)`, () => {
    const off = parseSchedule(wordsToTokens(paddleWords(dpi)), { sectionReset: false });
    const on = parseSchedule(wordsToTokens(paddleWords(dpi)));
    // WHICH rows are emitted, and their content cells, are byte-for-byte identical
    assert.deepEqual(on.map((r) => r.finish_tag), off.map((r) => r.finish_tag), `${dpi}dpi emission changed`);
    assert.deepEqual(on.map(contentFields), off.map(contentFields), `${dpi}dpi content cells changed`);
    // scored row recall/precision are unchanged by the reset (not just above a floor)
    const so = scoreRows(golden, off), sn = scoreRows(golden, on);
    assert.equal(sn.rowRecall, so.rowRecall, `${dpi}dpi recall moved`);
    assert.equal(sn.rowPrecision, so.rowPrecision, `${dpi}dpi precision moved`);
  });

  test(`section reset removes confidently-wrong default-checked rows at ${dpi}dpi`, () => {
    const off = parseSchedule(wordsToTokens(paddleWords(dpi)), { sectionReset: false });
    const on = parseSchedule(wordsToTokens(paddleWords(dpi)));
    // the honesty metric: checked-and-wrong never rises, and strictly falls where
    // a stale section latches. category accuracy never regresses either.
    assert.ok(checkedWrong(on) <= checkedWrong(off), `${dpi}dpi checked-wrong rose ${checkedWrong(off)}→${checkedWrong(on)}`);
    assert.ok(scoreRows(golden, on).fieldAcc.category >= scoreRows(golden, off).fieldAcc.category, `${dpi}dpi category regressed`);
    if (STALE_LATCH_DPIS.has(dpi)) {
      assert.ok(checkedWrong(on) < checkedWrong(off), `${dpi}dpi expected fewer checked-wrong (${checkedWrong(off)}→${checkedWrong(on)})`);
      // the exact defect: RB-1/CBT-1 (BASE) latch `floor` with the reset OFF and
      // recover to `base` with it ON. Presence asserted so neither pin is vacuous.
      for (const tag of ["RB-1", "CBT-1"]) {
        const before = off.find((r) => r.finish_tag === tag);
        const after = on.find((r) => r.finish_tag === tag);
        assert.ok(before && after, `${dpi}dpi ${tag} missing from fixture parse`);
        assert.equal(before!.category, "floor", `${dpi}dpi ${tag} not latched floor with reset off`);
        assert.equal(after!.category, "base", `${dpi}dpi ${tag} not recovered to base`);
      }
    } else {
      // 216: no stale latch, so the reset changes nothing (genuinely "unchanged")
      assert.deepEqual(on, off, `${dpi}dpi reset changed a no-stale-latch parse`);
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

test("a PRESENT mid-table section header wins over the reset, with the pitch ARMED", () => {
  // The pitch is armed (4 adjacent CPT gaps) and CT-3 sits a full band (100 vs the
  // 40px pitch) below the BASE header. The adjacency guard is what saves it: CT-3's
  // predecessor is the BASE *section* row, not a data row, so the reset never fires
  // and CT-3 takes BASE's category. Remove the `kind[i-1]==="data"` guard and this
  // band would reset BASE → CT-3 (ambiguous CT prefix) falls to "other" — so this
  // test now fails if that guard is dropped (it previously ran with pitch=null).
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    w("CPT-2", 40, 160), w("SHAW", 360, 160), w("TAN", 960, 160),
    w("CPT-3", 40, 200), w("SHAW", 360, 200), w("RED", 960, 200),
    w("CPT-4", 40, 240), w("SHAW", 360, 240), w("BLUE", 960, 240),
    w("CPT-5", 40, 280), w("SHAW", 360, 280), w("TEAL", 960, 280), // 5 rows → 4 gaps → pitch=40
    w("BASE", 40, 380),                                             // header survived, after a band
    w("CT-3", 40, 480), w("DAL", 360, 480), w("WHITE", 960, 480),   // a band (100) below BASE
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // CT-3's prefix is ambiguous ("other"), but the BASE header is authoritative and
  // the adjacency guard stops the band-below-BASE from resetting it.
  assert.equal(rows.find((r) => r.finish_tag === "CT-3")?.category, "base");
});

test("the <4-gaps guard disables the reset, and is sensitive to MIN_GAP_SAMPLES", () => {
  // EXACTLY 3 adjacent data→data gaps (CPT-1→CPT-2→CPT-3→RB-1), the last a band
  // (100 vs a 40px pitch). With MIN_GAP_SAMPLES=4 the pitch is null and the reset
  // is off, so RB-1 latches the stale FLOORING (asserted). If MIN_GAP_SAMPLES were
  // lowered to ≤3 the pitch would arm (median 40), the band would exceed 1.6×40=64,
  // and RB-1 would reset to `base` — so this test fails if the guard is weakened.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    w("CPT-2", 40, 160), w("SHAW", 360, 160), w("TAN", 960, 160),
    w("CPT-3", 40, 200), w("SHAW", 360, 200), w("RED", 960, 200),
    // a band (100), but only 3 data→data gaps total → pitch=null → reset suppressed
    w("RB-1", 40, 300), w("VPI", 360, 300), w("FAWN", 960, 300),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category, "floor");
});

test("the adjacency guard: header padding does not fire the reset (pitch ARMED, 5 data rows)", () => {
  // Adversarial-review (parser F1 / eval F8): the reset must not treat the
  // header→first-row gap as a data band. FLOORING is seeded above the header, the
  // header→PT-1 gap is wide (100 vs the 40px pitch), and 5 data rows arm the pitch
  // (4 gaps ≥ MIN_GAP_SAMPLES). PT-1's predecessor is the header row (kind "skip"),
  // so the adjacency guard blocks the reset and the seeded FLOORING survives.
  // Remove the guard and the header→PT-1 band resets FLOORING → PT-1 (ambiguous PT
  // prefix) becomes "other" — so this now fails if the adjacency guard is dropped.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    w("FLOORING", 40, 20),         // section seeded ABOVE the header
    ...hdrRow(60),
    // wide header→row-1 gap (100 vs the 40px data pitch), then 5 uniform rows
    w("PT-1", 40, 160), w("DAL", 360, 160), w("WHITE", 960, 160),
    w("PT-2", 40, 200), w("DAL", 360, 200), w("PUTTY", 960, 200),
    w("PT-3", 40, 240), w("DAL", 360, 240), w("GREY", 960, 240),
    w("PT-4", 40, 280), w("DAL", 360, 280), w("TAN", 960, 280),
    w("PT-5", 40, 320), w("DAL", 360, 320), w("BLUE", 960, 320),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // PT prefix is ambiguous ("other"); only the seeded FLOORING makes these floor.
  for (const t of ["PT-1", "PT-2", "PT-3", "PT-4", "PT-5"]) assert.equal(rows.find((r) => r.finish_tag === t)?.category, "floor", t);
});

test("the pitch excludes section/header gaps: an all-gaps median would suppress a real band", () => {
  // Pins the data→data-only pitch (parser F4 / eval — the refinement whose revert to
  // v1's all-gaps median left the suite green). Deliberately SYNTHETIC: four floor
  // rows, a dropped-BASE band (100 vs the 40px data pitch), then a run of trailing
  // section-label rows (100px apart) that carry no data. The reset must still fire on
  // RB-1: the data→data pitch is 40, so the 100px band clears 1.6×40=64. But if the
  // pitch reverted to the median of ALL below-header gaps, those five 100px section
  // gaps drag the median to 100, 1.6×100=160 > 100, and the band would be suppressed —
  // RB-1 would latch FLOORING instead. Asserting `base` fails on that revert.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    w("FLOORING", 40, 20),         // seed floor above the header
    ...hdrRow(60),
    w("CPT-1", 40, 100), w("SHAW", 360, 100), w("GREY", 960, 100),
    w("CPT-2", 40, 140), w("SHAW", 360, 140), w("TAN", 960, 140),
    w("CPT-3", 40, 180), w("SHAW", 360, 180), w("RED", 960, 180),
    w("CPT-4", 40, 220), w("SHAW", 360, 220), w("BLUE", 960, 220),
    // dropped BASE header — only the band (100 vs 40) is left, between two data rows
    w("RB-1", 40, 320), w("VPI", 360, 320), w("FAWN", 960, 320),
    // trailing section labels, no data: they inflate an all-gaps median, not data→data
    w("WALLS", 40, 420), w("CEILINGS", 40, 520), w("MILLWORK", 40, 620), w("TRIM", 40, 720),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category, "base");
});

test("residual: a within-section band on a DETECTED section can false-fire the reset", () => {
  // Honestly pinned (parser F3 / eval F3): the reset can't tell a dropped-header
  // band from a legitimate large gap between two data rows of the SAME detected
  // section (a wrapped multi-line remark that clusters as its own row, a spacer).
  // Here WALLS is present and detected, but a big gap before P-5 false-fires the
  // reset — and because P's prefix is unmapped, P-5 lands on "other". Worse, a
  // FLOOR-prefixed code in that position would become a WRONG *checked* category,
  // not just honest-unknown (RF-9 → floor, suggested:true). This documents the
  // net-negative case the reset can produce off the demo sheet.
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("WALLS", 40, 80),
    w("P-1", 40, 120), w("BM", 360, 120), w("WHITE", 960, 120),
    w("P-2", 40, 160), w("BM", 360, 160), w("BEIGE", 960, 160),
    w("P-3", 40, 200), w("BM", 360, 200), w("GREY", 960, 200),
    w("P-4", 40, 240), w("BM", 360, 240), w("TAN", 960, 240),
    // a within-section band (100 vs 40 pitch) — a wrapped remark spacer, say
    w("RF-9", 40, 340), w("SHAW", 360, 340), w("BLUE", 960, 340),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // WALLS rows before the band are wall
  assert.equal(rows.find((r) => r.finish_tag === "P-1")?.category, "wall");
  // RF-9 (still WALLS, truly wall) false-resets → RF prefix says floor → a WRONG,
  // default-checked category. The reset is not free: this is its downside.
  const rf = rows.find((r) => r.finish_tag === "RF-9");
  assert.equal(rf?.category, "floor");
  assert.equal(rf?.suggested, true);
});

// ── category-confidence flag (docs/SCHEDULE-CATEGORY-CONFIDENCE-SPEC.md, 5a-part-2)
// A category the parser GUESSED (prefix inference or "other", because no section
// was active) is flagged category_inferred:true so the import dialog can ask the
// estimator to verify it. The parser sets `section` and the flag in lockstep, so
// the flag is exactly "this row had no detected section" — the honest signal for
// the 5a residuals (reset rows, pure-inference rows, the within-section false-fire).

test("category_inferred === (no detected section) across every fixture", () => {
  // The invariant that ties the flag to provenance: a row is flagged inferred iff
  // it carries no section (which is set/cleared in lockstep with the category source).
  const all: OcrWord[][] = [fixture.words, ...PADDLE_DPIS.map((d) => paddleWords(d))];
  for (const ws of all) {
    for (const r of parseSchedule(wordsToTokens(ws))) {
      assert.equal(r.category_inferred === true, r.section === "", `${r.finish_tag}: flag=${r.category_inferred} section="${r.section}"`);
    }
  }
});

test("the vector path never flags a category as inferred (every row is read from a section)", () => {
  const rows = parseSchedule(wordsToTokens(fixture.words));
  assert.ok(rows.every((r) => r.category_inferred === false), "a vector row was flagged inferred");
});

test("the OCR path flags the rows it guesses (at least one inferred per stale-latch DPI)", () => {
  for (const dpi of [144, 288]) {
    const rows = parseSchedule(wordsToTokens(paddleWords(dpi)));
    assert.ok(rows.some((r) => r.category_inferred === true), `${dpi}dpi flagged nothing inferred`);
    // the reset rows specifically: RB-1/CBT-1 shed their section, so they're flagged
    for (const tag of ["RB-1", "CBT-1"]) {
      const r = rows.find((x) => x.finish_tag === tag);
      assert.ok(r && r.category_inferred === true, `${dpi}dpi ${tag} not flagged inferred`);
    }
  }
});

test("a reset row is flagged inferred; a sectioned row is not", () => {
  const H = 14;
  const w = (str: string, x: number, y: number): OcrWord => ({ str, x, y, w: 60, h: H });
  const words: OcrWord[] = [
    ...hdrRow(40),
    w("FLOORING", 40, 80),
    w("CPT-1", 40, 120), w("SHAW", 360, 120), w("GREY", 960, 120),
    w("CPT-2", 40, 160), w("SHAW", 360, 160), w("TAN", 960, 160),
    w("VCT-1", 40, 200), w("ARM", 360, 200), w("WHITE", 960, 200),
    // BASE dropped, band remains → RB-1 resets off FLOORING
    w("RB-1", 40, 300), w("VPI", 360, 300), w("FAWN", 960, 300),
    w("CBT-1", 40, 340), w("JJ", 360, 340), w("ROLLER", 960, 340),
  ];
  const rows = parseSchedule(wordsToTokens(words));
  // CPT-1 read its category from the FLOORING section → confident
  assert.equal(rows.find((r) => r.finish_tag === "CPT-1")?.category_inferred, false);
  // RB-1 was reset off FLOORING → its base is a prefix guess → flagged
  assert.equal(rows.find((r) => r.finish_tag === "RB-1")?.category_inferred, true);
});
