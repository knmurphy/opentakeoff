// Company identity: localStorage load/save resilience. normalizeLogoToPng is
// browser-only (createImageBitmap / <canvas> / Image don't exist in node) —
// exercised in the app, deliberately NOT here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompany, saveCompany, LOGO_LIMIT } from "../src/lib/identity.js";

test("loadCompany returns {} without localStorage; saveCompany reports failure", () => {
  assert.equal(typeof globalThis.localStorage, "undefined"); // node test env
  assert.deepEqual(loadCompany(), {});                        // ReferenceError swallowed
  assert.equal(saveCompany({ name: "Acme" }), false);         // can't persist, says so
});

test("loadCompany: malformed / non-object payloads collapse to {}", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    assert.deepEqual(loadCompany(), {});                      // missing key
    store.set("opentakeoff_company", "not json {{{");
    assert.deepEqual(loadCompany(), {});                      // corrupt JSON
    store.set("opentakeoff_company", '["a","b"]');
    assert.deepEqual(loadCompany(), {});                      // array is not an object here
    store.set("opentakeoff_company", '"just a string"');
    assert.deepEqual(loadCompany(), {});                      // JSON, but not an object
    store.set("opentakeoff_company", "null");
    assert.deepEqual(loadCompany(), {});                      // null parses, still {}
    store.set("opentakeoff_company", '{"name":"Acme Floors","logo":"data:image/png;base64,AA=="}');
    assert.deepEqual(loadCompany(), { name: "Acme Floors", logo: "data:image/png;base64,AA==" });
    store.set("opentakeoff_company", '{"name":42,"address":{"street":"x"},"logo":"data:,ok"}');
    assert.deepEqual(loadCompany(), { logo: "data:,ok" });    // non-string values dropped
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("saveCompany drops empty fields; nothing left removes the key", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    assert.equal(saveCompany({ name: "Acme Floors", address: "  ", logo: "" }), true);
    assert.deepEqual(loadCompany(), { name: "Acme Floors" });  // blank address + empty logo dropped
    assert.equal(saveCompany({ name: "", address: "" }), true);
    assert.equal(store.has("opentakeoff_company"), false);     // {} → removeItem, not "{}"
    assert.deepEqual(loadCompany(), {});
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("LOGO_LIMIT is the documented cap", () => {
  assert.equal(LOGO_LIMIT, 200_000);
});
