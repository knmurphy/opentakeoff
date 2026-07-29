// roomNameFromTokens — the One-Click auto-naming heuristics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomNameFromTokens, type NameToken } from "../src/lib/roomName.ts";

const ROOM: [number, number][] = [[100, 100], [400, 100], [400, 300], [100, 300]];
const tok = (str: string, x: number, y: number, h = 12): NameToken => ({ str, x, y, h });

test("name line + number line inside the region compose a label", () => {
  const t = [tok("OFFICE", 220, 190), tok("101", 240, 206)];
  assert.equal(roomNameFromTokens(t, ROOM), "OFFICE 101");
});

test("single-line 'CONF 102' is used verbatim and beats stray lines", () => {
  const t = [tok("CONF 102", 220, 200), tok("STOR", 230, 120), tok("7", 300, 120)];
  assert.equal(roomNameFromTokens(t, ROOM), "CONF 102");
});

test("tokens outside the region are ignored", () => {
  const t = [tok("CORRIDOR", 600, 200), tok("104", 620, 216), tok("BREAK", 220, 190), tok("103", 240, 206)];
  assert.equal(roomNameFromTokens(t, ROOM), "BREAK 103");
});

test("dimension strings, scale notes, and multiplication junk never name a room", () => {
  const t = [tok("12'-6\"", 200, 150), tok("SCALE: 1/4\"", 200, 180), tok("2x4 TYP", 220, 210)];
  assert.equal(roomNameFromTokens(t, ROOM), null);
});

test("number-only plans fall back to the room number nearest the center", () => {
  const t = [tok("101", 220, 195), tok("22", 110, 110)];
  assert.equal(roomNameFromTokens(t, ROOM), "101");
});

test("keynote/sheet references and finish-tag fragments never name a room (VA plan noise)", () => {
  // "AE213" + stray "7" — a keynote ref beside an equipment number
  assert.equal(roomNameFromTokens([tok("AE213", 220, 190), tok("7", 240, 206)], ROOM), null);
  // "CPT -" — a finish callout fragment; bare 3-letter tags are not rooms
  assert.equal(roomNameFromTokens([tok("CPT -", 220, 195)], ROOM), null);
  // but a real short-name room WITH its number still composes
  assert.equal(roomNameFromTokens([tok("JAN", 220, 190), tok("105", 240, 206)], ROOM), "JAN 105");
});

test("a split name line ('OFF' 'ICE' tokens at the same y) rejoins in x order", () => {
  const t = [tok("ELEC", 200, 190), tok("/ JAN", 236, 191), tok("105", 220, 208)];
  assert.equal(roomNameFromTokens(t, ROOM), "ELEC / JAN 105");
});

test("empty token list or degenerate ring → null", () => {
  assert.equal(roomNameFromTokens([], ROOM), null);
  assert.equal(roomNameFromTokens([tok("OFFICE", 200, 200)], [[0, 0], [1, 1]]), null);
});
