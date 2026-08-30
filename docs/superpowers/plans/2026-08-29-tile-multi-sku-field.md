# Origin-aligned patterns + multi-SKU repeat-unit painting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make herringbone/basketweave honor `origin`, then let an estimator paint
a repeat unit with per-position SKUs so a tile field renders and orders in multiple
colors, across all patterns.

**Architecture:** Two slices. Slice 1 injects `origin` as a rigid phase into the
existing herringbone/basketweave generators (no weave rewrite). Slice 2 has each
generator stamp a raw, unit-independent `cell` index on every quad; one shared
floored-modulo `slotKey(cell, unit)` (used by the solve resolver and the paint
panel) maps a quad to a slot → SKU; per-SKU purchase orders roll up at the
condition level over **kept** cells via the existing `countsBySku` util.

**Tech Stack:** TypeScript (strict) for `.ts` engine modules; the report bridge
(`tileTakeoff.js`) is JS. `node --import tsx --test` runner. React (TilePanel).

**Spec:** `docs/superpowers/specs/2026-08-28-tile-multi-sku-field.md` (v5.1). Oracle
+ caveat: `docs/superpowers/research/oracles/`.

> **Plan v3 — PLAN-READY** (2 review rounds + confirmation). v2 folded: `origin` is
> a **tuple** (not `{x,y}`); per-SKU rollups filter to **kept** cells; Task 8 needs
> a downgrade flag; Task 10 folds only `assignment`+slots; identical-size fixtures.
> v3 folded the confirmation pass: `enumerateSlots` omits `p` for arity-1 patterns
> (else painting grid/brick is a silent no-op); kept = `!=="out" && !=="hole"`;
> Task 8 two-variable `reuse_enabled` split (avoids an NPE); `skuById` rebuilt
> locally; Task 10 rationale corrected. **Slice 1 (Tasks 1–3) verified clean and
> independently shippable.**

## Global Constraints

- **`origin` is `[number, number]`** (`tilePatterns/types.ts:11`,
  `tileSetup.ts:17`), destructured `const [ox, oy] = origin` in every generator
  (`grid.ts:22`). NEVER `origin.x`/`{x,y}` — grid destructures unconditionally, so
  an object shape throws "origin is not iterable"; and tsx runs tests without
  type-checking, so an object-shaped test can pass green while production breaks.
  All test snippets pass `origin: [0, 0]` / `const o: [number, number] = [...]`.
- **`effectiveTileSetup`/`solveTileLayout` (tileSolve.ts) is the SOLE layout
  resolver.** Read `computeTileTakeoff`'s `byShape.get(id).layout`.
- **Purchase figured ONCE per condition** (`tileTakeoff.js` ~:396). Per-SKU orders
  are per-condition. **`summary.bySku` already exists per-SHAPE
  (`tileTakeoff.js:169`) — NEVER sum it per-shape**; the condition rollup
  recomputes over `agg.classified`.
- **Per-SKU rollups filter to KEPT cells** (`c.cls ∈ full|cut|corner`). Task 5
  stamps `skuId` on *all* generated quads including the out-of-room padding ring
  (`grid.ts:24` pads to `i=-1`); raw `countsBySku` would bucket colors with zero
  kept tiles, corrupting per-SKU orders, `by_sku`, and the reuse predicate.
- **Every multi-SKU test fixture uses IDENTICAL `w_in`/`h_in`**, differing only in
  `id`/`color`/`per_box`. Task 9 ignores a mismatched-size assignment, so a
  differing-size fixture would retroactively fail Tasks 5–8.
- **Mixed-unit boundary:** generators/rings FEET; `classifyLayout` joint INCHES;
  `tileSolve.solveTileLayout` is the SOLE conversion site.
- **`jsts` (vendored) for boolean geometry.** **Lint:** `ts-no-any`,
  `ts-no-return-type`, `ts-no-tiny-functions`, `ts-set-map`.
- **WORKTREE WRITE QUIRK:** use worktree-absolute paths for NEW files; `git status`
  in BOTH `/Users/knmurphy/Documents/PROJECTS/opentakeoff` and the worktree.
- **Tests:** `cd web && node --import tsx --test test/<name>.test.ts`. Gate:
  `cd web && npm run check` + `cd mcp && npm test` + `cd mcp && npx tsc --noEmit`.
