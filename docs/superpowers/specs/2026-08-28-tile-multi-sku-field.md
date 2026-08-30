# Spec — Origin-aligned patterns + multi-SKU repeat-unit painting

**Status:** v5.1 — PLAN-READY. Folds the v4 adversarial panel (Slice-1 math,
Slice-2 architecture, scope/citations) + the v5 confirmation pass; the one
conditional fix (herringbone y-period `2·bandH`, not `bandH`) is applied.
**Branch:** `feat/tile-multi-sku` (off `feat/tile-patterning`)
**Roadmap:** tile Milestone 9; the shared floor substrate the wall projection
(M10) runs through.
**Research:** `docs/superpowers/research/2026-08-28-tile-pattern-origin-and-motif-prior-art.md`
(+ `oracles/`).

> v5 corrections from v4 (all code-verified by review): the shipped
> `herringbone.ts` is a **double** herringbone (4 planks/cell, gap-free **only at
> 2:1** — the non-2:1 warning is correct and stays); Slice 1 is therefore an
> **add-origin-phase** change to the existing generator, not a lattice rewrite, and
> the sliver-optimizer interplay is cut to a follow-up. Slice 2 keys off a **raw,
> unit-independent** cell index with one shared floored-modulo `slotKey` helper.

---

## 1. Problem

- **Multi-color doesn't render.** `tileSolve.ts:55` collapses a condition's SKU
  list to one id (`primaryUsableSku(...)?.id ?? skus?.[0]?.id ?? "sku"`) stamped on
  every field quad; added colored SKUs never tint the field and order at zero while
  the primary over-orders by their count.
- **Herringbone/basketweave ignore `origin`.** Their generators anchor the motif at
  **plan zero** (`herringbone.ts:78,83` `x0=ci*periodX`, `bandY0=bi*bandH`;
  `basketweave.ts:42-45`; bounds set only the loop *range*, not the phase — the
  phase is identical for every room). `origin` reaches them but is consumed only by
  rotation, so the shipped per-room `origin` override (`shape.tile_layout.origin`,
  M5) is silently dead for these patterns and their phase is uncontrollable.

## 2. Two slices
- **Slice 1** — make herringbone & basketweave honor `origin` (add-phase; bounded;
  ships as a standalone correctness fix). §3.
- **Slice 2** — multi-SKU repeat-unit painting across **all** patterns, keyed on
  origin-stable slot ids. §4–§9. Its *uniform* half needs nothing from Slice 1
  (`grid.ts:24` already keys origin-relative); its *intrinsic-motif* half needs
  Slice 1's origin-stability.

---

## 3. Slice 1 — Origin-honoring (add-phase, bounded)

### 3.1 The change
Inject `origin` as a **phase** into the existing generator anchor, exactly as
`grid.ts:24` does (`ox = origin.x`; index walked relative to it), leaving **all
other placement math unchanged** — the doubled 4-plank herringbone motif, the
one-reserved-joint invariant (`herringbone.ts:50-61`), basketweave's block
structure, and the `rotateQuadsAboutOrigin` path (which subtracts origin before
rotating, `pattern.ts:23` — verified no double-count). Concretely: replace the
plan-zero anchor `ci*periodX` / `bi*bandH` (and basketweave's `bounds.minX/minY`)
with an origin-relative anchor, and clip to bounds by intersection (as today).

- **Add `origin` raw — no reduction required** (reduction is only an optional
  optimization, and it is easy to get wrong). If you do reduce, use the *true*
  translation lattice, NOT `(periodX, bandH)`: herringbone's odd bands are
  glide-shifted `periodX/2` (`herringbone.ts:79`), so the lattice is
  `⟨(periodX,0), (periodX/2, bandH)⟩` — the pure-**y** period is **`2·bandH`**, not
  `bandH`. A componentwise reduce mod `bandH` misphases an odd-band origin by one
  band. Basketweave's lattice is `⟨(2L,0),(0,2L)⟩` (its `(i+j)` orientation coupling
  makes the pure period `2L` on each axis). **Do not** substitute an idealized
  single-herringbone lattice — that changes the weave and the cut set.
