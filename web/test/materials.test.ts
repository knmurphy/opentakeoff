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
import { sanitizeMaterialLibrary, libFields, matFieldOverridden, libPushPatch, libRevertPatch, libEntryPatch, instantiateMaterial } from "../src/lib/materials.js";
import { GROUT_DEFAULTS, groutDerivedFields } from "../src/lib/coverage.js";
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";
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

// ── the library-link seam: kind + grout survive every copy, deep-copied ─────
// (adversarial review findings 1/2/3/6: libFields dropped kind/grout, so a
// promoted mosaic attached elsewhere rendered 12×24 defaults, pushes left
// stale geometry, and per-field revert desynced per/note from m.grout)

const MOSAIC = { tileL: 2, tileW: 2, tileT: 0.25, joint: 0.0625, bagLbs: 25 };
const groutLine = () => ({
  id: "mat_1", name: "Grout", kind: "grout", unit: "bag", basis: "area", round: true,
  grout: { ...MOSAIC }, ...groutDerivedFields(MOSAIC),
});

test("libFields: carries kind and grout, grout deep-copied per call", () => {
  const m = groutLine();
  const L = libFields(m);
  assert.equal(L.kind, "grout");
  assert.deepEqual(L.grout, m.grout);
  assert.notEqual(L.grout, m.grout);                    // fresh object, never shared
  assert.notEqual(libFields(m).grout, L.grout);         // fresh per CALL too
  // entries without geometry don't grow grout/kind keys
  assert.ok(!("grout" in libFields({ name: "Adhesive" })));
  assert.ok(!("kind" in libFields({ name: "Adhesive" })));
});

test("library round-trip: promote → attach preserves the mosaic geometry, rate and note coherently", () => {
  const m = groutLine();
  const entry = { id: "lib_1", ...libFields(m) };                    // promoteMaterial
  const attached = { id: "mat_2", ...libFields(entry), lib_id: entry.id };   // attachLibMaterial
  assert.deepEqual(attached.grout, MOSAIC);
  assert.notEqual(attached.grout, entry.grout);
  assert.equal(attached.kind, "grout");
  // the attached line's per/note agree with its OWN geometry — the first
  // calculator keystroke re-derives from the mosaic, not from the defaults
  assert.deepEqual(groutDerivedFields(attached.grout), { per: attached.per, note: attached.note });
  // and nothing reads as overridden right after attach
  for (const f of ["name", "unit", "per", "basis", "round", "note", "grout"]) {
    assert.equal(matFieldOverridden(attached, entry, f), false, f);
  }
});

test("matFieldOverridden: grout compares structurally, and geometry drift ambers", () => {
  const entry = { id: "lib_1", ...libFields(groutLine()) };
  const line = { id: "mat_2", ...libFields(entry), lib_id: entry.id };
  const drifted = { ...line, grout: { ...line.grout!, joint: 0.125 }, ...groutDerivedFields({ ...line.grout!, joint: 0.125 }) };
  assert.equal(matFieldOverridden(drifted, entry, "grout"), true);
  assert.equal(matFieldOverridden(drifted, entry, "per"), true);
  assert.equal(matFieldOverridden(drifted, entry, "note"), true);
  // a line with no grout object vs a defaults-geometry entry: identical rendered
  // geometry → not flagged
  const bare = { name: "Grout", per: 512 };
  assert.equal(matFieldOverridden(bare, { id: "lib_2", name: "Grout", per: 512, grout: { ...GROUT_DEFAULTS } }, "grout"), false);
});

