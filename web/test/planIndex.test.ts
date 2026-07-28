// Plan search index tests — planIndex.ts is pure (no DOM, no pdf.js), so it runs
// straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTerm, splitRun, expandTerm, isCode, isSearchable, buildSheetIndex, matchTerm,
  searchPlan, sheetCodes, dropFileFromIndex, normalizedAnchor,
  serializePlanIndex, sanitizePlanIndex, PLAN_INDEX_SCHEMA, MAX_ANCHORS, MIN_TERM_LEN,
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

// ── expandTerm: compound callouts ───────────────────────────────────────────

test("expandTerm: a '/'-joined callout is findable by EITHER half and as drawn", () => {
  assert.deepEqual(expandTerm("PT-1/PT-2"), ["PT-1/PT-2", "PT-1", "PT-2"]);
  assert.deepEqual(expandTerm("CPT-1,LVT-2"), ["CPT-1,LVT-2", "CPT-1", "LVT-2"]);
});

test("expandTerm: '-' and '.' never split — they are internal to single codes", () => {
  assert.deepEqual(expandTerm("CPT-1"), ["CPT-1"]);
  assert.deepEqual(expandTerm("S1.1"), ["S1.1"]);
  assert.deepEqual(expandTerm("A-101"), ["A-101"]);
});

test("searchPlan: the right-hand half of a compound callout is findable", () => {
  // regression: "PT-1/PT-2" used to index whole, so PT-2 silently missed a
  // sheet that plainly specifies it. Verified present on demo/sample-finish-plan.pdf.
  const ix = buildSheetIndex("A601.pdf", runs(["PT-1/PT-2", 10, 20]));
  assert.deepEqual(searchPlan([ix], "PT-2").map((h) => h.key), ["A601.pdf"]);
  assert.deepEqual(searchPlan([ix], "PT-1").map((h) => h.key), ["A601.pdf"]);
  assert.deepEqual(searchPlan([ix], "PT-1/PT-2").map((h) => h.key), ["A601.pdf"], "still matches as drawn");
  // the compound itself is not a tag (TAG_RE rejects the '/'), but both halves are —
  // so the tag index lists the two real finishes rather than one unusable string
  assert.deepEqual(sheetCodes(ix).tags, ["PT-1", "PT-2"]);
});

