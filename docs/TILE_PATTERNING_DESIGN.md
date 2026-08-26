# Tile Patterning — structured feature set & design

Status: design, revised after two adversarial-review rounds. This defines the
**complete** feature, integrated cohesively into OpenTakeoff, and a build path
that reaches all of it. Starting simple is a build *order*, not a target —
nothing here is a scope cap.

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
the scale-accurate Marked Set (and DXF export via `export_dxf`, once merged
forward from `main` — see §4.3), and the MCP `edit_condition` pattern.

---

## 2. The complete feature set

Grouped by domain. Each row names where the logic lives (module) and where it
surfaces (integration point). Every row has a milestone in §5.

Surfaces marked *panel*/*overlay* for a capability whose milestone is a `(pure)`
engine milestone (M2–M4) come online with the canvas at M5; the milestone shown
is where the computation lands.

### A. Tile definition — what a tile *is*

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Tile SKUs: name, W×H, color, glossiness, image(s) | `tile_setup.skus[]` | docked panel, marked set, report | 1 |
| Multiple SKUs per pattern (rect + square, Versailles, accent) | pattern engine (§3.1) | docked panel | 1 / 9 |
| Mixed laying from images or plain color | `tile_setup.skus[].images[]` | docked panel, overlay | 1 (color) / §6.1 (images) |
| Tile catalog / library (size families, presets) | seed + library (like `FLOORING_DEFAULTS`) | condition library, panel | 1 |
| Grout: preset sizes + custom, width + color | `tile_setup.joint`, `grout` | docked panel | 1 |

### B. Pattern engine — how tiles are laid

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Straight grid | `patterns` lattice | overlay, panel | 2 |
| Running bond (50% / 33% offset) | `patterns` offset | overlay, panel | 2 |
| Diagonal 45° | `patterns` diagonal | overlay, panel | 2 |
| Herringbone (gap-free via derived grid vectors **for 2:1 tiles; non-2:1 warns**) | `patterns` herringbone | overlay, panel | 2 |
| Basketweave | `patterns` basketweave | overlay, panel | 2 |
| Chevron, pinwheel/hopscotch, harlequin | `patterns` (motif) | overlay, panel | 9 |
| Modular / Versailles (multi-size super-cell) | `patterns` modular (per-quad `skuId`) | overlay, panel | 9 |
| Non-rectangular (hex, penny, octagon+dot) | `patterns` nonrect | overlay, panel | 9 |
| Randomized / percentage layout (seeded) | `patterns` random | overlay, panel | 9 |
| Accent tile replacement (swap a running tile for an accent SKU in a rhythm) | `patterns` + `tile_setup.skus` | panel, overlay | 9 |
| Extensibility: interface + registry | `patterns/registry.ts` | — | 2 |

### C. Layout control — where and how the field sits

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Origin (drag on canvas + numeric) | `tile_setup.origin` | overlay crosshair, panel | 5 |
| Rotation | `tile_setup.rotation` | panel, overlay | 5 |
| Edge-cut strategy (full-corner / centered band / optimized) | `geometry/optimize.ts` | panel, overlay | 3 / 5 |
| Auto-optimize offset (edge-aligned search, minimize cuts) | `geometry/optimize.ts` | panel | 3 |
| Mark a side as a "cut side" | `shape.tile_layout.cut_sides` | overlay (edge click) | 5 |
| Per-room override of origin/rotation | `shape.tile_layout` | overlay, panel | 5 |

### D. Cut accounting — what actually gets ordered

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Full / cut / hole classification (polygon intersection) | `geometry` | overlay (shading) | 2 |
| Corner-piece classification (edge-contact) | `geometry` | overlay, cut sheet | 2 |
| L-cut notches (full tile + sawn corner notch) | `geometry` + cut sheet | cut sheet | 2 |
| Purchase: *Safe* (full + one-per-cut) | `calc/tiles` | panel, report | 3 |
| Purchase: *With reuse* (offcut pool, grain-lock, sliver threshold) | `calc/reuse` | panel, report | 6 |
| Cut sheet (per-room, consolidated batch, offcut→cut map) | `calc/cutsheet` | report, marked set | 3 / 8 |
| Hole cut accounting (hole straddles → cut tile) | `geometry` | panel, report | 2 |

### E. Trim & sundries — the edges

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Per-side trim assignment (trim/bullnose/cove/profile/threshold) | `edges` | overlay (edge click), panel | 4 |
| Trim LF + piece count (`ceil(len/piece)`) | `calc/borders` | panel, report | 4 |
| Outside/inside corner counts (convex/reflex) | `calc/borders` | panel, report | 4 |
| Bullnose types (surface/radius/double/corner three-way) | `tile_setup` + `edges` | panel | 4 |
| Cove base tile (sanitary), distinct from resilient `RB-1` | `edges` | panel, report | 4 |
| Marble thresholds at doorways/finish transitions | `edges` + reuse `transitions.ts` | overlay, report | 4 |
| Borders / bands / listellos / accent strips (interior) | `edges` (offset interior polygon) | overlay, panel | 7 |
| Grout-from-layout (joint length × geometry, not area factor) | `calc/grout` + `coverage.js` | report | 3 |

### F. Wall tile — the vertical field

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Surface-area ring → elevation strip (unwrap) | `wall` (strip) | overlay, panel | 10 |
| Openings / niches as holes in the strip | `wall` (elevation) | overlay | 11 |
| Multi-course base (cove/bullnose courses) | `wall` + `coverage.js` | panel, report | 11 |
| Wall panels / stacked bands | `wall` (elevation) | overlay, panel | 11 |

### G. Curb & wet-area assembly — wrapped surfaces & waterproofing

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Curb as linear feature + cross-section profile | `curb` | overlay, panel | 12 |
| Per-face pieces (top, two sides), corner/end cuts | `curb` | cut sheet, report | 12 |
| Developed net for L-plan / radius curbs | `curb/develop.ts` | overlay | 13 |
| Niches (recessed boxes) | `wall` (elevation) | overlay, panel | 11 |
| Waterproofing / uncoupling membrane SF (wet-area walls + pan floor) | `wetArea` | report | 11 |
| Slope-to-drain / pre-slope mud bed (shower pan floor) | `wetArea` | overlay, report | 13 |
| Prefab pan / curb / bench systems (Wedi/Kerdi) as EA alternative | `wetArea` | panel, report | 13 |

### H. Quantities & export — the deliverable

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Tile counts, trim LF, corner EA, grout in Report/CSV/XLSX | `totals.js` `ctx` + `reportColumns` | report | 3 / 8 |
| Cut sheet and trim schedule | `calc/cutsheet` + `markedset.js` | report, marked set | 8 |
| `report.v1` fields (tile counts, layout snapshot, trim edges) | `reportJson` | JSON export | 8 |
| Waste-from-layout (**supersedes** heuristic `waste_pct`, see §4.1) | `calc` + `totals.js` | report | 3 |
| **Scale-accurate tile layout sheet** (grid + cuts w/ dims + trim + corners at true scale) | `markedset.js` (PDF); `export_dxf` (DXF, post-rebase) | PDF now / DXF after rebase | 8 |
| Install phasing (group rooms into phases; per-phase quantities) | report grouping (existing) | report | 8 |
| Labor ROM as a *quantity* (complexity-weighted labor SF + cut/corner/trim/joint driver counts; no $, priced externally) | `calc` + existing labor field | report (Labor view) | 8 |

### I. Interaction — the tool in the estimator's hands

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Focus-on-a-shape: select → zoom → grid appears | canvas | — | 5 |
| Tile-grid overlay (always-on SVG like roll cuts, not detail-gated) | canvas overlay | — | 5 |
| Docked setup panel (Roll-panel pattern) | `TilePanel` | — | 5 |
| Origin drag / rotation / edge tagging, one undoable command per gesture | `shapeCommands` | — | 5 |
| Hatch ↔ overlay coexistence (overview vs close zoom) | canvas + `hatches.jsx` | — | 5 |

### J. MCP / headless

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| `tile_setup` on `edit_condition` (like `roll_setup`) | MCP `edit_condition` | — | 1 |
| Headless layout + cut sheet + trim for agents | engine (pure) | `export_report`, `export_takeoff` | 3 / 5 |
| Agent audit (withheld/refusal parity) | engine + MCP | — | 14 |

### K. 3D visualization — client preview & wrap validation

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| 3D scene: extrude committed rooms → floor / walls / ceiling from polygon + `height_ft` | `tile3d` (`three/`) | 3D view | 15 |
| Tiled surfaces: drape the figured `tile_layout` as textures on floor/wall/curb faces | `tile3d` | 3D view | 15 |
| Orbit / zoom / pan; same scene as the plan (read-only consumer of 2D truth) | `tile3d` | 3D view | 15 |
| Client-presentation still / image export | `tile3d` | 3D view / image | 15 |

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

- **`nominalQuad`** — the tile *face*, `w × h`, no grout. Face area / coverage.
- **`pitchCell`** — `(w+j) × (h+j)`, the repeat distance. Generator placement.
- **`installedFace`** — `nominalQuad` inset by `j/2` per side, the visual face
  inside its grout gap.

Rules (four consumers, unambiguous):
1. **Generator** emits `pitchCell` spacing.
2. **Classification** (full / cut / out) tests `pitchCell` against the room.
3. **Cut-piece dimensioning** — every measured cut-piece size and offcut area
   that purchase, cut sheet, and reuse consume — is taken from the
   **`installedFace` fragment** (inset `max(j/2, ε·min(w,h))`, companion §7.2),
   **never** the grout-inclusive `pitchCell`, or cut SF is inflated by grout.
4. **Rendering + Marked Set** draw `installedFace`; coverage area uses
   `nominalQuad`.

Grout never appears inside a generator (TileSim's answer to "joint included vs
not"); the pitch↔face conversion lives in exactly one module, so the drawn field
and the ordered quantity cannot disagree.

### 3.1 `lib/tilePatterns/` — the pattern engine

- `types.ts` — `TileSetup`, `TileSku`, `TileQuad {cx,cy,w,h,rot,sku}` where
  **`w,h` are `pitchCell` extents**; the drawn/measured face is
  `installedFace(quad)` and coverage area is `nominalQuad(quad)` (§3.0). The
  struct never carries a raw ungrouted face directly.
- `pattern.ts` — `PatternGenerator` interface: `generate(bounds, setup) → TileQuad[]`.
- `registry.ts` — name → generator; a new pattern is a new file + registration.
- Generators: `lattice` (grid), `offset` (brick), `diagonal`, `herringbone`,
  `basketweave`, `motif` (chevron/pinwheel/harlequin), `modular` (multi-SKU,
  per-quad `skuId`), `nonrect` (hex/penny), `random` (seeded PRNG — §6).
- Deterministic: same inputs → same layout (`random` takes a seed).
- **Origin applicability is pattern-specific** (the `tiletakeoff` finding — not
  every pattern honors a free origin):

  | Pattern | Origin | Rotation |
  |---|---|---|
  | grid, brick_50, brick_33 | honored | honored |
  | diagonal | honored | fixed 45° |
  | herringbone, basketweave | interlock-derived; free origin ignored | n/a |
  | modular | cell-anchored | per cell |
  | nonrect (hex/penny) | honored | pattern-fixed |

### 3.2 `lib/tileGeometry/` — classification & fragments

- Boolean geometry via `polygon-clipping` (Martinez–Rueda, `mfogel`) — robust
  cell∩room intersection, not hand-rolled Sutherland–Hodgman.
- `classify(cell, room, holes) → full | cut | hole | out`; corner = edge-contact,
  not corner point-in-polygon (misreads diagonal slivers).
- Cut fragments: the clipped footprint intersected with the **`installedFace`**
  (not the pitch cell, §3.0) → cut-piece dimensions and offcut area for
  purchase / cut sheet / reuse; L-cut detection (full-extent tile with a
  rectangular corner notch).
- Hole detection: a tile straddling a hole is a cut tile (consumes a full tile).
- Origin optimization: search only edge-aligned offsets (the offsets that change
  cut count) — exact and fast (TileCalculator).

### 3.3 `lib/tileCalc/` — purchase & cut sheet

- `tiles.ts` — full/cut/corner counts; **Safe** = full + one-per-cut; **With
  reuse** = full + `ceil(totalCutArea / tileArea)` refined by offcut pairing.
  (TileCalculator has two reuse paths — `interlockReuse` pairing vs a
  `ceil(cutCoveredArea/tileArea)` fallback; we mirror both, not a single formula.)
- `reuse.ts` — offcut pool: first-fit (practical) vs best-fit-decreasing
  (optimize), grain-lock for planks, sliver threshold (tiletakeoff's `cutEngine`).
  Gated behind `reuse_mode`, auto-downgraded to `none` for patterns whose
  fragment geometry is only AABB-approximate.
- `cutsheet.ts` — per-room summary, consolidated batch list, tile-by-tile
  offcut→cut mapping, L-cut rows.
- `borders.ts` — per-side trim LF, piece count `ceil(len/piece)`, outside/inside
  corner counts (convex/reflex).
- `grout.ts` — grout quantity from the layout's actual joint length, extending
  `coverage.js`.

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
  **elevation model** — courses, bands, opening/niche cutouts as explicit holes.
  "Floor tile on a rectangle" is only true for (1); it must not be claimed for
  openings/multi-course/panels.
- `surface_area` today is plan LF × `height_ft` (`totals.js`); it carries no
  elevation openings. Those are new geometry.
- Multi-course base reuses `coverage.js` `baseGroutParams`/`baseCourses` (grout
  math only — piece layout is the elevation model).

### 3.6 `lib/tileCurb/` + `lib/tileWetArea/` — curb & wet-area assembly (2D source of truth)

- A curb is a linear feature + cross-section profile `{width, height}`. Faces:
  top = LF × width, two sides = LF × height each; corner and end-cut pieces.
- Straight-profile first; L-plan/radius curbs need a developed (unfolded) net —
  `tileCurb/develop.ts`, built later. Niches ride the wall elevation model.
- **Wet-area assembly** (`lib/tileWetArea/`): waterproofing/uncoupling **membrane
  SF** derived from the wet-area wall + pan geometry we already compute (M11);
  **slope-to-drain / pre-slope mud-bed** for the pan floor and **prefab
  pan/curb/bench systems** (Wedi/Kerdi) as an EA alternative to a mud bed (M13).
  This is the resolved wet-area scope decision (§8.2): the feature owns the full
  assembly bid, not just the tile.

### 3.7 Layout lifecycle — recompute & invalidation

A layout is a pure function of `(tile_setup, shape geometry, holes, scale,
stitch placement)`. Triggers and persistence:

- **Recompute on:** `tile_setup` edit, origin/rotation change, `verts_norm`
  change, scale change, deduct/cutout change (holes), twin SKU edit, import
  merge, **stitch alignment / origin-offset change**, and edge-trim / cut-side
  edits on `shape.tile_layout`.
- **Persist vs reset:** per-room `shape.tile_layout` persists across pure zoom;
  resets when the `verts_norm` hash, `tile_setup` hash, or **stitch layout
  signature** (`stitchLayoutSig`) changes — stale overrides dropped (roll's
  `laneCount` guard, keyed on vertex + setup + stitch for the 2D case).
- **Multi-sheet / stitch / match-line:** a layout stops at a sheet boundary. A
  stitched room (`stitches.ts`) is one composite surface for tracing, but a
  seam-crossing tile layout needs an explicit human seam — we do not auto-join
  layouts across a match line (existing doctrine). Tile layout runs per member
  sheet by default; a stitch carries an explicit origin offset; a seam-crossing
  room is flagged for the estimator.

### 3.8 `lib/tile3d/` + `three/` — 3D visualization (read-only consumer)

- A **visualization layer, not a source of truth.** It reads committed room
  polygons, `height_ft`, `tile_setup`, and the figured `tile_layout`, extrudes
  the rooms (floor/walls/ceiling) and drapes the layout as textures — exactly
  TileSim's and tiletakeoff's approach (three.js / react-three-fiber). The 2D
  plan stays authoritative for every quantity, scale, and cut; the 3D view never
  originates geometry or counts.
- Value: client presentation, and validating wrap geometry (curbs, niches, wall
  coursing) that is hard to judge from an unwrapped 2D elevation.
- Lazy-loaded chunk (three.js is heavy), like TileSim's lazy 3D scene.

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
  runtime via defensive coercion (`hasRollSetup()` in `rollTakeoff.js:27-30` is
  the precedent) — **no load-time sanitizer**; `tile_setup` uses runtime-guard +
  export-passthrough, plus an explicit validation rule.
- **Twin / duplicate / library copy is one-time, not propagating.** `mintTwin`
  spreads the parent and `instantiateTemplate` deep-copies the setup, so
  `tile_setup` copies once. `variants.ts` propagation applies to **materials
  rows only**, not condition-level setup objects — no per-SKU inherited/revert
  machinery exists today. Either build SKU-level propagation explicitly (later in
  the path) or accept independent per-variant copies; it is not free.
- **Grout material references `tile_setup`**, and field grout (basis `area`)
  becomes **derived-only** when `tile_setup` is present (like `seam_lf` requires
  a roll layout): recompute `per` on every layout solve; a hand-edited `per`
  needs an explicit "detach from tile_setup" flag. Storing geometry in one place
  alone does not stop a hand edit from diverging (`coverage.js` `groutRateStale`
  covers base-height only).
- **Layout refines the margin, it does not remove it.** When `tile_setup` is
  present the figured Safe / With-reuse counts replace the *pattern-heuristic*
  `waste_pct` (no double-count of layout waste) — but a **residual contingency
  still applies on top**: breakage in transit and on the saw, warped/rejected
  pieces, dye-lot reorder risk, plus attic stock. Order qty = figured count ×
  (1 + breakage%) + attic stock, rounded up to whole boxes/cartons on one dye
  lot (`calc/order.ts`, §8). Stripping all margin because the cut count is exact
  is *more precise but less safe* than a real PO. `waste_pct` is the sole basis
  only for opted-out tile conditions and non-tile conditions.
- **Per-room layout state** lives on the shape as a versioned `shape.tile_layout`
  sub-object (parallel to `roll_layout`): `{ origin?, rotation?, cut_sides?,
  edge_overrides? }`. Invalidated on `verts_norm` hash, `tile_setup` hash, or
  `stitchLayoutSig` change.
- Sanitized at the version boundary: `takeoff_canvas.v1` + `report.v1` gain
  `tile_setup`, `tile_layout`, and the layout snapshot; additive-only.

### 4.2 Canvas — the focus-on-a-shape flow

1. Select a committed shape (a room's floor polygon).
2. Zoom into it — crispness comes from the existing zoom rendering; the tile grid
   itself is **always-on SVG ink** (like roll cuts, toggled), **not gated by
   `DETAIL_ENGAGE`** (the #86 tile-pyramid refactor already retired that gate —
   `TakeoffCanvas.jsx:1913-1926`).
3. A new **tile-grid overlay** draws the layout (full solid, cut tinted, hole
   flagged, corner marked, trim edges inked, origin crosshair) — the same
   overlay mechanics as roll cuts.
4. A **docked Tile panel** (Roll-panel pattern) carries the setup controls.
5. Origin drag / rotation / edge tagging commit one undoable command per gesture
   (the `rollcut`/`shapeCommands` pattern, generalized to `tileset`/`tileedge`).

**Hatch vs overlay:** a condition with `tile_setup` *replaces* its hatch with the
tile grid past an **LOD swap threshold** (a distinct mechanism from the retired
`DETAIL_ENGAGE` raster gate); the hatch stays the overview/print fill below it.
The threshold value and Marked-Set behavior are a §6 decision.

### 4.3 Report — layout-derived quantities (three paths, not one)

Roll goods surface figured quantities through **three parallel seams**; tile
mirrors all three (verified: `totals.js:57-78`, `reportColumns.js:230-252`,
`totals.js:490,578-584`):

1. `conditionTotals(..., ctx)` — a `tileByCondition` map (the `ctx.seamByShape`
   precedent) carries counts/trim/corners so supporting-materials rows divide
   against figured bases.
2. `reportColumns.js` — supplemental `tile:*` columns fed by `ctx.tileByCond`
   (the `ROLL_FIELDS`/`rollColProfile` pattern).
3. `reportJson` — a top-level `tile[]` block (the `roll_goods[]` pattern) in
   `report.v1`, plus cut-sheet/trim schedule and layout snapshot.

**Scale-accurate layout sheet** (§2.H, the install deliverable): the tile grid,
cut pieces with dimensions, trim lines, and corner positions burned at true
scale. **PDF works today** via `markedset.js` (already scale-accurate). **DXF is
a merge-forward dependency**: `export_dxf` lives on `main`; `feat/tile-patterning`
is behind main and must rebase to pick it up. The cut sheet burned into the
Marked Set is likewise forward scope (`markedset.js` renders shapes + annotations
+ legend + an RFI schedule page today, but no tile cut-sheet schedule). Both ride
the same layout snapshot the report uses, so drawing and order agree.

### 4.4 MCP — headless parity, staged into the path

`edit_condition` accepts `tile_setup` (as it does `roll_setup`: null opts out,
partial patch merges). MCP lands incrementally: `tile_setup` sanitize +
round-trip (M1); `export_report` tile counts (M3); `export_takeoff` layout
snapshot (M5); agent *audit* workflows (M14).

---

## 5. Build path — milestones to the complete feature

Ordered by dependency; each milestone is a coherent, usable increment, and
together they reach every §2 row (the Milestone column in §2 is the map). This
is a path, not a cap. Offcut reuse (M6) and interior bands (M7) deliberately land
**after** the canvas overlay (M5), so layouts are visually auditable before
reuse math and band geometry are trusted. MCP is staged through the path.

1. **Data model + runtime guard + seed + MCP round-trip.** `tile_setup` on the
   condition (SKUs, joint presets, colors, grout reference); `CT-1` seed gains a
   real `tile_setup`; `hasTileSetup()` runtime guard; versioned into
   `takeoff_canvas.v1`/`report.v1`; `edit_condition` accepts + round-trips it.
2. **Layout contract + pattern engine + classification (pure, tested).**
   `tilePitch.ts` (nominal/pitch/installed-face) + `tilePatterns` (lattice,
   offset, diagonal, herringbone, basketweave) + `tileGeometry`
   (`polygon-clipping`, full/cut/hole/corner, L-cut). Tests: pitch/face
   invariants, installed-face cut-piece dimensioning, deterministic recompute.
3. **Safe purchase + cut sheet + waste + grout-from-layout (pure).** `tileCalc`
   Safe (full + one-per-cut), cut sheet, pattern-aware waste%, and grout-from-
   layout joint length. `export_report` tile counts. Layout supersedes
   `waste_pct` (§4.1). No reuse yet.
4. **Perimeter trim + corners + thresholds + bullnose/cove (pure).**
   `tileEdges` exposure record (suggested + confirmed) + `calc/borders` per-side
   trim LF and corner counts; bullnose types + cove base SKUs; threshold reuse
   of `transitions.ts`.
5. **Canvas overlay + focus flow + undo + hatch coexistence.** Select → zoom →
   always-on SVG overlay → docked panel → origin/rotation/edge-tagging undo
   commands; LOD hatch swap. `export_takeoff` layout snapshot.
6. **With-reuse (gated), after the overlay.** `reuse.ts` offcut pool behind
   `reuse_mode: none | practical`, auto-downgraded for AABB-approximate patterns.
7. **Interior bands / listellos, after the overlay.** Field inset + band pattern.
8. **Report + export integration.** Three-path quantities (ctx + columns +
   reportJson), cut sheet in CSV/XLSX/`report.v1`, the **scale-accurate tile
   layout sheet** (PDF now; DXF once the branch rebases onto main's `export_dxf`),
   and the **labor ROM quantity** (complexity-weighted labor SF + driver counts)
   into the Labor view — a quantity, never a dollar.
9. **Remaining patterns.** Motif (chevron/pinwheel/harlequin), modular/Versailles
   (per-quad `skuId`), non-rect (hex/penny), randomized (seeded) — each a new
   generator + registration + tests.
10. **Wall strip projection.** `tileWall` (1): straight run × height → elevation
    rectangle, same engine.
11. **Wall elevation model + wet-area membrane.** `tileWall` (2): courses, bands,
    opening/niche cutouts as holes; multi-course base; niches; **waterproofing /
    uncoupling membrane SF** for wet-area walls + pan.
12. **Straight curb.** `tileCurb` profile faces + end cuts.
13. **Developed curb nets + wet-area pan.** L-plan/radius (`tileCurb/develop.ts`); **slope-to-drain / pre-slope mud bed**; **prefab pan/curb/bench (Wedi/Kerdi) as an EA alternative**.
14. **MCP agent audit parity.** Withheld/refusal parity, layout audit workflow.
15. **3D visualization (read-only).** `lib/tile3d/` + a lazy `three/` view:
    extrude committed rooms, drape the figured layout as textures on floor /
    wall / curb faces, orbit/zoom/pan, still export. Reads the 2D layout;
    originates nothing.

Milestones 1–8 make a tiler productive on floor tile with cuts, trim, reuse, and
a scale-accurate layout sheet; 9–15 reach the complete set (patterns, wall, curb,
MCP audit, and 3D visualization). No milestone is "out of scope" — later in the
path is not smaller in ambition.

---

## 6. Genuinely-open decisions (few, real — not scope hedges)

1. **SKU images** — tile images (TileSim) vs plain color only. Color keeps the
   engine deterministic and the marked set clean; images serve client
   visualization. Where in the path do images land?
2. **Randomized layout + determinism** — `madum-ts`-class percentage packing
   breaks "same input → same layout" unless it takes a seeded PRNG. Core, or a
   later seeded delight?
3. **3D fidelity / scope** — the 2D plan stays the takeoff source of truth
   (quantities, scale, cuts); a **read-only 3D visualization is in the path**
   (§2.K, milestone 15). Open: how far it goes — client-preview textures only,
   vs an editable 3D surface like TileSim's — and whether curb/niche authoring
   ever moves into it. (What is settled: 3D does not originate takeoff geometry.)
4. **Exposure auto-suggest aggressiveness** — how far auto-suggestion goes
   (exterior-hull coincidence only, vs more) before the estimator confirms.
5. **Match-line origin-offset UX** — the policy is set (layout stops at sheet
   boundary; stitched rooms flag a seam, §3.7); the per-stitch origin-offset
   interaction is open.
6. **Hatch ↔ overlay LOD threshold** — at what zoom the hatch gives way to the
   tile grid, and whether the Marked Set always draws the grid at scale.

---

## 8. Estimator review — bid-completeness (folded in)

An adversarial review by a veteran tile estimator/installer judged the *bid*,
not the geometry. Verdict: the geometry / cut / trim engine is more rigorous
than the prior art, but the design "stops where the money and the liability
are." The must-address items below are now core; the two product-scope calls it
raised are now **resolved** (§8.2).

### 8.1 Folding in as core

- **Order in purchase units, with a real margin.** Tile is bought by the box /
  carton on a single dye lot, never as loose tiles. Order qty = figured count ×
  (1 + breakage%) + attic stock, rounded up to whole boxes. `calc/order.ts`,
  milestone 3 (moved out of the §6 "open decisions"). §4.1 is corrected: the
  layout replaces the *heuristic* waste, not the breakage/contingency margin.
- **Dye-lot / attic-stock** — order to one lot; add an explicit attic-stock
  buffer for future repair. `calc/order.ts`, milestone 3.
- **Movement / expansion joints (TCNA EJ171)** — code-required soft joints at
  perimeters, ~every 20–25 ft of field, and at material transitions. A derived
  LF item, same computation shape as trim/grout derivation. `calc/joints.ts`,
  milestone 4. (A callback/liability risk if omitted, not just an under-bid.)
- **Setting & backing sundries ride the existing per-condition materials model.**
  Thinset/mortar, uncoupling/waterproofing membrane, backer board / SLU, sealer,
  leveling clips, caulk/silicone are coverage-rate lines → order qty, which
  OpenTakeoff conditions already carry (the `CT-1` seed already has thinset +
  grout). The feature seeds the tile-specific ones; no new engine — but the buy
  list must not silently omit them.
- **Material/size-aware waste, not pattern-only.** Natural stone and large-format
  routinely need 15–20%+ regardless of pattern; the waste model gains a
  material/size multiplier beside the pattern table. Milestone 3.
- **Optimizer objective is sliver-avoidance / balance, not min-cut** (§2.C/§3.2
  corrected). The edge-aligned search minimizes sub-½-tile slivers and balances
  opposing cuts — two layouts can tie on cut count while one leaves an ugly
  sliver on a sight-line wall.
- **Labor as a ROM *quantity*, never a dollar.** OpenTakeoff keeps cost/pricing
  out; labor surfaces as a *quantity* the estimator prices elsewhere. Emit a
  complexity-weighted **labor SF** (measured SF × a pattern/size factor —
  straight 1.0, diagonal ~1.2, herringbone/chevron ~1.6, large-format ~1.3,
  mosaic ~1.4) plus the raw labor drivers already computed as quantities (cut
  count, corner-piece EA, trim LF, movement-joint LF). One external $/unit
  prices them; no dollars in-app. Ties into the existing free-text labor type +
  the report's Labor-view column. Milestone 8.
- **Multi-room batch QA.** A cross-room sliver/warning list so a 40-room job is
  not audited one zoom at a time. Milestone 5.

### 8.2 Resolved scope decisions

- **Wet-area assembly — OWNED (full).** The feature takes off the whole wet-area
  assembly, not just the tile: waterproofing/uncoupling **membrane SF**,
  **slope-to-drain / pre-slope mud bed**, and **prefab pan/curb/bench systems**
  (Wedi/Kerdi) as an EA alternative — the 20–30% of a shower's dollars and its
  top liability. Folded into §2.G, §3.6 (`lib/tileWetArea/`), milestones 11 & 13.
- **Labor — ROM quantity, not cost.** Cost estimating stays out of OpenTakeoff;
  labor is emitted as a *quantity* (complexity-weighted labor SF + driver counts,
  §8.1) that external pricing multiplies by a rate. No labor-rate database, no
  dollars in-app.
