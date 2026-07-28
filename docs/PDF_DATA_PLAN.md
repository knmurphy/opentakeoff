# PDF Data — the build plan

The scheduled work derived from [`PDF_DATA_SURFACE.md`](PDF_DATA_SURFACE.md).
That document is the research and the *why*; this one is the ordered backlog
and the *what*, sized so each task is a single reviewable PR.

## Ground rules (from `PDF_DATA_SURFACE.md` §0)

1. **No paid dependency, and no gate, in the default path.** No subscription,
   no metered API, no sign-in, no allow-listed domain, no user-supplied key.
   Anything that needs one is an optional escalation the app works without —
   and that a fork can delete without losing a feature.
2. **No plan bytes leave the browser, and no runtime dependency on a
   third-party origin.** Note this is an *aspiration with a known live
   violation*: `web/src/styles/tokens.css:3` `@import`s five webfont families
   from Google on every page load. Until that is fixed (see
   [Repo drift](#repo-drift--separate-prs)) the app does not clear its own bar,
   and no task here may cite the rule as though it already holds.

## Definition of done — every task

- Branch first, never commit on `main` (`AGENTS.md`).
- `cd web && npm run check` green — typecheck, **lint**, test, build.
  **This is not identical to CI.** `.github/workflows/ci.yml` runs typecheck,
  test and build (no lint) for `web`, *plus* an `mcp` job on Ubuntu **and**
  Windows (typecheck/test/build/`smoke:dist`) and a `capture` job
  (`python3 capture/capture_server.py selftest`). Touching `mcp/` or
  `capture/` means running those locally too — a green `npm run check` does
  not predict them.
- New pure logic has `node:test` coverage in `web/test/`, following the
  `geometry.test.ts` / `totals.test.ts` / `scheduleParse.test.ts` precedent.
- Exercised by hand against the bundled sample plan (`web/public/demo/`) —
  Vite does not flag undefined identifiers in JSX, so load the app before
  calling it done.
- Docs synced where behavior changed: `README.md`, `docs/USER_GUIDE.md`,
  `CHANGELOG.md`, and the capability row in `FEATURES.md`.
- **Any bundled third-party binary** (weights, wasm, tokenizers, character
  dictionaries) is recorded in `THIRD-PARTY-NOTICES.md` under a *Bundled binary
  artifacts* section with filename, upstream URL, exact version/commit,
  SHA-256, licence, and where the licence text lives in `dist/`. Upstream
  NOTICE content is appended to `NOTICE`. Re-exported or quantised artifacts
  are marked as modified. **An artifact with no declared licence is
  disqualified** — not a judgement call.
- No new dependency without a note on why an existing one won't do.
  `pdfjs-dist@4.10.38`, `pdf-lib@1.17.1` and `fflate` are already present and
  cover most of this plan.

Sizes: **S** ≈ a sitting · **M** ≈ a day · **L** ≈ multi-day · **XL** ≈ break it up.

---

## M0 — Probe first

### T1 · Corpus probe · S
**Goal.** Know what real bid sets contain before scheduling work that assumes it.
**Do.** A **throwaway script** (not an app route — `web/src/main.jsx` has two
routes and adding a dev-only third needs a build-time gate that isn't worth it).
Report per file and page: optional-content groups and names; annotation
subtypes with counts; presence of outline, page labels, permissions;
`Producer`/`Creator`; presence of `/VP` `/Measure`; text-item count; `segCount`
and `imageFrac`.
**Privacy.** The committed CSV carries **counts and enum values only** — no
`Title`, no outline text, no file paths, `Producer`/`Creator` normalised to the
product family. Real bid sets carry client names and architect file paths in
exactly these fields.
**Acceptance.** Results table in the PR description, and a one-line verdict on
T15 and T17: schedule, defer, or drop.
**Ships?** No.

---

## M1 — Ship the engine that already exists

The highest-value work in this plan needs no new extraction at all.

### T2 · Wire Detect Rooms into the canvas · S
**Goal.** Give the human the batch room detection the MCP server already has.
**The finding.** `web/src/lib/detectRooms.ts` is complete and tested.
Its only importers are `mcp/src/session.ts:15` and its own test — **nothing in
`web/src` calls it.** The app can batch-trace a finish plan for an agent and
not for the estimator.
**Do.** A toolbar action on the active sheet: `roomLabelSeeds` over the page
text → `detectRegions` against the existing mask → `traceRegion` → the existing
**propose → review → Create** gate. No new engine, no new math.
**Acceptance.** On the sample plan, one action proposes multiple rooms; accept
and reject individually; quantities match a manual One-Click of the same room.
**Depends on.** Nothing.

### T3 · Room label ↔ finish-schedule join · L
**Goal.** One-Click a room and land on the correct condition automatically.
**Why.** The app parses finish schedules into typed rows and (after T2) reads
room labels off the plan. Nothing connects them — and that cross-reference is
the estimator's afternoon.
**Note.** The room finish schedule (ROOM NO | NAME | FLOOR | BASE | WALL) is a
**different table** from the material legend `scheduleParse.ts` handles today
(which keys on FLOORING/BASE/WALLS section headers). This is a second parser,
not a tweak.
**Unlocks.** Auto-assigned conditions; a real coverage answer ("the schedule
lists 84 rooms with a floor finish, you have shapes over 71"); and a finish code
with zero rooms on the plan as a flagged discrepancy — an RFI found before bid
day.
**Tests.** `web/test/roomSchedule.test.ts` — parser and join, both pure.
**Depends on.** T2.

---

## M2 — The index

### T4 · `textFor(key)` — one cache, one declared coordinate space · M
**Goal.** Fetch each page's text once, in a space every consumer agrees on.
**This is the load-bearing decision, which is why it is first.** The six
existing call sites do **not** share a space. Four
(`PlanNavigator.jsx:225`, `TakeoffCanvas.jsx:1205`, `:1216`, `:1232`) use
`RENDER_SCALE` or a panel viewport and compare against page fractions, so they
are scale-insensitive. Two (`:3714` `agentTextTokens`, `:3965`
`importScheduleFromRect`) use per-sheet `renderScalesRef` and pass **absolute-px
rects**. `autoRenderScale` caps below `RENDER_SCALE` for oversized pages — which
an ingested image always is — and `hiResKeys` changes it mid-session.
It is not only x/y: `parseSchedule` clusters rows on `max(t.h * 0.6, 4)`
(`scheduleParse.ts:65`), and that absolute 4px floor means the same schedule
parses differently at `rs=1.0` and `rs=2.0`.
**Do.** A promise cache keyed on **`(sheetKey, renderScale)`**, returning tokens
in a documented space. Route all six sites through it.
**Acceptance.** A counter asserted in test shows one parse per `(key, rs)`;
schedule import produces byte-identical rows before and after on a fixture.
("Measurably fewer parses" is not a criterion — add the counter or drop the
claim.)
**Depends on.** Nothing. **Do not start T5 until this lands.**

### T5 · `lib/sheetIndex.ts` — the pure core · M
**Scope.** Sheet title; discipline class from the number prefix; level
inference; room number ↔ name pairing — **reusing `ROOM_LABEL_RE` and
`roomLabelSeeds` from `detectRooms.ts`**, never a second definition of "room
label."
**Out of scope.** pdf.js, DOM, caching, UI.
**Tests.** `web/test/sheetIndex.test.ts`.
**Depends on.** T4 (for the coordinate contract).

### T6 · Set-indexing job · M
**Goal.** Index a whole set, and know when it is complete.
**Why this is its own task.** The obvious move — hanging it off the gallery
thumbnail pump — cannot work: the pump `continue`s past any key already in
`thumbCacheRef` — which is canvas-owned and survives gallery close, so a second
open indexes **nothing** — it gates the text read on `!labels[key] ||
!detectedScales[key]`, and the observer only enqueues keys without thumbnails.
On a 200-sheet set that indexes the cards in the viewport. It also shares its
cancellation token with the enumerate effect, so adding a PDF aborts the
in-flight pump mid-queue (it does get re-invoked when new cards intersect, so
this is a stall and a reordering rather than a permanent stop).
**Do.** A standalone job with its own queue, progress, cancellation, and a
per-file `indexed: complete | partial | none` state. **Must survive the
navigator unmounting.** In-memory only — no IndexedDB (see T10).
**Memory.** This would be the first long-lived unbounded per-sheet structure in
the app; existing caches (`maskCacheRef`, `snapGridsRef`, `vectorSegsRef`) are
cleared wholesale on group change and bounded to ≤4 sheets. Cap tokens or store
a digest, and **instrument it** — the acceptance criterion is a measured
200-sheet heap and wall-clock number in the PR.
**Acceptance.** Completeness state is correct after: first open, second open,
adding a file mid-index, and closing the gallery mid-index.
**Depends on.** T4, T5.

### T7 · Gallery shows real sheet identity · S
`A-101 · FIRST FLOOR PLAN`, sheet-number sort, discipline filter. Extends
`labelOf` (`PlanNavigator.jsx:254`); keep `sortGalleryGroups`' per-group
ordering rule intact — it fixed a real churn bug.
**Ship this immediately after T6** — it is the smallest thing that makes the
index visible to a user, it is used every time a sheet is opened, and it is a
better smoke test for "is the index complete?" than Find is.
**Depends on.** T6.

### T8 · Cross-sheet Find · M
`⌘F` / `/` over indexed text, results grouped by sheet, click to open + zoom +
highlight.
**Reuse, don't reinvent:** the deep-jump machinery at `TakeoffCanvas.jsx:1373`
(`wantSheetRef`) and the phase-2 `pendingFlyRef` at `:1384` already do
open-then-fly, and the render effect resets `poly`/`proposal`/`zone` and the
transform on arrival. Respect `menuDepthRef`.
**Honesty requirement.** Must show T6's completeness state — a partial index
returning "no matches" is a silent lie, which is worse than no feature.
**Acceptance.** A **multi-file** fixture, not the single-file sample: a
criterion satisfiable by searching only the active sheet tests nothing.
**Depends on.** T6.

### T9 · Auto-level proposals · S
Replace the `window.prompt` with proposed levels the user confirms;
`groupSheetsByLevel` unchanged downstream.
**Decided:** `sheet_levels` is hydrated, the index is not — so a snapshot Load
or revision Restore reverts levels while the index still claims them. The
payload wins: on hydrate, drop the index's inferred levels and re-propose. A
user's saved assignment always outranks an inference.
**Depends on.** T6.

### T10 · Index persistence · M · **deferred until T6 measures**
This originally resolved the research doc's open question ("measure before
choosing") to *persist*, without the measurement. Deferred on purpose.
When scheduled: **use the existing `metaGet`/`metaPut`/`metaDelete`
(`store.js:348-358`)** rather than hand-rolling. Note the stamp-library
precedent is the **wrong** one — those keys are browser-global by design, and a
sheet index is per-project and keyed on filenames that collide across projects.
`cloudStore` does not re-export the meta primitives, and the cloud manifest
holds `{id, name}` with no size, so name+size invalidation is not computable
without downloading the PDF. Scope per project, through the store seam, with
the cloud path decided rather than assumed.

---

## M3 — Coverage where the estimator is looking

### T11 · Room coverage overlay · M
**Goal.** Missing scope, visible on the drawing.
**Do.** Ghost every room label the index found on the active sheet: a dot per
room, green where a shape covers it, amber where none does. Click an amber dot
to trace it. Together with T2 that is a complete workflow — detect all, glance
for amber, click the stragglers.
**Not a table.** Sheet-level coverage is too coarse; the unit an estimator
misses is a room. Estimators already work this way — colouring rooms as they go
is why the highlighter exists.
**Overlap.** Extend the zone check rather than competing with it — it is
already the good answer for "what have I got in this area."
**Depends on.** T6 (or T2 for single-sheet).

---

## M4 — The addendum

### T12 · Sheet-to-sheet drawing diff · L
**Goal.** "Which sheets changed in Addendum 3, and where on them?"
**Why it's here.** `lib/snapshotDiff.js` says outright its diff is
"QUANTITY-LEVEL, deliberately NOT geometric," and the user guide admits the
compare "won't show you which wall moved." Today the answer is print both and
eyeball. Bidding a superseded sheet, or missing added scope, is how a flooring
sub loses money.
**Do.** Pair old-to-new by sheet number (the index's real killer application),
render both, pixel-diff, emit a per-sheet change score plus highlighted change
regions. `rastermask.ts` and `invertCanvasPixels` already have the machinery.
**Depends on.** T6.

---

## M5 — Deeper reads

### T13 · Document facts · S
`getMetadata`, `getOutline`, `getPageLabels`, `getPermissions` into the index.
Use `getOutline` as the drawing index when present — it beats every heuristic in
T5. **No Document tab**; page labels and permissions are hover-text at most.
**Depends on.** T6.

### T14 · Producer-based One-Click pre-routing · M
Its own task, not a metadata footnote. Routing a scanner-produced file straight
to the raster path changes the One-Click trigger policy, which reads
`sheetStatsRef` — cleared on every group change — so a persistent
Producer-derived signal changes which branch runs *before stats arrive*, i.e. it
changes the "still reading this sheet's linework" race. Needs
`geometry.test.ts`-adjacent coverage.
**Depends on.** T13.

### T15 · Measurement viewports · S · gated on T1
Read `/VP` → `/Measure` via **pdf-lib**: `page.node.lookup(PDFName.of('VP'),
PDFArray)` → `.lookup(i, PDFDict)` → `.lookup(PDFName.of('Measure'), PDFDict)`.
**Read `/R` (the scale-ratio string, the entry we most want) and `/Y`**, not
just `/X`, `/D`, `/A`.
**Two caveats:** pdf-lib 1.17.1 cannot decrypt — permission-encrypted PDFs are
common off GC platforms, and `ignoreEncryption: true` *skips* decryption, so
`/R` and the unit labels come back as ciphertext while the numbers survive. And
this is a **full second parse of the file** on top of pdf.js, not a free read.
**Expect narrow emission** — it correlates with plotting through a CAD-vendor
plugin, not with Print/Plot.

### T16 · Annotations — read and import · M
Merged; a read-only tab of things you cannot act on is a dead end.
**Do.** Read into the index; import `FreeText`/`Text`/`Ink`/`Square` — but
**into their own hideable layer with its own provenance, not the user's markup
layer.** Merging 200 architect sticky notes into the user's own ink would bury
what they wrote and inflate every markup count. (This originally claimed it would also flood
an "RFI candidate list" — it wouldn't: `raiseRfi` is a
per-markup button that seeds a subject from that one markup's text, and nothing
enumerates markups as candidates.)
**Shape note.** `data.vertices` is a flat `Float32Array` and `data.inkLists` is
an array of `Float32Array`s — not arrays of point objects.
**Shape import** (`Polygon`/`PolyLine`/`Square` → `verts_norm`) is opt-in,
behind the propose → review → Create gate, stamped `origin.method =
"pdf_annotation"`. Justify it as **migration** — inheriting an existing
third-party takeoff so an estimator can switch tools — not as interop.
**Reconcile** with the two existing answers to "what changed": `revisions.js`
quantity deltas are the estimator's own record and stay authoritative for
*quantities*; `revisionClouds.js` marks what the estimator changed; imported
clouds are the architect's claim about the *drawing* and are advisory — they
annotate, they never drive a quantity.
**Depends on.** T6.

### T17 · Layer attribution · XL · gated on T1
**The mechanism is more complex than it looks.** In pdf.js
4.10.38, `beginMarkedContentProps` `args[1]` is **not** an id string — it is
`{type:"OCG", id}` **or** `{type:"OCMD", ids, policy, expression}` (multiple
groups, or a `/VE` boolean expression) **or** `null`. Consumers must gate on
`args[0] === "OC"` because the same op carries `[tagName, MCID]` for non-OC
tags. `getGroups()` returns **`null`**, not `{}`, when there are no OCGs.
It is not one byte per segment.
**Scope is seven render sites**, not one: panel render, detail view,
`ensureRasterMask`, `agentViewRegion`, `rasterizeRegion`, the gallery
thumbnails (`PlanNavigator.jsx:221`) and the Marked Set PDF export
(`markedset.js:391`) — miss the last two and hidden layers reappear in
thumbnails and in the deliverable. Toggling visibility also re-runs the render
effect, which nukes masks, snap grids, and any live proposal. "Remember per project" is a new `buildPayload` field and a new
`hydrate` else-clear branch.
**If T1 finds OCGs on most real sheets, break this up before starting. If not,
drop it** — the estimator's actual want is one sentence ("keep furniture and
dimensions out of my flood fill"), which belongs as a checklist in the existing
render-and-fill settings menu, never as a Layers tab.
**Note.** There is no `?hatchqa` QA wall to compare against — it is documented
in `FEATURES.md` and `CHANGELOG.md` but was never shipped here. Building a
comparison venue is a task, not a given.

### T18 · Colour + dash in the op-list walk · M
Same walk and graphics-state tracking that already handles line width.
Dashed-line exclusion from the mask is a real leak class and is the part worth
doing on its own. Colour filtering is the fallback for flattened sheets.
**Depends on.** T17 if both, otherwise standalone.

---

## M6 — Get it out of the app

### T19 · Exports · S
A *Sheet Index* tab in `lib/xlsx.js`, alongside the existing
**`Conditions` / `By sheet` / `Materials` / `Shapes`** tabs. Room list and
Find-results CSV via `lib/csv.js`. **Depends on.** T6.

### T20 · MCP tools · S
`sheet_index`, `find_text`, `list_annotations` in `mcp/src/tools.ts`.
`mcp/src/pdf.ts` has its own read path, so this needs its **own build loop** —
not just plumbing. Remember the mcp CI job runs on Ubuntu *and* Windows.
**Depends on.** T5 (+ T16).

### T21 · Agent registry · S
Structured index instead of raw text capped at `AGENT_TEXT_MAX_ITEMS = 600`
(which lives in `TakeoffCanvas.jsx:3700`, not `agentTools.js`).
**Scope note.** This improves an **optional-escalation surface only** — the
in-canvas agent is hard-gated on BYO-AI config (`TakeoffCanvas.jsx:3923`), i.e.
a user-supplied key. No default-path capability changes. Exercise it against
the mock agent path; nobody should buy credits to close a size-S ticket.
**Depends on.** T6.

---

## M7 — Performance

### T22 · Raster mask build → worker + OffscreenCanvas · M
Move `buildRasterMask`'s threshold and closing passes off the main thread.
It already hurts: this runs on the scanned-plan path, which is exactly where
One-Click is slowest — a felt freeze during the app's headline gesture.
**Trigger.** Schedule it when mask build on a scanned sheet exceeds ~150 ms on
the reference machine, or when a One-Click on a scan visibly stutters — measure
before and after in the PR. **Note** `busyRef` is load-bearing — `PlanNavigator.jsx:209`
yields the thumbnail pump on `busyRef.current === "rendering"`, so moving mask
work changes when that flag is set.

---

## Deferred

### D1 · Local OCR — the gate deletion · L · split
**Re-justified.** Not "read scans" — One-Click already handles scanned *plans*
via `rastermask.ts`, and scanned *schedules* specifically are a minority of a
minority. The honest win is **deleting a sign-in gate, an org-domain
restriction, a Netlify function, and bespoke 504 retry logic**, which is a
ground-rules and repo-health win, not minutes saved per bid. Say that plainly.

**D1a — clearance and vendoring.** Engine bake-off *single-threaded* (`_headers`
sets no COOP/COEP, so no `SharedArrayBuffer`; and it can't simply be added —
`require-corp` breaks the Google sign-in iframe and the webfonts). Licence
clearance per the DoD, including the character dictionary the recogniser needs.
A `prebuild` script that copies wasm from `node_modules` and fetches models by
pinned URL + recorded SHA-256 into `web/public/models/<engine>@<version>/` —
**weights are never committed to git** (`.git` is ~11 MB; 15–60 MB would
multiply it permanently and is paid on every CI checkout across a 2-OS matrix).
A `_headers` rule for `/models/*` with `immutable`. A CI guard that the
initial-load JS graph does not grow. Ships nothing user-visible.
*Cost, corrected:* tesseract's real cost is **~5 MB (`_fast`
traineddata + SIMD core) to ~14 MB (standard)**, not the ~60 MB first claimed here — an
unsourced number. This makes D1 cheaper than it looked.
*Also state plainly:* self-hosting does not remove the meter, it **moves it** to
the deployer's bandwidth bill. `README.md:220` says "No paid dependencies" and
that must stay true for a fork.

**D1b — routing and gate removal.** Local OCR runs for **any** region the vector
parser produced no rows from — token-less *and* token-bearing. Delete the gate
at `TakeoffCanvas.jsx:3983`; the sign-in/domain checks guard only the escalation
branch. New raster path yielding `ImageData`, bypassing `SCAN_MAX_DIM` (a
server-only cap). Calibrate `parseSchedule`'s row clustering: `h` is pdf.js
**cap height**, OCR gives bounding-box height including descenders, so
`max(t.h*0.6, 4)` needs a fixture pass — this is not a drop-in.
**Acceptance, all of it:** on a build with `VITE_GOOGLE_CLIENT_ID` unset, no
sign-in, DevTools offline — a scanned schedule parses to rows; **zero non-self
network requests during OCR**; unchanged initial-load bundle; a stated accuracy
bar ("≥X% of CODE-column cells parse correctly over N real scanned schedules")
so the task can be declared failed; and deleting the Netlify function, the
`/ai/parse-schedule` redirect and `importScheduleFromScan` leaves `npm run
check` green.
**Also update, or the app still says you need to sign in:**
`docs/USER_GUIDE.md:192`, `netlify.toml:1-4` and `:15-19`,
`TakeoffCanvas.jsx:3944-3951` and `:4006`, `scheduleScan.ts:1-9`, and the
`FEATURES.md` row — plus a new `FEATURES.md` row for local OCR distinct from
"Optional AI backend."

### D2 · Local semantic search
Free and possible, but T8's keyword Find must ship and prove insufficient
first. If scheduled: SQLite's default `opfs` VFS **requires** COOP/COEP — use
the `opfs-sahpool` VFS, which does not.

### D3 · Auto-find the schedule table on a sheet
The research doc identifies the real upgrade to a shipped feature — the parser
is "gated behind a manual marquee instead of run over the whole sheet" — and
nothing here scheduled it until now. Deterministic table-bounds detection on a
vector sheet, no model. Worth an S–M when M2 lands.

---

## Not doing

- **Swapping the PDF renderer.** pdf.js is load-bearing across four modules.
  Also: **MuPDF/mupdf.js is AGPL-3.0-or-commercial** and cannot be linked into
  an Apache-2.0 distribution.
- **A "Plan Data" panel.** The app already has six rail buttons and nine
  surfaces. Every tab proposed in the research doc has an existing owner: Sheets →
  the gallery, Text → Find, Rooms → the canvas overlay, Layers → the
  render-and-fill settings menu, Annotations → their own imported layer,
  Schedules → `ImportSchedulePanel`, Document → hover text.
- **Addressable refs + semantic text typing.** Speculative generality — its own
  first-draft justification was "cheap now and awkward to retrofit," and
  nothing in the plan consumes either. Build when something needs it.
- **Small vision-language models.** Hundreds of MB against rule 2, for a
  capability unreliable at exactly the small dense text we care about. Also
  **Moondream 3 is BSL 1.1**, not Apache/MIT.
- **Document layout detection for drawing regions.** Trained on documents, not
  construction drawings — **and DocLayout-YOLO's YOLOv10/Ultralytics lineage is
  AGPL-3.0, incompatible with Apache-2.0 redistribution.** That is a licence
  bar, not just a fit bar, and it does not go away if `capture/` ever
  accumulates a training set.
- **Anything requiring a paid API in the default path.** Per §0.

---

## Repo drift — separate PRs

Found during review; independent of this plan and not blocked by it.

1. **`?hatchqa` doesn't exist.** Advertised in `FEATURES.md:15` and
   `CHANGELOG.md:165`; zero code hits, never in a commit here. Either build it
   or strike the claim.
2. **`AGENTS.md` says `npm run check` is "exactly what CI runs."** It isn't —
   see the DoD above. The claim invites shipping a green local check against a
   red CI.
3. **Self-host the webfonts.** `tokens.css:3` `@import`s five families from
   Google on every page load: an IP+UA leak before the user opens a plan, a hard
   failure offline, and the reason ground rule 2 does not currently hold. A few
   hundred KB under `web/public/fonts/` with `font-display: swap`, then drop
   `fonts.googleapis.com`/`fonts.gstatic.com` from the CSP. Also a prerequisite
   for COOP/COEP if threading is ever wanted (D1a, D2).

---

## First slice

**T1 → T2 → T4 → T5 → T6 → T7**

T1 is cheap and gates T15/T17. **T2 ships real estimator value on day one with
no new extraction** — it is the plan's best ratio by a wide margin, and it
depends on nothing. T4 is the coordinate decision that everything downstream
inherits; getting it wrong after T6 means rewriting T6. T5/T6 build the index
with a real completeness signal. T7 makes it visible and is the honest smoke
test.

T3 (the schedule join) is the biggest single win in the plan and should start
as soon as T2 proves the room-label path.
