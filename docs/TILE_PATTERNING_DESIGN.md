# Tile Patterning — structured feature set & design

Status: design. This defines the **complete** feature, integrated cohesively into
OpenTakeoff, and a build path that reaches all of it. Starting simple is a build
*order*, not a target — nothing here is a scope cap.

Companion doc: `docs/TILE_PATTERNING.md` (audit, prior art, taxonomy, algorithms,
review findings). This doc synthesizes that into the thing to build.

---

## 1. Stance & goal

Goal: add tile patterning to OpenTakeoff **cohesively and complementarily** —
reusing the condition/shape/totals model, the canvas overlay, the report seam,
and the MCP surface, rather than bolting on a separate app.

The feature is large, and that is fine. It is organized here as a **structured
set of capabilities**, each mapped to a module and an integration point, with a
build path (§6) that lands them in dependency order. The complete set is §2–§4;
nothing in it is "out of scope" — some of it is simply later in the path than
other parts.

What we reuse (proven, do not reinvent): conditions and their
library/twin/variant/duplicate machinery, `verts_norm` shape geometry, the role
model (`floor_area`/`surface_area`/`linear`/`count`), the `conditionTotals` `ctx`
seam, the detail-view zoom, the roll-goods "opt-in setup → pure engine → drawn
overlay → docked panel → report columns" *wiring*, `transitions.ts`, and the MCP
`edit_condition` pattern.

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
| Herringbone (gap/overlap-free via derived grid vectors) | `patterns` herringbone | overlay, panel |
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
| Mark a side as a "cut side" (push partials to chosen edges) | `tile_setup.cut_sides` | overlay (edge click) |
| Per-room override of origin/rotation | `shape.tile_override` | overlay, panel |

### D. Cut accounting — what actually gets ordered

| Capability | Module | Surfaces |
|---|---|---|
| Full / cut / hole classification (polygon intersection) | `geometry` | overlay (shading) |
| Corner-piece classification (edge-contact) | `geometry` | overlay, cut sheet |
| L-cut notches (full tile + sawn corner notch) | `geometry` + cut sheet | cut sheet |
| Purchase: *Safe* (full + one-per-cut) | `calc/tiles` | panel, report |
| Purchase: *With reuse* (offcut pool, grain-lock, sliver threshold) | `calc/reuse` | panel, report |
| Cut sheet (per-room, consolidated batch, offcut→cut map) | `calc/cutsheet` | report, marked set |
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
| Tile counts, trim LF, corner EA, grout in Report/CSV/XLSX | `totals.js` `ctx` extension | report |
| Cut sheet and trim schedule in the Marked Set | `markedset.js` | marked set |
| `report.v1` fields (tile counts, layout snapshot, trim edges) | `reportJson` | JSON export |
| Waste-from-layout (replaces/augments heuristic waste %) | `calc` + `totals.js` | report |

### I. Interaction — the tool in the estimator's hands

| Capability | Module | Surfaces |
|---|---|---|
| Focus-on-a-shape: select → zoom → grid appears | canvas | — |
| Tile-grid overlay (rides detail view, like roll cuts) | canvas overlay | — |
| Docked setup panel (Roll-panel pattern) | `TilePanel` | — |
| Origin drag / rotation, one undoable command per gesture | `shapeCommands` | — |
| Edge tagging (click an edge → assign trim) | canvas | — |

### J. MCP / headless

| Capability | Module | Surfaces |
|---|---|---|
| `tile_setup` on `edit_condition` (like `roll_setup`) | MCP `edit_condition` | — |
| Headless layout + cut sheet + trim for agents | engine (pure) | `export_report`, `export_takeoff` |

---

## 3. Engine decomposition (pure, no React/DOM)

All pure modules under `web/src/lib/`, mirroring the proven `rollgoods.js` /
`rollTakeoff.js` split (engine + a thin bridge) and TileCalculator's
`geometry/` + `calc/` split. Everything here is unit-testable headlessly, which
is what lets the MCP surface and the canvas share one math path.

### 3.1 `lib/tilePatterns/` — the pattern engine

