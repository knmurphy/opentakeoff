# Plan — Picking, labels, finishes, grid, studio look (spec r4 rev 3)

Spec: `docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md`, final
addendum (2026-08-26d, r4 rev 3). The addendum is the authority; every
ruling below traces to it. Do not improvise alternatives.

## T1 — Pure additions (scene3d.js, node:test first)

- `uvPlanar(ptsFt, periodFt)` → uv pairs (world feet in, NO negation;
  period-1 identity). Consumed per GEOMETRY VERTEX (never ring pairs).
- `gridLines(bounds)` → `{positions, colors}` — 1 ft minor faint, 10 ft
  major strong, extent = bounds + GRID_MARGIN_FT (name it, e.g. 10);
  data-only colors (theme at render). Mint the Y-axis neutral-slate
  constants (theme-aware pair) — ui.js SVG has no slate entry.
- `buildShapeRanges(items)` → `[{shapeId, start, count}]` where items are
  the per-item `{shapeId, geometry}` pairs addMesh holds after
  `list.map(toGeo)` — counts from `geometry.attributes.position.count`
  (NOT scene items; slab triangulation is three's earcut). Non-indexed
  only. `resolveShapeAt(ranges, faceIndex)` → id | null (out-of-range →
  null). The `!geometry.index` assert fires at record AND resolve time.
- Tests in `web/test/scene3d.test.ts`: period math + identity; grid
  spacing counts/extent/axis entries present; range accumulation sums to
  vertex totals; resolver first/middle/last/boundary/out-of-range.

## T2 — TakeoffCanvas wiring (TakeoffCanvas.jsx only)

- `focusIds3d` → snapshot memo keyed `[show3d, active3dKey]` ONLY;
  selectedId + shapes read from REFS at key-flip. ADD the refs
  (render-body-synced, the dsRef precedent at ~396-399 — never an
  effect-synced ref, it lags the flip render). Stale ids harmless.
- Destructive keydown listener (Backspace/Delete/⌘Z/⌘⇧Z/Escape,
  ~2855-2894): early-return while the overlay is open, read via a REF
  inside onKey (the menuDepthRef.current pattern at ~2754 — the effect's
  dep array has no show3d, a closure read is stale and the gate no-ops).
  Pre-existing bug fix: Backspace currently deletes invisibly under the
  overlay; Escape refits mid-orbit. Letter/digit gates unchanged.
- New props at the View3D mount: `onSelectShape={selectShape}`,
  `selectedId`, `isDark={theme === "dark"}` (the chrome-theme state at
  TakeoffCanvas ~390 / lib/theme.js getTheme — NOT `darkMode` at ~386,
  which is the per-sheet negative-print toggle, a different axis), and
  `units` as the established units string-prop convention
  (units.ts: areaVal/areaUnit/lenVal/lenUnit/heightVal).

## T3 — View3D rendering + interaction (View3D.jsx only)

- **Picking**: pointerdown records {x, y, t, button}; pointerup with
  button===0 && travel<5px && <400ms → raycast. Whitelist: meshes with
  `userData.shapeRanges` (recorded via a new opt-in addMesh param at
  slab/ribbon/excluded call sites ONLY — roll meshes never carry them;
  the param is APPENDED AFTER renderOrder, 7th positional — the roll call
  sites pass renderOrder positionally and a mid-signature slot silently
  eats it) + posts InstancedMesh via
  instanceId→`userData.shapeIds`. `raycaster.params.Line.threshold = 0`.
  Every intersection passes a full parent-chain `.visible` check. No hit
  → `onSelectShape(null)`.
- **Selection overlay**: dedicated highlight mesh in its own effect keyed
  `[selectedId, built]`, brightened fill at the shape's geometry, parented
  under the shape's focus-batch mesh (visibility inherits). Never a tint.
- **Label**: DOM chip (portal into the overlay div, absolute-positioned)
  at the projected centroid, reprojected in the EXISTING rAF loop.
  Content per spec: `shape.label` first if present, tag, role quantity
  via units helpers, height/thickness ONLY when real (nominal → print
  "nominal" or omit), ×N. Hidden when legend-hidden / not visible /
  behind camera. Plan-note styling: mono tabular numerals, square
  corners, theme-aware, short leader line.
- **Textures**: per floor-owning condition (derived from the built scene)
  panel rows: load (createObjectURL → Image → THREE.CanvasTexture —
  sRGB, `wrapS=wrapT=RepeatWrapping`, `repeat` stays (1,1)), period
  input (default 3 ft), clear. Texture state joins the content-effect
  deps (geometry changes) but the rebuild SKIPS fitToContent when only
  texture state changed (a refit mid-orbit is the r3 trap). slabGeometry
  populates UVs from
  `uvPlanar(geometry positions, period)` ONLY when a texture is active.
  Map on the condition's floor material, tinted by the RAW condition
  color. Revoke object URLs on clear/switch/unmount; `map.dispose()`
  rides the existing walk.
- **Grid + axes**: LineSegments from `gridLines(computeVisibleBox
  bounds)` (this effect and the selection-overlay effect are DECLARED
  AFTER the content effect — React runs effects in order and both must
  parent/measure the just-rebuilt batches). X cobalt / Y the minted
  neutral slate (NEVER danger red), theme via
  `isDark` (`SVG` vs `SVG.dark`), y=−0.045, `depthWrite:false`,
  `userData.excludeFromFit`, no clipping planes (stated carve-out),
  default ON.
- **Environment section** (panel, after Rolls): Backdrop / Pastel /
  Edges / Grid, all non-persistent per open.
  - Backdrop: `scene.background` per theme (light: paper→pale-gray
    CanvasTexture gradient WITH `SRGBColorSpace`; dark: HUD near-black);
    export canvas composites the ACTUAL scene background — the light
    theme's background is a CanvasTexture gradient (ctx.fillStyle cannot
    take it: drawImage the gradient source or replicate the stops), and
    the footer strip repaints from the theme background with
    theme-appropriate text ink (the hardcoded `#e8eef8` is illegible on
    light paper).
  - Pastel (default ON): lerp shape-material colors toward white 0.35 —
    slabs, ribbons, posts, roll BANDS yes; seam INK never (it exists for
    contrast); texture tint exempt (skip map-carrying materials);
    excluded volumes keep the danger read; legend swatches stay raw.
    Tag material.userData at creation (family + raw color) so the walk
    discriminates without guessing.
  - Edges (default ON): `EdgesGeometry` per focus BATCH, LineSegments as
    a CHILD of the batch mesh (visibility inherits), color = fill
    lerped toward black 0.35 (pastel-aware), shared clipping planes,
    linewidth 1.
