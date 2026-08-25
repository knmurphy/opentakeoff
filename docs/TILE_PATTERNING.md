# Tile Patterning — exploration & design foundations

Status: research/exploration. No code has been written. This documents (a) what
OpenTakeoff already does that is adjacent, (b) the prior art worth learning from,
(c) the full feature taxonomy, (d) the algorithms a real feature needs, and
(e) the open questions a spec must answer. It is the input to a design doc, not
the design.

---

## 1. Current state — what exists today

There is **no tile-patterning feature**. Waste is a hand-entered per-condition
percentage, not layout-derived. But five existing systems are directly relevant
either as building blocks or as the architectural template the feature should copy.

### 1.1 Hatch patterns — visual only, no geometry

`web/src/components/hatches.jsx` ships 31 CAD hatches. The flooring set already
names the tile patterns an estimator recognizes: `grid` (Square/tile), `brick`
(Brick/running bond), `plank`, `herring` (Herringbone), `basket` (Basketweave),
`checker`, `hexagon`, `penny`, `octagondot`, `pinwheel` (hopscotch), `harlequin`
(diamond), `chevron`. These are **pure SVG fills** — they make a finish read like
the real drawing on canvas and in the Marked Set. They carry no tile size, no
origin, no rotation, no cut math, no quantities. A herringbone hatch and a
straight-lay floor both total to the same SF.

### 1.2 Grout calculator — the only place tile geometry lives today

`web/src/lib/coverage.js` holds tile geometry (`tileL × tileW × tileT`, `joint`,
`bagLbs`) but **scoped to grout coverage only**: it derives SF/bag and LF/bag so
the buy list prices grout. It already models a **linear tile base** (`isLinearGrout`,
`baseGroutParams`, `baseCourses`, `baseGroutNote`) — a cove or bullnose course, or
field tile ripped to height and capped with a trim profile, measured in LF. This
is the seed of trim awareness, but it is about grout consumption, not edge pieces.

Tile size is therefore **not a first-class property of the condition** — it is
buried inside a grout material row. The `CT-1` seed (`web/src/lib/canvasConstants.js`)
defaults to `12×24×3/8″ @ 1/8″`, but only as a string in the grout note.

### 1.3 Roll goods — a precedent for *wiring*, not a template for tile

`web/src/lib/rollgoods.js` + `rollTakeoff.js` is the one existing feature that
derives quantities from a *figured layout* rather than a factor off area. It is
worth reading for its plumbing, not as a model to copy:

- A condition **opts in** with a setup object (`roll_setup`: material class, roll
  width, max length, allowances, direction).
- A **pure engine** figures the layout over the condition's floor-area rings:
  lanes, seams, multi-roll splits, order footage.
- The canvas **draws the result to scale**, and a **docked panel** + report
  columns (`roll:order_lf`, `roll:rolls`, `roll:seam_lf`) surface it.
- Edits ride an undoable command (`rollcut`).

That shape — opt-in config on a condition → pure engine → drawn overlay →
report seam — is **codebase-wide convention, not roll-goods-specific**: seam LF,
transitions, and the marked set all follow the same "pure engine feeds the
report" seam. Tile shares this generic plumbing and **nothing else**: roll goods
is 1D strip packing, tile is a 2D lattice/motif problem. A tile-layout engine is
new code, not an adaptation of `rollgoods.js`.

### 1.4 Roles, conditions, transitions

- Roles (`web/src/lib/totals.js`): `floor_area`, `deduct`, `surface_area` (wall
  SF = LF × height), `linear` (LF + optional border SF via thickness), `count`
  (EA). Trim pieces (bullnose/cove/threshold/curb) are LF; corner pieces are EA.
  The roles already exist to carry them — what is missing is *deriving* the LF
  and EA from a room's edges.
- Conditions already carry `height_ft` (wall H) and `thickness` (border).
- Transitions (`web/src/lib/transitions.ts` + MCP `derive_transitions`) derive
  runs where two finishes meet — butt joint (`kind: "butt"`) vs wall-separated
  (`kind: "wall"`, measured but not auto-committed as a threshold). That is
  finish-to-finish; a marble **threshold** at a doorway is the same geometry with
  a trim material instead of a transition condition.

### 1.5 Verdict

