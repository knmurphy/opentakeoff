# Research — wall-tile prior art: multi-surface, corners, "sketch the pattern"

**Date:** 2026-08-29 · **For:** wall-tile patterning feature (`feat/tile-walls`)
**Method:** primary source read of 3 cloned reference repos (`scratchpad/refs/{TileSim,
tiletakeoff,TileCalculator}`). Every claim below cites `file:line`. Complements the
2026-08-28 origin/motif prior-art doc (which covered lattice math + origin honoring).

## Headline

- **TileSim is the only repo that actually tiles walls as first-class surfaces.** It
  has a clean `Surface`/`SurfaceTransform` model (floor | ceiling | wall | box-face),
  one wall per polygon edge, each an independent unwrapped rectangle. This is the
  reusable multi-surface skeleton. **But every wall is fully independent — no corner
  continuity, no wrapped tile, no corner counting.** Pattern restarts at each wall's
  shared vertex by construction.
- **TileCalculator (a deck builder, not a tiler) is the only repo with a real CORNER
  model** — it classifies each perimeter vertex outside/inside (convex/reflex) and
  counts corner pieces per border type. That vertex-classification + per-corner
  counting is the borrowable pattern for wall-to-wall corner trim/cuts.
- **TileSim's `SurfaceEditor` IS a "sketch the pattern" UI** — but it paints
  **absolute cells** (`tileOverrides: cellId→tileTypeId`), not a **repeat unit**. No
  motif/repeat abstraction exists in any repo (confirms the 2026-08-28 finding).
- **tiletakeoff does NOT lay out wall tile at all** — walls are 3D visual extrusions;
  wall-tile quantity is a `perimeter × wallHeight` area proxy. Anti-pattern to avoid.

---

## Q1 — Multi-surface / walls: data model

### TileSim — YES, first-class (the model to borrow)
- `SurfaceKind = 'floor' | 'ceiling' | 'wall' | 'box-face'` — `model/types.ts:96`.
- `Surface` carries a 2D size (`widthCm`,`heightCm`), a `SurfaceTransform`, and its own
  `subRegions` — `model/types.ts:110-126`.
- `SurfaceTransform` maps surface (u,v)→world: `worldPos = origin + uAxis·u + vAxis·v`,
  plus `normal` — `model/types.ts:98-108`. This is the unwrap↔wrap bridge (see Q5).
- **There is no "run of walls" abstraction: a run is N independent surfaces with no
  shared frame.** A run of walls = one `Surface` per floor-polygon edge. `wallSurfaces(room)` loops
  the polygon edges; for edge i: `u = edge length`, `v = room height`, `origin = vertex a`,
  `uAxis = edge direction`, `vAxis = (0,1,0)` up, inward `normal` chosen toward centroid
  — `model/geometry.ts:101-141`. Wall id = `${room.id}:wall:${i}` (`geometry.ts:130`).
- Floor/ceiling are the bounding-box rect with a real `outline` polygon for L-shapes
  — `geometry.ts:56-98`. `allSurfaces()` aggregates floor+ceiling+walls per room +
  box faces (`geometry.ts:202-213`). Surface geometry is **derived**; only per-surface
  `subRegions` (the tiling edits) are persisted — `types.ts:167-168` (`surfaceData`).

### tiletakeoff — floors only; walls are a visual/quantity proxy (anti-pattern)
- Rooms have a `wallHeight` (default 8 ft) — `state/store.js:177`, `components/Panels.jsx:80-81`.
- Walls exist only as extruded 3D planes for preview — `three/scene3d.js:101-113`.
- **No wall tile layout.** Wall-tile order qty = coverage proxy: *"Wall tile uses
  perimeter × wall height as a coverage proxy"* — `components/Panels.jsx:420`. Materials
  are typed floor/wall (`store.js:212-217`) but the layout engine only tiles the floor
  polygon (`engine/layouts.js` operates on a single `poly`).

### TileCalculator — a single deck surface (multi-poly with holes), not walls
- Domain is a deck/patio: `RectOp` add/subtract shapes → `MultiPoly` — `types.ts:6-16`,
  `geometry/shape.ts`. No wall/elevation concept; it models one horizontal surface plus
  its perimeter. Relevant only for its corner/border machinery (Q2).

---

## Q2 — Corners

### TileSim — NOT handled
Each wall is generated independently with `origin = vertex a` and `u=0` at the shared
corner (`geometry.ts:123-128`). Adjacent walls share a vertex but nothing else: separate
`subRegions`, separate pattern `originOffset`, separate cell space. Consequence: **the
pattern hard-restarts at every corner; no tile wraps a corner; no corner cut is counted.**
This is "reset at corner" purely as a side effect, not a deliberate feature.

### TileCalculator — YES, a real corner model (the borrowable bit for corner counts)
- `deriveSides(deck)` walks each ring, and for every vertex computes the cross product of
  incoming/outgoing edges and classifies **convex → `outside`, reflex → `inside`**
  (orientation-aware via `ccw`) — `geometry/sides.ts:101-118`. `Corner` records the point,
  type, and the two adjoining side ids — `sides.ts:14-19`.
