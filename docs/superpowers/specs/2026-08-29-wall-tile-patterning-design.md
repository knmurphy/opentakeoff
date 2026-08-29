# Wall-Tile Patterning — Design Spec

**Date:** 2026-08-29 · **Branch:** `feat/tile-walls` (lands on `feat/tile-patterning`)
**Status:** DESIGN — for adversarial review, then implementation plan.
**Supersedes:** `docs/superpowers/specs/2026-08-29-tile-wall-m10.md` (the strip-only
M10). That spec tiled a *single straight* wall run into one L×H strip and explicitly
deferred multi-wall / corners; this spec makes the multi-wall run with corners the
core, because that is the real feature (see Provenance).

**Provenance (grounded, not recalled):**
- Real tile-setting layout conventions: `docs/superpowers/research/2026-08-29-wall-tile-layout-conventions.md` (ANSI A108.02 §4.3, CSI 09 30 13, CTEF, Schluter, Daltile + trade practice).
- Prior-art code (TileSim / tiletakeoff / TileCalculator): `docs/superpowers/research/2026-08-29-wall-tile-prior-art-corners-sketch.md`.
- Engine reuse feasibility + floor-only gate map: `docs/superpowers/research/2026-08-29-wall-tile-m10-investigation.md`.
- Shipped foundation this builds on: multi-SKU repeat-unit painting + origin honoring (`tile-multi-sku-plan` memory; on this branch at `596ac1e`).

---

## 1. Goal

Turn a wall (or a *run* of walls) measured as a `surface_area` shape on a tile
condition into a cut-accurate, orderable tiled elevation: the same shipped floor +
repeat-unit engine, run over an unwrapped strip, with corners modeled explicitly —
so the estimator gets real piece / cut / corner-trim / order quantities and a viewable
elevation, not a `perimeter × height` area proxy.

**Design doctrine (binding):** a reliable **default that just works**, with the
alternatives available as **adjustments when the job needs them**, presented simply
(progressive disclosure — not a wall of knobs). Among several valid tile-setting
methods we pick one defensible default grounded in the conventions research; the rest
are opt-in. (`design-for-options-not-one-size` memory.)

---

## 2. Scope

**In scope (this design, built in slices — see §12):**
- A `surface_area` shape spanning one or more physical walls (an open polyline whose
  interior vertices are corners) unwraps into a continuous elevation strip and tiles.
- Corner model: wrap-continuous default + reset-per-wall adjustment; inside/outside
  classification; corner-cut and corner-trim counting; movement joints at corners.
- Reconciliation to the engine's measured `wall_sf`.
- Repeat-unit "sketch the pattern" painting reused over the wall strip (already shipped).
- Unwrapped elevation as a real synthetic sheet + a wrapped (folded) view of the same
  strip.