- `types.ts` — `TileSetup`, `TileSku`, `TileQuad {cx,cy,w,h,rot,sku}`, `PatternId`.
- `pattern.ts` — `PatternGenerator` interface: `generate(bounds, setup) → TileQuad[]`.
- `registry.ts` — name → generator; a new pattern is a new file + registration
  (TileSim's seam, the architect's "three generators" generalized to N).
- Generators emit **abutting tiles (grout-free)**; the renderer insets by
  grout/2. Grout never appears in the generator, so pitch and face math cannot
  drift (TileSim's answer to the "joint included vs not" question).
- Generators: `lattice` (grid), `offset` (brick), `diagonal`, `herringbone`
  (gap-free via derived grid vectors), `basketweave`, `motif` (chevron/pinwheel/
  harlequin), `modular` (multi-SKU super-cell, per-quad `skuId`), `nonrect`
  (hex/penny), `random` (percentage packing).
- Deterministic: same inputs → same layout (required for undo, MCP, re-render).

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
- `reuse.ts` — offcut pool: first-fit (practical) vs best-fit-decreasing
  (optimize), grain-lock for planks, sliver threshold (tiletakeoff's `cutEngine`
  model).
- `cutsheet.ts` — per-room summary, consolidated batch list, tile-by-tile
  offcut→cut mapping, L-cut rows.
- `borders.ts` — per-side trim LF, piece count `ceil(len/piece)`, outside/inside
  corner counts (convex/reflex).
- `grout.ts` — grout quantity from the layout's actual joint length, extending
  `coverage.js` (which already has the area/LF grout math).

### 3.4 `lib/tileEdges/` — trim & sundries derivation

- Exposure model: per-shape-edge `{shapeEdgeIndex, length_lf, exposure:
  free | wall | opening | finish_transition, finish_neighbor?, user_override?}`.
  Auto-suggested from adjacency (flood-traced rooms don't share edges; door
  openings split edges; deducts create interior edges), estimator-confirmed.
- Threshold derivation reuses `transitions.ts` (butt vs wall), with a trim
  material instead of a transition condition.
- Borders/bands/listellos: offset the interior polygon and lay a band pattern.

### 3.5 `lib/tileWall/` — wall field (the vertical projection)

- Unwrap a `surface_area` ring into an elevation strip (LF × height); openings/
  niches become holes. The same pattern engine runs over the strip, so wall tile
  is "floor tile on a rectangle," not a new engine.
- Multi-course base reuses `coverage.js` `baseGroutParams`/`baseCourses`.

### 3.6 `lib/tileCurb/` — wrapped 3D surfaces (2D-source-of-truth)

- A curb is a linear feature + cross-section profile `{width, height}`. Faces:
  top = LF × width, two sides = LF × height each; corner and end-cut pieces.
- Straight curbs first; L-plan/radius curbs need a developed (unfolded) net —
  defined here, built later in the path.

---

## 4. Integration into OpenTakeoff

### 4.1 Data model — where tile lives

`tile_setup` is an **opt-in object on the condition**, exactly like `roll_setup`:

```
tile_setup: {
  pattern, origin, rotation, edge_strategy,
  cut_sides: [edgeIndex],       // optional per-room, or on shape override
  skus: [{ id, name, w, h, color, image?, glossiness? }],
  joint, grout: { color? },
}
```

- On the condition → it inherits the library / duplicate / twin / variant
  machinery for free (duplicating a finish copies its tile_setup; a twin can
  override per-SKU rows and revert, exactly like materials today).
- **Grout material references `tile_setup`** for size/joint — single source of
  truth, no drift (the `CT-1` seed already imports `GROUT_DEFAULTS` for this).
- **Per-room override** of origin/rotation lives on the shape
  (`shape.tile_override`), because origin is condition-scoped with per-room
  exceptions (the architect's finding — not roll's per-shape `roll_layout`
  model, but the *undo-command* pattern from it).
- Sanitize on load (like `roll_setup`), versioned into `takeoff_canvas.v1` and
  `report.v1`; layout snapshot + trim edges export/import with the takeoff.

### 4.2 Canvas — the focus-on-a-shape flow

1. Select a committed shape (a room's floor polygon).
2. Zoom into it — the existing detail view (`DETAIL_ENGAGE = 1.15`) already
   re-renders crisp at tile scale; no new rendering path.
3. A new **tile-grid overlay** draws the layout on that shape (full solid, cut
   tinted, hole flagged, corner marked, trim edges inked, origin crosshair) —
   the same overlay mechanics as roll cuts.
4. A **docked Tile panel** (Roll-panel pattern) carries the setup controls.
5. Origin drag and rotation commit one undoable command per gesture (the
   `rollcut`/`shapeCommands` pattern, generalized to `tileset`/`tileedge`).

### 4.3 Report — layout-derived quantities

Extend `conditionTotals`'s `ctx` the way `seamByShape` already flows seam-LF:
a `tileByCondition` map carries full/cut/corner counts, trim LF, corner EA,
cut-sheet rows, and grout. New report columns + a **cut sheet / trim schedule**
section, in Report / CSV / XLSX / `report.v1` and the Marked Set.

### 4.4 MCP — headless parity

`edit_condition` accepts `tile_setup` (as it does `roll_setup`); the pure engine
feeds `export_report` and the cut sheet, so an agent can figure a layout and
audit it exactly like the canvas does.

---

## 5. Build path — milestones to the complete feature

Ordered by dependency; each milestone is a coherent, usable increment, and
together they reach every row of §2. This is a path, not a cap.

1. **Data model + sanitize + seed.** `tile_setup` on the condition, SKUs, joint
   presets, grout reference; `CT-1` seed gains a real `tile_setup`; sanitize +
   versioning + import/export round-trip.
2. **Pattern engine + classification (pure, tested).** `tilePatterns` (lattice +
   offset + diagonal + herringbone + basketweave) + `tileGeometry`
   (`polygon-clipping`, full/cut/hole/corner, L-cut) with unit tests.
3. **Purchase + cut sheet (pure).** `tileCalc`: Safe + With-reuse, offcut pool,
   grain-lock, cut sheet. Unit tests incl. the never-exceed-naive invariant.
4. **Borders + trim derivation (pure).** `tileEdges` exposure model + per-side
   assignment + LF/corner counts; threshold reuse of `transitions.ts`.
5. **Canvas overlay + focus flow.** Select → zoom → overlay → docked panel →
   origin drag/rotation/edge tagging with undo commands.
6. **Report + export integration.** `ctx` extension, report columns, cut
   sheet/trim in CSV/XLSX/`report.v1` + Marked Set.
7. **Remaining patterns.** Motif (chevron/pinwheel/harlequin), modular/Versailles
   (per-quad `skuId`), non-rect (hex/penny), randomized — each a new generator
   + registration + tests.
8. **Wall tile.** `tileWall` unwrap + openings/niches + multi-course base; same
   engine over the strip.
9. **Curb & 3D.** `tileCurb` straight profile, then developed nets for L-plan/
   radius; niches.
10. **MCP headless.** `tile_setup` on `edit_condition`, cut sheet + trim in
    `export_report`; agent audit parity with the canvas.

Milestones 1–6 make a tiler productive on floor tile with cuts + trim; 7–10
reach the complete set. No milestone is "out of scope" — later in the path is
not smaller in ambition.

---

## 6. Genuinely-open decisions (few, real — not scope hedges)

1. **SKU images** — tile images (TileSim) vs plain color only. Color-only keeps
   the engine deterministic and the marked set clean; images matter for client
   visualization. Where in the path do images land?
2. **Randomized layout priority** — `madum-ts`-class percentage packing is a
   distinct engine; is it a core ask or a later delight?
3. **Curb representation** — 2D linear-feature + profile (keeps the canvas the
   single source of truth) vs a true 3D surface editor (TileSim has one). The
   design assumes the former; confirm.
4. **Edge exposure auto-derivation** — how aggressive the auto-suggest (shared
   wall vs free edge) should be before the estimator confirms; the override UX.
