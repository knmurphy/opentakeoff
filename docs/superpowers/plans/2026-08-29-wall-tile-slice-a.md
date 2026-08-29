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

  it("ABSOLUTE label: east→south L-run with face_side left → INSIDE (pins the convention)", () => {
    const res = unwrapRun({ verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]], dims, upp, H_ft: 8, face_side: "left" })!;
    expect(res.folds[0].kind).toBe("inside");   // NOT just left≠right — the literal label
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
    // CONVENTION (settled — do not hand-wave): face_side "left" = the tiled face lies on the
    // (-dy, dx) side of the drawn direction, in the RAW verts_norm coords. For an eastward wall
    // dir=(1,0), that face side is +y. "inside" = the corner turns TOWARD the tiled face.
    // Worked: east→south L-run [0,0]→[10.5,0]→[10.5,7.5], out=(0,+1), cross=+1; face left
    // (faceSign +1) → inside. Flip face_side → faceSign -1 inverts every label.
    const kind: "inside" | "outside" = (cross * faceSign) > 0 ? "inside" : "outside";
    folds.push({ u_ft: cum, kind, vertexIndex: keptIndex[i] });
  }
  return { L_ft, strip_ring: wallStripRing(L_ft, H_ft), folds, warnings };
}
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run test/tileWall/unwrap.test.ts` → PASS. The
  ABSOLUTE label is pinned by the east→south test below (not just the relative flip). The on-SCREEN
  sense of "left" is additionally validated in Task 8's browser smoke against a real traced wall
  (the visible inside/outside labels catch a global inversion) — per the `screenshots-when-driving-ui`
  practice; do NOT silently flip `faceSign` to make a test pass without re-deriving the convention.

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
  // objective (center-and-balance, spec §4.4): primary = fewest sub-½ end cuts; tie-break =
  // most-balanced end remainders (min |leftEnd - rightEnd|). This must NOT default to a full
  // tile hard against one end for a non-integer L (the reviewer's L=17.5 case).
  const endRemainder = (ox: number) => {
    const left = mod(-ox, pitchW);                 // cut width at u=0
    const right = mod(L - (mod(L - ox, pitchW)), 1); // placeholder → compute from classified below
    return { left, right };
  };
  let best: { ox: number; slivers: number; imbalance: number } | null = null;
  for (const ox of uCandidates) {
    const { classified } = solveTileLayout({ tile_setup: { ...tile_setup, origin: [ox, 0] }, ring_ft: strip_ring });
    let slivers = 0, minCutW = cfg.w_in, maxCutW = 0;
    for (const c of classified) {
      if (c.cls === "cut" && c.cut && c.cut.w_in > 0) {
        if (c.cut.w_in < cfg.w_in / 2) slivers++;
        minCutW = Math.min(minCutW, c.cut.w_in); maxCutW = Math.max(maxCutW, c.cut.w_in);
      }
    }
    const imbalance = maxCutW - minCutW; // proxy for end-cut asymmetry
    if (!best || slivers < best.slivers || (slivers === best.slivers && imbalance < best.imbalance)) {
      best = { ox, slivers, imbalance };
    }
  }
  return { ...tile_setup, origin: [best ? best.ox : 0, 0], rotation_deg };
}
```
(Drop the `endRemainder` stub if the classified-based imbalance suffices; it's illustrative of intent.)

- [ ] **Step 4: Run tests, verify pass.** Add a **balance** test: for `L=17.5` (12" tile), the
  chosen `origin[0]` must NOT leave one end a full tile while the other is a sliver — assert the two
  end cuts are within a tile of each other (center-and-balance, §4.4), not merely `origin[0]` finite.
  NOTE on §11.3: `origin[1]=0` seats a full course at the floor datum for **grid/brick** (verified
  `tilePatterns/grid.ts` `startJ=floor((minY-oy)/cell.h)`); for herringbone/basketweave the weave
  merely anchors at v=0 — so the "full course at floor" invariant is asserted for grid, and weave
  patterns assert only v=0 anchoring.

- [ ] **Step 5: Commit** — `feat(tile-wall): wall origin mode — U-only balance, V pinned to floor datum`

---

### Task 3: Run-keyed corners, trim, joints — `tileWall/corners.ts`

**Files:**
- Create: `web/src/lib/tileWall/corners.ts`
- Test: `web/test/tileWall/corners.test.ts`

**Design correction (folds review C1/M1/M2): corner counting is LAYOUT-DRIVEN, not blind, and
emits REAL `byKind` entries.** The earlier draft's `byKind: []` + additive `extraCornerCuts` was
wrong on three counts: (a) `tileTakeoff.js` sets `agg.hasTrim` and accumulates corner/joint totals
ONLY inside `if (summary.trim.byKind.length)` (`:370-385`) and emits only under `hasTrim`
(`:507-522`) — an empty `byKind` silently drops all wall trim/joint/corner numbers; (b) a blind
`extraCornerCuts = courses` over-counts a fold that lands on a tile boundary (0 straddlers); (c)
adding to `order` without reclassifying leaves `counts.corner = 0`, so §11.4 is unpinned and wrap
disagrees with reset. Fix: reclassify the ACTUAL straddling cells from the field layout (phase-aware),
and emit `byKind` entries for edge finishes.

**Interfaces:**
- Consumes: `Fold[]` (`./unwrap`), resolved `H_ft`, `TileSetup`, `endpoint_exposed`, `corner_mode`,
  `edge_finish`, and the field `TileLayout` (`solveTileLayout` result — for phase-aware straddle
  detection over `layout.quads`/`classified`).
- Produces (`byKind` shaped exactly like codemap §3-4 so the existing aggregation fires):
  ```ts
  export type WallTrimKind = { exposure: string; length_lf: number; pieces: number; finish_neighbor: string };
  export type WallTrim = { byKind: WallTrimKind[]; length_lf: number; pieces: number; corner_outside: number; corner_inside: number };
  export type WallJoints = { perimeter_lf: number; field_lf: number; transition_lf: number; total_lf: number; fieldGridSpacing_ft: number };
  export type WallCornerResult = {
    classified: Classified[];  // WRAP: straddlers at inside folds reclassified full→corner (phase-aware). RESET: input passed through.
    trim: WallTrim;            // byKind = edge finishes (outside corners + exposed endpoints); corner_* counts
    joints: WallJoints;        // inside-only: perimeter_lf=0, field_lf=0, total_lf = Σ inside-fold H
  };
  export function wallCorners(args: {
    folds: Fold[]; H_ft: number; tile_setup: TileSetup; layout: TileLayout;
    corner_mode: "wrap" | "reset"; edge_finish: "profile" | "bullnose" | "miter";
    endpoint_exposed: [boolean, boolean];
  }): WallCornerResult;
  ```

**Rules (spec §4.4/§5/§11.4; the numeric tests below are the binding spec):**
- `courses = floor(H_ft / moduleH_ft)`, `moduleH_ft = (h_in + joint_in)/12`; `pitchW = (w_in+joint_in)/12`.
- **WRAP inside fold** at `u_k`: `TileQuad` is CENTER-based `{cx,cy,w,h,rot}` (`tilePatterns/types.ts:7`,
  `classify.ts:104-107`) — there is no `quad.x`. Find the kept cells whose x-span **strictly contains**
  `u_k`: `quad.cx - quad.w/2 < u_k < quad.cx + quad.w/2`. Reclassify each straddler that is `full`
  **or** `cut` → `corner` (a straddler in the top cut course is a `cut` cell that also crosses the
  fold → still a corner; reclassifying only `full` under-counts corner EA by ~1 course at non-integer
  H). Phase-aware: a fold on a tile boundary contains **0** cells → no reclassify, no over-count. This
  makes `counts.corner` correct and keeps `safe`/`order`/`keptArea` unchanged (a wrap corner tile is
  one tile, cut, both pieces used). `corner_inside += 1`; movement joint `total_lf += H_ft`.
- **RESET inside fold:** no reclassification (each sub-strip's own end column is a real `cut` from
  its solve — Task 6). Still `corner_inside += 1` and joint `total_lf += H_ft`.
- **Outside fold** (both modes), 2 faces, `corner_outside += 1`:
  - `profile`: `byKind.push({ exposure:"wall_outside_corner", length_lf: 2*H_ft, pieces: 0, finish_neighbor:"profile" })`
  - `bullnose`: `byKind.push({ exposure:"wall_outside_corner", length_lf: 0, pieces: 2*courses, finish_neighbor:"bullnose" })`
  - `miter`: `byKind.push({ exposure:"wall_outside_corner", length_lf: 2*H_ft, pieces: 0, finish_neighbor:"miter" })` (LF = labor)
- **Exposed endpoint** (`endpoint_exposed[k]`), one face, same finish → a `byKind` entry with
  `length_lf: H_ft` (profile/miter) or `pieces: courses` (bullnose), `exposure:"wall_end"`.
- `trim.length_lf = Σ byKind.length_lf`, `trim.pieces = Σ byKind.pieces`. Joints:
  `perimeter_lf=0, field_lf=0, transition_lf=0, total_lf = (#inside folds)*H_ft, fieldGridSpacing_ft=0`.
- **Bullnose is a SKU swap, NOT an extra piece** (spec §5): it does not add a field cut; the
  `pieces` on the byKind entry ARE the order for those slots.

- [ ] **Step 1: Write the failing tests** (12"×12", joint 0, H=8 → courses=8; build a real `layout`
  via `solveTileLayout` on the strip so straddle detection is exercised):

```ts
// web/test/tileWall/corners.test.ts
import { describe, it, expect } from "vitest";
import { wallCorners } from "../../src/lib/tileWall/corners";
import { wallStripRing } from "../../src/lib/tileWall/unwrap";
import { solveTileLayout } from "../../src/lib/tileSolve";
import { tileCounts } from "../../src/lib/tileCalc/tiles";
const setup = { pattern: "grid", origin: [0,0], rotation_deg: 0, edge_strategy: "start_full",
  skus: [{ id:"a", name:"A", w_in:12, h_in:12, color:"#000" }], joint: { width_in: 0 } } as any;
const H = 8;
const layout18 = solveTileLayout({ tile_setup: setup, ring_ft: wallStripRing(18, H) });

describe("wallCorners", () => {
  it("WRAP mid-tile inside fold (u=10.5): 8 straddlers reclassified full→corner; joint 8 LF", () => {
    const r = wallCorners({ folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      layout: layout18, corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(tileCounts(r.classified).corner).toBe(8);   // pinned as a COUNT (§11.4), phase-aware
    expect(r.trim.corner_inside).toBe(1);
    expect(r.joints.total_lf).toBeCloseTo(8, 6);
    expect(r.trim.byKind.length).toBe(0);              // no outside/endpoint finish here
  });

  it("WRAP boundary inside fold (u=10.0): 0 straddlers (phase-aware, no phantom cuts)", () => {
    const r = wallCorners({ folds: [{ u_ft: 10.0, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      layout: layout18, corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(tileCounts(r.classified).corner).toBe(0);
  });

  it("RESET inside fold: no reclassify, joint 8 LF", () => {
    const r = wallCorners({ folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      layout: layout18, corner_mode: "reset", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(tileCounts(r.classified).corner).toBe(tileCounts(layout18.classified).corner); // unchanged
    expect(r.joints.total_lf).toBeCloseTo(8, 6);
  });

  it("outside fold, profile: a byKind entry of 2*H LF, corner_outside=1 (emits, non-empty byKind)", () => {
    const r = wallCorners({ folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      layout: layout18, corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [false, false] });
    expect(r.trim.byKind.length).toBe(1);
    expect(r.trim.byKind[0].length_lf).toBeCloseTo(16, 6);
    expect(r.trim.corner_outside).toBe(1);
  });

  it("outside fold, bullnose: byKind pieces = 2*courses, length_lf 0, corner_outside=1", () => {
    const r = wallCorners({ folds: [{ u_ft: 10, kind: "outside", vertexIndex: 1 }], H_ft: H, tile_setup: setup,
      layout: layout18, corner_mode: "wrap", edge_finish: "bullnose", endpoint_exposed: [false, false] });
    expect(r.trim.byKind[0].pieces).toBe(16);
    expect(r.trim.byKind[0].length_lf).toBe(0);
  });

  it("exposed endpoints: one byKind entry per exposed end (one face each)", () => {
    const r = wallCorners({ folds: [], H_ft: H, tile_setup: setup, layout: layout18,
      corner_mode: "wrap", edge_finish: "profile", endpoint_exposed: [true, true] });
    expect(r.trim.byKind.reduce((s, k) => s + k.length_lf, 0)).toBeCloseTo(16, 6); // H each end
  });
});
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement `corners.ts`** — `courses` from `tileConfig`; clone `layout.classified`;
  for WRAP inside folds, reclassify straddlers (`quad.cx - quad.w/2 < u_k < quad.cx + quad.w/2`),
  `full`|`cut`→`corner`; walk folds/endpoints to build `byKind` (edge finishes) +
  `corner_inside`/`corner_outside`; build inside-only `joints`. Pure;
  `import type { Classified, TileLayout } from "../tileSolve"` / `../tileGeometry/classify`.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `feat(tile-wall): layout-driven corner reclassify + real byKind trim/joints`

---

### Task 4: Data model + cache signature

**Files:**
- Modify: `web/src/lib/tileSetup.ts` (`TileSetup` `:22-40`, `mintTileSetup` `:90-99`)
- Modify: `web/src/lib/tileLayoutSig.ts` (`TileLayoutShape` `:25-29`, `tileLayoutSig` `:65`)
- Modify: `web/src/pages/TakeoffCanvas.jsx` (`:1318` `tileLayoutSig(s, cond.tile_setup)` — the
  layout-persist/reset caller; for a `surface_area` shape pass the resolved height as the new 3rd
  arg so a wall's persist key isn't height-blind. The param is optional, so floor callers are safe.)
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
- Produces: `summarizeWallShape(tile_setup, wallShape, dims, upp, resolvedHeight_ft)` — returns
  EITHER `{ ok: false, reason }` (unwrappable run: reversal/`<2` verts) so the caller rejects
  BEFORE the shared aggregation loop, OR a complete `summary` of the SAME shape `summarizeShape`
  returns (codemap §3: `{ counts, bySku, grout, cutsheet, order, warnings, layout, ring_ft, trim,
  joints }`) plus `summary.wallStrips: TileLayout[]` and `summary.extent_sf` (= `L*H`). In wrap
  mode it solves ONE strip; `wallCorners` (Task 3) returns the reclassified `classified` (which
  `tileCounts`/`countsBySku` run over) plus `trim`/`joints`. Field solve uses `wallEffectiveTileSetup`
  (Task 2). NO separate `extraCornerCuts` — corner counts come from the reclassified `classified`.

- [ ] **Step 1: Write failing tests** — extent identity computed from code (not hardcoded);
  coverage; a wall+floor on one condition does NOT emit a bogus joint_lf; an inside-only wall DOES
  emit joint_lf; a reversal run is rejected without aborting the takeoff.

```ts
// web/test/tileWall/summarizeWallShape.test.ts
import { describe, it, expect } from "vitest";
import { summarizeWallShape } from "../../src/lib/tileWall";
import { mintTileSetup } from "../../src/lib/tileSetup";
const dims = { w: 100, h: 100 }, upp = 0.1; const ft = (x:number)=>x/10;
const ts = { ...mintTileSetup(), skus: [{ id:"a", name:"A", w_in:12, h_in:12, color:"#000" }], joint:{width_in:0} };

it("extent identity: summary.extent_sf === L*H === area_sf (computed, not hardcoded)", () => {
  const shape = { verts_norm: [[ft(0),ft(0)],[ft(18),ft(0)]], measure_role:"surface_area", face_side:"left" };
  const s = summarizeWallShape(ts as any, shape as any, dims, upp, 8) as any;
  expect(s.ok).not.toBe(false);
  expect(s.extent_sf).toBeCloseTo(18 * 8, 6);          // exercises the code path, not `?? 144`
});

it("coverage: keptArea_sf ≈ area_sf * tileArea/moduleArea, NOT == area_sf; joint 0 → ≈144", () => {
  const shape = { verts_norm: [[ft(0),ft(0)],[ft(18),ft(0)]], measure_role:"surface_area", face_side:"left" };
  const s = summarizeWallShape(ts as any, shape as any, dims, upp, 8) as any;
  expect(s.counts.keptArea_sf).toBeCloseTo(144, 1);
});

it("reversal run → { ok:false }, not a throwing partial summary", () => {
  const shape = { verts_norm: [[ft(0),ft(0)],[ft(10),ft(0)],[ft(2),ft(0)]], measure_role:"surface_area", face_side:"left" };
  const s = summarizeWallShape(ts as any, shape as any, dims, upp, 8) as any;
  expect(s.ok).toBe(false);
});
```

```ts
// web/test/tileWall/takeoff.wall.test.ts — via computeTileTakeoff:
//  (1) one condition, floor shape (no trim) + STRAIGHT wall (no folds, ends not exposed) → joint_lf === 0
//      (NOT 2*(L+H)) and floor counts unchanged.
//  (2) one condition, an L-run wall (one inside fold) → joint_lf > 0 (emits despite empty edge byKind,
//      because the gate is widened to fire on corner_inside).
//  (3) a project with a REVERSAL wall + a floor → floor still computes; the takeoff does NOT throw;
//      the wall is counted in an excluded/warned bucket.
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3a: Implement `summarizeWallShape`** — `unwrapRun` (Task 1); **on `null` return
  `{ ok:false, reason:"reversing_or_degenerate" }`** (do NOT synthesize a partial summary).
  Else: `wallEffectiveTileSetup` (Task 2) → `solveTileLayout` on the strip → `wallCorners` (Task 3,
  wrap) returns reclassified `classified` + `trim` + `joints` → run `tileCounts`/`countsBySku`/
  `grout`/`cutsheet`/`orderTiles` over the RECLASSIFIED `classified` → assemble `summary` with
  `trim`/`joints`/`wallStrips:[layout]`/`extent_sf = L*H`.
- [ ] **Step 3b: Wire `tileTakeoff.js`** —
  - `:311` gate: `if (s.measure_role !== "floor_area" && s.measure_role !== "surface_area") continue;`
  - `:314` guard: for `surface_area` require `>= 2` verts (keep `>= 3` for floor).
  - **REJECT-BEFORE-LOOP (C2):** in the `surface_area` branch, resolve height (mirror
    `shapeMetrics.js:25-27`), call `summarizeWallShape(...)`; if it returns `{ ok:false }`,
    `aggFor(cond).excluded.degenerate++;` + push a warning and `continue` — exactly like the floor
    `:314` degenerate path — so a null summary NEVER enters the shared deref loop (`:349-395`).
  - Extend the cache `sig` (`:328-335`) with `s.measure_role`, resolved height, `s.height_override`,
    and the wall fields.
  - **GATE-WIDEN (C1), floor-safe:** change the accumulation gate at `:370` from
    `if (summary.trim.byKind.length)` to
    `if (summary.trim.byKind.length || summary.trim.corner_inside || summary.trim.corner_outside)`.
    For floors this is a no-op (`cornerTallies` only counts a corner when both adjacent edges are
    trimmed → `byKind` already non-empty). For an inside-only wall it sets `hasTrim` so `agg.joints`
    emits (`:507`). Add the mixed floor+wall test (2) above to prove joints emit for the wall and
    floors are unchanged.
  - Leave the floor path untouched.
- [ ] **Step 4: Run, verify pass** + full suite `npx vitest run` green.
- [ ] **Step 5: Commit** — `feat(tile-wall): wall takeoff (wrap) — reject-before-loop, gate-widen, height-aware`

---

### Task 6: Reset-per-wall — N sub-strips + `wallStrips[]`

**Files:**
- Modify: `web/src/lib/tileWall/index.ts` (`summarizeWallShape` reset branch)
- Test: `web/test/tileWall/reset.test.ts`

**Interfaces:**
- Consumes: `folds`, `wall_corner_mode` (+ herringbone/diagonal → default reset unless a
  per-corner override forces wrap), `wallEffectiveTileSetup` per sub-strip.
- Produces: `summary.wallStrips: TileLayout[]` (one per sub-strip, for rendering);
  `summary.layout.classified` = the **CONCATENATION of ALL sub-strips' `classified`** (M5 — see
  below); `counts`/`bySku`/`order`/`cutsheet` derived from that merged `classified`.

**M5 fix (binding):** `tileTakeoff.js:356` does `agg.classified.push(...summary.layout.classified)`,
and the multi-SKU order split (`:423-424,448`) + reuse (`:485`) read `agg.classified`. If
`summary.layout` were only the first sub-strip, a multi-SKU reset wall would order from a fraction
of its cells. So `summary.layout.classified` MUST be the union of every sub-strip's cells (offset in
u so cells don't collide is unnecessary for counts — they only tally `cls`/dims/`skuId` — but keep
each sub-strip's own quads in `wallStrips` for rendering). Build merged `counts`/`bySku` by running
`tileCounts`/`countsBySku` over the concatenated `classified` (do NOT hand-sum, so it can't drift).

- [ ] **Step 1: Write failing tests** — reset run of two walls (10.5 + 7.5, H 8): `wallStrips.length===2`;
  `summary.layout.classified.length === Σ sub-strip cells`; merged `keptArea_sf ≈ 144`; a **two-SKU**
  reset wall's `countsBySku` covers cells from BOTH sub-strips (not just the first); each sub-strip
  balanced with V pinned 0; `corner_inside === 1`; a herringbone setup defaults to reset even with
  `wall_corner_mode` unset; a per-corner override `{mode:"wrap"}` overrides that default.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — split the run at each fold into `[u_{k-1}, u_k]` sub-strip rings
  (`wallStripRing(segLen, H)`), solve each with `wallEffectiveTileSetup`, set `wallStrips`, set
  `summary.layout.classified = wallStrips.flatMap(w => w.classified)` (+ a representative
  `layout.config`/`bounds`), recompute `counts`/`bySku`/`order`/`cutsheet` over the merged
  `classified`, and `trim`/`joints` via `wallCorners({corner_mode:"reset", layout: mergedLayout})`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(tile-wall): reset-per-wall — merged classified across sub-strips + wallStrips[]`

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
  **Empty-page guard (re-review Minor):** the tile-shop page is created when `tileByShape.size`
  (`markedset.js:925`); a wall-only condition now populates `tileByShape` but its overlay is skipped,
  so the page would render EMPTY. Gate page creation on there being at least one shape that actually
  renders (a `floor_area` tile shape) — do NOT create a tile-shop page for a wall-only set in Slice A
  (elevation sheets are Slice B).
- [ ] **Step 4: Run, verify pass** + assert `export_marked_pdf` snapshot for a floor-only project
  is byte-identical (no regression).
- [ ] **Step 5: Commit** — `fix(tile-wall): keep walls out of the plan-space overlay; admit walls to QA`

---

### Task 8: Panel preview + wall controls — `TilePanel.jsx`

**Files:**
- Modify: `web/src/components/TilePanel.jsx` (`ConditionCard` `:185` counts/controls; `RoomOverride`
  `:347` for the per-shape wall card; `TilePanel` prop list `:442`)
- Modify: `web/src/pages/TakeoffCanvas.jsx` (TilePanel mount ~`:10250-10266`) — thread the selected
  wall shape's per-shape summary to the panel.
- Test: `web/test/tilePanel.wall.test.tsx` (or the repo's existing panel test harness)

**M4 fix (binding):** the elevation strip is PER-SHAPE (`wallStrips` lives on the per-shape
`summary`, and a condition can hold several wall shapes). Do NOT read `ti.wallStrips` — the byCond
`ti` has no `layout`/`wallStrips` (codemap §16 / review M4). `computeTileTakeoff` already returns a
per-shape `byShape` map (used by `markedset.js:924`); TakeoffCanvas passes the **selected shape's**
`byShape` entry to TilePanel as a new `selectedWall` prop (`{ wallStrips, folds, trim, joints }` or
`null`). The elevation strip renders from `selectedWall.wallStrips`.

- [ ] **Step 1: Write failing tests** — for a selected `surface_area` shape the panel renders: a
  **corner-mode toggle** (Wrap / Reset, condition-level via `onTileSetup`), an **edge-finish** select
  (condition-level), a **face-side flip** + **endpoint-exposed** toggles (shape-level via
  `onTileLayout`/shape update), the **visible inside/outside** fold labels, and an **elevation strip**
  drawn from `selectedWall.wallStrips`; the wall condition's summary line shows trim/joint LF + corner
  counts (now non-zero, from the widened-gate emission). A floor condition/shape is unchanged, and the
  panel does NOT throw when `selectedWall` is null.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — (a) TakeoffCanvas: compute/lookup the selected shape's `byShape` entry
  and pass it as `selectedWall`. (b) `ConditionCard`: when the condition is a wall condition
  (`tile_setup.wall_corner_mode` present / shapes are `surface_area`), render the corner-mode +
  edge-finish selects (write via `onTileSetup`) and a trim/joint/corner summary line beside `:274-279`.
  (c) `RoomOverride` (or a sibling wall card): face-side flip + endpoint toggles (shape-level) + the
  SVG **elevation strip** from `selectedWall.wallStrips` (reuse the quad→corners math in elevation
  space — NOT plan placement) + the inside/outside labels from `selectedWall.folds`.
- [ ] **Step 4: Run, verify pass** + browser smoke per `screenshots-when-driving-ui` memory: drive a
  real 2-wall run, screenshot the panel + elevation strip, and **confirm the inside/outside labels
  match the physical corner** (this is where the absolute `face_side` convention from Task 1 is
  validated on-screen); attach the screenshot as evidence.
- [ ] **Step 5: Commit** — `feat(tile-wall): per-shape elevation-strip preview + corner/finish/face controls`

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

## Revision log — adversarial plan review folded (v1 → v2)

Review: `docs/superpowers/research/2026-08-29-wall-tile-plan-review.md` (verdict REVISE, 2 Crit + 5 Maj).
- **C1 (trim/joints/corners silently dropped — `byKind`-empty fails `hasTrim`):** Task 3 now emits
  REAL `byKind` entries for edge finishes; Task 5 **widens the accumulation gate** at
  `tileTakeoff.js:370` to `|| corner_inside || corner_outside` (floor-safe no-op) so an inside-only
  wall's joints/corners emit. Tests: mixed floor+wall joint_lf, inside-only wall emits.
- **C2 (null run aborts the whole takeoff):** `summarizeWallShape` returns `{ ok:false }`; Task 5
  rejects BEFORE the shared loop (`excluded.degenerate++; continue;`), like the floor `:314` path.
  Test: reversal wall + floor → floor still computes, no throw.
- **M1 (phase-blind wrap over-count):** Task 3 reclassifies the ACTUAL straddling cells from the
  field layout, using the CENTER-based quad predicate `quad.cx - quad.w/2 < u_k < quad.cx + quad.w/2`
  (`TileQuad` has `{cx,cy,w,h}`, no `.x` — re-review MAJ-1) — a boundary fold → 0. Tests: u=10.5 → 8,
  u=10.0 → 0.
- **M2 (`counts.corner` stayed 0):** wrap reclassifies `full`→`corner`; counts derive from the
  reclassified `classified` (no blind `extraCornerCuts`). Test: `tileCounts(classified).corner`.
- **M3 (inside/outside absolute unverifiable):** convention pinned (face left = `(-dy,dx)` side),
  wrong comment removed, ABSOLUTE test added (east→south → inside), on-screen sense validated in
  Task 8 browser smoke.
- **M4 (panel read a nonexistent `ti.wallStrips`):** panel reads the selected shape's `byShape`
  entry via a new `selectedWall` prop (per-shape, threaded from TakeoffCanvas).
- **M5 (reset undercounts multi-SKU):** `summary.layout.classified` = concat of ALL sub-strips'
  cells; counts/bySku recomputed over the merge. Test: two-SKU reset covers both sub-strips.
- **Minors:** U objective now center-and-balance (not first-candidate); §11.3 full-course-at-floor
  scoped to grid (weave asserts v=0 anchoring); `tileLayoutSig` persist caller `TakeoffCanvas.jsx:1318`
  added to Task 4; extent test computes from code (`s.extent_sf`) instead of self-passing.
- **Confirmed sound (unchanged):** field-count strip reuse, joint-0 coverage ≈144, reset two-end-cuts,
  `origin[1]=0` seating a full grid course at the floor, markedset/dxf floor gates.

**v2 → v2.1 (re-review `…-plan-review-v2.md`, verdict REVISE 1 Maj + 2 Min — both Criticals + 4/5
Majors confirmed closed):**
- **MAJ-1:** straddle predicate used `quad.x` but `TileQuad` is center-based `{cx,cy,w,h}`
  (`tilePatterns/types.ts:7`). → predicate now `quad.cx - quad.w/2 < u_k < quad.cx + quad.w/2`.
- **Minor (top-course under-count):** reclassify `full` **or** `cut` straddlers (a top cut-course
  straddler is still a corner) → corner EA no longer under-counts ~1 course at non-integer H.
- **Minor (empty wall-only shop page):** Task 7 gates tile-shop page creation on a rendering
  `floor_area` shape existing — no empty page for a wall-only set.