- `computeBorders(...)` counts corner pieces: a corner is counted **only if both adjoining
  sides carry a border** (`sides.ts`→`borders.ts:69`); tallied `outside`/`inside` per
  border type when both sides share a type, else counted as a **`mixed` corner** (a
  transition where two different treatments meet) — `borders.ts:66-82`. Piece counts per
  side = `ceil(side.length / pieceLength)` — `borders.ts:60`.
- **Why relevant:** replace "border on a deck edge" with "tile/trim on a wall run" and this
  is exactly the wall-to-wall corner accounting we'd want — outside vs inside corner trim,
  and the "two finishes meet at a corner" (mixed) case, counted from vertex geometry.

### tiletakeoff — NOT handled (no wall layout at all).

---

## Q3 — "Sketch the pattern" UI

### TileSim — YES, a full paint-cells UI (but absolute cells, not a repeat unit)
`views/SurfaceEditor.tsx` is a modal showing the **unwrapped** flat surface on a canvas
with two modes (`SurfaceEditor.tsx:92`, tabs at `:543-550`):
- **Region mode** — draw/move/reshape sub-region polygons on the surface: rubber-band a
  rectangle to add (`:389-403`), drag to move, drag vertices, double-click an edge to
  insert a vertex, right-angle snap on Shift (`snapRightAngle` `:38-55`), numeric
  resize-about-pivot and move (`:483-518`). Each sub-region gets its own pattern
  generator/base tile/rotation/`originOffset` (`:629-737`).
- **Cells mode** — the pattern is generated into concrete cells; the user **click-toggles
  or marquee-selects individual tiles** (`:404-434`) and assigns a specific `TileType`
  via `assignTileToCells(...)` (`:748-754`), or steps/randomizes the per-cell image
  (`:456-478`). Selection keyed by `cellId`.
- **Underlying model:** assignment is stored as `tileOverrides: Record<cellId, tileTypeId>`
  and `imageOverrides: Record<cellId, imageIndex>` on the `SubRegion`
  (`model/types.ts:146-155`). Resolution is `overrides[cellId] ?? pattern.defaultTileTypeId`
  — `render/SurfaceTexture.ts:43`, `:58`. Image pick is deterministic hash unless overridden
  — `render/tilePicker.ts:18-23`.
- **Key limitation:** overrides are keyed to **absolute cell ids within the sub-region**,
  not to a slot in one repeat. Painting "every 3rd tile" means clicking each one; there is
  no paint-one-repeat-and-tile-it. This is precisely the repeat-unit gap the 2026-08-28
  doc flagged, seen in working code here.

### tiletakeoff / TileCalculator — NO sketch/paint of individual tiles.
Both preview a computed layout only (tiletakeoff `components/canvasRender.js`;
TileCalculator `render/DeckCanvas.tsx`). No per-tile assignment interaction.

---

## Q4 — Pattern continuity (origin / restart across boundaries)

