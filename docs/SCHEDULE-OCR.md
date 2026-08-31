# Browser-side schedule OCR — evaluation harness and findings

The goal: read a **scanned** finish/material schedule into `ScheduleRow[]`
entirely client-side, so the "Import from schedule" marquee works on raster
sheets without the paid, OAuth-gated Gemini path (`/ai/parse-schedule` returns
501 on any deployment without a key — scanned schedules currently have exactly
one reader). The architecture is already in place to receive an engine:

- **The seam is `Token[]`, not rows.** Vector sheets go
  `extractRegionText` → `{str,x,y,h}` tokens → `parseSchedule`
  (`src/lib/scheduleParse.ts`). Any OCR engine that emits the same positioned
  tokens plugs into the same parser — the parser never learns which engine fed
  it. `src/lib/ocr/types.ts` defines the word/engine contract.
- **The runtime pattern is proven twice.** Voice already ships onnxruntime-web
  in a hand-rolled worker with same-origin model staging and a CI cache
  (`docs/VOICE.md`), and `rastermask.ts` already does adaptive binarization on
  scanned sheets. The deployment constraint carries over unchanged: **no
  COOP/COEP → no SharedArrayBuffer → single-threaded WASM SIMD** (WebGPU,
  which needs no cross-origin isolation, remains available where supported).

Before picking or training any engine, the harness answers the measurement
questions every choice hangs on. Everything below is reproducible:

```bash
cd web
node --import tsx scripts/make-schedule-ocr-fixture.mjs   # regen word fixtures (committed)
node --import tsx scripts/schedule-ocr-benchmark.mjs      # the oracle sweep (Experiment 1)
```

## The harness

**Ground truth is free on vector sheets.** A vector schedule's text layer is
perfect truth — render the region to pixels, discard the text layer, OCR the
pixels, score against what was discarded. `test/fixtures/schedule-ocr/` holds
one real case to start: the MATERIAL SCHEDULE from the demo VA renovation set
(28 rows, 6 sections, mixed-case remarks, a lone-letter code, blank cells) as
extracted words plus **hand-authored golden rows** (authoring rules in the
fixture README — source typos verbatim, remarks excluded, categories by what
the section header *means*).

**Scoring is two-layer** (`src/lib/ocr/score.ts`), because attribution matters
more than one number:

- *word level* — detection recall/precision by box IoU (≥ 0.5), then corpus CER
  over matched pairs: separates "never saw the cell" from "misread the cell";
- *row level* — rows matched by `finish_tag` (a misread tag **is a lost row**:
  `normalizeScanRows` drops untagged rows today), then per-field
  exact-after-normalization accuracy and field CER.

## Experiment 1 — the oracle sweep (no OCR at all)

`scripts/schedule-ocr-benchmark.mjs` degrades the ground-truth words with
seeded, OCR-shaped noise (`src/lib/ocr/noise.ts`: glyph confusions O↔0 I↔1
S↔5…, deletions, insertions, whole-word drops) and feeds the SAME parser the
app ships. It measures the number every engine decision needs: **the CER
budget — how much character error the schedule importer absorbs before rows
are lost.**

### Absolute baseline (clean text vs golden)

The parser ceiling on real layout, before any noise: row recall **100%**,
field accuracy **95.2%**, perfect rows **20/28** (after the hardening below —
was 91.7% / 14). The one remaining gap is a single limitation, pinned in
`test/scheduleOcr.test.ts` so a fix shows up as a deliberate test update:

- **Remarks bleed into SIZE.** Grout and sheen notes (8 rows) sit nearer the
  SIZE anchor than the REMARKS anchor on this layout, so nearest-anchor
  banding smears them — size accuracy 71.4%. This is an anchor-*geometry*
  problem, not a text-noise one, so the text hardening below doesn't touch it;
  it's the next hardening target.