test("libPushPatch: pushes the library's grout (deep copy) and clears stale line geometry when the library has none", () => {
  const entry = { id: "lib_1", ...libFields(groutLine()) };
  const stale = { id: "mat_3", lib_id: "lib_1", name: "Grout", per: 144, note: "6×6×1/4″ @ 1/4″ · 25 lb", grout: { tileL: 6, tileW: 6, tileT: 0.25, joint: 0.25, bagLbs: 25 } };
  const pushed = libPushPatch(stale, entry);
  assert.deepEqual(pushed.grout, MOSAIC);
  assert.notEqual(pushed.grout, entry.grout);
  assert.deepEqual(groutDerivedFields(pushed.grout), { per: pushed.per, note: pushed.note });
  // library entry WITHOUT geometry → the line's stale grout is removed, not left contradicting per/note
  const plain = { id: "lib_2", name: "Grout", unit: "bag", per: 200, basis: "area", round: true, note: "hand rate" };
  const pushed2 = libPushPatch(stale, plain);
  assert.equal(pushed2.per, 200);
  assert.ok(!("grout" in pushed2), "stale geometry must not survive a push from a geometry-less entry");
});

test("libRevertPatch: per/note/grout revert together on a grout line; plain fields revert alone", () => {
  const entry = { id: "lib_1", ...libFields(groutLine()) };
  const g6 = { tileL: 6, tileW: 6, tileT: 0.25, joint: 0.25, bagLbs: 25 };
  const drifted = { id: "mat_4", lib_id: "lib_1", name: "Grout", grout: g6, ...groutDerivedFields(g6) };
  for (const f of ["per", "note", "grout"]) {
    const patch = libRevertPatch(drifted, entry, f);
    assert.deepEqual(patch.grout, MOSAIC);
    assert.notEqual(patch.grout, entry.grout);
    assert.deepEqual(groutDerivedFields(patch.grout!), { per: patch.per, note: patch.note });
  }
  // name reverts alone, untouched geometry
  assert.deepEqual(libRevertPatch({ ...drifted, name: "Ultracolor" }, entry, "name"), { name: "Grout" });
  // non-grout line: per reverts alone
  assert.deepEqual(libRevertPatch({ id: "m", lib_id: "l", per: 9 }, { id: "l", name: "Adhesive", per: 250 }, "per"), { per: 250 });
  // library entry without geometry: reverting per also clears the line's grout (coherence with the reverted note)
  const patch = libRevertPatch(drifted, { id: "lib_2", name: "Grout", per: 200, note: "hand rate" }, "per");
  assert.equal(patch.per, 200);
  assert.ok("grout" in patch && patch.grout === undefined);
});

test("libEntryPatch: hand-editing per or note on a Materials-tab grout entry detaches its geometry", () => {
  const entry = { id: "lib_1", ...libFields(groutLine()) };
  assert.ok(!("grout" in libEntryPatch(entry, { per: 300 })));
  assert.ok(!("grout" in libEntryPatch(entry, { note: "custom" })));
  assert.deepEqual(libEntryPatch(entry, { name: "Ultracolor" }).grout, MOSAIC);   // other edits keep it
  // an explicit grout patch (future callers) is deep-copied in
  const g = { ...MOSAIC, joint: 0.125 };
  const next = libEntryPatch(entry, { grout: g, per: 1, note: "n" });
  assert.deepEqual(next.grout, g);
  assert.notEqual(next.grout, g);
});

// ── seed aliasing (finding 4): instantiation deep-copies nested grout ───────

test("instantiateMaterial: deep-copies grout so the CT-1 seed's object is never shared into live state", () => {
  const seedGrout: any = FLOORING_DEFAULTS.find((t: any) => t.finish_tag === "CT-1")!.materials.find((m: any) => m.kind === "grout")!;
  const a = instantiateMaterial(seedGrout, "mat_a");
  const b = instantiateMaterial(seedGrout, "mat_b");
  assert.deepEqual(a.grout, seedGrout.grout);
  assert.notEqual(a.grout, seedGrout.grout);   // not the module-load singleton
  assert.notEqual(a.grout, b.grout);           // not shared between instantiations
  assert.equal(a.id, "mat_a");
  assert.equal(a.round, true);
  // materials without grout don't grow a grout key
  assert.ok(!("grout" in instantiateMaterial({ name: "Adhesive", per: 250 }, "mat_c")));
});
