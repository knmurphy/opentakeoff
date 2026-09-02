# Plan-index recall — measured

*Measured 2026-09-01 on `claude/client-side-ocr-search-index-n699t0` @ the bench commit, by
`web/scripts/plan-index-recall-bench.mjs` (regenerate: `cd web && node --import tsx
scripts/plan-index-recall-bench.mjs --json out.json`). Corpus: n=1, the demo plan
(`sample-finish-plan.pdf`, 2 pages, 2,105 tokens) — acceptable for accuracy because the
pipeline is deterministic; worthless for timing, which this bench does not measure.*

## What was never measured, now is

The search index shipped on this branch had no published recall numbers. This bench measures
it through the app's actual ingest path (`extractRegionText` full-rect → `buildSheetIndex`,
viewport at `RENDER_SCALE`, exactly `TakeoffCanvas.indexSheetText` / `PlanNavigator`), with
ground truth derived from **raw pdf.js items** through the index's own term pipeline
(`splitRun` → `normalizeTerm` → `expandTerm` → `isSearchable`).

## Results

| Instrument | Result |
|---|---|
| A. Raw-pipeline coverage (GT vs index vocabulary) | 100% (764/764) |
| B. Per-sheet term recall (`searchPlan([sheet], T)`) | 100% (0 misses / 764) |
| C. Whole-set term recall (owning sheet in results) | 100% (0 misses / 764) |
| D. Typed variant: lowercase | 100% (764/764) |
| D. Typed variant: space-for-hyphen ("CPT 1") | 73.13% (49/67) |
| D. Typed variant: no-hyphen ("CPT1") | 0% (0/67) |
| D. Typed variant: drop-last-char | 100% (764/764) |
| E. Junk false-positive rate | 0% (0/577) |
| Determinism (page-1 rebuild, `builtAt` pinned 0) | JSON-identical |
| pdf.js legacy/main build parity | verified: identical item strings |

Populations differ by design: A/B/C denominators count terms **per sheet** (a term on both
sheets counts twice — 359 + 405); E queries come from the plan-wide **distinct** vocabulary.

## What each number honestly proves

A, B, and C are **narrow regression pins on specific code paths**, not general empirical
retrieval validation: GT terms run through the same term functions the index uses, so A
isolates `extractRegionText`'s rect/blank filter (764 and 688 runs in, 764 and 688 out —
nothing dropped), B is an exact-key round trip through `matchTerm`'s exact-hit branch, and C
adds only cross-sheet membership — presence in results, **not ranking** (a sheet buried last
still reads 100%). They are worth publishing because they were worth proving: the same class
of pipeline that silently zeroed two OCR benches could have dropped runs here, and now a
regression fails loudly instead of publishing a lower number.

D is where honest losses live, and both are design surfaces, not accidents:

- **Space-for-hyphen (73.13%).** Searching "CPT 1" issues an AND over `CPT` and `1`; `1` is
  not a searchable term, so the miss is structural. The 49 hits are terms whose two halves
  also appear independently on the sheet (both AND tokens resolve). A user who types the
  space form finds the sheet only when the pieces were drawn separately.
- **No-hyphen (0%).** `normalizeTerm` deliberately preserves interior `-`, `.`, `/`, `#`
  because they are load-bearing on plan codes ("CPT-1", "S1.1"); there is no
  hyphen-collapsing normalization anywhere, so "CPT1" never matches "CPT-1". Recorded here
  so the upstream issue pairs the number with the rationale instead of receiving a bare 0%
  and a duplicate "fix hyphen search" bug report against an intentional tradeoff.

Slash-callout halves ("PT-1" from "PT-1/PT-2") are **not** a variant class: `expandTerm`
pre-indexes each part at build time, so querying a part is an exact hit on existing
vocabulary — already covered by A/B, and restating it as a variant would claim a proof it
isn't.

## Canaries

A page with text items whose strs are all blank is an error, not a score. A page with no
text items at all is recorded as text-less and excluded from every denominator (the demo
plan has none). Zero GT terms across a whole plan is an error.

## Limitations, stated

n=1 corpus. No plural/trailing-s variant class. No cross-run adjacent-phrase query (two
words drawn as separate pdf.js items — "PATIENT ROOM" as two runs). Ranking quality is
unmeasured (C checks membership only). The determinism probe rebuilds page 1 only.
