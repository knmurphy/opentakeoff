# Tile Patterning — Milestones 3–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (fresh implementer per task, task-scoped review, fix loop, final whole-branch review). Steps use checkbox (`- [ ]`) syntax for tracking. Every task is TDD: red test first, then implementation, then green.

**Goal:** Turn the M1/M2 data model + layout engine into a *purchasable takeoff*. M3 wires the solve-bridge (the inch↔foot boundary), figures Safe counts, grout, purchase-unit orders, a cut sheet, and the sliver-avoidance origin optimizer, then surfaces per-condition tile counts through the report seam (`export_report`). M4 adds the edges — trim/bullnose/cove/threshold exposure, trim LF + corner EA, and TCNA EJ171 movement joints.

**Architecture:** Pure ES modules under `web/src/lib/`, headless-tested with `node:test`, mirroring the roll-goods precedent (`rollgoods.js` engine + `rollTakeoff.js` bridge + `rollReportRows` seam). Boolean geometry reuses the already-vendored `jsts` (via the shipped `tileGeometry/classify.ts`) — no new dependency. The report surface follows the **three-seam precedent** (`totals.js` `ctx` + `reportColumns.js` columns + `reportJson` block); M3 lands only seam #3 (the additive `report.v1` block + MCP), M8 lands seams #1/#2 (web Report `ctx` maps + `tile:*`/`laborRom:*` columns).

**Tech Stack:** TypeScript (strict) for new `.ts` engine modules; the report bridge (`tileTakeoff.js`) is JS to match `rollTakeoff.js`/`totals.js`. `node:test` + `tsx` runner. `jsts` (shipped) for geometry. React only at M5.

**Spec:** `docs/TILE_PATTERNING_DESIGN.md` — this plan implements §3.2 (optimize), §3.3 (`tileCalc/` tiles/grout/order/cutsheet), §3.4 (`tileEdges/`), the `calc/borders`+`calc/joints` rows, §4.1 (order refines margin), §4.3 (report seam), §4.4 (MCP staging), and the M3/M4 rows of §5. §2–§5 are authoritative; §7 is a decision log and carries no requirement the body lacks.

## Global Constraints

