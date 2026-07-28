// Dispatch-time isolation for plugin export items (#169). ToolMenu fires
// `it.onSelect?.()` from an onClick event handler, so a React error boundary
// structurally cannot catch a throw — the try/catch inside buildExportItems IS
// the isolation. These tests prove:
//   • a well-behaved export runs its onSelect against a live-minted ctx;
//   • a THROWING export does NOT propagate out of the dispatch wrapper, and the
//     onError callback fires (so the report can surface a non-fatal notice).
// Mutation check (documented in the report): delete the try/catch in
// buildExportItems and the "does not propagate" assertion goes red.
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExportItems } from "../src/lib/plugins/exportItems.js";
import type { CanvasApi } from "../src/lib/plugins/context.ts";
import type { PluginDescriptor } from "../src/lib/plugins/descriptor.ts";

function fakeApi(over: Partial<CanvasApi> = {}): CanvasApi {
  return {
    units: "imperial",
    getConditions: () => [],
    getShapes: () => [],
    getActiveConditionId: () => null,
    getSelectedShapeId: () => null,
    getProjectName: () => "Demo",
    dispatchShape: () => {},
    download: () => {},
    ...over,
  };
}

function descriptorWith(onSelect: (ctx: unknown) => void): PluginDescriptor {
  return {
    id: "p",
    minCtxVersion: "1.0",
    overlays: [],
    exports: [{ id: "e", label: "E", onSelect: onSelect as PluginDescriptor["exports"][number]["onSelect"] }],
  };
}

test("builds one pre-bound { id, label, onSelect } item per export slot", () => {
  const items = buildExportItems([descriptorWith(() => {})], fakeApi(), () => {});
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "p::e");
  assert.equal(items[0].label, "E");
  assert.equal(typeof items[0].onSelect, "function");
});

test("onSelect runs the plugin against a live-minted ctx (reads current api)", () => {
  let seenUnits: string | null = null;
  const desc = descriptorWith((ctx) => {
    seenUnits = (ctx as { units: string }).units;
  });
  const items = buildExportItems([desc], fakeApi({ units: "metric" }), () => {});
  items[0].onSelect();
  assert.equal(seenUnits, "metric");
});

test("a THROWING export is caught at dispatch time — does not propagate, onError fires", () => {
  const boom = new Error("export blew up");
  const desc = descriptorWith(() => { throw boom; });
  const reported: { pluginId: string; exportId: string; err: unknown }[] = [];
  const items = buildExportItems([desc], fakeApi(), (pluginId, exportId, err) => {
    reported.push({ pluginId, exportId, err });
  });
  // The whole point: calling the item does NOT throw out of the wrapper.
  assert.doesNotThrow(() => items[0].onSelect());
  assert.equal(reported.length, 1, "onError was called so a user notice can surface");
  assert.equal(reported[0].pluginId, "p");
  assert.equal(reported[0].exportId, "e");
  assert.equal(reported[0].err, boom);
});

test("no export slots → no items", () => {
  const desc: PluginDescriptor = { id: "p", minCtxVersion: "1.0", overlays: [], exports: [] };
  assert.deepEqual(buildExportItems([desc], fakeApi(), () => {}), []);
});
