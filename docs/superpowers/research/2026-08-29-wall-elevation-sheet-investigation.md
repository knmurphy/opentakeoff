# Wall Elevation Sheet — Feasibility & How-To Investigation

Date: 2026-08-29
Scope: can OpenTakeoff host a **synthetic "wall elevation sheet"** — a GENERATED drawing (not
backed by a source PDF page) that renders the tiled wall strip, is viewable on the canvas, listed
in the sheet gallery, annotatable, and exportable?
Codebase root cited below: `web/src` (worktree `.claude/worktrees/tile-walls`).

All file:line citations are primary-source reads, not recall.

---

## Verdict (short)

**PARTIAL — feasible the cheap way, hard the pure way.**

- A **generated-PDF-backed** elevation sheet (draw the strip into a real one-page PDF with
  pdf-lib, store it, treat it as an ordinary sheet) is **FEASIBLE and low-risk**: it reuses the
  render pipeline, gallery, thumbnails, shape binding, scale, marked-PDF export and DXF export
  **unchanged**.
- A **truly synthetic** sheet (no PDF bytes anywhere, canvas renders an SVG/offscreen drawing) is
  **HARD**: the whole canvas raster path is pdf.js-only, and so are thumbnails and the marked-set
  light path. It would need new branches in 4 places.
- The **stitch** mechanism is the closest precedent but is **not** a fully-synthetic sheet — every
  stitch pixel still comes from a real member PDF page. Stitch proves synthetic *keys*, persisted
  synthetic *records*, and per-key *shape binding* work; it does **not** prove non-PDF *pixels*.

---

## 1. Sheet representation (end-to-end)

**Sheet KEY codec.** `web/src/lib/sheetKey.ts:8-12` — `parseSheetKey`: page 1 = bare file name,
pages 2+ = `"name#page"` (split on the LAST `#` only when the tail is numeric). Canonical order:
`compareSheetKeys` `sheetKey.ts:17-20` (file name, then numeric page). `sheets.ts:5-8` re-exports
these from the pdfjs-free module. A sheet key IS the `sheet_id` shapes bind to.

**Where the sheet LIST comes from.** `web/src/lib/store.js:192-198` `listSheets()` returns the
keys of the IndexedDB `PDF_STORE` as `[{ name }]` — i.e. **the list of sheets is the list of stored
PDFs**. The canvas mirrors it: `refreshSheets` `web/src/pages/TakeoffCanvas.jsx:1702-1704`
(`store.listSheets()` → `setSheets`), and the `sheets` state (declared `TakeoffCanvas.jsx:346`) is
passed to the gallery.

**Sheet → rendered image.** The render effect `TakeoffCanvas.jsx:2236-2330`:
- `resolveSource(memberKey)` `2266-2282`: `docFor(file)` → `pdf.getPage(pageNum)` →
  `pageObj.getViewport({ scale: RENDER_SCALE })`; dims are `w=ceil(viewport.width)`,
  `h=ceil(viewport.height)` (exact `wf/hf` kept for stitch extent math).
- `RENDER_SCALE = 2.0` (`web/src/lib/sheets.ts:10`).
- `getCompositor().openSheet(drawKey, pageNum, store.loadPdfData(file), w, h)` `2322` hands the PDF
  bytes to the worker pool; `paintBase(...)` `2329` rasters tiles.
- `setPanelImgs(...)` `2312` is the **only** place panel bitmap dims are set — `panels`
  (`1175-1180`) read `panelImgs[key]` for their `img.w/h`, and shapes/rings need those dims.

So a sheet's **image dims** come straight from a pdf.js page viewport at `RENDER_SCALE`, and its
pixels come from pdf.js rasterizing that page (see §2/§3 for the compositor).

**How shapes bind to a sheet.** Shapes carry `sheet_id === the sheet key`; geometry is
`verts_norm` normalized to the viewport dims. Visible-shape filter:
`TakeoffCanvas.jsx:1214-1217` (`shapes.filter(s => keys.has(s.sheet_id))`). Persistence is
PDF-agnostic: shapes live in the annotations payload `shapes[]` (`store.js:69`, saved by
`saveAnnotations` `store.js:288-289` into `META_STORE` key `"annotations"`).

**Scale (`upp`).** Per-sheet, keyed by sheet key: `scales` state `TakeoffCanvas.jsx:457`;
`unitsPerPx = scales[focusPanel.key]` `1229`. Persisted per sheet as
`sheets[].units_per_px` and reloaded at `TakeoffCanvas.jsx:2008-2017`. Semantics: `upp` = **real
feet per image pixel at RENDER_SCALE** (`sheets.ts:33-37`). Standard architectural/engineering/
metric scales: `STANDARD_SCALES` `sheets.ts:74-101`. **Per-sheet `upp` is fully supported** — it is
a plain map keyed by sheet key, so a synthetic sheet can be given its own `upp` directly.

