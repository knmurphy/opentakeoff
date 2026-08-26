# Tile Patterning — structured feature set & design

Status: design, revised after adversarial review. This defines the **complete**
feature, integrated cohesively into OpenTakeoff, and a build path that reaches
all of it. Starting simple is a build *order*, not a target — nothing here is a
scope cap.

Companion doc: `docs/TILE_PATTERNING.md` (audit, prior art, taxonomy, algorithms,
review findings). This doc synthesizes that into the thing to build.

---

## 1. Stance & goal

Goal: add tile patterning to OpenTakeoff **cohesively and complementarily** —
reusing the condition/shape/totals model, the canvas overlay, the report seam,
and the MCP surface, rather than bolting on a separate app.

The feature is large, and that is fine. It is organized as a **structured set of
capabilities**, each mapped to a module and an integration point, with a build
path (§5) that lands them in dependency order. The complete set is §2–§4;
nothing in it is "out of scope" — some of it is simply later in the path.

What we reuse (proven, do not reinvent): conditions and their
library/twin/variant/duplicate machinery, `verts_norm` shape geometry, the role
model (`floor_area`/`surface_area`/`linear`/`count`), the `conditionTotals` `ctx`
seam, the zoom/detail rendering, the roll-goods "opt-in setup → pure engine →
drawn SVG overlay → docked panel → report columns" *wiring*, `transitions.ts`,
the scale-accurate Marked Set + DXF export, and the MCP `edit_condition` pattern.

---

## 2. The complete feature set

Grouped by domain. Each row names where the logic lives (module) and where it
surfaces (integration point).

### A. Tile definition — what a tile *is*

| Capability | Module | Surfaces |
|---|---|---|
| Tile SKUs: name, W×H, color, glossiness, image(s) | `tile_setup.skus[]` | docked panel, marked set, report |
| Multiple SKUs per pattern (rect + square, Versailles, accent) | pattern engine (§3.1) | docked panel |
| Mixed laying from images or plain color | `tile_setup.skus[].images[]` | docked panel, overlay |
| Tile catalog / library (size families, presets) | seed + library (like `FLOORING_DEFAULTS`) | condition library, panel |
| Grout: preset sizes + custom, width + color | `tile_setup.joint`, `grout` | docked panel |

### B. Pattern engine — how tiles are laid

| Capability | Module | Surfaces |
|---|---|---|
| Straight grid | `patterns` lattice | overlay, panel |
| Running bond (50% / 33% offset) | `patterns` offset | overlay, panel |
| Diagonal 45° | `patterns` diagonal | overlay, panel |
| Herringbone (gap-free via derived grid vectors) | `patterns` herringbone | overlay, panel |
| Basketweave | `patterns` basketweave | overlay, panel |
| Chevron, pinwheel/hopscotch, harlequin | `patterns` (motif) | overlay, panel |
| Modular / Versailles (multi-size super-cell) | `patterns` modular (per-quad `skuId`) | overlay, panel |
| Non-rectangular (hex, penny, octagon+dot) | `patterns` nonrect | overlay, panel |
| Randomized / percentage layout | `patterns` random (`madum-ts`-class packing) | overlay, panel |
| Extensibility: interface + registry | `patterns/registry.ts` | — |

### C. Layout control — where and how the field sits

| Capability | Module | Surfaces |
|---|---|---|
| Origin (drag on canvas + numeric) | `tile_setup.origin` | overlay crosshair, panel |
| Rotation | `tile_setup.rotation` | panel, overlay |
| Edge-cut strategy (full-corner / centered band / optimized) | `geometry/optimize.ts` | panel, overlay |
| Auto-optimize offset (edge-aligned search, minimize cuts) | `geometry/optimize.ts` | panel |
| Mark a side as a "cut side" (push partials to chosen edges) | `shape.tile_layout.cut_sides` | overlay (edge click) |
| Per-room override of origin/rotation | `shape.tile_layout` | overlay, panel |

### D. Cut accounting — what actually gets ordered

