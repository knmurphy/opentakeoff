# PDF Data Surface — what we can read deterministically, and how to surface it

> **Status: RESEARCH, nothing built.** This is an inventory and a set of ranked
> proposals, not a commitment. It exists so a feature can be picked off this
> list with the seams already named. Companion to
> [`FEATURES.md`](../FEATURES.md) (what exists) and
> [`docs/ESTIMATING_ROADMAP.md`](ESTIMATING_ROADMAP.md) (the pricing arc).

**Deterministic** here means: read straight out of the PDF by pdf.js or
pdf-lib, in the browser, with no model, no network, and the same answer every
time. That constraint is the point — everything below is free of the
login-gate, cost, and non-repeatability that the AI paths (`lib/ai.js`,
`/ai/parse-schedule`) carry. Where a proposal genuinely needs a model, it says
so.

---

## 1. The finding, in one paragraph

OpenTakeoff already parses a lot of a plan set deterministically — and then
**throws almost all of it away**. The page text layer is fetched at least four
times per sheet (thumbnail pump, panel render, label scan, marquee import),
used for exactly two facts each time (sheet number, scale note), and never
cached or indexed. The vector op-list walk composes the full CTM and visits
every path, but keeps only endpoints, segments, one width byte, and a total
image area — discarding color, dash, and layer membership, which are the three
things CAD uses to say what a line *means*. And an entire tier of the format
— annotations, outline, page labels, document metadata, optional-content
groups, measurement viewports — is never requested at all. There is no
cross-sheet search, no drawing index, no layer control, and no way to filter
any of it. The gap between "what we can already see" and "what the estimator
can act on" is the largest cheap-value surface in the app.

---

## 2. Inventory — what the format gives us vs. what we take

### 2.1 Page text layer (`page.getTextContent()`)

pdf.js hands back `items[]` of
`{ str, dir, width, height, transform, fontName, hasEOL }` plus a `styles` map
(`fontName → { fontFamily, ascent, descent, vertical }`). With
`{ includeMarkedContent: true }` the stream is interleaved with
marked-content begin/end items, which is how text gets attributed to a layer
(§2.4).

| Field | Used today | Where |
|---|---|---|
| `str` + `transform` | ✅ but transiently | `extractSheetNumber`, `detectScale` (`lib/sheets.ts`), `extractRegionText` → `parseSchedule`, `roomLabelSeeds` (`lib/detectRooms.ts`) |
| `height` / cap height | ✅ | `Token.h` for row clustering in `scheduleParse.ts` |
| `width` | ❌ | glyph-run width — would give real text bounding boxes for hit-testing and highlight rects |
| `fontName` / `styles` | ❌ | font identity separates title-block text from drawing annotation from dimension strings, deterministically |
| `dir`, `hasEOL` | ❌ | RTL and line-break hints |
| marked content | ❌ | text ↔ layer attribution |

**Not cached anywhere.** `PlanNavigator.jsx:225`, `TakeoffCanvas.jsx:1205`,
`:1216`, `:1232`, `:3714`, `:3965` each re-fetch. On a 200-sheet bid set that
is real repeated work, and it means no feature can assume the text is
available cheaply — which is why none of them exist.

### 2.2 Vector op list (`page.getOperatorList()`)

`extractVectorGeometry` (`lib/oneclick.ts:107`) walks the stream with correct
save/restore/transform/form-XObject matrix composition and emits
`{ points, segs, meta, imageArea }`. It consumes `save`, `restore`,
`transform`, `setLineWidth`, `setGState` (`LW` only), the form-XObject pair,
all six image-paint ops, and `constructPath`. Per segment it keeps 3 flag bits
(`SEG_CURVE`, `SEG_CLIP`, `SEG_FILLONLY`) and a 4-bit device line width.

What the same walk is standing on but ignores:

