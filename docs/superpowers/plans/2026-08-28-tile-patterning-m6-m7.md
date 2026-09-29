# Tile patterning — M6 (with-reuse offcut pool) + M7 (interior bands)

Continues `docs/TILE_PATTERNING_DESIGN.md` (§2.D/§2.E, §3.3 `reuse.ts`, §3.4
bands, §5 milestones 6–7). Lands on the M5 canvas overlay (PR #207) so both
milestones are visually auditable. M6 ships first — the design mandates that
order (reuse before bands).

## Invariants (carry-forward from M1–M5 — every implementer obeys)

- **`effectiveTileSetup` (tileGeometry/optimize.ts) is the SOLE origin/rotation
  resolver.** M6/M7 NEVER solve a layout independently. Read the already-solved
  `layout` off `computeTileTakeoff`'s `byShape.get(id)` (`{config, bounds, quads,
  classified}`) + `ring_ft`. Reuse reads `byShape…layout.classified` for the
  cut set; it does not re-classify.
- **Purchase/grout figured ONCE per condition** in `computeTileTakeoff`'s
  `byCond` finalize loop. The With-reuse count is likewise a per-condition
  figure — NEVER sum `byShape` reuse counts across a condition (over/under-orders).
- **`jsts` (vendored) for boolean geometry** — never `polygon-clipping`. M7 band
  offset polygons follow `classify.ts`'s jsts idioms (narrow structural
  interfaces, no `any`/`as`).
- **Mixed-unit boundary:** generators/rings in FEET; `classifyLayout` joint in
  INCHES; `tileSolve.solveTileLayout` is the SOLE conversion site. Classified
  `cut.{w_in,h_in}` are INCHES (reuse works in inches).
- **§4.1: layout refines the margin, does not remove it.** With-reuse is an
  ADDITIVE figure beside Safe; it still carries breakage/attic/dye-lot margin
  via `orderTiles`. It never replaces Safe and never zeroes the margin.
- **Lint that bit prior implementers:** `ts-no-any`, `ts-no-return-type` (import
  named types, never `ReturnType<typeof>`), `ts-no-tiny-functions`, `ts-set-map`
  (static string-keyed lookups → `Record`, runtime-keyed → `Map`).
- **WORKTREE WRITE QUIRK:** relative paths intermittently land files in the
  sibling main repo. Use worktree-absolute paths for NEW files; `git status` in
  BOTH `/Users/knmurphy/Documents/PROJECTS/opentakeoff` and the worktree before
  committing.
- Tests: `cd web && node --import tsx --test test/<name>.test.ts`. Gate:
  `cd web && npm run check` + `cd mcp && npm test` + `cd mcp && npx tsc --noEmit`.

---

## M6 — With-reuse offcut pool (gated)

**Goal:** a "With reuse" whole-tile purchase count beside the existing Safe
count: model cutting whole tiles and reusing the rectangular offcuts to satisfy
other cuts (same SKU, grain-locked, offcut above a sliver threshold). Fewer
whole tiles than Safe when offcuts pack. Opt-in, per condition.

### Data model

- Extend `TileSetup.purchase` (tileSetup.ts) additively:
  `purchase?: { breakage_pct?, attic_pct?, reuse?: { enabled: boolean;
  sliver_threshold_in?: number; kerf_in?: number } }`.
  - `enabled` default absent/false → no reuse figure (Safe only, unchanged).
  - `sliver_threshold_in` default `2` (an offcut whose min dim < this is scrap).
  - `kerf_in` default `0.125` (saw kerf removed per cut; conservative).
  - `mintTileSetup()` leaves `purchase` absent (opt-in), as today.

### Task 6.1 — pure `web/src/lib/tileCalc/reuse.ts` (TDD, parallelizable)

Signature (feet-free; inches throughout, matching `classified.cut`):
```
reusePlan({ classified, sku, pattern, sliver_threshold_in, kerf_in })
  => { wholeTiles: number; offcutsUsed: number; scrapped: number;
       reuseMap: Array<{ from_in:[w,h], cuts_in:[w,h][] }>; downgraded?: string }
