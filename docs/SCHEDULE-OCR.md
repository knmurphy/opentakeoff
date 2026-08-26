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

## Roadmap (the experiment ladder)

1. ~~**Oracle sweep** — measure the CER budget.~~ Done, above.
2. ~~**Parser hardening** — fuzzy anchors/sections/codes, re-run the sweep,
   watch the budget move.~~ Done: the collapse cliff is gone and the
   row-survival budget doubled (before/after above). Remaining hardening the
   sweep still points at — anchor recovery from column geometry when a header
   word is *dropped* (not just corrupted), and fixing the remarks→SIZE
   geometry — is deferred behind engine evaluation, since dropped-word
   robustness matters less once a real engine's detection recall is known.
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
