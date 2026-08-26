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
field accuracy **91.7%**, perfect rows **14/28**. The entire gap is two known
limitations, pinned in `test/scheduleOcr.test.ts` so a fix shows up as a
deliberate test update:

1. **`MISC. FINISHES` is not in the section vocabulary** (`sectionKey` folds it
   to `MISCFINISHES`; the map has `MISC`), so its 6 rows inherit the previous
   section's `ceiling` category — category accuracy 78.6%.
2. **Remarks bleed into SIZE.** Grout and sheen notes (8 rows) sit nearer the
   SIZE anchor than the REMARKS anchor on this layout, so nearest-anchor
   banding smears them — size accuracy 71.4%.

### Noise sweep (vs clean parse — noise sensitivity in isolation)

25 seeds per point; input CER is measured, not assumed. Headline table
(`--seeds`/`--json` for more):

| char noise (nominal) | input CER | row recall | field acc | total collapses (0 rows) |
|---|---|---|---|---|
| 0.005 | 0.5% | 98.4% | 90.9% | 0/25 |
| 0.01 | 1.0% | 90.9% | 85.3% | 1/25 |
| 0.02 | 2.1% | 83.6% | 70.9% | 1/25 |
| 0.03 | 3.1% | 67.4% | 72.2% | 5/25 |
| 0.05 | 5.0% | 62.3% | 54.5% | 5/25 |

| word drop rate | detection recall | row recall | field acc |
|---|---|---|---|
| 1% | 99.0% | 95.4% | 95.9% |
| 5% | 94.8% | 92.3% | 84.0% |
| 10% | 89.8% | 87.3% | 75.7% |

### The finding that reorders the roadmap

**The current parser's noise budget is ≈ 0.5% CER** (row recall ≥ 95% and
field acc ≥ 90% hold only through the 0.005 sweep point), and failure is not
graceful: by 1% CER whole-parse collapses appear. The cliffs are structural,
not statistical:

- **Header anchors are single points of failure.** Corrupt the one `CODE`
  header word and `findAnchors` fails → the entire parse returns `[]`
  (pinned in the test suite). Same for losing both `MANUFACTURER` and `COLOR`.
- **Section words gate whole blocks.** A corrupted `FLOORING` drops every row
  until the next recognized section.
- **The code regex is exact.** `CPT-1` read as `CP7-1` fails
  `^[A-Z]{1,4}(-[A-Z0-9]{1,4})?$` and the row vanishes silently.

Printed-text OCR at 144 DPI realistically lands in the 1–5% CER range — above
this budget. So the highest-leverage next step is **not engine work**: it is
making the parser noise-tolerant (fuzzy header/section matching within edit
distance 1–2, a confusion-aware code matcher, anchor recovery from column
geometry when header words are damaged). That likely multiplies the budget
several-fold and every engine — Gemini included — benefits. It also directly
mitigates both absolute-baseline limitations (fuzzy section matching would
catch `MISC. FINISHES`).

## Roadmap (the experiment ladder)

1. ~~**Oracle sweep** — measure the CER budget.~~ Done, above.
2. **Parser hardening** — fuzzy anchors/sections/codes, re-run the sweep,
   watch the budget move. Cheap, engine-agnostic, measurable.
3. **Off-the-shelf ceiling** — PaddleOCR (official onnxruntime-web browser
   SDK) and `ocrs` (Rust→WASM, RTen) as `OcrEngine` adapters over rasterized
   fixture regions, scored by this same harness; include a DPI sweep
   (144 → 288 → 384) — `rasterizeRegion` never upscales today and small
   drafting text at 144 DPI is the likeliest failure mode.
4. **Browser deployability** — the winning engine inside a worker under the
   real constraint envelope (single-thread WASM SIMD / WebGPU), measuring
   seconds-per-schedule, memory, bundle + model weight.
5. **Only if a measured gap remains: fine-tune** a recognition model on
   synthetic schedule cells (mixed fonts/casings/sizes/degradations) and score
   the delta on held-out real scans.

The corpus needs breadth before step 3 means much: more vector schedules
(every one is free ground truth via the fixture script) and a handful of
genuinely scanned sets with hand-labeled golden rows — the only irreplaceable
asset in this plan.
