// Material library — the load gate (PR #50 review follow-up). The
// `material_library` meta record is browser-global, and matLibById /
// updateLibMaterial / the Materials tab's row keys all dereference `m.id`:
// one malformed or duplicate-id item used to crash the canvas, or silently
// merge two materials, for EVERY project at once. The invariants:
//   - non-array records sanitize to [];
//   - items must be plain objects with a non-empty string `id`;
//   - duplicate ids are deduped first-wins (later entries with the same id
//     are dropped — the sanitizeConditionColumns precedent);
//   - unknown item fields pass through (the scale_source precedent), so a
//     valid library survives the save -> load round-trip unchanged;
//   - store.loadMaterialLibrary() routes through the sanitizer.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMaterialLibrary } from "../src/lib/materials.js";
import { store } from "../src/lib/store.js";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
});

// A well-formed library, shaped exactly like the canvas's promoteMaterial /
// addLibMaterial output (id, name, unit, per, basis, round, optional note).
const lib = () => [
  { id: "lib_1", name: "Adhesive", unit: "gal", per: 250, basis: "area", round: true, note: "" },
  { id: "lib_2", name: "Grout", unit: "lb", per: 25, basis: "area", round: false },
];

// ── sanitizeMaterialLibrary ──────────────────────────────────────────────────

test("round-trip: a valid library sanitizes unchanged (deep-equal)", () => {
  const saved = lib();
  assert.deepEqual(sanitizeMaterialLibrary(JSON.parse(JSON.stringify(saved))), saved);
});

test("non-array records sanitize to []", () => {
  for (const raw of [undefined, null, 42, "lib_1", {}, { id: "lib_1" }]) {
    assert.deepEqual(sanitizeMaterialLibrary(raw), [], String(raw));
  }
});

test("malformed items are dropped: plain object with a non-empty string id", () => {
  const raw = [
    ...lib(),
    null,                               // not an object
    "lib_3",                            // primitive
    7,                                   // primitive
    ["lib_4"],                          // array is not a material
    { name: "no id" },                  // missing id
    { id: 9, name: "non-string id" },   // non-string id
    { id: "", name: "empty id" },       // empty id
  ];
  assert.deepEqual(sanitizeMaterialLibrary(raw), lib());
});

test("duplicate ids: first-wins dedupe (the sanitizeConditionColumns precedent)", () => {
  const raw = [
    { id: "lib_1", name: "Adhesive", unit: "gal", per: 250, basis: "area", round: true },
    { id: "lib_1", name: "Evil twin", unit: "ea", per: 999, basis: "count", round: false },
    { id: "lib_2", name: "Grout" },
    { id: "lib_2", name: "Grout twin" },
  ];
  assert.deepEqual(sanitizeMaterialLibrary(raw), [
    { id: "lib_1", name: "Adhesive", unit: "gal", per: 250, basis: "area", round: true },
    { id: "lib_2", name: "Grout" },
  ]);
});

test("unknown item fields survive the round-trip (scale_source precedent)", () => {
  const saved = [{ id: "lib_1", name: "Thinset", future_field: { v: 1 } }];
  assert.deepEqual(sanitizeMaterialLibrary(JSON.parse(JSON.stringify(saved))), saved);
});

// ── store.loadMaterialLibrary wiring ─────────────────────────────────────────

test("loadMaterialLibrary routes the stored record through the sanitizer", async () => {
  // saveMaterialLibrary stores wholesale; the corrupt/duplicate items must be
  // gone on load
  await store.saveMaterialLibrary([...lib(), null, { name: "no id" }, { id: "lib_1", name: "dup" }]);
  assert.deepEqual(await store.loadMaterialLibrary(), lib());
});

test("loadMaterialLibrary returns [] for a missing or non-array record", async () => {
  assert.deepEqual(await store.loadMaterialLibrary(), []);
  await store.saveMaterialLibrary("not-a-list" as any);   // saveMaterialLibrary already guards
  assert.deepEqual(await store.loadMaterialLibrary(), []);
});
