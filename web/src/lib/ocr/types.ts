// Schedule-OCR harness vocabulary (docs/SCHEDULE-OCR.md). PURE and pdfjs/DOM-
// free on purpose (the scheduleParse.ts precedent): an OCR engine — the noise
// oracle, a wasm engine, a remote model — is anything that turns a raster
// region into positioned words. The harness converts words to scheduleParse
// Tokens, so every engine is judged by the SAME downstream parser the app
// ships, and the parser never learns which engine fed it.
import type { Token } from "../scheduleParse";

/** A recognized word with its box. Position follows the Token convention the
 * text layer already uses (sheets.extractRegionText): x is the run's left
 * edge, y is the BASELINE (y grows downward), h is the cap height — glyphs
 * rise from the baseline, so the box spans [y − h, y]. w is the run width,
 * which Tokens don't carry but detection scoring and sheetgraph spans need. */
export type OcrWord = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** engine confidence 0..1, when the engine reports one */
  confidence?: number;
};

/** Raw RGBA pixels, the same shape rastermask.ts consumes — the input every
 * real (non-oracle) engine recognizes from. */
export type RasterImage = { data: Uint8ClampedArray; width: number; height: number };

/** The pluggable engine surface (mirrors lib/stt/recognizer.ts). Oracle
 * engines used by Experiment 1 skip `recognize` and transform ground-truth
 * words directly; wasm/remote engines implement it. */
export interface OcrEngine {
  id: string;
  init?(): Promise<void>;
  recognize(image: RasterImage): Promise<OcrWord[]>;
  dispose?(): Promise<void>;
}

/** Words → parser tokens: drop w, keep the shared {str,x,y,h} contract. */
export const wordsToTokens = (words: OcrWord[]): Token[] =>
  words.map(({ str, x, y, h }) => ({ str, x, y, h }));

export type Bbox = [number, number, number, number];

/** A word's [x0,y0,x1,y1] box (y is the baseline; glyphs rise above it). */
export const wordBbox = (wd: OcrWord): Bbox => [wd.x, wd.y - wd.h, wd.x + wd.w, wd.y];