test("buildSheetIndex: tokenCount counts tokens as DRAWN, not expanded terms", () => {
  const ix = buildSheetIndex("x", runs(["PT-1/PT-2", 0, 0]));
  assert.equal(ix.tokenCount, 1);
  assert.equal(Object.keys(ix.terms).length, 3);
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

test("searchPlan: an EXACT term outranks a prefix-only match on another sheet", () => {
  // pins the x4 exact bonus — deleting it used to leave every test green
  const exact = buildSheetIndex("exact.pdf", runs(["CPT-1", 0, 0]));
  const prefixOnly = buildSheetIndex("prefix.pdf", runs(["CPT-10 CPT-11 CPT-12", 0, 0]));
  assert.deepEqual(searchPlan([prefixOnly, exact], "CPT-1").map((h) => h.key), ["exact.pdf", "prefix.pdf"]);
});

test("searchPlan: a CODE outranks prose at equal occurrence count", () => {
  // pins the x2 code bonus
  const code = buildSheetIndex("code.pdf", runs(["ACT-1", 0, 0]));
  const prose = buildSheetIndex("prose.pdf", runs(["ACTUAL", 0, 0]));
  const hits = searchPlan([prose, code], "ACT");
  assert.deepEqual(hits.map((h) => h.key), ["code.pdf", "prose.pdf"]);
  assert.ok(hits[0].score > hits[1].score);
});

test("searchPlan: occurrence count breaks a tie between equal-kind terms", () => {
  const many = buildSheetIndex("many.pdf", runs(["LOBBY", 0, 0], ["LOBBY", 1, 1], ["LOBBY", 2, 2]));
  const one = buildSheetIndex("one.pdf", runs(["LOBBY", 0, 0]));
  const hits = searchPlan([one, many], "LOBBY");
  assert.deepEqual(hits.map((h) => h.key), ["many.pdf", "one.pdf"]);
  assert.ok(hits[0].score > hits[1].score);
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

test("searchPlan: ties break on canonical sheet order, not raw string compare", () => {
  // localeCompare would put page 10 before page 2 and drift from sheetKey.ts's
  // comparator, which every other sheet-ordered surface in the app shares
  const p2 = buildSheetIndex("plan.pdf#2", runs(["LOBBY", 0, 0]));
  const p10 = buildSheetIndex("plan.pdf#10", runs(["LOBBY", 0, 0]));
  assert.deepEqual(searchPlan([p10, p2], "lobby").map((h) => h.key), ["plan.pdf#2", "plan.pdf#10"]);
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

// ── dropFileFromIndex (index invalidation) ──────────────────────────────────

test("dropFileFromIndex: drops every page of the named file, leaves others", () => {
  const map = new Map<string, SheetIndex>();
  for (const k of ["A101.pdf", "A101.pdf#2", "A101.pdf#3", "A102.pdf", "A102.pdf#2"]) {
    map.set(k, buildSheetIndex(k, runs(["CORRIDOR", 0, 0])));
  }
  assert.equal(dropFileFromIndex(map, "A101.pdf"), 3);
  assert.deepEqual([...map.keys()], ["A102.pdf", "A102.pdf#2"]);
});

test("dropFileFromIndex: a file name that happens to contain '#' is not mis-split", () => {
  // parseSheetKey only splits on a trailing NUMERIC tail, so this is one file
  const map = new Map<string, SheetIndex>();
  map.set("plan #4 rev.pdf", buildSheetIndex("plan #4 rev.pdf", runs(["LOBBY", 0, 0])));
  map.set("plan #4 rev.pdf#2", buildSheetIndex("plan #4 rev.pdf#2", runs(["LOBBY", 0, 0])));
  assert.equal(dropFileFromIndex(map, "plan #4 rev.pdf"), 2);
  assert.equal(map.size, 0);
});

test("dropFileFromIndex: dropping an unknown file is a no-op, not a throw", () => {
  const map = new Map<string, SheetIndex>([["A101.pdf", buildSheetIndex("A101.pdf", runs(["X", 0, 0]))]]);
  assert.equal(dropFileFromIndex(map, "nope.pdf"), 0);
  assert.equal(map.size, 1);
});

test("dropFileFromIndex: a reissued sheet stops answering with the old text", () => {
  // the bug this exists to prevent: store.addPdf keys on NAME, so a revised
  // A101.pdf overwrites the bytes under the same sheet key
  const map = new Map<string, SheetIndex>();
  map.set("A101.pdf", buildSheetIndex("A101.pdf", runs(["CARPET DEMO", 0, 0])));
  assert.deepEqual(searchPlan(map.values(), "carpet").map((h) => h.key), ["A101.pdf"]);
  dropFileFromIndex(map, "A101.pdf");
  map.set("A101.pdf", buildSheetIndex("A101.pdf", runs(["TERRAZZO", 0, 0])));
  assert.deepEqual(searchPlan(map.values(), "carpet"), [], "superseded text is gone");
  assert.deepEqual(searchPlan(map.values(), "terrazzo").map((h) => h.key), ["A101.pdf"]);
});

test("splitRun: a run carrying a whole label splits into its words", () => {
  assert.deepEqual(splitRun("OFFICE 101"), ["OFFICE", "101"]);
  assert.deepEqual(splitRun(""), [""]);
});

// ── normalizedAnchor ────────────────────────────────────────────────────────

test("normalizedAnchor: divides against the index's OWN recorded anchor space", () => {
  const ix = buildSheetIndex("a", runs(["CPT-1", 300, 150]), "text", 0, { w: 1200, h: 600 });
  assert.deepEqual(normalizedAnchor(ix, [300, 150]), [0.25, 0.25]);
});

test("normalizedAnchor: an index with no recorded space reports null, never a guess", () => {
  const ix = buildSheetIndex("a", runs(["CPT-1", 300, 150]));   // no size passed
  assert.equal(normalizedAnchor(ix, [300, 150]), null);
  assert.equal(normalizedAnchor(ix, null), null);
});

test("normalizedAnchor: two pages at DIFFERENT scales normalize to the same point", () => {
  // the page-1-vs-pages-2+ unit mismatch this exists to make impossible
  const panelScale = buildSheetIndex("p1", runs(["X", 150, 75]), "text", 0, { w: 600, h: 300 });
  const renderScale = buildSheetIndex("p2", runs(["X", 300, 150]), "text", 0, { w: 1200, h: 600 });
  assert.deepEqual(normalizedAnchor(panelScale, [150, 75]), normalizedAnchor(renderScale, [300, 150]));
});

// ── persistence ─────────────────────────────────────────────────────────────

test("plan index round-trips through serialize → JSON → sanitize", () => {
  const map = new Map<string, SheetIndex>([
    ["A101.pdf", buildSheetIndex("A101.pdf", runs(["CPT-1 CORRIDOR", 10, 20]), "text", 5, { w: 100, h: 50 })],
    ["A102.pdf", buildSheetIndex("A102.pdf", runs(["LOBBY", 1, 2]), "ocr", 6, { w: 100, h: 50 })],
  ]);
  const back = sanitizePlanIndex(JSON.parse(JSON.stringify(serializePlanIndex(map))), ["A101.pdf", "A102.pdf"]);
  assert.deepEqual([...back.keys()].sort(), ["A101.pdf", "A102.pdf"]);
  assert.deepEqual(back.get("A101.pdf"), map.get("A101.pdf"));
  assert.equal(back.get("A102.pdf")?.source, "ocr", "source tag survives the round trip");
});

test("sanitizePlanIndex: drops entries for sheets the project no longer has", () => {
  const map = new Map<string, SheetIndex>([["gone.pdf", buildSheetIndex("gone.pdf", runs(["X1", 0, 0]))]]);
  const back = sanitizePlanIndex(serializePlanIndex(map), ["other.pdf"]);
  assert.equal(back.size, 0, "a stored index must never resurrect a missing sheet");
});

test("sanitizePlanIndex: a wrong/absent schema drops everything rather than guessing", () => {
  const good = serializePlanIndex(new Map([["a.pdf", buildSheetIndex("a.pdf", runs(["X1", 0, 0]))]]));
  assert.equal(sanitizePlanIndex({ ...good, schema: "something.else" }, ["a.pdf"]).size, 0);
  assert.equal(sanitizePlanIndex(undefined, ["a.pdf"]).size, 0);
  assert.equal(sanitizePlanIndex({ schema: PLAN_INDEX_SCHEMA }, ["a.pdf"]).size, 0);
  assert.equal(sanitizePlanIndex("nonsense", ["a.pdf"]).size, 0);
});

test("sanitizePlanIndex: corrupt entries degrade to unindexed, never throw", () => {
  const raw = {
    schema: PLAN_INDEX_SCHEMA,
    entries: [
      null,
      { key: 123, terms: {} },                                   // non-string key
      { key: "a.pdf", terms: "nope" },                           // terms not an object
      { key: "b.pdf", terms: { OK: [1, 2], ODD: [1, 2, 3], BAD: ["x", "y"], NAN: [NaN, 1] } },
    ],
  };
  const back = sanitizePlanIndex(raw, ["a.pdf", "b.pdf"]);
  assert.deepEqual([...back.keys()], ["b.pdf"]);
  assert.deepEqual(Object.keys(back.get("b.pdf")!.terms), ["OK"], "odd-length, non-numeric and NaN anchors dropped");
  assert.equal(back.get("b.pdf")!.source, "text", "missing source defaults, not undefined");
});

test("sanitizePlanIndex: a rehydrated index is immediately searchable", () => {
  const map = new Map<string, SheetIndex>([["A101.pdf", buildSheetIndex("A101.pdf", runs(["CPT-1", 10, 20]), "text", 0, { w: 100, h: 50 })]]);
  const back = sanitizePlanIndex(JSON.parse(JSON.stringify(serializePlanIndex(map))), ["A101.pdf"]);
  const [hit] = searchPlan(back.values(), "cpt-1");
  assert.equal(hit.key, "A101.pdf");
  assert.deepEqual(normalizedAnchor(back.get("A101.pdf")!, hit.anchor), [0.1, 0.4]);
});

test("sanitizePlanIndex: validity is by FILE, so every page of a kept file survives", () => {
  // a file's page count isn't known at load time — keying on sheet keys would
  // have needed a guessed page ceiling
  const map = new Map<string, SheetIndex>();
  for (const k of ["set.pdf", "set.pdf#2", "set.pdf#37"]) map.set(k, buildSheetIndex(k, runs(["LOBBY", 0, 0])));
  map.set("dropped.pdf#4", buildSheetIndex("dropped.pdf#4", runs(["LOBBY", 0, 0])));
  const back = sanitizePlanIndex(serializePlanIndex(map), ["set.pdf"]);
  assert.deepEqual([...back.keys()].sort(), ["set.pdf", "set.pdf#2", "set.pdf#37"]);
});
