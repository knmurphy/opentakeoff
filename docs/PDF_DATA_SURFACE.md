# PDF Data Surface — what we can read deterministically, and how to surface it

> **Status: RESEARCH, nothing built.** An inventory and a set of proposals, not
> a commitment. §§1–2 are the inventory and are the load-bearing part. §3's
> proposals and §4's ranking were **partly overturned** in review and carry
> inline markers where they were; **[`PDF_DATA_PLAN.md`](PDF_DATA_PLAN.md) is
> the authoritative ordering**, not §4. It exists so a feature can be picked off this
> list with the seams already named. Companion to
> [`FEATURES.md`](../FEATURES.md) (what exists) and
> [`docs/ESTIMATING_ROADMAP.md`](ESTIMATING_ROADMAP.md) (the pricing arc).

**Deterministic** here means: read straight out of the PDF by pdf.js or
pdf-lib, in the browser, with no model, no network, and the same answer every
time. That constraint is the point — everything below is free of the
login-gate, cost, and non-repeatability that the AI paths (`lib/ai.js`,
`/ai/parse-schedule`) carry. Where a proposal genuinely needs a model, it says
so.

## 0. Ground rules

Two constraints govern every proposal below. They are not preferences.

1. **No paid dependency, and no gate, in the default path.** A capability may
   not require a subscription, a metered API, a sign-in, an allow-listed email
   domain, or a key the user has to obtain. Anything that does is an *optional
   escalation* the app works without — and that a fork can delete without
   losing a feature.
2. **No plan bytes leave the browser, and no runtime dependency on a
   third-party origin.** `AGENTS.md` establishes "no backend, no database, no
   auth" — but that is not the same as offline. Until the webfont self-hosting
   change (PR #188), the rule did **not** hold: `tokens.css` `@import`ed five
   families from Google on every page load, so the app made a third-party
   request before a plan was opened. With that landed, the *font* violation is
   gone; there is still no service worker, so a cold load with no network
   fails. Treat the rule as binding on anything new — §8.0 is where it bites.

Where a proposal falls outside these rules it is marked **deferred**, not
scheduled.

---

## 1. The finding, in one paragraph

OpenTakeoff already parses a lot of a plan set deterministically — and then
**throws almost all of it away**. The page text layer is read at six call sites
and cached at none of them: **four** fire automatically — the gallery thumbnail
pump (guarded on missing metadata), the panel render, the lead-page label read,
and the per-file label scan — and between them keep only the sheet number and
the scale note; the remaining **two** are user-triggered region reads. Any one
sheet sees up to three of the automatic four. Nothing is indexed and nothing is
reused. The vector op-list walk composes the full CTM and visits
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
| `str` + `transform` | ✅ but transiently | `extractSheetNumber`, `detectScale` (`lib/sheets.ts`), `extractRegionText` → `parseSchedule`, `roomLabelSeeds` (`lib/detectRooms.ts` — **MCP only**; see §4) |
| `height` / cap height | ✅ | `Token.h` for row clustering in `scheduleParse.ts` |
| `width` | ❌ | glyph-run width — would give real text bounding boxes for hit-testing and highlight rects |
| `fontName` / `styles` | ❌ | font identity separates title-block text from drawing annotation from dimension strings, deterministically |
| `dir`, `hasEOL` | ❌ | RTL and line-break hints |
| marked content | ❌ | section boundaries only — **not** layer identity: on the text path pdf.js resolves `id` from `/MCID` alone and reports `tag: "OC"` with no group, so layer-attributed *text* is reachable only through the op list (§2.2) |

**Not cached anywhere.** `PlanNavigator.jsx:225`, `TakeoffCanvas.jsx:1205`,
`:1216`, `:1232`, `:3714`, `:3965` each re-fetch. On a 200-sheet bid set that
is real repeated work, and it means no feature can assume the text is
available cheaply — which is why none of them exist.

### 2.2 Vector op list (`page.getOperatorList()`)

`extractVectorGeometry` (`lib/oneclick.ts:105`) walks the stream with correct
save/restore/transform/form-XObject matrix composition and emits
`{ points, segs, meta, imageArea }`. It consumes `save`, `restore`,
`transform`, `setLineWidth`, `setGState` (`LW` only), the form-XObject pair,
all seven image-paint ops, and `constructPath`. Per segment it keeps 3 flag bits
(`SEG_CURVE`, `SEG_CLIP`, `SEG_FILLONLY`) and a 4-bit device line width.

What the same walk is standing on but ignores:

| Op | What it carries | Why a takeoff tool wants it |
|---|---|---|
| `setStrokeRGBColor` / `setFillRGBColor` (+ `setGState`) | per-path RGB | On plotted sheets, **color is the encoding**: red = demo, gray/screened = existing-to-remain, black = new work. Filtering linework by color is a first-class estimator gesture, and a color-aware mask stops One-Click from being bounded by furniture or dimension lines. |
| `setDash` | dash array | Dashed = hidden / above-ceiling / below-slab. A mask that ignores dashed paths removes a known class of false walls; a "dashed only" view is how you find soffits. |
| `beginMarkedContentProps` / `endMarkedContent` | optional-content (layer) membership | See §2.4 — the biggest unlock, and trickier than it looks. |
| `showText` positions | glyph runs in the op stream | Text already can't block a fill (it's `showText`, not `constructPath`), but knowing *where* text sits lets the raster mask (`lib/rastermask.ts`) exclude it too, which is exactly where the scan path leaks today. |
| `constructPath` fill winding | `fill` vs `eoFill` | Both collapse into the single `SEG_FILLONLY` bit, so the winding rule is discarded before it reaches `meta` — solid poché regions could be recovered as polygons directly, no flood needed. |

