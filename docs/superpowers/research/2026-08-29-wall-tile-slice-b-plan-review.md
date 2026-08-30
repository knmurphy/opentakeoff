# Adversarial Review — Wall Tile Slice B (Elevation Sheet) Plan

Reviewed: `docs/superpowers/plans/2026-08-29-wall-tile-slice-b.md`
Against: `docs/superpowers/research/2026-08-29-wall-elevation-sheet-investigation.md`,
`docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md` §6, and the live codebase
(`web/src`, `web/node_modules/pdf-lib@1.17.1`).

All citations below were re-verified against the real files in this worktree, not trusted from
the plan's own citations.

## Verdict: REVISE

One Critical defect (sheet-key collision) must be closed before coding. Everything else the
attack list asked about checks out — several of the plan's riskiest-looking claims (determinism,
the y-flip, the scale formula, wide-page rendering) are actually correct on inspection, contrary
to what a skeptical first read suggests.

---

## Critical

### C1 — `${tag}-elevation.pdf` collides across every wall run that shares a condition

**Where:** Global Constraints line 21 vs. Task 2 (plan lines 21, 103).

The plan states two things that contradict each other:
- Global Constraints: "Its sheet key/name is **stable per shape** so regenerate replaces in place."
- Task 2's actual default: `${tag}-elevation.pdf` (or `${tag}-elev-${shape.id.slice(0,6)}.pdf`
  "if a tag can host multiple wall runs") — keyed by the **condition's tag**, not the shape, with
  the shape-scoped form left as an undecided parenthetical.

A condition (tag, e.g. "WT-1") is *designed* to be shared by many shapes — confirmed at
`web/src/lib/tileTakeoff.js:307` ("a floor and a wall can share a `condition_id`") and by the
whole `byCond`/`byShape` split (`tileTakeoff.js:235,340-385`: the aggregation loop iterates every
shape and looks up `condById.get(s.condition_id)` — one condition, N shapes). Multiple tiled wall
runs under one tag (e.g. every bathroom's wet wall tagged "WT-1") is the *normal* case, not an
edge case.

**Worked case:** Wall Run 1 and Wall Run 2 both carry condition "WT-1". Generate for Run 1 →
`store.addPdf` creates `"WT-1-elevation.pdf"`, scale set, sheet_id bound, user annotates it.
Generate for Run 2 (different length) → **same key** → `store.addPdf` sees different bytes →
`{revised:true}` → Run 1's drawing is archived to `pdf_revs` (not reachable from the gallery) and
silently replaced by Run 2's. Run 1's existing scale/annotations, still bound to sheet_id
`"WT-1-elevation.pdf"`, now measure and land against Run 2's picture.

**The plan's own stated fallback doesn't fix it either.** Shape ids are minted as
`` `shp-${mintUuid()}` `` (`web/src/lib/shapeCommands.js:218,372,389`, `web/src/lib/canvasUtil.js:50`
+ `provenance.js:mintUuid`). `shape.id.slice(0,6)` on `"shp-XXXXXXXX-…"` yields the constant
4-char prefix `"shp-"` plus only **2 variable hex digits** — at most 256 distinguishable suffixes
project-wide. With only 256 buckets, birthday-paradox collision odds pass 50% at around **20**
wall shapes sharing a tag (plausible on a multi-unit tile job) — a real collision risk even if an
implementer follows the plan's parenthetical literally.

**Fix:** always key by `` `${tag}-elev-${shapeId}.pdf` `` (full id, or a real hash) — never the
bare-tag form, never a truncated id. Task 3's own tested helper signature,
`wallElevationSheetName(tag, shapeId)`, already takes both arguments — the plan should just commit
to always using both, unconditionally, rather than leaving it as a "sometimes" call the
implementer has to guess when to trigger.

---

## Important

### I1 — Regenerate-after-geometry-edit drifts existing annotations on the elevation sheet

The Goal explicitly promises the sheet is **annotatable**. `width_ft`/`height_ft` (hence the PDF's
page size and rendered image pixel dims) come straight from the wall run's length/height
(`tileWallElevation.ts` via `wallStripRing(L,H)`), so editing the wall's length or height and
regenerating changes those dims. `store.addPdf` treats this as an ordinary content revision (same
key, new bytes) — but `web/src/lib/revisions.js:1-8` documents, as a deliberate design choice for
the bid-revision-compare feature, that shape ids/verts_norm are **not** re-paired across a
re-imported sheet's dimension change. Any shapes a user already placed on the elevation sheet stay
bound to the same `sheet_id` with their **old** normalized `verts_norm`, which now land at the
wrong absolute position on the new, differently-sized image.

The investigation flagged this explicitly as an open decision ("regenerate-in-place (accept
revision churn + possible annotation drift) vs. a stable non-revisioned regeneration path" —
investigation §obstacle-5). The plan picks "regenerate-in-place" implicitly and never mentions the
drift half of that tradeoff, so nothing in Task 2/4 tests or guards it. Note this is *not* triggered
by a same-dims SKU/color-only regenerate (page size unchanged, so old verts_norm still line up) —
only by a length/height-changing edit, which is nonetheless a normal "why you'd regenerate" trigger.

