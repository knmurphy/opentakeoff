// web/test/scene3d.test.ts — header mirrors web/test/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScene, toWorldFt, planPlane, ringCCW, worldWindingCCW, buildRibbon, nudgePath, rollsToWorld,
  NOMINAL_THICKNESS_FT, NOMINAL_HEIGHT_FT, EXCLUDED_COLOR, MITER_LIMIT, RIBBON_HALF_FT,
  uvPlanar, gridLines, buildShapeRanges, resolveShapeAt, assertNonIndexed, GRID_MARGIN_FT,
} from "../src/lib/scene3d.js";
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";
import { seedConditions } from "../src/lib/canvasUtil.js";
import { conditionFromPlay } from "../src/lib/plays.js";
import { isolate3D } from "../src/lib/scene3dScope.js";

const SHEET = { widthPx: 1000, heightPx: 2000, upp: 0.05 };
const COND = { id: "c1", finish_tag: "CPT-1", color: "#2f7d54" };
// positive-shoelace ring in image space (y down); the y-flip inverts it
const SQ_NORM: [number, number][] = [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]];

test("toWorldFt: feet scale, y flipped", () => {
  const w = toWorldFt(SQ_NORM, SHEET);
  assert.deepEqual(w, [[0, 0], [5, 0], [5, -5], [0, -5]]);
});

test("planPlane: half-extents and centers from sheet px/upp", () => {
  assert.deepEqual(planPlane(SHEET), { wFt: 50, hFt: 100, cx: 25, cw: -50 });
});