Nothing to remove; nothing mislabeled. The scaffolding a tile feature needs —
polygon geometry, per-sheet scale, the SVG overlay, the "figure a layout, draw
it, edit it, feed the report" loop — is all present and proven. The gap is the
tile domain: layout generation, cut classification/sizing, offcut reuse, edge and
trim derivation, and layout-derived waste.

---

## 2. Prior art

### 2.1 `moshegluck/tiletakeoff` (forked: `knmurphy/tiletakeoff`) — the reference
React + Vite, pure engine layer (no DOM) with an ~84-test Vitest suite (README
says 82). **License: not declared** — no LICENSE file, no `license` field in
`package.json`, GitHub reports none. Treat it as proprietary until the author
states one; it cannot be assumed Apache-2.0-compatible. This is the closest
thing to what the feature wants, and it is worth reading
line-by-line before designing. Its relevant modules:

- **`engine/layouts.js`** — `generateLayout(poly, opts)` returns tile quads
  `{cx, cy, w, h, rot}` in feet (grout included). Six patterns: `grid`,
  `brick_50`, `brick_33`, `herringbone`, `diagonal` (45°), `basketweave`.
  Origin + `angleDeg` apply to grid/brick; `diagonal` is fixed at 45°; herringbone
  and basketweave **ignore the origin** (their signatures take `_origin` unused).
  Key detail: the grid is **anchored so a tile edge falls on the origin**, then
  walked outward, so tiles flush with a room boundary classify as *full* rather
  than spuriously cut.
- **`engine/geometry.js`** — `classifyTile` (full/cut/out) via point-in-polygon on
  the four corners with a 2% inset; `clipPolygon` (Sutherland–Hodgman) for the
  exact installed fragment of a cut tile. Honest about its limit: SH is exact for
  convex rooms, approximate for concave — fine for offcut sizing.
- **`engine/cutEngine.js`** — the differentiator. Separates full from cut tiles,
  computes each cut piece's installed fragment and therefore its **offcut**, then
  satisfies later cuts from the offcut pool before breaking a new tile. Two modes:
  `practical` (greedy first-fit, mirrors the bench) and `optimize`
  (best-fit-decreasing across the whole job). Grain-lock for planks; 10% sliver
  threshold; reports `tilesSavedByReuse` vs the naive one-tile-per-cut total.
  Angled/herringbone fragments are modeled as **bounding rectangles** — conservative
  on reuse, and explicitly flagged in the estimate.
- **`engine/estimate.js`** — two costing modes per material: `waste` (area ×
  (1+waste%)) and `cuts` (full tiles + only the new tiles broken for cuts, plus a
  small safety % on the broken tiles only). Box math runs off the *unrounded* SF,
  not the already-rounded tile count (avoids double-rounding over-order).
- **`engine/cutSheet.js` + `data/tileCatalog.js`** — per-room summary,
  consolidated batch cut list, tile-by-tile "which offcut feeds which cut"
  cutting plan; size families (square/subway/plank/mosaic/metric), grout-joint
  presets, and `WASTE_BY_PATTERN` (grid 10, brick_50 10, brick_33 12, diagonal/
  herringbone/basketweave 15).
- **3D viewer** (`three/scene3d.js`) — extrudes rooms to walls, tiles floors.

**What it does *not* do** (its own roadmap, and the hard part this feature adds):
accent/border bands and feature strips per room edge; pattern-accurate
herringbone/pinwheel/Versailles fragment geometry (currently AABB approximation).
It has **no trim/bullnose/cove/threshold/curb/edge treatment at all** — a "wall"
material is only a `perimeter × height` proxy. So even the best prior art stops
short of the user's full list; the trim/edge/curb dimension is greenfield.

### 2.2 Generative / geometric pattern algorithms

- **`ChortleMortal/TiledPatternMaker`** — C++ (Qt) port of Craig Kaplan's
  **Taprats**, the seminal Islamic/Andalusian star-pattern tool. Implements
  Hankin's "polygons-in-contact" method: from a tileable arrangement of regular
  polygons, draw the star/rosette motif by extending edges to their contact
  points, and fill the residual polygons. Ships hundreds of saved designs
  (10-fold, 12-fold, 8-fold, 6-4-3 …) as XML parameter sets. This is the
  algorithmic source for the **"very intricate" end** of the user's spectrum —
  girih, quasi-crystalline, star-and-cross motifs. **License matters:** it is
  GPL-2.0, so the *code* is off-limits for Apache-2.0 OpenTakeoff, but the
  *methods* (Hankin, Lee) are published mathematics and re-implementable. Likely
  a later, decorative phase — not v1 takeoff.