**Ask:** either accept and document the drift (matching the existing re-drop precedent), or clear/
warn about existing shapes on that sheet_id when a regenerate changes `width_ft`/`height_ft`.

---

## Minor

### M1 — `scale_confirmed: true` is not a real write path

Task 2 step 5 says to persist `scale_confirmed: true`. The actual save/export code
(`TakeoffCanvas.jsx:2681`) never serializes `true` — it only ever emits `scale_confirmed: false`
(when `scaleUnconfirmed[sheet_id] === false`) or omits the field; "confirmed" is represented by
*absence*, not an explicit `true` (matches the hydration gate at `TakeoffCanvas.jsx:2008-2019`,
which only reacts to `s.scale_confirmed === false`). Functionally harmless either way (even a
literal `setScaleUnconfirmed(u => ({...u,[key]: true}))` wouldn't gate, since the check is
`=== false`), but the correct/idiomatic move is: call `setScales` + `setScaleSources` for the new
key and leave `scaleUnconfirmed` untouched entirely.

### M2 — "reset caches via docEpoch/revised handling (:1834)" under-names what must be reused

That block (`TakeoffCanvas.jsx` ~1826-1836, inside `handleFiles`) is `evictDoc` + **`forgetPages`**
+ `setDocEpoch`. `forgetPages` is what actually calls `forgetThumbs` (`TakeoffCanvas.jsx:1740-1742`
→ `lib/thumbs.js:67`), which is the *documented* contract for keeping gallery thumbnails from
outliving a revised PDF's bytes (`thumbs.js:13-18`). The plan's prose says "docEpoch/revised
handling" without naming `forgetPages` — an implementer who copies only the `docEpoch` bump and
skips `forgetPages` would reintroduce a stale-thumbnail bug on every regenerate. Worth calling out
`forgetPages` by name in the task text, not just `docEpoch`.

Same block also has an ordering gap: Task 2 lists step (6) `refreshSheets()` then (7) "open the
sheet's tab (`openSheets`/`setSheetGroup`)" with no stated `await`. A `[sheets]` effect prunes
`openTabs`/`sheetGroup` against the current `sheets` list (see the `reconcileAfterRemoval` comment,
`TakeoffCanvas.jsx:1758-1764`) — opening a tab for a key not yet reflected in `sheets` risks it
being pruned back out. The proven sequence is `handleFiles`' own: `await refreshSheets()` →
`setOpenTabs` → `goToSheet(name)` (`TakeoffCanvas.jsx:~1838-1842`) — use that exact ordering/call
set rather than `openSheets`/`setSheetGroup`.

### M4 — the determinism test doesn't cover the handler's real `skuColor`