- **Node ≥ 24.** Tests: `cd web && node --import tsx --test test/<name>.test.ts` (web) / `cd mcp && npm test` (MCP). `cd web && npm run check` is the full gate before any push (typecheck + lint + test + bench + build).
- **Namespace:** `web/src/lib/tiles.ts` already exists (map-tiling LRU, unrelated to tile patterning). The M3 purchase module is `web/src/lib/tileCalc/tiles.ts`; its test is `web/test/tileCalcTiles.test.ts` — never `tiles.test.ts`.
- **Pure engine, no React/DOM.** New modules import and run under bare `node:test`.
- **The mixed-unit boundary is load-bearing (M1/M2 ruling):** pattern generators take `joint`/`w`/`h` in **feet**; `classifyLayout(..., joint_in)` takes **inches** (matching `tileConfig().joint_in`). `tileSolve.ts` (Task 1) is the ONE place that bridges them — convert inches→feet for the generator, pass inches to `classifyLayout`. No other module may re-derive the conversion.
- **Quantities-only, no price.** No dollar/price field. Order quantities are *counts and boxes*, never cost.
- **Order refines, never removes, the margin (§4.1).** The figured Safe count replaces the *pattern-heuristic* `waste_pct` (no double-count), but a residual breakage + attic-stock margin still applies and rounds to whole boxes on one dye lot. Stripping all margin because the count is "exact" is less safe than a real PO.
- **Additive versioning.** `opentakeoff.report.v1` is frozen/additive — a new `tile_goods` block appends after `roll_goods`; never reorder or repurpose existing keys.
- **Reuse, don't reinvent:** grout rides `coverage.js` `groutCoverageSfPerBag`; the bridge mirrors `computeRollTakeoff` (`rollTakeoff.js:105-155`); thresholds reuse `transitions.ts`; the report block mirrors `rollReportRows`/`reportJson`'s `rollGoods` param.
- **MCP mirror duty.** `tileTakeoff.js` imports the same web engine `session.ts` imports (never a re-implementation), exactly as `session.ts:59` imports `rollTakeoff.js`.
- **Do not touch `netlify.toml`.** Branch `feat/tile-patterning` (PR #207). Commit per task; run the gate before push; merge = deploy (human-authorized).

**Additive type additions (M3, guard-safe, all optional):** to support purchase math and grout depth without a new object, extend `web/src/lib/tileSetup.ts`:
- `TileSku` gains optional `thickness_in?: number` (grout depth; default 0.375 = `GROUT_DEFAULTS.tileT`) and `per_box?: number` (tiles per box; order rounding).
- `TileSetup` gains optional `purchase?: { breakage_pct?: number; attic_pct?: number }`.
These are read defensively (missing → sensible default); `hasTileSetup` is unchanged. Land them in Task 5 (their first consumer).

---

## Milestone 3 — Safe count + cut sheet + grout + order/purchase + optimizer (pure)

Deliverable: given a tile condition and a traced room, the engine figures full/cut/corner/hole counts, a Safe purchase count, grout bags, a whole-box order on one dye lot, a per-room cut sheet, and a sliver-avoiding origin — and `export_report` carries per-condition tile counts. No canvas yet (M5).

### Task 1: `tileSolve.ts` — the inch↔foot solve-bridge

**Files:** Create `web/src/lib/tileSolve.ts`; test `web/test/tileSolve.test.ts`.

**Interfaces:**
- Consumes: `tileConfig` (`tileSetup.ts`), `getPattern`/`registry` + `GenInput`/`TileQuad`/`Bounds` (`tilePatterns/index.ts`), `classifyLayout`/`Classified` (`tileGeometry/classify.ts`).
- Produces:
  - `type TileLayout = { config: ReturnType<typeof tileConfig>; bounds: Bounds; quads: TileQuad[]; classified: Classified[] }`
  - `function solveTileLayout(args: { tile_setup: TileSetup; ring_ft: [number,number][]; holes_ft?: [number,number][][] }): TileLayout`

**Logic:**
1. `const cfg = tileConfig(tile_setup)`.
2. Feet at the generator boundary: `const w = cfg.w_in/12, h = cfg.h_in/12, joint = cfg.joint_in/12`.
3. `bounds` = AABB over `ring_ft` (min/max X/Y). Empty/degenerate ring → return `{ config: cfg, bounds, quads: [], classified: [] }`.
4. `const gen = getPattern(cfg.pattern) ?? getPattern("grid")`. `skuId` = the first usable SKU's id (reuse the `tileConfig` primary-SKU selection — expose the chosen SKU id from `tileConfig` OR re-select here with the same predicate; prefer reading `tile_setup.skus.find(usableSku)?.id`).
5. `const quads = gen.generate({ bounds, w, h, joint, origin: cfg.origin, rotation_deg: cfg.rotation_deg, skuId })`.
6. `const classified = classifyLayout(quads, ring_ft, holes_ft ?? [], cfg.joint_in)` — **inches** here, deliberately.

- [ ] **Step 1: failing test** (`web/test/tileSolve.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

// A 4ft × 4ft room, 12×12 tiles, ZERO joint: exactly 16 full tiles, no cuts.
test("solveTileLayout: exact grid fit yields all-full, no cut (joint bridged correctly)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number,number][] = [[0,0],[4,0],[4,4],[0,4]];
  const { quads, classified } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const full = classified.filter((c) => c.cls === "full").length;
  const kept = classified.filter((c) => c.cls !== "out" && c.cls !== "hole");
  assert.equal(full, 16, "16 full 1ft tiles tile a 4ft square exactly");
  assert.equal(kept.every((c) => c.cls === "full"), true, "no cuts on an exact fit");
  assert.ok(quads.length >= 16);
});

// A 3.5ft × 4ft room: the half-foot strip must classify as cuts, not full.
test("solveTileLayout: partial row produces cut pieces (units bridged, not doubled)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const cuts = classified.filter((c) => c.cls === "cut" || c.cls === "corner");
  assert.equal(cuts.length, 4, "one half-tile cut per row (4 rows)");
  // cut width ≈ 6in (the half foot), not 0.5 or 42
  assert.ok(cuts.every((c) => Math.abs((c.cut?.w_in ?? 0) - 6) < 0.5 || Math.abs((c.cut?.h_in ?? 0) - 6) < 0.5));
});

test("solveTileLayout: degenerate ring returns empty, does not throw", () => {
  const ts = mintTileSetup();
  assert.deepEqual(solveTileLayout({ tile_setup: ts, ring_ft: [] }).classified, []);
});
```

- [ ] **Step 2: run → FAIL** (`node --import tsx --test test/tileSolve.test.ts`; module missing).
- [ ] **Step 3: implement** per Logic above. Keep it a thin, pure orchestrator — no geometry math of its own beyond the AABB.
- [ ] **Step 4: run → PASS.**
- [ ] **Step 5: commit** `feat(tile): tileSolve inch↔foot bridge (config→generator→classify)`.

### Task 2: `tileCalc/tiles.ts` — full/cut/corner counts + Safe

**Files:** Create `web/src/lib/tileCalc/tiles.ts`; test `web/test/tileCalcTiles.test.ts`.

**Interfaces:**
- Consumes: `Classified` (`tileGeometry/classify.ts`).
- Produces:
  - `type TileCounts = { full: number; cut: number; corner: number; hole: number; safe: number; keptArea_sf: number }`
  - `function tileCounts(classified: Classified[]): TileCounts` — `safe = full + cut + corner` (one whole tile bought per cut/corner piece — the design §3.3 "Safe = full + one-per-cut"); `hole`/`out` are not purchased; `keptArea_sf = Σ areaKept_sf`.
  - `function countsBySku(classified: Classified[]): Map<string, TileCounts>` — same, grouped by `quad.skuId`.

- [ ] **Step 1: failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileCounts, countsBySku } from "../src/lib/tileCalc/tiles.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("tileCounts: exact fit is all full, safe == full", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[4,0],[4,4],[0,4]] });
  const c = tileCounts(classified);
  assert.equal(c.full, 16); assert.equal(c.cut + c.corner, 0); assert.equal(c.safe, 16);
  assert.ok(Math.abs(c.keptArea_sf - 16) < 1e-6);
});

