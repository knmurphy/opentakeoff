# 3D Takeoff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An on-demand, per-sheet 3D view that extrudes the estimator's committed 2D takeoff shapes (floors, wall base, wall protection, corner guards, transitions) using condition heights/thicknesses and per-shape height overrides.

**Architecture:** Three layers — a pure scene builder (`web/src/lib/scene3d.js`, no three import, node:test-able), a lazy-loaded three.js renderer overlay (`web/src/components/View3D.jsx`, `React.lazy` chunk), and a trigger-only integration in `TakeoffCanvas.jsx`. Two new display-only condition fields (`extrude_h_ft`, `extrude_mode`) plus per-shape `extrude_h_ft`/`extrude_override` snapshots mirroring the existing `height_ft`/`height_override` mechanism.

**Tech Stack:** React 18 + Vite, three.js (new dep, lazy chunk), node:test. `scene3d.js` is plain JS like `geometry.js`; tests in `web/test/*.test.ts` under tsx.

**Spec:** `docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md` — the plan argues from the spec; read both. Every doctrine row, renderer-contract bullet, and pinned citation below traces to it.

## Global Constraints

- Never commit on `main`; work on `feat/3d-takeoff-view` (create fresh from latest `main` or from `feat/3d-takeoff-view-spec`).
- **Test runner:** `web/package.json` is `"test": "node --import tsx --test test/*.test.ts"` — the glob is baked in, so `npm test -- <file>` runs the WHOLE suite plus your file, and node's runner **silently ignores** a nonexistent path (no "module not found"). The single-file inner loop in this repo is:
  `cd web && node --import tsx --test test/scene3d.test.ts`
  Red signal: once the test file exists, it errors with `Cannot find module '../src/lib/scene3d.js'`. Final gate is `npm run check` (typecheck + lint + test + build — exactly CI).
- Do not overload `height_ft` — it stays the surface-area H knob only (`TakeoffsPanel.jsx:473` copy is pinned).
- `extrude_h_ft`/`extrude_mode`/`extrude_override` are display-only: never feed totals, report, or materials quantities; never call `recomputeShape` for them.
- Waste never appears in 3D; ×N never duplicates geometry (builder emits an `xn` note instead).
- Never cross-sheet: the scene is built from ONE sheet's shapes (match-line doctrine).
- Unscaled sheet (`upp == null`) → refuse with the existing scale-gate message.
- No MCP surface, no `mcp/` changes, no version bumps.
- Colors for three materials come from condition hex colors; overlay chrome uses `tokens.css` vars.
- Import three addons per-file: `three/examples/jsm/controls/OrbitControls.js`, `three/examples/jsm/utils/BufferGeometryUtils.js` — never the barrel.
- Axis contract, stated once: scene3d emits world tuples `[x, up, w]` where `x` = plan x in feet, `up` = height in feet, `w = −(plan y)` in feet. View3D maps them onto three.js as `new THREE.Vector3(x, up, w)` (three Y is height; three Z is the negated plan y). `pt_ft`/`path_ft`/`verts_ft` values are FINAL — no further negation in the renderer.
- Docs sync in the final task: README (Features), `docs/USER_GUIDE.md` (new section + §15 row), `CHANGELOG.md`, `FEATURES.md`.

---

### Task 1: `scene3d.js` — coordinate mapping + slab geometry

**Files:**
- Create: `web/src/lib/scene3d.js`
- Test: `web/test/scene3d.test.ts`

**Interfaces:**
- Consumes: shapes `{id, sheet_id, condition_id, measure_role, verts_norm, verts_norm_holes?, height_ft?, extrude_h_ft?, extrude_override?, label?, origin?}`, conditions `{id, finish_tag, color, thickness_in?, height_ft?, multiplier?, extrude_h_ft?, extrude_mode?}`, `sheet {widthPx, heightPx, upp}`.
- Produces: `buildScene({shapes, conditions, sheet})` → `{slabs, ribbons, posts, notes}`; `toWorldFt`, `ringCCW`, `ringCW`, `worldWindingCCW`, `buildRibbon` exported for tests/renderer; constants `NOMINAL_THICKNESS_FT = 1/24`, `NOMINAL_HEIGHT_FT = 3`, `MITER_LIMIT = 4`, `EXCLUDED_COLOR = "#b03a26"` (ui.js SVG.danger literal), `RIBBON_HALF_FT = 1/24` (vertical), `FLUSH_HALF_FT = 1/12`.

- [ ] **Step 1: Write the failing tests — mapping, winding, floor slabs**

Arithmetic ground truth for the fixture: `SHEET = {widthPx: 1000, heightPx: 2000, upp: 0.05}` → sheet is 50 ft × 100 ft. `SQ_NORM = [[0,0],[0.1,0],[0.1,0.05],[0,0.05]]` → `toWorldFt` = `[[0,0],[5,0],[5,-5],[0,-5]]` (0.1×1000×0.05 = **5**; 0.05×2000×0.05 = 5, negated). The fixture's raw shoelace sum is **positive** (+0.01); the y-flip is a single-axis reflection, which inverts the sign → `worldWindingCCW(toWorldFt(...)) === false`; `ringCCW` reverses and restores `true`.

