# 3D Takeoff View — Design Spec

Date: 2026-08-26
Branch: `feat/3d-takeoff-view-spec`
Status: approved design, pre-implementation
Review: adversarially reviewed by three persona subagents (Web3D/three.js expert,
flooring estimator, repo maintainer); all blocker findings incorporated. Provenance
in the repo conversation of this date.

## Purpose

An on-demand 3D view of what the estimator already measured on a 2D floor plan —
no elevation drawings, no model. The plan gives positions and lengths; the spec
book gives heights; the takeoff already ties them together. The view serves two
jobs equally: **estimator self-audit** (did I trace every wall, do heights match
spec, do layers stack) and **client/GC communication** (show what the bid
includes).

Not a modeling tool. Nothing in the view feeds back into quantities. The 3D view
is a read-only projection of committed shapes; the numbers stay where they are.

## Decisions locked with the product owner

1. **Audience: both** — audit aid and client-facing artifact from one scene.
2. **Door openings: continuous now, schema-ready** — base rings render through
   doorways with an honest caveat; a positioned-openings extension slot is
   designed in but unpopulated (no migration later).
3. **Scope: full sheet AND selection** — the toggle opens the active sheet's
   scene; selection isolates. Never cross-sheet (match-line doctrine: joining
   sheets is human judgment in the canvas).
