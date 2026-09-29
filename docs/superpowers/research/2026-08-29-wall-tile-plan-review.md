# Wall-Tile Slice A — Adversarial Plan Review

Reviewed: plan `2026-08-29-wall-tile-slice-a.md` against spec v2.1
`2026-08-29-wall-tile-patterning-design.md` and the live code under `web/src`.
Anchors re-verified against source (not the plan's or codemap's citations).

## Verdict: REVISE (2 Critical, 5 Major)

The design is sound and most of the reuse claims hold, but the plan as written would
ship a wall whose entire trim/joint/corner output is silently dropped from the report,
and whose headline corner-cut count is both phase-blind and unclassified.

---

## CRITICAL

### C1 — Wall trim/joints/corner counts never emit: `byKind`-empty fails the `hasTrim` gate
Plan Task 3 types `WallTrim = { byKind: []; length_lf; pieces; corner_outside; corner_inside }`
— `byKind` is ALWAYS empty (edge finishes go to a separate `edgePieces`). Task 5 claims the
`byCond` aggregation is "reused as-is."

It is not. In `tileTakeoff.js`:
- `agg.hasTrim` is set true ONLY inside `if (summary.trim.byKind.length)` (`:370-371`).
- `corner_outside`/`corner_inside` accumulate inside that same block (`:382-385`).
- Emission of BOTH `agg.trim` and `agg.joints` is gated `if (agg.hasTrim)` (`:507-522`).
- Joint totals accumulate unconditionally (`:391-395`) but are still only *emitted* under `hasTrim`.

So a wall summary with `byKind: []` → `hasTrim` stays false → `agg.trim` and `agg.joints`
are never built → report rows read `ti.trim ? … : 0` / `ti.joints ? … : 0` (`:611-623`) →
**movement-joint LF = 0, corner_inside = 0, corner_outside = 0** for every wall. The feature's
headline numbers vanish; Task 8's asserted panel "trim/joint LF + corner counts" line also has
nothing to read (panel consumes the byCond `ti`). Fix: populate `byKind` with real entries (each
needs `exposure`, `length_lf`, `pieces`, optional `finish_neighbor` — `:372-380`) or set
`hasTrim` via another explicit path; the plan does neither.

### C2 — The null/unwrappable-run summary is dereferenced in the shared loop → one U-turn wall kills the whole takeoff
Task 5 Step 3a: on an unwrappable run (`unwrapRun` returns `null` — Task 1's own test asserts this
for the U-turn case) "return a summary with an empty layout + a warning, excluded from field
counts." That summary flows into the SAME per-shape loop as floors, which unconditionally
dereferences `summary.counts.full` (`:349-354`), `summary.layout.classified` (`:356`),
`summary.trim.byKind.length` (`:370`), and `summary.joints.perimeter_lf` (`:391-395`). The plan
never specifies the degenerate summary carries `counts`/`layout`/`trim`/`joints` ("empty layout"
reads like `null`). Any missing field throws INSIDE the loop → **one rejected wall run aborts the
entire takeoff for every floor condition on the project**, and aborts `export_marked_pdf` too
(`markedset.js:924` calls `computeTileTakeoff` mid-render). Contrast the floor path: its degenerate
case is handled *before* summarizing (`:314-317` `excluded.degenerate++; continue;`). The wall
reject must do the same — reject at the `:314` guard (or before aggregation) with a counted
exclusion + `continue`, NOT return a partial summary into the shared aggregation.

---

## MAJOR

### M1 — Wrap `extraCornerCuts = courses` is phase-blind → over-counts folds on a tile boundary
Task 3 returns `extraCornerCuts += courses` per inside fold unconditionally; `corners.ts`
receives only `folds/H/tile_setup` — NOT the layout/origin, so it cannot know whether a tile
straddles `u_k`. Under wrap the whole run shares one U-origin, so straddling is a property of
`u_k mod pitch`. Worked example, wall A=10ft + wall B=8ft, H=8, 12×12, joint 0, origin 0:
the fold at u=10 lands on a tile boundary → **0 tiles straddle** → real order = 18/course = 144.
Plan adds `extraCornerCuts = 8` anyway → orders 152 (+8 phantom cuts). For the L-run 10.5+7.5 the
fold IS mid-tile so 8 is right, but the value must be derived from the layout, not returned blind.
Spec §11.4 ("exactly one straddling cut per inside fold per course") presumes mid-tile; the plan
counts it without checking.