- **TileSim:** each sub-region carries a `PatternConfig.originOffset` (u,v cm,
  `types.ts:139-140`). The generator runs in the **sub-region bounding-box-local** frame:
  `rect = subRegionBBox(sub)`, `gen.generate({w: rect.w, h: rect.h}, ...)`, placed at
  `rect.u + p.x` (`SurfaceTexture.ts:40,48,53`). So **each sub-region restarts its own
  pattern anchored to its own bbox top-left**. Across two walls there is no shared origin
  at all — each wall's `u=0` is its start vertex. Continuous *within* a sub-region;
  **restart at every sub-region and every corner**.
  - **Origin shift alone does not desync painted overrides.** A fractional `originOffset`
    change phase-slides field and cell ids together (grid `ox=((o.x%tw)+tw)%tw`
    `grid.ts`; offset `:19`; herringbone `baseX=a·v1+b·v2+o.x` `herringbone.ts:31`); the
    painted tile moves with its id. (This *corrects* my earlier draft and refines the
    2026-08-28 "herringbone id is origin-stable" note — it's stable, but so is grid.)
  - **The real desync axis is region edits, because ids are bbox-local.** Move/resize the
    sub-region polygon — primary `SurfaceEditor` interactions (`SurfaceEditor.tsx:346-357`
    move, `:483-518` numeric resize, vertex drag) — and `rect.u/rect.v/rect.w` change, so
    the whole id grid re-anchors; overrides painted on `col_row` / `a_b` can slide relative
    to the tiles (worst when resizing from the top/left edge, which moves the bbox origin).
    Applies to grid, brick, **and** herringbone alike (all bbox-anchored).
  - **Herringbone-only subtlety:** grid/brick mod-reduce the origin to one pitch, but
    herringbone does **not** (`herringbone.ts:31` — raw `a·v1+b·v2+o`). So an origin change
    of an exact lattice vector leaves the *visible* herringbone unchanged yet relabels every
    cell → overrides jump one lattice step with no visible cause. A latent trap unique to
    the un-reduced generator.
- **tiletakeoff:** single floor; `generateLayout` anchors a grid so a tile edge lands on
  `origin` and walks out from there (`engine/layouts.js:48-67`); herringbone/basketweave
  **ignore origin** (`_origin` unused, `layouts.js:69,89`). No boundary/continuity concept.
- **TileCalculator:** border pieces run along each side independently
  (`ceil(len/pieceLength)`). Its field-tile grid uses **surface-absolute, negative-safe
  indices**: `col = floor((bbox.minX − offsetX)/moduleW)` walking a fixed range
  (`geometry/grid.ts:147-150`), and `cellOrientation` handles negative-index parity
  (`geometry/pattern.ts:27`). This is the absolute-index scheme the 2026-08-28 doc
  recommended over TileSim's per-sub-region local reset — cells keep their `(col,row)`
  identity as long as the anchor (deck bbox + offset) holds. No cross-boundary flow (single
  surface).

---

## Q5 — Unwrap vs wrap views of the same surface

### TileSim — YES, both, from one model (the strongest reusable idea)
- **Unwrapped (flat elevation):** `SurfaceEditor` draws the surface in (u,v) on a 2D
  canvas. For walls it flips V so the wall's floor line sits at canvas bottom
  (`flipV = vAxis.y > 0.5`, `SurfaceEditor.tsx:128-130`, flip render `:155-163`).
- **Wrapped (3D):** the *same* `renderSurfaceCanvas(surface, tileTypes, images)` texture
  feeds the 3D plane — `three/useSurfaceTexture.ts:4,31` → `three/SurfacePlane.tsx:17`,
  positioned/oriented by the surface `transform`. One `subRegions` data source drives both
  the flat editor and the folded 3D view. (Plan/2D vs 3D toggle: `views/PlanView.tsx`,
  `views/View3D.tsx`.)
- This unwrap-edit / wrap-render split via `SurfaceTransform` is the cleanest thing to
  adopt for a wall-elevation editor.

### tiletakeoff — plan (2D floor) + 3D extrude, but no *unwrapped wall* editing.
### TileCalculator — 2D deck plan only (`render/DeckCanvas.tsx`); no 3D/unwrap.

---

## Q6 — Reusable vs anti-patterns (with references)

**Reusable**
1. **`Surface` + `SurfaceTransform`** as the multi-surface backbone; walls = one surface
   per edge with u=length, v=height, inward normal — `TileSim model/types.ts:96-126`,
   `model/geometry.ts:101-141`. Geometry derived, edits stored per surface
   (`types.ts:167-168`).
2. **One texture renderer feeding both flat editor and 3D** — `SurfaceTexture.ts:113` used
   by editor and `useSurfaceTexture.ts:31`. Unwrap/wrap for free.
3. **Corner classification + per-corner counting** (outside/inside/mixed, counted only when
   both sides are treated) — `TileCalculator geometry/sides.ts:101-118`, `calc/borders.ts:60-82`.
   Direct analog for wall-corner trim/cut counts.
4. **Override resolution seam** `overrides[cellId] ?? default` with deterministic hash for
   the unset case — `SurfaceTexture.ts:43`, `tilePicker.ts:18-23`. A repeat-unit motif drops
   in here as `motif[slotId]` (per 2026-08-28).

**Anti-patterns to avoid**
1. **Wall tile as a `perimeter × height` area proxy with no layout** — `tiletakeoff
   Panels.jsx:420`. Produces a number but can't place tiles, count corner cuts, or show an
   elevation. Our takeoff wants the marked-up layout, not just an area.
2. **Corners as an emergent side effect, not modeled** — TileSim resets the pattern at each
   corner because walls are independent (`geometry.ts:123-128`); acceptable for a 3D
   preview, wrong for cut/trim accounting. If corners matter, model them explicitly
   (borrow #3 above).
3. **Overrides keyed to sub-region-bbox-LOCAL ids** — TileSim generates cells in the
   sub-region's local frame (`SurfaceTexture.ts:40,48,53`), so `tileOverrides[cellId]`
   re-anchors when the region is moved/resized (primary editor actions,
   `SurfaceEditor.tsx:346-357,483-518`); painted assignments can slide off their tiles.
   (Origin shift alone does *not* cause this — see Q4; the earlier "grid is origin-unstable"
   framing was wrong.) Prefer a surface-**absolute** index like TileCalculator's
   `floor((minX−offset)/module)` (`grid.ts:147`), and mod-reduce the origin for *every*
   generator so an exact-period origin change can't silently relabel cells (herringbone
   currently does not — `herringbone.ts:31`).
4. **Per-cell painting with no repeat abstraction** — `SurfaceEditor` cells mode requires
   clicking every tile (`SurfaceEditor.tsx:404-434`); fine for a bespoke feature wall,
   unworkable for a repeating motif. A paint-one-repeat model is the missing layer.
