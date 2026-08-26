// web/test/scene3d.test.ts — header mirrors web/test/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScene, toWorldFt, ringCCW, worldWindingCCW, buildRibbon, nudgePath,
  NOMINAL_THICKNESS_FT, NOMINAL_HEIGHT_FT, EXCLUDED_COLOR, MITER_LIMIT, RIBBON_HALF_FT,
} from "../src/lib/scene3d.js";

const SHEET = { widthPx: 1000, heightPx: 2000, upp: 0.05 };
const COND = { id: "c1", finish_tag: "CPT-1", color: "#2f7d54" };
// positive-shoelace ring in image space (y down); the y-flip inverts it
const SQ_NORM: [number, number][] = [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]];

test("toWorldFt: feet scale, y flipped", () => {
  const w = toWorldFt(SQ_NORM, SHEET);
  assert.deepEqual(w, [[0, 0], [5, 0], [5, -5], [0, -5]]);
});

test("winding: y-flip inverts orientation; ringCCW restores CCW-in-world", () => {
  const w = toWorldFt(SQ_NORM, SHEET);
  assert.equal(worldWindingCCW(w), false);            // reflection flipped it
  assert.equal(worldWindingCCW(ringCCW(w)), true);    // builder's import fix
});

test("floor_area → slab z [0, nominal] when thickness unset, + note", () => {
  const { slabs, notes } = buildScene({
    sheet: SHEET, conditions: [COND],
    shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: { area_sf: 500 } }],
  });
  assert.equal(slabs.length, 1);
  assert.equal(slabs[0].kind, "floor");
  assert.ok(Math.abs(slabs[0].z1 - 1 / 24) < 1e-12);
  assert.equal(slabs[0].color, COND.color);
  assert.equal(worldWindingCCW(slabs[0].verts_ft), true);
  assert.ok(notes.some((n) => n.kind === "nominal-thickness" && n.tag === "CPT-1"));
});

test("floor_area slab uses thickness_in/12 when set; no note", () => {
  const { slabs, notes } = buildScene({
    sheet: SHEET, conditions: [{ ...COND, thickness_in: 0.25 }],
    shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} }],
  });
  assert.ok(Math.abs(slabs[0].z1 - 0.25 / 12) < 1e-12);
  assert.ok(!notes.some((n) => n.kind === "nominal-thickness"));
});

test("holes carried as holes_ft, wound opposite to outer", () => {
  const hole: [number, number][] = [[0.01, 0.01], [0.02, 0.01], [0.02, 0.02], [0.01, 0.02]];
  const { slabs } = buildScene({
    sheet: SHEET, conditions: [COND],
    shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, verts_norm_holes: [hole], computed: {} }],
  });
  assert.equal(slabs[0].holes_ft.length, 1);
  assert.equal(worldWindingCCW(slabs[0].holes_ft[0]), false); // CW in world
});

test("unscaled sheet throws the scale-gate refusal", () => {
  assert.throws(() => buildScene({ sheet: { ...SHEET, upp: null }, conditions: [COND], shapes: [] }), /scale/i);
});