- **Keep the `tilePatterns/index.ts:17-22` non-2:1 warning verbatim.** The shipped
  weave is gap-free only at 2:1 (3:1 → 448/2304 uncovered, 1.5:1 → 320/2304 —
  review-verified); the warning is correct. (v4's §3.3 reword is dropped.)

### 3.2 Follow-up, explicitly NOT in Slice 1
Extending the sliver-avoidance optimizer (`tileGeometry/optimize.ts`) to
herringbone/basketweave is a **separate follow-up**: today `ORIGIN_HONORING`
(`optimize.ts:21`) excludes them and early-returns (`:133-136`), and its candidate
origins come from tile pitch (`:142-151`), not the pattern period. Slice 1 makes
the generators *honor* an origin (so the per-room override and a future per-surface
restart work); it does **not** teach the optimizer to *choose* one for these
patterns. Its stale comment (`optimize.ts:13-14`) is updated to say so.

### 3.3 Acceptance (TDD) — oracle committed at `research/oracles/`
The change only *translates* existing output, so tests assert **translation
invariance**, not absolute gap-freeness (see `oracles/README.md`):
- **No regression at `origin=[0,0]`:** generator output byte-identical to today.
- **Translation:** at several origins (fractional; and > 1 period), the field is
  the origin=0 field translated by the **raw `origin`** (equivalently `origin`
  reduced mod the *true* translation lattice — herringbone pure-y period `2·bandH`),
  minus boundary clipping. Do **not** write the expected shift as `origin mod bandH`
  — that wrongly fails a correct generator at e.g. `origin.y = 1.5·bandH`.
- **Per-room override:** a `shape.tile_layout.origin` moves the pattern for that
  room only (today a no-op for these patterns).
- **Basketweave:** same three checks with its period.
- **Warning unchanged:** a 1.5:1 herringbone still warns.

---

## 4. Slice 2 — Model: a raw cell index the resolver reduces

The generator stamps each quad with a **raw, unit-independent cell index**; the
**resolver and the panel** reduce it mod the paint unit through one shared helper.
Generation stays unit-independent, so changing the paint unit never invalidates the
layout memo. Cell index by pattern (matches the *actual* generators):

| Pattern | `TileQuad.cell` (raw) | Notes |
|---|---|---|
| grid, brick_50, brick_33 | `{i, j}` | `i,j` = `grid.ts` lattice indices (may be negative) |
| diagonal | `{i, j}` | grid indices in the pre-rotation frame (`diagonal.ts:20`) |
| herringbone | `{i, j, p}` | `i=ci, j=bi`; `p ∈ 0..3` = plank slot in the 4-plank cell (leading-V, upper-H, lower-H, trailing-V), a **stable geometric role** |
| basketweave | `{i, j, p}` | `i,j` = block indices; `p ∈ 0..1` = plank-in-block, canonicalized to a stable role (not raw push order, which flips with `(i+j)` parity) |

**Shared key (pinned, single source of truth):**
`slotKey(cell, unit) = `${fmod(cell.i, unit.w)}_${fmod(cell.j, unit.h)}${cell.p!=null ? "_"+cell.p : ""}``
with **floored modulo** `fmod(n,m) = ((n % m) + m) % m` (matches
`herringbone.ts:79`; a raw `%` mis-keys the negative indices that diagonal's
centered origin and origin-shifted grids routinely produce). Exactly one
implementation, imported by both the resolver and `enumerateSlots`.

**Unit / slot cardinality:**
- uniform: `unit = w×h` tiles → `w·h` slots.
- herringbone: `unit = w×h` cells → `4·w·h` slots (the doubled motif has 4 planks
  per cell). Default `1×1` (4 slots: the two V and two H planks) suffices for
  two-tone; `1×2` re-phases across the 2-band vertical period.
- basketweave: `unit = w×h` blocks → `2·w·h` slots. **Default `2×2`** (the true
  checkerboard repeat; `1×1` isn't the geometric repeat because block orientation
  alternates by `(i+j)` parity).
- `unit` axes clamp to `1..4` (uniform/herringbone); basketweave `2..4` (min 2 =
  the true checkerboard repeat).

## 5. Slice 2 — Engine, data, downstream

### 5.1 Data model
`TileSetup` gains optional/back-compatible:
```ts
type TileAssignment = { mode: "repeat"; unit: {w:number;h:number}; slots: Record<string, Id> };
type TileSetup = { /* … */ assignment?: TileAssignment };
```
On `tile_setup` (condition default), non-undoable (roll_setup/tile_setup
precedent); rides existing serialize + deep-copy. Reserved seams (not built):
per-shape `assignment` override; `mode` for scatter; an `nth`-style accent layer.

### 5.2 Resolver, default chain, pattern-switch
- `assignedSkuId(tile_setup, cell): Id` — computes `slotKey(cell, assignment.unit)`,
  returns `slots[key]` **if it resolves to a live SKU in `skus`**, else the
  **default**. The default preserves `tileSolve.ts:55`'s full chain verbatim:
  `primaryUsableSku(...)?.id ?? skus?.[0]?.id ?? "sku"` (a no-usable-SKU condition
  must still yield `skus[0]`/`"sku"` — else the "absent assignment ⇒ byte-identical"
  guarantee regresses for it). Unresolved-id validation is required
  (`TakeoffCanvas.jsx:328` else falls to `#888`).
- **Pattern switch is by key-space, not a "fit" check** (there is none). grid /
  brick_50 / brick_33 / diagonal **share the `i_j` key space**, so a grid
  assignment *keeps applying* across those switches (intended). Switching to
  herringbone/basketweave changes the key space (`p` appears), so grid slots miss →
  every quad defaults; switching back restores. No crash, no partial match.

### 5.3 Threading (shared solve — foundation #1, #3)
1. Each generator stamps `TileQuad.cell` (raw indices, §4), in its own lattice
   frame. The property rides through the herringbone geometry sort (`:96` sorts
   objects in place) and `rotateQuadsAboutOrigin` (`pattern.ts:22-25` spreads
   `{...q}`) — verified preserved.
2. `tileSolve.ts` (replacing the line-55 collapse): each quad
   `skuId = assignedSkuId(tile_setup, quad.cell)`; resolver in `tilePatterns`/here —
   the shared `solveTileLayout`, never keyed on `floor_area`.
3. Rendering already per-quad (`tileOverlay.ts:66`); no signature change.

### 5.4 Per-SKU purchase order (condition level — foundation #2)
- Compute `countsBySku(agg.classified)` (`tileCalc/tiles.ts:52`) in the **finalize
  loop beside `agg.order` at `tileTakeoff.js:396-401`** (not the `aggFor` init —
  `agg.classified` is `[]` there, `delete`d `:451`). skuId already on each quad
  from the solve; **never mutate the pooled `agg.classified`** (pinned/by-reference,
  `:261-265`).
- One `orderTiles` per SKU over its safe count (mirror band rollup `:421-425`).
  Per-SKU whole-box rounding is correct (`order.ts:34` `dyeLots:1`; distinct SKUs
  can't share a box; pool-then-split-then-round keeps the once-per-condition
  invariant).
- Condition `boxes/figured/with_margin` = **sums** over per-SKU orders;
  byte-identical for a single-SKU condition. Field-only rollup — band keeps its own
  `bandBySku`; the shared *util* is what a wall strip reuses.

### 5.5 Deliberately NOT per-SKU
- **Grout** single total (per-SKU summing over-orders a single consumable).
- **Cut sheet** no `skuId` split (cosmetic for same-size; counts recover from
  `countsBySku`).
- **Reuse guarded off when mixed.** `reusePlanForCondition` already pools per-SKU
  correctly (`:67-99`); the miscount is only in the box-rounding `reuseOrder` via
  `primaryUsableSku` (`:410-412`) and the per-shape reuse call (`:182,184`).
  Guarding off is the **conservative** choice (not forced by a broken pool). Apply
  the skip at both `reuseOpts?.enabled` gates (`:181`, `:408`); **predicate:** ≥2
  distinct `skuId`s **among solved quads** (stale/collapsed-to-one reuses normally);
  report `reuse_enabled:true` + `reuse_downgraded:"multi-color field"` (`:473-483`).

### 5.6 Same-size enforcement (engine gate + a real warnings channel)
- **Field size** = the `tileConfig(tile_setup)`-resolved size (from the default
  SKU), compared **unordered** (`{min,max}` — `12×24` ≡ `24×12`; herringbone/
  basketweave canonicalize long/short and grid is symmetric). Compare each assigned
  SKU's raw `w_in/h_in` unordered against it.
- If any assigned SKU differs, **ignore the assignment** (solve single-primary) and
  emit a QA warning. **Channel (pinned):** add `warnings` to `TileLayout`
  (`tileSolve.ts:17-22` has none today) and merge it into `summarizeShape`'s
  warnings array (init from `layoutWarning` `:134`, assembled `:178`). Never throw
  (the solve runs in a `useMemo`; a throw kills the canvas — mirrors the band-skip
  at `tileTakeoff.js:162`).
- Panel (§6) defaults new SKUs to the field size so the common path never trips it.

### 5.7 Report `tile_goods` (pinned shape)
Each condition row keeps its scalar fields (back-compat) + additive optional
`by_sku: [{sku_id, name, color, safe, boxes, figured, with_margin}]`, present only
when an **applied** assignment distributes ≥2 distinct solved SKUs; scalars = sums;
byte-identical otherwise. Sites: `tileReportRows` (`tileTakeoff.js:495-529`),
`reportJson` (`totals.js:593`), zod (`mcp/src/outputs.ts:632`). `export_report`
only; per-SKU `export_takeoff` snapshot is a separate non-goal.

### 5.8 Memoization
**Required:** update the now-false comment at `tileLayoutSig.ts:52-53` ("an
id/name/color edit does not change the drawn grid"). **Also fold into the sig** (to
close a real false-equal, not for repaint — repaint is already covered by the
`conditions` dep `TakeoffCanvas.jsx:1299` + `JSON.stringify(tile_setup)` cache
`:266`): the `assignment` (mode/unit + **sorted** `slots` keys, mirroring the
existing `edge_overrides` sort at `:66-69`), and each SKU's `id` **positionally**
in the `sku_sizes` hash (`:63`). The false-equal: `sku_sizes` is positional
sizes-only, and `primaryUsableSku` = first-usable, so reordering two same-size SKUs
changes the default color every unassigned quad renders in while the sig doesn't
flip → stale overlay. Folding id positionally closes it.

## 6. UI — paint-the-unit control (all patterns)
`ConditionCard` (`TilePanel.jsx`), below Pattern:
- **Unit-size** selector in the pattern's natural unit (tiles / herringbone cells /
  basketweave blocks); ranges per §4 (basketweave min 2×2).