**Out of scope (deferred to M11+, named so the design isn't shortsighted):**
- Openings/niches as holes in the strip; niche interior faces (an *addition*).
- Base courses (cove/bullnose base as a distinct course), wainscot band stacks.
- Wet-area / membrane engine (wet-tag, wet-height, seam/corner/pipe waterproofing).
- Full 3D surface engine (the wrapped view is a 2D fold-back, not 3D — YAGNI).
- Curbs / benches / soffits.

**Non-goals:** changing how floors tile; changing the SF a wall measures (still
`LF × height`) — this changes what you *get* from that SF.

---

## 3. Core model — wall run → unwrapped strip

### 3.1 The run
A `surface_area` shape is an OPEN polyline (`verts_norm`, ≥2 pts) with a per-shape/
condition `height_ft` (`shapeMetrics.js:20-31`). Interior vertices are **corners**
between physical walls. `openLen(pts) × upp` is the total run length `L`; `H` is the
resolved height (override → shape → condition, `shapeMetrics.js:25-27`).

**New: `face_side`.** A traced line does not say which side is the tiled face, and
inside/outside corner classification needs it. The run carries `face_side: "left" |
"right"` (relative to the drawn direction), default `"left"`, user-flippable. This
makes each interior vertex unambiguously inside (turn toward the face) or outside
(turn away). Prior art never needed this (TileSim tiles per-edge with a normal chosen
toward the room centroid — `geometry.ts:135`; we have no room polygon, so the user
states the side).

### 3.2 Unwrap
Concatenate the run's segments into one strip in (u = distance along run, v = height):
`stripRing = [[0,0],[L,0],[L,H],[0,H]]` in feet. Corners are interior fold-lines at
cumulative segment lengths `u_k = Σ upp·|seg_i|`. This is the "run of walls"
abstraction **no prior-art repo has** (TileSim = N independent per-edge surfaces, no
shared frame — `prior-art…:36`). The strip is just a ring, so:

### 3.3 Engine reuse (verbatim)
`solveTileLayout({tile_setup, ring_ft: stripRing, holes_ft})` and everything
downstream (`classifyLayout`, `countsBySku`, `optimizeOrigin`, repeat-unit painting,
cutsheet/grout/order) are pure over `ring_ft` + `tile_setup` and assume no floor
semantics (investigation `:37-46`). The wall strip reuses all of it — including
multi-SKU painting and origin honoring — with **no engine fork**.

### 3.4 Reconciliation invariant (the compatibility Kevin asked for)
The strip's gross field area is `L × H`, which is **identically** the shape's measured
`area_sf` (`shapeMetrics.js:29`, `totals.js:49` → `wall_sf`). Same LF, same height,
same feet frame the engine already measures in.
**Acceptance invariant:** for a hole-free wall, `Σ kept-cell area (full+cut+corner)`
== the engine's `area_sf` for that shape, within one tile's rounding. The tile layer
adds pieces/cuts/waste *on top of* a number the estimator already trusts.

---

## 4. Corner model

### 4.1 The two continuities (why the naïve framing was wrong)
The conventions research separates what the corner question conflates
(`…layout-conventions.md:42-51`):
1. **Course-height continuity** — grout-line *heights* on both walls. Governed by the
   level batten; a level line is level everywhere, so at an inside corner heights align
   **automatically and non-optionally**. Not a user choice.
2. **Offset-phase / field-position continuity** — whether the running-bond stagger and
   the horizontal position of vertical joints carry through a corner or restart. **This
   is the only thing "wrap vs reset" actually controls.**

So the modeled choice is exclusively about offset-phase / horizontal field position.
Course heights always continue (single `v` axis for the whole strip).

### 4.2 The options (default + adjust)
- **Wrap — continuous (DEFAULT).** One strip, one balanced origin; the pattern flows
  straight through; a tile straddling a corner fold-line is a **corner cut** whose
  offcut conceptually starts the next wall. Standard practice for the primary field at
  inside corners (`…conventions.md:54-55,136`).
- **Reset per wall (ADJUSTMENT).** The run splits at each corner into sub-strips; each
  sub-strip is balanced from its own centerline (its own origin); joints do not cross
  the corner. The situational fallback when wrapping throws a sliver, and the norm for
  feature-wall/per-surface designs (`…conventions.md:60-61,138`).
  - **Auto-default for herringbone / diagonal.** Sources start these from a per-surface
    center line and do not carry the zig-zag phase across a corner
    (`…conventions.md:92`); this also matches the shipped per-surface origin work.
- **Dropped: "reset-inside / wrap-outside."** The research shows it is geometrically
  backwards and appears in no authoritative source (`…conventions.md:50,58,137`).
  (My earlier framing was wrong; consulting the references caught it.)

Per-run default with a **per-corner override** (a corner can be forced wrap or reset).

### 4.3 Inside/outside classification
At each interior vertex, cross-product of incoming/outgoing edges gives the turn
direction; combined with `face_side` it yields inside (toward face) vs outside (away).
Borrowed from TileCalculator's reflex/convex vertex model (`sides.ts:101-118`,
prior-art `:70-82`). Outside corners are **physically interrupted** (finished edge) —
they always terminate the field and generate trim (§5); the pattern may still be drawn
continuing onto the return in the wrapped view.

### 4.4 Layout-quality rules (from standards; applied to the strip origin)
- **Center and balance**, no cut smaller than half a tile (ANSI A108.02 §4.3 via CTEF;
  CSI 09 30 13 — `…conventions.md:28-33`). The origin optimizer's objective for a wall
  strip prefers balanced end cuts ≥ ½ tile, not a full tile hard against one end.
- **Movement joint at every corner / change of plane** (mandated — `…conventions.md:70,95`).
  Counted as an inside-corner LF item (§5); rendered as a joint line at each fold `u_k`.