test("planPlane: unscaled sheet throws the scale-gate refusal", () => {
  assert.throws(() => planPlane({ ...SHEET, upp: null }), /scale/i);
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

// ── buildScene rolls contract (spec addendum r3 rev 3) ──────────────────────
// scene3d only maps sheet-feet polys → world here — [x, −y], no scaling, fold
// −0 to +0 — the parity/clip/z-join logic lives upstream in rollTakeoff.js.

test("buildScene: rolls omitted → {bands:[],seams:[]}, never a TypeError on built.rolls", () => {
  const { rolls } = buildScene({ sheet: SHEET, conditions: [COND], shapes: [] });
  assert.deepEqual(rolls, { bands: [], seams: [] });
});

test("buildScene/rollsToWorld: sheet-feet → world is [x, −y] only — no upp scaling, unlike toWorldFt", () => {
  const rolls = {
    bands: [{ poly: [{ x: 2, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 7 }], z: 0.1, fill: "#c9a876", tag: "CPT-1", shapeId: "r1", condId: "c1", laneIndex: 1 }],
    seams: [{ poly: [{ x: 2, y: 0.5 }, { x: 2, y: 4 }], z: 0.1, tag: "CPT-1", shapeId: "r1", condId: "c1" }],
  };
  const { rolls: out } = buildScene({ sheet: SHEET, conditions: [COND], shapes: [], rolls });
  // upp=0.05 here: a scaling bug (e.g. reusing toWorldFt on feet) would shrink
  // these to fractions of a foot — asserting the RAW feet values catches it.
  assert.deepEqual(out.bands[0].poly, [[2, -3], [5, -3], [5, -7]]);
  assert.deepEqual(out.seams[0].poly, [[2, -0.5], [2, -4]]);
  assert.deepEqual(
    { fill: out.bands[0].fill, tag: out.bands[0].tag, shapeId: out.bands[0].shapeId, condId: out.bands[0].condId, laneIndex: out.bands[0].laneIndex, z: out.bands[0].z },
    { fill: "#c9a876", tag: "CPT-1", shapeId: "r1", condId: "c1", laneIndex: 1, z: 0.1 },
    "every non-geometric field passes through unchanged",
  );
});

test("buildScene/rollsToWorld: −0 folds to +0, like toWorldFt", () => {
  const rolls = { bands: [], seams: [{ poly: [{ x: 1, y: 0 }], z: 0, tag: "t", shapeId: "s", condId: "c" }] };
  const { rolls: out } = buildScene({ sheet: SHEET, conditions: [COND], shapes: [], rolls });
  assert.ok(Object.is(out.seams[0].poly[0][1], 0), "not -0");
});

test("rollsToWorld: bare function mirrors buildScene's mapping and tolerates a missing bands/seams array", () => {
  assert.deepEqual(rollsToWorld({ bands: [{ poly: [{ x: 1, y: 2 }] }] }), { bands: [{ poly: [[1, -2]] }], seams: [] });
  assert.deepEqual(rollsToWorld(undefined), { bands: [], seams: [] });
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

test("isolate3D: selected floor + derived base + label-equal siblings; unlinked stay; others dropped", () => {
  const shapes = [
    { id: "f1", sheet_id: "a", label: "112", measure_role: "floor_area", verts_norm: [], computed: {} },
    { id: "b1", sheet_id: "a", label: "112", measure_role: "linear", verts_norm: [], computed: {}, origin: { derived: { from_shape_id: "f1" } } },
    { id: "f2", sheet_id: "a", label: "114", measure_role: "floor_area", verts_norm: [], computed: {} },
    { id: "w1", sheet_id: "a", measure_role: "surface_area", verts_norm: [], computed: {} }, // hand-traced, no link
  ];
  const vis = isolate3D("f1", shapes as any);
  assert.equal(vis!.has("f1"), true);
  assert.equal(vis!.has("b1"), true);
  assert.equal(vis!.has("w1"), true);  // unlinked stays visible (spec)
  assert.equal(vis!.has("f2"), false); // linked to another room → dropped
  assert.equal(isolate3D(null, shapes as any), null);
});

// ── uvPlanar (spec addendum r4 rev 3, part B) ───────────────────────────────

test("uvPlanar: period 1 is identity — world feet in, unscaled", () => {
  assert.deepEqual(uvPlanar([[3, 6], [-2, 0.5]], 1), [[3, 6], [-2, 0.5]]);
});

test("uvPlanar: period scales uv by 1/period, no negation, per geometry vertex", () => {
  assert.deepEqual(uvPlanar([[3, 6], [9, -12]], 3), [[1, 2], [3, -4]]);
});

// ── gridLines (spec addendum r4 rev 3, part C) ──────────────────────────────

test("gridLines: 1 ft minor spacing fills the padded extent on both axes", () => {
  const g = gridLines({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 });
  // extent = [-10, 15] on each axis inclusive of both ends → 26 integer lines
  // per axis (minor + major + the one axis line), 52 total line segments.
  assert.equal(g.positions.length / 6, 52);
  assert.equal(g.colors.length, g.positions.length);
});

test("gridLines: extent = bounds padded by GRID_MARGIN_FT on every side", () => {
  const g = gridLines({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 });
  const xStarts = [];
  for (let i = 0; i < g.positions.length; i += 6) xStarts.push(g.positions[i]);
  assert.ok(xStarts.includes(-GRID_MARGIN_FT));
  assert.ok(xStarts.includes(5 + GRID_MARGIN_FT));
  assert.ok(!xStarts.includes(-GRID_MARGIN_FT - 1));
});

test("gridLines: 10 ft major lines differ from 1 ft minor lines; every 10 ft multiple matches", () => {
  const g = gridLines({ minX: 0, maxX: 20, minZ: 0, maxZ: 0 });
  const colorOfXLine = (x: number) => {
    for (let i = 0; i < g.positions.length; i += 6) {
      if (g.positions[i] === x && g.positions[i + 2] === -GRID_MARGIN_FT) return g.colors.slice(i, i + 3);
    }
    return null;
  };
  const minor = colorOfXLine(1);
  const major = colorOfXLine(10);
  assert.notDeepEqual(minor, major);
  assert.deepEqual(colorOfXLine(20), major); // 20 is also a 10 ft multiple
  assert.deepEqual(colorOfXLine(-10), major); // negative multiples count too
});

test("gridLines: axis entries present — sheet X (world z=0) cobalt, sheet Y (world x=0) slate, distinct from grid + each other", () => {
  const g = gridLines({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 });
  const colorOfFirstPoint = (x1: number, z1: number) => {
    for (let i = 0; i < g.positions.length; i += 6) {
      if (g.positions[i] === x1 && g.positions[i + 1] === 0 && g.positions[i + 2] === z1) return g.colors.slice(i, i + 3);
    }
    return null;
  };
  const yAxis = colorOfFirstPoint(0, -13);  // x=0 line, starts at exMinZ
  const xAxis = colorOfFirstPoint(-13, 0);  // z=0 line, starts at exMinX
  const grid = colorOfFirstPoint(1, -13);   // an ordinary minor line
  assert.ok(yAxis && xAxis && grid);
  assert.notDeepEqual(yAxis, xAxis);
  assert.notDeepEqual(yAxis, grid);
  assert.notDeepEqual(xAxis, grid);
});

test("gridLines: isDark selects the dark theme color pair (theme decided at render/call time)", () => {
  const light = gridLines({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  const dark = gridLines({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, true);
  assert.deepEqual(light.positions, dark.positions);
  assert.notDeepEqual(light.colors, dark.colors);
});

// ── buildShapeRanges / resolveShapeAt (spec addendum r4 rev 3, part A) ──────

const geo = (count: number) => ({ attributes: { position: { count } } }); // non-indexed: no .index

test("buildShapeRanges: merge-order accumulation; counts sum to the vertex total", () => {
  const items = [
    { shapeId: "a", geometry: geo(9) },
    { shapeId: "b", geometry: geo(6) },
    { shapeId: "c", geometry: geo(3) },
  ];
  const ranges = buildShapeRanges(items);
  assert.deepEqual(ranges, [
    { shapeId: "a", start: 0, count: 9 },
    { shapeId: "b", start: 9, count: 6 },
    { shapeId: "c", start: 15, count: 3 },
  ]);
  assert.equal(ranges.reduce((s, r) => s + r.count, 0), 18);
});

test("buildShapeRanges: !geometry.index assert fires at RECORD time", () => {
  assert.throws(
    () => buildShapeRanges([{ shapeId: "a", geometry: { index: {}, attributes: { position: { count: 3 } } } }]),
    /indexed/i,
  );
});

test("assertNonIndexed: the same guard fires at RESOLVE time (the View3D raycast call site)", () => {
  assert.doesNotThrow(() => assertNonIndexed(geo(3)));
  assert.throws(() => assertNonIndexed({ index: {} }), /indexed/i);
});

test("resolveShapeAt: first/middle/last face resolve to the owning shapeId", () => {
  const ranges = buildShapeRanges([
    { shapeId: "a", geometry: geo(9) }, // faces 0,1,2 → ordinals 0,3,6
    { shapeId: "b", geometry: geo(6) }, // faces 3,4 → ordinals 9,12
    { shapeId: "c", geometry: geo(3) }, // face 5 → ordinal 15
  ]);
  assert.equal(resolveShapeAt(ranges, 0), "a"); // first face overall
  assert.equal(resolveShapeAt(ranges, 2), "a"); // last face of the first shape
  assert.equal(resolveShapeAt(ranges, 3), "b"); // first face of the middle shape
  assert.equal(resolveShapeAt(ranges, 4), "b"); // last face of the middle shape
  assert.equal(resolveShapeAt(ranges, 5), "c"); // last face overall
});

test("resolveShapeAt: boundary ordinal resolves to the range it starts, not the one before", () => {
  const ranges = buildShapeRanges([
    { shapeId: "a", geometry: geo(9) },
    { shapeId: "b", geometry: geo(6) },
  ]);
  assert.equal(resolveShapeAt(ranges, 2), "a"); // ordinal 6, last face still inside a
  assert.equal(resolveShapeAt(ranges, 3), "b"); // ordinal 9 === b.start exactly
});

test("resolveShapeAt: out-of-range faceIndex → null, a guaranteed miss not a wrong hit", () => {
  const ranges = buildShapeRanges([{ shapeId: "a", geometry: geo(9) }]);
  assert.equal(resolveShapeAt(ranges, 3), null); // ordinal 9, past the only range
  assert.equal(resolveShapeAt(ranges, -1), null);
});
