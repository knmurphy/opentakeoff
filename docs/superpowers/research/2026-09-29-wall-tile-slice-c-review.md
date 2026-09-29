# Adversarial Review — Wall Tile Slice C (Developed Elevation), final

Reviewed: commits `4a12452..db6faf4` on `feat/tile-patterning` (read from git objects at
`db6faf4`, not the working tree), i.e. `git diff 38e9923 db6faf4`.
Against: `docs/superpowers/plans/2026-08-29-wall-tile-slice-c.md` (v2),
`docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md` §2/§6/§12,
`docs/superpowers/research/2026-08-29-wrapped-elevation-conventions.md`.

Lenses: (1) correctness/engine, (2) domain/shop drawing, (3) scope/plan conformance.

All citations are `file:line` at `db6faf4`. Claims marked **[probe]** were checked by running
the real pipeline (`summarizeWallShape → wallElevationLayout → developedElevationLayout →
buildWallElevationPdf`) in a throwaway detached worktree at `db6faf4` (since removed).

## Verdict: APPROVE-WITH-FIXES

No Critical defects. The core engine is right: clip-and-split is correct for wrap and reset,
area is conserved, panel-local x stays in range, the sheet is byte-deterministic on a real
L-run, and `upp` is unchanged. The v1 fold is fully removed. Four Important issues remain.
Two are about what the drawing tells a reader: a scaled sheet that is not to scale across its
breaks, and a mirrored elevation for `face_side: "right"`. One is a phantom wall from a
duplicated vertex. The last is stale spec text. Fix them before the tile line goes upstream.

### Verification run (at db6faf4)

| Check | Result |
|---|---|
| `node --import tsx --test test/developedElevation*.test.ts test/wallElevationPdf.test.ts test/tileWallElevation.test.ts` | 35/35 pass |
| Full `npm test` (web) | 2073 tests, 2070 pass, 0 fail |
| `tsc --noEmit` | clean |
| `eslint src/components/TilePanel.jsx` | clean |
| **[probe]** L-run 10'-6" + 7'-6", wrap, 12" tile + 1/8" joint | panels `[10.5, 7.5]`, 88 + 64 pieces, 0 out-of-range, Σarea delta −1.7e−13 |
| **[probe]** same, reset (2 sub-strips) | identical panel split; sub-strip offsets land exactly on the fold u |
| **[probe]** U-run (3 walls), 45° run, 0.3 ft return | all in range, area conserved |
| **[probe]** real L-run PDF built twice | byte-identical; page 714×331 pt; returned `width_ft` 18.5 |
| **[probe]** PDF text (pdfjs) | `"WT-1 — 18'-0\" × 7'-9\" elevation"`, `"Wall 1"`, `"Wall 2"`, `"inside"` |

---

## Critical

None.

---

## Important

### I1 — A duplicated vertex creates a phantom zero-width "Wall N" and relabels real corners as "outside"

**Where:** `web/src/lib/developedElevation.ts:69-80` (boundaries/panels built from `foldsU`
with no degenerate-segment handling; the comment at 69-70 *assumes* "ascending, interior"),
`:113-116` (a break per fold). Root cause upstream: `web/src/lib/tileWall/unwrap.ts:22-28`
(`collapseCollinear` keeps a vertex whose in- or out-edge has zero length: cross = 0 and
dot = 0, so it is neither dropped nor rejected as a U-turn) and `unwrap.ts:67` (`cross*faceSign > 0`
is false for cross = 0, so the fold is labeled **outside**). `web/src/lib/tileWall/index.ts:219-227`
already documents that a duplicated interior vertex reaches the engine and chooses to leave it.

**[probe] Evidence:**
- L-run with its corner vertex doubled (`[0,0],[10.5,0],[10.5,0],[10.5,7.5]`) gives panels
  `Wall 1 (10.5) / Wall 2 (0 ft, 0 tiles) / Wall 3 (7.5)` and breaks `[10.75 "outside"],
  [11.25 "outside"]`. The only real corner is an **inside** corner. The drawing shows two
  outside corners and an empty wall. Wrap and reset give the same result.
- A doubled first or last vertex adds an empty `Wall 1` or a trailing "outside" break at the
  run's end.
- The two break labels sit 0.5 ft = 18 pt apart, and each 7 pt "outside" is about 24 pt wide,
  so they overprint on the sheet.

A finishing double-click easily leaves a coincident vertex, so this is realistic. It is worse
than cosmetic because the same folds also feed Slice A's corner and trim counts.

