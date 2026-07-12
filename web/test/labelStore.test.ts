// Ground-truth label store — issue #127. The pure persistence core behind the
// click-to-label harness: a plan's label file records the panel basename, the
// image dimensions the seeds were captured at, and a list of ground-truth room
// seeds in panel-local image px (the SAME frame floodRegion/oneClickAt use, so a
// scorer can pointInPoly truth against predicted polys directly). DOM-free, runs
// straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLabels, addRoom, removeRoom, serialize, parse } from "../src/lib/labelStore.ts";

test("addRoom then serialize round-trips through parse", () => {
  const labels = addRoom(emptyLabels("planA", 2000, 1400), { number: "134", seed: [512, 640] });
  const restored = parse(serialize(labels));
  assert.deepEqual(restored, labels);
});

test("removeRoom drops the room at the given index, keeping the rest in order", () => {
  let labels = emptyLabels("planA", 2000, 1400);
  labels = addRoom(labels, { number: "101", seed: [10, 10] });
  labels = addRoom(labels, { number: "102", seed: [20, 20] });
  labels = addRoom(labels, { number: "103", seed: [30, 30] });
  const after = removeRoom(labels, 1);
  assert.deepEqual(after.rooms, [
    { number: "101", seed: [10, 10] },
    { number: "103", seed: [30, 30] },
  ]);
  assert.equal(labels.rooms.length, 3, "original is not mutated");
});

test("parse rejects a malformed file (missing dims, bad seed, non-object)", () => {
  for (const bad of [
    "not json at all {",                                    // not JSON
    "[]",                                                    // wrong top shape
    JSON.stringify({ plan: "p", rooms: [] }),                // missing dims
    JSON.stringify({ plan: "p", width: 100, height: 100 }),  // missing rooms
    JSON.stringify({ plan: "p", width: 100, height: 100, rooms: [{ seed: [1] }] }),      // seed not a pair
    JSON.stringify({ plan: "p", width: 100, height: 100, rooms: [{ seed: ["a", "b"] }] }), // seed not numeric
  ]) {
    assert.throws(() => parse(bad), `should reject: ${bad}`);
  }
});
