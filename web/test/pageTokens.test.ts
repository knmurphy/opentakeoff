// extractPageTokens — the whole page's text layer as region-detector tokens
// (regionDetect.ts DetectToken), from hand-built pdf.js text items. No PDF.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractPageTokens } from "../src/lib/sheets.ts";

// A 612 × 792 pt page (letter, portrait) at scale 2. Viewport transforms by
// hand, from pdf.js PageViewport semantics (user space y up → device y down;
// PageViewport is not exported from the pdfjs-dist entry the app imports):
//   rotation   0: [ s, 0, 0, -s, 0,       H·s ]  → 1224 × 1584
//   rotation  90: [ 0, s, s,  0, 0,       0   ]  → 1584 × 1224
//   rotation 180: [-s, 0, 0,  s, W·s,     0   ]  → 1224 × 1584
//   rotation 270: [ 0,-s,-s,  0, H·s,     W·s ]  → 1584 × 1224
const S = 2, PW = 612, PH = 792;
const VP0 = { width: PW * S, height: PH * S, transform: [S, 0, 0, -S, 0, PH * S] };
const VP90 = { width: PH * S, height: PW * S, transform: [0, S, S, 0, 0, 0] };
const VP180 = { width: PW * S, height: PH * S, transform: [-S, 0, 0, S, PW * S, 0] };
const VP270 = { width: PH * S, height: PW * S, transform: [0, -S, -S, 0, PH * S, PW * S] };

// font size 10 at user (100, 50), run width 30 user units
const horiz = { str: "A-101", transform: [10, 0, 0, 10, 100, 50], width: 30, height: 10 };
// the same run turned a quarter counter-clockwise on the page: reads upward
const upward = { str: "A1-101", transform: [0, 10, -10, 0, 300, 400], width: 36, height: 10 };
// a quarter clockwise: reads downward
const downward = { str: "NOTES", transform: [0, -10, 10, 0, 300, 400], width: 25, height: 10 };

describe("extractPageTokens", () => {
  test("0° text on an unrotated page", () => {
    // composed [20, 0, 0, -20, 200, 1584 − 100] → baseline start (200, 1484),
    // glyph height 20, width 30 × 2
    assert.deepEqual(extractPageTokens({ items: [horiz] }, VP0), [
      { str: "A-101", x: 200, y: 1484, w: 60, h: 20, rot: 0 },
    ]);
  });

  test("text reading upward is rot 270, downward is rot 90", () => {
    // upward: composed [0, −20, −20, 0, 600, 1584 − 800]; direction (0, −1) → 270
    // downward: composed [0, 20, 20, 0, 600, 784]; direction (0, 1) → 90
    assert.deepEqual(extractPageTokens({ items: [upward, downward] }, VP0), [
      { str: "A1-101", x: 600, y: 784, w: 72, h: 20, rot: 270 },
      { str: "NOTES", x: 600, y: 784, w: 50, h: 20, rot: 90 },
    ]);
  });

  test("page /Rotate 90: horizontal text turns to rot 90 at the rotated position", () => {
    // composed [0, 20, 20, 0, 2·50, 2·100] = baseline start (100, 200)
    assert.deepEqual(extractPageTokens({ items: [horiz] }, VP90), [
      { str: "A-101", x: 100, y: 200, w: 60, h: 20, rot: 90 },
    ]);
  });

  test("page /Rotate 90: text reading upward on the page reads left to right", () => {
    // composed [20, 0, 0, −20, 2·400, 2·300] → baseline start (800, 600), rot 0
    assert.deepEqual(extractPageTokens({ items: [upward] }, VP90), [
      { str: "A1-101", x: 800, y: 600, w: 72, h: 20, rot: 0 },
    ]);
  });

  test("page /Rotate 180 and 270", () => {
    // 180: composed [−20, 0, 0, 20, 1224 − 200, 100] → rot 180
    assert.deepEqual(extractPageTokens({ items: [horiz] }, VP180), [
      { str: "A-101", x: 1024, y: 100, w: 60, h: 20, rot: 180 },
    ]);
    // 270: composed [0, −20, −20, 0, 1584 − 100, 1224 − 200] → rot 270
    assert.deepEqual(extractPageTokens({ items: [horiz] }, VP270), [
      { str: "A-101", x: 1484, y: 1024, w: 60, h: 20, rot: 270 },
    ]);
  });

  test("whitespace-only items are skipped; the rest keep page order and their raw string", () => {
    const items = [
      { str: "  ", transform: [10, 0, 0, 10, 0, 0], width: 5 },
      { str: " ROOM 101 ", transform: [8, 0, 0, 8, 50, 700], width: 40 },
      { transform: [10, 0, 0, 10, 0, 0] },
    ];
    assert.deepEqual(extractPageTokens({ items }, VP0), [
      { str: " ROOM 101 ", x: 100, y: 184, w: 80, h: 16, rot: 0 },
    ]);
  });

  test("missing width → 0; degenerate transform height falls back to item.height", () => {
    const items = [{ str: "X", transform: [10, 0, 0, 0, 10, 10], height: 7 }];
    assert.deepEqual(extractPageTokens({ items }, VP0), [
      { str: "X", x: 20, y: 1564, w: 0, h: 14, rot: 0 },
    ]);
  });

  test("an empty text layer gives no tokens", () => {
    assert.deepEqual(extractPageTokens({ items: [] }, VP0), []);
  });
});