**Fix:** At the source, change `collapseCollinear` so it drops `pts[i]` when
`hypot(in) < EPS || hypot(out) < EPS`, and keep `keptIndex` consistent. This repairs the Slice A
counts and the elevation together. Also make `developedElevationLayout` defensive: merge any
boundary within `SLIVER_EPS_FT` of its predecessor, and drop the matching fold/break. Pin both
with a test using the doubled-corner fixture above. Expected result: 2 panels, 1 "inside" break.

### I2 — The generated sheet carries a "known" scale, but any measurement across a break is overstated by 0.5 ft per corner

**Where:** `web/src/lib/wallElevationPdf.ts:102-108` (no `gap_ft` override, so the 0.5 ft
default from `developedElevation.ts:56` applies), `:115` (page width = `total_width_ft`),
`:210-211` (upp is still the true 1/2"=1'-0" constant). `wallElevationScaleRow`
(`wallElevationPdf.ts:226-228`) records it as `scale_source: "wall-elevation-generated"`, a
scale the app treats as known with no `scale_confirmed` gate.

Slice B made this sheet something you view, annotate and measure. Slice C inserts 6 inches of
blank space at every corner but keeps the claim that the whole page is at scale. Any linear or
area measurement across a break comes out 0.5 ft long per corner. Examples: a Schluter or trim
run along the top course, or a dimension from the run start to a niche on Wall 2. A U-run
overstates by 1 ft. Nothing on the sheet warns about this.

The research doc does not call for a gap. It says the convention is abutting panels with a
borderline: "panel N's right edge = panel N+1's left edge", and "we are free to place the wall
panels adjacent in one strip". The gap is a preview nicety that leaked into a measured drawing.

**Fix (preferred):** For the sheet, pass `gap_ft: 0` and draw the bold break or borderline on
the shared edge. Keep the 0.5 ft gap only in the TilePanel preview, which is unscaled. With that
change, `width_ft` goes back to the physical run length and M4 goes away. Update the pinned tests
(`wallElevationPdf.test.ts:121-178`) so an L-run's `width_ft` equals the raw run, and the page
round-trip still holds.
**Fallback:** If the gap stays, stamp "NOT TO SCALE ACROSS BREAKS" in the header. Also add a
test that pins each panel's drawn x-origin to `B[i]·P + i·gap·P`, so the offset is at least a
documented contract.

### I3 — A `face_side: "right"` wall is drawn mirrored (Wall 1 appears on the viewer's wrong side)

**Where:** `web/src/lib/tileWall/unwrap.ts:64-68` sets the handedness. `face_side: "left"` puts
the tiled face on the (−dy, dx) side of the drawn direction. `tileWallElevation.ts:77-95` and
`developedElevation.ts:58-121` always lay u out left to right, and none of
`tileWallElevation.ts`, `developedElevation.ts` or `wallElevationPdf.ts` reads `face_side`
(grep at `db6faf4`).

**Reasoning:** Take an east-going run in image coordinates (y down). With face "left", the
viewer stands on the +y side looking toward −y, so +u (east) is on their right, which matches
the drawing. With face "right", the viewer stands on the −y side, so +u is on their **left**.
The elevation is then a mirror image of what the setter sees from the tiled face. Cut columns,
an off-centre pinned origin and the Wall 1 → Wall N sequence all appear on the wrong side.
Slice A/B's continuous strip already had this latent issue. Slice C makes it a shop-drawing
error because it now labels walls in sequence and presents the result as the NKBA
interior-elevation convention, which is a view from the room side.

