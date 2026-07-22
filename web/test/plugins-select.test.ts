// The version gate (`selectRenderablePlugins`) + the gate-before-reject
// ordering. Pure function: buckets into {rendered, skipped}; the skipped entries
// carry the plugin id so the CALLER can warn. It must run before unknown-key
// rejection, so a future-pinned plugin carrying a host-unknown key is
// version-skipped, not hard-rejected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRenderablePlugins } from "../src/lib/plugins/select.ts";
import { validateDescriptor } from "../src/lib/plugins/descriptor.ts";

const HOST = { major: 1, minor: 2 };

test("renders a plugin the host can satisfy; the AC's 1.1 vs 1.2/1.0 cases", () => {
  const p11 = { id: "p", minCtxVersion: "1.1", overlays: [], exports: [] };
  assert.deepEqual(
    selectRenderablePlugins([p11], { major: 1, minor: 2 }).rendered,
    [p11],
    "1.1 renders on host 1.2",
  );
  const skipLow = selectRenderablePlugins([p11], { major: 1, minor: 0 });
  assert.equal(skipLow.rendered.length, 0);
  assert.equal(skipLow.skipped.length, 1, "1.1 skipped on host 1.0");
});

test("skipped entry names the plugin so the caller can warn", () => {
  const p = { id: "future-feature", minCtxVersion: "9.0", overlays: [], exports: [] };
  const { skipped } = selectRenderablePlugins([p], HOST);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, "future-feature");
  assert.match(skipped[0].reason, /host too old/);
});

test("a newer-major host skips a plugin pinned to the older major", () => {
  const p = { id: "p", minCtxVersion: "1.5", overlays: [], exports: [] };
  const { rendered, skipped } = selectRenderablePlugins([p], { major: 2, minor: 0 });
  assert.equal(rendered.length, 0);
  assert.equal(skipped.length, 1);
});

test("unreadable minCtxVersion is skipped, not rendered, and never crashes", () => {
  const p = { id: "junk", minCtxVersion: "not-a-version", overlays: [], exports: [] };
  const { rendered, skipped } = selectRenderablePlugins([p], HOST);
  assert.equal(rendered.length, 0);
  assert.equal(skipped[0].id, "junk");
});

test("is pure — no thrown error, input array not mutated", () => {
  const input = [{ id: "a", minCtxVersion: "1.0", overlays: [], exports: [] }];
  const before = JSON.stringify(input);
  selectRenderablePlugins(input, HOST);
  assert.equal(JSON.stringify(input), before);
});

// The forward-compat interaction: version gate BEFORE unknown-key rejection.
test("future minCtxVersion + host-unknown key → version-SKIP, not unknown-key reject", () => {
  const futureWithUnknownKey = {
    id: "future",
    minCtxVersion: "9.0",
    overlays: [],
    exports: [],
    panels: [{ id: "x" }], // a key this host doesn't know yet
  };
  // Pipeline order: gate first.
  const { rendered, skipped } = selectRenderablePlugins([futureWithUnknownKey], HOST);
  assert.equal(rendered.length, 0, "must be version-skipped, never reach key validation");
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /host too old/);
  assert.equal(skipped[0].id, "future");
});

test("version-COMPATIBLE + junk key → hard-reject at validateDescriptor", () => {
  const compatibleWithJunk = {
    id: "compat",
    minCtxVersion: "1.0",
    overlays: [],
    exports: [],
    panels: [], // junk key on a compatible descriptor
  };
  const { rendered } = selectRenderablePlugins([compatibleWithJunk], HOST);
  assert.equal(rendered.length, 1, "compatible → passes the gate");
  const r = validateDescriptor(rendered[0]);
  assert.equal(r.ok, false, "…then validateDescriptor hard-rejects the junk key");
  if (!r.ok) assert.match(r.reason, /unknown descriptor key "panels"/);
});