| Op | What it carries | Why a takeoff tool wants it |
|---|---|---|
| `setStrokeRGBColor` / `setFillRGBColor` (+ `setGState`) | per-path RGB | On plotted sheets, **color is the encoding**: red = demo, gray/screened = existing-to-remain, black = new work. Filtering linework by color is a first-class estimator gesture, and a color-aware mask stops One-Click from being bounded by furniture or dimension lines. |
| `setDash` | dash array | Dashed = hidden / above-ceiling / below-slab. A mask that ignores dashed paths removes a known class of false walls; a "dashed only" view is how you find soffits. |
| `beginMarkedContentProps` (`"OC"`, ocgId) / `endMarkedContent` | optional-content (layer) membership | See §2.4 — the single biggest unlock. |
| `showText` positions | glyph runs in the op stream | Text already can't block a fill (it's `showText`, not `constructPath`), but knowing *where* text sits lets the raster mask (`lib/rastermask.ts`) exclude it too, which is exactly where the scan path leaks today. |
| `constructPath` fill winding | `fill` vs `eoFill` | Already distinguished for `SEG_FILLONLY`, but discarded — solid poché regions could be recovered as polygons directly, no flood needed. |

All of these are additive to a walk that already exists and already gets the
transforms right. This is the cheapest engine work on the list per unit of
capability.

### 2.3 Document-level APIs we never call

Every one of these is a single `await` on the `PDFDocumentProxy` we already
hold (`getDoc` / `docFor` in `TakeoffCanvas.jsx`, `openPdf` in `mcp/src/pdf.ts`):

| API | Returns | Value here |
|---|---|---|
| `getOutline()` | the publisher's bookmark tree | On a real bid set this **is** the drawing index, already authored, already sheet-ordered. Free replacement for guessing at sheet order. |
| `getPageLabels()` | per-page label strings | The publisher's own page numbering ("A-101") — an authoritative cross-check on `extractSheetNumber`'s title-block heuristic. |
| `getMetadata()` | `info` (Title/Author/Subject/Producer/Creator/dates) + XMP | **`Producer`/`Creator` tells you what made the sheet.** AutoCAD/Revit/Bluebeam ⇒ expect clean vectors and OCGs; a scanner/Acrobat-image producer ⇒ route straight to the raster path instead of discovering it from `imageFrac`. Dates give a plan-set issue date for revision tracking. |
| `getDestinations()` | named destinations | Target half of intra-set links. |
| `getAttachments()` | embedded files | Rare, but some GCs embed the spec book or a DWG. Free. |
| `getPermissions()` | usage flags | Warn once, up front, on a restricted set rather than failing oddly later. |
| `getOptionalContentConfig()` | OCG id → `{ name, intent }` + the default on/off config | §2.4. |
| `getFieldObjects()` / `getJSActions()` | AcroForm fields | RFI/transmittal forms shipped as PDFs. Ties into `lib/rfi.js`. |
| `page.getStructTree()` | tagged-PDF structure | Almost never present on CAD output. Low priority, note it and move on. |

### 2.4 Optional content groups — the layers

CAD publishers export AutoCAD/Revit layers as PDF **optional content groups**,
named exactly as the drafter named them: `A-FLOR-PATT`, `A-WALL-FULL`,
`A-DOOR`, `I-FURN`, `A-ANNO-DIMS`, `M-DUCT`. pdf.js exposes this in two halves
that we currently use neither of:

1. `pdf.getOptionalContentConfig()` → `.getGroups()` gives id → `{ name, intent }`,
   and the config object carries the document's default visibility.
2. In the op list, content is bracketed by
   `OPS.beginMarkedContentProps` with args `["OC", <ocgId>]` … `OPS.endMarkedContent`.
   Tracking a small stack of those in the existing walk attributes **every
   segment to a named layer** — a one-byte-per-segment addition alongside the
   `meta` array that's already there.
3. `page.render({ optionalContentConfigPromise })` makes the *raster* honor a
   modified config, so show/hide is free on the render side too.

Why this matters more than anything else on the list: One-Click's whole
difficulty is deciding which linework is a boundary. The hatch classifier
(`classifyHatchSegs`, ~80 lines of calibrated heuristics with a
three-tier escalation and a sensitivity knob) exists to *infer* something the
PDF often states outright — this path is on layer `A-FLOR-PATT`. When OCGs are
present, "exclude these layers from the mask" is a deterministic, explainable
replacement for a heuristic that AGENTS.md admits is calibrated on one sheet
and one CAD style. The heuristic stays as the fallback for sheets with no OCGs
(scans, flattened exports, some plotters).

**Caveat to test before building:** many bid sets are flattened on the way out
of Bluebeam or a print-to-PDF driver, which drops OCGs. Probe the corpus first
— including `web/public/demo/` — and treat layer-awareness as an enhancement
that reports "no layers in this sheet" rather than a load-bearing assumption.

