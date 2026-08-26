// web/test/scene3d.test.ts — header mirrors web/test/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScene, toWorldFt, ringCCW, worldWindingCCW, buildRibbon, nudgePath,
  NOMINAL_THICKNESS_FT, NOMINAL_HEIGHT_FT, EXCLUDED_COLOR, MITER_LIMIT, RIBBON_HALF_FT,
} from "../src/lib/scene3d.js";
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";
import { seedConditions } from "../src/lib/canvasUtil.js";
import { conditionFromPlay } from "../src/lib/plays.js";

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

test("reconciled deduct (cuts_shape_id) renders as nothing", () => {
  const { slabs } = buildScene({
    sheet: SHEET, conditions: [COND],
    shapes: [
      { id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
      { id: "s2", sheet_id: "a", condition_id: "c1", measure_role: "deduct", cuts_shape_id: "s1", verts_norm: SQ_NORM, computed: {} },
    ],
  });
  assert.equal(slabs.length, 1);
});

test("standalone deduct → excluded slab, EXCLUDED_COLOR, same h range, caption note with anchor", () => {
  const { slabs, notes } = buildScene({
    sheet: SHEET, conditions: [{ ...COND, thickness_in: 0.5 }],
    shapes: [{ id: "s2", sheet_id: "a", condition_id: "c1", measure_role: "deduct", verts_norm: SQ_NORM, computed: {} }],
  });
  const ex = slabs.find((s) => s.kind === "excluded")!;
  assert.equal(ex.color, EXCLUDED_COLOR);
  assert.ok(Math.abs(ex.z1 - 0.5 / 12) < 1e-12);
  const cap = notes.find((n) => n.kind === "excluded")!;
  assert.equal(cap.text, "excluded area — see plan");
  assert.ok(Array.isArray(cap.at)); // world anchor for the in-scene sprite
});

test("surface_area ribbon uses shape-snapshotted height; derived flag independent", () => {
  const { ribbons } = buildScene({
    sheet: SHEET, conditions: [{ ...COND, height_ft: 9 }],
    shapes: [{ id: "s3", sheet_id: "a", condition_id: "c1", measure_role: "surface_area", verts_norm: [[0, 0], [0.1, 0]], height_ft: 4, computed: {} }],
  });
  assert.equal(ribbons[0].z1, 4);
  assert.equal(ribbons[0].derived, false);
});

test("linear vertical: shape > condition > nominal cascade; override wins; unset note", () => {
  const base = { sheet: SHEET, conditions: [{ id: "c1", finish_tag: "RB-1", color: "#475569", extrude_h_ft: 1 / 3, extrude_mode: "vertical" }] };
  const mk = (o: object = {}) => ({ id: "s4", sheet_id: "a", condition_id: "c1", measure_role: "linear", verts_norm: [[0, 0], [0.1, 0]], computed: {}, ...o });
  assert.ok(Math.abs(buildScene({ ...base, shapes: [mk()] }).ribbons[0].z1 - 1 / 3) < 1e-12);
  assert.equal(buildScene({ ...base, shapes: [mk({ extrude_h_ft: 0.5, extrude_override: true })] }).ribbons[0].z1, 0.5);
  const unset = buildScene({ ...base, conditions: [{ id: "c1", finish_tag: "RB-1", color: "#475569" }], shapes: [mk()] });
  assert.equal(unset.ribbons[0].z1, NOMINAL_HEIGHT_FT);
  assert.equal(unset.ribbons[0].translucent, true);
  assert.ok(unset.notes.some((n) => n.kind === "unset-height" && n.tag === "RB-1"));
});

test("derived base ring: interior INSET (geometry, not a label) + derived flag + openings note (once)", () => {
  const shapes = [
    { id: "f1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
    { id: "b1", sheet_id: "a", condition_id: "c1", measure_role: "linear", verts_norm: SQ_NORM, computed: {},
      origin: { derived: { from_shape_id: "f1", gross_lf: 20, openings_lf: 3 } } },
  ];
  const { ribbons, notes } = buildScene({ sheet: SHEET, conditions: [{ ...COND, extrude_h_ft: 1 / 3 }], shapes });
  const b = ribbons.find((r) => r.shapeId === "b1")!;
  assert.equal(b.side, "interior");
  assert.equal(b.derived, true);
  // the inset moved EVERY vertex off the raw boundary, toward the room
  const raw = toWorldFt(SQ_NORM, SHEET);
  for (let i = 0; i < 4; i++) {
    const moved = Math.hypot(b.path_ft[i][0] - raw[i][0], b.path_ft[i][1] - raw[i][1]);
    assert.ok(moved > RIBBON_HALF_FT * 0.5, `vertex ${i} inset by ≥ half the half-width`);
  }
  const op = notes.filter((n) => n.kind === "openings");
  assert.equal(op.length, 1);
  assert.match(op[0].text, /openings/i);
});

test("xn note fires for EVERY role, hoisted above the role dispatch", () => {
  for (const role of ["floor_area", "deduct", "surface_area", "linear", "count"]) {
    const verts = role === "count" ? [[0.25, 0.25]] : role === "floor_area" || role === "deduct" ? SQ_NORM : [[0, 0], [0.1, 0]];
    const { notes } = buildScene({
      sheet: SHEET, conditions: [{ ...COND, multiplier: 3 }],
      shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: role, verts_norm: verts, computed: {} }],
    });
    assert.ok(notes.some((n) => n.kind === "xn" && n.tag === "CPT-1"), `${role} emits xn`);
  }
});