### 4.5 byShape contract (resolves the old M10 worry)
Reset-per-wall tiles N sub-strips, but their counts **aggregate into the shape's single
summary** (sum of sub-strip tallies). `byShape` stays one summary per shape id; the
multiple sub-strip layouts are internal to that summary. No report-contract change.

---

## 5. Corner & edge materials (counting)

Grounded in `…conventions.md:74-84` (CSI 09 30 13 submittals; Schluter; Daltile):

| Item | Where | Unit |
|---|---|---|
| Field-tile corner **cuts** | tiles straddling a corner fold (wrap) or the end cuts (reset) | EA (part of piece count) |
| **Bullnose / pre-formed corner piece** | outside corners + exposed field edges (end of a half-wall, top of wainscot) | **EA** (per corner tile / per course) |
| **Metal/PVC edge profile** (RONDEC/QUADEC/JOLLY…) | outside corners + exposed edges, as an alt to bullnose/miter | **LF** (× edge height) |
| **Cove / inside-corner piece; movement-joint profile** (DILEX-HK…) | inside corners, changes of plane | **LF** |

Rules:
- Outside corner or exposed edge ⇒ a **finish-edge** line item (default **profile LF**,
  switchable to **bullnose EA** or **miter** — a per-run default with per-corner override).
- Inside corner ⇒ a **movement-joint LF** line item (mandated by standards).
- **Waste is NOT a hard-coded 10/15/18 %.** Those figures trace only to aggregator
  sites (`…conventions.md:117-128`). Derive order waste from the *actual computed
  corner/perimeter cut count* per wall; expose any flat overage as a user-editable trade
  default clearly labeled a rule of thumb, defaulting off.

Trim rolls up as its own report lines (LF and EA), distinct from field-tile order.

---

## 6. Two views, one model

TileSim's strongest reusable idea: one strip render feeds both a flat editor and a
folded view (`prior-art…:159-169`, `SurfaceTexture.ts` → `useSurfaceTexture.ts:31`).

- **Unwrapped elevation → a real synthetic sheet.** The sheet model is not PDF-only: a
  *stitch* is already a synthetic sheet with its own key and shapes (`sheets.ts:6,22`,
  `isStitchKey`). The unwrapped strip becomes a wall-elevation sheet: viewable in the
  canvas, listed in the sheet gallery, annotatable, and exported by
  `export_marked_pdf` / DXF like any sheet. Floor line at strip bottom (V-flip, as
  TileSim `SurfaceEditor.tsx:128-130`); corner fold-lines and movement joints drawn;
  reference/centerlines and cut dimensions shown (shop-drawing convention,
  `…conventions.md:99-113`).
- **Wrapped view.** The same strip folded back at each `u_k` onto the run's plan
  footprint (a 2D fold, not 3D). Reuses one renderer; shows the pattern turning corners.

Slice B delivers the sheet; Slice C the wrapped view (§12). Slice A ships the
quantities + a panel preview of the strip so value lands before the sheet plumbing.

---

## 7. Sketch-the-pattern (already shipped — reused)

The repeat-unit "paint one iteration, assign SKUs to slots" model that all three
reference repos LACK (TileSim paints absolute cells, not a repeat — `prior-art…:88-110`)
is exactly what we shipped for floors (multi-SKU). It is pure over the ring, so it
applies to the wall strip **unchanged** — no new painting code; the wall strip is just
another ring the repeat-unit assignment runs over. (Adopt TileCalculator's
surface-absolute, negative-safe cell index `floor((minX−offset)/module)` for
slot-keying stability under edits — `prior-art…:200-208` — a known follow-up, not new
to walls.)

---

## 8. Data model additions

On the tile condition's `tile_setup` (defaults; all optional, back-compatible):
- `wall_corner_mode: "wrap" | "reset"` — default `"wrap"`; forced `"reset"` for
  herringbone/diagonal patterns.
- `wall_edge_finish: "profile" | "bullnose" | "miter"` — default `"profile"`.

On the `surface_area` shape:
- `face_side: "left" | "right"` — default `"left"`.
- `corner_overrides?: Record<vertexIndex, { mode?, finish? }>` — per-corner opt-in.

No change to how `area_sf` / `wall_sf` are computed. New fields fold into
`tileLayoutSig` so the layout invalidates when they change (extend the existing sig;
see the shipped `tileLayoutSig` ruling in `tile-multi-sku-plan`).