All of these are additive to a walk that already exists and already gets the
transforms right. This is the cheapest engine work on the list per unit of
capability.

### 2.3 Document-level APIs we never call

Every one of these is a single `await` on the `PDFDocumentProxy` we already
hold (`docFor` in `TakeoffCanvas.jsx`, passed to the gallery as `getDoc`, `openPdf` in `mcp/src/pdf.ts`):

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
| `page.getStructTree()` (page-level, not document) | tagged-PDF structure | Almost never present on CAD output. Low priority, note it and move on. |

### 2.4 Optional content groups — the layers

CAD publishers export AutoCAD/Revit layers as PDF **optional content groups**,
named exactly as the drafter named them: `A-FLOR-PATT`, `A-WALL-FULL`,
`A-DOOR`, `I-FURN`, `A-ANNO-DIMS`, `M-DUCT`. pdf.js exposes this in two halves
that we currently use neither of:

1. `pdf.getOptionalContentConfig()` → `.getGroups()` gives id → `{ name, intent }`,
   and the config object carries the document's default visibility.
2. In the op list, content is bracketed by
   `OPS.beginMarkedContentProps` … `OPS.endMarkedContent`. **The arg shape is
   more involved than it looks** (verified against 4.10.38): gate on
   `args[0] === "OC"`, because the same op carries `[tagName, MCID]` for
   ordinary tags. `args[1]` is then `{type: "OCG", id}` **or**
   `{type: "OCMD", ids, policy}` for several groups at once, **or**
   `{type: "OCMD", expression}` for a `/VE` boolean visibility expression (that
   branch carries no `ids` and no `policy`), **or** `null`. Tracking a stack of
   these does attribute segments to layers, but it is not a
   one-byte-per-segment addition, and a naive string compare on `args[1]`
   silently attributes nothing. `getGroups()` also returns **`null`**, not
   `{}`, on a document with no OCGs.
3. `page.render({ optionalContentConfigPromise })` makes the *raster* honor a
   modified config, so show/hide is free on the render side too.