### 2.5 Annotations — completely unread today

`page.getAnnotations()` is never called anywhere in this repo. It returns
typed, positioned, styled objects with `rect`, `subtype`, `contents`,
`author` (`titleObj`), `creationDate`, `modificationDate`, color, and
per-subtype geometry (`vertices` for Polygon/PolyLine, `inkLists` for Ink,
`quadPoints` for text markup, `dest`/`url` for Link).

What's actually sitting in real plan sets:

| Subtype | What it is on a bid set | What we could do |
|---|---|---|
| `Square`, `Circle`, `Polygon`, `PolyLine`, `Line` | **another estimator's Bluebeam takeoff** | Import as OpenTakeoff shapes with quantities recomputed under our own scale. A genuine interop story: open a marked set, inherit the measurements, audit them against your own. |
| `Polygon` clouds / `Ink` | revision clouds on an addendum | Auto-populate a per-sheet change list **with zero diffing**. Compare with `lib/revisionClouds.js`, which reconstructs this by pairing shape ids — when the architect shipped the clouds, just read them. |
| `FreeText`, `Text` (sticky notes) | RFI callouts, "see detail 4/A501" | A filterable per-sheet notes list; feeds `lib/rfi.js`. |
| `Stamp` | APPROVED / FOR CONSTRUCTION / NOT FOR CONSTRUCTION | A hard, visible warning when someone is bidding off a non-construction set. Complements `lib/stamps.js` (which today only *writes* stamps). |
| `Link` | detail callouts, sheet cross-references | Click a callout bubble on A-101 and land on A-501 — real navigation instead of hunting the gallery. |
| `Widget` | form fields | Transmittals, RFI forms. |
| `Highlight`/`Underline`/`StrikeOut` | spec markups | Display + filter. |

Annotations also carry `author` and dates, so an imported markup layer can say
who wrote it and when — provenance the app already models for its own shapes
(`lib/provenance.js`).

### 2.6 Measurement viewports — an authoritative scale

The PDF spec puts a `/VP` array on a page: viewport dictionaries with a
`/BBox` and a `/Measure` dictionary (`/Subtype /RL`, plus `/X`, `/D`, `/A`
number-format arrays) that state the drawing's real-world scale **as data**,
not as a text note we regex out of the title block. Some CAD publishers emit
it; Bluebeam reads and writes it for calibrated sets.

pdf.js has no public API for `/VP`, but **pdf-lib is already a dependency**
(`lib/ingest.js`, `lib/markedset.js`) and can walk the page dictionary
directly. When present, `/Measure` beats `detectScale`'s note-matching outright
— and it's per-viewport, so a sheet with a plan at 1/8" and a detail at 1/2"
resolves *both*, which is exactly the `multi: true` ambiguity `detectScale`
currently gives up on (`sheets.ts:141-156`).

**Probe before building.** Verify emission rates across a real corpus; if it's
rare, it's a cheap opportunistic upgrade, not a feature.

### 2.7 Sheet-level facts we can already derive but don't expose

- **Vector vs. scan.** `sheetStatsRef` already holds `{ segCount, imageFrac }`
  per sheet (`TakeoffCanvas.jsx:1194`) — used only to route One-Click. Show it:
  "12 of 84 sheets are scans" is a bid-planning fact.
- **Page geometry.** `page.view`, `.rotate`, `.userUnit` → real sheet size
  (ARCH D, ANSI E, 30×42) and rotation. Sheet size is a sanity check on scale:
  a 1/8" plan on a half-size print is the classic 2× error the Check-a-dimension
  feature (`K`) exists to catch.
- **Scale disagreement.** `detectScale` already computes `multi` (several
  distinct scale notes on one page) and discards the detail. Surfacing *which*
  scales were found and where turns a silent "suggest nothing" into an
  actionable list.

---

## 3. Proposals — surfacing and filtering, ranked

Each is scoped to be independently shippable, additive, and consistent with
the repo's existing patterns.

### P1 · The sheet index (cache what we already read) — **highest value / lowest risk**

One per-sheet record, built once, reused by everything:

```
SheetIndex = {
  key,                       // "A-101.pdf#3" — lib/sheetKey.ts
  sheet_no,                  // extractSheetNumber (exists)
  title,                     // NEW: largest text run adjacent to the number
  discipline,                // NEW: leading letter class of sheet_no (A/S/M/E/P/FP/C/L)
  level,                     // NEW: "LEVEL 2"/"SECOND FLOOR" in title-block text
  scales: [{ label, upp, where }],   // detectScale, un-collapsed
  page: { wPt, hPt, rotate, sizeName },
  stats: { segCount, imageFrac, textItems },
  text: Token[],             // the positioned text layer, kept
  rooms: [{ number, name, x, y }],   // NEW: roomLabelSeeds + nearest name run
}
```

**Build seam.** A new `web/src/lib/sheetIndex.ts` — pure, pdfjs-free, taking
already-positioned tokens exactly like `scheduleParse.ts` and `detectRooms.ts`
do, so it is node-testable and the MCP server can reuse it verbatim. The
pdf.js-touching half stays in `sheets.ts` / `TakeoffCanvas.jsx` /
`mcp/src/pdf.ts`.

**Cache seam.** In-memory ref keyed by sheet key for the session; persisted
under its own key in the keyPath-less `META_STORE` in `lib/store.js` — **no DB
version bump**, the stamp-library precedent (see `ESTIMATING_ROADMAP.md` §3b).
Key on file name + size so a reissued sheet invalidates.

**Build trigger.** Piggyback the thumbnail pump in `PlanNavigator.jsx:203-233`,
which already walks every sheet lazily behind an `IntersectionObserver` and
already calls `getTextContent()`. Zero new passes for the common case.

Unlocks, immediately:

- **Cross-sheet Find (`⌘F` / `/`)** — search all sheet text, results grouped by
  sheet, click to open and zoom-to-hit with a highlight rect. This is the
  single most-missed feature in any plan viewer and we already have the data.
- **A real drawing list** — the gallery shows `A-101 · FIRST FLOOR PLAN`
  instead of a file stem (`labelOf` in `PlanNavigator.jsx:253`), sorted by
  sheet number, filterable by discipline.
- **Auto-levels** — `sheet_levels` is set today by a `window.prompt`
  (`PlanNavigator.jsx:266`). Propose levels from the title text and let the
  user confirm; feeds `groupSheetsByLevel` (`lib/sheetLevels.js`) unchanged.
- **Room list per sheet** — `roomLabelSeeds` already finds the numbers; pair
  each with the nearest larger text run to get `104 · CORRIDOR`. Filterable,
  and every row is a one-click seed for the existing flood
  (`detectRegions`) — "detect all corridors" becomes a real gesture.

### P2 · A "Plan Data" panel — the one place all of this is filterable

A docked panel mirroring `TakeoffsPanel.jsx` / `ReportPanel.jsx`, with tabs:
**Sheets · Text · Rooms · Layers · Annotations · Schedules · Document**.

Every tab is the same thing: a filterable, sortable table with a search box
and column visibility, following the **column-profile pattern already
documented and golden-tested in `lib/reportColumns.js`** (`GETTERS` +
`*_PROFILE` with `defaultVisible`, opt-ins appended, never reordered). Rows
carry actions: *zoom to* · *seed One-Click* · *create condition* · *add markup*
· *copy*.

The Sheets tab is the bid-QA view an estimator actually wants before pricing:
facets on discipline, level, detected scale, vector-vs-scan, has-takeoff — with
the negative space called out. *"9 sheets have no detected scale. 12 are scans.
31 A-sheets have no takeoff."* That readout is buildable entirely from P1.

### P3 · Layer awareness (OCG) — the biggest engine unlock

1. Track `beginMarkedContentProps("OC", id)` / `endMarkedContent` in
   `extractVectorGeometry`, emitting a parallel `layerIds` array alongside the
   existing `meta`. Same walk, same transforms, one more stack.
2. Read `pdf.getOptionalContentConfig().getGroups()` for names.
3. **Layers tab** in P2: per-layer visibility toggle (drives the raster via
   `page.render({ optionalContentConfigPromise })`) **and a separate
   "exclude from One-Click" toggle** driving the mask in `buildMask`.
4. Remember exclusions per project — furniture and dimension layers are named
   consistently within one architect's standards, so the second sheet inherits
   the first sheet's choices.

The hatch classifier stays as-is and remains the path for OCG-less sheets.
Where layers exist, this is deterministic and explainable where the classifier
is calibrated and opaque — and `?hatchqa` (the existing QA wall) gives a
ready-made place to compare the two on real sheets.