- **Additive / back-compat:** absent `assignment` ⇒ byte-identical solve, report,
  exports.

### Pinned identities (spec §10 — resolved from the generators)

- **Herringbone:** cell `i=ci` (col), `j=bi` (band); plank `p∈0..3` = push order
  (`0` leading-V, `1` upper-H, `2` lower-H, `3` trailing-V). Visual band = `j`.
- **Basketweave:** `i,j` = block indices; plank `p∈0..1` = push order. No
  cross-block canonicalization (`orientation=(i+j)%2`; `(i%w,j%h)` separates
  H/V-blocks).
- **Uniform (grid/brick_50/brick_33/diagonal):** `i=col`, `j=row`, no `p`; diagonal
  keys in the pre-rotation grid frame.
- **Plank-arity is one shared constant** (avoid a second source of truth vs. the
  generators' push counts):
  ```ts
  // slotKey.ts
  export const PLANK_ARITY: Record<string, number> = {
    grid: 1, brick_50: 1, brick_33: 1, diagonal: 1, herringbone: 4, basketweave: 2,
  };
  ```

### Shared slot key (single source of truth: generator emission, resolver, panel)

```ts
// web/src/lib/tilePatterns/slotKey.ts
export type TileCell = { i: number; j: number; p?: number };
const fmod = (n: number, m: number) => ((n % m) + m) % m; // floored; raw % mis-keys negatives
export function slotKey(cell: TileCell, unit: { w: number; h: number }): string {
  const base = `${fmod(cell.i, unit.w)}_${fmod(cell.j, unit.h)}`;
  return cell.p == null ? base : `${base}_${cell.p}`;
}
```

---

## SLICE 1 — Origin-honoring (herringbone & basketweave)

### Task 1: Herringbone honors `origin`

**Files:** Modify `web/src/lib/tilePatterns/herringbone.ts` (range/anchor block) +
`web/src/lib/tileGeometry/optimize.ts:12-14` (comment only). Test:
`web/test/tilePatterns.test.ts` (append).

**Interfaces:** Consumes `GenInput { origin: [number,number], ... }`. Produces
herringbone translated rigidly by `origin`; byte-identical at `[0,0]`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { herringboneGenerator } from "../src/lib/tilePatterns/herringbone.ts";

const HB = { w_ft: 2, h_ft: 1, joint_ft: 0, rotation_deg: 0, skuId: "s" };
const key = (x: number, y: number, r: number) => `${x.toFixed(4)}_${y.toFixed(4)}_${r.toFixed(4)}`;

test("herringbone translates rigidly by origin", () => {
  const bounds = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const o: [number, number] = [0.37, 0.81];
  const q0 = herringboneGenerator.generate({ ...HB, origin: [0, 0], bounds });
  const qo = herringboneGenerator.generate({ ...HB, origin: o, bounds });
  const set = new Set(qo.map((t) => key(t.cx, t.cy, t.rot)));
  const inWin = q0.filter((t) => t.cx + o[0] > -10 && t.cx + o[0] < 10 && t.cy + o[1] > -10 && t.cy + o[1] < 10);
  assert.ok(inWin.length > 0);
  for (const t of inWin) assert.ok(set.has(key(t.cx + o[0], t.cy + o[1], t.rot)), "shifted plank missing");
});
```

- [ ] **Step 2: Run — FAIL** (origin ignored today).
  `cd web && node --import tsx --test test/tilePatterns.test.ts`

- [ ] **Step 3: Implement — inject origin as a phase (tuple form)**

```ts
const [ox, oy] = origin;
const loX = bounds.minX - pad, hiX = bounds.maxX + pad;
const loY = bounds.minY - pad, hiY = bounds.maxY + pad;
const bandStart = Math.floor((loY - oy) / bandH) - 1;
const bandEnd = Math.ceil((hiY - oy) / bandH) + 1;
for (let bi = bandStart; bi <= bandEnd; bi++) {
  const bandY0 = bi * bandH + oy;
  const shift = (((bi % 2) + 2) % 2) === 1 ? periodX / 2 : 0;
  const colStart = Math.floor((loX - ox - shift) / periodX) - 1;
  const colEnd = Math.ceil((hiX - ox - shift) / periodX) + 1;
  for (let ci = colStart; ci <= colEnd; ci++) {
    const x0 = ci * periodX + shift + ox;
    // ...unchanged plank pushes using x0, bandY0...
  }
}
```
Plank offsets, sort, and rotation tail unchanged. Update `optimize.ts:12-14`
comment: these now honor `origin` for phase; the optimizer does not yet *choose*
one for them.

- [ ] **Step 4: Run — PASS.** Then `cd web && npm run check` (tuple types compile).

- [ ] **Step 5: Commit** `feat(tile): herringbone honors origin (rigid phase)`.

### Task 2: Basketweave honors `origin`

**Files:** Modify `web/src/lib/tilePatterns/basketweave.ts`. Test append.

- [ ] **Step 1:** Failing test, `basketweaveGenerator`, `HB`-shaped, `origin: [0.4, 0.9]`, same rigid-translation assertion (tuple form).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement:
```ts
const [ox, oy] = origin;
const startI = Math.floor((bounds.minX - ox) / block) - 1;
const endI = Math.ceil((bounds.maxX - ox) / block) + 1;
const startJ = Math.floor((bounds.minY - oy) / block) - 1;
const endJ = Math.ceil((bounds.maxY - oy) / block) + 1;
// ...
const bx = (i + 0.5) * block + ox, by = (j + 0.5) * block + oy;
```
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `feat(tile): basketweave honors origin (rigid phase)`.

### Task 3: Per-room origin override reaches these patterns (integration test)

**Files:** Test only — `web/test/tileTakeoff.test.ts` (append).

- [ ] **Step 1:** herringbone `tile_setup` + one floor shape with
  `tile_layout.origin = [1, 1]`; assert its solved `layout.quads` centers differ
  from no-override by exactly (1,1) on overlapping planks. (Path verified:
  `effectiveTileSetup` pins `tile_layout.origin` at `optimize.ts:188-191` →
  `tileConfig.origin` → `generate`.)
- [ ] **Step 2:** Run — FAIL before Tasks 1–2, PASS after.
- [ ] **Step 3:** Commit `test(tile): per-room origin moves herringbone`.

> **Slice 1 ships here** — independently valuable and mergeable.

---

## SLICE 2 — Multi-SKU repeat-unit painting

### Task 4: `TileCell` on quads + shared `slotKey`/`PLANK_ARITY`; generators emit `cell`

**Files:** Create `web/src/lib/tilePatterns/slotKey.ts`; Modify `types.ts:3`
(`TileQuad` gains `cell?: TileCell`), `grid.ts`, `offset.ts`, `diagonal.ts`,
`herringbone.ts`, `basketweave.ts`. Test `web/test/slotKey.test.ts`, `tilePatterns.test.ts`.

- [ ] **Step 1: Write failing tests**
```ts
// slotKey.test.ts
import { slotKey } from "../src/lib/tilePatterns/slotKey.ts";
test("floored modulo keys negatives", () => {
  assert.equal(slotKey({ i: -1, j: 0 }, { w: 2, h: 2 }), "1_0");
  assert.equal(slotKey({ i: 3, j: -2, p: 2 }, { w: 2, h: 2 }), "1_0_2");
});
// tilePatterns.test.ts
test("grid quads carry cell {i,j}", () => {
  const q = gridGenerator.generate({ ...HB, origin: [0, 0], bounds: { minX:0,minY:0,maxX:10,maxY:10 } });
  assert.ok(q.every((t) => t.cell && Number.isInteger(t.cell.i)));
});
test("herringbone emits four p roles per cell = PLANK_ARITY", () => {
  const q = herringboneGenerator.generate({ ...HB, origin: [0, 0], bounds: { minX:0,minY:0,maxX:10,maxY:10 } });
  assert.deepEqual([...new Set(q.map((t) => t.cell?.p))].sort(), [0, 1, 2, 3]);
  assert.equal(new Set(q.map((t) => t.cell?.p)).size, PLANK_ARITY.herringbone); // keep the constant honest
});
// Add the same size===PLANK_ARITY[pattern] assertion for basketweave (2) and grid (1, p undefined).
```
- [ ] **Step 2:** Run — FAIL (`cell` undefined).
- [ ] **Step 3:** Add `cell?: TileCell` to `TileQuad`. Stamp at each push: grid/offset
  `{ i: col, j: row }`; diagonal via delegated grid (rides `rotateQuadsAboutOrigin`'s
  `{...q}`, `pattern.ts:24`); herringbone `{ i: ci, j: bi, p }` with `p=0,1,2,3` **before**
  `out.sort` (rides by reference); basketweave `{ i, j, p: 0|1 }`.
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `feat(tile): quads carry raw cell index + shared slotKey/PLANK_ARITY`.

### Task 5: Resolver — per-quad SKU from the assignment

**Files:** Modify `tileSetup.ts` (`TileAssignment`; `assignedSkuId`), `tileSolve.ts`
(the `:55` collapse → per-quad). Test `web/test/tileSolve.test.ts`.

**Interfaces:** `assignedSkuId(tile_setup, cell?): Id` — `slots[slotKey(cell, unit)]`
if it resolves to a live SKU, else the full chain
`primaryUsableSku(...)?.id ?? skus?.[0]?.id ?? "sku"`. `cell`/`assignment` absent ⇒ default.

- [ ] **Step 1:** Failing test — grid `assignment {mode:"repeat",unit:{w:2,h:2},slots:{"0_0":"A","1_0":"B","0_1":"B","1_1":"A"}}`
  with A,B **same size**; assert each solved quad's `skuId === slots[slotKey(quad.cell,unit)]`
  at a **named `(i,j)`** (assert `(0,0)`→A, `(1,0)`→B specifically — not a ratio); a
  slot → deleted id falls to the default (not `#888`); absent assignment ⇒ every
  `skuId` = today's primary (byte-identical).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Add `TileAssignment` + `assignedSkuId`. In `tileSolve.ts` after
  generation, set each `quad.skuId = assignedSkuId(tile_setup, quad.cell)` (mutation
  on freshly-generated quads before the cache write at `tileTakeoff.js:330` — safe).
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `feat(tile): assignment resolver stamps per-quad skuId`.

### Task 6: Per-SKU purchase order (condition-level, KEPT cells)

**Files:** Modify `tileTakeoff.js` (`byCond` finalize ~:396-425). Test `tileTakeoff.test.ts`.

**Interfaces:** `countsBySku(classified)` (`tileCalc/tiles.ts:52`) → `Map<skuId, TileCounts>`;
`skuById` map already at `tileTakeoff.js:68`.

- [ ] **Step 1:** Failing test — a 2×2 A/B checkerboard (A,B same size, different
  `per_box`) over a known room; assert **two** order rows keyed by A and B, each
  whole-box; condition `boxes` = the sum; and a **single-color-in-room** field (a
  1×1 assignment, or a 2×1 where only A lands in-room) yields **one** row
  (proves the kept-cell filter). Single-SKU condition ⇒ byte-identical to today.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** In the finalize loop beside `agg.order` (`:396-401`):
  ```js
  const kept = agg.classified.filter((c) => c.cls !== "out" && c.cls !== "hole"); // = full|cut|corner
  const keptBySku = countsBySku(kept); // do NOT mutate agg.classified (deleted at :451)
  const skuById = new Map((agg.tile_setup.skus || []).map((s) => [s.id, s])); // rebuild — the :68 map is local to reusePlanForCondition
  ```
  For each bucket resolve `skuById.get(id) ?? primaryUsableSku(agg.tile_setup)` and
  run one `orderTiles({ safeCount: counts.safe, sku })`; store `agg.orderBySku`; set
  scalar `agg.order` fields to the sums. When `keptBySku.size === 1`, keep today's
  single `agg.order` path (byte-identical).
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `feat(tile): per-SKU purchase order (kept cells, condition-level)`.

### Task 7: `tile_goods` `by_sku[]` report rows

**Files:** Modify `tileTakeoff.js` (`tileReportRows` :495-529), `mcp/src/outputs.ts:632`
(zod, strict — add optional `by_sku`). `totals.js:593` passes through opaquely (no change).
Test `web/test/totals.test.ts`, `mcp/test/session.test.ts`.

- [ ] **Step 1:** Failing test — a mixed (≥2 kept SKU, same size) condition emits
  `tile_goods[...].by_sku = [{sku_id,name,color,safe,boxes,figured,with_margin}]`,
  scalars = sums; single-SKU/absent export byte-identical (no `by_sku`).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Emit `by_sku` from `agg.orderBySku` when >1 kept bucket; extend the
  zod object with an optional `by_sku` array.
- [ ] **Step 4:** Run — PASS. `cd web && npm run check` + `cd mcp && npm test && npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(tile): tile_goods per-SKU by_sku rows`.

### Task 8: Reuse guarded off on a mixed field (with an honest downgrade flag)

**Files:** Modify `tileTakeoff.js` (:181/:408 gates; a new `agg.reuseDowngradedMulti`
threaded into the report row at :494/:509-513). Test `tileTakeoff.test.ts`.

- [ ] **Step 1:** Failing test — a condition whose **kept** field has ≥2 distinct
  SKUs + `reuse.enabled`: assert reuse is skipped, order ignores reuse, and the
  report row reads `reuse_enabled:true` + `reuse_downgraded:"multi-color field"`.
  A stale 1-kept-SKU assignment + reuse ⇒ reuse figures normally.
- [ ] **Step 2:** Run — FAIL (skipping reuse today makes `reuse_enabled` read false at :494).
- [ ] **Step 3:** Compute
  `const multiColor = new Set(agg.classified.filter(c=>c.cls!=="out"&&c.cls!=="hole").map(c=>c.quad.skuId)).size >= 2`
  (kept cells only — same filter as Task 6, so a hole-only second SKU can't falsely
  trip it). When `multiColor`, skip the reuse computation at both `:181`/`:408`
  gates and set `agg.reuseDowngradedMulti = true`. In `tileReportRows`, use a
  **two-variable split** to avoid an NPE — the existing figures at `:510-513` must
  stay gated on the real objects:
  ```js
  const reuseFigured = Boolean(ti.reuse && ti.reuseOrder);      // gates :510-512 real figures
  const reuse_enabled = reuseFigured || ti.reuseDowngradedMulti; // reported flag
  const reuse_downgraded = ti.reuseDowngradedMulti ? "multi-color field" : (ti.reuse?.downgraded); // never read ti.reuse.downgraded unconditionally
  ```
  (Flipping only `:494` and letting `:510-513` read `ti.reuseOrder.figured` /
  `ti.reuse.downgraded` would TypeError in the downgrade case.)
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `feat(tile): guard offcut reuse off on a multi-color field`.

### Task 9: Same-size enforcement + `TileLayout.warnings`

**Files:** Modify `tileSolve.ts` (`TileLayout` gains `warnings`; the check at
**both** return literals `:46` and `:65`), `tileTakeoff.js` (:134/:178 merge). Test `tileSolve.test.ts`.

- [ ] **Step 1:** Failing test — a `tile_setup` whose one assigned SKU is
  `w_in/h_in` ≠ the `tileConfig` default size (both compared **clamped**, unordered
  `{min,max}`): assert the solve **ignores** the assignment (every `skuId` =
  primary), `layout.warnings` has an entry, **no throw**.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Add `warnings: string[]` to `TileLayout`; populate `[]` at **both**
  literal returns (`:46`, `:65`). Before applying the assignment (Task 5 site),
  compute the field size from `tileConfig` (clamped) and compare each assigned
  SKU's clamped `{min,max}`; on mismatch, skip the assignment (leave the default
  `skuId`) and push a warning. Merge `layout.warnings` into `summarizeShape`'s
  warnings (`:134` init, `:178` assembled). Never throw (solve runs in a `useMemo`).
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `feat(tile): reject mixed-size assignment (warn, single-primary)`.

