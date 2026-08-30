# Research — Wall tile M10 (strip projection): investigation

**Date:** 2026-08-29 · **For:** the M10 spec on `feat/tile-walls` (based `596ac1e`,
the shipped multi-SKU + origin engine).
**Method:** 3 read-only agents — design intent, today's wall/surface code, floor-engine
reuse feasibility. All claims code/doc-cited.

## Scope: M10 = strip projection only (design-recommended MVP)

`DESIGN.md:250-252` — `tileWall (1)`: **"straight `surface_area` run × height → 2D
elevation rectangle, floor engine runs on it … 'Floor tile on a rectangle' is only
(1)."** M10 (`:428`) delivers exactly this: unwrap a straight wall run into an L×H
rectangle, tile it with the shipped floor engine → cut-accurate, orderable wall-tile
piece/cut/order/cut-sheet quantities.

**Deferred to M11** (`:429-432`): opening/niche cutouts (as holes), niche interior
faces (an *addition*, not just deduction), multi-course base (cove/bullnose),
stacked panels/bands, and the entire `tileWetArea` membrane engine (wet-tag,
wet-height, seam/corner/pipe waterproofing). Curbs → M12/M13.

**Honest caveat** (`:253`): M10 does NOT change the net wall SF (still LF×height);
it changes what you *get* from that SF (real layout/cut/order). The shower-membrane
headline is M11.

## Today's wall = `surface_area` (open polyline, LF×H, no geometry)

- Role `measure_role: "surface_area"`; SF = `openLen(pts)*upp*height` (`shapeMetrics.js:20-30`).
  Height precedence: per-shape `height_override` → shape `height_ft` → condition
  `height_ft` (`shapeMetrics.js:25-27`, `measurementBreakdown.js:9-12`).
- Shape fields: `{verts_norm (OPEN), height_ft, height_override?, computed{area_sf,
  perimeter_lf}}` (`commitSurface`, `TakeoffCanvas.jsx:4752-4771`). **No 2D boundary,
  no holes.**
- Wall SF → `totals.js:49` `acc.wall` → `wall_sf` column (`reportColumns.js:18/42/65`).
- **Tile engine is `floor_area`-ONLY:** `tileTakeoff.js:311` `if (s.measure_role !==
  "floor_area") continue;`. `tile_setup`/`tile_layout` never consulted for surfaces.

## Engine reuse — VERDICT: yes, as-is, over a rectangle ring

`solveTileLayout({tile_setup, ring_ft, holes_ft})` (`tileSolve.ts:39-44`): `ring_ft`
is an open feet polygon; only `ringBounds` (≥3 pts, nonzero W/H) is assumed — no
rectangularity/floor semantics. `classifyLayout` (jsts, "room" is just a var name,
`classify.ts:353-411`), `countsBySku` (`tiles.ts:52-67`), `optimizeOrigin`/
`effectiveTileSetup` (`optimize.ts`), and `summarizeShape`'s cutsheet/grout/order
are **all pure over ring_ft + tile_setup**. A rectangle `[[0,0],[L,0],[L,H],[0,H]]`
is a valid ring → full reuse of solve/classify/count/order/cutsheet, incl. multi-SKU
painting and origin-honoring.

**Floor-coupling is only at the edges:**
- **Ring builder** — `ringFt(verts,dims,upp)` (`tileTakeoff.js:29-31`) reads
  `floor_area.verts_norm × dims × upp`. Walls need a NEW builder: `ring_ft` directly
  from `L×H` (feet), no verts_norm/upp.
- **Role gate** — `tileTakeoff.js:311` (+ `markedset.js:216`, any `reportColumns`
  role check) excludes non-floor. Must admit the wall role.
- **Rendering is PLAN-space** — `markedset.js:1005/1017` + `tileDxf.ts` place quads
  at the floor shape's plan position via `toPage`. A wall strip is ELEVATION space
  with no plan footprint → cannot use this path. Needs an elevation-frame renderer
  (the quad→corners math in `tileOverlayPrimitives`/`shapeTileCells` is reusable;
  only placement is new).
- **Report wiring is role-AGNOSTIC** — `computeTileTakeoff` returns `byCond`
  (condition_id → summary); `tileReportRows`/`tileColProfile` look up by condition id
  (`tileTakeoff.js:568`, `reportColumns.js:267`). A wall condition's strip summary
  rolls up through the SAME `tile_goods`/columns with NO new report code — once wall
  shapes reach `summarizeShape` (via the role gate + ring builder).

## Minimal wall-specific work (everything else is reuse)
1. **Unwrap ring builder**: `wallStripRing(L_ft, H_ft) → [[0,0],[L,0],[L,H],[0,H]]`.
2. **Role gate**: admit the wall role past `tileTakeoff.js:311` (build strip ring
   instead of `ringFt`), and the `markedset.js:216` participation check.
3. **Elevation render**: a panel preview of the tiled strip (reuse `tileOverlayPrimitives`
   quad math). On-canvas/marked-set/DXF elevation placement is a heavier follow-on.
4. **Report**: nothing new (role-agnostic byCond).

## Design decisions the spec must settle
- **Trigger:** a `surface_area` shape on a `tile_setup` condition auto-tiles, exactly
  like a floor shape does (no new opt-in) — consistent, reuses the model.
- **Rendering location (the real fork):** floors tile on the plan; a wall strip has
  no plan footprint. MVP default: render the tiled strip as an **elevation preview in
  the docked Tile panel** + the quantities as the deliverable; defer on-canvas /
  marked-set / DXF elevation placement (where on the sheet does an elevation go?) to a
  follow-on. Recommend confirming this with the user.
- **Aggregation:** a condition's `tile_goods` sums ALL its tiled shapes (floor + wall)
  — natural for the engine; note it (wall tile is usually its own condition, e.g.
  WT-1, so they separate in practice).
- **Open (from DESIGN §6 / TILE_PATTERNING §9):** wet-tag auto-suggest (M11), match-line
  origin UX, the layout-invalidation contract, per-room vs per-condition ownership.
