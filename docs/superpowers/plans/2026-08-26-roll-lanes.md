# Plan — Roll-good lanes on the 3D slabs (spec r3 rev 3)

Spec: `docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md`, final
addendum. Every ruling below traces to it; do not improvise alternatives.

## T1 — Pure: roll payload builder + seam segments (rollgoods.js, rollTakeoff.js, scene3d.js)

**rollgoods.js — `seamSegmentsBySrc(strips)`** (beside `seamLfBySrc`, sharing
its grouping/adjacency discipline):
- Group strips by `srcId`, sort by `laneIndex`.
- For lane-adjacent pairs (`b.laneIndex === a.laneIndex + 1`), boundary at
  `a.coverMax`; span = overlap of de-overaged extents
  `max(a.runMin + a.minOverageFt, b.runMin + b.minOverageFt) …
  min(a.runMax − a.maxOverageFt, b.runMax − b.maxOverageFt)`; skip empty
  overlap. Returns `Map<srcId, {boundary, laneAxis, runLo, runHi,
  a:[x,y], b:[x,y]}[]>` in sheet feet — `boundary` + `laneAxis` are
  explicit fields so the footprint clip consumes stated data (never
  inferred from endpoint coordinates).

**rollTakeoff.js — `buildRollBands(entries, ringBySrc, slabZBySrc)` →
{bands, seams}** (pure; called from TakeoffCanvas's rolls3d memo — this is
the "rolls payload builder" of the spec's test section):
- `entries = [{condId, tag, material, strips}]` — derived per roll-goods
  condition from `rollTakeoff.byCond` (summaries carry material + strips;
  condId is the Map key; tag from the condition). THIS signature is the
  contract; do not change it.
- bands: per strip, odd `laneIndex` (EXCEPTION `laneCount === 1` → band
  lane 0), poly = `clipRingToLaneSlab(ring, laneAxis, coverMin, coverMax)`
  with its run-axis extent clamped to the strip's de-overaged interval,
  `{poly, z: slabZ + ROLL_BAND_EPS_FT, fill: rollColorForType(material),
  tag, shapeId: strip.srcId, condId, laneIndex}`. Skip strip if
  `slabZBySrc` has no entry — no band without a built slab.
- seams: from `seamSegmentsBySrc`, each segment → thin footprint clip
  `clipRingToLaneSlab(ring, laneAxis, boundary − ROLL_SEAM_HALF_FT,
  boundary + ROLL_SEAM_HALF_FT)` (δ = ROLL_SEAM_HALF_FT = 1/12 — the clip
  output IS the 1/6-ft seam quad; NOT 1/48, that's ROLL_BAND_EPS_FT, the
  band z-offset), run-clamped to [runLo, runHi], `{poly, z: same, tag,
  shapeId, condId}`. Skip if no slab entry.
- The RING for each src must reach this builder: `computeRollTakeoff`
  builds feet rings internally (rollTakeoff.js:120) — thread them out via
  a `ringsBySrc` Map on its return (smallest diff), keep it pure.

**scene3d.js — `buildScene({ shapes, conditions, sheet, rolls })`** (input
contract AMENDED per spec): gains `rolls = {bands, seams}` in SHEET FEET;
internally maps sheet-feet polys → world via a `[x, −y]` negation helper
(`rollsToWorld`; NOT `toWorldFt`, which scales normalized coords — fold
−0 to +0 like toWorldFt does) and returns world-mapped `rolls` alongside
the existing output. scene3d stays engine-free. View3D's sceneResult memo
passes `rolls` into `buildScene` AND lists it in deps; the content effect
consumes the world arrays via `built` (identity already in its deps) — no
extra suppressions.

Constants (scene3d.js or canvasConstants.js per existing placement):
`ROLL_BAND_ALPHA = 0.25`, `ROLL_BAND_EPS_FT = 1/48`, `ROLL_SEAM_HALF_FT
= 1/12`, `ROLL_SEAM_INK_DARK` / `ROLL_SEAM_INK_LIGHT` (neutral pair,
e.g. `#2a2a2a` / `#e8e8e8`), `ROLL_BAND_RENDER_ORDER = 1`,
`ROLL_SEAM_RENDER_ORDER = 2`.

**TDD first**, in the existing test homes (module convention — no new
rollbands.test.ts): seam helper → `web/test/seamLf.test.ts`; payload
builder → `web/test/rollTakeoff.test.ts`; scene3d mapping →
`web/test/scene3d.test.ts`. Coverage = the spec's Tests section verbatim:
seam helper (axes, boundary, laneIndex-adjacency guard, de-overaged span,
single-lane none, overrides honored); payload builder (parity +
laneCount===1 exception, z-join by srcId, concave notch not striped, seam
footprint-clipped AND ~2×ROLL_SEAM_HALF_FT wide, no band without a built
slab); scene3d (sheet-feet→world y negation only — no scaling, −0 fold).

## T2 — Wire the rolls3d memo (TakeoffCanvas.jsx)

- `rolls3d = useMemo(() => buildRollBands(byCond entries joined to
  shapes3d by srcId; slabZ per shape from its condition's thickness_in/12
  with nominal fallback; rings from the threaded-out ringsBySrc),
  [rollByCond, shapes3d])`.
- Pass `rolls={rolls3d}` at the View3D mount. NO inline filter (camera-reset
  trap; the shapes3d pattern).

## T3 — Render (View3D.jsx)

- `EMPTY_SCENE` (View3D.jsx error fallback) gains `rolls: { bands: [],
  seams: [] }` — the content effect runs on `built = sceneResult.data ||
  EMPTY_SCENE` and must never TypeError on `built.rolls`.
- Content effect (reads world rolls from `built`): per roll-goods
  condition, merged band mesh + merged seam mesh, parented under the
  condition's Group via the addMesh → splitByFocus path (shapeId-keyed;
  worst case 4 meshes/cond). addMesh takes an additive `renderOrder`
  parameter (no existing caller disturbed) to set band/seam orders. Bands: triangulated flat polys
  (slab-footprint pattern), `fill` color, `transparent, opacity:
  ROLL_BAND_ALPHA, depthWrite: false`, renderOrder 1, shared
  clippingPlanes. Seams: same triangulation, luminance-aware ink picked
  with the EXISTING `luminance(hex)` helper (lineStyles.js:106) against
  the owning slab's condition color, `transparent, depthWrite: false`
  (both families — the spec's ruling), renderOrder 2.
- Panel: `Rolls` checkbox beside plan controls, default ON, non-persistent;
  visibility-only walk over band/seam meshes (never a content rebuild).
  When Rolls is ON, show the disclosed-limits note (full spec wording —
  cuts ignore slab holes — bands stripe across holes; bands show the
  coverage slab (finished goods) while the 2D cut overlay shows physical
  cut pieces; a seam drawn across a concave notch clips to the room, so
  drawn seam length can be shorter than the priced seam LF.
- Export PNG: rolls visible → footer gains the drawn-vs-priced seam caveat.
- Disposal rides the existing disposeObject3D traverse (Groups reach them).

## T4 — Docs

USER_GUIDE §18 (Rolls checkbox; bands = coverage/material palette; seams =
coverage boundaries; the three disclosures) — UI text quoted verbatim;
§15 untouched (guideParity.test.ts gates §15 key tables only — not in
scope). README Features bullet, FEATURES.md row, CHANGELOG. No MCP surface.

## Order & gates

T1 (tests first, red→green) → T2 → T3 → headed validation → T4 →
`npm run check` (PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH") →
diff code-review cycle.

## Headed validation checklist

Fixture `3d-view-test.otk` lacks roll_setup — extend
`make-3d-test-project.mjs` with a roll-goods condition (carpet/vinyl +
roll_setup; include a small single-lane room and, if feasible, a concave
room) and regenerate the fixture. Then: bands show at material color with
parity (single-lane room banded); seams as ink lines ~1/6 ft wide at lane
boundaries; Rolls toggle hides/shows without camera reframe; limits note
shows when on; legend toggle hides a condition's rolls; explode lifts
them with the slab; selection isolation hides out-of-set rooms' rolls;
section cut slices them with the slab; EXPORT PNG includes rolls + footer
caveat; sheet-switch while open leaves no ghosts; unmount clean.
