# Wall Tile — Slice A (Quantities Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a `surface_area` wall run on a tile condition into cut-accurate, orderable
tiled-elevation quantities (pieces / cuts / corner trim / movement joints / order),
reconciled to the measured `wall_sf`, with a docked panel preview — reusing the shipped
floor + repeat-unit engine over an unwrapped L×H strip.

**Architecture:** A same-finish wall run (open `verts_norm` polyline, corners at interior
vertices) unwraps into one L×H strip `[[0,0],[L,0],[L,H],[0,H]]` (feet). The existing
`solveTileLayout`/`classifyLayout`/`countsBySku`/`orderTiles`/repeat-unit painting run on
that strip **unchanged** for the field counts. Corner classification, corner cuts, edge
trim, and movement joints are computed **from the run polyline** (not the strip rectangle)
by new `tileWall/*` modules and packed into the existing `summary.trim` / `summary.joints`
structures, so the `byCond` aggregation and report rows are reused as-is. A wall origin
mode balances only the horizontal (U) axis and pins the vertical (V) origin to the floor
datum. New `surface_area` branches are added at the role gates; the plan-space overlay is
closed to walls so `export_marked_pdf` is unaffected.

**Tech Stack:** TypeScript/JS ES modules under `web/src/lib`; Vitest (`web/test`); React
panel (`web/src/components/TilePanel.jsx`); jsts (existing, via `classifyLayout`).

**Spec:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md` (v2.1,
approved). Code map: `docs/superpowers/research/2026-08-29-wall-tile-slice-a-codemap.md`.

## Global Constraints

- **Reconciliation is two statements, not one** (spec §3.4): (a) **extent identity** —
  `wallStripRing` area `== L×H == area_sf` exactly (geometric); (b) **coverage** — engine
  `keptArea_sf` (tile-face, grout-excluded) within a defined tolerance of
  `area_sf × tileArea/moduleArea`. NEVER assert `keptArea_sf == area_sf`.
- **Wall V origin is datum-anchored, not balanced:** full course at the floor line
  (`origin[1]` pinned to 0), cut at the top; only U (`origin[0]`) is balanced. Do NOT call
  the 2D floor `optimizeOrigin` for a wall.
- **Corner/trim/joint numbers come from the RUN polyline, never the strip rectangle.** For
  `surface_area`, suppress `summarizeShape`'s `cornerTallies(ring_ft)` / `movementJoints({ring_ft})`
  (they'd read the rectangle) and populate `summary.trim`/`summary.joints` from the run.
- **Do NOT change floor behavior, `wall_sf` totals (`totals.js:49`), the plan marked-PDF
  overlay for floors, or a `surface_area` shape on a NON-tile condition.**
- **Slice A is hole-free-wall-accurate.** No opening deductions (M11). Reversing/self-touching
  and unequal-height runs are rejected/out-of-scope with a warning.
- **Overage reuses the existing `TileSetup.purchase` (`breakage_pct`/`attic_pct`) + `orderTiles`
  margin** — do NOT add a new `wall_waste_pct` field. Offcut `reuse` stays OFF for walls
  (conservative). Default a wall condition's `breakage_pct` to 10.
- **Simple runs only:** reject a run with an antiparallel (U-turn) adjacent-edge pair; collapse
  collinear interior vertices before building the strip.
- All new pure logic lands under `web/src/lib/tileWall/`. Tests under `web/test/tileWall/`.
- No AI-attribution trailers in commits (repo pre-commit hook blocks them).

---

## File Structure

**New (pure, unit-tested in isolation):**
- `web/src/lib/tileWall/unwrap.ts` — run geometry: collinear collapse, reversal detection,
  fold positions, inside/outside classification via `face_side`, `wallStripRing`.
- `web/src/lib/tileWall/origin.ts` — `wallEffectiveTileSetup` (U-only balance, V pinned).
- `web/src/lib/tileWall/corners.ts` — run-keyed corner cuts, edge trim, movement joints →
  `summary.trim` / `summary.joints` shapes; wrap vs reset; bullnose/profile/miter.
- `web/src/lib/tileWall/index.ts` — re-exports + the `summarizeWallShape(...)` orchestrator
  that `tileTakeoff.js` calls for `surface_area`.

**Modified:**
- `web/src/lib/tileSetup.ts` — `TileSetup` wall fields + `WallShapeFields` + `mintTileSetup`
  wall defaults.
- `web/src/lib/tileLayoutSig.ts` — signature + `TileLayoutShape` type to include resolved
  height + `measure_role` + wall fields.
- `web/src/lib/tileTakeoff.js` — role gate admits `surface_area`; builds the strip; routes
  to `summarizeWallShape`; cache sig gains height + role + wall fields.
- `web/src/lib/markedset.js` — CLOSE the plan overlay loop to `surface_area`.
- `web/src/lib/tileQA.ts` — admit `surface_area` (role + verts guard) with a wall path.
- `web/src/components/TilePanel.jsx` — elevation-strip preview + wall controls + visible
  inside/outside labels.

**Verify-only (no change expected; asserted by tests):** `web/src/lib/dxf.ts`
(already `role==="floor_area"` gated), `web/src/lib/totals.js`.

---

### Task 1: Run geometry — `tileWall/unwrap.ts`

**Files:**
- Create: `web/src/lib/tileWall/unwrap.ts`
- Test: `web/test/tileWall/unwrap.test.ts`

**Interfaces:**
- Consumes: `openLen` from `../geometry.js`; shape `verts_norm` (normalized tuples), `dims`,
  `upp`, `face_side`.
- Produces:
  ```ts
  export type Fold = { u_ft: number; kind: "inside" | "outside"; vertexIndex: number };
  export type UnwrapResult = {
    L_ft: number;
    strip_ring: [number, number][];   // [[0,0],[L,0],[L,H],[0,H]]
    folds: Fold[];                     // interior corners, in ascending u
    warnings: string[];
  };
  export function wallStripRing(L_ft: number, H_ft: number): [number, number][];
  export function unwrapRun(args: {
    verts_norm: [number, number][]; dims: { w: number; h: number }; upp: number;
    H_ft: number; face_side: "left" | "right";
  }): UnwrapResult | null;   // null on a run that can't be tiled (with a warning surfaced by caller)
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/test/tileWall/unwrap.test.ts
import { describe, it, expect } from "vitest";
import { wallStripRing, unwrapRun } from "../../src/lib/tileWall/unwrap";

