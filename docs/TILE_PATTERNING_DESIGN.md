# Tile Patterning — structured feature set & design

Status: design, revised across three review rounds (fact / architect / estimator).
Defines the **complete** feature integrated cohesively into OpenTakeoff, with a
build path that reaches all of it. Starting simple is a build *order*, not a
target. §2–§5 are authoritative; §7 is the review/decision log (it records
history, it does not carry requirements the body lacks).

Companion: `docs/TILE_PATTERNING.md` (audit, prior art, taxonomy, algorithms).

---

## 1. Stance & goal

Add tile patterning **cohesively and complementarily** — reusing the
condition/shape/totals model, the canvas overlay, the report seam, and the MCP
surface, not a bolt-on app. The feature is large and organized as a structured
set of capabilities (§2), each mapped to a module (§3) and a milestone (§5).

Reused, proven, not reinvented: conditions + their library/twin/variant machinery,
`verts_norm` geometry, the role model, the `conditionTotals` `ctx` seam **and its
sibling `ctx.rollByCond`/`ROLL_FIELDS` report-column + `reportJson` block pattern**
(the three-seam precedent, `totals.js`/`reportColumns.js`), the zoom/detail
rendering, the roll-goods opt-in-setup→engine→overlay→panel→columns wiring,
`transitions.ts`, the scale-accurate Marked Set (+ DXF via `export_dxf`, once
merged forward from `main` — §4.3), and MCP `edit_condition`.

The takeoff **source of truth is 2D plan space** — scale, polygons, cuts, and
every ordered quantity originate there. Wall/curb/3D features are 2D projections
or read-only consumers of that truth (§3.5, §3.6, §3.8).

---

## 2. The complete feature set