test("tileCounts: safe buys one whole tile per cut/corner", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const c = tileCounts(classified);
  assert.equal(c.safe, c.full + c.cut + c.corner);
  assert.ok(Math.abs(c.keptArea_sf - 14) < 1e-6, "3.5×4 = 14 sf kept");
});

test("countsBySku: partitions by skuId and sums to the whole", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[4,0],[4,4],[0,4]] });
  const by = countsBySku(classified);
  const total = [...by.values()].reduce((a, c) => a + c.safe, 0);
  assert.equal(total, tileCounts(classified).safe);
});
```

- [ ] Steps 2–4: red → implement (pure reduce over `Classified`) → green.
- [ ] **Step 5: commit** `feat(tile): tileCalc/tiles — full/cut/corner counts + Safe purchase`.

### Task 3: `tileCalc/grout.ts` — grout bags from the layout

**Files:** Create `web/src/lib/tileCalc/grout.ts`; test `web/test/tileCalcGrout.test.ts`.

**Interfaces:**
- Consumes: `groutCoverageSfPerBag`, `GROUT_DEFAULTS` (`coverage.js`); `TileSetup`/`tileConfig` (`tileSetup.ts`); `TileCounts` or the solved layout for kept area.
- Produces:
  - `function tileGroutBags(args: { tile_setup: TileSetup; keptArea_sf: number; bagLbs?: number }): { bags: number; sfPerBag: number; joint_in: number; note: string }`
  - Grout is **derived from tile geometry**, not a lumped SF constant: build the `coverage.js` param object from `tileConfig` — `{ tileL: w_in, tileW: h_in, tileT: primarySku.thickness_in ?? GROUT_DEFAULTS.tileT, joint: joint_in, bagLbs: bagLbs ?? GROUT_DEFAULTS.bagLbs }` — call `groutCoverageSfPerBag(...)`, then `bags = ceil(keptArea_sf / sfPerBag)` (guard sfPerBag ≤ 0 → bags 0). Reuse `coverage.js` `groutNote` for `note`. This is the §3.3 "grout from the layout's joint length (extends `coverage.js`)": the coverage formula's `(L+W)/(L·W)` term IS joint-length-per-SF, so the bags scale with the layout's actual tile/joint geometry, never a flat factor.

- [ ] **Step 1: failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileGroutBags } from "../src/lib/tileCalc/grout.ts";
import { groutCoverageSfPerBag, GROUT_DEFAULTS } from "../src/lib/coverage.js";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("tileGroutBags: derives sf/bag from the tile geometry (matches coverage.js)", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 24; ts.joint.width_in = 0.125;
  const expectSf = groutCoverageSfPerBag({ tileL: 12, tileW: 24, tileT: GROUT_DEFAULTS.tileT, joint: 0.125, bagLbs: GROUT_DEFAULTS.bagLbs });
  const g = tileGroutBags({ tile_setup: ts, keptArea_sf: expectSf * 3 });
  assert.ok(Math.abs(g.sfPerBag - expectSf) < 1e-6);
  assert.equal(g.bags, 3);
});

test("tileGroutBags: smaller tile ⇒ more joint ⇒ fewer sf/bag ⇒ more bags", () => {
  const big = mintTileSetup(); big.skus[0].w_in = 24; big.skus[0].h_in = 24; big.joint.width_in = 0.125;
  const small = mintTileSetup(); small.skus[0].w_in = 2; small.skus[0].h_in = 2; small.joint.width_in = 0.125;
  const b = tileGroutBags({ tile_setup: big, keptArea_sf: 200 });
  const s = tileGroutBags({ tile_setup: small, keptArea_sf: 200 });
  assert.ok(s.bags > b.bags, "mosaic eats far more grout than large format");
});
```

- [ ] Steps 2–4: red → implement → green.
- [ ] **Step 5: commit** `feat(tile): tileCalc/grout — bags from tile geometry via coverage.js`.