### Task 10: `tileLayoutSig` — comment fix + fold `assignment`

**Files:** Modify `tileLayoutSig.ts` (:52-53 comment; the `tile_setup` block, using
the existing `edge_overrides` sort idiom at :66-69). Test `tileLayoutSig.test.ts`.

> Scope: fold **only** `assignment` (mode/unit + sorted slots). Rationale (precise):
> `tileOverlaySig` is built from `tileLayoutSig` (`TakeoffCanvas.jsx:1318`) and keys
> the `tileOverlayByPanel` memo (`:1347`); folding slots makes a slot edit flip that
> key so the overlay recomputes with the new per-quad `skuId`s. (The engine-side
> takeoff already re-figures via `computeTileTakeoff`'s `JSON.stringify(tile_setup)`
> cache at `:266` + the `conditions` dep, so this fold is the canvas-overlay guard,
> not the compute guard.) Do NOT fold color or a positional SKU id — recolor repaint
> is covered by the `conditions` dep, and a positional id fold reintroduces a
> reorder false-equal. Just the comment + slots.

- [ ] **Step 1:** Failing test — a **slot** edit flips the sig; identical sig under
  pure zoom/pan; identical sig when only `verts`/scale-independent inputs change.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Fold `assignment.mode`, `assignment.unit`, and the **sorted**
  `Object.entries(assignment.slots)` into the `tile_setup` block; fix the false
  comment at `:52-53` ("an id/name/color edit does not change the drawn grid" — a
  slot edit now does).