- **Visual of one iteration** from `enumerateSlots(pattern, unit)` — which builds
  keys via the **same `slotKey` helper** the generator/resolver use (no second
  formula). Uniform → `w×h` cells; herringbone → the 4 plank shapes per cell;
  basketweave → the block planks. Drawn at assigned SKU colors.
- **Interaction (pinned):** click a cell → SKU swatch popover → pick writes the slot
  (one-act inline edit; no click-to-cycle). Unassigned → default SKU.
- **`addSku` defaults new SKUs to the field size** (not hardcoded `12×24`,
  `TilePanel.jsx:73`), so adding the second color never trips §5.6. A later
  differing resize shows the §5.6 warning; the engine ignores the assignment
  regardless (panel doesn't hard-block — import/edit paths bypass it).

## 7. Non-goals (seams noted)
- **Mixed tile *sizes* (Versailles).** Engine seam absent (`GenInput` one size;
  generation precedes assignment). *When built:* module = **÷8 sq ft**
  (2×8×8 + 8×16 + 2×16×16 + 16×24 = 1152 in²); the common ÷4 module is broken;
  canonical piece coords exist only as vendor diagrams.
- **Accent/scatter modes** — `mode` discriminant + reserved override layer; accent =
  `nth`-style `{stride,offset}→skuId`. Not built.
- **Sliver-optimizer for herringbone/basketweave** (§3.2), **walls (M10/M11)**,
  **DXF per-SKU**, **MCP `export_takeoff` per-SKU** — noted where they'd miscount.

## 8. Foundation acceptance criteria (pass/fail)
1. Resolver in `tileSolve`/`tilePatterns`, never keyed on `floor_area`.
2. Per-SKU **field** rollup reuses the shared `countsBySku` util over solved
   `classified` (like `bandBySku`); a wall strip adds its own analogous rollup.
3. Slot keys are unit-relative in pattern space via one floored-mod helper; an
   origin/rotation nudge **translates the geometry coherently while the painted
   motif stays locked to the lattice repeat** (color is unit-periodic and
   lattice-anchored — an integer-period origin shift does not move colors, by
   design; sub-period shifts move the geometry under a fixed color repeat).
4. All in-scope patterns honor `origin` (Slice 1 for herringbone/basketweave), so a
   future per-surface restart is reachable for every one.

## 9. Slice-2 acceptance (TDD)
- Grid 2×2, slots {0_0:A,1_0:B,0_1:B,1_1:A}, room in positive plan space **and** a
  second case with a **centered/negative-index** origin: both alternate A/B
  correctly (floored-mod), `countsBySku` ~50/50, two whole-box order rows,
  condition `boxes` = the sum.
- Diagonal with the optimizer's centered origin (negative `i/j`): painted colors
  match `enumerateSlots` (proves the shared floored-mod helper; a raw `%` fails
  here).
- Herringbone 1×1 {…_0:A(V planks), …_1:B…}: every V plank A, every H plank B,
  across the field and **stable under an origin shift** (composes with Slice 1);
  two order rows.
- Herringbone 1×2: colors differ across the 2-band vertical period (proves band
  re-phasing; pin which lattice index is the visual band in the plan).
- Basketweave 2×2: per block-plank assignment, stable under origin.
- Absent assignment, or a pattern whose cells the current assignment's keys miss ⇒
  byte-identical to today. **No-usable-SKU condition** ⇒ default chain yields
  `skus[0]`/`"sku"`, byte-identical.
- Mixed vs single-SKU: single-SKU `tile_goods` byte-identical; mixed emits
  `by_sku[]`, scalars = sums.
- Differently-sized SKU + assignment ⇒ ignored, single-primary solve, QA warning
  via `TileLayout.warnings`, **no throw**.
- ≥2 distinct solved SKUs + `reuse.enabled` ⇒ reuse skipped both gates,
  `reuse_enabled:true`+`reuse_downgraded`; stale 1-SKU + reuse ⇒ reuse normal.
- Slot → deleted SKU ⇒ default (not `#888`).
- `tileLayoutSig` flips on a slot edit and a SKU color edit; **stable under two
  same-size SKUs reordered only if colors unchanged** (the folded id makes a color
  swap flip it); stable under pure zoom/pan.

Canvas (browser-verified, screenshot): paint a 2×2 grid checkerboard and a two-tone
herringbone; recolor a SKU → field updates; panel unit-visual matches canvas. Also
cover the **deliberate panel≠canvas** path: resize one assigned SKU to a differing
size → the panel shows the §5.6 warning and the canvas renders single-primary (not
the painted colors) — assert the divergence is warned, not silent.

## 10. Open (for the plan)
- Pin which herringbone lattice index (`bi` vs derived) is the **visual band** for
  the §9 1×2 test, and the stable geometric identity of the 4 herringbone planks
  `p∈0..3` and the 2 basketweave planks `p∈0..1` (canonicalized across the `(i+j)`
  orientation flip).
- Confirm the herringbone `cell` is captured **before** the `:96` sort (it rides by
  reference, but the value must be computed at emission).
- `by_sku[]` field naming vs existing report column conventions.
