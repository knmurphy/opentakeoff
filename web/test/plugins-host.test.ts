// host.js — the shared ctx-mint. The invariant under test: mintPluginCtx's
// optional `onError` wraps the plugin ACTION surface (dispatchShape, download)
// so a throw from a plugin's own event handler is contained + surfaced (the
// #168 I-1 overlay-path fix), while the read accessors stay live and the
// no-onError path keeps propagating (the export menu guards itself).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mintPluginCtx } from "../src/lib/plugins/host.js";

function stubApi(overrides = {}) {
  return {
    units: "imperial",
    getConditions: () => [{ id: "c1" }],
    getShapes: () => [],
    getActiveConditionId: () => null,
    getSelectedShapeId: () => null,
    getProjectName: () => "proj",
    dispatchShape: () => {},
    download: () => {},
    ...overrides,
  };
}

test("mintPluginCtx: with onError, a throwing dispatchShape is contained (no propagation) and surfaced", () => {
  const calls: unknown[][] = [];
  const api = stubApi({ dispatchShape: () => { throw new Error("boom"); } });
  const ctx = mintPluginCtx(api, "p1", (id: string, action: string, err: unknown) => calls.push([id, action, String(err)]));
  assert.doesNotThrow(() => ctx.commands.dispatchShape({ type: "label" }));
  assert.deepEqual(calls, [["p1", "dispatchShape", "Error: boom"]]);
});

test("mintPluginCtx: with onError, a throwing download is contained and surfaced", () => {
  const calls: string[][] = [];
  const api = stubApi({ download: () => { throw new Error("dl"); } });
  const ctx = mintPluginCtx(api, "p2", (id: string, action: string) => calls.push([id, action]));
  assert.doesNotThrow(() => ctx.download("f.txt", "x"));
  assert.deepEqual(calls, [["p2", "download"]]);
});

test("mintPluginCtx: WITHOUT onError, a throwing dispatchShape propagates (export path guards itself)", () => {
  const api = stubApi({ dispatchShape: () => { throw new Error("boom"); } });
  const ctx = mintPluginCtx(api, "p3");
  assert.throws(() => ctx.commands.dispatchShape({ type: "x" }), /boom/);
});

test("mintPluginCtx: a successful dispatchShape passes args through unchanged and never fires onError", () => {
  const received: unknown[][] = [];
  let errored = false;
  const api = stubApi({ dispatchShape: (cmd: unknown, opts: unknown) => received.push([cmd, opts]) });
  const ctx = mintPluginCtx(api, "p4", () => { errored = true; });
  ctx.commands.dispatchShape({ type: "label", ids: ["s1"] }, { foo: 1 });
  assert.equal(errored, false);
  assert.deepEqual(received, [[{ type: "label", ids: ["s1"] }, { foo: 1 }]]);
});

test("mintPluginCtx: guarding actions does not disturb live read accessors", () => {
  let conditions = [{ id: "a" }];
  const api = stubApi({ getConditions: () => conditions });
  const ctx = mintPluginCtx(api, "p5", () => {});
  assert.deepEqual(ctx.getConditions(), [{ id: "a" }]);
  conditions = [{ id: "a" }, { id: "b" }];
  // Live, not a mount snapshot — the guarded api forwards the same accessor closure.
  assert.deepEqual(ctx.getConditions(), [{ id: "a" }, { id: "b" }]);
  assert.equal(ctx.units, "imperial");
});