| Capability | Module | Surfaces |
|---|---|---|
| Full / cut / hole classification (polygon intersection) | `geometry` | overlay (shading) |
| Corner-piece classification (edge-contact) | `geometry` | overlay, cut sheet |
| L-cut notches (full tile + sawn corner notch) | `geometry` + cut sheet | cut sheet |
| Purchase: *Safe* (full + one-per-cut) | `calc/tiles` | panel, report |
| Purchase: *With reuse* (offcut pool, grain-lock, sliver threshold) | `calc/reuse` | panel, report |
| Cut sheet (per-room, consolidated batch, offcut→cut map) | `calc/cutsheet` | report, marked set (forward scope) |
| Hole cut accounting (hole straddles → cut tile) | `calc/tiles` | panel, report |

### E. Trim & sundries — the edges

| Capability | Module | Surfaces |
|---|---|---|
| Per-side trim assignment (trim/bullnose/cove/profile/threshold) | `edges` | overlay (edge click), panel |
| Trim LF + piece count (`ceil(len/piece)`) | `calc/borders` | panel, report |
| Outside/inside corner counts (convex/reflex) | `calc/borders` | panel, report |
| Bullnose types (surface/radius/double/corner three-way) | `tile_setup` + `edges` | panel |
| Cove base tile (sanitary), distinct from resilient `RB-1` | `edges` | panel, report |
| Marble thresholds at doorways/finish transitions | `edges` + reuse `transitions.ts` | overlay, report |
| Borders / bands / listellos / accent strips (interior, not just perimeter) | `edges` (offset interior polygon) | overlay, panel |
| Grout-from-layout (joint length × geometry, not area factor) | `calc/grout` + `coverage.js` | report |

### F. Wall tile — the vertical field

| Capability | Module | Surfaces |
|---|---|---|
| Surface-area ring → elevation strip (unwrap) | `wall` | overlay, panel |
| Openings / niches as holes in the strip | `wall` | overlay |
| Multi-course base (cove/bullnose courses) | `wall` + `coverage.js` | panel, report |
| Wall panels / stacked bands | `wall` | overlay, panel |

### G. Curb & 3D — wrapped surfaces

| Capability | Module | Surfaces |
|---|---|---|
| Curb as linear feature + cross-section profile | `curb` | overlay, panel |
| Per-face pieces (top, two sides), corner/end cuts | `curb` | cut sheet, report |
| Niches (recessed boxes) | `curb` + `wall` | overlay, panel |

### H. Quantities & export — the deliverable

| Capability | Module | Surfaces |
|---|---|---|
| Tile counts, trim LF, corner EA, grout in Report/CSV/XLSX | `totals.js` `ctx` + `reportColumns` | report |
| Cut sheet and trim schedule | `calc/cutsheet` + `markedset.js` (forward scope) | report, marked set |
| `report.v1` fields (tile counts, layout snapshot, trim edges) | `reportJson` | JSON export |
| Waste-from-layout (replaces/augments heuristic waste %) | `calc` + `totals.js` | report |
| **Scale-accurate tile layout sheet** (grid + cuts with dimensions + trim + corners at true scale, for install) | reuses `markedset.js` (PDF) + `export_dxf` (CAD) | PDF/DXF |

### I. Interaction — the tool in the estimator's hands

| Capability | Module | Surfaces |
|---|---|---|
| Focus-on-a-shape: select → zoom → grid appears | canvas | — |
| Tile-grid overlay (always-on SVG like roll cuts, not detail-gated) | canvas overlay | — |
| Docked setup panel (Roll-panel pattern) | `TilePanel` | — |
| Origin drag / rotation / edge tagging, one undoable command per gesture | `shapeCommands` | — |
| Hatch ↔ overlay coexistence (overview vs detail zoom) | canvas + `hatches.jsx` | — |

### J. MCP / headless

| Capability | Module | Surfaces |
|---|---|---|
| `tile_setup` on `edit_condition` (like `roll_setup`) | MCP `edit_condition` | — |
| Headless layout + cut sheet + trim for agents | engine (pure) | `export_report`, `export_takeoff` |

---

## 3. Engine decomposition (pure, no React/DOM)

All pure modules under `web/src/lib/`, mirroring the proven `rollgoods.js` /
`rollTakeoff.js` split (engine + a thin bridge) and TileCalculator's
`geometry/` + `calc/` split. Everything is unit-testable headlessly, which is
what lets the MCP surface and the canvas share one math path.

### 3.0 The layout contract — one geometry, three views (the critical seam)

The single biggest risk is drift between what is drawn and what is ordered. The
generator, classifier, purchase math, renderer, and grout math must all derive
from **one shared pitch primitive**, not three independent computations.

