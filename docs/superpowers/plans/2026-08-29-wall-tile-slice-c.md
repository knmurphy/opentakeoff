# Wall Tile — Slice C (Developed Elevation) Implementation Plan — v2

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Present a wall run's tiled elevation as a proper **developed elevation**: one flat, front-on, true-length **panel per wall**, in plan order, separated by a vertical **break line + inside/outside corner marker**, each panel labeled ("Wall 1", "Wall 2", …). Applied to both the docked panel preview and the generated elevation sheet.

**Why this, not a fold (v1 superseded):** Research (`docs/superpowers/research/2026-08-29-wrapped-elevation-conventions.md`) found **no prior art or drafting source folds walls flat in 2D** — the standard (NKBA Professional Resource Library Ch. 12, kitchen/bath = tiled walls) is separate flat per-wall panels with corner break-lines; continuity is read *across* the break. The v1 true-angle fold (`wallWrapped.ts` + panel toggle, commits `f9d71c0`/`dfe317e`) has zero support and is **removed** by this slice. User decision (Kevin, 2026-08-29): developed-elevation panels.

**Architecture:** A pure layout splits the elevation tiles (from `wallElevationLayout`) into per-wall panels at the fold u-positions, offsetting each panel by a fixed gap, and emits the break-lines + corner markers + panel labels. One layout function feeds BOTH the panel SVG and the sheet PDF (single source of truth). No engine change.

**Spec:** design §6 (developed elevation is the flat true-length representation §6 already describes); research doc above.

## Global Constraints
- **Remove the v1 fold:** delete `web/src/lib/wallWrapped.ts` + `web/test/wallWrapped.test.ts`, the `runTurnAngles` usage, and the unwrapped/wrapped TOGGLE + wrapped-SVG in `TilePanel.jsx`, and the `verts_norm` threading added solely for the fold (keep `verts_norm` on the shape if other code needs it — check). The elevation view becomes simply the developed elevation (no toggle).
- Reuse `wallElevationLayout(wallStrips, folds, skuColor) → { tiles, folds, width_ft, height_ft }` (feet, y-up, floor y=0). Do NOT recompute tiles.
- **Determinism preserved (Slice B):** the sheet generator stays deterministic (`updateMetadata:false`, no Date/random); the developed-panel layout is pure.
- Do NOT change the Slice A engine, floors, the plan overlay, or Slice B's sheet-creation handler/scale/store path (only the DRAWING inside `buildWallElevationPdf`).
- **TEST CONVENTION:** `node:test`+`assert/strict`, FLAT `web/test/*.test.ts`, `.ts` imports. No AI-attribution trailers.

## File Structure
**New:** `web/src/lib/developedElevation.ts` (`developedElevationLayout`), `web/test/developedElevation.test.ts`.
**Removed:** `web/src/lib/wallWrapped.ts`, `web/test/wallWrapped.test.ts`.
**Modified:** `web/src/components/TilePanel.jsx` (developed-elevation SVG replaces the fold toggle), `web/src/pages/TakeoffCanvas.jsx` (drop fold-only threading), `web/src/lib/wallElevationPdf.ts` (draw developed panels).

---

### Task 1: Pure developed-elevation layout — `developedElevation.ts` (+ remove the fold module)

**Files:** Create `web/src/lib/developedElevation.ts`, `web/test/developedElevation.test.ts`; Delete `web/src/lib/wallWrapped.ts` + `web/test/wallWrapped.test.ts`.

