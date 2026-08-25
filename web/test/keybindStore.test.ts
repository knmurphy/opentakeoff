import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { loadKeybindOverrides, saveKeybindOverrides, clearKeybindOverrides, KEYBIND_KEY } from "../src/lib/keybindStore.js";
import { getOverrides, applyOverrides, resetAll } from "../src/lib/keymap.ts";
import { metaGet, metaPut, metaDelete } from "../src/lib/store.js";

beforeEach(async () => { resetAll(); await metaDelete(KEYBIND_KEY).catch(() => {}); });

test("save/load round-trips overrides", async () => {
  applyOverrides({ area: "x", escape: "q" });
  await saveKeybindOverrides();
  applyOverrides({});                       // simulate a fresh boot
  await loadKeybindOverrides();
  assert.deepEqual(getOverrides(), { area: "x", escape: "q" });
});

test("load with nothing stored leaves empty overrides", async () => {
  await loadKeybindOverrides();
  assert.deepEqual(getOverrides(), {});
});

test("clear removes the key and resets live state", async () => {
  applyOverrides({ area: "x" });
  await saveKeybindOverrides();
  await clearKeybindOverrides();
  assert.deepEqual(getOverrides(), {});
  assert.equal(await metaGet(KEYBIND_KEY), undefined);
});

test("a save writes only overrides (not defaults)", async () => {
  applyOverrides({ area: "x" });
  await saveKeybindOverrides();
  assert.deepEqual(await metaGet(KEYBIND_KEY), { area: "x" });
});