- **`james-camilleri/madum-ts`** — TypeScript/Svelte SVG tiler for **irregular**
  shapes using a "Wordle-style" packing algorithm (after Jonathan Feinberg's
  *Beautiful Visualization* ch. 3): a `collision-map` + `scale-sequence` +
  `svg-tiler` trio that grows and repels shapes into a randomized interlocking
  layout. Relevant to the **randomized / percentage layouts** the commercial
  tools expose (specify tile colors/sizes by %, output an installer-followable
  random pattern). License is conflicted: `LICENCE.md` says WTFPL, `package.json`
  declares ISC — resolve before any reuse. Algorithmically interesting; a
  distinct feature from deterministic takeoff.
- **`codebyjustin/Tile-floor-Background-Pattern-Pure-CSS`** — a single-file CSS
  floor pattern. Visual only; no algorithm. Noted for completeness, not a model.

### 2.3 Commercial feature vocabularies — what to mine, not what to copy

Closed tools can't be copied, but their feature lists are the best map of *what
estimators already expect*. Mined from MeasureSquare Stone & Tile and Precision
Tile Pro (Laurel Creek), the names that map onto this feature:

- **Pattern controls named explicitly:** *layout direction* (rotation) and
  *pattern position / start point* (origin) are the two knobs every tool exposes —
  the same pair `tiletakeoff` models as `angleDeg` + `origin`. They are the
  concrete form of the user's edge-cut-strategy question.
- **Accent tile replacement** — swap individual tiles in a running pattern with
  an accent tile (MeasureSquare "tile replacement").
- **Randomize by percentages** — specify tile colors/sizes as percentages and
  emit a randomized layout for the installer (the `madum-ts` algorithm).
- **Custom tile shapes** — hexagon, triangle, diamond, fan (MeasureSquare
  "custom tile pattern").
- **Borders / inserts / listellos / accent strips** — multiple borders and
  inserts on a floor (MeasureSquare "borders & inserts"); "listello" and deco
  strips are Precision Tile Pro's words. This is the commercial form of "trim
  tile on selected edges," generalized to *bands*, not just perimeter edges.
- **Obstructions** — tile *around* cabinets, registers, windows (Precision Tile
  Pro step 2). OpenTakeoff already has the Eraser/deduct role; the layout engine
  must cut the field around deductions, not merely subtract their area.
- **Install phasing** — group rooms into phases and report per phase.
- **Wall elevation design** — walls as multiple stacked panels/bands (the
  wall-tile projection problem, named).
- **"Tile scrolling" / optimal-layout finder** — PTP's drag-to-scroll the origin
  until the cut pattern is best. A direct ergonomics hint for the grid designer.
- **Quote generation** — exact tile count + SF + labor + thinset/grout. This is
  OpenTakeoff's existing Report; the tile feature just has to feed it real counts.

---

## 3. Feature taxonomy — the "advanced options" decomposed

The user's list, organized into five axes. Axes A–B are what `tiletakeoff`
proves; axes C–D are where OpenTakeoff would exceed it; axis E is commercial
scope to weigh later.

### A. Pattern / layout (floor field, and later wall field)

- Straight grid; running bond 50% / 33% (offset); diagonal 45°.
- Herringbone, chevron, basketweave, checker, pinwheel/hopscotch, harlequin.
- Modular/Versailles — a multi-size super-cell (16+16, 16+24, 24+24 …).
- **Custom tile shapes** (commercial) — hexagon, triangle, diamond, fan.
- **Accent tile replacement** (commercial) — swap a running tile for an accent
  piece in a defined rhythm.
- **Randomize-by-percentage** (commercial + `madum-ts`) — emit a randomized
  interlocking layout from color/size percentages.
- Controls: origin, rotation, joint included vs not, and (the user's exact
  question) **edge-cut strategy** — full tile from one corner (asymmetric cuts)
  vs uniform cut border / centered layout (symmetric band of cut tiles around the
  perimeter so the field starts as full tile away from the edge).