### M2 — Wrap folds `extraCornerCuts` into `order` without reclassifying → `counts.corner` stays 0; §11.4 count unpinned
Task 5: "extraCornerCuts is folded into order … reclassify is not required (conservative)."
Worked example L-run 10.5+7.5, H=8: flat 18ft strip solves to 144 full / 0 cut / 0 corner.
Reality (no offcut reuse) is 136 full + 16 cut = 152 pieces. Plan leaves `counts` = 144 full /
0 cut / 0 corner and only bumps `order` by 8. So: (a) the panel/report show "144 full · 0 corner"
for a run that physically has 8 corner cuts — spec §11.4 wants that pinned *as a count*, and it
isn't; (b) the counts breakdown disagrees with the identical run tiled in RESET mode (136 full /
16 cut — see below), so wrap vs reset give inconsistent classifications for the same wall. Order
total happens to reconcile (152) only because +8 equals the missing tiles for THIS fold geometry
(see M1 for when it doesn't).

### M3 — Inside/outside absolute label is unverifiable as planned (bad justification, undefined spec term, no test)
Three problems, none of which depend on which "left" is meant:
1. **The code's own justification is factually wrong.** The Task 1 comment claims "cross>0 in
   screen y-down is a left turn." In a y-DOWN frame cross>0 is a visually **clockwise/right** turn.
   The implementer has no sound basis for the `(cross*faceSign)>0 → inside` mapping.
2. **The spec never defines which "left."** §3.1 says handedness is "pinned to that frame" but
   never picks between visual-left (−y in y-down) and coordinate-left (+90°). So the plan's mapping
   can't be checked against the spec at all.
3. **No test pins the absolute label** — the flip test only asserts left≠right (relativity). So
   §11.5's absolute half ("known inside/outside run classifies each vertex") is unverifiable.
Illustration of the ambiguity: L-run [0,0],[10.5,0],[10.5,7.5] travels east then +y (visually
down); `face_side:"left"` reads as OUTSIDE under a visual-left convention but the code
(cross=+78.75, faceSign=+1) labels it inside. Add an absolute-orientation assertion and settle the
convention before trusting Step 4's "flip if inverted" note.

### M4 — Task 8 panel reads `ti.wallStrips ?? [ti.layout]`, but the byCond entry has NEITHER field
`wallStrips` (Task 6) and `layout` live on the per-SHAPE `summary` (byShape). The panel is fed
`layouts[].ti` = the byCond **agg** entry, minted at `tileTakeoff.js:288-308` and finalized
`:398-528` — it carries `counts/cutsheet/order/grout/band/trim/joints/orderBySku`, but no
`layout` and no `wallStrips`. So `ti.wallStrips ?? [ti.layout]` resolves to `[undefined]` and the
elevation render draws nothing / throws. The field is never threaded from summary→agg; the plan
does not add that copy. (Also ambiguous: a condition can hold multiple wall shapes, so a single
`wallStrips` on the condition agg is under-specified.)

### M5 — Reset feeds only the first sub-strip into `agg.classified` → multi-SKU order & reuse undercount
`tileTakeoff.js:356` does `agg.classified.push(...summary.layout.classified)`. Task 6 sets
`summary.layout` = the FIRST sub-strip only (merged counts live on `summary.counts`). Single-SKU
order (`:426`) and grout (`:466`) read `agg.counts.*` (merged, correct), but the multi-SKU order
split (`:423-424,448`) and reuse (`:485`) read `agg.classified` — which now holds only sub-strip 1.
A multi-SKU reset wall (§7 painting is explicitly reused for walls) would order from a fraction of
its cells. The plan doesn't extend `:356` to iterate `wallStrips`.

---

## MINOR
- **U-balance objective is weak.** `origin.ts` scores only sub-½ slivers and breaks ties to the
  first candidate (ox=0). For L=17.5 it picks 0 (full tile hard against one end) — spec §4.4 wants
  center-and-balance. Tests only assert `origin[0]` finite, so this passes while diverging from spec.
- **`origin[1]=0` = "full course at floor" is grid-specific.** Verified in `tilePatterns/grid.ts`
  (`startJ = floor((minY-oy)/cell.h)`, oy=0, ring minY=0 → full course at v=0 — correct). For
  herringbone/basketweave the weave merely anchors at v=0; "full course at floor" (§11.3) is
  ill-defined, so that invariant is only meaningfully assertable for grid.
- **`tileLayoutSig` 3rd param not threaded to the persist caller.** `TakeoffCanvas.jsx:1318`
  calls `tileLayoutSig(s, cond.tile_setup)` (2 args); the new optional height param is fine for
  floors but leaves a wall's layout-persist/reset key height-blind. Not in the plan's file list.
- **Reconciliation "extent identity" test self-passes.** `(s as any).extent_sf ?? (L*H)` with L,H
  hardcoded 18,8 always yields 144 whether or not `extent_sf` exists — it never exercises the code.

## Sound (confirmed, not changed)
- Field-count reuse over the L×H strip (`solveTileLayout`/`tileCounts`/`countsBySku`/grout/order),
  the `keptArea≈144` coverage at joint 0, and reset's two-end-cuts-per-fold via independent
  sub-strip solves (136 full + 16 cut = 152, keptArea 144) all check out.
- `markedset.js:998` `surface_area` skip and the `dxf.ts` floor-gate leave the floor overlay/DXF
  path unaffected; the `:311/:314` gate split preserves floor behavior **for well-formed walls
  only** — see C2, which makes a rejected wall run fatal to the shared floor loop until the
  reject-before-aggregation path is fixed.
- `origin[1]=0` correctly seats a full grid course at the floor datum; V is never balanced.
