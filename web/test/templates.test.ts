// Condition template library — the load gate (PR #50 follow-up). The
// `condition_templates` meta record is browser-global, and hydrate's
// fresh-workspace seeding maps every item through instantiateTemplate, which
// dereferences finish_tag and .map's materials: one malformed item used to
// throw inside hydrate and wedge/wipe EVERY project at once. The invariants:
//   - non-array records sanitize to [];
//   - items must be plain objects with a non-empty string finish_tag;
//   - color/fill/hatch are strings when present (non-strings removed so the
//     canvas's own defaulting applies — sanitize stays minimal);
//   - materials is always an array of plain objects (non-array → [],
//     non-object entries dropped);
//   - unknown item fields pass through (the scale_source precedent), so a
//     valid library survives the save → load round-trip unchanged;
//   - store.loadTemplates() routes through the sanitizer.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTemplates } from "../src/lib/templates.js";
import { instantiateTemplate, condToTemplate } from "../src/lib/canvasUtil.js";
import { store } from "../src/lib/store.js";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
});

// A well-formed library, shaped exactly like the canvas's condToTemplate
// output (finish_tag, color, fill, hatch, waste_pct, optional H/T, materials
// without ids).
const lib = () => [
  {
    finish_tag: "CPT-1", color: "#2f7d54", fill: "#2f7d54", hatch: "speckle", waste_pct: 5,
    materials: [{ name: "Adhesive", per: 250, basis: "area", unit: "gal", round: true }],
  },
  { finish_tag: "TR-1", color: "#c96442", fill: "#c96442", hatch: "vert", waste_pct: 0, height_ft: 4, materials: [] },
];

// ── sanitizeTemplates ────────────────────────────────────────────────────────

test("round-trip: a valid library sanitizes unchanged (deep-equal)", () => {
  const saved = lib();
  assert.deepEqual(sanitizeTemplates(JSON.parse(JSON.stringify(saved))), saved);
});

test("non-array records sanitize to []", () => {
  for (const raw of [undefined, null, 42, "CPT-1", {}, { finish_tag: "CPT-1" }]) {
    assert.deepEqual(sanitizeTemplates(raw), [], String(raw));
  }
});

test("malformed items are dropped: plain object with a non-empty string finish_tag", () => {
  const raw = [
    ...lib(),
    null,                                  // not an object
    "CPT-2",                               // primitive
    7,                                     // primitive
    ["CPT-3"],                             // array is not a template
    { color: "#000", materials: [] },      // missing finish_tag
    { finish_tag: 9, materials: [] },      // non-string finish_tag
    { finish_tag: "", materials: [] },     // empty finish_tag
    { finish_tag: "   ", materials: [] },  // whitespace-only finish_tag
  ];
  assert.deepEqual(sanitizeTemplates(raw), lib());
});

test("materials: non-array becomes [], non-object entries are dropped", () => {
  const [a] = sanitizeTemplates([{ finish_tag: "A", materials: "glue" }]);
  assert.deepEqual(a.materials, []);
  const [b] = sanitizeTemplates([{ finish_tag: "B" }]);   // absent → []
  assert.deepEqual(b.materials, []);
  const mat = { name: "Adhesive", per: 250, basis: "area", unit: "gal" };
  const [c] = sanitizeTemplates([{ finish_tag: "C", materials: [mat, null, "Grout", 3, ["Thinset"]] }]);
  assert.deepEqual(c.materials, [mat]);
});

test("color/fill/hatch: non-string values are removed so the canvas defaults; strings pass", () => {
  const [t] = sanitizeTemplates([{ finish_tag: "A", color: 7, fill: null, hatch: { x: 1 }, materials: [] }]);
  assert.deepEqual(t, { finish_tag: "A", materials: [] });
  const [u] = sanitizeTemplates([{ finish_tag: "B", color: "#000", fill: "", hatch: "plank", materials: [] }]);
  assert.deepEqual(u, { finish_tag: "B", color: "#000", fill: "", hatch: "plank", materials: [] });
});

test("unknown item fields survive the round-trip (scale_source precedent)", () => {
  const saved = [{ finish_tag: "A", waste_pct: 8, future_field: { v: 1 }, materials: [{ name: "X", future_mat: true }] }];
  assert.deepEqual(sanitizeTemplates(JSON.parse(JSON.stringify(saved))), saved);
});

