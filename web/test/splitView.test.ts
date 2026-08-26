import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSplitView, normalizeSplitView, clampRatio, MIN_RATIO, MAX_RATIO } from "../src/lib/splitView.ts";

test("serialize→normalize round-trips a valid split", () => {
  const sv = { orientation: "v" as const, ratio: 0.5, refKey: "A101#2" };
  assert.deepEqual(normalizeSplitView(serializeSplitView(sv)), sv);
});

test("no split serializes to null (so the persisted key is omitted)", () => {
  assert.equal(serializeSplitView(null), null);
});

test("normalize rejects malformed input", () => {
  assert.equal(normalizeSplitView(undefined), null);
  assert.equal(normalizeSplitView({}), null);
  assert.equal(normalizeSplitView({ orientation: "x", ratio: 0.5, refKey: "A" }), null);
  assert.equal(normalizeSplitView({ orientation: "v", ratio: 0.5 }), null); // missing refKey
});

test("normalize clamps an out-of-range ratio instead of dropping the split", () => {
  const sv = normalizeSplitView({ orientation: "h", ratio: 0.99, refKey: "A" });
  assert.equal(sv?.ratio, MAX_RATIO);
});

test("clampRatio holds bounds", () => {
  assert.equal(clampRatio(0.01), MIN_RATIO);
  assert.equal(clampRatio(0.95), MAX_RATIO);
  assert.equal(clampRatio(0.5), 0.5);
});