**Fix:** Pass `face_side` (it is already on the shape and in `selectedWall`'s source summary)
into the developed layout, or into both callers. When it is `"right"`, mirror the laid-out
frame: `x' = total_width_ft − (xOffset + x + w)`, reverse the panel positions, and keep each
panel's plan-keyed label so Wall 1 stays the first drawn segment. Add a test: the same L-run
with face left vs right gives mirrored panel x-origins and the same labels. Confirm the viewing
convention with Kevin. If the decision is "always draw in run order", then print "viewed from
the {left/right} of the run direction" on the sheet so a reader knows the orientation.

### I4 — Spec §2/§6/§12 still describe the removed "wrapped (folded) view"

**Where:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md:44-45` ("a
wrapped (folded) view of the same strip"), `:51` ("the wrapped view is a 2D fold-back"),
`:294-296` (§6 "one strip render feeds both a flat editor and a folded view"), `:310-313`
("**Wrapped view.** The same strip folded back at each `u_k` onto the run's plan footprint …
Slice C the wrapped view"), `:471` ("Slice C — wrapped view: the 2D fold-back render").
Secondary: `docs/superpowers/specs/2026-08-29-tile-wall-m10.md:7` (the superseded spec's banner
still says "dual elevation-sheet / wrapped views").

The plan v2 records the decision (Kevin, 2026-08-29) and the research shows the fold has zero
support. The design spec is still the build-from document, though, and it tells the next reader
to build the thing that was deliberately deleted.

**Fix:** Rewrite §6's second bullet as "**Developed elevation.** One flat, true-length panel per
wall in plan order, a break or borderline plus inside/outside marker at each corner, labeled and
keyed to the plan (NKBA Ch. 12; see research doc). Feeds both the panel preview and the Slice B
sheet from one layout (`developedElevation.ts`)." Change §2 line 44 to "…+ a developed
(per-wall panel) elevation". Replace §2 line 51's parenthetical with "3D wrap preview (the
research's evidenced runner-up) deferred". Change §12 line 471 to "Slice C — developed
elevation". Add a v-bump or status note citing the plan v2 and the research doc.

---

## Minor

### M1 — "Wall N" is not keyed to anything on the plan

**Where:** `developedElevation.ts:80` (`label: \`Wall ${i + 1}\``), `TilePanel.jsx:661-663`,
`wallElevationPdf.ts:170`. The research doc's recommendation (Part 3) is panels "each labeled
and (ideally) **keyed to the source polygon edge**". Nothing on the plan overlay numbers the
run's segments or marks its start. For a reader of a standalone sheet, "Wall 1" is ambiguous
unless they already know which way the polyline was drawn. That is especially true together
with I3.
**Fix (follow-up acceptable):** Draw segment numbers (1..N) and a start tick on the plan overlay
for wall runs, or at least for the selected run. Put the run's start and end direction in the
sheet header (e.g. "Wall 1 = first drawn segment").

### M2 — No per-panel length; the header gives only the run total, rounded to the nearest inch

**Where:** `wallElevationPdf.ts:193` (header shows only `elev.width_ft × elev.height_ft`),
`:170` (panel label has no dimension). **[probe]** For the 10'-6" + 7'-6" L-run the sheet says
only `18'-0" × 7'-9"`. A setter needs each wall's length. Spec §6
(`…design.md:307-309`) promises "reference/centerlines and cut dimensions shown (shop-drawing
convention)". The panels in this slice are the natural place for at least the per-wall
dimension. `formatFeetInches` (`wallElevationPdf.ts:70-75`) is correct: it rounds to the inch
first and carries 11.98 to `12'-0"`, verified. It does hide 1/8" to 1/2" fractions, which matter
to tile.
**Fix:** Under each "Wall N", draw `formatFeetInches(p.segWidth_ft)` on both the sheet and the
preview. Consider rounding to 1/8" (`12'-6 3/8"`) for tile work, or say "nearest inch" in the
header.

### M3 — Break marker wording and collision

**Where:** `TilePanel.jsx:655-657`, `wallElevationPdf.ts:184` draw the bare fold kind
("inside"/"outside"). An estimator can easily read "inside" as the room interior rather than an
inside corner. Two breaks less than about 0.7 ft apart overprint their 7 pt labels on the sheet
(see I1). The same happens with a short return: **[probe]** at 0.3 ft, "inside" and "outside" end
up about 7 pt apart.
**Fix:** Label "INSIDE CORNER"/"OUTSIDE CORNER", or "IC"/"OC" with a one-line legend. Stagger
the label height when adjacent breaks are closer than the label width.

### M4 — The persisted `elev_width_ft` quietly changed meaning; Slice-B-era L-run sheets prompt a false "size changed"

**Where:** `wallElevationPdf.ts:211` now returns `width_ft: dev.total_width_ft` (drawn width
including gaps). `TakeoffCanvas.jsx:1919-1921` (`dimsChanged` confirm), `:1933`, `:2107`,
`:2776` persist it as `elev_width_ft`. The field is not in the protocol/field inventory
(`git grep elev_width_ft` hits only TakeoffCanvas.jsx). AGENTS.md requires reading the inventory
before changing persistence. Regenerating any multi-wall sheet made before `c4eee7e` shows
"This wall's size changed — marks … may shift" even though the wall did not change. The risk is
low because the branch is unmerged, but the semantics drift is real.
**Fix:** Fixing I2 with `gap_ft: 0` on the sheet removes this issue. Otherwise, inventory
`elev_width_ft`/`elev_height_ft` and document "drawn width including break gaps".

### M5 — Tests miss the three things most likely to regress

1. **Header text is not pinned at the PDF level.** `db6faf4` exists to keep the header on
   `elev.width_ft` rather than `dev.total_width_ft` (`wallElevationPdf.ts:187-193`). The tests
   cover only `formatFeetInches` (`wallElevationPdf.test.ts:205-220`). Reverting line 193 to
   `dev.total_width_ft` would leave every test green. **Fix:** Extract a pure
   `elevationHeader(tag, elev)` and test it with an L-run (expect `18'-0"`, not `18'-6"`), or
   extract the text with pdfjs as the probe here did.