### P4 · Annotations layer — read, filter, import

1. `page.getAnnotations()` per sheet, cached into the P1 record.
2. **Annotations tab**: filter by subtype, author, date. Row → zoom to.
3. **Import as markups** — `FreeText`/`Text`/`Ink`/`Square` map cleanly onto
   the existing markup layer (`placeMarkup` in `TakeoffCanvas.jsx`), which is
   already excluded from counts. Low risk: markups never touch quantities.
4. **Import as shapes (opt-in, reviewed)** — `Polygon`/`PolyLine`/`Square`
   vertices → `verts_norm` → the existing commit path, stamped
   `origin.method = "pdf_annotation"` so `lib/provenance.js` tracks every
   correction, exactly as it does for machine-traced shapes. This must land
   behind the same **propose → review → Create** gate One-Click uses; it is
   someone else's measurement until the estimator accepts it.
5. **Addendum clouds** → a per-sheet change list, complementing
   `lib/revisionClouds.js`.
6. **Stamp detection** → a persistent banner when a sheet is stamped
   NOT FOR CONSTRUCTION.

### P5 · Op-list enrichment: color, dash, fill

Add stroke/fill RGB and dash state to the graphics-state tracking already in
`extractVectorGeometry` (it tracks line width; color and dash are the same
shape of change), emitting a per-segment color index and a dashed bit.

- **Filter linework by color** in the Layers tab — a poor man's layer panel for
  the flattened sheets where OCGs are gone, which is most of them.
- **Dashed-line exclusion** from the One-Click mask — removes a real leak class.
- **Solid-fill recovery** — `SEG_FILLONLY` paths that close could be traced
  directly to polygons with no flood at all, which is both faster and exact for
  poché'd rooms.

Order this after P3: same file, same walk, and if P3 lands first the meta
plumbing is already generalized.

### P6 · Document facts + measurement viewports

- Call `getMetadata`, `getPageLabels`, `getOutline`, `getPermissions` once per
  file; show them in the **Document** tab.
- Use `Producer`/`Creator` to *pre-route* One-Click (scanner ⇒ raster mask
  immediately) instead of discovering it from `imageFrac` after the fact.
- Use `getOutline` as the drawing index when present — it beats every heuristic
  in P1 and costs one call.
- Probe `/VP` `/Measure` via pdf-lib; when present, treat it as authoritative
  scale and resolve per-viewport, killing `detectScale`'s `multi` ambiguity.

### P7 · Push it through the exports and the MCP server

None of this is finished until it leaves the app the way everything else does:

- **xlsx** — a *Sheet Index* tab in `lib/xlsx.js` (the writer already does
  Summary / By-sheet / Materials / Shapes-audit; this is a fifth in the same
  shape).
- **CSV** — room list and text-search results, via `lib/csv.js`.
- **MCP** — the server already exposes `read_sheet_text` and `detect_rooms`.
  Add `sheet_index`, `find_text`, `list_layers`, `list_annotations`. Because
  P1's core is pure and pdfjs-free, `mcp/src/pdf.ts` gets these for the cost of
  the plumbing — the `detectRooms.ts` precedent exactly.
- **Agent tools** — the in-canvas agent's registry (`lib/agentTools.js`)
  should get the same reads. It currently squints at `read_sheet_text` capped
  at 600 items (`AGENT_TEXT_MAX_ITEMS`); a structured index is strictly better
  context for strictly fewer tokens.

---

## 4. Suggested sequence

| # | Work | Why here |
|---|---|---|
| 1 | **P1** sheet index + cache | Everything else reads it. Pays for itself by removing 4 redundant text fetches per sheet. |
| 2 | **P2** Plan Data panel, Sheets + Text + Rooms tabs | Turns P1 into visible value: cross-sheet Find and the bid-QA readout. |
| 3 | **P6** document facts | One call each, no new UI beyond a tab that already exists after P2. |
| 4 | **P4** annotations | Self-contained, no engine risk; markup import first, shape import behind the review gate. |
| 5 | **P3** OCG layers | Engine change. Needs the corpus probe first. |
| 6 | **P5** color/dash | Same file as P3; do them together if P3's probe comes back thin. |
| 7 | **P7** exports + MCP | Continuous — add each surface as its source lands. |

