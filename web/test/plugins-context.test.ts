// The canvasContext façade surface-lock. buildCanvasContext must expose EXACTLY
// the ten frozen members and nothing more; commands must be exactly
// { dispatchShape }. The lock is real: a mutation check (adding a stray member
// to the returned object) is documented in the report — this test goes red for
// any extra/missing key.
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanvasContext,
  CANVAS_CONTEXT_VERSION,
} from "../src/lib/plugins/context.ts";
import type { CanvasApi } from "../src/lib/plugins/context.ts";
import { metaGet, metaPut, metaDelete } from "../src/lib/store.js";

const meta = {
  get: (k: string) => metaGet(k),
  put: (k: string, v: unknown) => metaPut(k, v),
  delete: (k: string) => metaDelete(k),
};

function fakeApi(overrides: Partial<CanvasApi> = {}): CanvasApi {
  return {
    units: "imperial",
    getConditions: () => [{ id: "c1" }],
    getShapes: () => [{ id: "s1", condition_id: "c1" }],
    getActiveConditionId: () => "c1",
    getSelectedShapeId: () => "s1",
    getProjectName: () => "Demo Project",
    dispatchShape: () => {},
    download: () => {},
    ...overrides,
  };
}

const TEN_KEYS = [
  "version",
  "units",
  "getConditions",
  "getShapes",
  "getActiveConditionId",
  "getSelectedShapeId",
  "getProjectName",
  "commands",
  "storage",
  "download",
];

test("surface lock: ctx exposes EXACTLY the ten frozen members", () => {
  const ctx = buildCanvasContext(fakeApi(), "p", meta);
  assert.deepEqual(Object.keys(ctx).sort(), [...TEN_KEYS].sort());
});

test("surface lock: commands is exactly { dispatchShape }", () => {
  const ctx = buildCanvasContext(fakeApi(), "p", meta);
  assert.deepEqual(Object.keys(ctx.commands), ["dispatchShape"]);
});

test("version is the host major.minor string", () => {
  const ctx = buildCanvasContext(fakeApi(), "p", meta);
  assert.equal(ctx.version, `${CANVAS_CONTEXT_VERSION.major}.${CANVAS_CONTEXT_VERSION.minor}`);
  assert.match(ctx.version, /^\d+\.\d+$/);
});

test("accessors read LIVE api values, not a mount snapshot", () => {
  // Build the api with a live `units` getter directly (a spread would snapshot
  // it), so a change after ctx creation must be observed through the façade.
  let units = "imperial";
  const conditions = [{ id: "c1" }];
  const api: CanvasApi = {
    get units() { return units; },
    getConditions: () => conditions,
    getShapes: () => [],
    getActiveConditionId: () => null,
    getSelectedShapeId: () => null,
    getProjectName: () => "P",
    dispatchShape: () => {},
    download: () => {},
  };
  const ctx = buildCanvasContext(api, "p", meta);
  assert.equal(ctx.units, "imperial");
  units = "metric";
  conditions.push({ id: "c2" });
  assert.equal(ctx.units, "metric", "units accessor is live");
  assert.equal(ctx.getConditions().length, 2, "getConditions is live");
});

test("commands.dispatchShape routes through api.dispatchShape with cmd + opts", () => {
  const calls: Array<[unknown, unknown]> = [];
  const ctx = buildCanvasContext(
    fakeApi({ dispatchShape: (cmd, opts) => { calls.push([cmd, opts]); } }),
    "p",
    meta,
  );
  ctx.commands.dispatchShape({ kind: "add" }, { record: true });
  assert.deepEqual(calls, [[{ kind: "add" }, { record: true }]]);
});

test("download delegates to api.download(filename, text, mime)", () => {
  const calls: unknown[] = [];
  const ctx = buildCanvasContext(
    fakeApi({ download: (f, t, m) => calls.push([f, t, m]) }),
    "p",
    meta,
  );
  ctx.download("out.txt", "hi", "text/plain");
  assert.deepEqual(calls, [["out.txt", "hi", "text/plain"]]);
});

test("each plugin gets its own namespaced storage on ctx", () => {
  const ctx = buildCanvasContext(fakeApi(), "p", meta);
  assert.deepEqual(Object.keys(ctx.storage).sort(), ["get", "remove", "set"]);
});