`lib/tilePitch.ts` exports three views of the same cell, from nominal tile size
(`w`, `h`) and joint (`j`):

- **`nominalQuad`** — the tile *face*, `w × h`, no grout. This is what a SKU
  *is* and what face area / coverage is computed from.
- **`pitchCell`** — `(w+j) × (h+j)`, the repeat distance. This is what the
  generator places and what the classifier / purchase math intersect against.
- **`installedFace`** — `nominalQuad` inset by `j/2` on each side, the visual
  face inside its grout gap. This is what the overlay and Marked Set draw.

Rule: **generator emits pitch-cell spacing; classifier + purchase use pitch
cells; renderer + marked set use installed faces; face area uses `nominalQuad`.**
Grout never appears inside a generator (TileSim's answer to "joint included vs
not"), and the pitch↔face conversion lives in exactly one module so the drawn
field and the ordered quantity cannot disagree.

### 3.1 `lib/tilePatterns/` — the pattern engine

- `types.ts` — `TileSetup`, `TileSku`, `TileQuad {cx,cy,w,h,rot,sku}`, `PatternId`.
- `pattern.ts` — `PatternGenerator` interface: `generate(bounds, setup) → TileQuad[]`
  (pitch-cell quads, `rot`, `sku`).
- `registry.ts` — name → generator; a new pattern is a new file + registration.
- Generators: `lattice` (grid), `offset` (brick), `diagonal`, `herringbone`,
  `basketweave`, `motif` (chevron/pinwheel/harlequin), `modular` (multi-SKU
  super-cell, per-quad `skuId`), `nonrect` (hex/penny), `random` (seeded PRNG —
  see §6).
- Deterministic: same inputs → same layout (required for undo, MCP, re-render;
  `random` takes a seed).
- **Origin applicability is pattern-specific**: grid/brick/diagonal honor origin
  and rotation; herringbone/basketweave derive their own interlock and ignore a
  free origin; modular is cell-anchored. This must be an explicit table, not a
  blanket "origin applies" (the `tiletakeoff` finding).

### 3.2 `lib/tileGeometry/` — classification & fragments

- Boolean geometry via `polygon-clipping` (Martinez–Rueda, `mfogel`) — robust
  cell∩room intersection, not hand-rolled Sutherland–Hodgman.
- `classify(cell, room, holes) → full | cut | hole | out`; corner = edge-contact,
  not corner point-in-polygon (misreads diagonal slivers).
- Cut fragments: exact clipped footprint → cut-piece dimensions; L-cut detection
  (full-extent tile with a rectangular corner notch).
- Hole detection: a tile straddling a hole is a cut tile (consumes a full tile).
- Origin optimization: search only edge-aligned offsets (the offsets that change
  cut count) — exact and fast (TileCalculator).

### 3.3 `lib/tileCalc/` — purchase & cut sheet

- `tiles.ts` — full/cut/corner counts; **Safe** = full + one-per-cut; **With
  reuse** = full + `ceil(totalCutArea / tileArea)` refined by offcut pairing.
  (Note: TileCalculator has two reuse paths — `interlockReuse` pairing vs a
  `ceil(cutCoveredArea/tileArea)` fallback; we mirror that distinction, not a
  single formula.)
- `reuse.ts` — offcut pool: first-fit (practical) vs best-fit-decreasing
  (optimize), grain-lock for planks, sliver threshold (tiletakeoff's `cutEngine`
  model). Gated behind `reuse_mode`, auto-downgraded to `none` for patterns whose
  fragment geometry is only AABB-approximate.
- `cutsheet.ts` — per-room summary, consolidated batch list, tile-by-tile
  offcut→cut mapping, L-cut rows.
- `borders.ts` — per-side trim LF, piece count `ceil(len/piece)`, outside/inside
  corner counts (convex/reflex).
- `grout.ts` — grout quantity from the layout's actual joint length, extending
  `coverage.js` (which already has the area/LF grout math).

### 3.4 `lib/tileEdges/` — trim & sundries derivation

- Exposure model: per-shape-edge `{shapeEdgeIndex, length_lf, exposure:
  free | wall | opening | finish_transition, finish_neighbor?, user_override?}`.
- **Exposure is suggested + confirmed, not auto-derived.** Flood-traced rooms do
  not share edges; `transitions.ts` proves proximity — not shared edges — is all
  that distinguishes butt from wall-separated, and wall-separated thresholds are
  withheld as human questions. Default an edge to `free`/`unknown` until the
  estimator tags it; auto-suggest only high-confidence cases (ring segment
  coincident with the plan's exterior hull). Reuse `derive_transitions` proximity
  for `finish_transition` candidates, never auto-commit trim LF.
- Threshold derivation reuses `transitions.ts` (butt vs wall), with a trim
  material instead of a transition condition.
- Borders/bands/listellos: offset the interior polygon and lay a band pattern
  (separate from perimeter trim — the band consumes field area).

### 3.5 `lib/tileWall/` — wall field (the vertical projection)

- Split in two: (1) **strip projection** — a straight `surface_area` run × height
  becomes a 2D elevation rectangle, on which the floor pattern engine runs; (2)
  **elevation model** — courses, bands, opening/niche cutouts as explicit holes —
  a later sub-module. "Floor tile on a rectangle" is only true for (1); it must
  not be claimed for openings/multi-course/panels.
- `surface_area` today is plan LF × `height_ft` (`totals.js`); it carries no
  elevation openings. Those are new geometry.
- Multi-course base reuses `coverage.js` `baseGroutParams`/`baseCourses` (grout
  math only — piece layout is the elevation model).

### 3.6 `lib/tileCurb/` — wrapped 3D surfaces (2D-source-of-truth)

- A curb is a linear feature + cross-section profile `{width, height}`. Faces:
  top = LF × width, two sides = LF × height each; corner and end-cut pieces.
- Straight-profile first; L-plan/radius curbs need a developed (unfolded) net —
  a separate module (`tileCurb/develop.ts`) built later. Niches ride the wall
  elevation model, not the curb milestone.

### 3.7 Layout lifecycle — recompute & invalidation

A layout is a pure function of `(tile_setup, shape geometry, holes, scale)`.
Recompute triggers and what persists vs resets must be specified up front:

- **Recompute on:** `tile_setup` edit, origin/rotation change, `verts_norm`
  change, scale change, deduct/cutout change (holes enter the layout), twin SKU
  edit, import merge.
- **Persist vs reset:** per-room `shape.tile_layout` (origin/rotation/cut_sides/
  edge_overrides) persists across pure zoom; resets when the `verts_norm` hash or
  `tile_setup` hash changes (stale overrides are dropped, like roll's `laneCount`
  guard but keyed on vertex + setup hash for the 2D case).
- **Multi-sheet / stitch / match-line:** a layout stops at a sheet boundary. A
  stitched room (`stitches.ts`) is one composite surface for tracing, but a
  seam-crossing tile layout needs an explicit human seam — we do not auto-join
  layouts across a match line (the existing match-line doctrine). Tile layout
  runs per member sheet by default; a stitch carries an explicit origin offset,
  and a seam-crossing room is flagged for the estimator to resolve.

---

## 4. Integration into OpenTakeoff

### 4.1 Data model — where tile lives

`tile_setup` is an **opt-in object on the condition**, exactly like `roll_setup`:

```
tile_setup: {
  pattern, origin, rotation, edge_strategy,
  skus: [{ id, name, w, h, color, image?, glossiness? }],
  joint, grout: { color? },
}
```

- **Presence gates the feature** and corrupt payloads read as opted *out* at
  runtime via defensive coercion (`hasRollSetup()` in `rollTakeoff.js:24-30` is
  the precedent) — there is **no load-time sanitizer**; tile_setup uses the same
  runtime-guard + export-passthrough strategy, plus an explicit validation rule.
- **Twin / duplicate / library copy is one-time, not propagating.** `mintTwin`
  spreads the parent and `instantiateTemplate` deep-copies the setup object, so
  `tile_setup` copies once at twin creation / library attach. `variants.ts`
  propagation (row-level add/remove/revert) applies to **materials rows only**,
  not condition-level setup objects — there is no per-SKU `origin_id`/`inherited`/
  revert machinery today. Either build SKU-level propagation explicitly (later in
  the path) or accept independent per-variant copies; do not claim it is free.
- **Grout material references `tile_setup`** for size/joint — but "no drift" is
  only true if field grout (basis `area`) is **derived-only** when `tile_setup`
  is present (like `seam_lf` requires a roll layout): recompute `per` on every
  layout solve; a hand-edited `per` requires an explicit "detach from tile_setup"
  flag. Merely *storing* the geometry in one place does not stop a hand edit from
  diverging (`coverage.js` `groutRateStale` covers base-height, not this).
- **Per-room layout state** lives on the shape as a versioned `shape.tile_layout`
  sub-object (parallel to `roll_layout`): `{ origin?, rotation?, cut_sides?,
  edge_overrides? }` — origin/rotation/cut-sides/edge-trim all in one place, not
  scattered. Invalidated on `verts_norm` hash or `tile_setup` hash change.
- Sanitized at the version boundary: `takeoff_canvas.v1` + `report.v1` gain
  `tile_setup`, `tile_layout`, and the layout snapshot; additive-only per the
  existing schema rules.

### 4.2 Canvas — the focus-on-a-shape flow

1. Select a committed shape (a room's floor polygon).
2. Zoom into it — crispness comes from the existing zoom rendering; the tile grid
   itself is **always-on SVG ink** (like roll cuts, toggled), **not gated by
   `DETAIL_ENGAGE`** (which the #86 tile-pyramid refactor already retired as a
   gate — `TakeoffCanvas.jsx` notes detail is "active at every zoom level").
3. A new **tile-grid overlay** draws the layout on that shape (full solid, cut
   tinted, hole flagged, corner marked, trim edges inked, origin crosshair) — the
   same overlay mechanics as roll cuts (`rollShow` → SVG over rooms).
4. A **docked Tile panel** (Roll-panel pattern) carries the setup controls.
5. Origin drag / rotation / edge tagging commit one undoable command per gesture
   (the `rollcut`/`shapeCommands` pattern, generalized to `tileset`/`tileedge`).

**Hatch vs overlay:** a condition with `tile_setup` *replaces* its hatch with the
tile grid at detail zoom (the grid *is* the appearance), while the hatch remains
the overview/print fill at small zoom; the Marked Set draws the tile field at the
same scale rule. This coexistence + LOD threshold is a §6 decision.

### 4.3 Report — layout-derived quantities (three paths, not one)

Roll goods surface figured quantities through **three parallel seams**, and tile
must mirror all three (the doc previously claimed only the `ctx`):

1. `conditionTotals(conditions, shapes, ctx)` — the `ctx.seamByShape` precedent:
   a `tileByCondition` map carries full/cut/corner counts, trim LF, corner EA so
   supporting-materials rows (grout, trim adhesive) divide against figured bases.
2. `reportColumns.js` — supplemental columns fed by `ctx.rollByCond` (the
   `ROLL_FIELDS` pattern): `tile:*` columns for counts/trim/waste.
3. `reportJson` — a top-level `tile[]` block (the `roll_goods[]` pattern) in
   `report.v1`, plus the cut-sheet/trim schedule and the layout snapshot.

**Cut sheet in the Marked Set is forward scope**: `markedset.js` today renders
shapes + annotations + legend, not layout schedules. The scale-accurate tile
layout sheet (below) is its own export, not a Marked Set patch.

**Scale-accurate layout sheet** (§2.H, the install deliverable): the tile grid,
cut pieces with dimensions, trim lines, and corner positions burned at true
scale, reusing the existing scale-accurate paths — `markedset.js` for PDF and
`export_dxf` for CAD. This is what a tiler actually installs from; it rides the
same layout snapshot the report uses, so the drawing and the order agree.

### 4.4 MCP — headless parity, staged into the path

`edit_condition` accepts `tile_setup` (as it does `roll_setup`: null opts out,
partial patch merges). Rather than one monolithic parity milestone, tile's MCP
surface lands incrementally alongside the canvas: `tile_setup` sanitize +
round-trip early; `export_report` tile counts with the purchase milestone;
`export_takeoff` layout snapshot with the overlay milestone; agent *audit*
workflows (withheld/refusal parity) last.

---

## 5. Build path — milestones to the complete feature

Ordered by dependency; each milestone is a coherent, usable increment, and
together they reach every row of §2. This is a path, not a cap. MCP is staged
through the path (not deferred to the end), and offcut reuse lands *after* the
overlay so layouts can be visually audited before reuse math is trusted.

1. **Data model + runtime guard + seed + MCP round-trip.** `tile_setup` on the
   condition, SKUs, joint presets, grout reference; `CT-1` seed gains a real
   `tile_setup`; `hasTileSetup()` runtime guard; versioned into
   `takeoff_canvas.v1`/`report.v1`; `edit_condition` accepts `tile_setup` +
   round-trips it.
2. **Layout contract + pattern engine + classification (pure, tested).**
   `tilePitch.ts` (nominal/pitch/installed-face) + `tilePatterns` (lattice +
   offset + diagonal + herringbone + basketweave) + `tileGeometry`
   (`polygon-clipping`, full/cut/hole/corner, L-cut). Unit tests incl. the
   pitch/face invariants and deterministic-recompute.
3. **Safe purchase + cut sheet + waste (pure, no reuse yet).** `tileCalc`:
   Safe (full + one-per-cut), cut sheet, pattern-aware waste%. `export_report`
   gains tile counts. (Offcut reuse is the *next* milestone, not this one.)
3b. **With-reuse (gated).** `reuse.ts` offcut pool behind `reuse_mode:
   none | practical`, auto-downgraded for AABB-approximate patterns.
4a. **Perimeter trim + corners + thresholds (pure).** `tileEdges` exposure
   record (suggested + confirmed), per-side trim LF, corner counts; threshold
   reuse of `transitions.ts`.
4b. **Interior bands / listellos** (field inset + band pattern) — after the
   overlay proves the perimeter flow.
5. **Canvas overlay + focus flow + undo + hatch coexistence.** Select → zoom →
   always-on SVG overlay → docked panel → origin/rotation/edge-tagging undo
   commands. `export_takeoff` gains the layout snapshot.
6. **Report + export integration.** Three-path quantities (ctx + columns +
   reportJson), cut sheet in CSV/XLSX/`report.v1`, and the **scale-accurate tile
   layout sheet** (PDF via `markedset.js`, DXF via `export_dxf`).
7. **Remaining patterns.** Motif (chevron/pinwheel/harlequin), modular/Versailles
   (per-quad `skuId`), non-rect (hex/penny), randomized (seeded) — each a new
   generator + registration + tests.
8a. **Wall strip projection.** `tileWall` (1): straight run × height → elevation
   rectangle, same engine.
8b. **Wall elevation model.** `tileWall` (2): courses, bands, opening/niche
   cutouts as holes.
9a. **Straight curb.** `tileCurb` profile faces + end cuts.
9b. **Developed curb nets.** L-plan/radius (`tileCurb/develop.ts`); niches ride
   the wall elevation model.
10. **MCP agent audit parity.** Withheld/refusal parity, layout audit workflow —
   the agent-facing half, after the canvas path is proven.

Milestones 1–6 make a tiler productive on floor tile with cuts + trim + a
scale-accurate layout sheet; 7–10 reach the complete set. No milestone is "out of
scope" — later in the path is not smaller in ambition.

---

## 6. Genuinely-open decisions (few, real — not scope hedges)

1. **SKU images** — tile images (TileSim) vs plain color only. Color keeps the
   engine deterministic and the marked set clean; images serve client
   visualization. Where in the path do images land?
2. **Randomized layout + determinism** — `madum-ts`-class percentage packing
   breaks the "same input → same layout" rule unless it takes a seeded PRNG.
   Is randomization core, or a later seeded delight?
3. **Curb representation** — 2D linear-feature + profile (canvas stays the single
   source of truth) vs a true 3D surface editor (TileSim has one). The design
   assumes the former; confirm.
4. **Exposure auto-suggest aggressiveness** — how far auto-suggestion goes
   (exterior-hull coincidence only, vs more) before the estimator confirms;
   the override UX.
5. **Multi-sheet / match-line policy** — confirmed as "layout stops at sheet
   boundary; stitched rooms flag a seam for the estimator" (§3.7), but the
   per-stitch origin-offset UX is open.
6. **Hatch ↔ overlay LOD threshold** — at what zoom the hatch gives way to the
   tile grid, and whether the Marked Set always draws the grid at scale.
7. **Origin applicability table** — exact per-pattern behavior (grid/brick/
   diagonal honor origin; herringbone/basketweave ignore it; modular is
   cell-anchored) needs a concrete table, not prose.
8. **Order-unit / box rounding** — which SKU drives the order when modular, and
   the EA-vs-SF rounding rule downstream of tile count.
9. **Accent replacement + install phasing** — in the taxonomy but not yet placed
   in the path; an explicit later-phase statement is needed, not silence.
