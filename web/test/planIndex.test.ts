// Plan search index tests — planIndex.ts is pure (no DOM, no pdf.js), so it runs
// straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTerm, splitRun, isCode, isSearchable, buildSheetIndex, matchTerm,
  searchPlan, sheetCodes, MAX_ANCHORS, MIN_TERM_LEN,
  type IndexedTextItem, type SheetIndex,
} from "../src/lib/planIndex.ts";

// a sheet's worth of positioned runs, in image px — the shape extractRegionText
// hands back
const runs = (...pairs: Array<[string, number, number]>): IndexedTextItem[] =>
  pairs.map(([str, x, y]) => ({ str, x, y, h: 19 }));

// ── normalizeTerm ───────────────────────────────────────────────────────────

test("normalizeTerm: upper-cases and strips punctuation at the ENDS only", () => {
  assert.equal(normalizeTerm("corridor"), "CORRIDOR");
  assert.equal(normalizeTerm("(CPT-1)"), "CPT-1");
  assert.equal(normalizeTerm("ROOM,"), "ROOM");
  assert.equal(normalizeTerm("…101."), "101");
});

test("normalizeTerm: interior separators survive — they ARE the plan vocabulary", () => {
  // stripping these globally would shred exactly what this index exists to find
  assert.equal(normalizeTerm("CPT-1"), "CPT-1");
  assert.equal(normalizeTerm("S1.1"), "S1.1");
  assert.equal(normalizeTerm("PT-1/PT-2"), "PT-1/PT-2");
});

test("normalizeTerm: punctuation-only and empty input yield no term", () => {
  assert.equal(normalizeTerm("—"), "");
  assert.equal(normalizeTerm("..."), "");
  assert.equal(normalizeTerm(""), "");
  assert.equal(normalizeTerm(undefined as unknown as string), "");
});

// ── term classification ─────────────────────────────────────────────────────

test("isCode: finish tags, room numbers, and sheet numbers all qualify", () => {
  for (const t of ["CPT-1", "LVT3", "P-1", "ACT-2", "PT-2A"]) assert.ok(isCode(t), t);
  for (const t of ["101", "139A", "12"]) assert.ok(isCode(t), t);
  for (const t of ["A101", "A-101", "S1.1", "AF101"]) assert.ok(isCode(t), t);
  for (const t of ["CORRIDOR", "THE", "X"]) assert.equal(isCode(t), false, t);
});

test("isSearchable: codes bypass the length floor, crumbs do not", () => {
  assert.ok(isSearchable("P-1"));              // 3 chars, but a real tag
  assert.ok(isSearchable("101"));              // room number
  assert.ok(isSearchable("CORRIDOR"));
  assert.equal(isSearchable("1"), false);      // list numbering
  assert.equal(isSearchable("W"), false);      // stray dimension letter
  assert.equal("AB".length < MIN_TERM_LEN, true);
  assert.equal(isSearchable("AB"), false);
});

// ── buildSheetIndex ─────────────────────────────────────────────────────────

test("buildSheetIndex: splits multi-word runs and records anchors in image px", () => {
  const ix = buildSheetIndex("A101.pdf", runs(["PATIENT ROOM", 100, 200], ["139A", 120, 240]));
  assert.deepEqual(Object.keys(ix.terms).sort(), ["139A", "PATIENT", "ROOM"]);
  // anchor is the RUN's origin — pdf.js has no per-word transform to interpolate
  assert.deepEqual(ix.terms.PATIENT, [100, 200]);
  assert.deepEqual(ix.terms.ROOM, [100, 200]);
  assert.deepEqual(ix.terms["139A"], [120, 240]);
});

test("buildSheetIndex: unsearchable tokens are counted but not indexed", () => {
  const ix = buildSheetIndex("A101.pdf", runs(["1. GENERAL", 10, 10], ["W", 20, 20]));
  assert.deepEqual(Object.keys(ix.terms), ["GENERAL"]);
  assert.equal(ix.tokenCount, 3, "tokenCount is the honest denominator, incl. dropped");
});

test("buildSheetIndex: anchors are capped so a repeated word can't bloat the index", () => {
  const many = Array.from({ length: 50 }, (_, i): [string, number, number] => ["CORRIDOR", i, i]);
  const ix = buildSheetIndex("A101.pdf", runs(...many));
  assert.equal(ix.terms.CORRIDOR.length, MAX_ANCHORS * 2, "flat [x,y] pairs, capped");
  assert.equal(ix.tokenCount, 50, "every occurrence still counted");
});

test("buildSheetIndex: empty/whitespace input yields an empty but valid index", () => {
  const ix = buildSheetIndex("blank.pdf", runs(["", 0, 0], ["   ", 5, 5]));
  assert.deepEqual(ix.terms, {});
  assert.equal(ix.tokenCount, 0);
  assert.equal(ix.source, "text");
});

test("buildSheetIndex: index is plain JSON, so it round-trips through storage", () => {
  const ix = buildSheetIndex("A101.pdf", runs(["CPT-1", 10, 20]), "ocr", 1234);
  const back = JSON.parse(JSON.stringify(ix)) as SheetIndex;
  assert.deepEqual(back, ix);
  assert.equal(back.source, "ocr");
  assert.equal(back.builtAt, 1234);
});

