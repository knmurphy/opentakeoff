// The frozen descriptor schema + surface lock. The descriptor is a semver'd
// public surface: its key set is EXACTLY { id, minCtxVersion, overlays, exports }
// and validateDescriptor rejects anything else. The frozen-key test does a real
// mutation check (see the note in the report): adding a stray key to the input
// must be rejected.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDescriptor,
  isActivatable,
  DESCRIPTOR_KEYS,
} from "../src/lib/plugins/descriptor.ts";

function goodDescriptor() {
  return {
    id: "demo",
    minCtxVersion: "1.0",
    overlays: [{ id: "o", label: "O", render: () => null }],
    exports: [{ id: "e", label: "E", onSelect: () => {} }],
  };
}

test("frozen key set is exactly {id, minCtxVersion, overlays, exports}", () => {
  assert.deepEqual([...DESCRIPTOR_KEYS].sort(), ["exports", "id", "minCtxVersion", "overlays"]);
});

test("valid descriptor passes and is returned", () => {
  const r = validateDescriptor(goodDescriptor());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.descriptor.id, "demo");
    assert.equal(r.descriptor.overlays.length, 1);
    assert.equal(r.descriptor.exports.length, 1);
  }
});

test("unknown key is rejected (frozen-key mutation: add a stray key → must reject)", () => {
  const withStray = { ...goodDescriptor(), title: "Nope" };
  const r = validateDescriptor(withStray);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /unknown descriptor key "title"/);
});

test("spike's out-of-v1 keys are rejected (panels / setup / agentTools)", () => {
  for (const key of ["panels", "setup", "agentTools"]) {
    const r = validateDescriptor({ ...goodDescriptor(), [key]: [] });
    assert.equal(r.ok, false, `${key} must be rejected in v1`);
  }
});

test("missing / malformed id rejected", () => {
  assert.equal(validateDescriptor({ ...goodDescriptor(), id: "" }).ok, false);
  const { id: _drop, ...noId } = goodDescriptor();
  void _drop;
  assert.equal(validateDescriptor(noId).ok, false);
});

test("malformed minCtxVersion rejected", () => {
  assert.equal(validateDescriptor({ ...goodDescriptor(), minCtxVersion: "1" }).ok, false);
  assert.equal(validateDescriptor({ ...goodDescriptor(), minCtxVersion: 1 }).ok, false);
});

test("overlay slot needs render(); export slot needs onSelect()", () => {
  const badOverlay = { ...goodDescriptor(), overlays: [{ id: "o", label: "O" }] };
  assert.equal(validateDescriptor(badOverlay).ok, false);
  const badExport = { ...goodDescriptor(), exports: [{ id: "e", label: "E" }] };
  assert.equal(validateDescriptor(badExport).ok, false);
});

test("export slot uses onSelect (void convention), NOT the spike's run()", () => {
  const spikeShaped = {
    ...goodDescriptor(),
    exports: [{ id: "e", label: "E", run: () => ({ text: "x" }) }],
  };
  // run is not onSelect → rejected (missing onSelect); proves we did not adopt
  // the spike's returning run(ctx).
  assert.equal(validateDescriptor(spikeShaped).ok, false);
});

test("non-object descriptor rejected, never throws", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    assert.equal(validateDescriptor(bad).ok, false);
  }
});

test("isActivatable: __*__ reserved ids never activate; ordinary ids do", () => {
  assert.equal(isActivatable({ id: "__ci_probe__", minCtxVersion: "1.0", overlays: [], exports: [] }), false);
  assert.equal(isActivatable({ id: "summary", minCtxVersion: "1.0", overlays: [], exports: [] }), true);
});
