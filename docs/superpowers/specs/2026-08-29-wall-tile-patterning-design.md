# Wall-Tile Patterning — Design Spec

**Date:** 2026-08-29 · **Branch:** `feat/tile-walls` (lands on `feat/tile-patterning`)
**Status:** DESIGN v2 — 3-lens adversarial review (domain / engine / scope) folded; see
§14 revision log. Ready for a re-review pass, then implementation plan.
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
- **Unequal-height / stepped runs** (one `H` per run — §3.1); model as separate shapes.
- **Reversing / self-touching runs** (a U-turn switches the tiled face mid-run — §3.1);
  rejected with a warning, split into separate runs.
- Per-segment `face_side`, offcut-reuse packing, exact trim-reveal field deduction, and
  robust (non-positional) per-corner override keying — all deferred refinements.

**Non-goals:** changing how floors tile; changing the SF a wall measures (still
`LF × height`) — this changes what you *get* from that SF.

---

## 3. Core model — wall run → unwrapped strip

### 3.1 The run
A `surface_area` shape is an OPEN polyline (`verts_norm`, ≥2 pts) with a per-shape/
condition `height_ft` (`shapeMetrics.js:20-31`). Interior vertices are **corners**
between physical walls. `openLen(pts) × upp` is the total run length `L`; `H` is the
resolved height (override → shape → condition, `shapeMetrics.js:25-27`).