2. **There is no real-pipeline test through the developed layout.** `developedElevation.test.ts`
   uses synthetic 1×1 grids (header comment `:9-12`). The PDF tests use a single wrap strip with
   folds at integer u (`wallElevationPdf.test.ts:119, 99-108`), so no straddler ever reaches the
   sheet, and reset mode's multi-strip offsets are never fed to `developedElevationLayout`.
   **Fix:** Add `summarizeWallShape` fixtures for an L-run at u = 10.5 in wrap and in reset.
   Assert the panel count, the in-range invariant, Σ(piece area) = Σ(elev tile area), and wrap
   vs reset panel widths.
3. **There is no degenerate-segment test.** Add the I1 fixture.

### M6 — Small stale or loose bits

- `wallElevationPdf.ts:14-18` says the sheet now draws panels "instead of one continuous
  folded/bent strip". The Slice B sheet was a flat strip with dashed fold lines. The bent view
  existed only in the panel (`dfe317e`), never on the sheet. Reword to "instead of one
  continuous flat strip with dashed fold marks".
- `developedElevation.ts:48`: `DevBreak.kind: string` (and `foldKinds: string[]`, `:62`) drops
  the `"inside" | "outside"` union that `tileWallElevation.ts:51` already has. Type it as
  `ElevationFold["kind"]`.
- `developedElevation.ts:69-70` states an input contract (ascending, strictly interior folds)
  that the engine does not guarantee (see I1). Either enforce it (merge or sort) or make the
  comment say who guarantees it.
- `developedViewBox`'s negative-`segWidth_ft` branch (`developedElevation.ts:130-150`) handles
  input that can't occur with a well-formed engine. It is harmless, but it is defensive code for
  a caller bug that I1's fix would make structurally impossible.

---

## Checked and correct (no action)

- **Clip-and-split** (`developedElevation.ts:94-107`): each tile is intersected with every
  segment `[B[i], B[i+1]]`, re-keyed panel-local (`x0 - b0`), and slivers ≤ 1e−6 ft are dropped.
  In range by construction. **[probe]** On real solver output (wrap, u = 10.5, joints on) there
  are 0 out-of-range pieces and area is conserved to 1e−13. Straddlers keep their engine `cls`
  ("corner"), so the preview's corner stroke (`TilePanel.jsx:639`) still marks them.
- **Reset vs wrap:** reset sub-strip offsets (`tileWallElevation.ts:75-95`) come from
  `bounds = ringBounds(segRing)` (`tileSolve.ts:46`), so they equal the fold u exactly and the
  developed split is a no-op re-keying. **[probe]** Reset and wrap give identical panel widths.
- **Break x** (`developedElevation.ts:113-116`) is the gap centre `B[k+1] + k·gap + gap/2`,
  which equals `panels[k+1].xOffset − gap/2`. `total_width_ft = width_ft + (n−1)·gap`
  (`:118`). Both are pinned (`developedElevation.test.ts:80-141`).
- **Page width and `upp`:** `pageW` uses `dev.total_width_ft` (`wallElevationPdf.ts:115`). The
  L-run page round-trips to `width_ft` via `upp·RENDER_SCALE` (`wallElevationPdf.test.ts:151-160`),
  and `upp` is identical for straight and L-runs (`:162-167`).
- **Determinism:** there are no Map/Set iterations or Date/random calls, and panels and tiles
  are iterated in input order. `updateMetadata:false` is retained. **[probe]** A real L-run
  sheet built twice is byte-identical, and a synthetic L-run is pinned too
  (`wallElevationPdf.test.ts:169-176`).
- **Header** uses the real width, not the gap-inflated width (`wallElevationPdf.ts:187-193`).
  The feet-inches carry is correct.