### Task 4: `tileGeometry/optimize.ts` — sliver-avoidance origin optimizer

**Files:** Create `web/src/lib/tileGeometry/optimize.ts`; test `web/test/tileOptimize.test.ts`.

**Interfaces:**
- Consumes: `solveTileLayout` (Task 1) or the generator+classify directly; `TileSetup`.
- Produces:
  - `function optimizeOrigin(args: { tile_setup: TileSetup; ring_ft: [number,number][]; holes_ft?: [number,number][][] }): { origin: [number,number]; score: number; slivers: number }`
- **Objective is sliver-avoidance / balance, NOT raw min-cut (§3.2).** Only origin-honoring patterns participate (`grid`, `brick_50`, `brick_33`, `diagonal`); `herringbone`/`basketweave` ignore origin → return `tile_setup.origin` unchanged with `slivers` measured but no search.
- Search (edge-aligned, finite): candidate x-offsets = the set `{ (v.x mod pitchW) }` over room vertices (plus 0), y-offsets likewise over `pitchH`; only these change the cut set. For each `(ox,oy)` candidate, solve and compute:
  - `slivers` = count of cut/corner pieces whose smaller kept dim `< 0.5 ×` the corresponding tile dim (a sub-½ sliver).
  - `balance` = sum over the two axes of `|cutWidth(low wall) − cutWidth(opposite wall)|` (opposing-wall imbalance); approximate by grouping edge-touching cut widths per axis.
  - `score = slivers × 1000 + balance` (slivers dominate; balance breaks ties).
  Return the min-score origin. Deterministic (stable candidate ordering; first-min wins).

- [ ] **Step 1: failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeOrigin } from "../src/lib/tileGeometry/optimize.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

const sliverCount = (classified) => classified.filter((c) => {
  if (c.cls !== "cut" && c.cls !== "corner") return false;
  const wq = c.quad.w * 12, hq = c.quad.h * 12;
  return (c.cut && ((c.cut.w_in > 0.1 && c.cut.w_in < 0.5 * wq) || (c.cut.h_in > 0.1 && c.cut.h_in < 0.5 * hq)));
}).length;

// A 4.25ft-wide room with a starting origin at 0 leaves a 3in sliver strip;
// the optimizer should shift the origin so both edges get a larger cut.
test("optimizeOrigin: reduces sub-½ slivers vs the naive origin-0 layout", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const ring: [number,number][] = [[0,0],[4.25,0],[4.25,4],[0,4]];
  const before = sliverCount(solveTileLayout({ tile_setup: ts, ring_ft: ring }).classified);
  const { origin } = optimizeOrigin({ tile_setup: ts, ring_ft: ring });
  const after = sliverCount(solveTileLayout({ tile_setup: { ...ts, origin }, ring_ft: ring }).classified);
  assert.ok(after <= before);
  assert.ok(after === 0, "a 4.25ft room can be centered to two ~1.6in... balanced half-cuts with no sub-½ sliver band");
});

test("optimizeOrigin: herringbone ignores origin (returns setup origin unchanged)", () => {
  const ts = mintTileSetup(); ts.pattern = "herringbone"; ts.skus[0].w_in = 12; ts.skus[0].h_in = 24; ts.origin = [0.3,0.7];
  const { origin } = optimizeOrigin({ tile_setup: ts, ring_ft: [[0,0],[6,0],[6,6],[0,6]] });
  assert.deepEqual(origin, [0.3,0.7]);
});

