// textlines — reading-order assembly for the Copy-text marquee. Pure math,
// node:test (the geometry/totals precedent): every case is a token list in,
// a line list out.
import { test } from "node:test";
import { assembleLines, linesToText, MAX_TILT_DEG } from "../src/lib/textlines";
import assert from "node:assert/strict";
import type { Token } from "../src/lib/scheduleParse";

const tok = (str: string, x: number, y: number, h = 10, ang?: number): Token =>
  ang === undefined ? { str, x, y, h } : { str, x, y, h, ang };

test("reading order: lines top→bottom, tokens left→right", () => {
  // deliberately shuffled input
  const toks = [
    tok("world", 60, 100), tok("second", 10, 130), tok("hello", 10, 100), tok("line", 80, 130),
  ];
  const { lines } = assembleLines(toks);
  assert.deepEqual(lines.map((l) => l.text), ["hello world", "second line"]);
  assert.ok(lines[0].y < lines[1].y);
});

test("linesToText joins with newlines, one line per visual row", () => {
  const { lines } = assembleLines([tok("a", 0, 0), tok("b", 0, 40)]);
  assert.equal(linesToText(lines), "a\nb");
});

test("same line: baseline within 0.6·h of the running average", () => {
  // dy = 5, h = 10 → 5 ≤ 6 joins
  const joined = assembleLines([tok("a", 0, 100), tok("b", 50, 105)]);
  assert.equal(joined.lines.length, 1);
  // dy = 7 exceeds the tolerance → two lines
  const split = assembleLines([tok("a", 0, 100), tok("b", 50, 107)]);
  assert.equal(split.lines.length, 2);
});

test("tolerance scales with the TALLER member of the pair", () => {
  // a tall header (h=20) beside small text (h=8) offset by 10px: 10 ≤ 0.6·20
  // — the small token belongs to the header's line, not its own
  const { lines } = assembleLines([tok("HEADER", 0, 100, 20), tok("note", 200, 110, 8)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "HEADER note");
});

test("running average bounds drift: +4px steps at h=10 (tol 6) break every third token", () => {
  // seven tokens, each 4px below the last (y = 100..124, h = 10, tol = 6).
  // The running average creeps 100 → 102 → 104, so token 4 (y=112) misses by
  // 8px and starts a new row; the pattern repeats. A pairwise-diff clusterer
  // would chain all seven into one line; the running average splits 3/3/1.
  const toks = [0, 1, 2, 3, 4, 5, 6].map((i) => tok(`t${i}`, 10 + i * 40, 100 + i * 4));
  const { lines } = assembleLines(toks);
  assert.deepEqual(lines.map((l) => l.tokens.map((t) => t.str)), [
    ["t0", "t1", "t2"],
    ["t3", "t4", "t5"],
    ["t6"],
  ]);
});

test("tilt: rotated tokens are skipped and reported, near-horizontal kept", () => {
  const toks = [
    tok("flat", 0, 100),          // ang absent (OCR words) → horizontal
    tok("tilted", 0, 140, 10, 8),      // 8° — inside MAX_TILT_DEG
    tok("vert", 0, 180, 10, 90),       // vertical dimension string
    tok("angled", 0, 220, 10, 45),     // 45° header
    tok("flipped", 0, 260, 10, 175),   // upside-down IS horizontal
  ];
  const { lines, skipped } = assembleLines(toks);
  const strs = lines.flatMap((l) => l.tokens.map((t) => t.str));
  assert.deepEqual(strs.sort(), ["flat", "flipped", "tilted"]);
  assert.deepEqual(skipped.map((s) => s.token.str).sort(), ["angled", "vert"]);
  assert.deepEqual(skipped.map((s) => s.ang).sort((a, b) => a - b), [45, 90]);
});

test("custom maxTiltDeg overrides the default", () => {
  const toks = [tok("a", 0, 100), tok("t", 0, 140, 10, MAX_TILT_DEG)];
  assert.equal(assembleLines(toks).skipped.length, 0);
  assert.equal(assembleLines(toks, { maxTiltDeg: 5 }).skipped.length, 1);
});

test("empty input yields no lines; whitespace-only tokens are passed through, not dropped", () => {
  assert.equal(assembleLines([]).lines.length, 0);
  // the assembly trusts its input: whitespace-only runs cannot reach it
  // (extractRegionText drops !str.trim(); OCR words are trimmed), so a blank
  // token is carried as a line of its own rather than silently filtered —
  // pinned here so the contract is explicit
  const { lines } = assembleLines([tok("  ", 0, 0)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "  ");
});