4. **MCP: phase 2, re-scoped** — v1 has no agent surface. Phase 2 requires a
   headless-browser architecture (WebGL does not exist in the node/@napi-rs
   stack — `docs/MCP.md`'s in-process doctrine forbids it); the pure scene
   builder enables deterministic node tests, not rendering. It is not a small
   future lift and must not be specced as one.
5. **Renderer: three.js, lazy-loaded** — `React.lazy` chunk, first-toggle load,
   the pdf.js dynamic-import precedent.

## Architecture — three layers

### 1. `web/src/lib/scene3d.js` — pure scene builder (no three import)

Input: `{ shapes, conditions, sheet: { widthPx, heightPx, upp }, units }`.
Output, a serializable scene spec in **internal feet** (the `units.ts`
internal-feet contract; display units convert at the UI edge only):

```
{
  slabs:   [{ verts_ft, holes_ft, z0, z1, color, tag, kind: 'floor'|'excluded', shapeId }],
  ribbons: [{ path_ft, z0, z1, side: 'interior'|'center', color, tag, mode: 'vertical'|'flush', shapeId }],
  posts:   [{ pt_ft, z0, z1, color, tag, shapeId }],
  notes:   [{ kind: 'unset-height'|'openings'|'xn'|'nominal-thickness', tag, text }]
}
```

Coordinate mapping, pinned (Web3D review B2): `verts_norm` is normalized image
pixel space, y grows DOWN. World mapping is `world = (x_ft, height_up, −y_ft)`,
chosen so a north-up top-down camera visually matches the 2D sheet the user just
left. The y-flip inverts polygon winding uniformly; the builder reverses ring
order on import so windings land CCW-in-world, and `scene3d.test.ts` pins this
with a known-CCW fixture asserting the up-facing normal after mapping. All
materials are `THREE.DoubleSide` as permanent insurance regardless.

Geometry rules (per role):

- **`floor_area`** → slab `z ∈ [0, h]` with `verts_norm_holes` punched. `h` =
  `thickness_in / 12` when set, else a **nominal visual constant** (start:
  1/24 ft) — a display constant, not user data, legend-noted via
  `notes: nominal-thickness`. Curved closed rings are NOT flattened (matches
  `shapeMetrics.js:36-43` and the 2D renderer; `flattenCurve` is legacy and
  applies to open runs only).
- **`deduct` with `cuts_shape_id`** (reconciled) → renders as nothing; its hole
  is already baked into the parent's `verts_norm_holes`.
- **`deduct` standalone** → red translucent "excluded area" volume with caption
  "excluded area — see plan" (the 2D renderer's red-decal dichotomy,
  `TakeoffCanvas.jsx:7917-7939`, carried into 3D), extruded over the SAME
  height range a floor_area slab of that condition would get (`thickness_in/12`
  if set, else the nominal visual constant) — pinned, not left to the
  implementer. NEVER a boolean subtract at render time: standalone deducts are
  standalone because `findCutoutParent` already refused at commit (the guard:
  `cutout.js:106-109`, returns null unless exactly one candidate touches; the
  scope doctrine at `cutout.js:26-35`) — re-running it can only double-process
  or re-refuse.
- **`surface_area`** → vertical ribbon along the trace, `z ∈ [0, shape.height_ft]`
  (the shape snapshot — walls keep the height they were drawn at; reviewers
  confirmed this doctrine is exactly right).
- **`linear`, mode vertical** (wall base) → ribbon inset toward the room
  interior, `z ∈ [0, extrude_h_ft]`. **Unset `extrude_mode` on a linear
  condition dispatches as `vertical`** — flush is the opt-in minority case
  (TR-1 is the only seed needing it), and the builder, the extrude_h_ft
  control gate, and this table all agree on that default.
- **`linear`, mode flush** (transition/reducer strip) → thin strip in the floor
  plane, `z ∈ [h_floor, h_floor + thickness_in/12]` — it sits ON the adjoining
  floor surface (z0 = the higher of the two adjoining slabs' tops when the
  strip bridges floors of different `thickness_in` — its whole purpose; looked
  up via `origin.derived.between_shape_ids` on derived transitions
  (`transitions.ts:250-253`), falling back to the nominal visual constant +
  legend note for hand-traced flush strips with no linkage; never 0, so it
  never coplanar-overlaps the floor beside it). Height = `thickness_in` as
  thickness, not as a standing wall. This split is mandatory: RB-1 base and
  TR-1 transition share `measure_role` and are physically opposite installs.
- **`count`** → vertical post at the exact point, `z ∈ [0, extrude_h_ft]`
  (corner guard: spec height, e.g. 4'0").

Ribbon construction: quad strip per segment with miter at joints (θ = the
interior angle between consecutive segments at the joint), under a
**miter-limit clamp**: when the miter offset length (1/sin(θ/2)) exceeds 4×
the ribbon half-width — which happens at near-straight reflex joints and sharp
acute corners, i.e. ordinary freehand-trace noise — the join falls back to a
bevel. Near-duplicate consecutive points are collapsed and zero-length
segments skipped BEFORE normal computation (NaN propagates into bounding
spheres and silently kills meshes — Web3D B10; reuse the minDist-filter
pattern from `geometry.js` thinStroke). Both guards get test fixtures (see
Testing).

Interior-side resolution: rings carrying `origin.derived.from_shape_id` are
inset toward the source floor polygon's interior (signed winding). Hand-traced
runs center on path. Coincident wall ribbons (base + wainscot on one wall line
— likely, since snapping makes it so) get role-specific lateral nudges derived
from each ribbon's half-width (a fixed fraction of it, never an absolute
epsilon, so the offset scales across sheet scales) so no two ribbons share
literal world coordinates (Web3D B9).

### 2. `web/src/lib/scene3dSchema.js` (or within canvasConstants) — new condition fields

**`extrude_h_ft`** — display-only installed height for `linear`-vertical and
`count` conditions, in internal feet. **UI entry point, pinned:** a third
`DimParamInput` on the existing param row beside H and T
(`TakeoffsPanel.jsx:474-481`), with the same inches affordance H/T use
(`units.ts` thickVal/dimInputStr patterns). **Shown on every condition's param
row unconditionally** — conditions are role-agnostic in the schema
(`measure_role` lives on shapes), so there is no condition-level field to gate
visibility on, and the H/T precedent is exactly this: T already renders for
every condition and is inert where irrelevant. extrude_h_ft is likewise inert
for conditions that never render vertical-linear or post geometry.
Persisted on the condition; unknown-fields-pass-through is established
convention for condition/template records (`templates.js` sanitizeTemplates —
the `scale_source` precedent), so this is a comment-level schema addition, no
migration.
**Do not overload `height_ft`** — its single-purpose contract
("default for NEW wall traces, SF = LF × H") is copy-pinned in
`TakeoffsPanel.jsx:473` and MCP-exposed; a second consumer makes all of that
documentation false.

**`extrude_mode`** — `'vertical' | 'flush'`, consumed only where the condition
has `linear` shapes (count shapes render as posts unconditionally — no `post`
value exists until a consumer reads it). **Default when unset: `vertical`** —
flush is the opt-in minority case; the builder dispatches unset as vertical so
a user-created third linear condition (a second base product, another reducer
type) never lands in an undefined state. **UI entry point, pinned:** a
two-state toggle button (not a second `<select>`) beside the extrude_h_ft
input on the same param row — following the inline-enum-control precedent of
the `Style <select>` at `TakeoffsPanel.jsx:466-472`. Shown
unconditionally, same reasoning as extrude_h_ft — inert where no linear shapes
exist, so a brand-new reducer-type condition can reach `flush` before its
first shape commits.

**Seeds are part of this work, not already present:** `canvasConstants.js`
FLOORING_DEFAULTS has no base/guard values today — the implementation ADDS
`extrude_mode: "vertical"`, `extrude_h_ft: 0.333` (4") to RB-1,
`extrude_mode: "flush"` to TR-1, and **a new `CG-1` Corner guard seed**
(count role, `extrude_h_ft: 4` — 4'0" corridor default). Without CG-1, every
guard condition is user-created and starts as a translucent placeholder — the
exact round-2 failure.
CG-1's remaining seed fields (color, hatch, waste, materials) follow the
existing FLOORING_DEFAULTS entry schema — cosmetic implementer's choice under
the palette-is-user-data doctrine, decided at implementation, not spec time.
Seeding touches fresh/empty workspaces only (`seedConditions` runs when a
project has zero conditions), so no saved project is retroactively altered.

**Reminder-until-set nudge:** committing a `count` (or vertical-linear) shape
while the active condition has no `extrude_h_ft` shows a one-line dismissible
message (the existing `setCommitMsg` toast pattern, auto-dismissing — not a
modal, and it re-shows on later commits while still unset, hence the name):
"Set installed height for {tag} — the 3D view renders it." The shape still
commits. This closes the corner-guard day-one gap for user-created conditions
beyond the seeds.

**Mixed heights per spec section — per-shape snapshot + override, mirroring
`height_override`:** `extrude_h_ft` defaults per condition and SNAPSHOTS onto
each shape at commit (`shape.extrude_h_ft`, like `shape.height_ft` on
surface_area shapes). A per-shape override — `extrude_h_ft: v,
extrude_override: true` on the selected shape, set/cleared through the shape
inspector exactly like `setShapeHeight`/`clearShapeHeight`
(`TakeoffCanvas.jsx:6661-6676`, inspector field at `8782-8790`, consumed at
`shapeMetrics.js:24-28`) — lets one CG-1 condition hold 4'0" corridor guards
AND 8'0" loading-dock guards without fragmenting Report/materials/legend into
duplicate line items for the same product. The builder reads the shape-level
value, condition default only as fallback. This is the app's existing pattern
for mixed wall heights; extrude_h_ft adopts it rather than inventing a
stricter condition-splitting requirement.

Unset `extrude_h_ft` → translucent nominal post/ribbon + legend note
(refusal-over-guessing carried into visuals). The nominal HEIGHT is its own
constant (start: 3 ft — a tall dimension, distinct from the 1/24 ft floor
thickness nominal; never borrow one for the other). With seeds plus the nudge
this is the rare case, not the day-one default.

### 3. `web/src/components/View3D.jsx` — lazy renderer + overlay

`React.lazy(() => import(...))`; Vite splits three into the chunk. Import
`OrbitControls` from `three/examples/jsm/controls/OrbitControls.js` and
`mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js` —
the files, not the addons barrel (the 150 KB gz estimate holds only under
per-file imports; verify against a real build before asserting in docs).

Renderer contract (all from the Web3D review):

- **Draw calls:** merge geometry per condition into one BufferGeometry (one
  draw call per visible condition; slab and ribbon geometries normalized to a
  shared position/normal attribute layout before `mergeGeometries`; color
  comes from the per-condition material, never vertex-baked, so no color
  attribute joins the merge). **Carve-outs, stated:** (1) standalone-deduct
  excluded volumes get **one translucent-red mesh per condition that owns a
  standalone deduct, parented under that condition's Group** — alpha-blended
  material (`depthWrite: false` — an excluded volume can sit coincident with
  an unholed slab beneath it; opaque+transparent coplanarity is a textbook
  z-fight) cannot share a draw call with the condition's opaque geometry, and
  per-condition parenting keeps explode and legend toggles working through
  ordinary visibility/transform (a shared scene-wide batch would orphan the
  red marker mid-explode and can't be condition-toggled without a rebuild);
  (2) count posts get **one InstancedMesh per condition that owns count
  shapes**, parented under that condition's Group, built from a unit-height
  post geometry that is **BASE-ANCHORED — local z spans [0, 1], never a
  default-centered [-0.5, 0.5] primitive** (a centered geometry under
  per-instance z-scale buries half of every post below the floor: an 8'0"
  guard renders 4' under grade, silently). Instance matrix = translate(x, y,
  0) · scale(rx, ry, extrude_h_ft) — notation is conceptual (world axes; in
  three's Y-up that maps to position (x, z-up-as-y, −y-as-z) per the line-57
  world mapping) — with the unit post's cross-section baked into the base
  geometry (uniform footprint, rx = ry = 1 in local space) and each shape's
  snapshotted
  `extrude_h_ft` (condition default, or its per-shape override — per-shape
  heights must not break instancing), with an instanceId→shapeId array
  kept alongside for future consumers (no raycast/picking in v1 — selection
  isolation is 2D-selection-driven). Worst case ≈ #conditions +
  #deduct-owning conditions + #count-conditions — still tens. Explode is a
  per-condition `Group.position` update per drag tick, uniform across slabs,
  ribbons, excluded-volume meshes, and each condition's post InstancedMesh —
  never a rebuild. Legend condition-toggles set Group visibility, which
  covers every carve-out for free.
- **Export:** export handler calls `renderer.render(scene, camera)` then reads
  `canvas.toDataURL()` synchronously in the same call stack (or constructs
  with `preserveDrawingBuffer: true`). The PNG is composited with a footer
  strip: sheet id, scale, date, "schematic — not as-built; openings deducted,
  not shown; verify in field" — a NEW convention (current exports carry only
  a "Generated {date}" footer) extending the house refusal-over-guessing
  philosophy to the app's most exportable artifact.
- **Section cut:** horizontal clipping plane (`renderer.localClippingEnabled =
  true` — per-material clipping planes are inert without it; the clippingPlanes
  array goes on EVERY material — condition, excluded-volume, and post — not
  just floor slabs), no stencil caps
  in v1 (thin-shell geometry makes an open cut edge acceptable at schematic
  fidelity). Documented scope: this is a near-floor audit affordance
  (base-ring closure, guard placement), NOT a wainscot-height-difference
  audit — that needs a vertical section the data does not support. **Section
  cut and explode are mutually exclusive in the UI** (a world-space plane does
  not track per-condition Δz; coupling them is undefined physics).
- **Lifecycle:** on unmount — `renderer.dispose()`,
  `renderer.forceContextLoss()`, `controls.dispose()` (OrbitControls attaches
  its own DOM listeners), dispose every geometry/material, null refs. WebGL
  context-lost → overlay + re-init. If open/close profiling shows hitches,
  keep one renderer alive hidden instead of remounting.
- **DPI/resize:** `ResizeObserver` → `camera.aspect` +
  `camera.updateProjectionMatrix()` (mutating `.aspect` alone is a no-op) +
  `renderer.setSize()`; `setPixelRatio(min(devicePixelRatio, 2))`.
- **Materials/lighting:** unlit `MeshBasicMaterial` with per-condition flat
  color — no light rig, consistent with schematic fidelity; DoubleSide as
  stated above.
- **Framing:** fit-to-content from bounding sphere + FOV, recomputed on legend
  toggle (visible content changes) and via a dedicated reset-view button in
  the overlay chrome. Explode deliberately leaves framing static (exploded
  groups may exit the fitted sphere); the button is the re-frame affordance.

### 4. TakeoffCanvas integration (monolith preserved — trigger only)

Toolbar button + one free letter (checked against the USER_GUIDE §15 table at
implementation; O is taken). While View3D is mounted, bump `menuDepthRef` (the
established gating pattern) so 2D letter tools don't re-arm under the overlay.
Full-screen overlay with legend rail: condition toggles, unset-height notes,
×N footnote (multiplier never duplicates geometry), openings caveat.

Selection isolation (v1, honest scope): a room's floor shape + shapes reachable
via `origin.derived.from_shape_id` + label-equal siblings. Unlinked shapes
(hand-traced wall runs, unlabeled counts) stay visible regardless — the
point-in-polygon membership primitive and its shared-wall tie-break are named
future work, not folded in silently.

## Openings — continuous, schema-ready

Derived base rings render slightly translucent/dashed relative to hand-traced
runs, and the caveat survives export via the footer strip — a caveat that lives
only in UI chrome does not survive a screenshot, and a photoreal base running
through a double-door reads as "the tool doesn't know where doors are," not as
a disclosed limit.

Future slot, additive, no migration: linear shapes gain `gaps_norm:
{ start, end }[]`; `derive_base` accepts positioned openings (point-on-ring +
width). v1 populates nothing; the field passes through untouched per the
unknown-fields convention.

## Honest-limitations label

The overlay carries a persistent (not dismissible) label stating what is
schematic: no wall thickness, no door frames, no casework, flat single-
elevation floors, generic base profile, openings deducted-not-shown. Every
time the view opens — estimators and GCs must not read this as as-built.

## Edge handling

- Unscaled sheet (`upp` null) → refuse with the scale-gate message; 3D is
  feet-true or nothing.
- Empty sheet → empty state.
- Waste never appears (report-only, per house rule).
- ×N → legend note only.

## Testing

`web/test/scene3d.test.ts`, node:test over the pure builder (matches the pure-
math philosophy; no new infrastructure):

- role → geometry mapping (each row of the doctrine table);
- y-flip/winding: known-CCW fixture asserts up-facing normal after mapping;
- hole punching from real `verts_norm_holes` rings (cutout-produced fixture,
  not hand-authored — Web3D review: turf output vs THREE.Shape hole-winding
  expectations must be proven, not assumed);
- standalone-deduct → excluded-volume kind, no subtraction attempted;
- interior-side inset for derived rings; centered fallback for hand-traced;
- degenerate-segment filtering;
- unset-height / nominal-thickness / openings / ×N note generation;
- extrude_mode defaults per condition seed (RB-1 vertical, TR-1 flush, CG-1 post).
- miter-limit clamp: near-180° reflex and sharp-acute fixtures assert the
  ribbon stays within bounded width (no spike vertices);
- flush-strip z-baseline: a flush ribbon's [z0, z1] never coplanar-overlaps
  the adjoining floor slab's nominal range.

Canvas/renderer verified by hand per house practice (sample plan, trace, open
the view, export).

## Docs sync (implementation PR)

README (Features), `docs/USER_GUIDE.md` (new section + §15 shortcut row),
`CHANGELOG.md`, **`FEATURES.md`** (row pointing at scene3d.js/View3D.jsx —
established practice beyond AGENTS.md's literal three). No MCP surfaces.

## Explicit non-goals / future work

- Positioned door openings (`gaps_norm` + derive_base extension).
- Point-in-polygon room membership for unlabeled shapes.
- Roll-seam rendering from `rollgoods.js` figured layouts — **promoted to v1
  by addendum 2026-08-26c (r3)**.
- Vertical section cuts.
- MCP view verb — requires headless-browser architecture, specced separately.
- Stitch panels / elevation data of any kind.

## Addendum (2026-08-26b, r2) — Plan-skin ground plane

The sheet's own raster as the ground under the 3D geometry, so slabs sit on a
recognizable plan instead of a void. v1's stated milestone is a **fidelity
read**: is the base raster enough to orient the estimator? Detail-view re-render
is future work, gated on that read.

### Product decisions (locked with the owner)

- **Source**: one fresh `pageObj.render` of the full page — never the panel
  canvas (coarse placeholder; dark mode bakes an inversion into its pixels —
  same ruling as `ensureRasterMask` / `agentViewRegion`). `background:
  "#ffffff"` unconditionally; the app theme never touches this render.
- **Prominence**: dimmed by default (`PLAN_SKIN_OPACITY = 0.4`), with an
  opacity slider (0–1) in the panel — the fidelity read needs to attribute
  "can't read the plan" to the raster, not to a locked dim.
- **Export PNG**: included, WYSIWYG (it's in the scene, so it rides the same
  `render()` the export already does).
- **Paper vs tinted**: a visible in-overlay control, default **paper**.
  Tinted is NOT a multiply (a multiply against white paper then composited
  on the black void erases the plan: `#1f3fc7`·α lands near-black) — it is a
  lerp: `new THREE.Color(SVG.cobalt).lerp(white, 0.6)` as a named constant
  `PLAN_SKIN_TINT`, a light-cobalt wash that keeps paper luminance.
- **Toggle**: "Plan" checkbox in the overlay panel, default ON. None of the
  plan controls persist (reset per open).

### Architecture

Three seams, mirroring the three-layer doctrine:

1. **Pure** — `planPlane(sheet)` in `scene3d.js`, next to `toWorldFt`:
   `{ wFt: widthPx*upp, hFt: heightPx*upp, cx: wFt/2, cw: -hFt/2 }` —
   already-final world values (the `[x, up, −y]` contract; View3D negates
   nothing). `w∈[−hFt, 0]` because image row 0 maps to w=0.
2. **TakeoffCanvas** — a render effect keyed on the pair `(show3d,
   active3dKey)` (fires on open AND on sheet switch while open; never while
   closed): `factor = min(1, PLAN_SKIN_MAX_DIM/w, PLAN_SKIN_MAX_DIM/h)` with
   a NEW named constant `PLAN_SKIN_MAX_DIM = 4096` in `canvasConstants.js`
   (the existing MAX_CANVAS_* are on-canvas budgets, wrong tool; 4096 RGBA ≈
   64 MB GPU, universally supported, readable at grazing angles). Render into
   an offscreen canvas, stale-guarded by a monotonic seq ref (the
   `renderSeqRef` idiom, 1848-1849). **Invalidation contract**: skin state is
   `{ canvas, sheetKey }`, set synchronously to null on any `(show3d,
   active3dKey)` transition, then filled by the guarded render — a late
   render for a departed sheet is dropped, and a sheet switch can never
   stretch the old sheet's raster across new world dims.
3. **View3D** — a DEDICATED effect (not the content-rebuild effect, which
   churns per shape edit and would re-upload the texture), keyed on
   `planSkin?.sheetKey` + the sheet's primitives; removes + disposes the
   existing plane BEFORE adding the new one (no ghost overlap). Geometry:
   `new THREE.PlaneGeometry(wFt, hFt).rotateX(−π/2)` — up-facing normal,
   **FrontSide** (from below the ground the plane is simply not drawn; a
   DoubleSide back-face would mirror the plan and veil the takeoff from
   underneath). Texture pairing — **this is the pinned orientation ruling**:
   with `rotateX(−π/2)`, default `CanvasTexture.flipY = true` mirrors the
   plan north-south; the contract is `texture.flipY = false` so image row 0
   (top) lands at w=0 and image column 0 (left) at x=0. Also pinned:
   `texture.colorSpace = THREE.SRGBColorSpace` (0.185's SRGB output default
   washes the raster out otherwise), `texture.anisotropy = min(8,
   renderer.capabilities.getMaxAnisotropy())` (grazing-angle blur), material
   `MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false,
   side: THREE.FrontSide })` — **no `clippingPlanes`** (section cut must not
   slice the backdrop; localClipping is opt-in per material) — position
   `(cx, −0.05, cw)` per `planPlane`, `renderOrder = −1` (drawn first in the
   transparent pass regardless of center-distance sort). Cleanup calls
   `disposeObject3D` (it disposes `material.map`; a bare `scene.remove`
   leaks the texture).

### Framing ruling

The full-sheet plane would enlarge `fitToContent`'s bounding box and zoom the
takeoff out on open. **The plane is excluded from the fit walk**
(`userData.excludeFromFit`, skipped in `computeVisibleBox`): the plan is a
backdrop; framing stays geometry-driven.

### Named constants (no magic numbers)

`PLAN_SKIN_MAX_DIM = 4096` → `canvasConstants.js` (beside MAX_CANVAS_*).
`PLAN_SKIN_OPACITY = 0.4`, `PLAN_SKIN_DROPOPEN_FT = 0.05`,
`PLAN_SKIN_RENDER_ORDER = -1`, `PLAN_SKIN_TINT` (lerp of `SVG.cobalt` toward
white 0.6) → View3D module consts (the `MAX_EXPLODE_FT` precedent) — except
nothing here is pure-testable beyond `planPlane`, which stays the only
scene3d.js addition.

### Testing

- `scene3d.test.ts`: `planPlane(SHEET)` → `{wFt:50, hFt:100, cx:25, cw:−50}`
  (SHEET 1000×2000×0.05) — pins the w-negative-half orientation that the
  flipY=false ruling depends on.
- Canvas verified by hand, headed, with pixel evidence: plan visible AROUND
  and BETWEEN shapes (the slabs themselves are opaque — "plan visible under
  slabs" is unachievable and not a bullet); toggle, opacity, and paper/tint
  controls work; alignment spot-check vs the 2D sheet (same plan features
  beside the same shapes, plan NOT mirrored); sheet switch while the overlay
  is open swaps the raster with no ghost; export PNG includes the plan; dark
  app theme does not invert the paper.

### Docs sync

USER_GUIDE §18 (Plan checkbox + opacity + paper/tint controls, default-on
paper backdrop, non-persistent), README Features bullet, FEATURES.md row,
CHANGELOG (amend the existing 2026-08-26 entry if it lands in the same PR).

### Non-goals (v1)

- Detail-view (vector) re-render as the texture source — gated on the
  fidelity read this v1 exists to produce.
- Plan-skin state persistence (resets to on/paper/0.4 per open).
- Plan in the 2D-canvas report or any MCP surface.

## Addendum (2026-08-26c, r3 rev 3) — Roll-good lanes on the slabs

The figured roll layout (rollgoods.js) rendered onto the 3D floor slabs:
alternating lane bands + explicit seam lines at lane boundaries, so the
estimator reads WHERE the goods run and WHERE seams fall, in the same view
they already trust for heights and transitions. No new persisted state, no
schema change, no migration. (adversarial review ran three
rounds — r1 FAIL×3, r2 mixed, r3 PASS×3; this text folds in every
finding. Key corrections from the cycle: seams anchor at COVERAGE boundaries, not physical-piece
bounds; spans use DE-OVERAGED run extents; bands wear the roll material
palette, not the condition color; per-shape slab-thickness overrides do
not exist and are not invented here.)

### Field glossary (rollgoods strips — all sheet FEET)

- `coverMin`/`coverMax` — the lane's COVERAGE slab: finished goods, exact
  tiling by the cursor (`coverMax[i] == coverMin[i+1]` between LANE-ADJACENT
  strips; a dropped lane's span has no floor, so surviving neighbors gap).
  Bands are built from these.
- `laneMin`/`laneMax` — the PHYSICAL cut piece, coverage ± seam/wall/door
  expansion. Adjacent pieces OVERLAP by 2×seam allowance — that overlap IS
  the seam. The 2D cut overlay draws these; 3D bands deliberately do not
  (alternating parity must not double-tint the overlap zone).
- `runMin`/`runMax` — the lane's run extent INCLUDING wall/door overage
  ("material that tucks past the room"). The IN-ROOM extent is
  `runMin + minOverageFt … runMax − maxOverageFt` — the same de-overaged
  interval `seamLfBySrc` sums ("a weld does not run up the wall"). Both
  band runs and seam spans use the de-overaged interval, so drawn seams
  agree with the seam LF the Report prices. Manual `shape.roll_layout`
  cut overrides replace run values wholesale via `applyStripOverrides`;
  the helper inherits whatever seamLfBySrc sees post-override.
- `laneIndex` — the lane's ordinal. Parity and adjacency key on THIS, not
  array position (a dropped lane makes them differ).

### Product decisions (locked)

- **Data flow — prop, not a second engine call.** TakeoffCanvas's
  `rollTakeoff` useMemo (the 2D overlay's own source) stays the ONE layout
  computation feeding both views. A sibling memo derives the 3D payload:
  `rolls3d = useMemo(() => join strips+seams to the BUILT slabs,
  [rollByCond, shapes3d])` — strips join by `srcId == shapeId` so a band
  emits only where its owning slab exists (rooms on other sheets have
  strips but no slab — rollByCond spans every sheet while shapes3d is the
  active sheet; no floating stripes). The memo is REQUIRED: an inline
  filter hands View3D a fresh array identity per parent render and rebuilds
  the scene mid-orbit (the documented camera-reset trap; the shapes3d
  pattern exists for exactly this). Sheet switch rides shapes3d identity.
- **buildScene input contract AMENDED** (this section is the amendment):
  buildScene gains `rolls: { bands, seams }` in SHEET FEET, where each band
  is `{poly, z, fill, tag, shapeId, condId, laneIndex}` (poly = flat
  polygon, pre-clipped; fill = the rollColorForType material color,
  resolved upstream so scene3d stays engine-free) and each seam is `{poly, z, tag, shapeId, condId}` (thin
  pre-clipped polygon). ALL clipping/derivation happens upstream in
  rollgoods helpers called from the rolls3d memo — bands via
  `clipRingToLaneSlab`, seams via the new seam-segment helper next to
  `seamLfBySrc` (single source of truth for "where lanes meet") — so
  scene3d only maps sheet-feet polys → world — a `[x, −y]` negation, the
  toWorldFt convention WITHOUT its norm→feet scaling (toWorldFt itself
  takes verts_norm; feeding it feet double-scales) — and NEVER imports
  the engine. View3D adds the rolls payload to the
  sceneResult useMemo deps.
- **Bands — coverage polygons, roll material palette.** Per lane:
  `clipRingToLaneSlab(ring, laneAxis, coverMin, coverMax)` (the engine's
  own render-only footprint clip — concave rooms notch correctly instead
  of striping over floor that isn't there) × the de-overaged run interval,
  as a flat polygon at the owning slab's z1 + `ROLL_BAND_EPS_FT`. Fill =
  `rollColorForType(summary.material)` — the material-true palette, the
  2D overlay's own convention ("cuts never mimic a condition's takeoff
  look"). NOT the condition color: slabs are opaque condition-color
  MeshBasicMaterial, and C-over-C alpha composites to C — condition-color
  bands are mathematically invisible. PARITY: odd `laneIndex` lanes emit a
  band, even lanes emit nothing (an alpha-0 quad is pure rasterization
  waste); the stripe reads as band-vs-slab contrast. EXCEPTION: a
  single-lane room (laneCount === 1) bands lane 0 — there is nothing to
  alternate against, and leaving small rooms unbanded would read as "not
  figured" (with a 12-ft roll, any room ≤ ~11.5 ft wide is single-lane;
  small offices and corridors are common).
- **Seams — thin ribbon quads, dark ink.** At each interior COVERAGE
  boundary (`coverMax[i]`, guarded by `b.laneIndex === a.laneIndex + 1`;
  a dropped lane leaves NO seam — array-consecutive ≠ lane-adjacent),
  spanning the overlap of the two lanes' DE-OVERAGED run extents — the
  exact interval seamLfBySrc sums — then FOOTPRINT-CLIPPED via a thin
  `clipRingToLaneSlab` pass centered on the boundary: the de-overaged
  extents are min/max BOUNDS, and a lane bridging a concave notch would
  otherwise stripe dark ink across the void — the exact artifact the bands
  rule forbids. Consequence, disclosed: when a notch intervenes the DRAWN
  seam is shorter than the priced seam LF (seamLfBySrc prices the bridged
  bounds — existing engine behavior, not relitigated). Rendered as flat
  polygons triangulated like the slab footprints (`THREE.Line` linewidth
  is capped at 1 device px on most platforms and unreadable at
  whole-floor framing),
  half-width `ROLL_SEAM_HALF_FT` (the FLUSH_HALF_FT = 1/12 ft precedent).
  INK is LUMINANCE-AWARE, chosen at build time from the owning slab's
  condition color (known when the material is minted): dark slab → light
  ink, light slab → dark ink — a fixed dark ink vanishes against the
  PALETTE's near-black `#1f2937`. Single-lane rooms emit no seam (nothing
  adjacent) — correct, not a miss.
- **Height**: band z = seam z = the owning slab's z1 + eps, joined per
  strip via srcId → that shape's slab. z1 is the condition's
  `thickness_in/12` (nominal fallback) — there is NO per-shape slab
  thickness override in the schema and this addendum does not invent one.
  `ROLL_BAND_EPS_FT = 1/48` (≈0.25 in): above depth precision at sheet
  scale, below the nominal slab thickness (1/24 ft) — the tempting borrow
  `PLAN_SKIN_DROPOPEN_FT = 0.05` is LARGER than a nominal slab is thick
  and would visibly hover.
- **Depth/renderOrder discipline**: bands and seams are transparent
  (`depthWrite: false` on both — three's default true would make a band
  at slab-top+eps swallow equal-depth seam fragments), renderOrder bands
  1, seams 2, both after the plan plane's −1. Coplanar transparent
  primitives never rely on distance sort.
- **Parenting + batching (a stated carve-out, like excluded volumes)**:
  MERGED band/seam meshes per roll-goods condition, parented under that
  condition's Group AND routed through the same addMesh → splitByFocus
  path as every other role — explode (Group.position), legend toggles
  (Group.visible), AND selection isolation (focusIds hides out-of-set
  geometry per shapeId) all ride for free; a scene-child batch would
  strand stripes at deck height mid-explode, keep bands lit for
  legend-hidden conditions, and float other rooms' stripes over the plan
  skin while their focus-hidden slabs are invisible — the ordinary
  select-a-room-then-open-3D flow. splitByFocus's in-set/out-of-set
  merged-mesh split applies verbatim (payloads already carry shapeId;
  worst case 4 meshes per roll-goods condition). This keeps the draw-call
  budget in the parent's "still tens" regime (one mesh per strip is
  hundreds of calls on a 100-room sheet). The Rolls checkbox is a
  VISIBILITY-ONLY walk over the band/seam meshes (the plan-controls
  pattern — mutate in place, never a rebuild); folding it into the
  content-effect deps triggers fitToContent and re-frames the camera on a
  cosmetic toggle.
- **Clipping**: bands and seams carry the SAME shared clippingPlanes array
  as every other material (the parent's EVERY-material ruling). The
  floating-stripe-over-cut-away-slab artifact the no-clip variant
  manufactures is worse than the empty cross-section it tries to avoid.
  Cross-section disclosure stays: a cut through a band shows its edge as
  empty — schematic, not as-built.
- **Disclosed limits** (overlay note when Rolls is shown): roll cuts
  ignore slab holes (existing 2D behavior) — bands stripe across holes;
  bands show the COVERAGE slab (finished goods) while the 2D cut overlay
  shows PHYSICAL pieces (which overlap by seam allowance and tuck past
  walls) — both correct, deliberately different questions; a seam drawn
  across a concave notch clips to the room, so drawn seam length can be
  shorter than the priced seam LF when a notch intervenes.
- **Scope**: floor_area roll-goods conditions only; no deduct bands; ×N
  multiplier never duplicates geometry (existing ruling); included in
  EXPORT PNG — and when rolls are visible in the export, the footer strip
  gains the drawn-vs-priced seam caveat (caveats that matter to the bid
  survive the screenshot; the Openings doctrine); control resets to ON per
  overlay open (non-persistent).

### Constants (named, no magic numbers)

`ROLL_BAND_ALPHA = 0.25` · `ROLL_BAND_EPS_FT = 1/48` ·
`ROLL_SEAM_HALF_FT = 1/12` · `ROLL_SEAM_INK_DARK` / `ROLL_SEAM_INK_LIGHT` (luminance-aware pair) ·
`ROLL_BAND_RENDER_ORDER = 1` · `ROLL_SEAM_RENDER_ORDER = 2`

### Tests

- rollgoods seam-segment helper: ns + ew lane axes; interior coverage
  boundary; laneIndex-adjacency guard (dropped lane → no seam);
  de-overaged span; single-lane room → no seam; manual overrides honored.
- rolls payload builder (pure, rollTakeoff-adjacent — parity, z-join,
  clipping, emission gate all live HERE): band parity on laneIndex with
  the laneCount===1 exception (single-lane room bands lane 0); band z =
  owning slab z1 + eps (join by srcId); clipRing footprint (concave notch
  not striped); seam footprint-clipped to the ring; no band without a
  built slab (strip whose shapeId is absent from shapes3d emits nothing).
- scene3d: sheet-feet→world mapping only (y negation vs rollgoods' +y) —
  payload pass-through, no parity/clip logic here.

### Docs sync

USER_GUIDE §18 (Rolls checkbox; bands = coverage/material palette; seams =
coverage boundaries; the coverage-vs-cut-piece and holes disclosures),
README Features bullet, FEATURES.md row, CHANGELOG. No MCP surface.

### Non-goals (v1)

- Seam LF captions / any numbers in-scene (the Report owns numbers).
- Roll direction chosen IN the 3D view (condition roll_setup is authority).
- Bands on walls/transitions/counts — floor roll-goods conditions only.
- Per-shape slab-thickness overrides (do not exist; not invented here).