// ── matchTerm ───────────────────────────────────────────────────────────────

test("matchTerm: an exact hit short-circuits the prefix sweep", () => {
  const ix = buildSheetIndex("a", runs(["CPT-1 CPT-10 CPT-11", 0, 0]));
  assert.deepEqual(matchTerm(ix, "CPT-1"), ["CPT-1"], "exact wins alone");
  assert.deepEqual(matchTerm(ix, "CPT-1").length, 1);
  assert.deepEqual(matchTerm(ix, "CPT").sort(), ["CPT-1", "CPT-10", "CPT-11"]);
  assert.deepEqual(matchTerm(ix, "ZZZ"), []);
});

// ── searchPlan ──────────────────────────────────────────────────────────────

const A = buildSheetIndex("A101.pdf", runs(["CORRIDOR", 10, 10], ["CPT-1", 20, 20], ["CPT-1", 30, 30]));
const B = buildSheetIndex("A102.pdf", runs(["CORRIDOR", 40, 40], ["LVT-2", 50, 50]));
const C = buildSheetIndex("A103.pdf", runs(["LOBBY", 60, 60]));

test("searchPlan: an empty or punctuation-only query matches nothing", () => {
  assert.deepEqual(searchPlan([A, B, C], ""), []);
  assert.deepEqual(searchPlan([A, B, C], "   "), []);
  assert.deepEqual(searchPlan([A, B, C], "-—-"), []);
});

test("searchPlan: multi-token queries are AND, not OR", () => {
  // OR would return the whole set for any common word, exactly at the set size
  // where narrowing is the point
  const hits = searchPlan([A, B, C], "corridor cpt-1");
  assert.deepEqual(hits.map((h) => h.key), ["A101.pdf"]);
  const none = searchPlan([A, B, C], "corridor lobby");
  assert.deepEqual(none, []);
});

test("searchPlan: query is case- and punctuation-insensitive", () => {
  assert.deepEqual(searchPlan([A, B, C], "cpt-1").map((h) => h.key), ["A101.pdf"]);
  assert.deepEqual(searchPlan([A, B, C], "(CPT-1)").map((h) => h.key), ["A101.pdf"]);
});

test("searchPlan: prefix search finds the half-typed code", () => {
  const hits = searchPlan([A, B, C], "cpt");
  assert.deepEqual(hits.map((h) => h.key), ["A101.pdf"]);
  assert.deepEqual(hits[0].matched, ["CPT-1"]);
});

test("searchPlan: more occurrences outrank fewer", () => {
  const hits = searchPlan([A, B], "corridor");
  assert.deepEqual(hits.map((h) => h.key), ["A101.pdf", "A102.pdf"]);
  // A101 says CORRIDOR once and A102 once, so the tie breaks on key, stably
  assert.equal(hits[0].score, hits[1].score);
});

test("searchPlan: a hit carries an anchor to jump to, in image px", () => {
  const [hit] = searchPlan([A], "cpt-1");
  assert.deepEqual(hit.anchor, [20, 20], "first anchor of the best-matching term");
  assert.equal(hit.source, "text");
});

test("searchPlan: an OCR'd sheet loses a tie to a text-layer sheet", () => {
  const scanned = buildSheetIndex("A200.pdf", runs(["CORRIDOR", 10, 10]), "ocr");
  const hits = searchPlan([scanned, B], "corridor");
  assert.deepEqual(hits.map((h) => h.key), ["A102.pdf", "A200.pdf"]);
  assert.ok(hits[0].score > hits[1].score, "text beats ~80%-right OCR on a tie");
  assert.equal(hits[1].source, "ocr", "but the scan is still findable, and says so");
});

test("searchPlan: results are stable across identical searches", () => {
  const once = searchPlan([A, B, C], "corridor").map((h) => h.key);
  const twice = searchPlan([C, B, A], "corridor").map((h) => h.key);
  assert.deepEqual(once, twice, "input order must not change output order");
});

// ── sheetCodes (symbol Tier 1) ──────────────────────────────────────────────

test("sheetCodes: splits the tag index from the room index", () => {
  const ix = buildSheetIndex("A101.pdf", runs(
    ["CPT-1 LVT-2 CORRIDOR", 0, 0],
    ["139A 101 PATIENT ROOM", 10, 10],
  ));
  const { tags, rooms } = sheetCodes(ix);
  assert.deepEqual(tags, ["CPT-1", "LVT-2"]);
  assert.deepEqual(rooms, ["101", "139A"]);
});

test("sheetCodes: a sheet number is neither a room number nor a finish tag", () => {
  const ix = buildSheetIndex("x", runs(["A101", 0, 0]));
  const { tags, rooms } = sheetCodes(ix);
  assert.deepEqual(rooms, [], "A101 is the sheet, not room 101");
  assert.deepEqual(tags, [], "…nor is it a finish tag — it's a third kind of code");
  // categorisation and findability are separate: it stays in the search index
  assert.ok(ix.terms.A101, "still indexed");
  assert.deepEqual(searchPlan([ix], "a101").map((h) => h.key), ["x"], "still findable");
});

test("splitRun: a run carrying a whole label splits into its words", () => {
  assert.deepEqual(splitRun("OFFICE 101"), ["OFFICE", "101"]);
  assert.deepEqual(splitRun(""), [""]);
});
