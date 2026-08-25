import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChord, normalizeEvent, isModifierKey, chordToKeys } from "../src/lib/keymap.ts";

const ev = (key: string, m: Partial<{ shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) =>
  ({ key, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...m });

test("normalizeEvent: bare letters lowercase", () => {
  assert.equal(normalizeEvent(ev("d")), "d");
  assert.equal(normalizeEvent(ev("A", { shiftKey: true })), "shift+a");   // physical shift+A: e.key is the shifted char, shiftKey carries the modifier
});

test("normalizeEvent: mod is meta OR ctrl", () => {
  assert.equal(normalizeEvent(ev("z", { metaKey: true })), "mod+z");
  assert.equal(normalizeEvent(ev("z", { ctrlKey: true })), "mod+z");
});

test("normalizeEvent: modifier order is canonical", () => {
  assert.equal(normalizeEvent(ev("z", { metaKey: true, shiftKey: true })), "mod+shift+z");
  assert.equal(normalizeEvent(ev("d", { shiftKey: true, altKey: true })), "shift+alt+d");
});

test("normalizeEvent: named keys lowercase, punctuation/digits as-is", () => {
  assert.equal(normalizeEvent(ev("Escape")), "escape");
  assert.equal(normalizeEvent(ev("Enter")), "enter");
  assert.equal(normalizeEvent(ev("Backspace")), "backspace");
  assert.equal(normalizeEvent(ev("Delete")), "delete");
  assert.equal(normalizeEvent(ev("?")), "?");
  assert.equal(normalizeEvent(ev("1")), "1");
});

test("normalizeEvent: caps lock does not read as shift", () => {
  assert.equal(normalizeEvent(ev("A")), "a");             // caps-lock A: e.key "A" but shiftKey false -> no shift modifier
  assert.equal(normalizeEvent({ key: "A" }), "a");        // same shape with no flags at all
});

test("normalizeEvent: modifier-only presses are not chords", () => {
  assert.equal(normalizeEvent(ev("Shift", { shiftKey: true })), null);
  assert.equal(normalizeEvent(ev("Meta", { metaKey: true })), null);
  assert.equal(normalizeEvent(ev("Control", { ctrlKey: true })), null);
  assert.equal(normalizeEvent(ev("Alt", { altKey: true })), null);
});

test("normalizeChord: parses canonical and round-trips", () => {
  assert.equal(normalizeChord("mod+shift+z"), "mod+shift+z");
  assert.equal(normalizeChord("shift+d"), "shift+d");
  assert.equal(normalizeChord("d"), "d");
  assert.equal(normalizeChord("escape"), "escape");
  assert.equal(normalizeChord("?"), "?");
});

test("normalizeChord: rejects invalid", () => {
  assert.equal(normalizeChord("shift"), null);           // modifier-only
  assert.equal(normalizeChord("shift+shift+d"), null);   // duplicate modifier
  assert.equal(normalizeChord(""), null);
  assert.equal(normalizeChord("d+e"), null);             // two keys
});

test("normalizeChord: reorders modifiers to canonical order", () => {
  assert.equal(normalizeChord("alt+shift+d"), "shift+alt+d");
});

test("isModifierKey", () => {
  for (const k of ["Shift", "Control", "Ctrl", "Alt", "Meta", "Option"]) assert.equal(isModifierKey(k), true);
  assert.equal(isModifierKey("d"), false);
  assert.equal(isModifierKey("Escape"), false);
});

test("chordToKeys: display tokens, platform-aware", () => {
  assert.deepEqual(chordToKeys("shift+d", true), ["⇧", "D"]);
  assert.deepEqual(chordToKeys("shift+d", false), ["Shift", "D"]);
  assert.deepEqual(chordToKeys("mod+z", true), ["⌘", "Z"]);
  assert.deepEqual(chordToKeys("mod+z", false), ["Ctrl", "Z"]);
  assert.deepEqual(chordToKeys("escape", false), ["Esc"]);
  assert.deepEqual(chordToKeys("delete", true), ["Delete"]);
  assert.deepEqual(chordToKeys("escape", true), ["Esc"]);
  assert.deepEqual(chordToKeys("enter", true), ["⏎"]);
  assert.deepEqual(chordToKeys("backspace", true), ["⌫"]);
  assert.deepEqual(chordToKeys("delete", false), ["Delete"]);
  assert.deepEqual(chordToKeys("?", true), ["?"]);
});
