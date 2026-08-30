# Wall Tile — Slice C (Wrapped View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A 2D "wrapped" view of a wall run: the unwrapped elevation strip **hinged at each corner** by the real plan turn angle, so the wall faces fan apart and you watch the tile pattern turn each corner. A toggle in the wall panel switches unwrapped ↔ wrapped. (User decision, Kevin 2026-08-29: bent/fanned elevation.)

**Architecture:** A pure transform bends the Slice-A/B elevation tiles: split them by segment (between folds), and rotate each segment cumulatively by the plan turn angle at the preceding folds, hinged at the fold's floor point. Reuses `wallElevationLayout`'s tiles + the summary's `folds`; the plan turn angles come from the selected wall shape's `verts_norm`. Rendered as an SVG in the wall panel behind an unwrapped/wrapped toggle. No engine change, no new sheet, no canvas-overlay change (walls stay off the plan overlay — Task 7).

**Tech Stack:** pure TS geometry + `node:test`; the existing `TilePanel.jsx` wall card SVG.

**Spec:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md` §6 (approved — "the same strip folded back at each u_k … 2D fold, not 3D … shows the pattern turning corners").

## Global Constraints
- Reuse, don't recompute, the elevation tiles: `wallElevationLayout(wallStrips, folds, skuColor) → { tiles:[{x,y,w,h,cls,color}], folds:[{x,kind}], width_ft, height_ft }` (feet, y-up, floor at y=0). The wrapped transform consumes THOSE tiles.
- Turn angle at fold `k` = the signed plan turn at the run vertex `folds[k].vertexIndex`, computed from the shape's `verts_norm` (incoming vs outgoing segment direction). A straight run (no folds) → wrapped == unwrapped (identity).
- Do NOT change the Slice A engine, the elevation SHEET (Slice B), floors, or the plan overlay. Panel-only + one new pure module.
- **TEST CONVENTION:** `node:test`+`node:assert/strict`, FLAT `web/test/*.test.ts`, `.ts` imports. No AI-attribution commit trailers.

## File Structure
**New:** `web/src/lib/wallWrapped.ts` (`wallWrappedLayout`), `web/test/wallWrapped.test.ts`.
**Modified:** `web/src/components/TilePanel.jsx` (unwrapped/wrapped toggle + the wrapped SVG in the wall card) + `web/src/pages/TakeoffCanvas.jsx` (thread the run's plan turn angles, or the shape's `verts_norm`, to the panel).

---

### Task 1: Pure bend transform — `wallWrapped.ts`

**Files:** Create `web/src/lib/wallWrapped.ts`; Test `web/test/wallWrapped.test.ts`.

**Interfaces:**
```ts
export type WrappedTile = { pts: [number, number][]; cls: string; color: string }; // rotated rect → 4 corner pts (feet)
export type WrappedLayout = { tiles: WrappedTile[]; hinges: { x: number; y: number; kind: string }[]; bbox: { minX:number;minY:number;maxX:number;maxY:number } };
// elevationTiles: the {x,y,w,h,cls,color} tiles from wallElevationLayout (feet, y-up, floor y=0)
// foldsU: ascending u-positions of the interior corners (feet) = wallElevationLayout folds' x
// turnAngles: signed radians per fold (same order/length as foldsU); + = one turn sense, - the other
export function wallWrappedLayout(args: {
  elevationTiles: { x:number;y:number;w:number;h:number;cls:string;color:string }[];
  width_ft: number; foldsU: number[]; foldKinds: string[]; turnAngles: number[];
}): WrappedLayout;
```
**Algorithm:** segment boundaries `[0, ...foldsU, width_ft]`. For segment `i`, cumulative rotation `θ_i = Σ_{k<i} turnAngles[k]`, hinge origin = the running transform of the fold point `(foldsU[i-1], 0)` (floor line). For each tile, find its segment by its center-x, map its 4 corners through: translate so the segment's start fold is at the local origin, rotate by `θ_i` about that hinge, translate to the accumulated hinge position. A straight run (empty foldsU) → identity (tiles' rects pass through unchanged as 4-corner polys). Output the transformed corner polys + the hinge points (for drawing the fold pivots) + the bbox (for the SVG viewBox).

- [ ] **Step 1: Write failing tests** (12"×12", so tiles are 1×1 ft):

```ts
// web/test/wallWrapped.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wallWrappedLayout } from "../src/lib/wallWrapped.ts";

const grid = (cols:number, rows:number) => {
  const t = []; for (let c=0;c<cols;c++) for (let r=0;r<rows;r++) t.push({ x:c, y:r, w:1, h:1, cls:"full", color:"#000" }); return t;
};

test("straight run (no folds) → identity: each tile maps to its own axis-aligned rect", () => {
  const tiles = grid(3,2);
  const w = wallWrappedLayout({ elevationTiles: tiles, width_ft: 3, foldsU: [], foldKinds: [], turnAngles: [] });
  assert.equal(w.tiles.length, 6);
  // first tile [0,0]-[1,1] stays axis-aligned
  const p = w.tiles[0].pts;
  const xs = p.map(q=>q[0]).sort(), ys = p.map(q=>q[1]).sort();
  assert.ok(Math.abs(xs[0]-0)<1e-9 && Math.abs(xs[3]-1)<1e-9);
  assert.ok(Math.abs(ys[0]-0)<1e-9 && Math.abs(ys[3]-1)<1e-9);
});

test("one 90° fold: tiles AFTER the fold are rotated 90° (a right turn), tiles before are not", () => {
  const tiles = grid(4,2);                       // 4ft wide, fold at u=2
  const w = wallWrappedLayout({ elevationTiles: tiles, width_ft: 4, foldsU: [2], foldKinds:["inside"], turnAngles: [Math.PI/2] });
  const before = w.tiles.find(t => t.pts.every(p=>p[0] <= 2+1e-6));  // a pre-fold tile
  const after  = w.tiles.find(t => t.pts.some(p=>p[1] > 1.5));        // a post-fold tile has grown in Y (rotated up)
  assert.ok(before, "pre-fold tile axis-aligned in x∈[0,2]");
  assert.ok(after, "post-fold tile rotated off the horizontal");
  // total tiles preserved
  assert.equal(w.tiles.length, 8);
  // one hinge at the fold
  assert.equal(w.hinges.length, 1);
});

test("turnAngle sign flips the bend direction", () => {
  const tiles = grid(4,1);
  const up   = wallWrappedLayout({ elevationTiles: tiles, width_ft:4, foldsU:[2], foldKinds:["inside"], turnAngles:[ Math.PI/2] });
  const down = wallWrappedLayout({ elevationTiles: tiles, width_ft:4, foldsU:[2], foldKinds:["inside"], turnAngles:[-Math.PI/2] });
  const yUp   = Math.max(...up.tiles.flatMap(t=>t.pts.map(p=>p[1])));
  const yDown = Math.min(...down.tiles.flatMap(t=>t.pts.map(p=>p[1])));
  assert.ok(yUp > 1.5, "positive angle bends up");
  assert.ok(yDown < -0.5, "negative angle bends down");
});
```

- [ ] **Step 2: Run, verify fail.** - [ ] **Step 3: Implement** the segment-classify + cumulative rotate/hinge transform. Pure; no deps beyond Math.
- [ ] **Step 4: Run, verify pass.** - [ ] **Step 5: Commit** — `feat(tile-wall): wrapped-view bend transform (hinge elevation tiles at corner angles)`

---

### Task 2: Panel wrapped view + toggle

**Files:** Modify `web/src/components/TilePanel.jsx` (wall card) + `web/src/pages/TakeoffCanvas.jsx` (thread the run's plan turn angles/verts to the panel).

**Interfaces:**
- Produce a pure `runTurnAngles(verts_norm, folds)` helper (in `wallWrapped.ts`, tested): for each fold's `vertexIndex`, the signed turn angle between the incoming and outgoing plan-segment directions (from `verts_norm`; the sign convention picked so the on-screen bend matches the physical turn — validated in the browser/headless smoke). A straight run → `[]`.
- TilePanel: an **unwrapped / wrapped** toggle in the wall card; when "wrapped", render an SVG from `wallWrappedLayout(elevationTiles, folds, turnAngles)` (bbox → viewBox; each `WrappedTile.pts` → an SVG `<polygon>` filled with its color; hinge points optionally marked). "unwrapped" keeps the Slice A strip. Floor/non-wall: neither shown.

- [ ] **Step 1: Write failing tests** — `runTurnAngles`: straight run → `[]`; an east→south L-run (verts `[[0,0],[a,0],[a,b]]`, screen y-down) → one angle whose sign bends the second wall the correct way (assert the literal sign + magnitude ≈ π/2). Add a toggle-state helper if useful. node:test/flat/.ts.
- [ ] **Step 2: Run, verify fail.** - [ ] **Step 3: Implement** `runTurnAngles` + the panel toggle + wrapped SVG; thread `verts_norm`/angles from TakeoffCanvas (reuse `selShape`). Keep JSX thin around the tested helpers.
- [ ] **Step 4: Run, verify pass** + full `npm test` green + `tsc`/`eslint` clean. Controller does a headless/browser render check of the wrapped figure (pattern visibly turning the corner).
- [ ] **Step 5: Commit** — `feat(tile-wall): panel wrapped/unwrapped toggle + wrapped elevation render`

---

## Self-Review
- **Spec coverage:** §6 "folded back at each u_k … shows the pattern turning corners" → T1 (bend transform) + T2 (panel toggle + turn-angle derivation). Reuses elevation tiles; no engine/sheet/overlay change.
- **Risk:** the turn-angle SIGN (does the bend go the physically-correct way) — pinned by T1's sign test + T2's `runTurnAngles` literal-sign test + the controller's visual check. Identity for straight runs guards the no-fold case.
- **No placeholders:** T1 carries real geometry + concrete numeric tests; T2 gives the exact helper + render seam.
