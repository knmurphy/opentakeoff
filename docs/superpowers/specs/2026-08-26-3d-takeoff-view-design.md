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
  `TakeoffCanvas.jsx:7917-7939`, carried into 3D). NEVER a boolean subtract at
  render time: standalone deducts are standalone because `findCutoutParent`
  already refused at commit (`cutout.js:26-35`) — re-running it can only
  double-process or re-refuse.
- **`surface_area`** → vertical ribbon along the trace, `z ∈ [0, shape.height_ft]`
  (the shape snapshot — walls keep the height they were drawn at; reviewers
  confirmed this doctrine is exactly right).
- **`linear`, mode vertical** (wall base) → ribbon inset toward the room
  interior, `z ∈ [0, extrude_h_ft]`.
- **`linear`, mode flush** (transition/reducer strip) → thin strip in the floor
  plane, height = `thickness_in` as thickness, not as a standing wall. This
  split is mandatory: RB-1 base and TR-1 transition share `measure_role` and
  are physically opposite installs.
- **`count`** → vertical post at the exact point, `z ∈ [0, extrude_h_ft]`
  (corner guard: spec height, e.g. 4'0").

Ribbon construction: quad strip per segment with miter at joints; near-duplicate
consecutive points collapsed and zero-length segments skipped BEFORE normal
computation (NaN propagates into bounding spheres and silently kills meshes —
Web3D B10; reuse the minDist-filter pattern from `geometry.js` thinStroke).

Interior-side resolution: rings carrying `origin.derived.from_shape_id` are
inset toward the source floor polygon's interior (signed winding). Hand-traced
runs center on path. Coincident wall ribbons (base + wainscot on one wall line
— likely, since snapping makes it so) get small role-specific lateral nudges so
no two ribbons share literal world coordinates (Web3D B9).

### 2. `web/src/lib/scene3dSchema.js` (or within canvasConstants) — new condition fields

**`extrude_h_ft`** — display-only installed height for `linear`-vertical and
`count` conditions, in internal feet. Entered once per condition in inches in
the UI (estimators speak base/guard heights in inches). Persisted on the
condition; unknown-fields-pass-through is established convention
(`materials.js:14-18`), so this is a comment-level schema addition, no
migration. **Do not overload `height_ft`** — its single-purpose contract
("default for NEW wall traces, SF = LF × H") is copy-pinned in
`TakeoffsPanel.jsx:473` and MCP-exposed; a second consumer makes all of that
documentation false.

**`extrude_mode`** — `'vertical' | 'flush' | 'post'`, defaulted by role and
condition seed: RB-1 → vertical 4" nominal, TR-1 → flush, count conditions →
post. Editable per condition.

Unset `extrude_h_ft` → translucent nominal post/ribbon + legend note
(refusal-over-guessing carried into visuals). With per-condition seeds this is
the rare case, not the day-one default.

### 3. `web/src/components/View3D.jsx` — lazy renderer + overlay

`React.lazy(() => import(...))`; Vite splits three into the chunk. Import
`OrbitControls` from `three/examples/jsm/controls/OrbitControls.js` (the file,
not the addons barrel — the 150 KB gz estimate holds only under per-file
imports; verify against a real build before asserting in docs).

Renderer contract (all from the Web3D review):

- **Draw calls:** merge geometry per condition into one BufferGeometry (one
  draw call per visible condition); `InstancedMesh` for count posts
  (instanceId decodes to shape). Explode is then a per-condition
  `Group.position` update per drag tick — never a rebuild.
- **Export:** export handler calls `renderer.render(scene, camera)` then reads
  `canvas.toDataURL()` synchronously in the same call stack (or constructs
  with `preserveDrawingBuffer: true`). The PNG is composited with a footer
  strip: sheet id, scale, date, "schematic — not as-built; openings deducted,
  not shown; verify in field" — the app's export-honesty convention applied to
  its most exportable artifact.
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
- extrude_mode defaults per condition seed.

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
