// lib/ocr/{raster,types} — the crop-px → image-px mapping every OCR word
// crosses, and the words→tokens handoff into the shared {str,x,y,h} contract.
// Pure coordinate math, node:test. If cropBoxToWord changes, the Copy-text
// tool's OCR words land in the wrong place on the sheet; if wordsToTokens
// changes, scheduleParse and textlines disagree about what a token is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cropBoxToWord, renderDims } from "../src/lib/ocr/raster";
import { wordsToTokens, wordBbox } from "../src/lib/ocr/types";

const rect = { x0: 100, y0: 200, x1: 500, y1: 400 };

test("zoom 1: crop box maps verbatim into the rect", () => {
  const w = cropBoxToWord("CARPET", { x0: 10, y0: 20, x1: 70, y1: 32 }, { rect, zoom: 1 });
  assert.equal(w.str, "CARPET");
  assert.equal(w.x, 110);          // rect.x0 + x0/1
  assert.equal(w.y, 232);          // rect.y0 + y1/1 — box BOTTOM is the baseline
  assert.equal(w.w, 60);
  assert.equal(w.h, 12);
  assert.equal(w.confidence, undefined);
});

test("zoom 2: crop pixels halve back into image px (the 288-DPI upscale case)", () => {
  const w = cropBoxToWord("CT-2", { x0: 20, y0: 40, x1: 60, y1: 64 }, { rect, zoom: 2 });
  assert.equal(w.x, 110);          // 100 + 20/2
  assert.equal(w.y, 232);          // 200 + 64/2
  assert.equal(w.w, 20);           // (60-20)/2
  assert.equal(w.h, 12);           // (64-40)/2
});

test("confidence rides through, scaled to 0..1 by the caller", () => {
  const w = cropBoxToWord("x", { x0: 0, y0: 0, x1: 1, y1: 1 }, { rect, zoom: 1 }, 0.93);
  assert.equal(w.confidence, 0.93);
});

test("renderDims: rect·zoom, never a zero-pixel bitmap", () => {
  assert.deepEqual(renderDims({ rect: { x0: 0, y0: 0, x1: 400, y1: 80 }, zoom: 2 }), { width: 800, height: 160 });
  assert.deepEqual(renderDims({ rect: { x0: 5, y0: 5, x1: 5.2, y1: 5.1 }, zoom: 0.5 }), { width: 1, height: 1 });
});

test("wordsToTokens: the shared Token contract — w dropped, no angle invented", () => {
  const toks = wordsToTokens([
    { str: "A", x: 1, y: 2, w: 3, h: 4, confidence: 0.5 },
    { str: "B", x: 5, y: 6, w: 7, h: 8 },
  ]);
  assert.deepEqual(toks, [{ str: "A", x: 1, y: 2, h: 4 }, { str: "B", x: 5, y: 6, h: 8 }]);
});

test("wordBbox: baseline convention round-trips through cropBoxToWord", () => {
  const box = { x0: 8, y0: 16, x1: 48, y1: 28 };
  const w = cropBoxToWord("RT-1", box, { rect, zoom: 1 });
  // the reconstructed [x0,y0,x1,y1] is the ORIGINAL crop box, offset by the rect
  assert.deepEqual(wordBbox(w), [rect.x0 + box.x0, rect.y0 + box.y0, rect.x0 + box.x1, rect.y0 + box.y1]);
});