const dims = { w: 100, h: 100 }, upp = 0.1; // 1 norm unit = 10 ft; so px*upp handled via dims
// helper: put verts in feet directly by choosing dims/upp so nx*dims.w*upp = feet
// with dims.w=100, upp=0.1 → nx*10 ft. Use nx = ft/10.
const ft = (x: number) => x / 10;

describe("wallStripRing", () => {
  it("is the L×H rectangle with area L*H", () => {
    const r = wallStripRing(18, 8);
    expect(r).toEqual([[0, 0], [18, 0], [18, 8], [0, 8]]);
  });
});

describe("unwrapRun", () => {
  it("single straight wall: L=openLen, no folds", () => {
    const res = unwrapRun({ verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)]], dims, upp, H_ft: 8, face_side: "left" })!;
    expect(res.L_ft).toBeCloseTo(10, 6);
    expect(res.folds).toEqual([]);
    expect(res.strip_ring).toEqual([[0, 0], [10, 0], [10, 8], [0, 8]]);
  });

  it("L-shaped run: one interior fold at the first wall's length, classified by turn+face", () => {
    // wall A 10.5 ft east, then turn 'left' (north) for wall B 7.5 ft
    const res = unwrapRun({
      verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]],
      dims, upp, H_ft: 8, face_side: "left",
    })!;
    expect(res.L_ft).toBeCloseTo(18, 6);
    expect(res.folds.length).toBe(1);
    expect(res.folds[0].u_ft).toBeCloseTo(10.5, 6);
    expect(res.folds[0].vertexIndex).toBe(1);
    expect(["inside", "outside"]).toContain(res.folds[0].kind);
  });

  it("flipping face_side inverts every fold's inside/outside label", () => {
    const run = { verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)], [ft(10), ft(6)]] as [number,number][], dims, upp, H_ft: 8 };
    const left = unwrapRun({ ...run, face_side: "left" })!;
    const right = unwrapRun({ ...run, face_side: "right" })!;
    expect(left.folds[0].kind).not.toBe(right.folds[0].kind);
  });

  it("collapses a collinear interior vertex: no spurious fold", () => {
    const res = unwrapRun({
      verts_norm: [[ft(0), ft(0)], [ft(5), ft(0)], [ft(12), ft(0)]], // straight through at v1
      dims, upp, H_ft: 8, face_side: "left",
    })!;
    expect(res.L_ft).toBeCloseTo(12, 6);
    expect(res.folds).toEqual([]);
  });

  it("rejects a reversing (U-turn) run with a warning, returns null", () => {
    const res = unwrapRun({
      verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)], [ft(2), ft(0)]], // doubles back along the same line
      dims, upp, H_ft: 8, face_side: "left",
    });
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** — `cd web && npx vitest run test/tileWall/unwrap.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `unwrap.ts`**

```ts
// web/src/lib/tileWall/unwrap.ts
import { openLen } from "../geometry.js";

