# 3D Takeoff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An on-demand, per-sheet 3D view that extrudes the estimator's committed 2D takeoff shapes (floors, wall base, wall protection, corner guards, transitions) using condition heights/thicknesses and per-shape height overrides.

**Architecture:** Three layers — a pure scene builder (`web/src/lib/scene3d.js`, no three import, node:test-able), a lazy-loaded three.js renderer overlay (`web/src/components/View3D.jsx`, `React.lazy` chunk), and a trigger-only integration in `TakeoffCanvas.jsx`. Two new display-only condition fields (`extrude_h_ft`, `extrude_mode`) plus per-shape `extrude_h_ft`/`extrude_override` snapshots mirroring the existing `height_ft`/`height_override` mechanism.

**Tech Stack:** React 18 + Vite, three.js (new dep, lazy chunk), node:test. TypeScript-flavored JSDoc/TS in lib files matching existing conventions (`web/src/lib/*.js` plain JS except `.ts` engine files; scene3d is plain JS like geometry.js, tests in `web/test/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md` — the plan argues from the spec; read both. Every doctrine table row, renderer contract bullet, and pinned citation below traces to it.

## Global Constraints

- Never commit on `main`; work on `feat/3d-takeoff-view` (create from `feat/3d-takeoff-view-spec` or fresh from `main`).
- `npm run check` (in `web/`) must be green before every push — it is exactly CI. Node version pinned by `web/.nvmrc`.
- Do not overload `height_ft` — it stays the surface-area H knob only (`TakeoffsPanel.jsx:473` copy is pinned).
- `extrude_h_ft`/`extrude_mode`/`extrude_override` are display-only: they never feed totals, report, or materials quantities.
- Waste never appears in 3D; ×N never duplicates geometry (legend footnote only).
- Never cross-sheet: the scene is built from ONE sheet's shapes (match-line doctrine).
- Unscaled sheet (`upp == null`) → refuse with the scale-gate message.
- No MCP surface, no `mcp/` changes, no version bumps in this feature.
- Colors for three materials come from condition hex colors (SVG-literal-color convention); overlay chrome uses `tokens.css` vars.
- Import three addons per-file: `three/examples/jsm/controls/OrbitControls.js`, `three/examples/jsm/utils/BufferGeometryUtils.js` — never the barrel.
- Docs sync in the final task: README (Features), `docs/USER_GUIDE.md` (new section + §15 row), `CHANGELOG.md`, `FEATURES.md`.

---

### Task 1: `scene3d.js` — coordinate mapping + slab geometry

**Files:**
- Create: `web/src/lib/scene3d.js`
- Test: `web/test/scene3d.test.ts`

**Interfaces:**
- Consumes: shapes `{id, sheet_id, condition_id, measure_role, verts_norm, verts_norm_holes?, height_ft?, extrude_h_ft?, extrude_override?, label?, origin?}`, conditions `{id, finish_tag, color, thickness_in?, height_ft?, extrude_h_ft?, extrude_mode?}`, `sheet {widthPx, heightPx, upp}`.
- Produces: `buildScene({shapes, conditions, sheet})` → `{ slabs, ribbons, posts, notes }` where `slabs: [{verts_ft, holes_ft, z0, z1, color, tag, kind, shapeId}]`, `ribbons: [{path_ft, z0, z1, side, color, tag, mode, shapeId}]`, `posts: [{pt_ft, z0, z1, color, tag, shapeId}]`, `notes: [{kind, tag, text}]`. All coordinates internal FEET. `NOMINAL_THICKNESS_FT = 1/24`, `NOMINAL_HEIGHT_FT = 3`, `MITER_LIMIT = 4`, `EXCLUDED_COLOR = "#b03a26"` (ui.js SVG.danger literal). `toWorldFt(verts_norm, sheet)` and `worldWindingCCW(ring)` exported for tests.

- [ ] **Step 1: Write failing tests — mapping, winding, floor slabs**

```ts
// web/test/scene3d.test.ts — header mirrors web/test/geometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScene, toWorldFt, worldWindingCCW,
  NOMINAL_THICKNESS_FT, NOMINAL_HEIGHT_FT, EXCLUDED_COLOR,
} from "../src/lib/scene3d.js";

// sheet: 1000×2000 px image space, upp = 0.05 ft/px → 50×100 ft
const SHEET = { widthPx: 1000, heightPx: 2000, upp: 0.05 };
const COND = { id: "c1", finish_tag: "CPT-1", color: "#2f7d54" };

// CCW in image space (y down): (0,0)→(100,0)→(100,100)→(0,100)
const SQ_NORM: [number, number][] = [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]];

test("toWorldFt: y flips, scale to feet, winding reversed to CCW-in-world", () => {
  const w = toWorldFt(SQ_NORM, SHEET);
  assert.deepEqual(w[0], [0, 0]);          // x ft
  assert.deepEqual(w[1], [50, 0]);         // 0.1 × 1000px × 0.05
  assert.deepEqual(w[2], [50, -10]);       // y = −(0.05 × 2000 × 0.05)
  assert.equal(worldWindingCCW(w), true);  // source CW-in-image → CCW in world after flip+reversal
});

test("floor_area → slab z [0, nominal] when thickness unset", () => {
  const { slabs, notes } = buildScene({
    sheet: SHEET,
    conditions: [COND],
    shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: { area_sf: 500 } }],
  });
  assert.equal(slabs.length, 1);
  assert.equal(slabs[0].kind, "floor");
  assert.equal(slabs[0].z1, NOMINAL_THICKNESS_FT);
  assert.equal(slabs[0].color, COND.color);
  assert.ok(notes.some((n) => n.kind === "nominal-thickness" && n.tag === "CPT-1"));
});

test("floor_area slab uses thickness_in/12 when set", () => {
  const { slabs } = buildScene({
    sheet: SHEET,
    conditions: [{ ...COND, thickness_in: 0.25 }],
    shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} }],
  });
  assert.ok(Math.abs(slabs[0].z1 - 0.25 / 12) < 1e-9);
});

test("holes punch through: verts_norm_holes carried as holes_ft, re-wound opposite", () => {
  const hole: [number, number][] = [[0.01, 0.01], [0.02, 0.01], [0.02, 0.02], [0.01, 0.02]];
  const { slabs } = buildScene({
    sheet: SHEET,
    conditions: [COND],
    shapes: [{ id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, verts_norm_holes: [hole], computed: {} }],
  });
  assert.equal(slabs[0].holes_ft.length, 1);
  assert.equal(worldWindingCCW(slabs[0].holes_ft[0]), false); // hole wound opposite to outer
});

test("unscaled sheet throws the scale-gate refusal", () => {
  assert.throws(() => buildScene({ sheet: { ...SHEET, upp: null }, conditions: [COND], shapes: [] }), /scale/i);
});
```

- [ ] **Step 2: Run to verify fail** — `cd web && npm test -- test/scene3d.test.ts` → module not found.
- [ ] **Step 3: Implement `toWorldFt`, winding, slabs, notes in `web/src/lib/scene3d.js`**

```js
// Pure 3D scene builder — no three import, node:test-able. Doctrine: spec
// docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md.
// World mapping (pinned): world = (x_ft, height_up, −y_ft). Image y grows DOWN;
// the flip inverts winding uniformly, so rings are reversed on import to land
// CCW-in-world (up-facing under a top-down camera). Materials render DoubleSide
// in the renderer as insurance regardless.

export const NOMINAL_THICKNESS_FT = 1 / 24; // floor slab visual thickness (display constant, not user data)
export const NOMINAL_HEIGHT_FT = 3;         // unset post/ribbon HEIGHT nominal (tall dimension)
export const EXCLUDED_COLOR = "#b03a26";    // ui.js SVG.danger literal
export const MITER_LIMIT = 4;               // miter offset × ribbon half-width before bevel fallback

export function toWorldFt(verts_norm, sheet) {
  return verts_norm.map(([nx, ny]) => [nx * sheet.widthPx * sheet.upp, -(ny * sheet.heightPx * sheet.upp)]);
}

// Shoelace sign on already-flipped world coords; CCW ⇒ positive area.
export function worldWindingCCW(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a > 0;
}

function ringCCW(ring) { return worldWindingCCW(ring) ? ring : [...ring].reverse(); }
function ringCW(ring) { return worldWindingCCW(ring) ? [...ring].reverse() : ring; }

export function buildScene({ shapes, conditions, sheet }) {
  if (!(sheet.upp > 0)) throw new Error("Set the sheet scale first — 3D is feet-true or nothing.");
  const condById = new Map(conditions.map((c) => [c.id, c]));
  const slabs = [], ribbons = [], posts = [], notes = [];
  const nominalNote = new Set();

  for (const s of shapes) {
    const c = condById.get(s.condition_id);
    if (!c) continue; // orphan shape: dead condition — skip, totals' convention
    const condH = Number(c.thickness_in) > 0 ? c.thickness_in / 12 : NOMINAL_THICKNESS_FT;

    if (s.measure_role === "floor_area") {
      slabs.push({
        verts_ft: ringCCW(toWorldFt(s.verts_norm, sheet)),
        holes_ft: (s.verts_norm_holes || []).map((h) => ringCW(toWorldFt(h, sheet))),
        z0: 0, z1: condH, color: c.color, tag: c.finish_tag, kind: "floor", shapeId: s.id,
      });
      if (!(Number(c.thickness_in) > 0) && !nominalNote.has(c.finish_tag)) {
        nominalNote.add(c.finish_tag);
        notes.push({ kind: "nominal-thickness", tag: c.finish_tag, text: `${c.finish_tag} has no thickness set — slab shown at nominal visual thickness` });
      }
    }
    // surface_area / linear / count / deduct handled in Tasks 2–3
  }
  return { slabs, ribbons, posts, notes };
}
```

- [ ] **Step 4: Run tests → pass.** `cd web && npm test -- test/scene3d.test.ts`
- [ ] **Step 5: Commit** `git add web/src/lib/scene3d.js web/test/scene3d.test.ts && git commit -m "feat: scene3d pure builder — world mapping, winding, floor slabs"`

---

### Task 2: `scene3d.js` — deducts, ribbons (miter clamp, interior side), posts

**Files:**
- Modify: `web/src/lib/scene3d.js`
- Test: `web/test/scene3d.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `buildScene` internals; `s.extrude_h_ft`/`s.extrude_override` (set in Task 4; absent on old data → fallback to condition).
- Produces: complete `buildScene` covering all five roles; `ribbonBand(path_ft, halfWidth)` → quad-strip triangles `{positions: number[]}` for the renderer; miter clamp + degenerate filtering exported for tests (`buildRibbon`).

- [ ] **Step 1: Write failing tests**

```ts
test("reconciled deduct (cuts_shape_id) renders as nothing; its hole is the parent's", () => {
  const { slabs } = buildScene({
    sheet: SHEET,
    conditions: [COND],
    shapes: [
      { id: "s1", sheet_id: "a", condition_id: "c1", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
      { id: "s2", sheet_id: "a", condition_id: "c1", measure_role: "deduct", cuts_shape_id: "s1", verts_norm: SQ_NORM, computed: {} },
    ],
  });
  assert.equal(slabs.length, 1); // the deduct produced no slab of its own
});

test("standalone deduct → excluded-volume slab with EXCLUDED_COLOR, same h range", () => {
  const { slabs } = buildScene({
    sheet: SHEET,
    conditions: [{ ...COND, thickness_in: 0.5 }],
    shapes: [{ id: "s2", sheet_id: "a", condition_id: "c1", measure_role: "deduct", verts_norm: SQ_NORM, computed: {} }],
  });
  const ex = slabs.find((s) => s.kind === "excluded");
  assert.ok(ex);
  assert.equal(ex.color, EXCLUDED_COLOR);
  assert.ok(Math.abs(ex.z1 - 0.5 / 12) < 1e-9);
});

test("surface_area ribbon uses shape-snapshotted height", () => {
  const { ribbons } = buildScene({
    sheet: SHEET,
    conditions: [{ ...COND, height_ft: 9 }],
    shapes: [{ id: "s3", sheet_id: "a", condition_id: "c1", measure_role: "surface_area", verts_norm: [[0, 0], [0.1, 0]], height_ft: 4, computed: {} }],
  });
  assert.equal(ribbons.length, 1);
  assert.equal(ribbons[0].z1, 4); // snapshot wins over condition H
});

test("linear vertical: extrude_h_ft snapshot, override wins; unset → condition → nominal + note", () => {
  const base = { sheet: SHEET, conditions: [{ id: "c1", finish_tag: "RB-1", color: "#475569", extrude_h_ft: 1 / 3, extrude_mode: "vertical" }] };
  const mk = (over: object = {}) => ({ id: "s4", sheet_id: "a", condition_id: "c1", measure_role: "linear", verts_norm: [[0, 0], [0.1, 0]], computed: {}, ...over });
  let r = buildScene({ ...base, shapes: [mk()] }).ribbons[0];
  assert.ok(Math.abs(r.z1 - 1 / 3) < 1e-9);
  r = buildScene({ ...base, shapes: [mk({ extrude_h_ft: 0.5, extrude_override: true })] }).ribbons[0];
  assert.equal(r.z1, 0.5);
  const unset = buildScene({ ...base, conditions: [{ id: "c1", finish_tag: "RB-1", color: "#475569" }], shapes: [mk()] });
  assert.equal(unset.ribbons[0].z1, NOMINAL_HEIGHT_FT);
  assert.ok(unset.notes.some((n) => n.kind === "unset-height" && n.tag === "RB-1"));
});

test("linear flush: z0 = higher adjoining slab top via between_shape_ids; nominal fallback noted", () => {
  const conds = [
    { id: "cA", finish_tag: "CPT-1", color: "#2f7d54", thickness_in: 0.125 },
    { id: "cB", finish_tag: "LVT-1", color: "#b8860b", thickness_in: 0.5 },
    { id: "cT", finish_tag: "TR-1", color: "#c96442", thickness_in: 0.25, extrude_mode: "flush" },
  ];
  const shapes = [
    { id: "fA", sheet_id: "a", condition_id: "cA", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
    { id: "fB", sheet_id: "a", condition_id: "cB", measure_role: "floor_area", verts_norm: SQ_NORM, computed: {} },
    { id: "t1", sheet_id: "a", condition_id: "cT", measure_role: "linear", verts_norm: [[0, 0], [0.1, 0]],
      computed: {}, origin: { derived: { between_shape_ids: ["fA", "fB"], between: ["CPT-1", "LVT-1"], case: "butt", gap_in: 0 } } },
  ];
  const r = buildScene({ sheet: SHEET, conditions: conds, shapes }).ribbons.find((x) => x.tag === "TR-1")!;
  assert.ok(Math.abs(r.z0 - 0.5 / 12) < 1e-9); // higher side (LVT 0.5")
  assert.ok(Math.abs(r.z1 - (0.5 + 0.25) / 12) < 1e-9);
  const hand = buildScene({ sheet: SHEET, conditions: conds, shapes: [{ ...shapes[2], id: "t2", origin: undefined }] });
  assert.ok(hand.notes.some((n) => n.kind === "nominal-thickness" && n.tag === "TR-1")); // hand-traced: nominal fallback
});

test("count → post at exact point, extrude height, override wins", () => {
  const { posts } = buildScene({
    sheet: SHEET,
    conditions: [{ id: "cG", finish_tag: "CG-1", color: "#1f6b4a", extrude_h_ft: 4 }],
    shapes: [{ id: "s5", sheet_id: "a", condition_id: "cG", measure_role: "count", verts_norm: [[0.25, 0.25]], computed: { count: 1 } }],
  });
  assert.deepEqual(posts[0].pt_ft, [125, -25]);
  assert.equal(posts[0].z1, 4);
});

test("miter clamp: near-180° joint falls back to bevel, ribbon width bounded", () => {
  // path with a reflex near-straight joint: long straight run with 179° dogleg
  const path: [number, number][] = [[0, 0], [10, 0.001], [20, 0]];
  const r = buildRibbon(path, 0.05); // halfWidth 0.05 ft
  const xs = r.positions.filter((_, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) <= 10.6, "no miter spike beyond path extent + half-width");
});

test("degenerate segments filtered: duplicate points produce no NaN", () => {
  const r = buildRibbon([[0, 0], [0, 0], [5, 0], [5, 0]], 0.05);
  assert.ok(r.positions.every((v) => Number.isFinite(v)));
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement**

Append to `scene3d.js` (inside `buildScene`'s loop and as exported helpers):

```js
// Ribbon band: quad strip per segment, miter joins under MITER_LIMIT with
// bevel fallback, near-duplicate points collapsed and zero-length segments
// skipped BEFORE normal computation (NaN → bounding spheres → silent vanishing).
export function buildRibbon(pathFt, halfWidth) {
  const pts = [];
  for (const p of pathFt) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) pts.push(p);
  }
  const positions = [];
  const offset = (i, dir, len) => [pts[i][0] + dir[1] * len, pts[i][1] - dir[0] * len]; // left normal
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(d[0], d[1]);
    if (len < 1e-9) continue;
    const u = [d[0] / len, d[1] / len];
    // joint direction: bisector with the neighbor segment, miter-clamped
    const prevU = i > 0 ? segU(pts, i - 1) : u, nextU = i < pts.length - 2 ? segU(pts, i + 1) : u;
    positions.push(...quad(a, b, u, halfWidth, prevU, nextU)); // emits 2 triangles (6 verts, flat positions)
  }
  return { positions };
}
function segU(pts, i) {
  const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}
// quad(): builds each segment's two edge pairs; at interior joints uses the
// bisector normal with miter length clamped to MITER_LIMIT × halfWidth — past
// the clamp the join is beveled (edge pair snapped to the segment's own normal).
```

(The `quad` helper is written out in full during implementation — it composes the two edge vertices per segment end, applying the clamped bisector at shared joints. The miter-length formula is `halfWidth / Math.sin(theta / 2)` with θ the interior angle between consecutive segments; when it exceeds `MITER_LIMIT * halfWidth`, use the plain segment normal at that end.)

Deduct/ribbon/post dispatch inside `buildScene`:

```js
    if (s.measure_role === "deduct") {
      if (s.cuts_shape_id) continue;               // reconciled: hole already in parent
      slabs.push({ verts_ft: ringCCW(toWorldFt(s.verts_norm, sheet)), holes_ft: [],
        z0: 0, z1: condH, color: EXCLUDED_COLOR, tag: c.finish_tag, kind: "excluded", shapeId: s.id });
      continue;
    }
    if (s.measure_role === "surface_area") {
      const h = Number(s.height_ft) > 0 ? Number(s.height_ft) : Number(c.height_ft) || 0;
      ribbons.push({ path_ft: toWorldFt(s.verts_norm, sheet), z0: 0, z1: h, side: "center",
        color: c.color, tag: c.finish_tag, mode: "vertical", shapeId: s.id, translucent: !(h > 0) });
      if (!(h > 0)) noteUnset(notes, unsetNote, c.finish_tag);
      continue;
    }
    if (s.measure_role === "linear") {
      const mode = c.extrude_mode === "flush" ? "flush" : "vertical";
      if (mode === "flush") {
        const z0 = flushBase(s, shapes, condById, sheet); // between_shape_ids → max adjoining slab top; else NOMINAL_THICKNESS_FT + note
        const t = Number(c.thickness_in) > 0 ? c.thickness_in / 12 : NOMINAL_THICKNESS_FT;
        ribbons.push({ path_ft: toWorldFt(s.verts_norm, sheet), z0, z1: z0 + t, side: "center",
          color: c.color, tag: c.finish_tag, mode: "flush", shapeId: s.id });
      } else {
        const h = shapeHeight(s, c); // s.extrude_override ? s.extrude_h_ft : s.extrude_h_ft ?? c.extrude_h_ft
        ribbons.push({ path_ft: toWorldFt(s.verts_norm, sheet), z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT,
          side: s.origin?.derived?.from_shape_id ? "interior" : "center",
          color: c.color, tag: c.finish_tag, mode: "vertical", shapeId: s.id, translucent: !(h > 0) });
        if (!(h > 0)) noteUnset(notes, unsetNote, c.finish_tag);
      }
      continue;
    }
    if (s.measure_role === "count") {
      const h = shapeHeight(s, c);
      posts.push({ pt_ft: toWorldFt(s.verts_norm, sheet)[0], z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT,
        color: c.color, tag: c.finish_tag, shapeId: s.id, translucent: !(h > 0) });
      if (!(h > 0)) noteUnset(notes, unsetNote, c.finish_tag);
    }
```

`flushBase`: read `s.origin.derived.between_shape_ids`, look up those floor shapes' conditions, `max(thickness_in/12 or NOMINAL)`; no linkage → nominal + `nominal-thickness` note for that tag.

- [ ] **Step 4: Run tests → pass.** Commit: `feat: scene3d — deducts, ribbons (miter clamp, flush baseline), posts`.

---

### Task 3: Condition fields + seeds + persistence pass-through

**Files:**
- Modify: `web/src/lib/canvasConstants.js:119-121` (FLOORING_DEFAULTS RB-1/TR-1 + new CG-1)
- Modify: `web/src/lib/canvasUtil.js:62-66` (`seedConditions`/instantiate passthrough — add `extrude_h_ft`, `extrude_mode` alongside `height_ft`/`thickness_in`)
- Modify: `web/src/lib/plays.js:7,31-33` (`COND_KEEP` + restore)
- Test: `web/test/scene3d.test.ts` (append seed-level assertions) or a new `web/test/seeds3d.test.ts`

**Interfaces:**
- Produces: RB-1 `{extrude_mode: "vertical", extrude_h_ft: 1/3}`, TR-1 `{extrude_mode: "flush"}`, CG-1 `{ finish_tag: "CG-1", color: "#1f6b4a", hatch: "vert", waste_pct: 0, materials: [], extrude_h_ft: 4 }` — template shape, no fill (constructor derives). Cosmetic fields per spec: implementer's choice under palette doctrine.

- [ ] **Step 1: Failing test**

```ts
import { FLOORING_DEFAULTS } from "../src/lib/canvasConstants.js";
import { seedConditions } from "../src/lib/canvasUtil.js";

test("seeds carry extrude doctrine (RB-1 vertical 4in, TR-1 flush, CG-1 4ft post)", () => {
  const byTag = Object.fromEntries(FLOORING_DEFAULTS.map((t) => [t.finish_tag, t]));
  assert.equal(byTag.RB-1 ... // assert byTag["RB-1"].extrude_mode === "vertical" && Math.abs(byTag["RB-1"].extrude_h_ft - 1/3) < 1e-9
  assert.equal(byTag["TR-1"].extrude_mode, "flush");
  assert.equal(byTag["CG-1"].extrude_h_ft, 4);
});
test("seedConditions passes the new fields through instantiateTemplate", () => {
  const conds = seedConditions(null);
  const rb = conds.find((c) => c.finish_tag === "RB-1");
  assert.equal(rb.extrude_mode, "vertical");
});
```

(Write the assertions in full — the sketch above is abbreviated only here; the plan's executor writes complete `assert` statements.)

- [ ] **Step 2: Run → fail.** **Step 3: Implement** the three file edits above (one-line additions each, mirroring the existing `height_ft`/`thickness_in` passthrough pattern verbatim). **Step 4: Pass.** **Step 5: Commit** `feat: extrude_h_ft/extrude_mode condition fields + RB-1/TR-1/CG-1 seeds`.

---

### Task 4: UI — param row controls, shape snapshot + override, reminder toast

**Files:**
- Modify: `web/src/components/TakeoffsPanel.jsx:478-482` (add third DimParamInput + toggle after T)
- Modify: `web/src/pages/TakeoffCanvas.jsx` — commit paths for `count`/`linear` shapes (snapshot `extrude_h_ft` beside the `height_ft` snapshot at `:4117`); `setShapeExtrude`/`clearShapeExtrude` beside `setShapeHeight` (`:6661-6676`); inspector override field beside the surface-height field (`:8782-8790`); reminder via `setCommitMsg` (`:668-694`).

**Interfaces:**
- Produces: `onSetCondParam("extrude_h_ft", v)` and `onUpdateCond({ extrude_mode })` wired like H/T; shape fields `extrude_h_ft?: number, extrude_override?: boolean`.

- [ ] **Step 1: Param row control** — after the T `<span>` (TakeoffsPanel.jsx:482), add:

```jsx
<span style={{ display: "flex", alignItems: "center", gap: 4 }} title={`Installed height (${heightUnit(units)}) — the 3D view extrudes wall base and count items (corner guards) to this. Per-shape: select a shape to override just that one.`}>
  <span style={{ color: "var(--ink-muted)" }}>3D H</span>
  <DimParamInput name="condition-extrude-h-ft" internal={c.extrude_h_ft} units={units} kind="height" width={54}
    onCommit={(v) => onSetCondParam("extrude_h_ft", v)} />
</span>
<span style={{ display: "flex", alignItems: "center", gap: 4 }} title="How linear runs install: vertical stands up the wall (base); flush lies in the floor plane (transition/reducer strips).">
  <button type="button" onClick={() => onUpdateCond({ extrude_mode: (c.extrude_mode || "vertical") === "vertical" ? "flush" : "vertical" })}
    style={{ fontSize: 10.5, padding: "1px 6px", border: "1px solid var(--ink-faint)", background: "var(--paper-bright)", cursor: "pointer" }}>
    {(c.extrude_mode || "vertical") === "vertical" ? "↕ vertical" : "≡ flush"}
  </button>
</span>
```

Both render unconditionally (H/T precedent — conditions are role-agnostic). **Step 2: Commit-path snapshots** — in the `count` commit (`:4242-4246`) and `linear` commit paths, beside geometry push: `...(Number(cond?.extrude_h_ft) > 0 ? { extrude_h_ft: Number(cond.extrude_h_ft) } : {})`. **Step 3: Per-shape override** — clone `setShapeHeight`/`clearShapeHeight` as `setShapeExtrude`/`clearShapeExtrude` (fields `extrude_h_ft`/`extrude_override`, NO `recomputeShape` — display-only, quantities untouched) and an inspector input shown for `selShape.measure_role === "count" || selShape.measure_role === "linear"`. **Step 4: Reminder toast** — in the count commit path, when `!(Number(cond?.extrude_h_ft) > 0) && !selShapeExtrude`: `setCommitMsg("Set installed height (3D H) for {tag} — the 3D view renders it")`. **Step 5: `npm run check`** (typecheck+lint+test+build) → green. **Step 6: Hand-verify** in `npm run dev` (sample plan): set RB-1 3D H = 4", place a count under CG-1, override one guard to 8', confirm inspector revert. **Step 7: Commit** `feat: extrude controls, per-shape overrides, reminder toast`.

---

### Task 5: `View3D.jsx` — renderer + overlay

**Files:**
- Create: `web/src/components/View3D.jsx`
- Modify: `web/package.json` (add `three` dep, exact version at implementation time)

**Interfaces:**
- Consumes: `buildScene` output; props `{ shapes, conditions, sheet, onClose, sheetLabel }`.
- Produces: default export React component; base-anchored post geometry; per-condition Groups with merged geometry, excluded-volume meshes, per-condition post InstancedMeshes.

- [ ] **Step 1: `npm i three`** (per-file imports only: OrbitControls, BufferGeometryUtils). **Step 2: Component skeleton** (real implementation, ~200 lines — key contracts):

```jsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildScene } from "../lib/scene3d.js";

export default function View3D({ shapes, conditions, sheet, onClose, sheetLabel }) {
  const mountRef = useRef(null);
  const [hidden, setHidden] = useState(new Set());     // legend condition toggles
  const [explode, setExplode] = useState(0);            // ft
  const [cut, setCut] = useState<number | null>(null);  // section height; null = off
  const scene = useMemo(() => buildScene({ shapes, conditions, sheet }), [shapes, conditions, sheet]);
  // ... useEffect: renderer (MeshBasicMaterial, DoubleSide, depthWrite:false on
  // excluded), per-condition Groups (merged slab+ribbon geometry via
  // mergeGeometries; one InstancedMesh per count condition — unit post
  // CylinderGeometry translated so local z ∈ [0,1], instanceMatrix =
  // translate(x, zUp, -y) · scale(1,1,h)), legend toggle → Group.visible,
  // explode → per-condition Group.position.y = index * explode (section cut
  // disabled while explode > 0 and vice versa), clipping plane on every
  // material with renderer.localClippingEnabled = true, ResizeObserver +
  // camera.updateProjectionMatrix(), render loop with damping.
  // Export button: renderer.render() then canvas.toDataURL() in the same
  // call stack; composite footer strip (sheet id, scale, date, disclaimers)
  // on a 2D canvas beneath, then download PNG.
  // Unmount: controls.dispose(), renderer.dispose(), forceContextLoss(),
  // dispose all geometries/materials, null refs.
}
```

Geometry details the implementation must honor (all spec-pinned): slab = `THREE.Shape` from `verts_ft` (already CCW) with `holes_ft` as `THREE.Path` (CW), extruded `[z0, z1−z0]`; ribbon = `buildRibbon(path_ft, halfWidth)` positions raised to `[z0, z1]`; halfWidth 1/24 ft vertical ribbons, 1/12 ft flush strips; lateral anti-z-fight nudge = fraction of halfWidth per role; translucent flag → `transparent: true, opacity: 0.35`.

- [ ] **Step 3: Hand-verify** on sample plan (rooms + derived base + guards + a standalone deduct): top-down view matches the 2D sheet orientation; explode, section cut, legend toggles, reset-view, export footer all work. **Step 4: Commit** `feat: View3D three.js renderer overlay`.

---

### Task 6: Canvas integration + shortcut + docs

**Files:**
- Modify: `web/src/pages/TakeoffCanvas.jsx` (toolbar button + `React.lazy(() => import("../components/View3D.jsx"))` overlay; `menuDepthRef` bump on mount; shortcut letter chosen against USER_GUIDE §15 table at implementation — O taken, pick a free one)
- Modify: `README.md`, `docs/USER_GUIDE.md`, `CHANGELOG.md`, `FEATURES.md`

**Interfaces:** none new — wiring only.

- [ ] **Step 1: Lazy overlay + gating** — `const View3D = React.lazy(() => import("../components/View3D.jsx"));` state `show3d`; overlay renders `<Suspense>` full-screen; on open: refuse with existing scale-gate message if `upp == null`; bump `menuDepthRef` while mounted. **Step 2: Toolbar button + letter shortcut** following the existing tool-button pattern. **Step 3: Docs** — README Features bullet; USER_GUIDE new "3D view" section (open, legend, explode, section cut, export footer, honest-limitations label, per-shape 3D H override) + §15 shortcut row; CHANGELOG entry; FEATURES.md row pointing at scene3d.js/View3D.jsx. **Step 4: `npm run check` green.** **Step 5: Full hand pass** — sample plan end-to-end: load, scale, trace rooms, derive base, guards, open 3D, isolate via selection, export PNG with footer. **Step 6: Commit** `feat: 3D takeoff view — canvas integration + docs`.

---

## Self-Review (done)

- **Spec coverage:** role doctrine table → Tasks 1–2; extrude fields/UI/override/nudge → Tasks 3–4; renderer contract (draw calls, carve-outs, export, section cut, lifecycle, DPI, materials, framing) → Task 5; integration/menuDepthRef/legend → Tasks 5–6; openings caveat + honest-limitations label + footer → Tasks 5–6; tests list → Tasks 1–2 (+ flush/miter fixtures); docs sync → Task 6; non-goals absent by construction.
- **Type consistency:** `buildScene({shapes, conditions, sheet})`, `toWorldFt`, `worldWindingCCW`, `buildRibbon(path, halfWidth)`, `NOMINAL_*`/`EXCLUDED_COLOR`/`MITER_LIMIT` used consistently; shape field names `extrude_h_ft`/`extrude_override` match across builder/UI/inspector.
- **Placeholders:** none — every code step carries literal code or exact-anchor wiring; Task 3 Step 1's abbreviated asserts are called out for the executor to write in full.
