# PDF Data — the build plan

The scheduled work derived from [`PDF_DATA_SURFACE.md`](PDF_DATA_SURFACE.md).
That document is the research and the *why*; this one is the ordered backlog
and the *what*, sized so each task is a single reviewable PR.

## Ground rules (from `PDF_DATA_SURFACE.md` §0)

1. **No paid dependency, and no gate, in the default path.** No subscription,
   no metered API, no sign-in, no allow-listed domain, no user-supplied key.
   Anything that needs one is an optional escalation the app works without.
2. **Nothing leaves the browser.** Plan bytes are never uploaded and the app
   works with the network off. Any model weights ship as static assets from the
   app's own origin (§8.0), never from a third-party CDN at runtime, and load
   lazily on first use — the `lib/ingest.js` precedent.

Work that cannot meet both is listed under [Not doing](#not-doing) rather than
scheduled.

## Definition of done — every task

- Branch first, never commit on `main` (`AGENTS.md`).
- `cd web && npm run check` green — typecheck, lint, test, build, on the Node
  pinned by `web/.nvmrc`. This is exactly what CI runs.
- New pure logic has `node:test` coverage in `web/test/`, following the
  `geometry.test.ts` / `totals.test.ts` / `scheduleParse.test.ts` precedent.
- Exercised by hand against the bundled sample plan (`web/public/demo/`) —
  Vite does not flag undefined identifiers in JSX, so load the app before
  calling it done.
- Docs synced where behavior changed: `README.md`, `docs/USER_GUIDE.md`,
  `CHANGELOG.md`, and the capability row in `FEATURES.md`.
- No new dependency without a note on why an existing one won't do. `pdfjs-dist`,
  `pdf-lib`, and `fflate` are already present and cover most of this plan.

Sizes: **S** ≈ a sitting · **M** ≈ a day · **L** ≈ multi-day.

---

## M0 — Probe first

Two later tasks are worth nothing if the data isn't in real plan sets. Find out
before building either.

### T1 · Corpus probe · S
**Goal.** Know what real bid sets actually contain.
**Do.** A dev-only route (`?probe`) or a throwaway script that reports, per
file and per page: optional-content groups and their names; annotation
subtypes with counts; presence of an outline, page labels, and permissions;
`Producer`/`Creator` from metadata; presence of `/VP` `/Measure` viewports;
text-item count; `segCount` and `imageFrac`. Emit CSV.
**Run against.** The bundled sample plus as many real sets as can be gathered —
ideally spanning architect-published, GC-platform-republished, and scanned.
**Acceptance.** A table of results committed to the PR description, and a
one-line verdict on T15 and T16: schedule, defer, or drop.
**Ships?** No. Probe only; nothing user-visible.

---

## M1 — The sheet index

Everything downstream reads this. Nothing else in the plan starts first.

### T2 · `lib/sheetIndex.ts` — the pure core · M
**Goal.** Turn positioned text into the per-sheet facts everything else needs.
**Scope.** Sheet title (largest text run adjacent to the sheet number);
discipline class from the number's leading letters; level inference
("LEVEL 2", "SECOND FLOOR"); room number ↔ room name pairing built on the
existing `ROOM_LABEL_RE` in `detectRooms.ts`.
**Out of scope.** Any pdf.js import, any DOM, any caching, any UI.
**Pattern.** Pure and pdfjs-free like `scheduleParse.ts` and `detectRooms.ts` —
takes tokens already resolved to image px, so `mcp/src/pdf.ts` reuses it
unchanged.
**Tests.** `web/test/sheetIndex.test.ts` — title picked over adjacent noise;
discipline classes incl. two- and three-letter prefixes (`FP`, `AV`); level
phrasings; room pairing when the number and name are one run vs. two; nothing
found returns empty, never throws.
**Acceptance.** Zero pdfjs/DOM imports. Runs under `node --test`.
**Depends on.** Nothing.

### T3 · Index build + cache · M
**Goal.** Build the record once per sheet, reuse it everywhere.
**Do.** Wire T2 to pdf.js at the call site; hold in an in-memory ref keyed by
sheet key; persist under a new key in the keyPath-less `META_STORE`
(`lib/store.js`) — **no `DB_VERSION` bump**, the stamp-library precedent.
Sanitize on load like `sanitizeSheetLevels` / `sanitizeMaterialLibrary`:
a stale or corrupt index degrades to "not indexed yet," never to a crash.
Invalidate on file name + size so a reissued sheet re-indexes.
**Build trigger.** The gallery's existing lazy thumbnail pump
(`PlanNavigator.jsx`), which already walks every sheet behind an
`IntersectionObserver` and already calls `getTextContent()`. No new passes.
**Tests.** `web/test/sheetIndex-store.test.ts` — round-trip, sanitizer gate on
malformed payloads, invalidation on size change.
**Acceptance.** Opening the gallery on the sample plan populates the index;
reload reuses it without re-parsing.
**Depends on.** T2.

### T4 · Retire the redundant text reads · S
**Goal.** Stop fetching the same text layer six times.
**Do.** Route the existing `getTextContent()` call sites through the cache:
`PlanNavigator.jsx:225`, `TakeoffCanvas.jsx:1205`, `:1216`, `:1232`, `:3714`,
`:3965`.
**Acceptance.** No behavior change; measurably fewer parses on a multi-sheet
open. Pure win — worth landing before any new surface.
**Depends on.** T3.

---

## M2 — Surface it and filter it

### T5 · Cross-sheet Find · M
**Goal.** `⌘F` / `/` searches every sheet's text; results grouped by sheet;
click opens the sheet, zooms to the hit, highlights it.
**Notes.** Needs per-hit rects — use the text item's `width` and cap height,
which we currently discard. Respect `menuDepthRef` so the shortcut doesn't
fight the single-letter tool keys (`docs/USER_GUIDE.md` §15).
**Acceptance.** Search the sample plan for a room name; land on it.
**Depends on.** T3.

### T6 · Gallery shows real sheet identity · S
**Goal.** `A-101 · FIRST FLOOR PLAN` instead of a file stem.
**Do.** Extend `labelOf` in `PlanNavigator.jsx`; sort by sheet number; filter by
discipline. Keep `sortGalleryGroups`' per-group ordering rule intact — it fixed
a real churn bug, don't regress it.
**Depends on.** T3.

### T7 · Auto-level proposals · S
**Goal.** Replace the `window.prompt` level assignment with proposed levels the
user confirms.
**Do.** Feed T2's inferred level into a confirm step; `groupSheetsByLevel`
(`lib/sheetLevels.js`) is unchanged downstream. Manual assignment stays.
**Depends on.** T2.

### T8 · Plan Data panel + Sheets tab · L
**Goal.** One place where extracted data is filterable.
**Do.** A docked panel mirroring `TakeoffsPanel.jsx` / `ReportPanel.jsx`, built
on the column-profile pattern in `lib/reportColumns.js` (`GETTERS` +
`*_PROFILE`, `defaultVisible`, opt-ins appended, never reordered). Sheets tab
facets on discipline, level, detected scale, vector-vs-scan, has-takeoff, plus
the coverage readout: *"9 sheets have no detected scale. 12 are scans. 31
A-sheets have no takeoff."*
**Tests.** Column getters and profile in `web/test/planDataColumns.test.ts`,
the `reportColumns.test.ts` precedent.
**Depends on.** T3.

### T9 · Rooms tab · M
**Goal.** A filterable room list per sheet; each row seeds the existing
One-Click flood.
**Do.** Rows from T2; the action path is `detectRegions` + `traceRegion`, which
already exist. Results land in the existing **propose → review → Create** gate —
this is not a bulk commit.
**Depends on.** T2, T8.

### T10 · Addressable refs + semantic text typing · M
**Goal.** Two framings that are cheap now and awkward to retrofit.
**Do.** (a) Make a sheet reference resolvable — `M002` addresses a sheet,
and the index carries enough to resolve a region reference later. (b) Type each
extracted text run in the index: `title_block`, `note`, `dimension`, `leader`,
`room_label`, `schedule_cell`, `unknown`.
**Tests.** Typing classifier in `web/test/sheetIndex.test.ts` — deterministic
rules only, no model.
**Depends on.** T2.

---

## M3 — Ungate the scan path

### T11 · Local OCR behind the existing token contract · M
**Goal.** Read a scanned schedule with no sign-in, no key, no network.
**Why it's cheap.** `scheduleParse.ts` is already pure, already pdfjs-free, and
already takes `Token[] = {str,x,y,h}` *specifically so either path can feed it* —
the module header says so. A local OCR emitting positioned tokens plugs into
the existing contract with **no parser changes**.
**Do.** Pick the smallest engine that clears the bar on real scanned schedules
(evaluate tesseract.js vs. a pinned PaddleOCR mobile ONNX export — see §8.0 for
why the exact export matters). Self-host weights and wasm from the app's own
origin. Lazy-load on first use only.
**Routing.** Local OCR becomes the default tier for a token-less region. The
existing `/ai/parse-schedule` endpoint demotes to an optional escalation —
still there, no longer the gate, deletable without losing a feature.
**Tests.** `web/test/localOcr.test.ts` over the pure adapter (raw engine output
→ `Token[]`), engine mocked. The engine itself is not unit-tested here.
**Acceptance.** A scanned schedule parses to rows with the network off and
nobody signed in. Accuracy is *not* claimed to match the hosted reader —
the existing approve-rows dialog is the correction pass.
**Depends on.** Nothing. Can run parallel to M1.
**Risk.** Bundle discipline. If weights ever load on initial page load, the
task has failed regardless of accuracy.

---

## M4 — Deeper reads

### T12 · Document facts · S
`getMetadata`, `getOutline`, `getPageLabels`, `getPermissions` — one call each,
into the index and a Document tab. Use `Producer`/`Creator` to pre-route
One-Click to the raster path for scanner-produced files instead of discovering
it from `imageFrac` after the fact. Use `getOutline` as the drawing index when
present; it beats every heuristic in T2. **Depends on.** T3, T8.

### T13 · Annotations, read-only · M
`page.getAnnotations()` per sheet into the index; Annotations tab filtering by
subtype, author, date; row → zoom to. Read-only — nothing is imported yet.
**Depends on.** T3, T8.

### T14 · Annotation import · M
Markups first (`FreeText`/`Text`/`Ink`/`Square` → the existing markup layer,
which never touches quantities). Shapes second and opt-in
(`Polygon`/`PolyLine`/`Square` → `verts_norm`), behind the same **propose →
review → Create** gate One-Click uses, stamped `origin.method =
"pdf_annotation"` so `lib/provenance.js` tracks every correction. Someone
else's measurement is a proposal until the estimator accepts it.
**Depends on.** T13.

### T15 · Measurement viewports · S
Read `/VP` → `/Measure` from the page dictionary via **pdf-lib** (already a
dependency; pdf.js has no public API for it). When present, authoritative over
the text-note scale, and per-viewport — which resolves the multi-scale
ambiguity `detectScale` currently gives up on. Degrade silently when absent.
**Depends on.** T1's verdict.

### T16 · Layer attribution + Layers tab · L
Track `beginMarkedContentProps("OC", id)` / `endMarkedContent` in
`extractVectorGeometry`, emitting a per-segment layer id alongside the existing
`meta`; read names from `getOptionalContentConfig().getGroups()`. Layers tab
gets two independent toggles per layer: **visible** (drives the raster via
`page.render({ optionalContentConfigPromise })`) and **exclude from One-Click**
(drives `buildMask`). Remember exclusions per project.
The hatch classifier stays as the path for OCG-less sheets — this does not
replace it, and `?hatchqa` is the ready-made place to compare the two.
**Tests.** Extend `web/test/geometry.test.ts` for layer emission; mask
exclusion on a synthetic op list.
**Depends on.** T1's verdict.

### T17 · Colour + dash in the op-list walk · M
Same walk and same graphics-state tracking that already handles line width.
Emits a per-segment colour index and a dashed bit. Unlocks: filter linework by
colour (the fallback layer panel for flattened sheets, which is most of them),
dashed-line exclusion from the mask, and direct polygon recovery from closed
`SEG_FILLONLY` paths with no flood at all.
**Depends on.** T16 (same file — land them together, or T17 alone if T1 kills
T16).

---

## M5 — Get it out of the app

### T18 · Exports · S
A *Sheet Index* tab in `lib/xlsx.js` — the writer already does Summary /
By-sheet / Materials / Shapes-audit, this is a fifth in the same shape. Room
list and Find-results CSV via `lib/csv.js`. **Depends on.** T3.

### T19 · MCP tools · S
`sheet_index`, `find_text`, `list_layers`, `list_annotations` in
`mcp/src/tools.ts`. Nearly free because T2 is pure — the `detect_rooms`
precedent. **Depends on.** T2 (+ T13/T16 for the latter two).

### T20 · Agent registry · S
Give the in-canvas agent the structured index instead of raw text capped at
`AGENT_TEXT_MAX_ITEMS = 600`. Strictly better context for strictly fewer
tokens. **Depends on.** T3.

---

## M6 — Performance, when it bites

### T21 · Raster mask build → worker + OffscreenCanvas · M
Move `buildRasterMask`'s threshold and closing passes off the main thread.
Most of the win without WebGPU, and it addresses the class of problem
`AGENTS.md` already documents (pdf.js schedules on `requestAnimationFrame` and
pauses when the window is hidden). Flood fill itself is sequential — leave it.
**Depends on.** Nothing. Schedule when it hurts, not before.

---

## Not doing

Listed so the decision is on the record and doesn't get re-litigated.

- **Swapping the PDF renderer** (PDFium-WASM, MuPDF-WASM). pdf.js is
  load-bearing across four modules and every scheduled task is reachable
  through it. The one gap — `/VP` `/Measure` — is covered by pdf-lib in T15.
- **Small vision-language models** (§8.3). Hundreds of MB of weights against
  §0's second rule, for a capability that is unreliable at exactly the small
  dense text we care about.
- **Drawing-region typing / layout detection** (§8.4). The open models are
  trained on documents, not construction drawings; detail bubbles, match lines,
  and keynote legends are out of distribution. Revisit only if `capture/` ever
  accumulates a plan-sheet training set.
- **Local semantic search** (§8.6). Genuinely free and genuinely possible —
  but T5's keyword Find is what estimators reach for ten times a day, and it
  must ship and prove insufficient first. Deferred, not rejected.
- **Anything requiring a paid API in the default path.** Per §0.

---

## Suggested first slice

**T1 → T2 → T3 → T4 → T5.**

The probe that decides two later tasks, the foundation everything reads, the
free performance win on the way through, and the one feature that justifies the
foundation on its own. T11 can run in parallel — it depends on nothing in M1
and it is the task that removes a sign-in gate.