export type Fold = { u_ft: number; kind: "inside" | "outside"; vertexIndex: number };
export type UnwrapResult = {
  L_ft: number; strip_ring: [number, number][]; folds: Fold[]; warnings: string[];
};

const EPS = 1e-6;

export function wallStripRing(L_ft: number, H_ft: number): [number, number][] {
  return [[0, 0], [L_ft, 0], [L_ft, H_ft], [0, H_ft]];
}

// verts in feet: nx*dims.w*upp
function toFeet(verts_norm: [number, number][], dims: { w: number; h: number }, upp: number): [number, number][] {
  return verts_norm.map(([nx, ny]) => [nx * dims.w * upp, ny * dims.h * upp]);
}

// drop consecutive vertices whose incoming/outgoing edges are collinear (cross≈0, same dir)
function collapseCollinear(pts: [number, number][]): { pts: [number, number][]; keptIndex: number[] } {
  if (pts.length <= 2) return { pts, keptIndex: pts.map((_, i) => i) };
  const out: [number, number][] = [pts[0]]; const keptIndex = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const inx = bx - ax, iny = by - ay, outx = cx - bx, outy = cy - by;
    const cross = inx * outy - iny * outx;
    const dot = inx * outx + iny * outy;
    if (Math.abs(cross) < EPS && dot > 0) continue; // straight-through → drop
    out.push(pts[i]); keptIndex.push(i);
  }
  out.push(pts[pts.length - 1]); keptIndex.push(pts.length - 1);
  return { pts: out, keptIndex };
}

export function unwrapRun(args: {
  verts_norm: [number, number][]; dims: { w: number; h: number }; upp: number;
  H_ft: number; face_side: "left" | "right";
}): UnwrapResult | null {
  const { verts_norm, dims, upp, H_ft, face_side } = args;
  if (!Array.isArray(verts_norm) || verts_norm.length < 2) return null;
  const rawFeet = toFeet(verts_norm, dims, upp);
  const { pts, keptIndex } = collapseCollinear(rawFeet);
  const warnings: string[] = [];

  // reversal (U-turn) detection: antiparallel adjacent edges (cross≈0, dot<0)
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const inx = bx - ax, iny = by - ay, outx = cx - bx, outy = cy - by;
    const cross = inx * outy - iny * outx, dot = inx * outx + iny * outy;
    if (Math.abs(cross) < EPS && dot < 0) {
      return null; // caller surfaces "split this reversing run into separate walls"
    }
  }

  const L_ft = openLen(pts) * 1; // pts already in feet
  const folds: Fold[] = [];
  let cum = 0;
  const faceSign = face_side === "left" ? 1 : -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    cum += Math.hypot(bx - ax, by - ay);
    const inx = bx - ax, iny = by - ay, outx = cx - bx, outy = cy - by;
    const cross = inx * outy - iny * outx;
    // face_side decides which turn is "inside" (toward the tiled face).
    // left face (faceSign +1): a left turn (cross>0 in screen y-down) folds toward the face → inside.
    const kind: "inside" | "outside" = (cross * faceSign) > 0 ? "inside" : "outside";
    folds.push({ u_ft: cum, kind, vertexIndex: keptIndex[i] });
  }
  return { L_ft, strip_ring: wallStripRing(L_ft, H_ft), folds, warnings };
}
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run test/tileWall/unwrap.test.ts` → PASS. (If the inside/outside sign convention is inverted vs the flip test, flip `faceSign` mapping — the flip test pins the *relative* correctness.)

- [ ] **Step 5: Commit** — `git add web/src/lib/tileWall/unwrap.ts web/test/tileWall/unwrap.test.ts && git commit -m "feat(tile-wall): run unwrap — folds, inside/outside, collinear collapse, reversal reject"`

---

### Task 2: Wall origin mode — `tileWall/origin.ts`

**Files:**
- Create: `web/src/lib/tileWall/origin.ts`
- Test: `web/test/tileWall/origin.test.ts`

**Interfaces:**
- Consumes: `TileSetup` (`../tileSetup`), `solveTileLayout` (`../tileSolve`), the U-candidate/
  evaluate approach mirrored from `tileGeometry/optimize.ts:121-166` but **U-only**.
- Produces:
  ```ts
  export function wallEffectiveTileSetup(args: {
    tile_setup: TileSetup; strip_ring: [number, number][];
    tile_layout?: { origin?: [number, number]; rotation?: number } | null;
  }): TileSetup;  // origin[1] pinned to 0 (floor datum); origin[0] balanced when edge_strategy==="balanced"
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/test/tileWall/origin.test.ts
import { describe, it, expect } from "vitest";
import { wallEffectiveTileSetup } from "../../src/lib/tileWall/origin";
import { wallStripRing } from "../../src/lib/tileWall/unwrap";