---

## 2. The STITCH mechanism (closest precedent) — full lifecycle

Module: `web/src/lib/stitches.ts` (pdfjs-free, node-tested).

- **What it is:** a **persisted composite working surface** of 2..MAX_GROUP member sheets placed
  at pixel offsets in the RENDER_SCALE frame, opened as ONE panel. Shapes bind to the stitch key
  `stitch:<uid>` exactly like any sheet (`stitches.ts:1-12`). The members are a **render-time
  concern only**.
- **Key:** `STITCH_PREFIX = "stitch:"` `stitches.ts:16`; `isStitchKey` `:17-19`; `mintStitchId`
  `:23-26` (uuid). A colon never appears in a real dropped-file key, so no collision.
- **Created:** `createStitch` `TakeoffCanvas.jsx:1084-1108` — mints an id, lays members out with
  `autoButt` (`stitches.ts:83-90`), `setStitches(...)` `1100`, seeds `scales[st.id]` from the
  members' shared upp `1101-1102`. Opened via `openStitch` `1074-1079` (`setSheetGroup([id])`).
- **Stored / persists across reload:** YES. The annotations payload has a `stitches` field
  (`store.js:67-69`), saved by `saveAnnotations` into `META_STORE`; hydrated on load with
  `sanitizeStitches` `TakeoffCanvas.jsx:1979-1980` (gate: `stitches.ts:39-68`). `stitchById` is a
  `useMemo` over that persisted state `TakeoffCanvas.jsx:1163` — **not** canvas-only ephemeral
  state. (The `sheets.ts:19-22` "" comment is only about the frozen source-caption fallback for a
  legacy capture; the stitch's real name lives in the persisted record.)
- **How it RENDERS without being a PDF page:** it does NOT synthesize an image. The render effect
  branch `TakeoffCanvas.jsx:2290-2304` resolves **each member's own PDF page**, registers each
  member pageObj under its own key, and takes `stitchExtent` (`stitches.ts:93-102`) as the panel's
  logical dims. At draw time the panel is **expanded into its member canvases** (`drawPanels`
  `TakeoffCanvas.jsx:1185-1199`), each positioned at its offset and seam-clipped
  (`seamClips` `stitches.ts:154-176`). Every pixel is still a pdf.js raster of a real member page.
  => **A stitch is a composite of PDF page crops, not an offscreen/SVG drawing.**
- **Gallery/tabs identity:** `labelFor` `TakeoffCanvas.jsx:1230`, `tabLabel` `1137/1150`
  → `stitchById[k].name`.
- **Marked-set:** stitch branch `markedset.js:511-580` embeds each member's **source PDF page**
  (`embedPage`/`copyPages`) — still PDF-bound.

**Takeaway:** stitch is the template for a synthetic KEY + persisted RECORD + shape binding, but it
never had to solve "render pixels with no PDF."

---

## 3. Can a FULLY-synthetic generated sheet exist?

**The canvas render path REQUIRES pdf.js bytes.** Evidence:
- `tileCompositor.openSheet(sheetKey, pageNum, dataPromise, ...)` `web/src/lib/tileCompositor.ts:159-174`
  awaits the ArrayBuffer and calls `pool.openSheet(sheetKey, pageNum, buf)`. Every tile:
  `getOrFetchTile` `:193-247` → `pool.requestTile({ sheetKey, scale: RENDER_SCALE*density, rect })`
  `:220`, i.e. a pdf.js render in a worker. There is **no branch** that paints arbitrary
  canvas/SVG/bitmap content.
- `resolveSource` `TakeoffCanvas.jsx:2266-2282` needs `docFor(file).getPage(...)` — a real PDF.
- `panelImgs` dims come only from a pdf viewport (`2272`, set at `2312`).
- Even dropped **images are wrapped into a one-page PDF** before storage:
  `web/src/lib/ingest.js:116-140` `imageToPdf` (pdf-lib `embedPng/embedJpg` + `addPage(...).drawImage`),
  invoked at `ingest.js:182`. Nothing non-PDF ever enters the store.

**Minimum a new sheet needs:**
- (a) **appear in gallery/tabs:** be in `store.listSheets()` (i.e. a PDF in `PDF_STORE`) so it
  shows in the `sheets` prop; tabs are just `openTabs` keyed by sheet key
  (`TakeoffCanvas.jsx:373`). Thumbnails, however, require a pdf page (`PlanNavigator.jsx:314-336`).
- (b) **render on canvas:** `panelImgs[key]` dims **and** a compositor source. Today the only
  source is PDF bytes.
- (c) **hold shapes/annotations:** already free — shapes just need `sheet_id === key` + `verts_norm`
  + a `scales[key]` entry. Shape storage is PDF-agnostic (§1).

**=> The clean, minimal-change seam:** *generate a real one-page PDF* of the elevation strip with
pdf-lib (exactly the `ingest.js:116-140` idiom, or the marked-set tile page at
`markedset.js:936`), `store.addPdf(...)` it, and it becomes an ordinary sheet — canvas, gallery,
thumbnails, shapes, scale, both exports all work with **zero new branches**.

**The true-synthetic (no-PDF) route** would need new branches in, at minimum:
- render effect `resolveSource` / phase A `TakeoffCanvas.jsx:2264-2330`,
- `tileCompositor` `openSheet`/`paintBase`/`paintDetail` `tileCompositor.ts:159-520`,
- thumbnails `PlanNavigator.jsx:314-336`,
- marked-set per-sheet loop `markedset.js:508-607` (a synth-draw branch — precedent exists, §5).

---

## 4. Scale / dims for a synthetic sheet

The elevation frame is orthographic true-scale in FEET (`u` along the wall, `v` = height), and
`wallElevationLayout` returns `width_ft`/`height_ft` plus tiles in feet
(`web/src/lib/tileWallElevation.ts:52-98`). So `upp` is **known exactly at generation time** — no
calibration/detection needed.

- **Per-sheet `upp` is supported** — set `scales[key]` directly (`TakeoffCanvas.jsx:457,1229`),
  persisted as `sheets[].units_per_px` (`2008-2017`).
- If the strip is drawn into a PDF page at `P` points-per-foot, then a pdf.js viewport at
  `RENDER_SCALE` makes the page `P·width_ft·RENDER_SCALE` image px wide, so
  `upp = width_ft / (P·width_ft·RENDER_SCALE) = 1 / (P·RENDER_SCALE)` — a fixed number you compute
  once and write into `scales[key]`. (Sanity check vs. `sheets.ts:68` `arch()`: 1/4"=1' → P=18 pt/ft
  → `1/36 = 0.02777` = `arch(0.25)`. Consistent.) Pick a `P` matching a `STANDARD_SCALES` label if
  you want the label to read cleanly, but you don't have to — the map takes any float.
- `verts_norm × dims × upp = feet` holds by construction, so measured lengths/areas and DXF real
  units come out right.
- **Set the scale's provenance, not just the number.** Scale rides three sibling persisted fields
  (`TakeoffCanvas.jsx:2008-2017`): `units_per_px`, `scale_source`, and `scale_confirmed`. The last
  is a **gate** — the comment calls it "agent-set, awaiting a human", surfaced as
  `scaleUnconfirmed`. A programmatically generated sheet knows its `upp` exactly, so it must write a
  provenance (`scale_source`) and land **confirmed** (or omit the unconfirmed flag), or the
  measurement UX is needlessly gated behind a human confirmation the frame doesn't require.

---

## 5. Export

**Marked PDF** (`web/src/lib/markedset.js`, `buildMarkedSetPdf` `:247`):
- Enumerates the `sheets` param, which the caller builds from **shape `sheet_id`s**, not from the
  store list: `TakeoffCanvas.jsx:5618-5636` (`plainMeta` + `stitchMeta`), passed at `5642-5648`.
- Per-sheet loop `markedset.js:508`: light path = `copyPages`/`embedPage` of the **source PDF**
  (`:582-607`), dark path = raster PNG via `getPage(...).render(...)`.
- A **PDF-backed** synthetic elevation sheet flows through this unchanged (it has `file`+`page`,
  `getPage` resolves it, verts_norm map straight in).
- A **no-PDF** sheet would need a synth-draw branch. There is a *partial* precedent — the optional
  **tile shop-drawing page** `markedset.js:907-1000` is drawn purely with pdf-lib primitives (no
  `copyPages`) — **but it is not a standalone no-PDF page**: it sizes itself from the real sheet's
  page (`doc.addPage([pg.getWidth(), pg.getHeight()])` `:936`) and threads its geometry through THAT
  sheet's `toPage`/`chipRot`/`ptScale`. So it proves "draw furniture with pdf-lib" but still hangs
  off a PDF-backed sheet. Note also `:925-932`: a wall (`surface_area`) shape's cells live in
  strip-local elevation coords, the loop explicitly **does not** draw it, and the comment names
  wall elevation sheets as **"Slice B"** — so today a wall-only sheet produces no tile page at all.

**DXF** (`web/src/lib/dxf.ts`, `buildSheetDxf` `:161-197`):
- Takes a `DxfSheetInput` of `{ sheet_id, dims, upp, shapes, conditions }` and emits CAD entities;
  it **needs no PDF page at all** — only `dims.w/h > 0` (`:167`) and `upp > 0` (`:168`).
- => DXF export of a fully-synthetic elevation sheet is **straightforward** given dims + upp; it is
  the one export path that is already synthetic-friendly.

---

## 6. Sheet gallery / tabs UI

- **Gallery = `web/src/components/PlanNavigator.jsx`** (the former SheetGallery, `:2`). It iterates
  the `sheets` prop (`:61`, `:292` `allKeys = sheets.flatMap(...)`, enumerates pages `:272-290`).
  Thumbnails: `thumbOne` `:314-336` → `pdf.getPage(page)` + `renderThumb` — **requires a pdf page**.
- **Tab strip** lives in `TakeoffCanvas.jsx`: `openTabs` `:373`, opened via `openSheets`/`openStitch`
  `:1074-1126`; labels via `labelFor` `:1230` / `tabLabel` `:1137,1150`.
- **Adding a generated sheet entry:**
  - *PDF-backed route:* nothing bespoke — `store.addPdf` puts it in `listSheets()`, so it appears
    in the gallery and gets a thumbnail for free; open it like any sheet.
  - *No-PDF route:* inject a synthetic entry into the `sheets` list, add label handling, and add a
    thumbnail path that doesn't call `pdf.getPage` (`PlanNavigator.jsx:314-336`).

---

## Biggest seams / obstacles (ranked)

1. **Render pipeline is hard pdf.js-bound.** `tileCompositor.openSheet` + `pool.requestTile` only
   rasterize PDF bytes (`web/src/lib/tileCompositor.ts:159-247`); `resolveSource` needs
   `getPage` (`web/src/pages/TakeoffCanvas.jsx:2266-2282`). This is THE blocker for a no-PDF sheet.
2. **`panelImgs` dims are sourced only from a pdf viewport** (`TakeoffCanvas.jsx:2272,2312`) — the
   canvas has no other way to learn a panel's size.
3. **Thumbnails require a pdf page** (`web/src/components/PlanNavigator.jsx:314-336`).
4. **Marked-set light path copies the source PDF page** (`web/src/lib/markedset.js:582-607`); a
   no-PDF sheet needs a synth-draw branch (partial precedent only: the tile page
   `markedset.js:907-1000` is pdf-lib-drawn but still sized off a real sheet page).
5. **REGENERATION is the distinctive lifecycle problem of a *generated* sheet, and the store treats
   a re-generated PDF as a REVISION.** An elevation sheet is not write-once: edit the wall / change
   the SKU / re-solve → the PDF must be rebuilt → new bytes under the same name.
   `store.addPdf` content-hashes every file and, on changed bytes, archives the old record to the
   `pdf_revs` store as a numbered revision, returning `{ revised, rev, prev_rev }`
   (`store.js:18-24`, hash at `:184`+, canvas handles `revised` at `TakeoffCanvas.jsx:1834`;
   `docEpoch` `:1164-1172` then resets every cache + `forgetPages`). `ingest.js:122-124` warns the
   wrap must be byte-deterministic or it "would make every image re-drop a false 'sheet changed'
   alarm" — a regenerated elevation sheet trips exactly that. Worse, if `width_ft`/`height_ft`
   changed, the sheet's dims change and `verts_norm`-bound annotations rubber-sheet onto a different
   frame (`revisions.js:4` confirms shapes are NOT paired across a re-imported sheet — only totals
   are). Any design must decide: regenerate-in-place (accept revision churn + possible annotation
   drift) vs. a stable non-revisioned regeneration path.

## Recommended seam (lowest risk)

Generate the elevation strip as a **real one-page PDF** with pdf-lib (idiom:
`web/src/lib/ingest.js:116-140` `imageToPdf`, or the marked-set tile page `markedset.js:936`),
`store.addPdf` it, and set `scales[key]` directly to the known-exact `upp` from §4. Across the seams
verified here — render effect, compositor, gallery, thumbnails, marked-PDF, DXF — it then behaves as
an ordinary sheet with no new branches. DXF (`dxf.ts:161-197`) already needs only dims+upp, so it
works either way.

**Not yet verified (call out before building):** the regeneration/revision interaction (obstacle
#5) is the open design question, and these sheet-adjacent modules were *not* checked against a
generated sheet — `revisions.js`, `sheetLevels.js`, `sheetGroups.ts`, `sheetgraph.ts`,
`projectArchive.js`, and cloud sync (`lib/sync/`, `cloudStore.js`). The "ordinary sheet" claim is
scoped to the six seams above; those six are the ones a first slice needs, but revisions is the one
to spot-check first.
