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

`web/src/components/hatches.jsx` ships 32 CAD hatches. The flooring set already
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

### 1.3 Roll-goods layout engine — the template to copy

`web/src/lib/rollgoods.js` + `rollTakeoff.js` is the closest architectural analog
to a tile-layout engine, and the feature should follow its shape:

- A condition **opts in** with a setup object (`roll_setup`: material class, roll
  width, max length, allowances, direction).
- A **pure engine** figures the layout over the condition's floor-area rings:
  lanes, seams, multi-roll splits, order footage.
- The canvas **draws the cuts to scale** over the rooms in material-true colors,
  numbered in cutting order.
- Cuts are **editable** (drag/resize/reset), stored as `roll_layout` on the shape
  via an undoable `rollcut` command.
- A **docked panel** shows the cut list nested on the roll; report columns
  (`roll:order_lf`, `roll:rolls`, `roll:seam_lf`) flow into the Report/CSV/XLSX.

Seam LF is the instructive precedent: a quantity that is *not* a factor off area,
but a property of the figured layout. A tile feature's "real tiles vs naive waste"
is the same idea one layer up.

### 1.4 Roles, conditions, transitions

- Roles (`web/src/lib/totals.js`): `floor_area`, `deduct`, `surface_area` (wall
  SF = LF × height), `linear` (LF + optional border SF via thickness), `count`
  (EA). Trim pieces (bullnose/cove/threshold/curb) are LF; corner pieces are EA.
  The roles already exist to carry them — what is missing is *deriving* the LF
  and EA from a room's edges.
- Conditions already carry `height_ft` (wall H) and `thickness` (border).
- Transitions (`web/src/lib/transitions.ts` + MCP `derive_transitions`) derive
  runs where two finishes meet — butt joint vs wall-separated. That is
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

MIT, React + Vite, pure engine layer (no DOM) with an 82-test Vitest suite.
This is the closest thing to what the feature wants, and it is worth reading
line-by-line before designing. Its relevant modules:

- **`engine/layouts.js`** — `generateLayout(poly, opts)` returns tile quads
  `{cx, cy, w, h, rot}` in feet (grout included). Six patterns: `grid`,
  `brick_50`, `brick_33`, `herringbone`, `diagonal` (45°), `basketweave`; origin
  offset + rotation. Key detail: the grid is **anchored so a tile edge falls on
  the origin**, then walked outward, so tiles flush with a room boundary classify
  as *full* rather than spuriously cut.
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

### 2.2 Lighter references

- **`foozmeat/tiles`** — a Python random color-mosaic generator (YAML → HTML).
  3 stars. A pattern *renderer*, not a takeoff tool; not a model to copy.
- **Commercial feature vocabularies** (closed source, useful only to confirm the
  feature list estimators expect): TilePro Calculator, Herron, and Toolblocks
  tile-layout tools (visual pattern planners with per-cut views); The EDGE,
  MeasureSquare, and BuildVisionAI (pro tile takeoff with lineal trim/bullnose/
  cove/threshold/niche quantities). They define the *words* — bullnose types, cove
  base, thresholds, curbs, niches — not the algorithms.

---

## 3. Feature taxonomy — the "advanced options" decomposed

The user's list, organized into four axes. Axes A–B are what `tiletakeoff`
proves; axes C–D are where OpenTakeoff would exceed it.

### A. Pattern / layout (floor field, and later wall field)

- Straight grid; running bond 50% / 33% (offset); diagonal 45°.
- Herringbone, chevron, basketweave, checker, pinwheel/hopscotch, harlequin.
- Modular/Versailles — a multi-size super-cell (16+16, 16+24, 24+24 …).
- Controls: origin, rotation, joint included vs not, and (the user's exact
  question) **edge-cut strategy** — full tile from one corner (asymmetric cuts)
  vs uniform cut border / centered layout (symmetric band of cut tiles around the
  perimeter so the field starts as full tile away from the edge).

### B. Edge & trim treatment — the greenfield

- **Trim tile on selected edges** — field tile on the floor body, a different
  finish (bullnose/trim) on the exposed perimeter edges.
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
field/corner/cut piece (corner = touches two perpendicular room edges).

### D. Waste-from-layout

Replace (or supplement) the heuristic waste % with the real full/cut/corner
counts and offcut reuse — "real tiles ordered vs naive waste," the exact thing
`cutEngine.js` reports.

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
   multi-size is the hardest. Which ship first?

4. **Trim depth.** Edge *derivation* alone is a substantial feature. How much of
   axis B in v1 — trim tile + edge profiles + thresholds first, curbs last?

5. **Interaction model.** Grid designer as a separate modal, or inline docked
   panel like Roll? How does the estimator set origin/rotation — drag on canvas
   (the roll-cut idiom) vs numeric fields? How do they mark "this edge gets
   bullnose" — click edges, or auto-derive from exposure?

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

Not a spec, a direction to pressure-test. The strong hypothesis: **a tile setup
follows the roll-goods pattern**, not a brand-new paradigm.

- A condition opts into a **tile setup** (beside `roll_setup`): tile spec, pattern,
  origin, rotation, edge-cut strategy.
- The engine figures the layout; the canvas draws full tiles solid and cut tiles
  hatched/tinted, grout-true, over the committed rooms — exactly how roll cuts
  draw today.
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