Why this matters more than anything else on the list: One-Click's whole
difficulty is deciding which linework is a boundary. The hatch classifier
(`classifyHatchSegs`, ~100 lines of calibrated heuristics with a
three-tier escalation and a sensitivity knob) exists to *infer* something the
PDF often states outright — this path is on layer `A-FLOR-PATT`. When OCGs are
present, "exclude these layers from the mask" is a deterministic, explainable
replacement for a heuristic whose own source admits its "constants
above are calibrated on one sheet/one CAD style; other plans hatch differently"
(`oneclick.ts:74`). The heuristic stays as the fallback for sheets with no OCGs
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

pdf.js has no public API for `/VP` (confirmed: no `/Measure` handling anywhere
in the 4.10.38 worker, and it never exposes the raw page dictionary).
**pdf-lib is already a dependency** (`lib/ingest.js`, `lib/markedset.js`) and
can walk the page dictionary directly: `page.node.lookup(PDFName.of('VP'),
PDFArray)` → `.lookup(i, PDFDict)` → `.lookup(PDFName.of('Measure'), PDFDict)`.
Read **`/R`** — the human-readable scale-ratio string, the entry a takeoff tool
most wants — and **`/Y`** for non-uniform axes, not just `/X`, `/D`, `/A`.

Two costs the API shape hides: pdf-lib 1.17.1 **cannot decrypt**, and
permission-encrypted PDFs are common off GC platforms — `ignoreEncryption:
true` skips decryption rather than performing it, so numbers survive while
`/R` and the unit labels come back as ciphertext. And this is a **full second
parse of the file** on top of pdf.js, not the free read that "already a
dependency" suggests. When present, `/Measure` beats `detectScale`'s note-matching outright
— and it's per-viewport, so a sheet with a plan at 1/8" and a detail at 1/2"
resolves *both*. Two things to get right about the existing behaviour:
`detectScale` sets `multi: true` only on the branch that **succeeds** (a
title-block hit) — the give-up branch returns `null` and carries no flag at all
— and `multi` **is** consumed: it drives a `±` badge and a "this sheet shows
several scales … confirm against a known dimension" tooltip on the adopt-scale
affordance (`TakeoffCanvas.jsx:4682-4683`). So the multi-scale case is already
surfaced, if thinly. `/Measure` would *resolve* it rather than warn about it.

**Probe before building.** Verify emission rates across a real corpus; if it's
rare, it's a cheap opportunistic upgrade, not a feature.

### 2.7 Sheet-level facts we can already derive but don't expose

- **Vector vs. scan.** `sheetStatsRef` already holds `{ segCount, imageFrac }`
  per sheet (`TakeoffCanvas.jsx:1192`) — used only to route One-Click. Show it:
  "12 of 84 sheets are scans" is a bid-planning fact.
- **Page geometry.** `page.view`, `.rotate`, `.userUnit` → real sheet size
  (ARCH D, ANSI E, 30×42) and rotation. Sheet size is a sanity check on scale:
  a 1/8" plan on a half-size print is the classic 2× error the Check-a-dimension
  feature (`K`) exists to catch.
- **Scale disagreement.** `detectScale` computes `multi` and already warns with
  it (§2.6), but discards *which* scales it saw and where. The warning says
  "several scales here"; it can't say "1/8\" in the title block, 1/2\" under the
  detail — which is the plan view?" Keeping the list is the upgrade, not the
  warning itself.

---

## 3. Proposals — surfacing and filtering, ranked

> **Partly superseded** — see §4. In particular **P2's docked panel was
> rejected outright** (every tab has an existing owner) and **P1 was displaced
> from first place** by work that needs no new extraction. The *inventory* each
> proposal rests on is still sound; the packaging and the ordering are not.

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

**Cache seam.** In-memory ref keyed by sheet key for the session.
*Superseded on persistence* — see `PDF_DATA_PLAN.md` T10: the stamp-library key
this originally cited is **browser-global by design**, which is wrong for a
per-project index keyed on filenames that collide across projects, and the
existing `metaGet`/`metaPut` (`store.js:348-358`) are what a persisted version
should use. Persistence is deferred until the in-memory build is measured.