### B. Edge & trim treatment — the greenfield

- **Trim tile on selected edges** — field tile on the floor body, a different
  finish (bullnose/trim) on the exposed perimeter edges.
- **Borders / inserts / listellos / accent strips** (commercial generalization) —
  bands and inserts on a floor, deco strips on walls; the band form of "trim tile
  on an edge," not just a perimeter course.
- **Edge profiles** — metal (Schluter-style) or plastic/other-material trim
  pieces, linear, with corner/end caps (EA).
- **Marble thresholds** — at doorways and finish transitions (geometry already
  in `transitions.ts`, material is new).
- **Bullnose types** — surface vs radius vs double, and corner (three-way)
  bullnose pieces.
- **Cove base tile** — ceramic sanitary cove base, distinct from the resilient
  `RB-1` the app already seeds. Perimeter LF + inside/outside corner pieces.
- **Shower curbs** — a 3D surface wrap: top face + two vertical faces + corner
  pieces vs field pieces vs cut pieces at the ends. The only truly 3D item in
  the list; the app is strictly 2D today.

### C. Edge-cut strategy

The room's cut plan is precise: where the layout starts, whether the boundary is
a uniform cut band or a full tile in one corner, and whether a piece is a
field/corner/cut piece (corner = touches two perpendicular room edges). The two
commercial knobs — *layout direction* and *pattern position/start point* — are
exactly this.

### D. Waste-from-layout

Replace (or supplement) the heuristic waste % with the real full/cut/corner
counts and offcut reuse — "real tiles ordered vs naive waste," the exact thing
`cutEngine.js` reports.

### E. Process & scope (commercial extras to weigh later)

- **Obstructions** — the field must cut around deductions (registers, cabinets),
  not just subtract their area. OpenTakeoff's Eraser role is the input.
- **Install phasing** — group rooms into phases and report per phase.
- **Wall elevation design** — walls as stacked panels/bands; the wall-tile
  projection problem, named and separate from floor field.

---

## 4. Algorithms a real feature needs

Ordered roughly by dependency.

1. **Layout engine.** Pattern → tile placements over the ring. Lattice patterns
   (grid, brick) are pure grids; motif patterns (herringbone, basketweave,
   chevron, pinwheel, Versailles) are multi-tile super-cells tiled like a lattice.
   Output: tile quads in feet (grout-inclusive), anchored to an origin, with
   rotation. Straight port of `layouts.js`, extended with a motif abstraction and
   the centered-layout option.

2. **Cut classification + sizing.** Point-in-polygon corner test for full/cut/out;
   polygon clipping (Sutherland–Hodgman, or Greiner–Hormann when concave-room
   exactness matters) for the installed fragment → cut-piece dimensions. Corner
   detection: a cut tile touching two near-perpendicular room edges is a corner
   piece (relevant for trim derivation and the cut sheet).

3. **Offcut redistribution.** The `cutEngine.js` model — full/cut separation,
   offcut pool, first-fit vs best-fit-decreasing, grain-lock, sliver threshold.
   This is the single highest-value piece: it converts "waste %" into a real
   tile order and produces the installer cut sheet.

4. **Edge/trim derivation.** From a committed room ring: classify each perimeter
   edge by exposure (which edges take bullnose/trim/cove), sum trim LF per edge
   type, count corners (EA). Threshold runs come from the existing transitions
   geometry. This is the piece with the most domain nuance — "which edge is
   exposed" is partly geometric (shared vs external wall) and partly the
   estimator's call.

5. **Curb wrap (3D).** Model a curb as a linear feature with a cross-section
   profile (width × height) rather than a full 3D surface: top face = LF × width,
   two side faces = LF × height each, plus corner and end-cut pieces. Keeps the
   2D canvas as the source of truth; no 3D viewport required for v1 quantities.

6. **Waste-from-layout.** Fold the cut-engine totals into `conditionTotals` the
   way seam LF already flows through a `ctx` (see `totals.js` `seamByShape`),
   so the Report/CSV/XLSX/`report.v1` carry real tile counts alongside the
   heuristic waste.

---

## 5. Open questions a spec must answer