- **v1 fold removal is complete:** `wallWrapped.ts` and its test are gone at `db6faf4`, as are
  `runTurnAngles` and the wrapped/unwrapped toggle. `TakeoffCanvas.jsx` has a net-zero diff over
  `38e9923..db6faf4`, so the fold-only `verts_norm` threading was fully backed out. The
  remaining `toggleBtn` (`TilePanel.jsx:565`) is the face-side Left/Right control and is still
  used (`:596-599`).
- **Preview geometry:** `devUpp` is computed from the developed width
  (`TilePanel.jsx:576`), so a folded run no longer overflows the target box, and the PAD
  conversion from feet to px is consistent (`:570-583`).
- **Plan v2 conformance:** Tasks 1–3 match the plan's interfaces and file list. There is one
  shared layout for the panel and the sheet with one default gap, the plan's T1 tests are present
  (straight and L-run), and so are its T3 tests (width, determinism, straight run unchanged). The
  only deviation, clip-and-split in place of center-x assignment, is an improvement and is
  documented (`developedElevation.ts:15-35`).

---

## Fix pass (2026-09-29)

| Finding | Status | Change |
|---|---|---|
| I1 phantom wall from a coincident vertex | Fixed | `unwrap.ts` `collapseCollinear` drops coincident vertices before the collinear pass (keeps the first raw index); an all-coincident run returns null. `developedElevationLayout` also drops any fold that does not advance or sits on the run end. The doubled-corner L-run now summarizes identically to the clean run in wrap and reset (Slice A counts included). |
| I2 sheet not to scale across breaks | Fixed (preferred fix) | The sheet passes `gap_ft: 0`; panels abut with the break-line on the shared edge. `width_ft` is the physical run length again. The unscaled preview keeps `PREVIEW_GAP_FT` (0.5 ft). |
| I3 `face_side: "right"` drawn mirrored | Fixed | `elevationMirrored(face_side)` + `developedElevationLayout({ mirror })`, used by both the preview and the sheet. Labels stay plan-keyed (Wall 1 = first traced segment). Pinned by `tileWallViewSide.test.ts`: one physical L traced from each end draws the same. |
| I4 stale "wrapped view" spec text | Fixed | Design spec §2/§6/§12 describe the developed elevation (status v2.2); the M10 spec banner updated. |
| M1 wall numbers not keyed to the plan | Partly | The sheet states "Viewed facing the tiled face. Wall 1 = first traced segment." Segment numbers on the plan overlay remain a follow-up. |
| M2 no per-wall length | Fixed | Panels read `Wall N · 10'-6"` (sheet and preview), to the nearest 1/8" (`formatFeetInchesEighths`); the header uses the same precision. |
| M3 ambiguous, overprinting corner marks | Fixed | `INSIDE CORNER` / `OUTSIDE CORNER`; `staggerRows` moves a mark to a second row when it would overlap its neighbour (sheet and preview). |
| M4 `elev_width_ft` meaning drift | Resolved by I2 | `width_ft` is the physical run length again. Sheets generated on this branch before the fix will show one "size changed" prompt on regenerate (their stored width included the gap). |
| M5 test gaps | Fixed | `tileWallSliceCFixes.test.ts`: pure `elevationHeader` pinned; real-pipeline L-run through the developed layout in wrap and reset (in range, area conserved, both gap values); coincident-vertex fixtures. |
| M6 stale comments / loose types | Fixed | `wallElevationPdf.ts` header comment corrected; `CornerKind` typed through `DevBreak`/`foldKinds`; the fold-order contract is now enforced, not assumed. The defensive negative-width branch in `developedViewBox` is left as is. |

**Open follow-up found during the fix pass (F1):** regenerating an elevation sheet that already
carries user marks does not warn when only the VIEW ORIENTATION changes — a right-faced wall's
first regenerate after this fix, or any regenerate after flipping `face_side`. The width and
height are unchanged, so the `dimsChanged` guard stays quiet while the tiles under the marks
mirror. Fix: persist the orientation beside `elev_width_ft`/`elev_height_ft` (register both in
`protocol/INVENTORY.md`) and include it in the guard. Branch-only today (no released sheets).

Verification: `npm run check --prefix web` green (2290 tests, 2287 pass, 0 fail, 3 skipped; bench; build); doc links OK. Rendered sheets for an L-run traced from each end and a U-run with a 3⅝" return were inspected: identical layouts for both traces, marks staggered, no corner gap.