test("linear flush: z0 = higher adjoining slab top via between_shape_ids; hand-traced → nominal + note", () => {
  const conds = [
    { id: "cA", finish_tag: "CPT-1", color: "#2f7d54", thickness_in: 0.125 },
    { id: "cB", finish_tag: "LVT-1", color: "#b8860b", thickness_in: 0.5 },
    { id: "cT", finish_tag: "TR-1", color: "#c96442", thickness_in: 0.25, extrude_mode: "flush" },
  ];
  const tShape = {
    id: "t1", sheet_id: "a", condition_id: "cT", measure_role: "linear", verts_norm: [[0, 0], [0.1, 0]], computed: {},
    origin: { derived: { between_shape_ids: ["fA", "fB"], between: ["CPT-1", "LVT-1"], case: "butt", gap_in: 0 } },
  };
  const floors = [
    { id: "fA", sheet_id: "a", condition_id: "cA", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
    { id: "fB", sheet_id: "a", condition_id: "cB", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
  ];
  const r = buildScene({ sheet: SHEET, conditions: conds, shapes: [...floors, tShape] }).ribbons.find((x) => x.tag === "TR-1")!;
  assert.ok(Math.abs(r.z0 - 0.5 / 12) < 1e-12); // the higher side (LVT ½")
  assert.ok(Math.abs(r.z1 - 0.75 / 12) < 1e-12);
  const hand = buildScene({ sheet: SHEET, conditions: conds, shapes: [{ ...tShape, id: "t2", origin: undefined }] });
  assert.ok(hand.notes.some((n) => n.kind === "nominal-thickness" && n.tag === "TR-1"));
});

test("count → post at exact point; override wins", () => {
  const { posts } = buildScene({
    sheet: SHEET, conditions: [{ id: "cG", finish_tag: "CG-1", color: "#0ea5e9", extrude_h_ft: 4 }],
    shapes: [{ id: "s5", sheet_id: "a", condition_id: "cG", measure_role: "count", verts_norm: [[0.25, 0.25]], computed: { count: 1 } }],
  });
  assert.deepEqual(posts[0].pt_ft, [12.5, -25]);
  assert.equal(posts[0].z1, 4);
});

// ── ribbon construction ────────────────────────────────────────────────
test("miter clamp: near-reversal joint bevels — all vertices within bbox + MITER_LIMIT×halfWidth", () => {
  const path: [number, number][] = [[0, 0], [10, 0], [0.2, 0.05]]; // near-180° reversal at (10,0)
  const r = buildRibbon(path, 0.05);
  const TOL = MITER_LIMIT * 0.05 + 1e-6;
  const xs = r.positions.filter((_, i) => i % 2 === 0);
  const ys = r.positions.filter((_, i) => i % 2 === 1);
  assert.ok(r.positions.length >= 24, "two segments → two quads (12 floats each)");
  assert.ok(Math.max(...xs) <= 10 + TOL && Math.min(...xs) >= 0 - TOL, "no miter spike");
  assert.ok(Math.max(...ys) <= 0.05 + TOL && Math.min(...ys) >= 0 - TOL, "no miter spike (y)");
});

test("nudgePath displaces EVERY vertex, including the last (2-point run)", () => {
  assert.deepEqual(nudgePath([[0, 0], [5, 0]], 0.02), [[0, 0.02], [5, 0.02]]);
});

test("coincident wall ribbons separate: surface trace vs hand-traced base differ at every index", () => {
  const conds = [
    { id: "cW", finish_tag: "WT-1", color: "#2563eb", height_ft: 4 },
    { id: "cB", finish_tag: "RB-1", color: "#475569", extrude_h_ft: 1 / 3 },
  ];
  const wall: [number, number][] = [[0, 0], [0.1, 0]];
  const { ribbons } = buildScene({
    sheet: SHEET, conditions: conds,
    shapes: [
      { id: "w1", sheet_id: "a", condition_id: "cW", measure_role: "surface_area", verts_norm: wall, height_ft: 4, computed: {} },
      { id: "b2", sheet_id: "a", condition_id: "cB", measure_role: "linear", verts_norm: wall, computed: {} },
    ],
  });
  const w = ribbons.find((r) => r.shapeId === "w1")!;
  const b = ribbons.find((r) => r.shapeId === "b2")!;
  for (let i = 0; i < 2; i++) {
    assert.ok(w.path_ft[i][0] !== b.path_ft[i][0] || w.path_ft[i][1] !== b.path_ft[i][1], `index ${i} separated`);
  }
});

test("degenerate points filtered: duplicates and zero-length segments produce finite vertices only", () => {
  const r = buildRibbon([[0, 0], [0, 0], [5, 0], [5, 0]], 0.05);
  assert.ok(r.positions.every((v) => Number.isFinite(v)));
  assert.ok(r.positions.length >= 12, "one real segment → one quad");
});

test("seeds carry extrude doctrine (RB-1 vertical 4in, TR-1 flush, CG-1 4ft)", () => {
  const byTag: Record<string, any> = Object.fromEntries(FLOORING_DEFAULTS.map((t) => [t.finish_tag, t]));
  assert.equal(byTag["RB-1"].extrude_mode, "vertical");
  assert.ok(Math.abs(byTag["RB-1"].extrude_h_ft - 1 / 3) < 1e-12);
  assert.equal(byTag["TR-1"].extrude_mode, "flush");
  assert.equal(byTag["CG-1"].extrude_h_ft, 4);
});

test("seedConditions passes the new fields through instantiateTemplate", () => {
  const conds: { finish_tag: string; extrude_mode?: string; extrude_h_ft?: number }[] = seedConditions(null);
  const rb = conds.find((c) => c.finish_tag === "RB-1")!;
  assert.equal(rb.extrude_mode, "vertical");
  assert.ok(Math.abs(Number(rb.extrude_h_ft) - 1 / 3) < 1e-12);
});

test("a saved Play round-trips the extrude fields through COND_KEEP", () => {
  const cond = conditionFromPlay(
    { finish_tag: "RB-1", color: "#475569", extrude_mode: "vertical", extrude_h_ft: 1 / 3 },
    "RB-1", () => "cX", () => "mX",
  );
  assert.equal(cond.extrude_mode, "vertical");
  assert.ok(Math.abs(cond.extrude_h_ft - 1 / 3) < 1e-12);
});