(The former second limitation — `MISC. FINISHES` inheriting the wrong category
because `sectionKey` folds it to `MISCFINISHES`, which the strict map lacked —
was **fixed** by the fuzzy section resolver; category accuracy 78.6% → 100%.)

### The cliff Experiment 1 found — and the hardening it drove

The first sweep measured a parser whose noise budget was **≈ 0.5% CER** and
whose failure was not graceful: by 1% CER whole-parse *collapses* (0 rows out)
appeared. The cliffs were structural, not statistical:

- **Header anchors were single points of failure** — corrupt the one `CODE`
  word and `findAnchors` failed → the entire parse returned `[]`.
- **Section words gated whole blocks** — a corrupted `FLOORING` dropped every
  row under it.
- **The code regex was exact** — `CPT-1` read as `CP7-1` failed
  `^[A-Z]{1,4}(-[A-Z0-9]{1,4})?$` and the row vanished silently.

Printed-text OCR at 144 DPI realistically lands in the 1–5% CER range — above
that budget — so the highest-leverage move was **parser hardening, not engine
work**. `scheduleParse.ts` now matches headers, sections, and codes
OCR-tolerantly (bounded edit distance 1–2; a confusion-aware code shape that
still rejects lone numbers; a prefix/fuzzy section resolver). Each fuzzy path
fires only when the strict form misses, so **clean vector text is
byte-for-byte unaffected** — the existing parser suite is untouched and green.

### Noise sweep, before → after (vs clean parse — noise sensitivity in isolation)

25 seeds per point; input CER measured, not assumed:

| char noise | input CER | row recall (before → after) | whole-parse collapses / 25 (before → after) |
|---|---|---|---|
| 0.5% | 0.5% | 98.4% → 98.4% | 0 → 0 |
| 1% | 1.0% | 90.9% → **95.6%** | 1 → **0** |
| 2% | 2.1% | 83.6% → **91.3%** | 1 → **0** |
| 3% | 3.1% | 67.4% → **89.0%** | 5 → **0** |
| 5% | 5.0% | 62.3% → **83.3%** | 5 → **0** |
| 8% | 8.0% | 43.0% → **72.1%** | 8 → **0** |

**The cliff is gone.** Row recall roughly doubled at moderate noise, and
whole-parse collapses were eliminated through 8% CER. Two budgets now, because
the two failures aren't equal:

- **Row-survival budget** (row recall ≥ 95% — a lost row is *silent* data
  loss): **≈ 1% CER, doubled from 0.5%**, with no collapse observed through 8%.
  This is the line the parser defends. Word drops: rows survive a 1% detection
  miss rate (drops of whole anchor words remain the parser's hard limit —
  fuzzy matching can't recover text that never arrived).
- **Combined budget** (row recall ≥ 95% AND field acc ≥ 90%): still ≈ 0.5% CER,
  now gated by *field text fidelity* — getting `WILSONART` or `1408 HIGH
  ROLLER` exactly right is the OCR engine's job, not the parser's. A field typo
  is visible and editable in the approval dialog; a lost row is not. So this
  budget is the whole-pipeline ceiling the engine must lift.

The takeaway for engine selection: **the parser no longer amplifies OCR error
into lost rows** up to ~8% CER, so an off-the-shelf engine in the 1–5% range
should now yield a nearly complete row set, with residual errors landing as
editable field typos rather than missing line items.

## Experiment 3 — the off-the-shelf engine ceiling

Where Experiment 1 fed the parser synthetic noise, Experiment 3 feeds it a REAL
engine's output on the REAL rasterized region, swept across render DPI. Same
scoring functions, so the numbers are comparable. The engines are opt-in dev
tooling (not committed — models download to `~/.cache` on first use):

```bash
cd web
npm i -D tesseract.js ppu-paddle-ocr
node --import tsx scripts/schedule-ocr-engine-benchmark.mjs --dpi 144,216,288 --json out.json
```

The plumbing: `scripts/lib/renderRegion.mjs` rasterizes a fixture rect at a
given DPI (the browser worker will do the same with OffscreenCanvas);
`src/lib/ocr/raster.ts` is the pure, tested map from an engine's crop-pixel
boxes back to the `{str,x,y,h}` space the parser and ground-truth share; each
engine is an adapter under `scripts/lib/` emitting `OcrWord[]`.

**Two engines, on the demo material schedule (Node, PP-OCRv5 mobile / tesseract
PSM 3):**

Numbers below are the demo material schedule **only** (n=1) — read every
conclusion as "on this sheet" until the corpus has breadth (see the roadmap's
closing note). Row-level results, **after** the step-4 parser fix:

| engine | DPI | rows emitted | recall exact / fuzzy | precision | matched CER | category | perfect |
|---|---|---|---|---|---|---|---|
| tesseract (floor) | 144 | 25/28 | 96.4% / — | high | 7.2% | ~80%† | 9/28 |
| tesseract | 288 | — | **96.4%** | high | 5.5% | ~80%† | 10/28 |
| PaddleOCR (ceiling) | 144 | 25/28 | 78.6% / **89.3%** | 88.0% | **0.8%** | **50.0%** | 3/28 |
| PaddleOCR | 216 | 27/28 | 92.9% / **96.4%** | 96.3% | **0.7%** | **57.7%** | 8/28 |
| PaddleOCR | 288 | 27/28 | 92.9% / **96.4%** | 96.3% | **0.9%** | **38.5%** | 3/28 |

- **exact vs fuzzy recall**: exact-tag recall matches golden rows on `finish_tag`
  as an exact key, so a misread tag (`CT-2` → `C-2`) is charged *twice* (miss +
  spurious) even though the row and its fields are emitted correctly. Fuzzy
  recall (edit-distance ≤ 1 on the tag) isolates "row emitted & matchable" from
  the engine's tag CER — the parser's job is to emit the row, and it does.
- **category is 38–58% on the OCR path** — the pipeline's weak field, called out
  here rather than blended into a single "field acc." A stale section latches
  when a mid-table header is missed, so base/wall rows inherit the previous
  section's category. This is a *known, unsolved* gap (see step 4); it is
  editable in the approval dialog, but it is not the "100%" the clean vector
  path reports.
- **perfect rows swing 3 → 8 → 3** across DPI on the same sheet — volatile;
  don't read the peak as the result.
- **det. recall** (in the benchmark output, not shown here) is IoU ≥ 0.5 against
  the *cell-level* vector boxes. It is understated by a BOX-CONVENTION mismatch
  (ground truth uses baseline + cap-height; PaddleOCR reports full glyph
  extent), *not* by word-vs-cell granularity — so it is only meaningful WITHIN
  one engine, never as a cross-engine ranking.

† tesseract category is comparable-to-worse than PaddleOCR's and equally
subject to the stale-section gap; its higher exact-recall comes from word-level
over-segmentation happening to feed the column banding, while its 5–8% CER lands
as editable field typos.

### The finding that redirects the roadmap again

**PaddleOCR reads characters ~10× more accurately than tesseract (0.8% vs 5.5–8%
CER).** The first run of this experiment (before step 4) showed PaddleOCR's
complete-row recall *collapsing erratically* — 17.9% at 216 DPI — which I
initially misattributed to cell-box detection geometry. Step 4 found the true
cause: the parser **gated every row on a detected section header**, and PaddleOCR
drops those isolated words unpredictably (details in
`docs/SCHEDULE-CELL-PARSING-SPEC.md`). Decoupling row emission from section
detection fixed it — 216 DPI recall 17.9% → 92.9%, now stable across DPI.

What remains, and is genuinely PaddleOCR's ceiling to build on: its CER headroom
is decisive and its precision is ~3× tesseract's. The open parser work is
**category correctness** (the stale-section latch above) and the still-pinned
remarks→SIZE banding — not row survival, which step 4 settled *on this sheet*.

These are Node timings (~5–12 s/schedule). Browser-worker timing under the real
single-thread-WASM / WebGPU envelope is Experiment 4/5.

## Roadmap (the experiment ladder)

1. ~~**Oracle sweep** — measure the CER budget.~~ Done, above.
2. ~~**Parser hardening** — fuzzy anchors/sections/codes, re-run the sweep,
   watch the budget move.~~ Done: the collapse cliff is gone and the
   row-survival budget doubled (before/after above). Remaining hardening the
   sweep still points at — anchor recovery from column geometry when a header
   word is *dropped* (not just corrupted), and fixing the remarks→SIZE
   geometry — is deferred behind engine evaluation, since dropped-word
   robustness matters less once a real engine's detection recall is known.
3. ~~**Off-the-shelf ceiling** — real engines over rasterized regions, DPI
   swept, scored by this harness.~~ Done, above: tesseract (floor) and
   PaddleOCR/PP-OCRv5 (ceiling). Result: PaddleOCR's CER is decisive (0.8%) but
   the *parser's spatial model* now bounds row recall, not the recognizer.
   (`ocrs` / Rust→WASM remains a future adapter — the harness takes any engine
   that emits `OcrWord[]`.)
4. ~~**Parser spatial hardening (new critical path)** — robust row emission for
   CELL-level detections, so PaddleOCR's near-perfect text converts to complete
   rows.~~ Done (spec: `docs/SCHEDULE-CELL-PARSING-SPEC.md`). Root cause: the
   parser *gated row emission on a detected section header*, the single most
   droppable token on the sheet — at 216 DPI PaddleOCR missed every section
   word above `MISC. FINISHES`, so 22 correctly-read rows were dropped. Fix:
   emit a row on a code-shaped first cell regardless of section (section still
   drives category when present; else a conservative code-prefix inference; else
   `"other"`), with negative guards so the wider gate invents nothing (a second
   table's header, stray notes, and section-word-shaped codes like `BASE-1` are
   all handled — pinned by tests). **Result: 216 DPI exact recall 17.9% → 92.9%**;
   PaddleOCR now stable across DPI (exact 78.6/92.9/92.9, fuzzy-tag
   89.3/96.4/96.4). Tesseract unchanged (96.4%); golden vector fixture unchanged
   (verified 28 rows / 100% / 20 perfect). **What step 4 did NOT solve: category
   on the OCR path is 38–58%** (a stale section latches when a mid-table header
   is missed — the change converts dropped rows into emitted-but-miscategorized,
   default-checked rows; a strictly better failure, but a real open gap), plus
   the still-pinned remarks→SIZE banding. All numbers are the demo sheet only.
5. **Category correctness + corpus breadth (do these before/with deployment).**
   (a) ~~*Category* is 38–58% on the OCR path because a stale section latches
   when a mid-table header is missed.~~ **Step 5a done** (spec:
   `docs/SCHEDULE-SECTION-RESET-SPEC.md`): the *blank-band section reset* clears
   a stale section at the band a dropped mid-table header leaves between two
   adjacent data rows, so a base row no longer bids as the floor above it. The
   measured win is the **honesty** metric — confidently-wrong, default-checked
   rows drop to 0 on the stale-latch DPIs (144: 8→0, 288: 9→0) — plus a narrower
   category-accuracy gain that is exactly the unambiguous-prefix rows (144:
   50.0→59.1%, 288: 38.5→53.8%; 216 is a no-op, a pure-inference miss). Vector
   golden-28 byte-for-byte unchanged. Passed three adversarial reviews
   (methodology/parser/test-rigor). NOT solved, and the honest reasons to build
   the confidence surface next: a within-section band (a wrapped-remark spacer)
   can *false-fire* the reset into a wrong checked category off-sheet (residual
   2), and `K=1.6` / the margin are n=1. The remaining candidate — a
   **category-confidence flag** on inferred categories, surfaced in the import
   dialog (step 5a-part-2, touches `ImportSchedulePanel`/`TakeoffCanvas`) — is
   the honest fix for those residuals and for the 216 pure-inference miss.
   (b) *Breadth*: today's numbers are n=1. Every additional VECTOR schedule is
   free ground truth (`scripts/make-schedule-ocr-fixture.mjs` + a hand-authored
   golden), and a few genuinely SCANNED sets with hand-labeled golden rows are
   the only irreplaceable asset in this plan — capture them from real projects.
   Corpus breadth is also what earns `K`'s valley and would let the reset move
   from a single constant to a per-layout or learned threshold.
6. **Browser deployability** — PaddleOCR inside a worker under the real
   constraint envelope (single-thread WASM SIMD / WebGPU, no COOP/COEP),
   wired behind the existing `importScheduleFromScan` gate, emitting `OcrWord[]`
   into the same `parseSchedule`. Measure seconds-per-schedule, memory, and
   bundle + model weight; stage the model same-origin like the voice model
   (`docs/VOICE.md`). ppu-paddle-ocr ships for exactly this; the Node timings
   above (~5–12 s) are a loose upper bound. Fine-tuning a recognizer on
   synthetic cells is a step 7 only if a *measured* text gap remains —
   Experiment 3 says PaddleOCR's CER (0.8%) already clears the bar, so this is
   unlikely to be needed.

## Continuing this work (resume here)

State as of 2026-08-31, branch `claude/browser-ocr-library-f3le2q` (steps 0–4
done, green: `cd web && npm run check`). The durable record is this doc + the
spec + the committed fixtures/tests — the container is disposable, the branch is
not.

**Where the pieces live**
- Pure, shipped: `web/src/lib/ocr/{types,noise,score,raster}.ts` (engine
  contract, noise oracle, scoring, coordinate mapping) and the parser
  `web/src/lib/scheduleParse.ts` (the `OcrWord[] → ScheduleRow[]` seam).
- Tests (engine-free, deterministic): `web/test/scheduleOcr.test.ts`,
  `web/test/scheduleParse.test.ts`. Fixtures + real captured PaddleOCR output:
  `web/test/fixtures/schedule-ocr/`.
- Benchmarks (opt-in, NOT committed as deps): `npm i -D tesseract.js
  ppu-paddle-ocr`, then `web/scripts/schedule-ocr-benchmark.mjs` (oracle sweep)
  and `web/scripts/schedule-ocr-engine-benchmark.mjs` (engine ceiling). Models
  download to `~/.cache`; nothing here bloats the repo. Re-capture fixtures with
  `web/scripts/capture-paddle-tokens.mjs`.
- Specs: `docs/SCHEDULE-CELL-PARSING-SPEC.md` (step 4) is the SDD template to
  copy for the next step.

**The method (apply to every step, as steps 1–4 did)**
1. **SDD** — write a spec first (problem, desired behavior, invariants that must
   not regress, acceptance criteria as measurable numbers), like
   `docs/SCHEDULE-CELL-PARSING-SPEC.md`.
2. **TDD** — encode the acceptance criteria as tests against committed
   deterministic fixtures (capture real engine output once, commit it, so tests
   never need the engine); watch them fail, then implement to green.
3. **Adversarial review cycle** — spawn ≥3 subagents with ML/OCR experience and
   distinct lenses (methodology/eval-validity, parser correctness, test/spec
   rigor); fix every finding and re-review the SAME agents until all PASS. Round
   1 here was unanimous NEEDS-CHANGES and caught real bugs + overclaiming;
   budget for it.
4. **Cleanup** — `npm prune` the opt-in engines, clear `~/.cache`, remove temp
   files; the committed fixtures keep the suite runnable engine-free.
5. **Guard the invariants** — the shipped vector text-layer path must stay
   byte-for-byte unchanged (golden-28: 28 rows / 100% / 20 perfect / 0 dup); no
   conclusion is stated without an "n=1 / demo sheet" qualifier until the corpus
   has breadth.