// ── store.loadTemplates wiring ───────────────────────────────────────────────

test("loadTemplates routes the stored record through the sanitizer", async () => {
  // saveTemplates stores wholesale; the corrupt items must be gone on load
  await store.saveTemplates([...lib(), null, { color: "#000" }, { finish_tag: "BAD", materials: "glue" }]);
  assert.deepEqual(await store.loadTemplates(), [...lib(), { finish_tag: "BAD", materials: [] }]);
});

test("loadTemplates returns [] for a missing or non-array record", async () => {
  assert.deepEqual(await store.loadTemplates(), []);
  await store.saveTemplates("not-a-list" as any);   // saveTemplates already guards
  assert.deepEqual(await store.loadTemplates(), []);
});

test("instantiateTemplate deep-copies tile_setup (no shared reference)", () => {
  const cond = { finish_tag: "CT-1", color: "#9333ea", waste_pct: 10, materials: [],
    tile_setup: { pattern: "grid", origin: [0, 0], rotation_deg: 0, edge_strategy: "balanced",
      skus: [{ id: "sku1", name: "T", w_in: 12, h_in: 24, color: "#9333ea" }],
      joint: { width_in: 0.125 } } };
  const tpl = instantiateTemplate(cond);             // canvasUtil.js's condition-template constructor (roll_setup precedent at line ~66)
  assert.deepEqual(tpl.tile_setup, cond.tile_setup);
  tpl.tile_setup.joint.width_in = 0.25;              // mutate the copy
  assert.equal(cond.tile_setup.joint.width_in, 0.125); // original untouched
});

// P1 regression: condToTemplate (the WRITE side — save-active-as-template /
// library save) used to omit tile_setup entirely while instantiateTemplate
// (the READ side, above) already copied it — Library Apply and fresh-
// workspace seeding silently dropped tile patterning on every reload.
test("condToTemplate copies tile_setup (deep, no shared reference)", () => {
  const cond = { finish_tag: "CT-1", color: "#9333ea", fill: "#9333ea", hatch: "solid", waste_pct: 10, materials: [],
    tile_setup: { pattern: "grid", origin: [0, 0], rotation_deg: 0, edge_strategy: "balanced",
      skus: [{ id: "sku1", name: "T", w_in: 12, h_in: 24, color: "#9333ea" }],
      joint: { width_in: 0.125 } } };
  const tpl = condToTemplate(cond);
  assert.deepEqual(tpl.tile_setup, cond.tile_setup);
  tpl.tile_setup.joint.width_in = 0.25;               // mutate the copy
  assert.equal(cond.tile_setup.joint.width_in, 0.125); // original untouched
});

test("condToTemplate -> instantiateTemplate round-trip preserves tile_setup", () => {
  const cond = { finish_tag: "CT-1", color: "#9333ea", fill: "#9333ea", hatch: "solid", waste_pct: 10, materials: [],
    tile_setup: { pattern: "herringbone", origin: [0, 0], rotation_deg: 45, edge_strategy: "balanced",
      skus: [{ id: "sku1", name: "T", w_in: 12, h_in: 24, color: "#9333ea" }],
      joint: { width_in: 0.125 } } };
  const tpl = condToTemplate(cond);
  const inst = instantiateTemplate(tpl);
  assert.deepEqual(inst.tile_setup, cond.tile_setup);
  inst.tile_setup.joint.width_in = 0.5;
  assert.equal(cond.tile_setup.joint.width_in, 0.125);
  assert.equal(tpl.tile_setup.joint.width_in, 0.125);
});

test("condToTemplate copies roll_setup (no shared reference)", () => {
  const cond = { finish_tag: "CPT-1", color: "#2f7d54", fill: "#2f7d54", hatch: "solid", waste_pct: 5, materials: [],
    roll_setup: { width_ft: 12, direction_deg: 0 } };
  const tpl = condToTemplate(cond);
  assert.deepEqual(tpl.roll_setup, cond.roll_setup);
  tpl.roll_setup.width_ft = 15;
  assert.equal(cond.roll_setup.width_ft, 12);
});