test("optimizeOrigin: deterministic (same input → same origin)", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  const ring: [number,number][] = [[0,0],[4.25,0],[4.25,4.1],[0,4.1]];
  assert.deepEqual(optimizeOrigin({ tile_setup: ts, ring_ft: ring }).origin, optimizeOrigin({ tile_setup: ts, ring_ft: ring }).origin);
});
```

> Implementer note: if the exact `after === 0` assertion proves too strong for the naive balance heuristic on this fixture, tighten the heuristic (center-of-room offset is the classic balanced-cut answer) rather than weakening the test — sliver elimination on a symmetric room is the whole point. Coordinate the final fixture in the task-review.

- [ ] Steps 2–4: red → implement → green.
- [ ] **Step 5: commit** `feat(tile): tileGeometry/optimize — edge-aligned sliver-avoidance origin search`.

### Task 5: `tileCalc/order.ts` — purchase units + pattern/material waste

**Files:** Create `web/src/lib/tileCalc/order.ts`; test `web/test/tileCalcOrder.test.ts`. Modify `web/src/lib/tileSetup.ts` (the additive optional fields listed in Global Constraints); append to `web/test/tileSetup.test.ts` a guard test that the new fields are optional and defaulted.

**Interfaces:**
- Produces:
  - `const PATTERN_WASTE: Record<TilePattern, number>` — pattern-heuristic waste fractions: `grid 0.10, brick_50 0.10, brick_33 0.10, diagonal 0.15, herringbone 0.15, basketweave 0.12`.
  - `function materialWasteMultiplier(sku: TileSku): number` — size/material bump: large-format (min dim ≥ 15in OR max dim ≥ 24in) → `1.15`; otherwise `1.0`. (Stone/large-format 15–20%+, §2.D.)
  - `function orderTiles(args: { safeCount: number; sku: TileSku; breakage_pct?: number; attic_pct?: number }): { figured: number; withMargin: number; boxes: number; perBox: number; dyeLots: 1 }`
    - `figured = ceil(safeCount × materialWasteMultiplier(sku))`
    - `withMargin = ceil(figured × (1 + (breakage_pct ?? 0.05)) + figured × (attic_pct ?? 0))`  — breakage default 5%, attic default 0.
    - `perBox = sku.per_box ?? 1`; `boxes = ceil(withMargin / perBox)`; `dyeLots = 1` (one lot; the report states it).
  - **The margin is residual, on top of the figured Safe count (§4.1)** — order.ts NEVER re-applies the condition `waste_pct` (the Safe count already replaced the pattern heuristic). `PATTERN_WASTE` is exported for the *waste_pct display* seam (M8), not multiplied into the order here.

- [ ] **Step 1: failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTiles, materialWasteMultiplier, PATTERN_WASTE } from "../src/lib/tileCalc/order.ts";

const sku = (o = {}) => ({ id: "s", name: "T", w_in: 12, h_in: 12, color: "#000", ...o });

test("orderTiles: breakage margin + whole-box rounding on one dye lot", () => {
  const o = orderTiles({ safeCount: 100, sku: sku({ per_box: 8 }), breakage_pct: 0.05, attic_pct: 0 });
  assert.equal(o.figured, 100);            // 12x12 is not large-format
  assert.equal(o.withMargin, 105);         // +5% breakage
  assert.equal(o.boxes, 14);               // ceil(105/8)
  assert.equal(o.dyeLots, 1);
});

test("orderTiles: attic stock adds on top of breakage", () => {
  const o = orderTiles({ safeCount: 100, sku: sku({ per_box: 10 }), breakage_pct: 0.05, attic_pct: 0.10 });
  assert.equal(o.withMargin, 115);         // ceil(100*1.05 + 100*0.10)
  assert.equal(o.boxes, 12);
});

test("materialWasteMultiplier: large format bumps the figured count", () => {
  assert.equal(materialWasteMultiplier(sku({ w_in: 24, h_in: 48 })), 1.15);
  assert.equal(materialWasteMultiplier(sku()), 1.0);
  const o = orderTiles({ safeCount: 100, sku: sku({ w_in: 24, h_in: 48, per_box: 4 }) });
  assert.equal(o.figured, 115);
});

test("PATTERN_WASTE: diagonal/herringbone carry more heuristic waste than grid", () => {
  assert.ok(PATTERN_WASTE.diagonal > PATTERN_WASTE.grid);
  assert.ok(PATTERN_WASTE.herringbone > PATTERN_WASTE.grid);
});
```

- [ ] Steps 2–4: red → implement (+ the additive `tileSetup.ts` optional fields) → green. Re-run `test/tileSetup.test.ts` to confirm the guard/mint tests still pass.
- [ ] **Step 5: commit** `feat(tile): tileCalc/order — purchase units, breakage/attic margin, material waste`.

### Task 6: `tileCalc/cutsheet.ts` — per-room cut sheet

**Files:** Create `web/src/lib/tileCalc/cutsheet.ts`; test `web/test/tileCalcCutsheet.test.ts`.

**Interfaces:**
- Consumes: `Classified`.
- Produces:
  - `type CutRow = { w_in: number; h_in: number; count: number; lShaped: boolean; corner: boolean }`
  - `function cutSheet(classified: Classified[], opts?: { round_in?: number }): CutRow[]` — group every `cut`/`corner` piece by its rounded cut dims (`round_in` default 0.125 = snap to 1/8″) + `lShaped` + `corner`, count per group, sorted descending by count then size. `full`/`hole`/`out` do not appear. This is the per-room cut sheet; the consolidated-batch and Marked-Set rendering are M8.

