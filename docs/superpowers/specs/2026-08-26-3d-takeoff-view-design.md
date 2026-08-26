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
  standalone because `findCutoutParent` already refused at commit
  (`cutout.js:26-35`) — re-running it can only double-process or re-refuse.
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
  strip bridges floors of different `thickness_in` — its whole purpose; never
  0, so it never coplanar-overlaps the floor beside it). Height =
  `thickness_in` as thickness, not as a standing wall. This split is mandatory:
  RB-1 base and TR-1 transition share `measure_role` and are physically
  opposite installs.
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
(`units.ts` thickVal/dimInputStr patterns), shown only for conditions whose
`extrude_mode` is `vertical` (base) or for `count` conditions — never for
`surface_area` conditions, whose H control already owns height semantics.
Persisted on the condition; unknown-fields-pass-through is established
convention (`materials.js:14-18`), so this is a comment-level schema addition,
no migration. **Do not overload `height_ft`** — its single-purpose contract
("default for NEW wall traces, SF = LF × H") is copy-pinned in
`TakeoffsPanel.jsx:473` and MCP-exposed; a second consumer makes all of that
documentation false.

**`extrude_mode`** — `'vertical' | 'flush'` on linear conditions only (count
shapes render as posts unconditionally — no `post` value exists until a
consumer reads it). **Default when unset: `vertical`** — flush is the opt-in
minority case; the geometry table dispatches unset as vertical so a
user-created third linear condition (a second base product, another reducer
type) never lands in an undefined state. **UI entry point, pinned:** a
two-state toggle beside the extrude_h_ft input on the same param row, after
the `Style <select>` enum precedent at `TakeoffsPanel.jsx:466-472`. Shown for
linear conditions only.

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

**Mixed heights per spec section:** `extrude_h_ft` is per condition. A job
with 4'0" corridor guards and 8'0" loading-dock guards under one finish tag
requires splitting into two conditions (CG-1a/CG-1b) — the same pattern the
app already forces for mixed wall heights today. Stated so an implementer
does not assume one height fits a spec section.

Unset `extrude_h_ft` → translucent nominal post/ribbon + legend note
(refusal-over-guessing carried into visuals). With seeds plus the nudge this
is the rare case, not the day-one default.

### 3. `web/src/components/View3D.jsx` — lazy renderer + overlay

`React.lazy(() => import(...))`; Vite splits three into the chunk. Import
`OrbitControls` from `three/examples/jsm/controls/OrbitControls.js` (the file,
not the addons barrel — the 150 KB gz estimate holds only under per-file
imports; verify against a real build before asserting in docs).

Renderer contract (all from the Web3D review):

- **Draw calls:** merge geometry per condition into one BufferGeometry (one
  draw call per visible condition; slab and ribbon geometries normalized to a
  shared position/normal attribute layout before `mergeGeometries`).
  **Carve-outs, stated:** (1) standalone-deduct excluded volumes are pulled
  OUT of the per-condition merge into one shared translucent-red batch —
  alpha-blended material cannot share a draw call with the condition's opaque
  geometry; (2) count posts get **one InstancedMesh per count-role condition**,
  parented under that condition's Group, with an instanceId→shapeId array
  kept alongside for future consumers (no raycast/picking in v1 — selection
  isolation is 2D-selection-driven). Worst case ≈ #conditions + 1
  excluded-volume batch + #count-conditions InstancedMeshes — still tens.
  Explode is a per-condition `Group.position` update per drag tick, uniform
  across slabs, ribbons, and each condition's post InstancedMesh — never a
  rebuild.
- **Export:** export handler calls `renderer.render(scene, camera)` then reads
  `canvas.toDataURL()` synchronously in the same call stack (or constructs
  with `preserveDrawingBuffer: true`). The PNG is composited with a footer
  strip: sheet id, scale, date, "schematic — not as-built; openings deducted,
  not shown; verify in field" — a NEW convention (current exports carry only
  a "Generated {date}" footer) extending the house refusal-over-guessing
  philosophy to the app's most exportable artifact.
- **Section cut:** horizontal clipping plane, no stencil caps in v1 (thin-shell
  geometry makes an open cut edge acceptable at schematic fidelity). Documented
  scope: this is a near-floor audit affordance (base-ring closure, guard
  placement), NOT a wainscot-height-difference audit — that needs a vertical
  section the data does not support. **Section cut and explode are mutually
  exclusive in the UI** (a world-space plane does not track per-condition Δz;
  coupling them is undefined physics).
- **Lifecycle:** on unmount — `renderer.dispose()`, `renderer.forceContextLoss()`,
  dispose every geometry/material, null refs. WebGL context-lost → overlay +
  re-init. If open/close profiling shows hitches, keep one renderer alive
  hidden instead of remounting.
- **DPI/resize:** `ResizeObserver` → `camera.aspect` + `renderer.setSize()`;
  `setPixelRatio(min(devicePixelRatio, 2))`.
- **Framing:** fit-to-content from bounding sphere + FOV, recomputed on legend
  toggle (visible content changes).

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
- Roll-seam rendering from `rollgoods.js` figured layouts (cheap, real value,
  not v1).
- Vertical section cuts.
- MCP view verb — requires headless-browser architecture, specced separately.
- Stitch panels / elevation data of any kind.
