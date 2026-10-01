// bench/regionSheets.ts — the pure half of the PDF page → DetectSheet adapter
// the region bench uses (sheet keys, page size in inches, assembly). No PDF.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sheetKeyFor, pageSizeInches, toDetectSheet } from "../bench/regionSheets.ts";
import { parseSheetKey } from "../src/lib/sheetKey.ts";

describe("sheetKeyFor", () => {
  test("page 1 is the bare file name, later pages are file#n", () => {
    assert.equal(sheetKeyFor("a.pdf", 1), "a.pdf");
    assert.equal(sheetKeyFor("a.pdf", 2), "a.pdf#2");
    assert.equal(sheetKeyFor("a.pdf", 13), "a.pdf#13");
  });
  test("round-trips through parseSheetKey, also with a '#' in the file name", () => {
    for (const [f, p] of [["a.pdf", 1], ["a.pdf", 7], ["x#1.pdf", 3]] as const) {
      assert.deepEqual(parseSheetKey(sheetKeyFor(f, p)), { file: f, page: p });
    }
  });
  test("rejects a page number below 1 or not an integer", () => {
    assert.throws(() => sheetKeyFor("a.pdf", 0));
    assert.throws(() => sheetKeyFor("a.pdf", 1.5));
  });
});

describe("pageSizeInches", () => {
  test("ARCH D landscape, unrotated: 2592 × 1728 pt → 36 × 24 in", () => {
    assert.deepEqual(pageSizeInches([0, 0, 2592, 1728], 0), [36, 24]);
  });
  test("a non-zero origin uses the box size", () => {
    assert.deepEqual(pageSizeInches([10, 20, 622, 812], 0), [8.5, 11]);
  });
  test("/Rotate 90 and 270 swap to displayed orientation; 180 and 360 do not", () => {
    assert.deepEqual(pageSizeInches([0, 0, 1728, 2592], 90), [36, 24]);
    assert.deepEqual(pageSizeInches([0, 0, 1728, 2592], 270), [36, 24]);
    assert.deepEqual(pageSizeInches([0, 0, 1728, 2592], -90), [36, 24]);
    assert.deepEqual(pageSizeInches([0, 0, 1728, 2592], 180), [24, 36]);
    assert.deepEqual(pageSizeInches([0, 0, 1728, 2592], 360), [24, 36]);
  });
  test("rounds to 1/1000 in", () => {
    // 1000 pt = 13.8888… in
    assert.deepEqual(pageSizeInches([0, 0, 1000, 720], 0), [13.889, 10]);
  });
});

describe("toDetectSheet", () => {
  test("lines come from longAxisLines over the segments; source is vector", () => {
    // 1000 × 800 px: one long horizontal at y = 700 (two collinear pieces with a 2 px gap),
    // one long vertical at x = 900, one short stub (dropped: < 15% of 800 = 120 px), one diagonal (dropped)
    const segs = [
      100, 700, 500, 700,
      502, 700, 950, 700,
      900, 50, 900, 750,
      10, 10, 60, 10,
      0, 0, 300, 300,
    ];
    const tokens = [{ str: "A-101", x: 910, y: 780, w: 50, h: 12, rot: 0 }];
    const s = toDetectSheet({ key: "a.pdf#2", w: 1000, h: 800, pageIn: [36, 24], tokens, segs });
    assert.equal(s.key, "a.pdf#2");
    assert.equal(s.w, 1000);
    assert.equal(s.h, 800);
    assert.deepEqual(s.pageIn, [36, 24]);
    assert.equal(s.source, "vector");
    assert.deepEqual(s.tokens, tokens);
    assert.deepEqual(s.lines, [
      { x0: 100, y0: 700, x1: 950, y1: 700 },
      { x0: 900, y0: 50, x1: 900, y1: 750 },
    ]);
  });
  test("tokens with blank text are dropped", () => {
    const s = toDetectSheet({ key: "a.pdf", w: 100, h: 100, tokens: [{ str: "  ", x: 0, y: 0, h: 1 }, { str: "X", x: 1, y: 1, h: 1 }], segs: [] });
    assert.deepEqual(s.tokens.map((t) => t.str), ["X"]);
    assert.equal(s.pageIn, undefined);
  });
});