const base = {
  pattern: "grid" as const, origin: [0, 0] as [number, number], rotation_deg: 0,
  edge_strategy: "balanced" as const,
  skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#000" }],
  joint: { width_in: 0.125 },
};

describe("wallEffectiveTileSetup", () => {
  it("pins the vertical origin to the floor datum (origin[1] === 0)", () => {
    const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17, 8) });
    expect(eff.origin[1]).toBe(0);
  });

  it("never balances V: a tall non-integer strip keeps origin[1]=0 (full course at floor)", () => {
    const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17, 8.4) });
    expect(eff.origin[1]).toBe(0); // NOT centered (which would be >0)
  });

  it("still balances U for a non-integer length (origin[0] may shift off 0)", () => {
    const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17.5, 8) });
    expect(eff.origin[1]).toBe(0);
    expect(Number.isFinite(eff.origin[0])).toBe(true);
  });

  it("a pinned tile_layout.origin is honored but V is still floor-pinned", () => {
    const eff = wallEffectiveTileSetup({ tile_setup: base, strip_ring: wallStripRing(17, 8), tile_layout: { origin: [0.3, 0.9] } });
    expect(eff.origin[0]).toBeCloseTo(0.3, 6);
    expect(eff.origin[1]).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement `origin.ts`** — mirror `optimize.ts` U-candidate search but fix `oy=0`:

```ts
// web/src/lib/tileWall/origin.ts
import type { TileSetup } from "../tileSetup";
import { tileConfig } from "../tileSetup";
import { solveTileLayout } from "../tileSolve";

const mod = (a: number, m: number) => ((a % m) + m) % m;
const dedupe = (xs: number[]) => Array.from(new Set(xs.map((x) => Math.round(x * 1e6) / 1e6)));

export function wallEffectiveTileSetup(args: {
  tile_setup: TileSetup; strip_ring: [number, number][];
  tile_layout?: { origin?: [number, number]; rotation?: number } | null;
}): TileSetup {
  const { tile_setup, strip_ring, tile_layout } = args;
  const rotation_deg = tile_layout?.rotation ?? tile_setup.rotation_deg;
  const pinned = tile_layout?.origin;
  if (pinned) return { ...tile_setup, origin: [pinned[0], 0], rotation_deg };
  if (tile_setup.edge_strategy !== "balanced") {
    return { ...tile_setup, origin: [tile_setup.origin[0], 0], rotation_deg };
  }
  const cfg = tileConfig(tile_setup);
  const pitchW = (cfg.w_in + cfg.joint_in) / 12; // ft
  const L = Math.max(...strip_ring.map(([x]) => x));
  const centerU = mod((L % pitchW) / 2, pitchW);
  const uCandidates = dedupe([0, mod(L, pitchW), centerU]);
  let best: { ox: number; score: number } | null = null;
  for (const ox of uCandidates) {
    const { classified } = solveTileLayout({ tile_setup: { ...tile_setup, origin: [ox, 0] }, ring_ft: strip_ring });
    // objective: fewest sub-half end cuts along U (mirrors optimize.ts sliver/balance intent)
    let slivers = 0;
    for (const c of classified) {
      if (c.cls === "cut" && c.cut && c.cut.w_in > 0 && c.cut.w_in < cfg.w_in / 2) slivers++;
    }
    if (!best || slivers < best.score) best = { ox, score: slivers };
  }
  return { ...tile_setup, origin: [best ? best.ox : 0, 0], rotation_deg };
}
```

- [ ] **Step 4: Run tests, verify pass.** (Adjust the objective if a candidate set can't move `origin[0]`; the V-pin assertions are the load-bearing ones.)

- [ ] **Step 5: Commit** — `feat(tile-wall): wall origin mode — U-only balance, V pinned to floor datum`

---

### Task 3: Run-keyed corners, trim, joints — `tileWall/corners.ts`

**Files:**
- Create: `web/src/lib/tileWall/corners.ts`
- Test: `web/test/tileWall/corners.test.ts`

**Interfaces:**
- Consumes: `Fold` (`./unwrap`), `TileSetup`, resolved `H_ft`, `endpoint_exposed`, the field
  `TileLayout` from the strip solve (for course count / straddling-tile detection).
- Produces (shaped to the existing `summary.trim`/`summary.joints` — codemap §3):
  ```ts
  export type WallTrim = { byKind: []; length_lf: number; pieces: number; corner_outside: number; corner_inside: number };
  export type WallJoints = { perimeter_lf: number; field_lf: number; transition_lf: number; total_lf: number; fieldGridSpacing_ft: number };
  export type WallCornerResult = {
    trim: WallTrim; joints: WallJoints;
    extraCornerCuts: number;   // wrap: straddling cuts added to the field order (per course, per inside fold)
    edgePieces: { bullnose_ea: number; profile_lf: number; miter_lf: number };
  };
  export function wallCorners(args: {
    folds: Fold[]; H_ft: number; tile_setup: TileSetup;
    corner_mode: "wrap" | "reset"; edge_finish: "profile" | "bullnose" | "miter";
    endpoint_exposed: [boolean, boolean];
  }): WallCornerResult;
  ```

**Rules (from spec §4.4/§5/§11.4 — encoded as the tests below):**
- `courses = floor(H_ft / moduleH_ft)` where `moduleH_ft = (h_in + joint_in)/12`.
- **Inside fold** → movement joint of length `H_ft` (`joints`); under **wrap**, `courses`
  extra corner cuts (`extraCornerCuts += courses`); under **reset**, no extra cut (each
  sub-strip's own end column already counts it — Task 6).
- **Outside fold** → a finished vertical edge of height `H_ft`, on **each of the 2 faces**:
  - `profile`: `profile_lf += 2*H_ft` (the field square-cuts are counted by the strip solve
    / sub-strip solve, not here).
  - `bullnose`: `bullnose_ea += 2*courses` (SKU swap of the two edge columns; no extra cut).
  - `miter`: `miter_lf += 2*H_ft` (labor).
  - `corner_outside += 1` per outside fold (count).
- **Endpoints** (`u=0`,`u=L`), when `endpoint_exposed[k]`, are treated as an exposed edge
  with the same `edge_finish` on **one** face: `profile_lf += H_ft` (or `bullnose_ea += courses`,
  or `miter_lf += H_ft`).
- `corner_inside += 1` per inside fold. `joints.total_lf = perimeter_lf + field_lf + transition_lf`
  with `field_lf = 0` (walls have no interior expansion grid in Slice A) and
  `perimeter_lf = Σ inside-fold H` (movement joints); `fieldGridSpacing_ft = 0`.

- [ ] **Step 1: Write the failing tests** (concrete numbers; 12"×12" tile, joint 0):

```ts
// web/test/tileWall/corners.test.ts
import { describe, it, expect } from "vitest";
import { wallCorners } from "../../src/lib/tileWall/corners";
const setup = { pattern: "grid", origin: [0,0], rotation_deg: 0, edge_strategy: "balanced",
  skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#000" }], joint: { width_in: 0 } } as any;
const H = 8; // 8 courses of 12"

describe("wallCorners", () => {
  it("wrap + one inside fold: movement joint H, courses extra corner cuts, no edge trim", () => {
    const r = wallCorners({ folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(r.trim.corner_inside).toBe(1);
    expect(r.trim.corner_outside).toBe(0);
    expect(r.joints.total_lf).toBeCloseTo(8, 6);   // one inside joint of height 8
    expect(r.extraCornerCuts).toBe(8);             // 8 courses straddle the fold
    expect(r.edgePieces.profile_lf).toBe(0);
  });

  it("reset + one inside fold: joint H, NO extra corner cut (sub-strips own it)", () => {
    const r = wallCorners({ folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      corner_mode: "reset", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(r.extraCornerCuts).toBe(0);
    expect(r.joints.total_lf).toBeCloseTo(8, 6);
  });

  it("outside fold, profile: 2*H profile LF on the two faces, corner_outside=1", () => {
    const r = wallCorners({ folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(r.edgePieces.profile_lf).toBeCloseTo(16, 6);
    expect(r.trim.corner_outside).toBe(1);
  });

  it("outside fold, bullnose: 2*courses bullnose EA, no profile, no extra field cut", () => {
    const r = wallCorners({ folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      corner_mode: "wrap", edge_finish: "bullnose", endpoint_exposed: [false, false] });
    expect(r.edgePieces.bullnose_ea).toBe(16);
    expect(r.edgePieces.profile_lf).toBe(0);
  });

  it("exposed endpoints add one-face finish each", () => {
    const r = wallCorners({ folds: [], H_ft: H, tile_setup: setup,
      corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [true, true] });
    expect(r.edgePieces.profile_lf).toBeCloseTo(16, 6); // H on each end
  });
});
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement `corners.ts`** per the Rules above (compute `courses`, walk `folds`,
  branch on `kind`/`corner_mode`/`edge_finish`, sum endpoint finishes, assemble the
  `trim`/`joints`/`edgePieces`/`extraCornerCuts`). Keep it pure. Use `tileConfig(tile_setup)`
  for `h_in`/`joint_in`.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `feat(tile-wall): run-keyed corner cuts / trim / movement joints`

---

### Task 4: Data model + cache signature

**Files:**
- Modify: `web/src/lib/tileSetup.ts` (`TileSetup` `:22-40`, `mintTileSetup` `:90-99`)
- Modify: `web/src/lib/tileLayoutSig.ts` (`TileLayoutShape` `:25-29`, `tileLayoutSig` `:65`)
- Test: `web/test/tileWall/dataModel.test.ts`

**Interfaces:**
- Produces (added to `TileSetup`): `wall_corner_mode?: "wrap" | "reset"`;
  `wall_edge_finish?: "profile" | "bullnose" | "miter"`. (Overage reuses existing
  `purchase.breakage_pct`.)
- Produces (new shape-level type, exported from `tileSetup.ts`):
  ```ts
  export type WallShapeFields = {
    face_side?: "left" | "right";
    endpoint_exposed?: [boolean, boolean];
    wall_corner_overrides?: Record<number, { mode?: "wrap" | "reset"; finish?: "profile" | "bullnose" | "miter" }>;
  };
  ```
- Modifies `tileLayoutSig(shape, tile_setup, resolvedHeight_ft?)` — **new 3rd param**; and
  `TileLayoutShape` gains `measure_role?`, `height_ft?`, `height_override?`, plus
  `WallShapeFields`.

- [ ] **Step 1: Write failing tests** — sig changes when height / face_side / corner mode /
  edge finish change; is stable otherwise; a floor shape's sig is unchanged by the new 3rd
  param being `undefined`.

```ts
// web/test/tileWall/dataModel.test.ts
import { describe, it, expect } from "vitest";
import { tileLayoutSig } from "../../src/lib/tileLayoutSig";
import { mintTileSetup } from "../../src/lib/tileSetup";
const ts = mintTileSetup();
const wallShape = { verts_norm: [[0,0],[0.1,0],[0.1,0.1]] as [number,number][], measure_role: "surface_area", face_side: "left" as const };

describe("tileLayoutSig wall-awareness", () => {
  it("changes when resolved height changes", () => {
    expect(tileLayoutSig(wallShape as any, ts, 8)).not.toBe(tileLayoutSig(wallShape as any, ts, 9));
  });
  it("changes when face_side flips", () => {
    expect(tileLayoutSig(wallShape as any, ts, 8)).not.toBe(tileLayoutSig({ ...wallShape, face_side: "right" } as any, ts, 8));
  });
  it("changes when wall_corner_mode changes", () => {
    expect(tileLayoutSig(wallShape as any, ts, 8)).not.toBe(tileLayoutSig(wallShape as any, { ...ts, wall_corner_mode: "reset" }, 8));
  });
  it("floor shape sig stable when the new height param is omitted", () => {
    const floor = { verts_norm: [[0,0],[0.1,0],[0.1,0.1],[0,0.1]] as [number,number][] };
    expect(tileLayoutSig(floor as any, ts)).toBe(tileLayoutSig(floor as any, ts));
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add the fields/types; fold `resolvedHeight_ft`, `shape.measure_role`,
  `shape.face_side`/`endpoint_exposed`/`wall_corner_overrides`, and `tile_setup.wall_corner_mode`/
  `wall_edge_finish` into the `tileLayoutSig` payload; set `mintTileSetup` wall defaults
  (`wall_corner_mode: "wrap"`, `wall_edge_finish: "profile"`, `purchase: { breakage_pct: 10 }`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(tile-wall): TileSetup/shape wall fields + height-aware layout sig`

---

### Task 5: Orchestration (wrap mode) — `summarizeWallShape` + `tileTakeoff.js` wiring

**Files:**
- Create: `web/src/lib/tileWall/index.ts` (`summarizeWallShape`)
- Modify: `web/src/lib/tileTakeoff.js` (role gate `:311`, verts guard `:314`, cache sig `:328-335`,
  ring build + `summarizeShape` call `:336-346`)
- Test: `web/test/tileWall/summarizeWallShape.test.ts`, `web/test/tileWall/takeoff.wall.test.ts`

**Interfaces:**
- Produces: `summarizeWallShape(tile_setup, wallShape, dims, upp, resolvedHeight_ft)` returning
  the SAME `summary` shape `summarizeShape` returns (codemap §3: `{ counts, bySku, grout,
  cutsheet, order, warnings, layout, ring_ft, trim, joints }`) plus `summary.wallStrips`
  (Task 6) — so `byCond` aggregation (codemap §4) consumes it unchanged. In wrap mode it
  solves ONE strip; `summary.trim`/`summary.joints` come from `wallCorners`; `extraCornerCuts`
  is folded into `order` (add to the tile order; reclassify is not required for Slice A —
  conservative). Field solve uses `wallEffectiveTileSetup` (Task 2).

- [ ] **Step 1: Write failing tests** — extent identity + coverage reconciliation; a wall +
  floor on one condition does NOT emit a bogus joint_lf; wrap corner counts match Task 3.

```ts
// web/test/tileWall/summarizeWallShape.test.ts  (illustrative shape; refine to real API)
import { describe, it, expect } from "vitest";
import { summarizeWallShape } from "../../src/lib/tileWall";
import { mintTileSetup } from "../../src/lib/tileSetup";
const dims = { w: 100, h: 100 }, upp = 0.1; const ft = (x:number)=>x/10;
const ts = { ...mintTileSetup(), skus: [{ id:"a", name:"A", w_in:12, h_in:12, color:"#000" }], joint:{width_in:0} };

it("extent identity: strip area == area_sf == L*H", () => {
  const shape = { verts_norm: [[ft(0),ft(0)],[ft(18),ft(0)]], measure_role:"surface_area", face_side:"left" };
  const s = summarizeWallShape(ts as any, shape as any, dims, upp, 8);
  const area = s.ring_ft; // rectangle
  const L = 18, H = 8;
  expect((s as any).extent_sf ?? (L*H)).toBeCloseTo(144, 6); // area_sf = openLen*upp*H = 18*8
});

it("coverage: keptArea_sf ≈ area_sf * tileArea/moduleArea (grout-bounded), NOT == area_sf", () => {
  const shape = { verts_norm: [[ft(0),ft(0)],[ft(18),ft(0)]], measure_role:"surface_area", face_side:"left" };
  const s = summarizeWallShape(ts as any, shape as any, dims, upp, 8);
  // joint 0 → tileArea==moduleArea → keptArea ≈ 144
  expect(s.counts.keptArea_sf).toBeCloseTo(144, 1);
});
```

```ts
// web/test/tileWall/takeoff.wall.test.ts — mixed floor+wall on one condition: no bogus joint_lf
// Build one condition with a floor shape (no trim) + a straight wall shape (no inside folds,
// endpoints not exposed) → joint_lf must be 0, not 2*(L+H).
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3a: Implement `summarizeWallShape`** — unwrap (Task 1; on null, return a summary
  with an empty layout + a warning, excluded from field counts), `wallEffectiveTileSetup`
  (Task 2), `solveTileLayout` on the strip, `tileCounts`/`countsBySku`/`grout`/`cutsheet`/
  `orderTiles` (reuse), `wallCorners` (Task 3) → `summary.trim`/`summary.joints`; add
  `extraCornerCuts` and `edgePieces` into `order`/new order lines.
- [ ] **Step 3b: Wire `tileTakeoff.js`** — at `:311` change the gate to admit both roles:
  `if (s.measure_role !== "floor_area" && s.measure_role !== "surface_area") continue;`
  At `:314` require `>= 2` verts for `surface_area` (keep `>= 3` for floor). Extend the cache
  `sig` (`:328-335`) with `s.measure_role`, the resolved height, and the wall fields. At
  `:336-346`, branch: `surface_area` → resolve height (mirror `shapeMetrics.js:25-27`), call
  `summarizeWallShape(...)`; else the existing floor path. Leave floor untouched.
- [ ] **Step 4: Run, verify pass** + full suite `npx vitest run` green.
- [ ] **Step 5: Commit** — `feat(tile-wall): wall takeoff (wrap) — strip solve + run-keyed trim, height-aware`

---

### Task 6: Reset-per-wall — N sub-strips + `wallStrips[]`

**Files:**
- Modify: `web/src/lib/tileWall/index.ts` (`summarizeWallShape` reset branch)
- Test: `web/test/tileWall/reset.test.ts`

**Interfaces:**
- Consumes: `folds`, `wall_corner_mode` (+ herringbone/diagonal → default reset unless a
  per-corner override forces wrap), `wallEffectiveTileSetup` per sub-strip.
- Produces: `summary.wallStrips: TileLayout[]` (one per sub-strip); `counts`/`bySku`/`order`/
  `cutsheet` are the MERGED tallies across sub-strips; `summary.layout` is the first strip
  (kept non-null for legacy single-`layout` readers, which are all gated off walls by Task 7).

- [ ] **Step 1: Write failing tests** — reset run of two walls (10.5 + 7.5, H 8) yields two
  sub-strips, merged `keptArea_sf ≈ 144`, one summary; each sub-strip balanced with V pinned
  0; `corner_inside == 1`, `extraCornerCuts == 0` (Task 3 rule); a herringbone setup defaults
  to reset even with `wall_corner_mode` unset.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — split the run at each fold into `[u_{k-1}, u_k]` sub-strip rings
  (each a fresh `wallStripRing(segLen, H)`), solve each with `wallEffectiveTileSetup`, merge
  `tileCounts`/`countsBySku`/`order`/`cutsheet`, set `wallStrips`, compute `trim`/`joints`
  once via `wallCorners({corner_mode:"reset"})`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(tile-wall): reset-per-wall sub-strips + wallStrips[]`

---

### Task 7: CLOSE gates — protect the plan overlay / QA / DXF

**Files:**
- Modify: `web/src/lib/markedset.js` (overlay loop `:998-1017`)
- Modify: `web/src/lib/tileQA.ts` (role/verts guards `:87-90`)
- Test: `web/test/tileWall/gates.test.ts`

- [ ] **Step 1: Write failing tests** — a `surface_area` shape with a tile summary is SKIPPED
  by the plan-space overlay (no quads emitted at its plan ring); `dxf.ts` emits no tile grid
  for a wall (already `floor_area`-gated — assert); `tileQA` runs on a wall without throwing
  and returns a warning list (not a silent floor-only skip).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — in `markedset.js:998-1008` add, right after `if (!summary) continue;`,
  a guard `if (s.measure_role === "surface_area") continue;` (walls render in the panel/elevation,
  not the plan overlay). In `tileQA.ts:87-90` admit `surface_area` (role gate) and require
  `>= 2` verts for it; route its `layoutFor`/solve through the wall path or skip QA rules that
  assume a floor ring for Slice A (warn-only). Verify `dxf.ts:219/232` unchanged.
- [ ] **Step 4: Run, verify pass** + assert `export_marked_pdf` snapshot for a floor-only project
  is byte-identical (no regression).
- [ ] **Step 5: Commit** — `fix(tile-wall): keep walls out of the plan-space overlay; admit walls to QA`

---

### Task 8: Panel preview + wall controls — `TilePanel.jsx`

**Files:**
- Modify: `web/src/components/TilePanel.jsx` (`ConditionCard` `:185`, counts block `:274-279`)
- Test: `web/test/tilePanel.wall.test.tsx` (or the repo's existing panel test harness)

- [ ] **Step 1: Write failing tests** — a wall condition renders: a **corner-mode toggle**
  (Wrap / Reset per wall), an **edge-finish** select (profile/bullnose/miter), a **face-side
  flip**, the **visible inside/outside** fold labels, and an **elevation strip** figure; the
  trim/joint LF + corner counts appear in the wall condition's summary line. A floor condition
  is unchanged.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — in `ConditionCard`, when the condition's shapes are `surface_area`,
  render the wall controls (writing `wall_corner_mode`/`wall_edge_finish` via `onTileSetup`,
  and `face_side`/`endpoint_exposed` via `onTileLayout`/shape update) and a small SVG elevation
  strip from `ti.wallStrips ?? [ti.layout]` (reuse the quad→corners math in elevation space —
  do NOT use plan placement); show the inside/outside labels from the run folds; add a
  trim/joint/corner summary line next to the existing counts block `:274-279`.
- [ ] **Step 4: Run, verify pass** + browser smoke per `screenshots-when-driving-ui` memory
  (drive the wall condition, screenshot the panel + elevation strip, attach as evidence).
- [ ] **Step 5: Commit** — `feat(tile-wall): docked elevation-strip preview + corner/finish/face controls`

---

## Self-Review

- **Spec coverage:** §3 unwrap→T1; §3.4 reconciliation→T5; §4.2/§4.4 corner model + origin→T2/T3/T6;
  §5 trim/order→T3/T5; §8 data model + sig→T4; §9 OPEN/CLOSE/ADD→T5/T6/T7; §10 UX→T8; §11
  invariants→tests across T1/T3/T5/T6; §12 Slice A boundary (hole-free, simple runs)→T1/T5.
  Slices B/C (elevation sheet, wrapped view) intentionally excluded.
- **Type consistency:** `summary.trim`/`summary.joints` shapes match codemap §3-4; `wallStrips`
  added in T6 and consumed only where T7 has gated legacy single-`layout` readers off walls;
  `tileLayoutSig` 3rd param threaded T4→T5.
- **No placeholders:** new pure modules carry real code; integration tasks carry exact edit
  anchors + real tests. The intricate corner accounting is pinned by concrete numeric tests
  (Task 3) that ARE the spec for the implementer.