**Interfaces:**
```ts
export type DevPanel = { index:number; label:string; xOffset:number; segWidth_ft:number;
  tiles:{x:number;y:number;w:number;h:number;cls:string;color:string}[]; };  // tiles x is PANEL-LOCAL (0..segWidth)
export type DevBreak = { x:number; kind:string };  // x in the laid-out (offset) frame, at each interior corner
export type DevelopedLayout = { panels:DevPanel[]; breaks:DevBreak[]; total_width_ft:number; height_ft:number };
export function developedElevationLayout(args: {
  tiles:{x:number;y:number;w:number;h:number;cls:string;color:string}[];  // from wallElevationLayout (continuous strip, feet)
  foldsU:number[]; foldKinds:string[]; width_ft:number; height_ft:number; gap_ft?:number;   // gap_ft default e.g. 0.5
}): DevelopedLayout;
```
**Algorithm:** segment boundaries `[0,...foldsU,width_ft]`. Panel `i` spans `[B[i],B[i+1]]`, `segWidth = B[i+1]-B[i]`, `xOffset = B[i] + i*gap_ft` (each panel shifted right by an accumulating gap so panels don't touch). Assign each tile to a panel by center-x, and store it PANEL-LOCAL (`x - B[i]`). `label = "Wall "+(i+1)`. `breaks[k]` at the laid-out x of fold k = `foldsU[k] + (k+1)*gap_ft ... ` (the gap center between panel k and k+1) carrying `foldKinds[k]`. `total_width_ft = width_ft + (#panels-1)*gap_ft`. A straight run (no folds) → ONE panel labeled "Wall 1", no breaks, total_width = width_ft.

- [ ] **Step 1: Write failing tests** (1×1 ft tiles):
```ts
// web/test/developedElevation.test.ts
import { test } from "node:test"; import assert from "node:assert/strict";
import { developedElevationLayout } from "../src/lib/developedElevation.ts";
const grid = (cols:number,rows:number)=>{const t=[];for(let c=0;c<cols;c++)for(let r=0;r<rows;r++)t.push({x:c,y:r,w:1,h:1,cls:"full",color:"#000"});return t;};

test("straight run → one panel 'Wall 1', no breaks", () => {
  const d = developedElevationLayout({ tiles: grid(3,2), foldsU:[], foldKinds:[], width_ft:3, height_ft:2 });
  assert.equal(d.panels.length, 1); assert.equal(d.panels[0].label, "Wall 1");
  assert.equal(d.breaks.length, 0); assert.equal(d.panels[0].tiles.length, 6);
});
test("L-run (fold at u=2) → two labeled panels, one break, gap-separated, panel-local x", () => {
  const d = developedElevationLayout({ tiles: grid(4,2), foldsU:[2], foldKinds:["inside"], width_ft:4, height_ft:2, gap_ft:0.5 });
  assert.equal(d.panels.length, 2);
  assert.deepEqual(d.panels.map(p=>p.label), ["Wall 1","Wall 2"]);
  assert.equal(d.breaks.length, 1); assert.equal(d.breaks[0].kind, "inside");
  // panel 2 offset by seg1 width (2) + one gap (0.5)
  assert.ok(Math.abs(d.panels[1].xOffset - 2.5) < 1e-9);
  // panel-local x: panel 2's tiles start at local x 0 (not 2)
  assert.ok(Math.min(...d.panels[1].tiles.map(t=>t.x)) < 1e-9);
  // all tiles preserved
  assert.equal(d.panels[0].tiles.length + d.panels[1].tiles.length, 8);
  assert.ok(Math.abs(d.total_width_ft - 4.5) < 1e-9);
});
```
- [ ] **Step 2: Run, verify fail.** - [ ] **Step 3: Implement `developedElevation.ts`; DELETE `wallWrapped.ts`+its test** (`git rm`). Pure.
- [ ] **Step 4: Run, verify pass** + full `npm test` green (the deleted fold tests drop out). - [ ] **Step 5: Commit** — `feat(tile-wall): developed-elevation layout (per-wall panels + break lines); remove unsupported 2D fold`

---

### Task 2: Panel developed-elevation render (replace the fold toggle)

**Files:** Modify `web/src/components/TilePanel.jsx`, `web/src/pages/TakeoffCanvas.jsx`.

- [ ] **Step 1: Write failing tests** — a pure helper `developedViewBox(layout, margin)` → the SVG viewBox covering all panels' tiles + breaks + label space; test it (union bbox + margin). node:test/flat/.ts.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — in the wall card, REMOVE the unwrapped/wrapped toggle + wrapped SVG + fold imports; render the elevation as `developedElevationLayout(el.tiles, el.folds→foldsU/foldKinds, el.width_ft, el.height_ft)`: per-panel tile polygons (offset by `xOffset`, y-flip as today), a bold vertical break-line at each `break.x` with its `inside`/`outside` label, and each panel's `label` beneath it. Floor/non-wall: unchanged. Drop the `verts_norm` threading that existed only for the fold (verify nothing else uses it).
- [ ] **Step 4: Run, verify pass** + full `npm test` + `tsc`/`eslint` clean. Controller headless-renders the panel developed elevation.
- [ ] **Step 5: Commit** — `feat(tile-wall): panel shows the developed elevation (labeled per-wall panels + corner breaks)`

---

### Task 3: Generated SHEET draws the developed elevation

**Files:** Modify `web/src/lib/wallElevationPdf.ts` (`buildWallElevationPdf`).

- [ ] **Step 1: Write failing tests** — extend `web/test/wallElevationPdf.test.ts`: the generated PDF for an L-run has the two panels gap-separated (assert the returned drawn `width_ft` now = `total_width_ft` = strip width + gaps) and STILL builds deterministically (byte-identical across two builds — the determinism guard must survive the new drawing). Straight run = one panel = width unchanged.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `buildWallElevationPdf` uses `developedElevationLayout` to draw per-wall panels (offset by `xOffset·P`), a break-line + `inside`/`outside` label + panel labels between them, header unchanged. The page width grows to `total_width_ft·P`; `upp` is unchanged (`1/(P·RENDER_SCALE)` — a per-foot constant). Keep `updateMetadata:false` + no Date/random (determinism). Note: the returned `width_ft`/`upp` contract used by Slice B's handler — keep `upp` identical; the page-width change is internal (Slice B's scale row uses `upp`, not width).
- [ ] **Step 4: Run, verify pass** + full `npm test` (incl. Slice B's `wallElevationSheet*` + determinism tests) green + `tsc` clean. Controller headless-renders the sheet.
- [ ] **Step 5: Commit** — `feat(tile-wall): elevation sheet drawn as a developed elevation (per-wall panels + breaks)`

---

## Self-Review
- **Spec/decision coverage:** developed-elevation (Kevin) → T1 (layout) + T2 (panel) + T3 (sheet); the unsupported fold removed in T1/T2.
- **Risk:** Slice B determinism must survive the redraw (T3 determinism test); `upp` contract unchanged (only page width grows). Break placement/labels pinned by T1 tests + controller headless render.
- **No placeholders:** T1 real layout + numeric tests; T2/T3 exact seams (wallElevationLayout, buildWallElevationPdf).