## 5. Risks and constraints

- **Perf on big sets.** A 200-sheet text layer is not free. Build lazily behind
  the existing `IntersectionObserver` pump, never eagerly on load, and keep the
  per-sheet record bounded (cap `text` tokens, drop the raw array from the
  persisted copy if it gets heavy — the search index can be a token/position
  digest rather than the full item list).
- **Memory.** Sheet records live alongside masks and snap grids, which are
  already the memory ceiling (`MASK_MAX_DIM`, `autoRenderScale`). Budget them
  in the same place, and evict with the same lifecycle.
- **Persistence versioning.** Use a `META_STORE` key, not a new object store —
  no `DB_VERSION` bump (`lib/store.js:23`). Sanitize on load like every other
  library (`sanitizeSheetLevels`, `sanitizeMaterialLibrary`) — a stale or
  corrupt index must degrade to "not indexed yet," never to a crash.
- **Extraction is not truth.** A title-block title, a room name, an imported
  annotation, a layer name — all are the *drafter's* claim. Everything here
  proposes; the estimator accepts. Keep the One-Click **propose → review →
  Create** gate for anything that becomes a shape, and keep
  `origin.method` / `lib/provenance.js` stamping so a machine-sourced quantity
  is always distinguishable from a drawn one.
- **Corpus first, heuristics second.** OCGs and `/Measure` viewports are worth
  a lot when present and worth nothing when absent, and this repo has exactly
  one bundled sample plan (`web/public/demo/`). Probe a real spread of sets
  before either P3 or the `/VP` work gets scheduled.
- **The privacy posture doesn't move.** Every item above is client-side pdf.js
  or pdf-lib. Nothing here needs the AI seam, the login gate, or the network —
  which is precisely why it should be built before more of the app leans on
  the paths that do.

## 6. Open questions

