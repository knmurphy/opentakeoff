# OCR evaluation doctrine

Normative. If an OCR evaluation in this repo does not follow this doc, its numbers do not get
cited—in a PR, a doc, or an issue. The doc exists because the alternative already happened
twice: two independent benchmark harnesses published "scores" of zero for a working engine,
and a cross-engine comparison reached a conclusion its own method could not support.

## The instrument

One scorer: `web/src/lib/ocr/score.ts`. Two layers, because attribution beats a single number:

- **Word layer** (`matchWords`): one-to-one greedy box matching, best IoU first, floor 0.5;
  detection recall/precision; and **corpus CER over matched pairs only** (total edits over
  total reference length—never a per-string mean, which short strings would dominate). This
  separates "the engine never saw that cell" from "it read SDT-334 as SDT-384".
- **Row layer** (`scoreRows`): rows matched by key field as a multiset; a misread key is a
  **vanished row, not a typo**, mirroring what downstream code actually does with the row.

One oracle: `web/src/lib/ocr/noise.ts` (`degradeWords` + `mulberry32`), for evaluating
parsers decoupled from any engine—seeded, OCR-shaped noise (glyph confusions weighted toward
the classic pairs, deletions, insertions, whole-word drops), deterministic per seed.

Nobody invents a second instrument. The one time this rule was broken—a bag-of-tokens CER on
different regions—it produced a verdict ("the CER gap is a DPI artifact") that re-measurement
with this scorer overturned. If the instrument lacks a metric you need, extend the instrument
and its tests; do not build a rival.

Retrieval-shaped efforts (plan search) are not OCR: they use their own retrieval instrument
(term-recall per sheet over the index's own tokenization) under the same rules below. See
`docs/PLAN-INDEX-RECALL.md` for the precedent.

## The rules

1. **Cross-engine claims only at matched inputs.** Same DPI, same preprocessing, same
   regions. Best-vs-best comparisons are not comparisons. Sweep DPI—never assume it:
   segmentation modes are DPI-chaotic, and one mode that looked fine at a fixed 288 DPI
   collapsed to 0.385 recall under the app's auto-estimated DPI while producing zero tokens
   at 144 on sparse regions.
2. **Ground truth is authored, and precision is split by ink.** Golden rows are transcribed
   verbatim as printed (source typos included) with semantic fields (category) following what
   the sheet *means*—see `web/test/fixtures/schedule-ocr/README.md` for the authoring rules;
   regenerate the word fixtures with `node --import tsx
   scripts/make-schedule-ocr-fixture.mjs`. Score only GT tokens whose glyphs are fully inside
   the crop, and split precision into on-GT-ink / other-ink / blank (bench-harness
   methodology—`score.ts` itself scores what matched)—an engine that reads
   *more* real ink than the GT covers must not be punished as a hallucinator, and on-blank is
   the honest hallucination rate.
3. **Zero words on known-inky input is an error, not a score.** tesseract.js ≥7 removed flat
   `data.words` (words live under `data.blocks[].paragraphs[].lines[].words[]` only); the
   silent zero it produced looked like a measurement and zeroed two independent benches.
   Every harness canaries this before publishing anything.
4. **Measured claims require a reproduction pass.** Someone other than the author re-runs the
   bench; the numbers must agree field-for-field. Review that does not re-run the numbers is
   exactly the review that missed the zeroed arm for months.
5. **CI protects captured fixtures; live engines stay out of CI.** Commit engine-output
   captures next to golden rows and assert the scored behavior in `node:test`—CI then fails
   when a *new capture* regresses, without ever installing an engine. Live-engine benchmarks
   are manual: every published table carries its date and a regenerate command.
6. **Timing is measured where it runs.** Node timings do not transfer to the browser worker.
   Timing claims need repeats, warm/cold separation, and browser-runtime measurement. n=1 is
   acceptable for *accuracy* only because the engines are deterministic—it is worthless for
   timing.
7. **State the corpus.** Today every OCR number in this repo is n=1 (the demo plan's
   schedules and title blocks). Say so where the number is published; do not let a demo-plan
   percentage read as a corpus result.

## Where the numbers live

| Measurement | Doc | Regenerate |
|---|---|---|
| Schedule engine head-to-head, matched DPI | `docs/OCR-ENGINES-HEAD-TO-HEAD.md` (copy-text branch) | `npm i -D tesseract.js@7.0.0 ppu-paddle-ocr@6.4.3 onnxruntime-node @napi-rs/canvas@0.1.100 && node scripts/ocr-engines-h2h.mjs public/demo/sample-finish-plan.pdf` |
| Schedule parser oracle + captures | `docs/SCHEDULE-OCR.md` (schedule-OCR branch) | `node --import tsx scripts/schedule-ocr-engine-benchmark.mjs` |
| Plan-index term recall | `docs/PLAN-INDEX-RECALL.md` (search branch) | `node --import tsx scripts/plan-index-recall-bench.mjs` |

Each table is dated where it is published. A number without a regenerate command is a rumor.