- [ ] **Step 4:** Run — PASS. `npm run check`.
- [ ] **Step 5:** Commit `fix(tile): fold assignment into tileLayoutSig; correct comment`.

### Task 11: Paint-the-unit panel control

**Files:** Modify `web/src/components/TilePanel.jsx` (ConditionCard; `addSku` :73
default size); add `enumerateSlots` (co-located, using the shared `slotKey` +
`PLANK_ARITY`). Verify: Playwright screenshot.

**Interfaces:** `enumerateSlots(pattern, unit) → [{ slot, preview }]` — builds slot
keys with the **same** `slotKey`; iterates `i∈0..w-1, j∈0..h-1`, and for the plank:
```ts
const arity = PLANK_ARITY[pattern];
const cell = arity === 1 ? { i, j } : { i, j, p }; // arity 1 ⇒ NO p, so slotKey → "i_j" matching grid/brick/diagonal quads (which stamp {i,j} with cell.p == null)
```
**Critical:** for arity-1 patterns (grid/brick_50/brick_33/diagonal — the default
and primary case) a `p:0` would make `slotKey` emit `"i_j_0"`, which no generator
quad carries, so painting would be a **silent no-op**. Omit `p` when `arity===1`;
do NOT collapse `p===0` inside `slotKey` (herringbone's `p:0` leading-V needs its suffix).

- [ ] **Step 1:** Add unit-size selector (uniform/herringbone `1..4`, basketweave
  `2..4`); the iteration visual from `enumerateSlots` drawn at assigned colors;
  click a cell → SKU swatch popover writes `assignment.slots[slot]`. Change `addSku`
  (`:73`) to default new SKUs to the field size (not `12×24`).
- [ ] **Step 2:** Browser-verify (isolated port): sample plan, a grid CT condition,
  paint a 2×2 checkerboard → multiple colors; two-tone herringbone (V vs H) →
  renders; recolor a SKU → field updates; panel unit-visual matches canvas; resize
  an assigned SKU to a differing size → §5.6 warning shows and canvas renders
  single-primary. Screenshot each.
- [ ] **Step 3:** Commit `feat(tile): paint-the-repeat-unit panel control`.

---

## Self-review (done)

- **Spec coverage:** §3 → T1–3; §4/§5.1-5.3 → T4–5; §5.4 → T6; §5.7 → T7; §5.5 reuse
  → T8; §5.6 → T9; §5.8 → T10; §6 → T11. Grout/cut-sheet non-per-SKU unchanged.
  Foundation criteria §8 asserted across T1–2, T4–6.
- **Blockers folded (plan-review v2):** tuple `origin` throughout; kept-cell filter
  in T6/T7/T8; `agg.reuseDowngradedMulti` for T8's `reuse_enabled:true`; T10 folds
  only assignment+slots; identical-size fixtures across T5–8; both `TileLayout`
  returns get `warnings`; `orderTiles` gets a resolved `TileSku`; named-quad assert
  in T5/T6; `PLANK_ARITY` shared constant for T11.
- **Type consistency:** `TileCell`/`slotKey`/`PLANK_ARITY`/`assignedSkuId`/
  `TileAssignment` defined once, reused verbatim.
- **Deferred (spec §7):** Versailles, accent/scatter, sliver-optimizer for
  herringbone/basketweave, walls, DXF/MCP per-SKU snapshot.
