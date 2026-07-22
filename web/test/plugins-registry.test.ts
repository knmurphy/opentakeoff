// The loader over an INJECTED module map (the same shape import.meta.glob
// produces), so it drives under the node runner without touching import.meta.
// Covers: a throwing thunk is a LOGGED skip (the rest load), duplicate id is
// rejected/warned, __*__ dirs are filtered before activation, and a
// future-pinned plugin is version-skipped with a plugin-naming warning.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { PluginModuleMap } from "../src/lib/plugins/registry.ts";
import { loadFeaturePlugins } from "../src/lib/plugins/registry.ts";

function mod(descriptor: unknown): () => Promise<unknown> {
  return () => Promise.resolve({ default: descriptor });
}
function throwingMod(): () => Promise<unknown> {
  return () => Promise.reject(new Error("boom in thunk"));
}
function ok(id: string, minCtxVersion = "1.0") {
  return { id, minCtxVersion, overlays: [], exports: [] };
}

// Capture console.warn / console.error so we can assert the skip is LOGGED, not
// silent — and restore it so no other test inherits the stub.
let warnings: string[];
let origWarn: typeof console.warn;
beforeEach(() => {
  warnings = [];
  origWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
});
afterEach(() => { console.warn = origWarn; });

test("a throwing plugin is skipped (logged), the rest load", async () => {
  const modules: PluginModuleMap = {
    "features/broken/plugin.js": throwingMod(),
    "features/good/plugin.js": mod(ok("good")),
  };
  const loaded = await loadFeaturePlugins(modules);
  assert.deepEqual(loaded.map((d) => d.id), ["good"]);
  assert.ok(warnings.some((w) => /broken/.test(w) && /threw/.test(w)), "skip is logged, not silent");
});

test("duplicate id is rejected/warned; the first wins", async () => {
  const modules: PluginModuleMap = {
    "features/a/plugin.js": mod(ok("dup")),
    "features/b/plugin.js": mod(ok("dup")),
  };
  const loaded = await loadFeaturePlugins(modules);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "dup");
  assert.ok(warnings.some((w) => /duplicate id "dup"/.test(w)), "duplicate is warned");
});

test("__*__ reserved dirs are globbed but FILTERED before activation", async () => {
  const modules: PluginModuleMap = {
    "features/__ci_probe__/plugin.js": mod(ok("__ci_probe__")),
    "features/real/plugin.js": mod(ok("real")),
  };
  const loaded = await loadFeaturePlugins(modules);
  assert.deepEqual(loaded.map((d) => d.id), ["real"]);
  assert.ok(!loaded.some((d) => d.id === "__ci_probe__"), "CI probe is not activated");
});

test("a descriptor with an unknown key (but compatible version) is skipped + logged", async () => {
  const modules: PluginModuleMap = {
    "features/junk/plugin.js": mod({ ...ok("junk"), panels: [] }),
    "features/clean/plugin.js": mod(ok("clean")),
  };
  const loaded = await loadFeaturePlugins(modules);
  assert.deepEqual(loaded.map((d) => d.id), ["clean"]);
  assert.ok(warnings.some((w) => /unknown descriptor key "panels"/.test(w)));
});

test("a future-pinned plugin is VERSION-skipped (not key-rejected), warning names it", async () => {
  const modules: PluginModuleMap = {
    "features/future/plugin.js": mod({ id: "future", minCtxVersion: "9.0", overlays: [], exports: [], panels: [] }),
    "features/now/plugin.js": mod(ok("now")),
  };
  const loaded = await loadFeaturePlugins(modules, { major: 1, minor: 0 });
  assert.deepEqual(loaded.map((d) => d.id), ["now"]);
  const skipLog = warnings.find((w) => /future/.test(w));
  assert.ok(skipLog, "version-skip is logged");
  assert.match(skipLog!, /version-skip/);
  assert.match(skipLog!, /host too old/);
});

test("empty module map yields no plugins and no throw", async () => {
  const loaded = await loadFeaturePlugins({});
  assert.deepEqual(loaded, []);
});

test("a module with no default descriptor is skipped, not crashed", async () => {
  const modules: PluginModuleMap = {
    "features/nodefault/plugin.js": () => Promise.resolve({ notDefault: 1 }),
    "features/good/plugin.js": mod(ok("good")),
  };
  const loaded = await loadFeaturePlugins(modules);
  assert.deepEqual(loaded.map((d) => d.id), ["good"]);
});