**Slice A run constraints (stated so the model's premises are explicit):**
- **Single height for the run.** One resolved `H` for the whole run — so §4.1's
  automatic course-height continuity holds (equal height + a shared floor line). A run
  crossing walls of *different* height or a floor step is **out of scope** (§2); model
  those as separate shapes. *(scope M5)*
- **Simple (non-reversing) runs only.** The run must be monotone enough that one
  `face_side` describes it. A **U-turn / reversal** (antiparallel adjacent edges, e.g. a
  peninsula return where the tiled face stays on one physical side while the drawn
  direction flips) is **detected and rejected with a warning** ("split this into separate
  wall runs"), because a single `face_side` cannot describe it and the reversal vertex is
  a degenerate cross product §4.3 can't classify. Per-segment face sides are deferred.
  *(domain M4)*
- **Collinear vertices are collapsed** before building the strip: a straight-through
  vertex is neither a corner nor a change of plane, so it must not create a fold-line or a
  movement joint. *(domain Minor)*

**`face_side`.** A traced line does not say which side is the tiled face, and inside/
outside classification needs it. The run carries `face_side: "left" | "right"` **relative
to the drawn direction in the shape's `verts_norm` frame (screen space, y-down) — the
handedness is pinned to that frame** so the cross-product sign in §4.3 is unambiguous;
default `"left"`, user-flippable. Because a wrong side silently inverts the whole trim
BOM (movement-joint LF ↔ finish-edge), the resolved inside/outside labels are **surfaced
visibly** (on the panel preview / elevation) so a wrong side is caught, not silent.
*(domain M4 Minor, scope N1)* Prior art never needed this (TileSim picks a normal toward
the room centroid — `geometry.ts:135`; we have no room polygon, so the user states the
side).

### 3.2 Unwrap
Concatenate the run's segments into one strip in (u = distance along run, v = height):
`stripRing = [[0,0],[L,0],[L,H],[0,H]]` in feet. Corners are interior fold-lines at
cumulative segment lengths `u_k = Σ upp·|seg_i|`. This is the "run of walls"
abstraction **no prior-art repo has** (TileSim = N independent per-edge surfaces, no
shared frame — `prior-art…:36`). The strip is just a ring, so:

### 3.3 Engine reuse — what IS verbatim, what is NOT
**Verbatim (verified by all three reviews):** the **field-count path** is pure over
`ring_ft` + `tile_setup` with no floor semantics — `solveTileLayout`
(`tileSolve.ts:39-163`, assumes only `ringBounds`/`length≥3`; a 4-pt strip is valid),
`classifyLayout`, `countsBySku` (`tiles.ts:23-67`), cutsheet, grout, order, and multi-SKU
repeat-unit painting. The wall strip reuses all of that unchanged.

**NOT verbatim — three real changes the earlier draft wrongly called "reuse":**
1. **Origin optimizer is NOT reused as-is.** The shipped `optimizeOrigin` is 2D and
   balances *both* axes (`optimize.ts:129-131,156-162`). A wall needs a **U-only** search
   with a **pinned V datum** (§4.4). Slice A adds a wall origin mode; it does not call the
   floor 2D optimizer. *(engine C-2, scope C1)*
2. **`summarizeShape`'s corner/movement-joint/trim block is floor-ring-coupled and must
   be replaced for walls.** It runs `cornerTallies(ring_ft)` + `movementJoints({ring_ft})`
   on the ring's own vertices (`tileTakeoff.js:220,228`). On a strip those are the
   rectangle's four right angles / AABB — **not** the physical wall corners at interior
   fold-lines `u_k`. For `surface_area` this block is **branched onto a run-polyline
   computation** (classify run vertices §4.3, joints at inside folds §4.4) and the strip
   ring's own rectangle-corner tallies are **suppressed**. Critically, `agg.jointTotals`
   accumulates **unconditionally** per contributed shape (`tileTakeoff.js:391-395`,
   emission gated at `:507`), so a mixed floor+wall condition would otherwise emit a bogus
   `joint_lf = 2(L+H)+grid`; the wall branch must contribute its **run-keyed** joint LF
   (or zero), never the strip perimeter. *(engine C-1)*
3. **Corner/trim/joint report items are net-new run-keyed rows** — not "report: nothing
   new." The `byCond` field rollup is role-agnostic (true), but the wall trim/joint LF/EA
   lines are new (§5). *(engine C-1)*

### 3.4 Reconciliation invariant (the compatibility Kevin asked for)
The engine tiles the **full** L×H strip (Slice A does not carve trim reveals out of the
field — see below), and cells are **module-footprint** (tile + its joint) that partition
the ring. So `Σ kept-field module area == L × H`, which is **identically** the measured
`area_sf` (`shapeMetrics.js:29`, `totals.js:49` → `wall_sf`) — **exact on the module
basis, no tolerance needed.** *(scope M4, domain C1 resolved by choosing the module basis
+ additive trim.)*

**Trim is additive, not carved (Slice A modeling choice).** Movement-joint and edge
profiles physically occupy a reveal (~profile width), but Slice A tiles the full field
and counts trim as **separate additive LF/EA line items** (§5). This slightly
**over-counts** field tile by `Σ trim_reveal_w × H` — a *conservative* error (you never
order short), documented and acceptable; exact trim-reveal deduction from the field is
deferred. This keeps reconciliation exact **and** never under-orders. *(domain C1)*

**Net vs gross reporting.** The exact reconciliation is on the **module footprint**
(cells partition the ring). A separate **net tile face SF** (field minus grout) is a
reported number, *not* the reconciliation basis — so grout fraction can't make the
flagship invariant trivially-true or reliably-false. *(scope M4)*

**Hole-free only.** This invariant holds for a wall **without openings**; walls with
doors/windows over-order until M11 adds opening deductions (§2, §12, §11.7). *(scope M7)*

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

**Classify inside/outside BEFORE building the strip** (§4.3), because wrap behaves
oppositely at the two corner kinds. Wrap ≠ "flow blindly straight through everything."

### 4.2 The options (default + adjust)
- **Wrap — continuous (DEFAULT).** One strip, one U-origin across the run; the **offset
  phase carries across the fold** so the field reads continuous.
  - **Inside fold:** the pattern folds around — a tile straddling the inside fold is a
    single **corner cut** whose offcut conceptually continues onto the next wall
    (`…conventions.md:48,55`). This is the offcut-carry case.
  - **Outside fold:** the field face is **terminated at the arris** with a finished edge
    (miter / bullnose / profile, §5) — two glazed faces can't meet raw
    (`…conventions.md:50,67`). "Continuous" here means the offset phase still lands
    correctly on the return face; it does **not** mean one tile bends around the corner.
    So an outside fold produces an **end cut on each face + a finish edge**, not an
    offcut-carry. *(domain M1)*
- **Reset per wall (ADJUSTMENT).** The run splits at each fold into sub-strips; each
  sub-strip spans **exactly** `[u_{k-1}, u_k]` (pure centerline segments, **no corner
  allowance** — consistent with `L×H = area_sf`), is balanced from its own **U**-centerline
  (its own U-origin) while **sharing the run's pinned V datum** (§4.4), and its joints do
  not cross the fold. Each shared fold therefore carries **two independent end cuts**, one
  per abutting sub-strip. The situational fallback when wrapping throws a sliver, and the
  norm for feature-wall/per-surface designs (`…conventions.md:60-61,138`). *(scope M2)*
  - **Default (not forced) for herringbone / diagonal.** Sources start these from a
    per-surface center line and are **silent/observed-practice — not codified** on
    carrying the zig-zag phase across a corner (`…conventions.md:92`). So reset is
    **preselected** for herringbone/diagonal, and a **per-corner override can still force
    wrap** — we do not lock it (over-reading a silent source). *(domain/scope M1)*
- **Dropped: "reset-inside / wrap-outside."** Geometrically backwards, in no authoritative
  source (`…conventions.md:50,58,137`).

Per-run default (`wall_corner_mode`, §8) with a **per-corner override** (§8
`corner_overrides`; the override wins over the herringbone default). Per-corner adjust is
a Slice B interaction (on the elevation); Slice A exposes the per-run default. *(scope N3)*

### 4.3 Inside/outside classification
At each *non-collinear* interior vertex, the cross-product of incoming/outgoing edges
(in the pinned `verts_norm` frame, §3.1) gives the turn direction; combined with
`face_side` it yields inside (turn toward the face) vs outside (turn away). Borrowed from
TileCalculator's reflex/convex model (`sides.ts:101-118`, prior-art `:70-82`). The
antiparallel (reversal) case is guarded upstream by the simple-run rejection (§3.1).
**Run endpoints** (`u=0`, `u=L`): default **exposed** (they get a finish edge, §5) with a
per-end `endpoint_exposed` toggle for when the end butts an untiled wall/floor — so
endpoint trim is neither always-on nor always-off. *(domain Minor)*

### 4.4 Layout-quality rules & the wall origin policy (two axes, treated differently)
A wall has **two independent balancing axes** and they are **not** symmetric
(`…conventions.md:33,35`). The shipped 2D `optimizeOrigin` (balances both) is therefore
**not** reused verbatim (engine C-2); Slice A adds a wall origin mode:
- **U axis (horizontal):** center-and-balance — prefer end cuts ≥ ½ tile, not a full tile
  hard against one end. This is a **soft objective** ("*usually* no cuts smaller than half"
  — `…conventions.md:29`), not a hard constraint (wrap may violate it; §13 flags a sub-½
  end cut rather than forbidding it). *(scope N5, M1)*
- **V axis (vertical):** **datum-anchored, not balanced.** A full (or near-full) course
  sits at the **floor/batten line** and the **cut course lands at the top** (wainscot/
  ceiling) — the trade convention (`…conventions.md:33`). The optimizer searches **U only**
  and **pins `origin[1]` to the floor datum** for the whole run. *(scope C1, engine C-2)*
- **Reset shares the V datum.** Each sub-strip re-balances **U** independently but all
  share the one pinned V datum — which is exactly why §11.2 (one shared course grid) and
  §4.2 (own origin per sub-strip) are consistent: they differ in U, share V. *(engine C-2)*
- **Movement joint at every INSIDE corner / change of plane** (mandated —
  `…conventions.md:70,82,95`; the DILEX movement-joint family is the inside-corner line,
  edging is outside — so movement joints are **inside-only**, not "every corner"). Counted
  LF (§5); drawn at each inside fold `u_k`. *(domain Minor — corrects the earlier "every
  corner" wording)*

### 4.5 byShape contract — a real restructuring, not "verbatim"
Reset-per-wall tiles **N** sub-strip rings. Their **counts / cutsheet / order / bySku
aggregate into the shape's single summary** (they only tally `cls` + dims), so the
**report** contract is unchanged (one summary per shape id). But `summarizeShape`
currently returns **one** `layout: TileLayout` (`tileSolve.ts:18-24`), and every consumer
that reads `summary.layout` as a single grid — `markedset` overlay, `tileQA.layoutFor`
(`tileQA.ts:180`), DXF `tile_cells`, MCP snapshot — must handle **N frames**. So
`summarizeShape` is **restructured** to loop N rings and merge, and `summary` carries a
`wallStrips: TileLayout[]` (the single-`layout` field stays for floors). This is real
surgery, named here, not "verbatim reuse." *(engine M-3, scope M2)*

---

## 5. Corner & edge materials (counting)

Grounded in `…conventions.md:74-84` (CSI 09 30 13 submittals; Schluter; Daltile).

**Finish depends on the corner kind AND the chosen finish — and the field cut is
converted, not double-counted:** *(domain M2)*

| Corner / edge | `wall_edge_finish` | What is ordered for that slot | Extra trim line |
|---|---|---|---|
| Outside corner / exposed edge | `profile` (default) | field tile, **square-cut** (EA, counted once) | edge **profile LF** (× edge height) |
| Outside corner / exposed edge | `bullnose` | **bullnose piece EA** — *replaces* the field tile (the field corner-cut EA is **suppressed/converted**, not added) | — |
| Outside corner / exposed edge | `miter` | field tile, cut **and** mitered (EA, counted once) | **mitered-edge LF** as a *labor* line (no separate material piece) |
| Inside corner / change of plane | — | field tile (offcut-carry under wrap; end cut under reset) | **movement-joint LF** (DILEX family) |

So: `profile` = square cut EA **+** profile LF (legitimately both). `bullnose` = one EA,
the field cut is converted (no double count). `miter` = one field cut EA + a mitered-edge
**labor** LF (miter is a fabrication method, not a purchased trim line — this gives the
enum a defined output). *(scope/domain M3)* Movement joints are **inside-only** (§4.4).

**Order / waste model (Slice A — honest and conservative):** *(domain M3, scope M6)*
- **No offcut-reuse packing in Slice A.** Each cut consumes one tile (offcuts not
  re-packed) — a *conservative* over-count that never ships short; an offcut-reuse model
  is deferred.
- **Overage is NOT a hard-coded 10/15/18 %** (those trace only to aggregator sites,
  `…conventions.md:117-128`). It is a **user-editable overage %** persisted as
  `wall_waste_pct` (§8), covering breakage + attic-stock/spares (a *separate named
  quantity* per CSI, not derivable from geometry — `…conventions.md:119`). It **defaults
  to a modest labeled trade value (10%), ON** — defaulting to 0 would knowingly ship short
  (domain M3). Clearly labeled a rule of thumb, editable to 0.
- Trim rolls up as its own report lines (profile LF, movement-joint LF, bullnose EA,
  miter-labor LF), distinct from field-tile order.

---

## 6. Two views, one model

TileSim's strongest reusable idea: one strip render feeds both a flat editor and a
folded view (`prior-art…:159-169`, `SurfaceTexture.ts` → `useSurfaceTexture.ts:31`).

- **Unwrapped elevation → a real synthetic sheet.** The sheet model is not PDF-only: a
  *stitch* is already a synthetic sheet with its own key and shapes (`sheets.ts:6,22`,
  `isStitchKey`). **Caveat (Slice B, not free):** a stitch's *identity* is canvas-only
  runtime state — `sheets.ts:19-22` returns `""` for a stitch label because "its real name
  lives in canvas-only `stitchById` state." So the sheet-gallery identity of an elevation
  sheet is the §13 open item, not something the stitch precedent hands us for free. *(engine
  M-8)* The unwrapped strip becomes a wall-elevation sheet: viewable in the
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
- `wall_corner_mode: "wrap" | "reset"` — default `"wrap"`; **preselected (not forced)**
  `"reset"` for herringbone/diagonal (a per-corner override can force wrap). *(M1)*
- `wall_edge_finish: "profile" | "bullnose" | "miter"` — default `"profile"`.
- `wall_waste_pct: number` — overage %, default **10** (labeled trade rule of thumb,
  editable to 0). *(scope M6, domain M3)*

On the `surface_area` shape:
- `face_side: "left" | "right"` — default `"left"`, handedness pinned to the `verts_norm`
  frame (§3.1).
- `endpoint_exposed: [boolean, boolean]` — are `u=0` / `u=L` exposed (get finish edge)?
  default `[true, true]`. *(domain Minor)*
- `wall_corner_overrides?: Record<runVertexIndex, { mode?, finish? }>` — per-corner opt-in,
  keyed by **run-polyline vertex index**. **This is a DIFFERENT index space** from the
  existing `tile_layout.edge_overrides` (keyed by strip-*ring-edge* index, which for a wall
  are the elevation rectangle's 4 sides — `tileTakeoff.js:210-212`). Named `wall_…` and
  documented so an implementer cannot cross-wire a run-vertex override into a ring-edge
  lookup. *(engine M-7)* (Known edit-fragility of positional-index keys under vertex
  insert/move — prior-art `:Q4` — is accepted for Slice A's per-run default; robust
  per-corner keying is a Slice B concern. *(scope N2)*)

**Cache-sig / invalidation (both sigs, currently height-blind — engine M-1):**
- The inline solve cache (`tileTakeoff.js:329-334`) and `tileLayoutSig`
  (`tileLayoutSig.ts:65-106`) must both fold in: the **resolved height**, `height_override`,
  `measure_role`, and every new field above. The **resolved** height reads `cond.height_ft`
  (`shapeMetrics.js:25-27`), which `tileLayoutSig(shape, tile_setup)` cannot see — so its
  **signature changes** to take the resolved height (or the cond), and `TileLayoutShape`
  (`tileLayoutSig.ts:25-29`) gains `face_side`/`wall_corner_overrides`/`endpoint_exposed`
  at the type level. Miss any and a wall relayouts stale on a height/side edit.

No change to how `area_sf` / `wall_sf` are computed.

---

## 9. Engine gates to open (from the investigation)

Field-count coupling is only at the edges (investigation `:48-71`); the corner/joint/
origin coupling is real (§3.3). Gates to **OPEN**, **CLOSE**, and **ADD**:

**OPEN (admit walls):**
1. **Ring builder:** add `wallStripRing(L, H, corners)` from the `surface_area` shape —
   built **before** the vert-count guard (`ringFt` on an open polyline yields a
   self-touching floor ring). *(engine M-6)*
2. **Role gate:** admit `surface_area` past `tileTakeoff.js:311`; `verts<2` (not `<3`) at
   `tileTakeoff.js:314`.
3. **QA:** the QA feeder has **two** floor-only gates — the role gate `tileQA.ts:87`
   **and** a `verts_norm.length < 3` guard at `tileQA.ts:90`; both need the wall path.
   *(engine M-4)*

**CLOSE (suppress floor-only paths that would silently consume walls) — Slice A, not B:**
4. **Plan-space overlay:** `markedset.js:998-1008` gates only on `tileByShape.get(s.id)` +
   `ring.length<3`, then draws quads at the shape's **plan** ring — a ≥3-vert wall run
   passes and gets tile quads smeared along its plan centerline, **breaking
   `export_marked_pdf`.** Add a `measure_role` guard to **skip `surface_area`** in that
   loop. *(engine M-2, scope C3)* (The investigation's "`markedset.js:216` participation"
   was a **mis-citation** — `:216` is the label-chip switch; the real gate is the overlay
   loop at ~`:998`.) DXF `tile_cells` is already `role==="floor_area"` gated
   (`dxf.ts:232`) — safe by omission; `reportColumns.js:387` `floorPerimeterLf` is
   floor-only but harmless to walls (verify, don't feed walls into it). *(engine M-5)*
5. **Rectangle-corner tallies:** for `surface_area`, **suppress** `summarizeShape`'s
   strip-ring `cornerTallies`/`movementJoints` (they'd read the elevation rectangle) and
   ensure the unconditional `agg.jointTotals` accumulation (`tileTakeoff.js:391-395`) gets
   the wall's **run-keyed** joint LF or zero — never `2(L+H)`. *(engine C-1)*

**ADD (net-new wall code):**
6. **Wall origin mode:** U-only balance + pinned V datum (§4.4) — not the 2D
   `optimizeOrigin`. *(engine C-2)*
7. **Run-keyed corner/joint/trim:** classify run vertices (§4.3), joints at inside folds,
   trim per §5 — the branched replacement for the suppressed floor block.
8. **Cache sig:** the §8 sig edits.
9. **byShape N-strip restructuring** of `summarizeShape` (§4.5) + `wallStrips[]` on the
   summary; update `summary.layout` consumers.

**Report field rollup:** role-agnostic by condition id (investigation `:59-63`); wall
trim/joint lines are new rows (§5). Rendering reuses the quad→corners math in **elevation**
space (Slice A panel / Slice B sheet), never the plan placement.

---

## 10. Presentation / UX

- Default path: trace a wall run under a wall tile condition → it tiles, wrap-continuous,
  balanced, corners and movement joints handled, trim counted. Nothing to configure.
- One **"Corner handling: Wrap / Reset per wall"** per-run control in the Tile panel, an
  **edge-finish** picker (profile/bullnose/miter), a **face-side flip** toggle, and the
  **visible inside/outside labels** (§3.1) so a wrong side is caught. The **per-corner**
  override lives on the elevation and is a **Slice B** interaction — Slice A exposes the
  per-run adjust; the *adjust* half of the doctrine is thus partially deferred. *(scope N3)*
- Copy stays plain and supportive; no jargon dumped on the user.

---

## 11. Correctness invariants (become tests in the plan)

1. **Reconciliation (exact, module basis):** hole-free wall, `Σ kept-field module area
   == L×H == area_sf` **exactly** (cells partition the ring; trim additive, §3.4) — not a
   fuzzy "±1 tile."
2. **Course-height continuity:** wrap and reset both share the one **pinned V datum /
   course grid** (§4.1/§4.4).
3. **V datum:** bottom course sits full/near-full on the floor datum, cut course at the
   top — not centered top-to-bottom (§4.4). *(scope C1, engine C-2)*
4. **Corner-cut PIECE COUNT (area-independent — the feature's whole point):** for a known
   run, **wrap** → exactly **one** straddling cut per interior *inside* fold + an end cut
   per *outside* fold face; **reset** → exactly **two** end cuts per shared fold. Pinned as
   counts, so a double-count/miscount fails even though area reconciles. *(scope C2)*
5. **Corner classification:** known inside/outside run + `face_side` classifies each
   non-collinear vertex; flipping `face_side` inverts all; a reversal run is rejected
   (§3.1/§4.3).
6. **Trim & no double-count:** `bullnose` outside → one EA (field cut **converted**);
   `profile` → cut EA + profile LF; `miter` → cut EA + miter-labor LF; inside →
   movement-joint LF; `wall_waste_pct` applied (default 10%) (§5).
7. **byShape:** a multi-wall reset run yields exactly one summary per shape, carrying
   `wallStrips[]` (§4.5).
8. **Back-compat:** floors, existing `wall_sf` totals (`totals.js:49`), the plan
   marked-PDF overlay, and a `surface_area` shape on a NON-tile condition are all unchanged
   (§9 CLOSE gates enforce it).
9. **Openings:** reconciliation is asserted **hole-free**; a wall with an opening
   over-orders until M11 (honest boundary, §12). *(scope M7)*

---

## 12. Slicing (design the whole; build incrementally)

- **Slice A — quantities (the foundation, "M10 done right"):** unwrap ring builder + the
  OPEN/CLOSE/ADD gates (§9), wall origin mode (U-only + V datum), wrap default + reset
  option + herringbone/diagonal reset *default*, inside/outside classification (simple runs
  only), corner-cut + corner-trim + movement-joint counting, the **sub-½ end-cut flag**
  (§13), `face_side` + visible label, `wall_waste_pct`, reconciliation, panel preview of
  the strip. Deliverable: **hole-free-wall-accurate** orderable wall-tile quantities
  (walls with openings over-order until M11 — honest boundary). *(scope M7, N4)*
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
  gallery identity (the stitch precedent is canvas-only, §6); settle in the Slice B plan.

---

## 14. Revision log — review findings addressed (v1 → v2)

Three adversarial reviews (domain / engine / scope). Files:
`docs/superpowers/research/2026-08-29-wall-tile-review-{domain,engine,scope}.md`.
All three verdicts were REVISE; the **core design held** (two-continuities model,
field-count engine reuse, reconciliation area-logic, dropped fake convention, trim units).

**Critical (all resolved):**
- **Reconciliation broke once corners exist** — trim consumes field width (domain C1).
  → §3.4: tile the **full** field (module-footprint cells partition the ring → exact
  reconciliation), trim is **additive & conservative** (slight over-count, never short);
  exact trim-reveal deduction deferred.
- **Vertical/course origin undefined; floor optimizer wrong for walls** (scope C1, engine
  C-2). → §4.4 wall origin mode: **U-only balance, V pinned to the floor datum**; reset
  shares the V datum (resolves the §4.2-vs-§11.2 contradiction).
- **No invariant pinned the corner-cut piece count** (scope C2). → §11.4 area-independent
  count invariant.
- **Plan-space renderer would smear wall quads / break `export_marked_pdf`** (scope C3,
  engine M-2). → §9 CLOSE gate (skip `surface_area` in `markedset.js:998`); 216 mis-citation
  corrected.
- **`summarizeShape` corner/joint block is floor-ring-coupled; `agg.jointTotals`
  accumulates unconditionally → bogus `joint_lf` on mixed conditions** (engine C-1). → §3.3
  + §9: branch onto a run-keyed computation, suppress the strip-ring tallies.

**Major (all resolved):** herringbone reset = **default not forced** + override wins
(M1); reset **sub-strip semantics** — exact segments, two end cuts/fold, no allowance
(M2); **miter** given a defined labor-LF output (M3); **reconciliation tolerance** pinned
to the module basis (M4); **unequal-height runs out of scope**, equal-height premise
stated (M5); **`wall_waste_pct`** added, default 10% ON — not off (M3/M6); **Slice A
hole-free** honesty (M7); **cache sig** height/role/sig-signature edits named (engine M-1);
**byShape N-strip restructuring** named, not "verbatim," `wallStrips[]` (engine M-3);
**`wall_corner_overrides` vs `edge_overrides`** index spaces reconciled (engine M-7);
**outside-corner bullnose double-count** converted (domain M2); **wrap outside-corner**
behavior defined (terminate + finish edge), not "flow straight through" (domain M1);
**U-turn/reversal runs** rejected with a warning (domain M4).

**Minor folded in:** collinear-vertex collapse; run-endpoint exposure toggle; movement
joints **inside-only** (was "every corner"); `face_side` handedness pinned + label made
visible; `tileQA.ts:90` second guard, `reportColumns.js:387`, `wallStripRing` before the
vert guard (engine M-4/5/6); soft ½-tile objective; sliver flag in Slice A; per-corner
adjust noted as Slice B; stitch-identity caveat for Slice B.

**Explicitly confirmed sound by the reviews (not changed):** the strip/field-count reuse,
`L×H ≡ area_sf`, dropping "reset-inside/wrap-outside," trim units (bullnose EA / profile
LF / joint LF), and refusing the 10/15/18% constants.