Grouped by domain; each row maps to a module and a milestone. Surfaces marked
*panel*/*overlay* for a capability whose milestone is a `(pure)` engine milestone
(M2–M4) come online with the canvas at M5; the milestone shown is where the
computation lands.

### A. Tile definition

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Tile SKUs: name, W×H, color, glossiness, image(s) | `tile_setup.skus[]` | panel, marked set, report | 1 |
| Multiple SKUs per pattern (rect + square, Versailles, accent) | pattern engine (§3.1) | panel | 1 / 9 |
| Mixed laying from images or plain color | `tile_setup.skus[].images[]` | panel, overlay | 1 (color) / §6.1 (images) |
| Tile catalog / library (size families, presets) | seed + library | condition library, panel | 1 |
| Grout: preset sizes + custom, width + color | `tile_setup.joint`, `grout` | panel | 1 |

### B. Pattern engine

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Straight grid | `patterns` lattice | overlay, panel | 2 |
| Running bond (50% / 33% offset) | `patterns` offset | overlay, panel | 2 |
| Diagonal 45° | `patterns` diagonal | overlay, panel | 2 |
| Herringbone (gap-free derived grid vectors **for 2:1 tiles; non-2:1 warns**) | `patterns` herringbone | overlay, panel | 2 |
| Basketweave | `patterns` basketweave | overlay, panel | 2 |
| Chevron, pinwheel/hopscotch, harlequin | `patterns` (motif) | overlay, panel | 9 |
| Modular / Versailles (multi-size super-cell) | `patterns` modular (per-quad `skuId`) | overlay, panel | 9 |
| Non-rectangular (hex, penny, octagon+dot) | `patterns` nonrect | overlay, panel | 9 |
| Randomized / percentage layout (seeded) | `patterns` random | overlay, panel | 9 |
| Accent tile replacement (swap a running tile for an accent SKU) | `patterns` + `tile_setup.skus` | panel, overlay | 9 |
| Extensibility: interface + registry | `patterns/registry.ts` | — | 2 |

### C. Layout control

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Origin (drag on canvas + numeric) | `tile_setup.origin` | overlay crosshair, panel | 5 |
| Rotation | `tile_setup.rotation` | panel, overlay | 5 |
| Edge-cut strategy (full-corner / centered band / optimized) | `geometry/optimize.ts` | panel, overlay | 3 / 5 |
| Offset optimizer — **balance cuts / avoid sub-½ slivers** (edge-aligned search) | `geometry/optimize.ts` | panel | 3 |
| Mark a side as a "cut side" *(deferred — never shipped; removed from the model)* | — | overlay (edge click) | — |
| Per-room override of origin/rotation | `shape.tile_layout` | overlay, panel | 5 |

### D. Cut accounting & purchase

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Full / cut / hole classification (polygon intersection) | `geometry` | overlay | 2 |
| Corner-piece classification (edge-contact) | `geometry` | overlay, cut sheet | 2 |
| L-cut notches (full tile + sawn corner notch) | `geometry` + cut sheet | cut sheet | 2 |
| Purchase: *Safe* (full + one-per-cut) | `calc/tiles` | panel, report | 3 |
| **Order in purchase units** — figured × (1+breakage%) + attic stock, rounded to whole boxes, one dye lot | `calc/order` | report | 3 |
| **Material/size-aware waste** multiplier (stone/large-format 15–20%+), beside the pattern table | `calc/order` | report | 3 |
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
| **Movement / expansion joints (TCNA EJ171)** — perimeter + field ~20–25 ft + material transitions, derived LF | `calc/joints` | overlay, report | 4 |
| Borders / bands / listellos / accent strips (interior) | `edges` (offset interior polygon) | overlay, panel | 7 |
| Grout-from-layout (joint length × geometry, not area factor) | `calc/grout` + `coverage.js` | report | 3 |
| Setting/backing sundries (thinset, backer, SLU, sealer, clips, caulk) | existing per-condition materials coverage model | report | 1/3 |

### F. Wall tile — the vertical field

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Surface-area ring → elevation strip (unwrap) | `wall` (strip) | overlay, panel | 10 |
| Openings as holes; **niche interior faces are an addition (§3.6), not just a deduction** | `wall` (elevation) | overlay | 11 |
| Multi-course base (cove/bullnose courses) | `wall` + `coverage.js` | panel, report | 11 |
| Wall panels / stacked bands | `wall` (elevation) | overlay, panel | 11 |

### G. Wet-area assembly (incl. curb) — wrapped surfaces & waterproofing

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Curb: linear feature + cross-section profile | `curb` | overlay, panel | 12 |
| Curb per-face pieces (top, two sides), corner/end cuts | `curb` | cut sheet, report | 12 |
| Curb developed net (L-plan / radius) | `curb/develop.ts` | overlay | 13 |
| Niches (recessed boxes; field-built) | `wall` (elevation) | overlay, panel | 11 |
| **Waterproofing membrane SF** — wet-tagged walls + pan floor (§3.6 wet-tag + wet-height) | `wetArea` | panel, report | 11 |
| **Curb-face membrane** (needs curb geometry) | `wetArea` | report | 13 |
| **Seam / inside-corner / pipe-penetration waterproofing** (LF + EA, distinct from field SF) | `wetArea` | overlay, report | 11 |
| **Drain body / flange** (EA, purchased fitting) | `wetArea` (`count` role) | panel, report | 13 |
| **Slope-to-drain / pre-slope mud bed** (volume; §3.6 slope model) | `wetArea` | overlay, report | 13 |
| Prefab pan / curb / bench (Wedi/Kerdi) as EA alternative | `wetArea` (`count` role) | panel, report | 13 |
| Prefab niche (EA) vs field-built | `wetArea` (`count` role) | panel, report | 13 |
| **Field-built bench** (top + front + side faces + own membrane, mud-set) | `curb` / `wetArea` | cut sheet, report | 13 |
| **Niche interior faces** (top/bottom/sides/back → added tile SF + inside-corner seam LF + membrane) | `wetArea` | panel, report | 11 |

### H. Quantities & export — the deliverable

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Tile counts, trim LF, corner EA, grout in Report/CSV/XLSX | `totals.js` `ctx` + `reportColumns` | report | 3 / 8 |
| Cut sheet and trim schedule | `calc/cutsheet` + `markedset.js` | report, marked set | 8 |
| `report.v1` fields (tile counts, layout snapshot, trim edges) | `reportJson` | JSON export | 8 |
| Waste-from-layout (**refines**, does not remove, the margin — §4.1) | `calc/order` + `totals.js` | report | 3 |
| **Scale-accurate tile layout sheet** (grid + dimensioned cuts + trim + corners, true scale) | `markedset.js` (PDF); `export_dxf` (DXF, post-rebase) | PDF now / DXF after rebase | 8 |
| Install phasing (group rooms into phases; per-phase quantities) | report grouping (existing) | report | 8 |
| **Labor ROM as a *quantity*** (weighted labor SF + driver counts; no $) — new `laborRom:*` columns on the `ctx.rollByCond`/`ROLL_FIELDS` pattern, gated on `tile_setup` (distinct prefix from the existing free-text `labor:*` columns) | `calc/labor` + `reportColumns` | report | 8 |

### I. Interaction

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Focus-on-a-shape: select → zoom → grid appears | canvas | — | 5 |
| Tile-grid overlay (always-on SVG like roll cuts, not detail-gated) | canvas overlay | — | 5 |
| Docked setup panel (Roll-panel pattern) | `TilePanel` | — | 5 |
| Origin drag / rotation / edge tagging, one undoable command per gesture | `shapeCommands` | — | 5 |
| Hatch ↔ overlay coexistence (overview vs close zoom) | canvas + `hatches.jsx` | — | 5 |
| **Multi-room batch QA** — cross-room sliver/warning list (a 40-room job isn't audited one zoom at a time) | canvas + report | — | 5 |

### J. MCP / headless

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| `tile_setup` on `edit_condition` (like `roll_setup`) | MCP `edit_condition` | — | 1 |
| Headless layout + cut sheet + trim for agents | engine (pure) | `export_report`, `export_takeoff` | 3 / 5 |
| Agent audit (withheld/refusal parity) | engine + MCP | — | 14 |

### K. 3D visualization — client preview & wrap validation

| Capability | Module | Surfaces | Milestone |
|---|---|---|---|
| Extrude committed rooms → floor / walls / ceiling from polygon + `height_ft` | `tile3d` (`three/`) | 3D view | 15 |
| Drape figured `tile_layout` as textures on floor/wall/curb faces | `tile3d` | 3D view | 15 |
| Orbit / zoom / pan; read-only consumer of 2D truth | `tile3d` | 3D view | 15 |
| Client-presentation still / image export | `tile3d` | 3D view / image | 15 |

---

## 3. Engine decomposition (pure, no React/DOM)

Pure modules under `web/src/lib/`, mirroring `rollgoods.js`/`rollTakeoff.js`
(engine + bridge) and TileCalculator's `geometry/` + `calc/` split; all
headless-testable so canvas and MCP share one math path.

### 3.0 The layout contract — one geometry, three views

`lib/tilePitch.ts` gives three views of a cell from tile size (`w`,`h`) + joint
(`j`): **`nominalQuad`** (`w×h` face — coverage area), **`pitchCell`** (`(w+j)×(h+j)`
— generator placement + classification), **`installedFace`** (`nominalQuad` inset
`j/2` — rendering, marked set, **and cut-piece dimensioning/offcut area** for
purchase/cut-sheet/reuse; inset `max(j/2, ε·min(w,h))`). Grout never lives inside
a generator; the pitch↔face conversion lives in one module, so drawn field and
ordered quantity cannot drift.

### 3.1 `lib/tilePatterns/` — pattern engine

- `types.ts` — `TileSetup`, `TileSku`, `TileQuad {cx,cy,w,h,rot,skuId}` where `w,h`
  are the **nominal** tile face (area via `nominalQuad`, cut/render face via
  `installedFace(w,h,j)`); the generator applies `pitchCell` spacing when placing.
  `skuId` references a SKU by id (as implemented).
- `pattern.ts` — `PatternGenerator` interface `generate(bounds, setup)→TileQuad[]`;
  `registry.ts` — a new pattern is a new file + registration.
- Generators: `lattice`, `offset`, `diagonal`, `herringbone`, `basketweave`,
  `motif`, `modular` (multi-SKU), `nonrect`, `random` (seeded). Deterministic.
- **Origin applicability table** (not every pattern honors a free origin):

  | Pattern | Origin | Rotation |
  |---|---|---|
  | grid, brick_50, brick_33 | honored | honored |
  | diagonal | honored | fixed 45° |
  | herringbone, basketweave | interlock-derived; free origin ignored | n/a |
  | modular | cell-anchored | per cell |
  | nonrect (hex/penny) | honored | pattern-fixed |

### 3.2 `lib/tileGeometry/` — classification & fragments

- `polygon-clipping` (Martinez–Rueda) for cell∩room; `classify → full|cut|hole|out`;
  corner = edge-contact (not corner point-in-polygon).
- Cut fragments: clipped footprint ∩ **`installedFace`** (§3.0) → cut-piece dims
  and offcut area; L-cut detection; hole-straddle → cut tile.
- **Origin optimization objective is sliver-avoidance / balance, not raw min-cut.**
  The edge-aligned search (only offsets that change the cut set) chooses the
  offset that minimizes sub-½-tile slivers and balances opposing-wall cuts — two
  layouts can tie on count while one leaves an ugly sliver on a sight-line wall.

### 3.3 `lib/tileCalc/` — purchase, cut sheet, joints, order, labor

- `tiles.ts` — full/cut/corner counts; **Safe** = full + one-per-cut.
- `reuse.ts` — offcut pool (first-fit vs best-fit-decreasing), grain-lock, sliver
  threshold; gated `reuse_mode`, auto-downgraded for AABB-approximate patterns.
- `cutsheet.ts` — per-room, consolidated batch, offcut→cut map, L-cut rows.
- `borders.ts` — per-side trim LF, `ceil(len/piece)`, outside/inside corner EA.
- `joints.ts` — **movement/expansion joints (TCNA EJ171)**: perimeter LF + a field
  grid every ~20–25 ft + material-transition runs → soft-joint LF (derived, same
  shape as trim).
- `grout.ts` — grout from the layout's joint length (extends `coverage.js`).
- `order.ts` — **purchase math**: figured count × (1 + breakage%) + attic stock,
  **rounded to whole boxes/cartons on one dye lot**; a **material/size-aware waste
  multiplier** beside the pattern-waste table (stone/large-format 15–20%+). This
  is where the figured count becomes a PO number.
- `labor.ts` — the ROM quantity engine (§3.9).

### 3.4 `lib/tileEdges/` — trim & sundries derivation

- Per-edge exposure `{shapeEdgeIndex, length_lf, exposure, finish_neighbor?,
  user_override?}`, **suggested + confirmed, never auto-committed** (flood-traced
  rooms don't share edges; `transitions.ts` proves proximity, not shared edges).
  Auto-suggest only high-confidence (exterior-hull coincidence). Thresholds reuse
  `transitions.ts`. Interior bands offset the interior polygon (consume field area).

### 3.5 `lib/tileWall/` — wall field

- (1) **strip projection** — straight `surface_area` run × height → 2D elevation
  rectangle, floor engine runs on it; (2) **elevation model** — courses, bands,
  opening/niche cutouts as holes. "Floor tile on a rectangle" is only (1).
- `surface_area` today is plan LF × `height_ft` (`totals.js`), no elevation
  openings — those are new geometry.

### 3.6 `lib/tileCurb/` + `lib/tileWetArea/` — curb & wet-area assembly (2D truth)

- **Curb**: linear feature + cross-section `{width,height}` → top + two side faces,
  corner/end cuts. Straight first; L-plan/radius need a developed net
  (`curb/develop.ts`). Niches ride the wall elevation model.
- **Membrane is a first-class `wetArea` engine output, not "just a materials
  row."** Only the wet zone (shower walls + pan, curb faces) needs waterproofing,
  not the whole tiled bathroom — so membrane SF cannot be the condition's full
  floor+wall total. It requires:
  - **Wet-tagging** — mark which `surface_area`/`floor_area` shapes (or sub-runs)
    are "wet," suggested + confirmed like trim exposure (§3.4); never auto-count.
  - **Wet-height** — a membrane height distinct from the condition's single
    `height_ft` (showers commonly tile to ceiling but waterproof to a code height,
    or vice versa). `wetArea` carries its own height input.
  - **Purchase unit is selectable**: sheet/roll membrane → SF with roll-width
    waste; liquid-applied → coverage-rate gal/SF (rides the existing coverage
    model). The setup picks which; `order.ts` rounds accordingly.
  - **Seam / inside-corner / pipe-penetration** waterproofing is a distinct LF+EA
    item (Kerdi-Band-class), not field SF — the real leak points.
  - **Curb-face membrane** lands at M13 (needs curb geometry); M11's membrane
    figure is explicitly a **floor + wall partial** until then.
- **Slope-to-drain / pre-slope mud bed** — the one non-2D primitive, and the
  highest technical risk this design carries, so it gets an explicit model:
  a **drain point** (new primitive) + a **pitch** (¼″/ft default) → mud-bed depth
  = pitch × distance-to-drain, integrated (average depth × pan area) for **volume**
  (bags of mud). Pan tile SF stays the plan-view `floor_area` (industry bills pan
  membrane/tile by plan SF; the sloped surface is marginally larger — noted, not
  modeled). Drain body/flange is an EA fitting. Prefab pan/curb/bench/niche are
  EA alternatives (the `count` role, `totals.js`).
- **Field-built bench** (not prefab): a mud-set bench is its own small wrapped
  solid — top + front + one/two side faces, its own membrane and mud volume.
  Modeled like a curb (linear feature + cross-section / rectangular top+face
  treatment), not as an EA-only alternative. M13.
- **Niches are a deduction AND an addition.** A recessed niche subtracts its
  opening from the wall field (a hole) but ADDS 4–5 interior faces
  (top/bottom/sides/back): tile SF, inside-corner seam LF, and interior membrane.
  The model must add the box back, not only cut the hole. M11.

### 3.7 Layout lifecycle — recompute & invalidation

Layout is a pure function of `(tile_setup, shape geometry, holes, scale, stitch
placement, wet-tags)`.
- **Recompute on:** `tile_setup` edit, origin/rotation change, `verts_norm` change,
  scale change, deduct/cutout change, twin SKU edit, import merge, stitch
  alignment/origin-offset change, edge-trim/cut-side/wet-tag edits on
  `shape.tile_layout`.
- **Persist vs reset:** `shape.tile_layout` persists across pure zoom; resets on
  `verts_norm` / `tile_setup` / `stitchLayoutSig` hash change.
- **Multi-sheet/match-line:** layout stops at a sheet boundary; a seam-crossing
  stitched room is flagged for a human seam (existing doctrine), never auto-joined.

### 3.8 `lib/tile3d/` + `three/` — 3D visualization (read-only consumer)

Reads committed polygons, `height_ft`, `tile_setup`, and the figured
`tile_layout`; extrudes rooms and drapes the layout as textures (react-three-fiber,
lazy chunk, like TileSim/tiletakeoff). The 2D plan stays authoritative for every
quantity; 3D originates nothing. Value: client presentation and wrap validation.

### 3.9 `calc/labor.ts` (in `lib/tileCalc/`) — labor ROM as a *quantity*

OpenTakeoff keeps cost/pricing out; labor surfaces as a **quantity**, priced
externally. `calc/labor.ts` emits per condition:
- **Weighted labor SF** = measured SF × a **pattern factor** (straight 1.0,
  diagonal ~1.2, herringbone/chevron ~1.6, mosaic ~1.4) × a **size factor**
  (large-format ~1.3) — the two factors **multiply** (large-format herringbone is
  a real spec; multiply, don't pick one), and **wall SF carries a vertical premium
  over floor**.
- **Driver counts as separate priceable quantities:** cut EA, corner EA, trim LF,
  movement-joint LF.
- **Wet-area labor** (distinct from tile-laying): membrane SF-hours, mud-bed-float,
  curb-build — separate quantities, since the feature now owns the assembly.
- **Explicitly NOT a complete labor estimate**: demo, floor prep, and
  mobilization/setup are out of the geometry-derived family and must be added
  outside. The report says so.

Wiring: a `ctx.laborRomByCond` Map + **`laborRom:*` columns** emitted through the
**`ROLL_FIELDS`/`rollColProfile` precedent** (`reportColumns.js`), gated on
`tile_setup`. The distinct `laborRom:*` prefix keeps them clear of the existing
free-text `labor:*` columns (`laborColProfile`, `laborType`/`subfloorType`) —
separate, non-colliding families. This is **not** the free-text `laborType`
field or the "Labor view" visibility preset (whose `laborValue()` is string-only
and computes nothing).

---

## 4. Integration into OpenTakeoff

### 4.1 Data model — where tile lives

`tile_setup` is an **opt-in object on the condition** (like `roll_setup`):
`{ pattern, origin, rotation, edge_strategy, skus:[{id,name,w,h,color,image?,
glossiness?}], joint, grout }`.

- **Runtime guard, no load-time sanitizer** — corrupt payloads read as opted-out
  (`hasRollSetup()` precedent, `rollTakeoff.js:27-30`) + a validation rule.
- **Twin/duplicate/library copy is one-time, not propagating** — `mintTwin` /
  `instantiateTemplate` copy once; `variants.ts` propagation is materials-only.
  Either build SKU-level propagation later or accept independent copies; not free.
- **Grout is derived-only when `tile_setup` present** (like `seam_lf` requires a
  roll layout): recompute `per` on every solve; a hand-edited `per` needs an
  explicit detach flag.
- **Layout refines the margin, does not remove it.** The figured Safe/With-reuse
  count replaces the *pattern-heuristic* `waste_pct` (no double-count), but a
  **residual breakage/contingency + dye-lot + attic-stock margin still applies on
  top** and rounds to whole boxes (`calc/order`, §3.3). Stripping all margin
  because the count is exact is more precise but less safe than a real PO.
- **Per-room layout state** on `shape.tile_layout` `{ origin?, rotation?,
  edge_overrides?, wet_tags? }`, invalidated on the §3.7 hashes.
- Versioned additively into `takeoff_canvas.v1` + `report.v1`.

### 4.2 Canvas — focus-on-a-shape

Select shape → zoom (crispness from existing render; the tile grid is always-on
SVG like roll cuts, **not** `DETAIL_ENGAGE`-gated — #86 retired that) → tile-grid
overlay (full solid, cut tinted, hole flagged, corner marked, trim/wet edges
inked, origin crosshair) → docked Tile panel → origin/rotation/edge/wet-tag
gestures each one undoable command. A `tile_setup` condition's hatch is replaced
by the grid past an LOD swap threshold (§6); hatch stays the overview/print fill.

### 4.3 Report — layout-derived quantities via the three-seam pattern

Every figured quantity — tile counts, trim/corner/joint, grout, labor ROM — flows
through the roll-goods three-seam precedent, **not** ad-hoc: (1) `conditionTotals`
`ctx` maps (`tileByCond`, `laborRomByCond`) so materials rows divide against
figured bases; (2) `reportColumns.js` supplemental `tile:*`/`labor:*` columns on
the `ROLL_FIELDS`/`rollColProfile` pattern, gated on `tile_setup`; (3) `reportJson`
top-level `tile[]` block in `report.v1` + cut-sheet/trim schedule + layout snapshot.

**Scale-accurate layout sheet** (§2.H): grid + dimensioned cuts + trim + corners at
true scale. **PDF today** via `markedset.js`; **DXF is a merge-forward dependency**
(`export_dxf` is on `main`; this branch is behind and must rebase). Cut sheet in
the Marked Set is forward scope (`markedset.js` renders shapes + annotations +
legend + an RFI schedule page today, no tile cut-sheet schedule).

### 4.4 MCP — staged through the path

`edit_condition` accepts `tile_setup` (M1); `export_report` tile counts (M3);
`export_takeoff` layout snapshot (M5); agent audit (M14).

---

## 5. Build path — milestones to the complete feature

Acyclic; each milestone a coherent increment; together they reach every §2 row.
Reuse (M6) and interior bands (M7) land **after** the overlay (M5) so layouts are
visually auditable first. MCP is staged, not deferred.

1. **Data model + runtime guard + seed + MCP round-trip.** `tile_setup`, SKUs,
   joint presets, colors, grout reference; `CT-1` seed; `hasTileSetup()`; versioned;
   `edit_condition` round-trip.
2. **Layout contract + pattern engine + classification (pure).** `tilePitch`,
   `tilePatterns` (lattice/offset/diagonal/herringbone/basketweave), `tileGeometry`
   (`polygon-clipping`, full/cut/hole/corner, L-cut). Tests: pitch/face invariants,
   installed-face cut dimensioning, determinism.
3. **Safe count + cut sheet + grout + order/purchase (pure).** `calc/tiles` Safe;
   `calc/grout`; **`calc/order`** — box/carton rounding, one dye lot, breakage +
   attic-stock margin, material/size-aware waste; pattern-aware waste%; the
   sliver-avoidance offset optimizer (`geometry/optimize`). `export_report` counts.
4. **Perimeter trim + corners + thresholds + bullnose/cove + movement joints.**
   `tileEdges` exposure (suggested+confirmed); `calc/borders` trim LF + corners;
   **`calc/joints` EJ171 soft-joint LF**; thresholds reuse `transitions.ts`.
5. **Canvas overlay + focus flow + undo + hatch coexistence + multi-room QA.**
   Overlay, docked panel, gestures; **cross-room sliver/warning list**.
   `export_takeoff` snapshot.
6. **With-reuse (gated), after the overlay.** `calc/reuse` offcut pool.
7. **Interior bands / listellos, after the overlay.**
8. **Report + export integration.** Three-seam quantities (ctx + `tile:*` columns
   + `reportJson`); cut sheet in CSV/XLSX/`report.v1`; scale-accurate layout sheet
   (PDF; DXF post-rebase); **labor ROM** via `calc/labor` + `labor:*` columns
   (`ROLL_FIELDS` pattern) — weighted labor SF + driver counts + wet-area labor,
   dollar-free, with the "excludes demo/prep/mobilization" note.
9. **Remaining patterns.** Motif, modular/Versailles, non-rect, randomized, accent.
10. **Wall strip projection.** `tileWall` (1).
11. **Wall elevation model + wet-area membrane (partial).** `tileWall` (2) courses/
    bands/openings/niches; **`tileWetArea` membrane SF for wet-tagged walls + pan
    (wet-height, purchase-unit selectable), + seam/corner/pipe waterproofing LF/EA.**
    Membrane here is floor+wall only — curb faces fold in at M13.
12. **Straight curb.** `tileCurb` profile faces + end cuts.
13. **Developed curb nets + full wet-area pan.** L/radius nets; **slope-to-drain /
    pre-slope mud-bed volume (drain point + pitch); drain body/flange EA; prefab
    pan/curb/bench/niche EA; curb-face membrane** (completing the assembly).
14. **MCP agent audit parity.**
15. **3D visualization (read-only).** `tile3d` + lazy `three/`.

Milestones 1–8 make a tiler productive on floor tile with cuts, trim, joints,
purchase-unit orders, a scale-accurate layout sheet, and a labor ROM; 9–15 reach
the complete set (patterns, wall, full wet-area assembly, MCP audit, 3D). Later in
the path is not smaller in ambition.

---

## 6. Genuinely-open decisions (choices, not scope hedges)

1. **SKU images** — tile images vs plain color; where in the path.
2. **Randomized layout + determinism** — seeded PRNG; core vs later delight.
3. **3D fidelity** — read-only viewer (assumed) vs an editable 3D surface.
4. **Exposure/wet-tag auto-suggest aggressiveness** — how far before the estimator
   confirms (both trim exposure and wet-tagging share this).
5. **Match-line origin-offset UX** — per-stitch offset interaction.
6. **Hatch ↔ overlay LOD threshold** — the swap zoom; Marked-Set-at-scale behavior.

---

## 7. Review history & resolved decisions

Three review rounds (fact / architect / estimator) shaped this doc. Their
must-fixes are **integrated into §2–§5 above** — this section records the
decisions, it does not carry requirements the body lacks.

- **Estimator round (bid completeness), now in the body:** order in purchase units
  + breakage/dye-lot/attic margin (§2.D, §3.3 `order`, M3); movement joints EJ171
  (§2.E, §3.3 `joints`, M4); material/size-aware waste (§2.D, M3); sliver-avoidance
  optimizer (§2.C, §3.2); multi-room batch QA (§2.I, M5); setting/backing sundries
  ride the existing materials coverage model (§2.E).
- **Wet-area assembly — OWNED (full).** Membrane SF (wet-tagged, wet-height,
  selectable purchase unit), seam/corner/pipe waterproofing, drain/flange EA,
  slope-to-drain mud-bed volume, prefab pan/curb/bench/niche EA — §2.G, §3.6,
  M11/M13. Membrane is a real `tileWetArea` engine output (only the wet zone needs
  it), **not** merely a materials row.
- **Labor — ROM quantity, not cost.** Weighted labor SF (pattern × size factors
  multiply; wall premium) + driver counts + wet-area labor, dollar-free, via the
  `ROLL_FIELDS`/`ctx` report seam gated on `tile_setup` — **not** the free-text
  labor field. Excludes demo/prep/mobilization. §2.H, §3.9, M8.
- **Highest remaining technical risk:** slope-to-drain is the one non-2D primitive
  (drain point + pitch + depth integration, §3.6) — flagged so the spec treats it
  as real geometry work, not an area formula.