```
- `wholeTiles` = whole tiles consumed = full count + tiles opened for cuts,
  after packing offcuts. This is the With-reuse analogue of Safe.
- **Algorithm (best-fit-decreasing guillotine, §3.3):**
  1. Full/corner cells: each `full` needs a whole tile (no offcut). `corner`
     and `lShaped` cuts each consume a whole tile and produce NO reusable
     offcut (an L/corner remnant is not a clean rectangle — conservative).
  2. Straight rectangular `cut` pieces: sort descending by area. For each,
     best-fit into the pool of existing offcuts (same SKU; grain-locked: the
     offcut's (w,h) must contain the cut's (w,h) in the SAME orientation — no
     90° rotation, since a grid tile's grain runs one way). On a fit, consume
     the offcut and guillotine-split the remainder into up to two rectangles;
     keep each remainder ≥ `sliver_threshold_in` on its min dim, else scrap.
     On no fit, open a new whole tile (`wholeTiles++`), cut the piece, and its
     complement (tile W×H minus the cut, minus kerf) enters the pool if ≥ the
     sliver threshold.
- **Auto-downgrade (design §3.3 "auto-downgraded for AABB-approximate
  patterns"):** for `diagonal | herringbone | basketweave`, cut-piece dims are
  AABB approximations and grain is ambiguous → return `wholeTiles = safe`
  (no savings) with `downgraded: "<reason>"`. Grid/brick_50/brick_33 get real
  reuse. This keeps reuse honest: it never claims a saving it can't defend.
- **No cross-SKU reuse (grain-lock):** the pool is per-SKU. Multi-SKU layouts
  pool each SKU's offcuts separately (use `byShape.layout.classified` grouped by
  `quad.skuId`, dims from the SKU).

**Tests (`web/test/tileReuse.test.ts`, red first):**
1. A room whose straight cuts pack into offcuts → `wholeTiles < safe`.
2. Grain-lock: a cut that would only fit an offcut rotated 90° does NOT reuse
   it (opens a new tile).
3. Sub-threshold remainder is scrapped, not pooled (a later cut that would fit
   only the sub-threshold sliver opens a new tile).
4. L-shaped/corner cut consumes a whole tile and yields no offcut.
5. Diagonal/herringbone → `downgraded` set, `wholeTiles === safe`.
6. Determinism: same input → same plan (sorted, no Set iteration order deps).

### Task 6.2 — wire into `tileTakeoff.js` (serial; owns the bridge)

- `summarizeShape`: when `tile_setup.purchase?.reuse?.enabled`, compute
  `reuse = reusePlan({ classified, sku: primarySku, pattern: config.pattern,
  sliver_threshold_in, kerf_in })` and add `reuse` to the returned summary.
  When disabled, `reuse` absent (consumers treat absent = "not figured").
- `computeTileTakeoff` byCond finalize: when reuse enabled, pool at the
  CONDITION level — concatenate every shape's `classified` for the condition
  and run `reusePlan` ONCE (the same "figured once per condition" rule as
  order/grout; per-shape offcuts pack across the condition's rooms). Then
  `agg.reuseOrder = orderTiles({ safeCount: agg.reuse.wholeTiles, sku, breakage,
  attic })` — margin still applies (§4.1). Store `agg.reuse` + `agg.reuseOrder`.
- **Do NOT** touch `agg.order` (Safe) — With-reuse is strictly additive.

**Tests (extend `web/test/tileTakeoff.test.ts`):** condition with `reuse.enabled`
exposes `byCond…reuse.wholeTiles ≤ counts.safe` and a `reuseOrder`; disabled →
neither present; the Safe `order` is byte-identical with/without reuse enabled.

### Task 6.3 — report seam (`tileReportRows` + `tile_goods`) (same owner as 6.2)

- Add additive fields to the `tile_goods` row: `reuse_whole` (=
  `reuseOrder.figured`-basis count), `reuse_boxes`, `reuse_enabled`. Absent/0
  when disabled. ×N multiplier applies exactly as Safe boxes do.
- Update the `report.v1` doc comment / MCP `export_report` clause noting the
  additive fields (no new tool; tool count stays "forty").

### Task 6.4 — TilePanel + canvas surface (serial; TilePanel owner)

- `ConditionCard`: a "Reuse offcuts" checkbox (patches
  `purchase.reuse.enabled`) + when on, a `sliver_threshold_in` number field.
- When `ti.reuse` present, a summary line beside the order line:
  `with reuse N tiles · M boxes` and, if `ti.reuse.downgraded`, a muted note
  "reuse n/a for <pattern> — grain ambiguous". Never hide the Safe line.
- Canvas passes `ti` through already (`layouts`), so no canvas math change —
  just confirm `tileByCond` entries carry `reuse`/`reuseOrder`.

### M6 verification

- Unit: 6.1/6.2/6.3 tests green.
- **Browser (M5 recipe):** load sample, scale, activate `CT-1`, trace a room
  with cuts, open the tile panel, toggle "Reuse offcuts" → a "with reuse" line
  appears with fewer tiles than the order line; switch pattern to herringbone →
  the downgrade note shows and With-reuse === Safe.

---

## M7 — Interior bands / listellos / accent strips

**Goal:** place a band of a different SKU as an inset ring inside a room (a
listello/border running parallel to the walls at a set offset), consuming field
area. The band gets its own tile/trim figures; the field pattern stops at the
band's inner edge.

### Data model

- Per-room band lives on `shape.tile_layout` (undoable, per-room — a band is a
  room-specific decision): `tile_layout.band?: { sku_id: string; width_ft:
  number; offset_ft: number }` (offset from the room wall to the band's OUTER
  edge; `width_ft` the band thickness). `sku_id` references a `tile_setup.skus`
  entry (add a band SKU in the panel).
- **`tileLayoutSig.ts` MUST include `band`** (width/offset/sku) — a band change
  is geometry-affecting; omitting it means the layout won't re-solve/invalidate.

### Task 7.1 — pure band geometry in `web/src/lib/tileEdges/` (TDD, parallelizable)

- `web/src/lib/tileEdges/band.ts`:
  `bandRings({ ring_ft, holes_ft, offset_ft, width_ft }) =>
    { outer: Pt[]; inner: Pt[] } | null` — two concentric offset rings (jsts
    `BufferOp` inward on the room polygon; `outer` = ring buffered by
    `-offset_ft`, `inner` = ring buffered by `-(offset_ft+width_ft)`). Returns
    null if the inward buffer collapses (room too small for the band).
- The band's tile area = ring between `outer` and `inner` (a polygon with the
  inner as a hole). The FIELD then classifies against `inner` as its new outer
  boundary (the band consumes field area — design §3.4 "consume field area").

**Tests (`web/test/tileBand.test.ts`):** a rectangular room offset inward yields
outer/inner rectangles at the right dims; a band wider than the room → null; a
room with a hole keeps the hole in both rings.

### Task 7.2 — solve integration (serial; owns tileSolve/tileTakeoff)

- `solveTileLayout` / `summarizeShape`: when `tile_layout.band` present and
  `bandRings` non-null, (a) solve the FIELD pattern against `inner` as the outer
  ring (band SKU excluded from the field); (b) solve the BAND as its own run —
  the band SKU tiled along the ring between outer/inner (a straight run; reuse
  `measure`-style linear tiling: band LF ÷ band tile length, corners as cut
  pieces). Return both in the summary: `layout` (field, unchanged consumers) +
  `band` (`{tiles, cut, lf, sku_id}`).
- byCond aggregates band figures per SKU alongside field figures (band tiles
  ordered as their own SKU line).

**Tests (extend `tileTakeoff.test.ts`):** a room with a band figures fewer field
tiles (band consumed the perimeter area) + a band-tile line; no band → identical
to today.

### Task 7.3 — overlay + panel (serial; canvas + TilePanel owners coordinate)

- `tileOverlay.ts`: draw the band ring (outer/inner) filled with the band SKU
  color, distinct from field tiles; field grid stops at `inner`.
- Canvas `tileOverlayForShape`: read `summary.band` for the band primitives.
- TilePanel `RoomOverride`: band controls (enable, pick band SKU from the
  condition's SKUs, `width_ft`, `offset_ft`), dispatched via the undoable
  `tileLayout` command (`{ band: {...} }`; clearing sets `band: undefined`).

### M7 verification

- Unit: 7.1/7.2 tests green.
- **Browser:** trace a room, add a band in the panel → an inset ring of the
  band color renders, field grid stops at the band's inner edge, panel shows a
  band-tile figure; remove the band → field fills the whole room again;
  undo/redo the band is one step.

---

## Execution

- **SDD + reviewer gate.** Fresh implementer per task/batch (warn each: worktree
  write quirk + lint rules). TDD red-first, task-scoped review, fix loop.
- **Parallel where independent:** 6.1 (`reuse.ts`) and 7.1 (`band.ts`) are pure
  and independent → one batch. Serial owners: `tileTakeoff.js` (6.2/6.3/7.2),
  `TakeoffCanvas.jsx` (6.4 canvas/7.3 overlay), `TilePanel.jsx` (6.4/7.3 panel).
- **Adversarial gate after EACH milestone** (architect + estimator); proceed
  only on READY. M6/M7 add UI → deliverable-proof is browser-drive verification,
  not unit tests alone.
- **Gate before push:** `cd web && npm run check` + `cd mcp && npm test` +
  `cd mcp && npx tsc --noEmit`. Add commits to PR #207. Merge = deploy →
  human-authorized only.
- **Docs on behavior change:** `docs/USER_GUIDE.md` (reuse toggle, bands),
  `README.md`, `CHANGELOG.md`; MCP docs only if snapshot/report shape changes
  (keep tool count "forty").
</content>