1. How often do real bid sets carry OCGs after the GC's platform re-publishes
   them? (Decides P3's priority outright.)
2. Do Bluebeam takeoff annotations survive the same round trip well enough to
   import quantities from, or only well enough to *display*?
3. Should the sheet index be per-project persisted state, or always rebuilt on
   load? Rebuild is simpler and always correct; persist is faster on a 200-sheet
   set. Measure before choosing.
4. Does cross-sheet Find want the full text layer persisted, or a digest? See
   the perf note above.

---

## 7. Prior art — the hosted-API pattern

There is now a commercial market for exactly the extraction this document
proposes: several vendors sell "construction PDFs in, normalized JSON out" as a
paid service. This section describes the *shape* of that offering, from public
product material, because the comparison sharpens our own choices. Vendors are
deliberately unnamed, and none of them publish what runs behind the endpoint —
so nothing here is a claim about anyone's internals, only about what the
category sells.

**The pattern is not a client-side technique.** It is an **async server-side
document-processing API**: create a project, upload the set (jobs measured in
gigabytes), poll or take a webhook, results in the tens of minutes. Billing is
per drawing sheet, in the vicinity of twenty cents. Every plan set leaves the
estimator's machine and is indexed on someone else's. That is the opposite of
this repo's posture, and the contrast is the most useful thing about it.

What the category returns:

| Sold capability | Our §3 equivalent | Deterministic in-browser? |
|---|---|---|
| **Sheet index** — number (`A101`), name (`FIRST FLOOR PLAN`), page, discipline, so the set becomes addressable; files auto-split to PDF + PNG | **P1**, near-exactly | **Yes**, on vector sheets — this is the text layer we already fetch and drop |
| **Drawing regions** — details, callouts, legends, schedules, plan views as discrete typed regions, each with a bounding box and extracted text, addressable as "detail 3 on M002" | no equivalent proposed | **Partly.** Region *typing* is layout detection — model work (§8.4). But region *bounds* on vector sheets are often recoverable from the linework and title text we already parse |
| **Schedules & specs** — door/equipment tables as tabular JSON; spec sections split by number and title and faceted (submittals / product data / execution) | `parseSchedule` (exists), marquee-scoped | **Yes for vector schedules** — we already do this, just gated behind a manual marquee instead of run over the whole sheet |
| **Citable artifacts** — sheet renders, region crops, markdown, so an agent can cite exact sources | partly, via MCP | **Yes** — rendering crops is what `rasterizeRegion` already does |
| **Semantic search over the set** — plain-language query, ranked hits with snippets and URIs, then fetch the exact evidence behind a hit | no equivalent | **Now yes** — see §8.6 |

Two framing ideas are worth adopting regardless of who sells them: extracted
text carries a **semantic type** (leader, note, dimension, title-block), and
the sheet set is treated as an **addressable index** — "detail 3 on M002" is a
resolvable address, not a search query. Both are cheap to design in and
awkward to retrofit.

**What this validates.** The category's own framing of the problem — teams
writing brittle OCR scripts, hand-cropping regions, and babysitting edge cases
— is the exact gap §1 identifies, and there is a price tag on closing it. The
thesis is not speculative.

**What it doesn't validate.** A large share of what gets billed per sheet is
deterministically extractable from the PDF's own text layer on a vector plan,
which is most of a modern bid set. The parts that genuinely need a model are
(a) anything on a scan and (b) region typing on drawings. So the honest read
is: *most* of the sheet-index and schedule value is reproducible here, in the
browser, at zero marginal cost and with nothing uploaded — and the remainder is
now partly reachable client-side too (§8).

---

## 8. Emerging client-side techniques worth tracking

The relevant change since this app's AI seam was designed around a *server*:
in-browser inference stopped being a demo. Transformers.js v3 shipped WebGPU
(reported up to ~100× over WASM), v4 cut bundle size ~53%; ONNX Runtime Web
runs the same models with a silent WebGPU→WASM fallback. That moves several
things this repo currently routes to a network endpoint into "runs on the
estimator's laptop, free, offline."

### 8.1 Other PDF engines — noted, not recommended

PDFium compiled to WASM (`@embedpdf/pdfium`, `pdfium.js`) and MuPDF WASM
(`mupdf.js`, MuPDF WebViewer) are both mature browser PDF engines with fuller
spec coverage than pdf.js in places — forms, annotations, and MuPDF's
structured-text/table extraction. **Do not swap the renderer.** pdf.js is load-
bearing across `TakeoffCanvas.jsx`, `oneclick.ts`, `sheets.ts`, and
`mcp/src/pdf.ts`, and every §3 proposal is reachable through it. The only
reason to reach for a WASM engine is a specific thing pdf.js won't expose —
`/VP` `/Measure` viewports (§2.6) being the candidate, and pdf-lib already
covers that more cheaply.

### 8.2 On-device OCR — the highest-leverage finding

Current in-browser options: **tesseract.js / tesseract-wasm** (lightest, strong
on clean multilingual documents, weak on distortion and handwriting);
**PaddleOCR PP-OCRv5** via ONNX Runtime Web (better on scene text and CJK,
WebGPU with WASM fallback); **docTR / OnnxTR** (purpose-built for scanned
documents and forms, configurable speed/accuracy); **TrOCR** (transformer,
hundreds of MB, single-line, reserve for handwriting). The consensus practice
is to start with the lightest engine that clears the accuracy bar and escalate
only on hard input.

**Why this matters here more than anywhere else on the list:** the schedule
scan path (`lib/scheduleScan.ts` → `/ai/parse-schedule`) is login-gated,
Google-configured, org-domain-restricted, network-dependent, and carries
bespoke 504 cold-start retry logic — all so a *scanned* schedule can be read.
But `parseSchedule` is already pure, already pdfjs-free, and already takes
`Token[] = {str, x, y, h}` **precisely so that either path can feed it** — the
module's own header says so. A local OCR that emits positioned tokens plugs
into that existing contract with **zero parser changes and zero new
abstraction**. The architecture anticipated this; the runtime just arrived.

That would give the scan path a free, offline, no-login default tier, with the
server reader demoted to the escalation for genuinely hard sheets. It also
removes the awkward failure mode documented at `TakeoffCanvas.jsx:3990` where
the only advice for an unreachable reader is "re-drag your box."

### 8.3 Small vision-language models in-browser

SmolVLM (256M / 500M / 2B, Apache-2.0, explicit transformers.js + WebGPU
support), Moondream 3, Florence-2. The existing BYO-AI seam (`lib/ai.js`,
`visionQuery`, first consumer *read scale with AI*) is already shaped as
"configure an endpoint" — a local WebGPU model is just another provider behind
the same interface, with no key and no network.

**Scope this narrowly.** Small VLMs are unreliable at reading precise small
text off a dense E-size sheet — which is exactly what a scale note or a
schedule cell is. Use them for **classification-shaped** questions where a
wrong answer is cheap and checkable: is this sheet a scan or vector? which
discipline? does this region look like a schedule? Leave *reading* to OCR
(§8.2) and to the deterministic text layer.

### 8.4 Document layout detection — the "regions" capability

DocLayout-YOLO (YOLOv10-based, ONNX exports published, deliberately
lightweight) is the open counterpart to the typed drawing regions of §7, and
is small enough to run under ONNX Runtime Web. **Caveat that decides it:** it
is trained on *documents* — text blocks, tables, headings, figures — not on
construction drawings, so detail bubbles, match lines, keynote legends, and
north arrows are out of distribution. Useful as-is for finding schedule tables
on a sheet (which would let "Import from schedule" stop requiring a manual
marquee); it would need fine-tuning on plan sheets for anything drawing-native.

Worth noting the repo already has the data seam for that: `capture/` banks
(geometry → label) rows from Contribute payloads. If drawing-region detection
is ever a goal, that pipeline is where the training set comes from.

### 8.5 WebGPU compute + workers for the geometry engine

`buildMask` / `floodRegion` / `buildRasterMask` are embarrassingly parallel
raster passes running in JS on the main thread, with `MASK_MAX_DIM = 3000`
chosen as a memory ceiling. Two separable upgrades:

- **Workers + OffscreenCanvas (no WebGPU needed).** Move raster-mask
  construction (adaptive threshold + morphological closing) off the main
  thread. This also addresses the class of problem AGENTS.md already documents
  — pdf.js schedules render work on `requestAnimationFrame` and pauses when
  the window is hidden.
- **WebGPU compute shaders** for the threshold/closing passes raise the
  `MASK_MAX_DIM` ceiling outright. Flood fill itself is sequential and is
  *not* a natural GPU port — don't chase that one.

Do the worker move first; it is most of the win for a fraction of the risk.

### 8.6 Local semantic search — the client-side answer to `source-search`

`sqlite-wasm` + `sqlite-vec` (~1.5 MB WASM) persisted on **OPFS** in a Web
Worker, with embeddings generated locally by transformers.js. That is
the hosted semantic search of §7 — ranked hits, snippets, jump-to-source —
with no upload, no per-sheet fee, and no vendor.

Sequencing matters: **P1 is the prerequisite.** Semantic search over a plan set
needs the indexed text first; embeddings are the layer above it, not a
replacement for it. And keyword Find (P1) is the feature estimators reach for
ten times a day — ship that before anything vector.

A secondary point: SQLite-on-OPFS is also a plausible future home for the sheet
index if IndexedDB's `META_STORE` proves thin at 200 sheets (§5). Big
architectural step; note it, don't take it yet.

### 8.7 Storage and ingest

**OPFS** for large derived artifacts (masks, renders, indexes) and the **File
System Access API** for opening a plan folder and holding the handle across
sessions — a natural extension of the zip-ingest path and its guardrails in
`lib/ingest.js`.

---

## 9. What this changes about §4

Nothing about the ordering — P1 is still first, and §7 makes the case louder:
there is a paid market for P1's output. Two additions:

- **After P1, the local-OCR swap (§8.2) jumps the queue** ahead of the heavier
  engine work. It is small, it uses a contract that already exists for this
  exact purpose, and it turns the app's most gated feature into an ungated one.
- **Adopt §7's two framing ideas in P1/P2 from the start**: semantic
  typing of extracted text, and treating the sheet set as an addressable index
  (`M002/detail-3`) rather than a search target. Both are free if designed in
  and awkward to retrofit.

Sources for §8: [Transformers.js WebGPU](https://huggingface.co/docs/transformers.js/en/guides/webgpu) ·
[on-device OCR comparison](https://lofttools.com/blog/on-device-ocr-reviewed/) ·
[DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO) ·
[SmolVLM](https://huggingface.co/blog/smolvlm) ·
[sqlite-vec in WASM](https://github.com/yangbooom/sqlite-wasm-vec) ·
[EmbedPDF PDFium](https://www.embedpdf.com/docs/pdfium/introduction) ·
[MuPDF WebViewer](https://webviewer.mupdf.com/) ·
[WebGPU compute](https://developer.chrome.com/docs/capabilities/web-apis/gpu-compute)