```ts
// web/test/scene3d.test.ts — header mirrors web/test/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScene, toWorldFt, ringCCW, worldWindingCCW, buildRibbon,
  NOMINAL_THICKNESS_FT, NOMINAL_HEIGHT_FT, EXCLUDED_COLOR, MITER_LIMIT,
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
```

- [ ] **Step 2: Run to verify red** — `cd web && node --import tsx --test test/scene3d.test.ts` → each test fails with `Cannot find module '../src/lib/scene3d.js'` (the file exists; the import target doesn't).
- [ ] **Step 3: Implement mapping + slabs in `web/src/lib/scene3d.js`**

```js
// Pure 3D scene builder — no three import, node:test-able. Doctrine:
// docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md.
// World mapping (pinned): [x_ft, height_up, −y_ft]. Image y grows DOWN; the
// single-axis flip inverts winding, so closed rings are normalized on import
// (ringCCW outer / ringCW holes). The renderer draws DoubleSide as insurance.

export const NOMINAL_THICKNESS_FT = 1 / 24; // floor slab visual thickness — display constant, not user data
export const NOMINAL_HEIGHT_FT = 3;         // unset post/ribbon HEIGHT nominal (tall dimension; never borrow the thickness nominal)
export const EXCLUDED_COLOR = "#b03a26";    // ui.js SVG.danger literal
export const MITER_LIMIT = 4;               // miter offset × ribbon half-width before bevel fallback
export const RIBBON_HALF_FT = 1 / 24;       // vertical ribbon half-width
export const FLUSH_HALF_FT = 1 / 12;        // flush strip half-width

export function toWorldFt(verts_norm, sheet) {
  // `|| 0` folds IEEE-754 −0 to +0 — ny === 0 otherwise yields −0, which
  // assert/strict deepEqual (SameValue) distinguishes from 0 and fails tests.
  return verts_norm.map(([nx, ny]) => [nx * sheet.widthPx * sheet.upp, -(ny * sheet.heightPx * sheet.upp) || 0]);
}

export function worldWindingCCW(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a > 0;
}

export const ringCCW = (ring) => (worldWindingCCW(ring) ? ring : [...ring].reverse());
export const ringCW = (ring) => (worldWindingCCW(ring) ? [...ring].reverse() : ring);

export function buildScene({ shapes, conditions, sheet }) {
  if (!(sheet.upp > 0)) throw new Error("Set the sheet scale first — 3D is feet-true or nothing.");
  const condById = new Map(conditions.map((c) => [c.id, c]));
  const slabs = [], ribbons = [], posts = [], notes = [];
  const noted = new Set(); // one note per (kind, tag)
  const note = (kind, tag, text, extra = {}) => {
    const key = `${kind}:${tag}`;
    if (noted.has(key)) return;
    noted.add(key);
    notes.push({ kind, tag, text, ...extra });
  };

  for (const s of shapes) {
    const c = condById.get(s.condition_id);
    if (!c) continue; // orphan on dead condition — totals' convention
    const condH = Number(c.thickness_in) > 0 ? c.thickness_in / 12 : NOMINAL_THICKNESS_FT;

    if (s.measure_role === "floor_area") {
      slabs.push({
        verts_ft: ringCCW(toWorldFt(s.verts_norm, sheet)),
        holes_ft: (s.verts_norm_holes || []).map((h) => ringCW(toWorldFt(h, sheet))),
        z0: 0, z1: condH, color: c.color, tag: c.finish_tag, kind: "floor", shapeId: s.id,
      });
      if (!(Number(c.thickness_in) > 0)) note("nominal-thickness", c.finish_tag, `${c.finish_tag} has no thickness set — slab shown at nominal visual thickness`);
    }
    // surface_area / linear / count / deduct: Task 2
  }
  return { slabs, ribbons, posts, notes };
}
```

- [ ] **Step 4: Run → green.** `cd web && node --import tsx --test test/scene3d.test.ts`
- [ ] **Step 5: Commit** `git add web/src/lib/scene3d.js web/test/scene3d.test.ts && git commit -m "feat: scene3d pure builder — world mapping, winding, floor slabs"`

---

### Task 2: `scene3d.js` — deducts, ribbons (miter/bevel), posts, notes

**Files:**
- Modify: `web/src/lib/scene3d.js`
- Test: `web/test/scene3d.test.ts` (append)

**Interfaces:**
- Produces: complete `buildScene` for all five roles. Ribbon objects carry `derived: boolean` (from `origin.derived`) and `translucent: boolean` (unset-height) as independent flags. `buildRibbon(pathFt, halfWidth)` → `{positions: number[]}` (x,y pairs, flat; the renderer raises them to `[z0, z1]`), miter-clamped with bevel fallback, degenerates filtered.

- [ ] **Step 1: Write failing tests**

```ts
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
    sheet: SHEET, conditions: [{ id: "cG", finish_tag: "CG-1", color: "#0f766e", extrude_h_ft: 4 }],
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

test("degenerate points filtered: duplicates and zero-length segments produce finite vertices only", () => {
  const r = buildRibbon([[0, 0], [0, 0], [5, 0], [5, 0]], 0.05);
  assert.ok(r.positions.every((v) => Number.isFinite(v)));
  assert.ok(r.positions.length >= 12, "one real segment → one quad");
});
```

- [ ] **Step 2: Run → red** (new tests fail; Task 1's stay green).
- [ ] **Step 3: Implement — full `buildRibbon` + role dispatch**

`buildRibbon`, complete (no helper left undescribed):

```js
// Quad strip along an open path. θ = interior angle at a joint between the
// (prev→vertex) and (vertex→next) rays; miter length = halfWidth / sin(θ/2).
// A near-reversal drives θ→0 and the miter→∞; past MITER_LIMIT × halfWidth the
// joint bevels (each segment keeps its own normal offsets). Near-duplicate
// points collapse and zero-length segments drop BEFORE any normal math.
export function buildRibbon(pathFt, halfWidth) {
  const pts = [];
  for (const p of pathFt) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) pts.push(p);
  }
  const positions = [];
  if (pts.length < 2) return { positions };
  const segU = (i) => {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const off = (p, n) => [p[0] + n[0] * halfWidth, p[1] + n[1] * halfWidth];
  const leftN = (u) => [u[1], -u[0]];
  // Miter point at vertex i for uIn/uOut, or null to bevel. Valid only when
  // BOTH sides stay within the clamp (one-sided spikes are still spikes).
  const miter = (i, uIn, uOut) => {
    const cosT = -(uIn[0] * uOut[0] + uIn[1] * uOut[1]); // cos θ between the two rays
    const sinHalf = Math.sqrt(Math.max(0, (1 - cosT) / 2));
    if (sinHalf < 1e-6) return null;
    const len = halfWidth / sinHalf;
    if (len > MITER_LIMIT * halfWidth) return null;
    const nIn = leftN(uIn), nOut = leftN(uOut);
    let bx = nIn[0] + nOut[0], by = nIn[1] + nOut[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    return [pts[i][0] + bx * len, pts[i][1] + by * len];
  };
  // Per-segment end points (x,y pairs), mitered where the joint allows.
  const endPair = (i, u) => {
    const n = leftN(u);
    return [off(pts[i], n), off(pts[i], [-n[0], -n[1]])]; // [left, right]
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const u = segU(i);
    let aL, aR, bL, bR;
    if (i > 0) {
      const m = miter(i, segU(i - 1), u);
      if (m) { aL = m; aR = [2 * pts[i][0] - m[0], 2 * pts[i][1] - m[1]]; } // mirror through the vertex
      else { [aL, aR] = endPair(i, u); }
    } else { [aL, aR] = endPair(0, u); }
    if (i < pts.length - 2) {
      const m = miter(i + 1, u, segU(i + 1));
      if (m) { bL = m; bR = [2 * pts[i + 1][0] - m[0], 2 * pts[i + 1][1] - m[1]]; }
      else { [bL, bR] = endPair(i + 1, u); }
    } else { [bL, bR] = endPair(i + 1, u); }
    positions.push(aL[0], aL[1], bL[0], bL[1], bR[0], bR[1],
                   aL[0], aL[1], bR[0], bR[1], aR[0], aR[1]); // 2 triangles (DoubleSide covers orientation)
  }
  return { positions };
}
```

Role dispatch (replaces the Task 1 comment line) plus helpers:

```js
    // ×N never duplicates geometry — note per condition, hoisted ABOVE the
    // role dispatch so every role's `continue` still reaches it (cycle-2 bug).
    if ((c.multiplier || 1) > 1) note("xn", c.finish_tag, `${c.finish_tag}: ×${c.multiplier} applies at condition level`);
    if (s.measure_role === "deduct") {
      if (s.cuts_shape_id) continue; // reconciled: hole already baked into the parent
      const vf = ringCCW(toWorldFt(s.verts_norm, sheet));
      slabs.push({ verts_ft: vf, holes_ft: [], z0: 0, z1: condH, color: EXCLUDED_COLOR, tag: c.finish_tag, kind: "excluded", shapeId: s.id });
      note("excluded", c.finish_tag, "excluded area — see plan", { at: centroid2(vf) });
      continue;
    }
    if (s.measure_role === "surface_area") {
      const h = Number(s.height_ft) > 0 ? Number(s.height_ft) : Number(c.height_ft) || 0;
      ribbons.push({ path_ft: nudgePath(toWorldFt(s.verts_norm, sheet), -RIBBON_HALF_FT / 2), z0: 0, z1: h, side: "center",
        color: c.color, tag: c.finish_tag, mode: "vertical", shapeId: s.id,
        derived: false, translucent: !(h > 0) });
      if (!(h > 0)) note("unset-height", c.finish_tag, `${c.finish_tag} has no height set — shown at nominal`);
      continue;
    }
    if (s.measure_role === "linear") {
      const derived = !!s.origin?.derived;
      if (derived && s.origin.derived.from_shape_id) note("openings", c.finish_tag, "Openings are deducted from LF — door gaps are not shown in 3D");
      if ((c.extrude_mode || "vertical") === "flush") {
        const z0 = flushBase(s, shapes, condById, c, note);
        const t = Number(c.thickness_in) > 0 ? c.thickness_in / 12 : NOMINAL_THICKNESS_FT;
        ribbons.push({ path_ft: toWorldFt(s.verts_norm, sheet), z0, z1: z0 + t, side: "center",
          color: c.color, tag: c.finish_tag, mode: "flush", shapeId: s.id, derived, translucent: false });
      } else {
        const h = extrudeHeight(s, c);
        // Interior inset (spec, Web3D B9): derived rings are the floor's own
        // boundary, so offset them INTO the room by the ribbon half-width or
        // they render coincident with the slab edge. Hand-traced runs center
        // on the path, nudged +half/2 so a base and a wainscot sharing one
        // wall line never share literal world coordinates.
        const rawPath = toWorldFt(s.verts_norm, sheet);
        ribbons.push({ path_ft: derived ? insetRing(rawPath, RIBBON_HALF_FT) : nudgePath(rawPath, RIBBON_HALF_FT / 2),
          z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT,
          side: derived ? "interior" : "center",
          color: c.color, tag: c.finish_tag, mode: "vertical", shapeId: s.id,
          derived, translucent: !(h > 0) });
        if (!(h > 0)) note("unset-height", c.finish_tag, `${c.finish_tag} has no installed height set — shown at nominal`);
      }
      continue;
    }
    if (s.measure_role === "count") {
      const h = extrudeHeight(s, c);
      posts.push({ pt_ft: toWorldFt(s.verts_norm, sheet)[0], z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT,
        color: c.color, tag: c.finish_tag, shapeId: s.id, translucent: !(h > 0) });
      if (!(h > 0)) note("unset-height", c.finish_tag, `${c.finish_tag} has no installed height set — shown at nominal`);
    }
```

Helpers (same file):

```js
const extrudeHeight = (s, c) =>
  s.extrude_override === true ? Number(s.extrude_h_ft) || 0
  : Number(s.extrude_h_ft) > 0 ? Number(s.extrude_h_ft)
  : Number(c.extrude_h_ft) > 0 ? Number(c.extrude_h_ft)
  : 0;

// Higher of the two adjoining slab tops for a derived transition; nominal + note otherwise.
function flushBase(s, shapes, condById, c, note) {
  const ids = s.origin?.derived?.between_shape_ids;
  if (Array.isArray(ids)) {
    let top = 0;
    for (const id of ids) {
      const f = shapes.find((x) => x.id === id && x.measure_role === "floor_area");
      const fc = f && condById.get(f.condition_id);
      if (fc && Number(fc.thickness_in) > 0) top = Math.max(top, fc.thickness_in / 12);
    }
    if (top > 0) return top;
  }
  note("nominal-thickness", c.finish_tag, `${c.finish_tag} has no linked floors — strip sits at nominal`);
  return NOMINAL_THICKNESS_FT;
}

export function centroid2(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

// Interior inset for derived base rings: ringCCW-normalized rings are CCW in
// world, so the interior lies LEFT of each directed edge; inward normal =
// rotate the edge direction +90°: n = (−uy, ux). Each vertex moves along the
// bisector of its two adjacent inward edge normals, clamped to the plain edge
// normal when degenerate (reflex corners) — a bounded inset, never a spike.
export function insetRing(ring, dist) {
  const r = ringCCW(ring);
  const n = r.length;
  const inward = (i) => {
    const a = r[i], b = r[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  return r.map((p, i) => {
    const nPrev = inward((i - 1 + n) % n), nNext = inward(i);
    let bx = nPrev[0] + nNext[0], by = nPrev[1] + nNext[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { bx = nNext[0]; by = nNext[1]; } else { bx /= bl; by /= bl; }
    return [p[0] + bx * dist, p[1] + by * dist];
  });
}

// Deterministic lateral nudge so two ribbons sharing one wall line (e.g. a
// hand-traced base + a wainscot trace over the same snapped centerline) never
// occupy identical world coordinates (spec Web3D B9). Offsets every vertex
// along its edge's left normal by delta — sign is the caller's role choice.
export function nudgePath(path, delta) {
  return path.map((p, i) => {
    const b = path[Math.min(i + 1, path.length - 1)];
    const l = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    return [p[0] + (-(b[1] - p[1]) / l) * delta, p[1] + ((b[0] - p[0]) / l) * delta];
  });
}
```

- [ ] **Step 4: Run → green.** Commit: `feat: scene3d — deducts, ribbons (miter/bevel), posts, scene notes`.

---

### Task 3: Condition fields + seeds + persistence pass-through

**Files:**
- Modify: `web/src/lib/canvasConstants.js:119-121` (RB-1/TR-1 entries + new CG-1)
- Modify: `web/src/lib/canvasUtil.js:58-66` (`instantiateTemplate` passthrough — add the two fields beside `height_ft`/`thickness_in`)
- Modify: `web/src/lib/plays.js:7` (`COND_KEEP`) and `:31-33` (restore passthrough)
- Test: `web/test/scene3d.test.ts` (append)

**Interfaces:**
- Produces: RB-1 gains `extrude_mode: "vertical", extrude_h_ft: 1/3`; TR-1 gains `extrude_mode: "flush"`; new seed entry `{ finish_tag: "CG-1", color: "#0f766e", hatch: "vert", waste_pct: 0, materials: [], extrude_h_ft: 4 }` (template shape — no `fill`; color deliberately distinct from ui.js SVG.positive #1f6b4a; remaining cosmetics are implementer's choice under the palette doctrine).

- [ ] **Step 1: Failing test**

```ts
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";
import { seedConditions } from "../src/lib/canvasUtil.js";

test("seeds carry extrude doctrine (RB-1 vertical 4in, TR-1 flush, CG-1 4ft)", () => {
  const byTag: Record<string, any> = Object.fromEntries(FLOORING_DEFAULTS.map((t) => [t.finish_tag, t]));
  assert.equal(byTag["RB-1"].extrude_mode, "vertical");
  assert.ok(Math.abs(byTag["RB-1"].extrude_h_ft - 1 / 3) < 1e-12);
  assert.equal(byTag["TR-1"].extrude_mode, "flush");
  assert.equal(byTag["CG-1"].extrude_h_ft, 4);
});

test("seedConditions passes the new fields through instantiateTemplate", () => {
  const conds = seedConditions(null);
  const rb = conds.find((c) => c.finish_tag === "RB-1");
  assert.equal(rb.extrude_mode, "vertical");
  assert.ok(Math.abs(rb.extrude_h_ft - 1 / 3) < 1e-12);
});
```

- [ ] **Step 2: Run → red.** **Step 3: Implement** the three edits (one-line additions mirroring the `height_ft`/`thickness_in` passthrough pattern verbatim at `canvasUtil.js:62-63` and `plays.js:31-32`). **Step 4: Run → green.** **Step 5: Commit** `feat: extrude condition fields + RB-1/TR-1/CG-1 seeds`.

---

### Task 4: UI — param row controls, shape snapshot + override, reminder toast

**Files:**
- Modify: `web/src/components/TakeoffsPanel.jsx:478-482` (third DimParamInput + mode control after T)
- Modify: `web/src/pages/TakeoffCanvas.jsx` — snapshot in BOTH count-commit paths (`commitSweep` `:4228-4233`, `commitCount` `:4242-4246`) and the linear commit path; `setShapeExtrude`/`clearShapeExtrude` beside `setShapeHeight` (`:6661-6676`); inspector override beside the surface-height field (`:8779-8792`); reminder via `setCommitMsg` (`:668-694`).

**Interfaces:**
- Produces: `onSetCondParam("extrude_h_ft", v)`, `onUpdateCond({ extrude_mode })` wiring; shape fields `extrude_h_ft?: number, extrude_override?: boolean`.

- [ ] **Step 1: Param row controls** — after the T `<span>` (`TakeoffsPanel.jsx:482`):

```jsx
<span style={{ display: "flex", alignItems: "center", gap: 4 }} title={`Installed height (${heightUnit(units)}) — the 3D view extrudes wall base and count items (corner guards) to this. Per-shape: select a shape to override just that one.`}>
  <span style={{ color: "var(--ink-muted)" }}>3D H</span>
  <DimParamInput name="condition-extrude-h-ft" internal={c.extrude_h_ft} units={units} kind="height" width={54}
    onCommit={(v) => onSetCondParam("extrude_h_ft", v)} />
</span>
<span style={{ display: "flex", alignItems: "center", gap: 4 }} title="How linear runs install: vertical stands up the wall (base); flush lies in the floor plane (transition/reducer strips).">
  <span style={{ color: "var(--ink-muted)" }}>3D</span>
  {[["vertical", "↕ base"], ["flush", "≡ flush"]].map(([id, label]) => (
    <button key={id} type="button" onClick={() => onUpdateCond({ extrude_mode: id })}
      style={{ fontSize: 10.5, padding: "1px 6px", cursor: "pointer",
        border: (c.extrude_mode || "vertical") === id ? "1px solid var(--accent, #1f3fc7)" : "1px solid var(--ink-faint)",
        background: (c.extrude_mode || "vertical") === id ? "var(--paper-dim, #eef1f7)" : "var(--paper-bright)" }}>
      {label}
    </button>
  ))}
</span>
```

(Two-option segmented control, both choices visible, active highlighted — the Straight/Curve precedent at `TakeoffCanvas.jsx:8686-8700`. Both spans render unconditionally; conditions are role-agnostic and the fields are inert where irrelevant, exactly like T on a floor condition.)

- [ ] **Step 2: Commit-path snapshots + reminder.** In `commitCount` (`:4242-4246`), `commitSweep`'s shape mapping (`:4228-4233`), and the linear commit path, add to the minted shape object (note: the active-condition binding in this scope is **`aCond`**, per `:4113`'s `aCond?.height_ft`):

```js
...(Number(aCond?.extrude_h_ft) > 0 ? { extrude_h_ft: Number(aCond.extrude_h_ft) } : {}),
```

and the reminder (spec copy, verbatim) when the active condition has no installed height — count commits and vertical-mode linear commits:

```js
if (!(Number(aCond?.extrude_h_ft) > 0) && (cRole === "count" || (cRole === "linear" && (aCond?.extrude_mode || "vertical") === "vertical"))) {
  setCommitMsg(`Set installed height for ${aCond.finish_tag} — the 3D view renders it`);
}
```

(`cRole` is the role being committed at that site — inline the literal `"count"` / `"linear"` at each of the three sites rather than threading a variable, matching how each commit function already knows its own role.)

**`commitSweep` toast collision (cycle-2 finding):** `TakeoffCanvas.jsx:4235` already calls `setCommitMsg(\`Committed ${rows.length} EA …\`)` unconditionally right after the shape mapping, and `setCommitMsg` is single-slot last-write-wins (`:677-679`) — a reminder inserted before it is silently clobbered. In `commitSweep`, do NOT add a second `setCommitMsg`; instead EXTEND the existing call at `:4235`:

```js
const needH = !(Number(aCond?.extrude_h_ft) > 0);
setCommitMsg(`Committed ${rows.length} EA under ${aCond?.finish_tag ?? "…"} …`
  + (needH ? ` · set installed height (3D H) for ${aCond.finish_tag} — the 3D view renders it` : ""));
```

(One message, one slot — the reminder rides the success toast. `commitCount` has no competing `setCommitMsg` today, so its reminder is a plain call as written above.)

- [ ] **Step 3: Per-shape override** — clone `setShapeHeight`/`clearShapeHeight` (`:6661-6676`) as `setShapeExtrude`/`clearShapeExtrude`: fields `extrude_h_ft`/`extrude_override`, and **no `recomputeShape` call** — display-only, quantities untouched. Inspector input mirroring the surface-height block (`:8779-8792`), gated on `selShape.measure_role === "count" || selShape.measure_role === "linear"`, with the same ↺ revert-to-condition affordance.
- [ ] **Step 4: `cd web && npm run check`** → green. **Step 5: Hand-verify** (`npm run dev`, sample plan): set RB-1 3D H = 4 in; place a single count under CG-1; sweep-place more (toast appears on unset conditions); select one guard → override to 8 ft → ↺ reverts. **Step 6: Commit** `feat: extrude controls, per-shape overrides, reminder toast`.

---

### Task 5: `View3D.jsx` — renderer + overlay

**Files:**
- Create: `web/src/components/View3D.jsx`
- Modify: `web/package.json` (`npm i three`)

**Interfaces:**
- Consumes: `buildScene` output; props `{ shapes, conditions, sheet, focusIds, sheetLabel, onClose }` (`focusIds: Set<string> | null` — null = show all).
- Produces: default-export component; scene labels (excluded-caption sprites, note chips), legend rail, section cut, explode, export, reset view.

- [ ] **Step 1: `npm i three`.** **Step 2: Component** (~250 lines; load-bearing contracts below — every bullet is spec-pinned):

```jsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildScene, buildRibbon, RIBBON_HALF_FT, FLUSH_HALF_FT } from "../lib/scene3d.js";

export default function View3D({ shapes, conditions, sheet, focusIds, sheetLabel, onClose }) {
  const mountRef = useRef(null);
  const [hidden, setHidden] = useState(() => new Set()); // legend condition toggles
  const [explode, setExplode] = useState(0);             // ft; >0 disables cut
  const [cut, setCut] = useState(null);                  // number | null
  const scene = useMemo(() => buildScene({ shapes, conditions, sheet }), [shapes, conditions, sheet]);
  // ...(state plumbing; JSX legend rail renders scene.notes as chips +
  // honest-limitations label + condition toggles + sliders + buttons)
}
```

Renderer contracts the implementation must honor:
- **Axis mapping:** `new THREE.Vector3(x, up, w)` from scene3d's `[x, up, w]` tuples; `pt_ft`/`path_ft` entries are `[x, w]` pairs → `Vector3(p[0], h, p[1])`. No further negation anywhere.
- **Per-condition Groups:** merged slab+ribbon `BufferGeometry` per condition via `mergeGeometries` (position/normal only; color from the per-condition `MeshBasicMaterial`, never vertex-baked); `DoubleSide` on all materials; `transparent: true, opacity: 0.35` for `translucent` shapes — translucent and derived ribbons are separate merged meshes per condition (opacity is material state); **derived ribbons render at `opacity: 0.7`** (the derived-vs-hand-traced distinction; door gaps aren't drawn, so derived runs read as schematic).
- **Excluded volumes:** one translucent-red `MeshBasicMaterial({ color: EXCLUDED_COLOR, transparent: true, opacity: 0.35, depthWrite: false })` mesh per deduct-owning condition, parented under that condition's Group.
- **Posts:** per condition owning count shapes, `new THREE.CylinderGeometry(1, 1, 1, 12).rotateX(Math.PI / 2).translate(0, 0, 0.5)` — **CylinderGeometry's long axis is local Y; `rotateX` remaps it to local Z, then `translate` base-anchors z ∈ [0, 1]** — and per-instance `matrix = translate(pt[0], 0, pt[1]) · scale(1, 1, h)` via `setMatrixAt` (`pt` is the plain `[x, w]` array from `pt_ft`; `h` = the post's own `z1`, so per-shape overrides scale per instance).
- **In-scene captions:** each `notes` entry with an `at` anchor (excluded areas) renders a `THREE.Sprite` with a canvas-texture label ("excluded area — see plan") at that world point; all `notes` also render as legend chips (HTML rail).
- **Legend toggles** set Group `.visible`. **Explode** (slider) sets each condition Group's `position.y = index * explode` — a transform, never a rebuild; UI disables section cut while `explode > 0` and vice versa. **Section cut:** one horizontal `THREE.Plane`, `renderer.localClippingEnabled = true`, the `clippingPlanes` array set on EVERY material (condition, excluded, post, sprite). **Framing:** fit-to-content (bounding sphere + FOV) on open, on legend toggle, and via a **reset-view button**; explode deliberately leaves framing static.
- **Export:** button handler runs `renderer.render(scene, camera)` then reads `renderer.domElement.toDataURL("image/png")` in the same call stack; composites the image onto a 2D canvas with a footer strip — sheet label, scale, date, and verbatim: `schematic — not as-built; openings deducted, not shown; verify in field` — then downloads.
- **Overlay chrome:** persistent (non-dismissible) honest-limitations label with the spec's verbatim text: "Schematic view — no wall thickness, no door frames, no casework, flat single-elevation floors, generic base profile, openings deducted-not-shown." **Unmount:** `renderer.dispose()`, `renderer.forceContextLoss()`, `controls.dispose()`, dispose every geometry/material/texture, null refs. **Resize:** `ResizeObserver` → `camera.aspect` + `camera.updateProjectionMatrix()` + `renderer.setSize()`; `setPixelRatio(Math.min(devicePixelRatio, 2))`. **Focus isolation:** when `focusIds` is non-null, each condition's merged geometry is built in two batches (shapeId in-set / out-of-set); the OUT-of-set batch is `.visible = false` — hidden, not dimmed (the spec's "unlinked shapes stay visible" is satisfied because `isolate3D` keeps unlinked shapes IN the set; there is no dimming tier). When `derived` and `translucent` are both true, the unset-height translucent bucket (0.35) wins; the unset-height note still fires so nothing is silently lost.
- **JSX not TSX:** plain `useState(null)` — no generics in `.jsx` (lint fails on `<number`).

- [ ] **Step 3: Hand-verify** (sample plan: rooms + derived base + guards + a standalone deduct): top-down orientation matches the 2D sheet; derived base translucent; excluded caption sprite; explode, cut, toggles, reset view, export footer. **Step 4: Commit** `feat: View3D three.js renderer overlay`.

---

### Task 6: Canvas integration — scoping, isolation, shortcut, docs

**Files:**
- Create: `web/src/lib/scene3dScope.js` (pure isolation helper) + test in `web/test/scene3d.test.ts`
- Modify: `web/src/pages/TakeoffCanvas.jsx` (lazy overlay, toolbar button, `menuDepthRef` bump, sheet scoping, selection wiring)
- Modify: `README.md`, `docs/USER_GUIDE.md`, `CHANGELOG.md`, `FEATURES.md`

**Interfaces:**
- Produces: `isolate3D(selectedId, shapes)` → `Set<string> | null` (null when nothing selected).

- [ ] **Step 1: Failing test**

```ts
import { isolate3D } from "../src/lib/scene3dScope.js";

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
```

- [ ] **Step 2: Red → Step 3: Implement `scene3dScope.js`**

```js
// v1 isolation (spec: honest scope): a selected shape's room = itself, shapes
// whose origin.derived.from_shape_id (or .between_shape_ids) reaches it, and
// label-equal siblings. Shapes with NO linkage to anything stay visible —
// they can't be attributed, so hiding them would silently shrink the scene.
// Everything linked to a different room drops.
export function isolate3D(selectedId, shapes) {
  if (!selectedId) return null;
  const sel = shapes.find((s) => s.id === selectedId);
  if (!sel) return null;
  const vis = new Set([selectedId]);
  for (const s of shapes) {
    const d = s.origin?.derived;
    const linked = d && (d.from_shape_id === selectedId || (Array.isArray(d.between_shape_ids) && d.between_shape_ids.includes(selectedId)));
    if (linked) vis.add(s.id);
    else if (s.label && sel.label && s.label === sel.label) vis.add(s.id);
    else if (!s.origin?.derived && !s.label) vis.add(s.id); // unlinked: stays
  }
  return vis;
}
```

- [ ] **Step 4: Canvas wiring.** Lazy overlay + scoping + gate. Verified real identifiers: the active single-view sheet key is **`sheetKey`** (`TakeoffCanvas.jsx:878`); panel lookup is **`panelByKey(k)`** (`:1036`) with the split/group view's focused panel at **`focusPanel`** (`:1060`); `uppFor`/`tabLabel`/`visibleShapes`/`selectedId` are real as-is. Scope decision: **v1 opens on the focused panel's sheet when a group view has focus (`focusPanel`), else the active sheet (`sheetKey`)** — one sheet, never stitched:

```jsx
const View3D = React.lazy(() => import("../components/View3D.jsx"));
// state: const [show3d, setShow3d] = useState(false);
// at render scope:
const active3dKey = focusPanel?.key ?? sheetKey;
const panel3d = active3dKey ? panelByKey(active3dKey) : null;
// toolbar, beside the Report toggle:
<button onClick={() => (uppFor(active3dKey) ? setShow3d(true) : setCommitMsg("Set the sheet scale first — 3D is feet-true or nothing"))}
  title="3D view — this sheet's takeoff extruded (needs scale)">3D</button>
// overlay (rendered when show3d):
{show3d && panel3d && uppFor(active3dKey) && (
  <React.Suspense fallback={null}>
    <View3D
      shapes={visibleShapes.filter((s) => s.sheet_id === active3dKey)}
      conditions={conditions}
      sheet={{ widthPx: panel3d.img.w, heightPx: panel3d.img.h, upp: uppFor(active3dKey) }}
      focusIds={isolate3D(selectedId, visibleShapes.filter((s) => s.sheet_id === active3dKey))}
      sheetLabel={tabLabel(active3dKey)}
      onClose={() => setShow3d(false)} />
  </React.Suspense>
)}
```

Unscaled sheet: the button routes to the scale-gate toast (above) — the overlay never mounts unscaled. While the overlay is mounted, gate the 2D letter tools through the existing menu-depth counter (`:804-808`), the same way ToolMenu does — concretely:

```jsx
{show3d && <View3DGate onMount={() => onMenuDepth(true)} onUnmount={() => onMenuDepth(false)} />}
```

or simply call `onMenuDepth(true)` in the effect that opens the overlay and `onMenuDepth(false)` in `onClose` — one open, one close, symmetric. Add a single-letter shortcut picked against the USER_GUIDE §15 table at implementation (O, A, R, L, S, C, D, H, N, K, V, G, M, F, Q are taken); document it in §15.
- [ ] **Step 5: Docs.** README Features bullet; USER_GUIDE: new "3D view" section (open/gate, legend chips + captions, explode, section cut, export footer, limitations label, per-shape 3D-H override, **and the disclosed bevel-seam artifact: sharp near-reversal corners render beveled and may show a thin seam**) + §15 shortcut row; CHANGELOG entry; FEATURES.md row pointing at `scene3d.js`/`View3D.jsx`. **Step 6: `npm run check` green + full hand pass** (sample plan end-to-end: load, scale, trace, derive base, guards, open 3D, select a room → out-of-room linked shapes hide, export PNG with footer). **Step 7: Commit** `feat: 3D takeoff view — canvas integration, isolation, docs`.

---

## Self-Review (done)

- **Spec coverage:** role doctrine (Tasks 1–2); extrude fields/seeds/UI/override/toast incl. BOTH count-commit paths (Tasks 3–4); renderer contract incl. cylinder rotation, derived translucency, excluded sprites, notes→legend, export footer, limitations label (Task 5); sheet scoping + isolation + shortcut + menuDepthRef + docs (Task 6); openings/xn/excluded/unset/nominal notes all generated and tested (Task 2); non-goals absent by construction.
- **Type consistency:** `buildScene({shapes, conditions, sheet})`; `buildRibbon(path, halfWidth)` → `{positions}` (x,y flat pairs); `extrudeHeight` cascade; `isolate3D(selectedId, shapes)` → `Set|null`; View3D props match Task 6's wiring; axis contract `[x, up, w]` stated once and used consistently.
- **Placeholders:** none — every code step is literal; arithmetic in tests re-derived (5/−5/12.5 values, miter bound from `MITER_LIMIT × halfWidth`); runner commands match the repo's real single-file pattern.
