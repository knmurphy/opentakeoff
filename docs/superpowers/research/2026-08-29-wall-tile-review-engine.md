# Adversarial review — Wall-Tile Patterning design spec (engine-integration lens)

**Date:** 2026-08-29 · **Reviewer lens:** where reuse/integration claims BREAK against actual code.
**Target spec:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md`
**Cited investigation:** `docs/superpowers/research/2026-08-29-wall-tile-m10-investigation.md`
**Codebase:** `web/src/lib/*` (verified against source, not the spec's citations).

**Verdict: REVISE.** The central thesis (a rectangle strip ring reuses `solveTileLayout` /
`classifyLayout` / `countsBySku` / cutsheet / order / grout / multi-SKU painting) holds and is
well-grounded. But the spec's stronger framing — §3.3 "everything downstream reuses all of it …
no engine fork" and §9 gate-5 "Report: nothing new" — is contradicted by `summarizeShape`'s
built-in trim / corner / movement-joint block, which is coupled to the *floor ring geometry* and
cannot serve a wall's corners. One Critical missed gate, three Major integration gaps.

---

## What the spec gets right (verified)

- **Pure ring reuse for field counts.** `solveTileLayout` (`tileSolve.ts:39-163`) assumes only
  `ringBounds` with `ring.length >= 3` (`tileSolve.ts:26-27`); a strip `[[0,0],[L,0],[L,H],[0,H]]`
  is 4 pts, valid. `classifyLayout`, `tileCounts`/`countsBySku` (`tiles.ts:23-67`), grout, order,
  cutsheet, per-quad SKU assignment are all pure over `ring_ft`+`tile_setup`. No floor semantics
  in the field-count path. ✓
- **Reconciliation identity (§3.4/§11.1).** `area_sf = openLen(pts)*upp*height = L×H`
  (`shapeMetrics.js:28-29`). A full rectangle strip keeps its whole area → kept≈L×H. Invariant is real. ✓
- **Role gate location.** `tileTakeoff.js:311` `if (s.measure_role !== "floor_area") continue;` ✓;
  `ringFt` `tileTakeoff.js:29-31` ✓; `tileQA.ts:87` role gate ✓; `totals.js:49` wall_sf path ✓;
  report wiring is role-agnostic by condition id (`tileReportRows` keys `r.id`, `tileTakeoff.js:568-576`). ✓
- **Back-compat, partial (§11.7).** `wall_sf` (`totals.js:49`) is a separate path the tile engine
  never touches — admitting surface to the engine does not change it. A `surface_area` on a
  NON-tile condition never enters `computeTileTakeoff` (conditions filtered by `hasTileSetup`,
  `tileTakeoff.js:256`). Both claims hold. ✓ (But see MAJOR-2: the marked-PDF path is NOT back-compat-safe.)

---

## CRITICAL

### C-1 — `summarizeShape`'s trim + corner + movement-joint block is floor-ring-coupled; the spec's corner/joint model (§4/§5) is NOT reuse, and the existing block will MISS or MIS-count wall corners.
`summarizeShape` (`tileTakeoff.js:133-230`) unconditionally runs, over the *same `ring_ft`*:
- `cornerTallies(ring_ft, exposures)` (`tileTakeoff.js:220` → `borders.ts:76-119`) — classifies
  convex/reflex at **ring vertices** via signed area.
- `movementJoints({ ring_ft })` (`tileTakeoff.js:228` → `joints.ts:46-65`) — perimeter LF + an
  interior field grid over the ring's **AABB** at 24 ft.

For a wall strip the ring is the rectangle `[[0,0],[L,0],[L,H],[0,H]]`. Its four vertices are the
*top/bottom/left/right of the unwrapped elevation* — **not** the physical wall corners, which are
fold-lines at cumulative `u_k` **interior to the strip and invisible to the ring**. Consequences:

1. The spec's mandated "movement joint at every corner / change of plane" (§4.4, §5) **cannot be
   produced by `movementJoints`** — it only knows perimeter + a 24 ft grid over the AABB. If joints
   ever emit for a wall, they land at 24 ft grid intervals, not at `u_k`. Actively wrong for walls.
2. Inside/outside corner classification (§4.3) — the spec itself says this is new code keyed off the
   **run polyline** (cross-product of run edges + `face_side`). `cornerTallies` over the strip ring
   classifies the rectangle's four right angles instead. So the corner counts fed into
   `agg.trim.corner_inside/outside` (`tileTakeoff.js:383-385`, report rows `tileTakeoff.js:618-619`)
   are geometrically meaningless for a wall.

This directly contradicts §3.3 ("everything downstream … reuses all of it … no engine fork") and
§9 gate-5 ("Report: nothing new"). The marquee corner model is **net-new run-keyed code**, and the
existing `summarizeShape` trim/joint block must be **branched or replaced for `surface_area`**, or
it will feed wrong-corner numbers into the condition trim/joint totals. The §9 gate map does not
list this gate.

**The "default is inert" escape hatch does NOT hold for a mixed floor+wall condition.**
`agg.jointTotals` is accumulated **unconditionally** for every contributed shape
(`tileTakeoff.js:391-395`; the comment says so: "every contributed shape adds its perimeter/field LF
whether or not it carries a confirmed trim edge"). Only *emission* is gated by `agg.hasTrim`
(`tileTakeoff.js:507`). Wall tile usually shares a condition with nothing — but the investigation
being reviewed states a condition's `tile_goods` sums **floor + wall** shapes (`…investigation:81-83`),
and §10 ships an **edge-finish picker** whose whole job is to confirm edges on wall shapes. So the
moment ANY shape on the condition has one confirmed edge → `hasTrim` true → `agg.joints` emits,
carrying the wall strip's bogus `perimeter_lf = 2(L+H)` + AABB field grid into `joint_lf` on the
report row (`tileTakeoff.js:620`). That is a **silently wrong bid line**, not just a missing feature.
§10's own edge-finish UX is the trigger that arms C-1.

---

### C-2 — The shipped origin optimizer is 2D and balances BOTH axes; on a wall it produces a non-trade V datum, and §4.2 (per-sub-strip origin) contradicts §11.2 (shared course grid) by construction.
§4.4 asserts, of the *existing* optimizer: "The origin optimizer's objective for a wall strip
prefers balanced end cuts ≥ ½ tile." Verified against `optimize.ts` — and the reality breaks the
spec's own invariants:

- `optimizeOrigin` searches **both** axes: nested `for (ox of xCandidates) for (oy of yCandidates)`
  (`optimize.ts:156-162`), and the objective **sums x AND y imbalance**
  (`optimize.ts:129-131`, `axisImbalance(..., "x") + axisImbalance(..., "y")`). It is 2D and
  floor-symmetric — it balances leftover cuts on **all four** edges of the ring's AABB.
- On a wall strip the **y axis is the elevation height (floor→ceiling)**. Balancing y splits the
  leftover course evenly → a **partial course at BOTH the floor and the ceiling**. That is not
  trade practice: a wall is set from a fixed vertical datum (level batten / floor line), cut course
  landing at one end. §4.1 itself says course-height continuity is a "non-optional" level datum —
  yet nothing in the spec constrains the search to the U axis, and `effectiveTileSetup`
  (`optimize.ts:194-195`) calls the full 2D `optimizeOrigin` for any `balanced` condition. Verbatim
  reuse gives a wrong V datum.
- **Reset-per-wall is a hard internal contradiction.** §4.2 says each sub-strip is "balanced from
  its own centerline (**its own origin**)"; §11.2 says "all sub-strips share one `v` course grid."
  Because the origin is 2D and re-optimized per ring, independently optimizing each sub-strip shifts
  its **V** origin too → each sub-strip gets a different course phase → §11.2 is violated *by
  construction*. The spec provides no mechanism to pin V while varying U.

Fix requires either a wall-specific 1-D (U-only) origin search with a fixed/explicit V datum, or
pinning `origin[1]` across the run. This is an internal-spec defect the engine exposes, on the core
quantities path — Critical.

---

## MAJOR

### M-1 — Cross-render cache sig omits height (and the condition-level height input); a wall relayout goes stale on a height edit.
Two separate sigs, both height-blind:
- Inline solve cache: `tileTakeoff.js:329-334` hashes `tile_setup` JSON + `upp` + `dims.w/h` +
  `verts_norm` + `verts_norm_holes` + `tile_layout`. **No height, no `measure_role`.**
- Memo key: `tileLayoutSig(shape, tile_setup)` (`tileLayoutSig.ts:65-106`) hashes verts + tile_setup
  config + `tile_layout`. **No height, no cond param at all.**

For a wall the strip's `H` comes from `s.height_override` / `s.height_ft` / **`cond.height_ft`**
(`shapeMetrics.js:25-27`). The spec §9.3 says "include height + measure_role" — correct as far as it
goes — but understates two things: (a) `tileLayoutSig(shape, tile_setup)` has **no `cond`
parameter**, so hashing the *resolved* height (which reads `cond.height_ft`, outside `tile_setup`)
requires a signature change the spec doesn't mention; (b) the override flag `height_override` must
also be in the sig. Miss any of these and a wall whose height changes reuses a stale L×H layout.

### M-2 — The marked-PDF tile overlay (`markedset.js`) has NO role guard; opening the `:311` gate mis-draws wall strips in PLAN space. Back-compat break for the shipped export.
`markedset.js:998-1008` iterates `shapesHere`, pulls `tileByShape.get(s.id)`, and renders
`tileOverlayPrimitives(summary.layout, …)` at the shape's **plan** ring (`s.verts_norm × W,H`). The
only guard is `if (ring.length < 3) continue;` (`markedset.js:1006`) — a **multi-wall** run has ≥3
verts, so it passes. There is no `measure_role` check. The strip's cells live in strip-feet space
`(0..L, 0..H)`; the plan ring is image px along the traced line — different frames → garbage
placement on the marked PDF.

The spec §9 says "plan-space quad placement is floor-only; the wall renders in elevation," but only
frames rendering as *adding* an elevation renderer. It misses that admitting surface shapes to
`byShape` makes the **existing** plan overlay consume them — a gate to **CLOSE** (skip surface role
in `markedset.js`'s overlay loop, and in `dxf.ts:232` which is already `role === "floor_area"`
gated, so DXF is safe by omission). Without the guard, every project with a wall-tile condition
gets a broken `export_marked_pdf`. (Aside: the investigation's cited "markedset.js:216 participation
check" is a **mis-citation** — line 216 is the label-chip `switch`, `markedset.js:216-219`; the real
participation is the unguarded overlay loop at ~998.)

### M-3 — §4.5 byShape/reset aggregation understates the `summarizeShape` restructuring; it is not "verbatim reuse."
`summarizeShape` returns ONE summary with ONE `layout: TileLayout` (single `config`/`bounds`/
`quads`/`classified`, `tileSolve.ts:18-24`). `byCond` finalize does
`agg.classified.push(...summary.layout.classified)` (`tileTakeoff.js:356`) and reuse pooling reads
`summary.layout` as a single grid. Reset-per-wall (§4.2) needs **N** independently-balanced
sub-strip solves. Aggregating them into one shape summary is feasible for *counts / cutsheet / order
/ bySku* (they only tally `cls` and dims), but:
- `summarizeShape` must be **restructured to loop N rings and merge** — that is real surgery, not
  the "verbatim" reuse §3.3 implies.
- `summary.layout` is a single object with one `bounds`/`config`; N sub-strips (each balanced from
  its own origin, in its own or offset frame) cannot be represented cleanly. Every `byShape.layout`
  consumer that reads it as one grid — `markedset` overlay, `tileQA` `layoutFor` (`tileQA.ts:180`),
  DXF `tile_cells`, MCP snapshot — inherits overlapping/offset cells. The §4.5 claim "no
  report-contract change" is true for the *report* but silent on this internal-contract strain.

---

### M-7 — `corner_overrides` (§8) collides with `edge_overrides`: two numeric-keyed maps on one shape in DIFFERENT index spaces, both driving finish/trim.
§8 adds `corner_overrides?: Record<vertexIndex, …>` keyed by **run-polyline vertex**. The existing
`tile_layout.edge_overrides` is keyed by **ring-edge index** (`tileTakeoff.js:210-212`,
`tileLayoutSig.ts:21`) — and for a wall strip those edge indices are bottom/right/top/left of the
*elevation rectangle*, not the run's corners. Two numeric-keyed override maps on the same shape,
different geometric index spaces, both feeding finish/trim decisions. The spec never reconciles
them, so an implementer can silently cross-wire a run-vertex override into a strip-edge lookup.
Also sharpens M-1: `TileLayoutShape` (`tileLayoutSig.ts:25-29`) declares only
`verts_norm`/`verts_norm_holes`/`tile_layout` — `face_side` and `corner_overrides` are invisible to
the sig at the **type level** until explicitly threaded in.

## MINOR

- **M-8 §6 synthetic-sheet "stitch precedent" is weaker than claimed.** §6 argues the unwrapped
  strip "becomes a real synthetic sheet … (stitch precedent, `sheets.ts:6,22`)." But
  `sheets.ts:19-22` shows a stitch key returns `""` for its label *because* "its real name lives in
  canvas-only `stitchById` state" — a stitch is **not** a fully first-class synthetic sheet; its
  identity is runtime canvas state, exactly the gallery-identity gap §13 itself defers. So §6's
  "the strip becomes a real sheet like a stitch" leans on a precedent that is itself incomplete.
  (Slice B scope, not Slice A — flagging so the sheet promotion isn't assumed free.)
- **M-4 tileQA has a SECOND floor-only gate the spec's gate-4 doesn't name.** `tileQA.ts:90`
  `if (!Array.isArray(s.verts_norm) || s.verts_norm.length < 3) continue;` — like
  `tileTakeoff.js:314`, this rejects an open 2-vert surface. Spec §9 gate-4 cites only `tileQA.ts:87`
  (role) and gate-2 cites the `<3` guard generically; the QA `<3` at `:90` is a distinct edit.
- **M-5 `reportColumns.js:387`** `floorPerimeterLf` is `floor_area`-only. Harmless to walls (a wall's
  perimeter is not consumed there), but it is another concrete role filter the spec's "any
  reportColumns role filter" gestures at without locating.
- **M-6 `verts<3` vs `<2` (§9)** — accurate: `tileTakeoff.js:314` is currently `< 3`; a surface needs
  `< 2`. The degenerate-exclusion also lands on `aggFor(cond).excluded.degenerate++` — fine, but the
  branch must build `wallStripRing` (not `ringFt`, `tileTakeoff.js:340`) *before* this guard's
  vert-count assumption, since `ringFt` on an open polyline yields a self-touching floor ring.

---

## Gate-map accuracy scorecard (§9 / investigation)

| Claim | Verdict |
|---|---|
| `tileTakeoff.js:311` role gate | ✓ accurate |
| `ringFt` `:29-31` | ✓ accurate |
| `tileQA.ts:87` role gate | ✓ accurate (but misses the `:90` `<3` guard — M-4) |
| `verts<3 vs <2` (`:314`) | ✓ accurate |
| cache sig needs height+role | ✓ direction right, under-specified — M-1 |
| `markedset` participation | ✗ mis-located; real gate is the unguarded overlay loop ~998 — M-2 |
| `ringBounds` ≥3 safe for strip | ✓ (strip = 4 pts) |
| report role-agnostic by cond id | ✓ accurate |
| §3.3 "reuses ALL of it, no fork" | ✗ trim/corner/joint block is floor-ring-coupled — C-1 |
| §9 gate-5 "Report: nothing new" | ✗ corner/joint items are net-new run-keyed code — C-1 |
| §4.4 "origin optimizer prefers balanced end cuts" | ✗ optimizer is 2D, balances V too; §4.2 vs §11.2 contradiction — C-2 |
| §6 "strip becomes a real sheet (stitch precedent)" | ~ stitch identity is canvas-only runtime state — M-8 |

**Bottom line:** approve the field-count reuse thesis; REVISE the spec to (1) carve
`summarizeShape`'s trim/corner/movement-joint block onto a run-polyline builder for `surface_area`,
noting `agg.jointTotals` accumulates unconditionally so a mixed floor+wall condition emits a wrong
`joint_lf` (C-1); (2) replace/constrain the 2D origin optimizer for walls — U-only search with a
pinned V datum — and resolve the §4.2-vs-§11.2 sub-strip contradiction (C-2); (3) name the height +
condition-height + `measure_role` sig edits and the `tileLayoutSig(shape, tile_setup)` signature
change (M-1); (4) add the `markedset`/overlay role guard as a gate to CLOSE (M-2); (5) spell out the
multi-sub-strip `summarizeShape` restructuring instead of calling it verbatim reuse (M-3); and (6)
reconcile `corner_overrides` (run-vertex) vs `edge_overrides` (ring-edge) index spaces (M-7).