---

## 9. Engine gates to open (from the investigation)

Floor-coupling is only at the edges (investigation `:48-71`). To admit walls:
1. **Ring builder:** add `wallStripRing(L, H, corners)`; the run/height/corners come
   from the `surface_area` shape (not `ringFt`'s `verts×dims×upp` floor path).
2. **Role gate:** admit `surface_area` past `tileTakeoff.js:311` (`measure_role !==
   "floor_area"` continue) — build the strip ring instead of `ringFt`; also the
   participation check at `markedset.js` and any `reportColumns` role filter.
   `verts<2` guard (surface needs ≥2, not ≥3).
3. **Cache sig:** include height + `measure_role` + the §8 fields so a wall relayouts
   correctly.
4. **QA:** extend the `floor_area`-only QA feeder (`tileQA.ts:87`).
5. **Report:** nothing new — `computeTileTakeoff` is role-agnostic by condition id
   (investigation `:59-63`); wall trim lines are new report rows (§5).

Rendering: plan-space quad placement (`markedset.js:1005/1017`, `tileDxf.ts`) is
floor-only; the wall strip renders in elevation space (Slice B sheet / Slice A panel),
reusing the quad→corners math, not the plan placement.

---

## 10. Presentation / UX

- Default path: trace a wall run under a wall tile condition → it tiles, wrap-continuous,
  balanced, corners and movement joints handled, trim counted. Nothing to configure.
- One **"Corner handling: Wrap / Reset per wall"** control in the Tile panel, with a
  **per-corner** override on the elevation, and an **edge-finish** picker
  (profile/bullnose/miter). A **face-side flip** toggle. All tucked under the default.
- Copy stays plain and supportive; no jargon dumped on the user.

---

## 11. Correctness invariants (become tests in the plan)

1. **Reconciliation:** hole-free wall strip kept area == `area_sf` (±1 tile) (§3.4).
2. **Course-height continuity:** all sub-strips share one `v` course grid (§4.1).
3. **Wrap vs reset:** wrap → one origin across the run; reset → each sub-strip
   independently balanced, no sub-half end cut (§4.2/4.4).
4. **Corner classification:** a known inside/outside run + `face_side` classifies each
   vertex correctly; flipping `face_side` inverts them (§4.3).
5. **Trim counting:** outside corners → finish-edge lines; inside corners →
   movement-joint LF; units EA/LF per §5; no hard-coded waste %.
6. **byShape:** a multi-wall reset run yields exactly one summary per shape (§4.5).
7. **Back-compat:** floors and existing wall SF totals unchanged; a `surface_area`
   shape on a NON-tile condition still just measures SF.

---

## 12. Slicing (design the whole; build incrementally)

- **Slice A — quantities (the foundation, "M10 done right"):** unwrap ring builder,
  role gate + cache sig, wrap default + reset option + auto-reset for herringbone/
  diagonal, inside/outside classification, corner-cut + corner-trim + movement-joint
  counting, `face_side`, reconciliation, panel preview of the strip. Deliverable:
  correct orderable wall-tile quantities.
- **Slice B — elevation sheet:** promote the strip to a synthetic (stitch-precedent)
  wall-elevation sheet — canvas view, gallery, annotate, export.
- **Slice C — wrapped view:** the 2D fold-back render of the same strip.
- **M11+:** openings/niches (holes), base courses, wet-membrane, 3D.

Each slice is its own plan → SDD/TDD → adversarial review, landing on
`feat/tile-patterning`. No PR/merge — upstream submission comes after the whole tile
line is built out.

---

## 13. Open questions / rulings for the plan

- **Precedence when wrap would throw a sliver on the next wall.** Standards are silent;
  it's setter judgment (`…conventions.md:70`). Ruling: default keeps wrap; the origin
  optimizer flags (does not auto-reset) a sub-½ end cut, and the per-corner override lets
  the user reset that corner. Revisit if it proves annoying.
- **Face-side inference.** v1 = explicit `face_side` (default left) + flip. A later
  heuristic (nearest floor shape / room) is possible but not built (YAGNI).
- **Elevation sheet scale & placement** (Slice B): a generated sheet needs a scale and a
  gallery identity; settle in the Slice B plan (reuse stitch conventions).