- Disposal: textures via map.dispose + URL revoke; edges/grid/highlight
  ride the existing traverse (verify reachability as children).

## T4 — Docs

USER_GUIDE §18 (click-select + label incl. units/nominal rules, the
Environment section, finish textures runtime-only disclosure, the
frozen-focus behavior, destructive-keys-paused note), README Features
bullet, FEATURES.md row, CHANGELOG (two entries: the feature + the
destructive-keys bug fix). Quote shipped UI text verbatim. §15 untouched.
No MCP.

## Order & gates

T1 (red→green) → T2 → T3 → T4 → headed validation → `npm run check`
(PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH") → diff code-review.

## Headed validation checklist

Fixture `3d-view-test.otk`. Click a slab → label appears at its centroid
(room label + tag + the quantity in the project's units); camera does
NOT move and no rebuild runs (canvas region byte-identical pre/post
click EXCEPT the label chip and the selection highlight — the highlight
is a deliberate render change; verify no-refit via unchanged camera
position, not byte-identity over the slab). Texture load/period change
→ rebuild WITHOUT refit. Click a roll-banded floor → selects the
FLOOR (not the band). Click empty space → deselects. Click while a
condition is legend-hidden → never selects invisible geometry.
Backspace with a shape selected + overlay open → nothing deleted.
Escape + overlay open → no camera refit. Reopen overlay after selecting
in-overlay → focus re-snapshots (isolation reflects the selection).
Textures: load any image on RC-1 → tiles at period scale (change period
→ retiles); clear removes. Grid: on by default, 1/10 ft lines, axes
cobalt/slate, excluded from fit. Environment: Backdrop light gradient in
light theme + dark HUD in dark theme; Pastel on/off; Edges on/off; all
reset per open. EXPORT PNG: background matches screen theme (both),
textures/edges/grid as shown. Sheet switch while open → no ghosts.
Unmount clean. Orbit 60fps unchanged.