**Build trigger.** ⚠️ **Superseded — this does not work.** The original idea was
to piggyback the gallery thumbnail pump, which already walks sheets lazily and
already calls `getTextContent()`. It cannot build a whole-set index: the pump
`continue`s past any key already in `thumbCacheRef` (canvas-owned and
"survives gallery close", so a second open indexes nothing), gates the text read
on `!labels[key] || !detectedScales[key]`, and only enqueues keys without
thumbnails. See `PDF_DATA_PLAN.md` T6, which replaces it with a standalone
indexing job carrying a completeness state.

Unlocks, immediately:

- **Cross-sheet Find (`⌘F` / `/`)** — search all sheet text, results grouped by
  sheet, click to open and zoom-to-hit with a highlight rect. This is the
  single most-missed feature in any plan viewer and we already have the data.
- **A real drawing list** — the gallery shows `A-101 · FIRST FLOOR PLAN`
  instead of a file stem (`labelOf` in `PlanNavigator.jsx:254`), sorted by
  sheet number, filterable by discipline.
- **Auto-levels** — `sheet_levels` is set today by a `window.prompt`
  (`PlanNavigator.jsx:267`). Propose levels from the title text and let the
  user confirm; feeds `groupSheetsByLevel` (`lib/sheetLevels.js`) unchanged.
- **Room list per sheet** — `roomLabelSeeds` already finds the numbers; pair
  each with the nearest larger text run to get `104 · CORRIDOR`. Filterable,
  and every row is a one-click seed for the existing flood
  (`detectRegions`) — "detect all corridors" becomes a real gesture.

### P2 · A "Plan Data" panel — ⚠️ **REJECTED, do not build**

> Kept for the reasoning about *what data wants surfacing*; the packaging is
> wrong. The app already has six rail buttons and nine surfaces, and every tab
> below has an existing owner — see `PDF_DATA_PLAN.md` "Not doing". Where P3,
> P4 and P6 say "a tab in P2", read "the surface named in the plan".

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

1. Track the marked-content brackets — **not** the `("OC", id)` shape written
   here originally; see §2.4 for the real arg shapes — in
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
is calibrated and opaque. Note there is **no** `?hatchqa` QA wall to compare
them on — it is described in `FEATURES.md` and `CHANGELOG.md` but was never
shipped here, so building a comparison venue is itself a task.

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
  `Conditions` / `By sheet` / `Materials` / `Shapes`; this is a fifth in the same
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

> **Superseded.** The ordering below was the research draft's, and adversarial
> review overturned it. The scheduled ordering now lives in
> [`PDF_DATA_PLAN.md`](PDF_DATA_PLAN.md); this table is kept only to record
> what changed and why.

| # | Work | Why here |
|---|---|---|
| 1 | **P1** sheet index + cache | Everything else reads it. |
| 2 | **P2** Plan Data panel, Sheets + Text + Rooms tabs | Turns P1 into visible value. |
| 3 | **P6** document facts | One call each. |
| 4 | **P4** annotations | Self-contained, no engine risk. |
| 5 | **P3** OCG layers | Engine change. Needs the corpus probe first. |
| 6 | **P5** color/dash | Same file as P3. |
| 7 | **P7** exports + MCP | Continuous. |

**What review changed:**

1. **Ship what already exists first.** `lib/detectRooms.ts` is a complete,
   tested batch room detector whose only importers are `mcp/src/session.ts` and
   its own test — **nothing in `web/src` calls it**. The app batch-traces a
   finish plan for an agent and not for the estimator. Wiring it to a toolbar
   button beats every proposal in §3 on value per hour of work, and it needs no
   new extraction at all.
2. **The join is the product.** Room labels (§3, P1) and finish schedules
   (`parseSchedule`, shipped) are both text on a vector sheet, and nothing
   connects them. That join auto-assigns conditions and turns coverage from a
   sheet count into a room list. It was absent from the research entirely.
3. **P2's panel is the wrong shape.** The app already has six rail buttons and
   nine surfaces; every tab proposed has an existing owner. Coverage in
   particular belongs as an on-canvas overlay, not a table — the unit an
   estimator misses is a room, not a sheet.
