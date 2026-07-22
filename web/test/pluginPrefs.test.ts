// pluginPrefs is host-side (NOT the frozen core): a localStorage-backed disabled
// set with theme.js-style reactivity. Tested under node with stubbed globals —
// a Map-backed fake localStorage and an EventTarget-backed fake window — proving
// add/remove round-trip, isPluginDisabled, malformed-JSON tolerance, and that a
// write survives a re-read (persistence). Node 24 provides EventTarget +
// CustomEvent as globals, so `new EventTarget()` supplies add/remove/dispatch.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getDisabledPluginIds,
  isPluginDisabled,
  setPluginDisabled,
  onDisabledPluginsChange,
} from "../src/lib/plugins/pluginPrefs.js";

const KEY = "opentakeoff_plugins_disabled";

// Minimal localStorage shim — the only two methods the module reaches for.
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).localStorage = fakeLocalStorage();
  (globalThis as Record<string, unknown>).window = new EventTarget();
});

test("empty by default (no stored value)", () => {
  assert.deepEqual([...getDisabledPluginIds()], []);
  assert.equal(isPluginDisabled("takeoff-notes"), false);
});

test("add/remove round-trip via setPluginDisabled", () => {
  setPluginDisabled("takeoff-notes", true);
  assert.equal(isPluginDisabled("takeoff-notes"), true);
  assert.deepEqual([...getDisabledPluginIds()], ["takeoff-notes"]);

  setPluginDisabled("scope-summary", true);
  assert.deepEqual([...getDisabledPluginIds()].sort(), ["scope-summary", "takeoff-notes"]);

  setPluginDisabled("takeoff-notes", false);
  assert.equal(isPluginDisabled("takeoff-notes"), false);
  assert.deepEqual([...getDisabledPluginIds()], ["scope-summary"]);
});

test("disabling the same id twice is idempotent (no duplicates)", () => {
  setPluginDisabled("p", true);
  setPluginDisabled("p", true);
  assert.deepEqual([...getDisabledPluginIds()], ["p"]);
});

test("persists across a fresh read (write → re-read same backing store)", () => {
  setPluginDisabled("p", true);
  // Simulate a reload: a brand-new getDisabledPluginIds call reads the same
  // localStorage backing that setPluginDisabled wrote.
  assert.equal(isPluginDisabled("p"), true);
  assert.equal(
    (globalThis as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem(KEY),
    JSON.stringify(["p"]),
  );
});

test("malformed JSON tolerated → empty set, never throws", () => {
  (globalThis as { localStorage: { setItem(k: string, v: string): void } })
    .localStorage.setItem(KEY, "{not json");
  assert.deepEqual([...getDisabledPluginIds()], []);
  assert.equal(isPluginDisabled("anything"), false);
});

test("non-array JSON tolerated → empty set", () => {
  (globalThis as { localStorage: { setItem(k: string, v: string): void } })
    .localStorage.setItem(KEY, JSON.stringify({ takeoff: true }));
  assert.deepEqual([...getDisabledPluginIds()], []);
});

test("non-string members are filtered out", () => {
  (globalThis as { localStorage: { setItem(k: string, v: string): void } })
    .localStorage.setItem(KEY, JSON.stringify(["ok", 3, null, "also-ok"]));
  assert.deepEqual([...getDisabledPluginIds()].sort(), ["also-ok", "ok"]);
});

test("onDisabledPluginsChange fires on setPluginDisabled and unsubscribes", () => {
  const seen: string[][] = [];
  const off = onDisabledPluginsChange((set: Set<string>) => seen.push([...set]));
  setPluginDisabled("p", true);
  assert.deepEqual(seen.at(-1), ["p"]);
  off();
  setPluginDisabled("q", true);
  // No further notification after unsubscribe.
  assert.deepEqual(seen.at(-1), ["p"]);
});