- [ ] **Step 1: failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutSheet } from "../src/lib/tileCalc/cutsheet.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("cutSheet: consolidates identical cuts into counted rows", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const rows = cutSheet(classified);
  // 4 identical 6"-wide half cuts (one per row) collapse to a single counted row.
  const half = rows.find((r) => Math.abs(r.w_in - 6) < 0.2 || Math.abs(r.h_in - 6) < 0.2);
  assert.ok(half && half.count === 4);
  assert.equal(rows.some((r) => r.count === 16), false, "full tiles never appear on the cut sheet");
});
```

- [ ] Steps 2–4: red → implement → green.
- [ ] **Step 5: commit** `feat(tile): tileCalc/cutsheet — consolidated per-room cut rows`.

### Task 7: `tileTakeoff.js` — the report bridge (pure)

**Files:** Create `web/src/lib/tileTakeoff.js`; test `web/test/tileTakeoff.test.ts`.

**Interfaces (mirror `rollTakeoff.js` `computeRollTakeoff` + `rollReportRows`, `rollTakeoff.js:86-202`):**
- `hasTileSetup` re-exported for convenience (or import from `tileSetup.ts`).
- `function computeTileTakeoff(conditions, shapes, dimsFor, uppFor)` → `{ byCond: Map<condId, TileSummary>, byShape: Map<shapeId, TileSummary> }`.
  - Only `floor_area` shapes whose condition `hasTileSetup`, on scaled+rendered sheets (`uppFor`/`dimsFor` non-null) — same skip rule as `computeRollTakeoff`. Convert `verts_norm` (+ `verts_norm_holes`) → feet rings via `upp` and bitmap dims (copy the ring-building step from `computeRollTakeoff`).
  - Per shape: `solveTileLayout` → `tileCounts` + `countsBySku` + `tileGroutBags` + `cutSheet` + `orderTiles` (per primary SKU) + `layoutWarning`. `TileSummary = { counts, bySku, grout, order, cutsheet, warnings, keptArea_sf }`.
  - Per condition: aggregate its shapes' summaries (sum counts/area/grout bags/order boxes; concat+re-consolidate cut rows). Respect the condition `multiplier` at the report seam exactly as roll goods does (×N identical units).
- `function tileReportRows(tileByCond, rows)` → additive `report.v1` rows keyed to `conditionTotals` output (`finish_tag`, `multiplier` come from `rows`, never recomputed) — mirror `rollReportRows` (`rollTakeoff.js:163-185`).

- [ ] **Step 1: failing test** — build a one-sheet fixture: a `floor_area` shape with a rectangular `verts_norm`, a `dimsFor`/`uppFor` making it 4ft×4ft, a `CT-1`-style condition carrying a 12×12 `tile_setup`. Assert `computeTileTakeoff(...).byCond.get(condId).counts.full === 16` and `.byShape` keyed by shape id. Assert a condition WITHOUT `tile_setup` produces an empty map (costs nothing, like roll goods). Assert `tileReportRows` echoes `finish_tag`/`multiplier` from the passed rows.
- [ ] Steps 2–4: red → implement → green. Keep it pure JS; no React/DOM.
- [ ] **Step 5: commit** `feat(tile): tileTakeoff.js — per-condition/per-shape figured takeoff bridge`.

### Task 8: `report.v1` `tile_goods` block + MCP `export_report`

**Files:** Modify `web/src/lib/totals.js` (`reportJson` — add an optional `tileGoods` param, appended additively after `rollGoods`); Modify `mcp/src/session.ts` (`exportReport`, `session.ts:3830-3848` — figure `computeTileTakeoff` + pass `tileReportRows`); Modify `mcp/src/outputs.ts` (`exportReportOutput`, add optional `tile_goods` passthrough after `roll_goods`, `outputs.ts:596-666`). Tests: `web/test/totals.test.ts` (append), `mcp/test/session.test.ts` (append).

**Interfaces:**
- `reportJson({ ..., rollGoods, tileGoods })` — `tileGoods` is the `tileReportRows` output; when absent/empty the block is omitted (additive; existing callers unaffected — verify no positional break, it's an options-object field).
- `session.exportReport` figures `computeTileTakeoff(this.conditions, this.shapes, dimsFor, uppFor)` via the existing `rollInputs()` and passes `tileReportRows(byCond, rows)` as `tileGoods`.
- `exportReportOutput.tile_goods` — optional array, `.passthrough()`, described like the `roll_goods` field (`outputs.ts:665`): "the figured tile counts/order per condition, present when a tile condition has floor shapes on scaled sheets."

- [ ] **Step 1: failing test** — MCP: load a plan, set scale, commit a floor shape under a tile condition, `export_report`, assert the returned doc has a `tile_goods` entry with the condition's `safe`/`boxes`/`grout_bags`. Web: `reportJson` passes `tileGoods` through into the `opentakeoff.report.v1` object additively and omits it when empty.
- [ ] Steps 2–4: red → implement → green. Run `cd mcp && npm test` and the `staging.ts` partition test (no new tool added — `export_report` already staged; no `TOOL_STAGES` change).
- [ ] **Step 5: commit** `feat(tile): report.v1 tile_goods block + MCP export_report tile counts`.

### M3 gate

- [ ] `cd web && npm run check` green; `cd mcp && npm test` + `npx tsc --noEmit` green.
- [ ] Reviewer gate: task-scoped reviews already passed per task; run an M3 whole-slice review (fact vs design §3.2/§3.3/§4.1/§4.3/§4.4 + architect for the three-seam-#3 boundary). Proceed only on READY.
- [ ] Commit any doc note; do NOT push mid-milestone (push at Finalize, or per your PR cadence).

---

## Milestone 4 — Perimeter trim + corners + thresholds + bullnose/cove + movement joints (pure)

Deliverable: from a room's edges the engine derives per-side exposure (suggested + confirmed), trim LF + piece counts, inside/outside corner EA, threshold runs (reusing `transitions.ts`), and TCNA EJ171 movement-joint LF. No canvas edge-click UI yet (M5 sets `shape.tile_layout.edge_overrides`); M4 consumes overrides as input.

### Task 9: `tileEdges/` — per-edge exposure model (suggested + confirmed)

**Files:** Create `web/src/lib/tileEdges/expose.ts`; test `web/test/tileEdges.test.ts`.

**Interfaces:**
- Consumes: room ring (feet), the sibling shapes' rings for neighbor proximity, `transitions.ts` (butt/wall proximity helpers — read the file for the exact export), and per-shape `edge_overrides` from `shape.tile_layout`.
- Produces:
  - `type EdgeExposure = { shapeEdgeIndex: number; length_lf: number; exposure: "field" | "trim" | "bullnose" | "cove" | "threshold"; finish_neighbor?: string; suggested: boolean; confirmed: boolean; user_override?: string }`
  - `function edgeExposures(args: { ring_ft: [number,number][]; neighbors?: { finish_tag: string; ring_ft: [number,number][] }[]; overrides?: Record<number, string> }): EdgeExposure[]`
  - **Never auto-committed (§3.4):** every derived exposure is `suggested: true, confirmed: false` unless an `override` sets it (`confirmed: true`). Flood-traced rooms don't share edges, so auto-suggest only on HIGH confidence: an edge coincident with the exterior hull (no neighbor within the `transitions.ts` proximity threshold) suggests `trim`; an edge proximate to a different finish suggests `threshold` with `finish_neighbor`. Everything else stays `field`. `length_lf` is the edge length in feet.

- [ ] **Step 1: failing test** — a standalone rectangular room (no neighbors): all 4 edges suggest `trim`, `suggested:true`, `confirmed:false`. With an `overrides` map `{0:"bullnose"}`: edge 0 is `bullnose`, `confirmed:true`. With a neighbor ring sharing a wall: the coincident edge suggests `threshold` carrying the neighbor's `finish_tag`. Assert `length_lf` matches the geometric edge length.
- [ ] Steps 2–4: red → implement → green. Read `transitions.ts` first; reuse its proximity threshold rather than inventing one.
- [ ] **Step 5: commit** `feat(tile): tileEdges — per-edge exposure (suggested+confirmed), thresholds via transitions.ts`.

### Task 10: `tileCalc/borders.ts` — trim LF + piece count + corner EA

**Files:** Create `web/src/lib/tileCalc/borders.ts`; test `web/test/tileCalcBorders.test.ts`.

**Interfaces:**
- Consumes: `EdgeExposure[]` (Task 9); the room ring (for interior-angle corner classification); a per-exposure trim `piece_lf` (default from the SKU or a passed length; trim pieces are commonly bullnose of the tile's own length).
- Produces:
  - `type TrimTally = { exposure: string; length_lf: number; pieces: number; finish_neighbor?: string }`
  - `function trimTallies(exposures: EdgeExposure[], opts?: { piece_lf?: number }): TrimTally[]` — group confirmed (or suggested-if-`includeSuggested`) non-`field` exposures by kind, sum LF, `pieces = ceil(length_lf / piece_lf)` (§2.E `ceil(len/piece)`; `piece_lf` default e.g. the tile long dim in feet or a 1.0 fallback).
  - `type CornerTally = { outside: number; inside: number }`
  - `function cornerTallies(ring_ft: [number,number][], exposures: EdgeExposure[]): CornerTally` — at each vertex where BOTH adjacent edges are trimmed/bullnose, classify by interior angle: convex (< 180°, exterior turn) → outside corner; reflex (> 180°) → inside corner. Count EA. (§2.E outside/inside corner counts, convex/reflex.)

- [ ] **Step 1: failing test** — a rectangle with all 4 edges `trim` (piece_lf from a 24in tile = 2ft): trim LF = perimeter, pieces = `ceil(perimeter/2)`, corners `{ outside: 4, inside: 0 }`. An L-shaped room (one reflex vertex) with all edges trimmed → `{ outside: 5, inside: 1 }`. A `field`-only room → empty tallies, zero corners.
- [ ] Steps 2–4: red → implement → green.
- [ ] **Step 5: commit** `feat(tile): tileCalc/borders — trim LF, piece counts, inside/outside corner EA`.

### Task 11: `tileCalc/joints.ts` — TCNA EJ171 movement joints

**Files:** Create `web/src/lib/tileCalc/joints.ts`; test `web/test/tileCalcJoints.test.ts`.

**Interfaces:**
- Consumes: room ring (feet); optional material-transition runs (edges bordering a different finish, from Task 9 `finish_neighbor`).
- Produces:
  - `type JointTally = { perimeter_lf: number; field_lf: number; transition_lf: number; total_lf: number; fieldGridSpacing_ft: number }`
  - `function movementJoints(args: { ring_ft: [number,number][]; transitions_lf?: number; spacing_ft?: number }): JointTally` — TCNA EJ171 (§3.3 `joints`):
    - `perimeter_lf` = ring perimeter (soft joint at every restraining wall — the whole perimeter).
    - `field_lf` = a field grid every `spacing_ft` (default 24, the ~20–25ft interior-field rule): over the room AABB, `floor((width−ε)/spacing)` vertical field lines × room height + `floor((height−ε)/spacing)` horizontal × room width, clipped to the ring area (approximate by AABB extents × count — document the approximation; exact ring-clipping of field lines is refinement, not required for the LF estimate).
    - `transition_lf` = `transitions_lf ?? 0` (material-change runs).
    - `total_lf = perimeter + field + transition`; `fieldGridSpacing_ft = spacing`.
  - Derived LF, same shape as trim — a soft-joint quantity, dollar-free.

- [ ] **Step 1: failing test** — a 10ft×10ft room, spacing 24: `perimeter_lf = 40`, `field_lf = 0` (under 24ft, no interior field line), `total_lf = 40`. A 60ft×30ft room, spacing 24: perimeter 180; field lines: 2 vertical (at 24,48) × 30 = 60, 1 horizontal (at 24) × 60 = 60 → field 120; total = 300. `transitions_lf: 12` adds 12 to total. Assert `fieldGridSpacing_ft === 24`.
- [ ] Steps 2–4: red → implement → green.
- [ ] **Step 5: commit** `feat(tile): tileCalc/joints — TCNA EJ171 movement-joint LF (perimeter + field + transitions)`.

### M4 gate

- [ ] `cd web && npm run check` green; `cd mcp && npm test` + typecheck green (M4 is web-only, but run MCP to be safe).
- [ ] Reviewer gate: M4 whole-slice review (fact vs design §3.4 + the `calc/borders`/`calc/joints` rows + estimator on EJ171 correctness and corner convex/reflex classification). Proceed only on READY.

---

## Finalize (M3–M4)

- [ ] **Final whole-branch review** over the M3–M4 commit range (fact/architect/estimator as for M1–M2). Address blocking findings; carry-forward minors recorded in the SDD ledger.
- [ ] `cd web && npm run check` green on the final tree; `cd mcp && npm test` green.
- [ ] **Docs sync** (behavior added that a user/agent sees — the MCP `export_report` now carries `tile_goods`): update `docs/MCP.md` (export_report block description), `mcp/README.md` if it enumerates report fields, and `CHANGELOG.md`. Web `USER_GUIDE.md`/`README.md` tile UI text is deferred to M5/M8 (no canvas surface yet); note that explicitly. Do NOT bump the MCP tool count (no new tool).
- [ ] **Push to PR #207** (add commits to the open branch) or open a follow-up PR per cadence. `cd web && npm run check` green before push. Merge = deploy → human-authorized only.

---

## Sequencing & parallelism

- **Task 1 is the keystone** — every other M3 task consumes `solveTileLayout`. Build it first, alone.
- After Task 1: **Tasks 2, 3, 6 are independent** (counts / grout / cutsheet all read `Classified`) → batchable in parallel. **Task 4 (optimize)** depends only on Task 1 → parallel with 2/3/6. **Task 5 (order)** depends on Task 2's counts conceptually but the function is independent (takes `safeCount`) → parallel, but it also edits `tileSetup.ts`, so serialize it against nothing else that touches that file.
- **Task 7 (bridge)** depends on 2/3/5/6 (aggregates them) → after that batch. **Task 8 (report+MCP)** depends on 7 → last in M3.
- **M4 Task 9** is independent of M3 (reads rings) but should follow M3 so the reviewer gate runs once per milestone. **Tasks 10, 11** depend on 9's `EdgeExposure` (10) / are independent (11 reads rings) → 10 after 9; 11 parallel with 9/10.
- Every parallel batch: implementers **skip the full `npm run check`** (run only their own test file) to avoid blocking each other; the milestone gate runs `check` once. Contracts (types above) are fixed here so siblings don't renegotiate.