4. **The cache is a coordinate-space decision, not a refactor.** Of the six
   text call sites, two use per-sheet render scales and pass absolute-px rects,
   and `parseSchedule`'s row clustering has an absolute 4px floor — so a cache
   keyed on sheet alone is silently wrong for exactly the consumers that
   matter. It has to be settled *before* the index is written, not after.

Also unproposed and larger than anything in §3: a **sheet-to-sheet drawing diff
for addenda**. `lib/snapshotDiff.js` states outright that its diff is
"QUANTITY-LEVEL, deliberately NOT geometric," and the user guide concedes the
compare "won't show you which wall moved."

## 5. Risks and constraints

- **Perf on big sets.** A 200-sheet text layer is not free. Build lazily and never
  eagerly on load — though **not** off the gallery's `IntersectionObserver`
  pump, which cannot cover a whole set (§3/P1, `PDF_DATA_PLAN.md` T6) — and keep
  the per-sheet record bounded (cap `text` tokens, drop the raw array from the
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
  before either is scheduled — that probe is `PDF_DATA_PLAN.md` T1, and its
  verdict is what gates them.
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

Two framing ideas looked worth adopting: extracted text carrying a **semantic
type** (leader, note, dimension, title-block), and the sheet set treated as an
**addressable index** — "detail 3 on M002" as a resolvable address rather than a
search query. ⚠️ **Both were subsequently cut.** "Cheap to design in and awkward
to retrofit" is the signature of speculative generality, and nothing in the plan
consumes either. Build them when something needs them.

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
support and v4 trimmed bundles; ONNX Runtime Web runs the same models with a
silent WebGPU→WASM fallback. **Treat the headline numbers as marketing, not
planning inputs:** the "up to 100× faster than WASM" bullet ships with no
hardware, model, task, or methodology, and the "53% smaller" figure applies
specifically to the `transformers.web.js` default export — averaged across all
builds the reduction was ~10%. That moves several
things this repo currently routes to a network endpoint into "runs on the
estimator's laptop, free, offline."

Read this section against §0. "Free" here means free of per-use billing. It
does **not** mean free of a network call (§8.0), and it emphatically does
**not** mean the licences are compatible: **MuPDF/mupdf.js is
AGPL-3.0-or-commercial** (§8.1), **DocLayout-YOLO inherits AGPL-3.0** from the
YOLOv10/Ultralytics lineage (§8.4), and **Moondream 3 is BSL 1.1** (§8.3) —
none redistributable under this repo's Apache-2.0. Licences vary per engine
*and* per weight file and are not asserted here: each is verified where it is
scheduled, and recorded in `THIRD-PARTY-NOTICES.md`.

### 8.0 The cost that is not money — weights, and where they come from

Model-backed capabilities cost **megabytes**, not dollars, and the megabytes
arrive over the wire:

| Thing | Rough size | Licence |
|---|---|---|
| tesseract.js — SIMD core + English traineddata | **~5 MB** (`_fast` traineddata 1.89 MB) to **~14 MB** (standard 10.4 MB), plus a 3.3 MB core. *An earlier "~60 MB" here was unsourced and 4–12× too high — that figure only appears if you count the whole unpacked npm core package, which ships four wasm variants.* | Apache-2.0 |
| PaddleOCR det + rec | `en_PP-OCRv5_mobile_rec` **7.5 MB**, `PP-OCRv5_mobile_det` **4.7 MB** — but `PP-OCRv5_server_det` is **84 MB** in the *official* list. The hazard isn't flaky third-party repos: det and rec each ship **mobile and server** variants and the family name doesn't say which. Multilingual rec is 16 MB. These are Paddle inference-model sizes, not ONNX-export sizes. | Apache-2.0 (code) — **verify each ONNX re-export separately; several hub exports declare no licence at all, which disqualifies them** |
| Sentence-embedding model, quantized | ~20–100 MB | varies — check the model card |
| Small VLMs (256M–500M, quantized) | hundreds of MB | varies |

**The trap:** by default these libraries fetch weights *and* their `.wasm`
binaries from a third-party CDN on first use. No plan data goes anywhere — the
transfer is weights coming down, never sheet bytes going up — but it is still a
third-party request from an app whose whole claim is that nothing leaves the
browser, and it breaks on a jobsite with no signal.

**So it is a hard requirement, not a follow-up:** weights and wasm ship as
static assets from the app's own origin.

But "self-host the weights" is **not** an offline guarantee by itself — weights
are one item on a list of six, and the knobs differ per engine:

- *transformers.js / ORT:* `env.localModelPath`, `env.allowRemoteModels = false`,
  **and `env.allowLocalModels = true`** — which defaults to **`false` in
  browsers**, so setting only the first two yields a client that can load
  nothing. `env.backends.onnx.wasm.wasmPaths` takes an object `{mjs, wasm}` in
  v4, not a bare string prefix. ORT ships several wasm variants (simd /
  threaded / jsep) and selects at runtime, so vendor every one it may reach —
  plus the HF directory layout (`config.json`, `tokenizer.json`,
  `tokenizer_config.json`, `special_tokens_map.json`,
  `preprocessor_config.json`) and the `dtype`-suffixed `.onnx` filenames.
- *tesseract.js:* has **none** of those settings. Its surface is `workerPath`
  (it fetches `worker.min.js` from a CDN and runs it as a blob worker),
  `corePath` (several wasm variants chosen at runtime by SIMD/threads
  capability), and `langPath` + `gzip` (traineddata defaults to a third-party
  host). Three separate origins' worth of fetches.
- *PaddleOCR:* the recogniser is useless without its **character dictionary**,
  a separate file with its own provenance.

The only testable form of the requirement: *with the network offline after
first load and a filter for any origin other than `self`, running the feature
produces zero non-self requests.*

**Threading is off the table.** `web/public/_headers` sets no COOP/COEP, so
`SharedArrayBuffer` is unavailable and every engine runs single-threaded — and
the headers can't simply be added, because `require-corp` breaks the Google
sign-in iframe and the cross-origin webfonts. Benchmark accordingly.

And be honest about the meter: self-hosting doesn't remove it, it **moves it**
from the user's key to the deployer's bandwidth bill. `README.md` promises "No
paid dependencies," and that has to stay true for a fork.

**And they load lazily.** `lib/ingest.js` already sets the precedent verbatim —
fflate and pdf-lib load "only when a user actually drops a zip or image — so
they never weigh down the initial page load." Same rule: OCR weights load the
first time someone marquees a scanned schedule, never before. An estimator who
only ever opens vector plans downloads nothing.

Verify the licence on the *weights* separately from the licence on the *code*;
they are frequently different.

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

### 8.2 On-device OCR — real, cheaper than first claimed, and deferred

Current in-browser options: **tesseract.js / tesseract-wasm** (lightest, strong
on clean multilingual documents, weak on distortion and handwriting);
**PaddleOCR PP-OCRv5** via ONNX Runtime Web (better on scene text and CJK,
WebGPU with WASM fallback); **docTR / OnnxTR** (purpose-built for scanned
documents and forms, configurable speed/accuracy); **TrOCR** (transformer,
hundreds of MB, single-line, reserve for handwriting). The consensus practice
is to start with the lightest engine that clears the accuracy bar and escalate
only on hard input.

**Why it matters, restated after review.** Not because reading scanned
schedules is a common need — it isn't; One-Click already handles scanned
*plans*, and scanned *schedules* are a minority of a minority. It matters
because the schedule
scan path (`lib/scheduleScan.ts` → `/ai/parse-schedule`) is login-gated,
Google-configured, org-domain-restricted, network-dependent, and carries
bespoke 504 cold-start retry logic — all so a *scanned* schedule can be read.
But `parseSchedule` is already pure, already pdfjs-free, and already takes
`Token[] = {str, x, y, h}` **precisely so that either path can feed it** — the
module's own header says so. A local OCR that emits positioned tokens plugs
into that existing contract with **no new abstraction**.

One caveat, since this section originally overstated it: it is not *zero* work.
`parseSchedule` clusters rows on `max(t.h * 0.6, 4)` where `h` is pdf.js **cap
height**, while OCR engines report bounding-box height including descenders — so
that constant needs a fixture pass against real scanned schedules. And
`scheduleParse.ts`'s own header anticipates "a **server** OCR/VLM adapter," not
a local engine. The seam is right; the calibration is real work.

That would give the scan path a free, offline, no-login default tier, with the
server reader demoted to the escalation for genuinely hard sheets. It also
removes the awkward failure mode documented at `TakeoffCanvas.jsx:3983-3984` where
the only advice for an unreachable reader is "re-drag your box."

### 8.3 Small vision-language models in-browser — **deferred**

SmolVLM (256M/500M/2B, Apache-2.0, explicit transformers.js + WebGPU support),
Moondream 3, and Florence-2 all run in a browser, and the BYO-AI seam
(`lib/ai.js`, `visionQuery`) is already shaped to take another provider.

**Not scheduled, for two reasons.** Hundreds of megabytes of weights is a poor
trade against §8.0 for what it buys; and small VLMs are unreliable at reading
precise small text off a dense E-size sheet, which is exactly what a scale note
or a schedule cell is. If they are ever revisited it should be for
**classification-shaped** questions where a wrong answer is cheap and checkable
(scan or vector? which discipline? does this region look like a schedule?),
never for reading. Reading belongs to OCR (§8.2) and to the deterministic text
layer.

### 8.4 Document layout detection — the "regions" capability — **deferred**

DocLayout-YOLO (YOLOv10-based; note the official repo ships only PyTorch
weights — ONNX exists solely as third-party re-exports) is the open counterpart to the typed drawing regions of §7, and
is small enough to run under ONNX Runtime Web. **Two caveats, either of which decides it.**
Its YOLOv10/Ultralytics lineage is **AGPL-3.0**, incompatible with Apache-2.0
redistribution — a licence bar, not a fit bar, and one no amount of fine-tuning
clears. And it is trained on *documents* — text blocks, tables, headings, figures — not on
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

### 8.6 Local semantic search — the client-side answer to §7's hosted search

`sqlite-wasm` + `sqlite-vec` (measured 1.48 MB WASM for the combined
statically-linked build) persisted on **OPFS** in a Web Worker — via the
**`opfs-sahpool` VFS**, because SQLite's default `opfs` VFS requires the
cross-origin isolation this deployment cannot set, with embeddings generated locally by transformers.js. That is
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

## 9. What §§7–8 change about the ordering

Two points survive the reordering (§4):

- **Local OCR is worth doing, but not for the reason first given.** It is not a
  scan-reading feature — One-Click already handles scanned *plans* via
  `rastermask.ts`, and scanned *schedules* specifically are a minority of a
  minority. Its real value is deleting a sign-in gate, an org-domain
  restriction, a serverless function and its retry logic — a §0 and
  repo-health win, not minutes saved per bid. It is deferred behind the room
  work and split in two, and its cost is *lower* than §8.0 first claimed.
- **§7's framing ideas did not survive.** Semantic text typing and an
  addressable sheet index were proposed as "cheap now, awkward to retrofit" —
  which is the signature of speculative generality. Nothing in the plan
  consumes either. Build them when something needs them.

Sources for §8: [Transformers.js WebGPU](https://huggingface.co/docs/transformers.js/en/guides/webgpu) ·
[on-device OCR comparison](https://lofttools.com/blog/on-device-ocr-reviewed/) ·
[DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO) ·
[SmolVLM](https://huggingface.co/blog/smolvlm) ·
[sqlite-vec in WASM](https://github.com/yangbooom/sqlite-wasm-vec) ·
[EmbedPDF PDFium](https://www.embedpdf.com/docs/pdfium/introduction) ·
[MuPDF WebViewer](https://webviewer.mupdf.com/) ·
[WebGPU compute](https://developer.chrome.com/docs/capabilities/web-apis/gpu-compute)
