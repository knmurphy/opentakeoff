// ctx.storage — an irreversible surface. Tested for: (1) no property reveals the
// backing; (2) scope:'project' async-rejects uniformly, message names the SCOPE
// CONTRACT only (never IndexedDB/Drive); (3) scope:'device' round-trips against
// the REAL fake-indexeddb meta store, not a mock; (4) keyspace escaping defeats
// the ("a","b:c") vs ("a:b","c") collision; (5) scope tokens are exactly
// device/project.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createPluginStorage,
  pluginStorageKey,
  STORAGE_SCOPES,
} from "../src/lib/plugins/storage.ts";
import { metaGet, metaPut, metaDelete } from "../src/lib/store.js";

// The device MetaStore, backed by the app's real meta store (device-local
// IndexedDB) under fake-indexeddb — the real round-trip, not a stub.
const deviceMeta = {
  get: (key: string) => metaGet(key),
  put: (key: string, value: unknown) => metaPut(key, value),
  delete: (key: string) => metaDelete(key),
};

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

test("scope tokens are pinned exactly to device/project", () => {
  assert.deepEqual([...STORAGE_SCOPES], ["device", "project"]);
});

test("handle exposes NO backing-revealing property", () => {
  const s = createPluginStorage("p", deviceMeta);
  // Enumerable own props: exactly the three methods.
  assert.deepEqual(Object.keys(s).sort(), ["get", "remove", "set"]);
  // Nothing on the whole prototype chain names the scope or the backend.
  for (const leak of ["scope", "backend", "backing", "store", "db"]) {
    assert.ok(!(leak in s), `"${leak}" must not be present on the storage handle`);
  }
});

test("device scope round-trips (real fake-indexeddb)", async () => {
  const s = createPluginStorage("summary", deviceMeta);
  assert.equal(await s.get("note"), undefined);
  await s.set("note", "hello");
  assert.equal(await s.get("note"), "hello");
  await s.remove("note");
  assert.equal(await s.get("note"), undefined);
});

test("default scope is device (no opts) and round-trips", async () => {
  const s = createPluginStorage("p", deviceMeta);
  await s.set("k", 7);
  assert.equal(await s.get("k"), 7);
});

test("explicit scope:'device' opt round-trips", async () => {
  const s = createPluginStorage("p", deviceMeta);
  await s.set("k", "v", { scope: "device" });
  assert.equal(await s.get("k", { scope: "device" }), "v");
});

test("scope:'project' async-rejects UNIFORMLY (no sync throw), naming scope contract only", async () => {
  const s = createPluginStorage("p", deviceMeta);
  // Must be a rejected promise — NOT a synchronous throw the plugin must guard.
  const p = s.get("k", { scope: "project" });
  assert.ok(p instanceof Promise, "returns a promise, does not throw synchronously");
  await assert.rejects(p, (err: Error) => {
    assert.equal(err.message, "project scope not yet supported");
    // Never names the backend.
    assert.doesNotMatch(err.message, /indexeddb|drive/i);
    return true;
  });
  // set and remove reject the same way.
  await assert.rejects(s.set("k", 1, { scope: "project" }), /project scope not yet supported/);
  await assert.rejects(s.remove("k", { scope: "project" }), /project scope not yet supported/);
});

test("no error message across the surface names IndexedDB or Drive", async () => {
  const s = createPluginStorage("p", deviceMeta);
  for (const call of [
    () => s.get("k", { scope: "project" }),
    () => s.set("k", 1, { scope: "project" }),
    () => s.remove("k", { scope: "project" }),
  ]) {
    await assert.rejects(call, (err: Error) => {
      assert.doesNotMatch(err.message, /indexeddb|drive|store\b/i);
      return true;
    });
  }
});

test("keyspace escaping: ('a','b:c') and ('a:b','c') do NOT collide", () => {
  const k1 = pluginStorageKey("a", "b:c");
  const k2 = pluginStorageKey("a:b", "c");
  assert.notEqual(k1, k2);
});

test("keyspace: crafted key cannot climb into another plugin's namespace", async () => {
  // Plugin "a" writes key "b:secret"; plugin "a:b" writes key "secret".
  // If keys collided, one would read the other's value.
  const pluginA = createPluginStorage("a", deviceMeta);
  const pluginAB = createPluginStorage("a:b", deviceMeta);
  await pluginA.set("b:secret", "owned-by-a");
  await pluginAB.set("secret", "owned-by-ab");
  assert.equal(await pluginA.get("b:secret"), "owned-by-a");
  assert.equal(await pluginAB.get("secret"), "owned-by-ab", "no cross-namespace bleed");
});

test("length-prefixed physical key is deterministic for the same (id,key)", () => {
  assert.equal(pluginStorageKey("a", "b"), pluginStorageKey("a", "b"));
  assert.equal(pluginStorageKey("summary", "note"), "plugin/7:summary/4:note");
});