Task 1's determinism test passes a constant stub, `skuColor: ()=>"#3b82f6"` — it proves the PDF
*generator* is deterministic given a deterministic color function, but says nothing about the
`skuColor` Task 2's handler actually injects from live condition state. If that resolver reads
anything besides the persisted `skus[].color` (`tileSetup.ts:9`, `TileSku.color` — e.g. a
palette-allocator or a "next unused color" counter), two regenerates of an *unchanged* wall could
still emit different bytes → a spurious revision → exactly the failure mode determinism is meant to
rule out, with T1 staying green the whole time because it never exercises that path. Task 2 should
state explicitly that its `skuColor` is a pure lookup of `cond.tile_setup.skus[].color` and nothing
else.

### M3 — extreme aspect ratio not discussed

A long, short wall run (e.g. 80ft × 8ft at P=36) produces a very thin ribbon-shaped page
(2880×288pt). Rendering itself is fine (see Confirmed Sound below), but nothing in the plan
discusses gallery-thumbnail legibility or panel-fit UX for an extreme aspect ratio. Not a break,
just an unaddressed cosmetic edge.

---

## Confirmed sound (verified against source, not just the plan's citations)

- **Determinism (attack #1).** Traced pdf-lib 1.17.1's actual save path:
  `PDFContext` seeds its ref-numbering RNG with a **fixed seed (`SimpleRNG.withSeed(1)`)**
  (`node_modules/pdf-lib/src/core/PDFContext.ts:71`); a **freshly-created** doc's
  `trailerInfo.ID` is never populated (`PDFParser.ts:281` only sets it when *parsing* an existing
  file), so `PDFWriter.createTrailerDict` (`core/writers/PDFWriter.ts:111-119`) emits no ID for a
  new doc; `updateInfoDict()` (the only source of `CreationDate`/`ModificationDate`/`Producer`) is
  gated by `updateMetadata` and only runs once, at construction
  (`api/PDFDocument.ts:215,1336-1346`); object-stream compression uses `pako.deflate`
  (`core/structures/PDFFlateStream.ts:1,24`), which has no embedded timestamp field (unlike gzip).
  No source of nondeterminism found for `PDFDocument.create({updateMetadata:false})` +
  `drawRectangle`/`drawLine`/`drawText`/`save()`. Also confirmed no `Math.random`/`Date` anywhere
  in the wall-layout engine itself (`tileSolve.ts`, `tileWall/`, `tileWallElevation.ts`,
  `tileOverlay.ts`, `tilePatterns/`). The plan's Task-1 determinism test is real and would catch a
  regression. (Caveat, not a defect: `ingest.js:122-124`'s determinism claim for *images* is itself
  untested in `test/ingest.test.ts` today — the plan's citation of it as precedent is aspirational,
  not a verified guarantee — but the elevation generator's own T1 test stands on its own regardless.)
- **Scale formula & provenance (attack #2).** `upp = 1/(P·RENDER_SCALE)` verified exactly against
  `RENDER_SCALE = 2.0` (`sheets.ts:10`) and `arch()` (`sheets.ts:68-69`); P=36 pt/ft is exactly the
  "1/2\" = 1'-0\"" standard-scale entry. Field names `sheet_id`/`units_per_px`/`scale_source`/
  `scale_confirmed` match the real hydrate/export code exactly (`TakeoffCanvas.jsx:2005-2019,2681`).
  The gate (`scaleUnconfirmed[key] === false` at `:8062`) is a negative gate — anything else
  (including simply never touching it) reads as confirmed.
- **Wide wall pages don't break rendering (attack #2, second half).** The canvas render path is a
  tile-pyramid compositor bounded by `BASE_TARGET_AREA = 28,000,000` px with 2048px base tiles
  (`tileCompositor.ts:60-70`), not a single monolithic raster — a ~100ft wall at P=36
  (3600pt → 7200px at RENDER_SCALE) is handled by the exact same bounded machinery as any large
  real sheet. No special-case break found.
- **Render path has zero special-casing for a bare 1-page generated PDF (attack #3).**
  `resolveSource` (`TakeoffCanvas.jsx:2264-2282`) uses `pdf.numPages || 1` and clamps
  `pageNum = min(max(1,pn), numPages||1)` — a plain 1-page doc with no title block flows through
  unchanged. Thumbnails (`PlanNavigator.jsx:thumbOne`) and marked-PDF/DXF all key off the same
  generic PDF-page contract.
- **y-convention (attack #4) — the plan is right, not buggy.** `tileWallElevation.ts:6-8`'s own
  header comment: the layout is "natural/un-flipped… floor at y=0 — **the caller's SVG does its
  own V-flip**." `TilePanel.jsx:562-565` confirms the V-flip exists only to compensate for SVG's
  inherently y-down screen space (`matrix(1,0,0,-1,0,${h_px})`). pdf-lib pages are also y-up with
  origin bottom-left, and `drawRectangle({x,y,w,h})` takes the bottom-left corner — exactly the
  helper's native convention (`y0 = min-y of the tile`, i.e. its floor-facing edge). So drawing the
  helper's raw feet coordinates directly into pdf-lib, scaled by P, correctly puts the floor at the
  page bottom with **no flip needed** — the SVG V-flip was never evidence the helper emits
  screen-y-down coordinates; it was purely an SVG-specific correction that pdf-lib doesn't need.
- **Sheet-key parsing / regenerate-in-place mechanics (attack #5, minus the tag-collision issue
  above).** `sheetKey.ts:8-12` treats `${tag}-elevation.pdf` as an ordinary bare (page-1) file
  name. `store.js addPdf` (`:207-239`) keys `PDF_STORE` by `file.name` — a same-name regenerate
  correctly updates the one existing record (no duplicate gallery entry); different bytes archive
  the prior record to `pdf_revs` before swapping (`:234-238`).
- **`byShape` availability (attack #6).** `tileTakeoff.byShape.get(shape.id)` — the exact data
  Task 1/2 need (`wallStrips`, `folds`) — is already computed and read synchronously in
  `TakeoffCanvas.jsx` today, for the Slice A panel preview
  (`TakeoffCanvas.jsx:10269-10271`: `selWallSummary = tileTakeoff.byShape.get(selShape.id)`). The
  new handler lives in the same component and can reuse the same `tileTakeoff` value with no
  async/staleness concern.
- **DXF (attack #4/investigation §5).** `buildSheetDxf` (`dxf.ts:161-168`) only requires
  `dims.w/h > 0` and `upp > 0` (throws otherwise) — no PDF page needed, exactly as cited.
- **Test toolchain (not explicitly asked, but load-bearing for Task 1).** `sheets.ts` imports
  `pdfjs-dist`; confirmed this already imports and runs cleanly under plain
  `node --import tsx --test` — ran the existing `test/units.test.ts` (which imports `RENDER_SCALE`
  from `sheets.ts`) and got 22/22 passing. Not a blocker for Task 1's test file.
- **Test interfaces match real exports.** `wallStripRing(L_ft, H_ft)` (`tileWall/unwrap.ts:10`),
  `solveTileLayout({tile_setup, ring_ft, holes_ft?})` (`tileSolve.ts:39-43`), `mintTileSetup()`
  (`tileSetup.ts:104`), and `TileJoint = {width_in}` (`tileSetup.ts:12`) all match the plan's
  Task-1 test code exactly — no interface mismatch.

---

## What must change before coding

1. **Resolve C1** — commit to a sheet key that's always unique per wall shape (full shape id, not
   a truncated one), never the tag alone. Update Global Constraints, Task 2, and Task 3's helper
   description to agree.
2. **Decide I1** — state explicitly what happens to existing annotations on the elevation sheet
   when a regenerate changes `width_ft`/`height_ft`, even if the answer is "accepted, same as any
   other re-imported sheet."
3. Cosmetic: fix M1's wording (describe the real `setScales`/`setScaleSources`-only path) and M2
   (name `forgetPages` explicitly, not just `docEpoch`).