1. **Scope of v1.** Floor tile first, then wall? (Wall tile is a different
   projection — a surface-area ring unwrapped — and doubles the layout problem.)
   The user's list is wall-tile-heavy (cove base, bullnose, curbs), but the
   layout engine is floor-first.

2. **Data model.** Tile size and pattern today live in the grout material. A
   layout feature needs a tile *spec* (size, joint, pattern, origin, rotation,
   edge strategy) — on the condition? A new "tile setup" object beside
   `roll_setup`? Shared with grout so the two can't drift (the `CT-1` seed
   already imports `GROUT_DEFAULTS` for exactly this reason)?

3. **Which patterns in v1.** grid/brick/diagonal/herringbone/basketweave are
   proven by prior art; chevron/pinwheel/Versailles are motif extensions; modular
   multi-size is the hardest; custom shapes and randomized layouts are a
   different engine (`madum-ts`-style packing). Which ship first?

4. **Trim depth.** Edge *derivation* alone is a substantial feature. How much of
   axis B in v1 — trim tile + edge profiles + thresholds first, curbs last?

5. **Interaction model.** Grid designer as a separate modal, or inline docked
   panel like Roll? How does the estimator set origin/rotation — drag on canvas
   (the roll-cut idiom) vs numeric fields? How do they mark "this edge gets
   bullnose" — click edges, or auto-derive from exposure? ("Tile scrolling" from
   PTP is a concrete answer to the origin question.)

6. **Relationship to the hatch.** Does a tile layout *replace* the visual hatch
   for tile conditions (the drawn grid *is* the appearance), or complement it
   (hatch = drawing, layout = quantities)?

7. **MCP surface.** Roll goods already work headlessly (`roll_setup` on
   `edit_condition`). Should tile layout be agent-drivable the same way, or is
   v1 canvas-only?

8. **Offcut reuse or waste only?** Adopt the cut-redistribution engine (the
   highest-value, most-algorithmically-involved piece), or ship layout + waste
   first and add reuse later?

---

## 6. Tool ergonomics — the grid-designer sketch

Not a spec, a direction to pressure-test. Tile layout is a **new engine** — it
borrows only the codebase-wide convention (condition opt-in config → pure engine
→ drawn overlay → report seam), not roll goods specifically.

- A condition opts into a **tile setup**: tile spec, pattern, origin, rotation,
  edge-cut strategy.
- The engine figures the layout; the canvas draws full tiles solid and cut tiles
  hatched/tinted, grout-true, over the committed rooms.
- A docked **Tile panel** shows full/cut/corner counts, the cut list, trim LF,
  and corner-piece counts, numbered in install order.
- **Edit mode** drags the origin / rotates the field (the roll-cut gesture),
  committing one undoable command per gesture.
- Edge trim is assigned by selecting a room edge and tagging it (bullnose / cove /
  profile / threshold), or by accepting an auto-derivation the estimator corrects.

The open question is whether the grid designer deserves a full-screen modal (the
way the Report is) for the pattern/origin/rotation playground, or stays a docked
panel. That is an ergonomics decision the mockup phase should settle with a
prototype, not an argument.

---

## 7. Adversarial review — findings to carry into the spec

Two independent adversarial reviews (research editor + architect) were run
against this document. Their factual corrections are already folded into the
sections above (license status, origin/rotation scope, hatch count, test count,
license conflicts, transitions vocabulary). What follows is the design-phase
input the architect surfaced, and the residual research gaps.

### 7.1 The single biggest architectural risk

The single biggest risk is underestimating the gap between tile and any existing
feature. Tile shares only the generic plumbing (opt-in config on a condition,
pure engine, drawn overlay, report `ctx`); its **problem shape is new** — 2D
with rotation, motif super-cells, a 2D origin/edge-strategy search space, and
trim/curb geometry with no precedent in this codebase. A mockup that proves only
grid + origin drag on one convex room will feel done while hiding the features
that carry estimator value: trim LF, deduct-hole clipping, concave L-rooms, and
honest angled-pattern ordering.

### 7.2 Concrete corrections from the review

- **Layout-state ownership.** Roll stores per-shape `roll_layout` overrides;
  tile origin/rotation is usually *condition-scoped* (all rooms share a field
  direction) with optional per-room exceptions. Do not copy the per-shape model
  blindly — store `{ condition: tile_setup, shapes: {[id]: {origin?, rotation?,
  edge_overrides?}} }` with invalidation keyed on vertex hash + setup hash, not a
  laneCount guard.
- **Three generators, not two.** Lattice (grid/brick) vs motif is insufficient.
  Chevron ≠ herringbone; Versailles/modular is multi-SKU placement (per-quad
  `skuId`), not a bigger super-cell; hex/penny are a third (non-rectangular
  lattice) generator. v1: Lattice + one Motif (herringbone); Modular out.
- **Cut sizing.** Corner point-in-polygon misclassifies diagonal slivers;
  sequential Sutherland–Hodgman is not "approximate" on concave rooms — it is
  wrong. Use general polygon intersection (tile rect → rotated-rect polygon →
  intersect room), corner test = edge-contact (not corner PiP), inset =
  `max(joint/2, ε·min(w,h))` in feet.
- **Offcut reuse is not v1's highest value.** Grid on the plan + full/cut/corner
  counts + pattern-aware waste% (`WASTE_BY_PATTERN`) earns more trust first; the
  reuse engine models herringbone fragments as AABBs and is dangerous for angled
  patterns. Reframe Q8: ship layout + naive counts, add offcut pool as gated
  v1.5 behind `reuse_mode: 'none'|'practical'` with auto-downgrade for angled
  patterns until fragment geometry is exact.
- **Edge exposure can't be inferred from one ring.** Flood-traced rooms don't
  share edges; "external vs shared wall" needs adjacency across gaps, door
  openings split edges, deducts create interior exposed edges. Model edges as
  `{shapeEdgeIndex, length_lf, exposure: 'free'|'wall'|'opening'|'finish_transition',
  finish_neighbor?, user_override?}`, auto-suggested and estimator-confirmed.
- **Curb as LF × cross-section only holds for straight curbs.** L-plan, radius,
  and dam corners need a developed surface (unfolded net) with per-face piece
  roles. v1: straight-profile only, explicitly fenced.
- **Taxonomy.** Axis C (edge-cut strategy) duplicates axis A (it is a layout
  control). Axis E conflates three unrelated concerns — obstructions (layout
  input), phasing (report grouping), wall elevation (a separate projection).

### 7.3 Missing algorithms and questions the spec must add

- Origin/edge-strategy **solver** (centered symmetric band; "tile scrolling" =
  search origin for minimum cuts) — not just UI knobs.
- **Deduct-hole clipping** — layout must cut around in-room holes, not only use
  net SF.
- **Wall-tile unwrap** — surface-area ring → 2D elevation strip with openings/
  niches; a separate feature from floor lattice.
- **Band/border inset** — offset the interior polygon and lay the field inside
  decorative perimeter bands.
- **Layout-invalidation contract** — what persists vs resets when `verts_norm`,
  scale, or `tile_setup` change.
- **Per-room vs per-condition layout ownership** — can two rooms on one condition
  carry different origins?
- **Multi-sheet / match-line policy** — layout stops at a sheet boundary; a
  stitched room needs an explicit human seam (the AGENTS.md match-line doctrine).
  The doc never asked this.
- **Render performance** — LOD / tile cap / region-only regeneration for
  thousands of quads at pan/zoom.
- **Export schema** — `report.v1` / `takeoff_canvas.v1` fields for tile counts,
  layout snapshot, and trim edges; version-bump plan.
- **Order-unit math** — box/case rounding and EA vs SF downstream of tile count.
- **Exact angled-pattern fragment geometry** — the real hard problem for honest
  ordering (herringbone/pinwheel/Versailles), more than "motif abstraction".

### 7.4 Residual research gaps

- `tiletakeoff` license is unresolved — needed before any code reuse.
- Primary citations beyond the fork: Kaplan's Taprats (SourceForge) and his
  published PIC/Hankin work.
- 2D nesting libraries for non-rectangular remnants (libnest2d, OR-Tools bin
  packing) — the doc names Greiner–Hormann but not industrial nesting.
- Other open-source tile estimators and commercial peers (FloorRight,
  RapidSketch Tile, CTD, TilePlanner) for a feature-parity matrix.
- OpenTakeoff's own `stitches.ts` (match-line stitching) as adjacent multi-sheet
  geometry.
