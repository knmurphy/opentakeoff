# Spec — a dropped section header must not latch its category onto the next section's rows

Status: proposed (step 5a of `docs/SCHEDULE-OCR.md`, "category correctness"). This
is the written spec the change is built against (SDD); its acceptance criteria are
encoded as tests (TDD) in `web/test/scheduleOcr.test.ts`
("blank-band section reset" block). Fixtures: the same real PaddleOCR output at
`web/test/fixtures/schedule-ocr/material-schedule.paddle-{144,216,288}.json` plus
the vector `material-schedule.words.json`.

## Problem

Step 4 (`docs/SCHEDULE-CELL-PARSING-SPEC.md`) decoupled *row emission* from section
detection: a code-shaped first cell yields a row whether or not a section header was
seen. That stopped the silent row-dropping, but it *reshaped* the failure into a
category one, which step 4 named as out of scope and parked for here.

`parseSchedule` carries the current section forward across rows and only clears it at
a repeated table header (`isHeaderRow`). So when an OCR engine drops a **mid-table**
section word — the single most droppable token on the sheet, a standalone
`BASE`/`WALLS`/`CEILINGS` on its own line — the *previous* section's category
**latches** onto every row beneath it until the next detected header.

Measured (PaddleOCR PP-OCRv5 on the demo material schedule, before this change):

| DPI | sections detected | category acc | what latches |
|---|---|---|---|
| 144 | FLOORING, MILLWORK, CEILINGS | 50.0% | BASE+WALLS rows read `floor`; MISC rows read `ceiling` |
| 216 | (MISC only) | 57.7% | no latch — pure prefix inference (a different failure, see below) |
| 288 | FLOORING, MILLWORK | 38.5% | BASE+WALLS read `floor`; CEILINGS+MISC read `other` |

A latched category is worse than a missing one *in a specific way*: the row is
emitted `suggested: true` (default-checked in the import dialog) with the wrong
color/hatch/waste, so a base row bids as `floor` **silently**. `other` and the
unchecked ceiling/`other` categories are honest — they force a look. The goal here
is to convert *confidently-wrong, default-checked* categories into either the
**correct** category (where the finish-code prefix is unambiguous) or an **honest
`other`** — never to leave a stale section confidently mislabelling the rows below a
gap where its own header used to be.

## Key measurement — the gap is only *relatively* bimodal

A section header (present or dropped) leaves a **blank band**: a vertical gap larger
than the gap between two data rows of the same section. But the ratio is NOT portable
across token sources, because the two sources measure token height `h` differently
(the vector text layer reports cap-height; PaddleOCR reports full glyph extent — the
box-convention mismatch already noted in `docs/SCHEDULE-OCR.md`). Measured gap between
consecutive clustered rows, **in units of row height** `h`:

- vector `words.json`: data-row gaps ≈ **2.2–2.45× h**, section headers ≈ 3.15× h;
- PaddleOCR fixtures: data-row gaps ≈ **1.3–1.8× h**, section bands ≈ 2.7–5.9× h.

So an **absolute** `k·h` threshold is unusable: any k that fires on an OCR band
(≈2.7×h) also fires on every vector data row (≈2.3×h) and would reset the section on
every row of the shipped path. What IS portable is the gap **relative to the median
data-row gap of the same table**:

- vector, **below the header row** (the only region resets act on): every gap is
  ≤ **1.36×** the table's median data-row gap;
- PaddleOCR: a dropped-section band is ≥ **2.7×** the median.

There is a clean valley between them. The rule keys on median-relative gap with
`K = 1.6` (centred in the valley, margin ≥ 0.24 on the vector side and ≥ 1.1 on the
OCR side, on this sheet — see the n=1 caveat below).

## Desired behavior

1. **A blank band clears a stale section.** While reading data rows below the header,
   if the vertical gap from the previous row to the current row exceeds `K ×
   medianDataGap` **and** the current row is not itself a detected section header,
   the current section is cleared (`section = ""`, `sectionCat = null`) before the
   current row is categorized. The row then takes its category from conservative
   prefix inference (as step 4 already does when no section is active), else `other`.
2. **A detected section header still wins.** If the row after the band IS a section
   header (`asSectionRow`), the existing path sets the new section; the reset is a
   harmless no-op that the header immediately overrides. Category still comes from a
   real header whenever one survived detection.
3. **The reset only acts below the column header,** on the same rows step-4 emission
   already governs. It never touches title/legend rows above the header, and never
   changes which rows are emitted — only their `category`/`suggested`.

## Invariants (must not regress)

- **The shipped vector path is byte-for-byte unchanged.** On a vector schedule every
  data-row gap below the header is ≤ 1.36× the median, so `K = 1.6` means the reset
  **never fires** below the header. The golden-28 result is identical to pre-change:
  28 rows, 100% row recall, **100% category**, 20 perfect, 0 duplicate tags. Pinned.
- **Row emission is untouched.** The reset changes only `category`/`suggested`. Row
  recall, precision, and the emitted `finish_tag` set are identical with the reset on
  or off, at every DPI. Pinned by asserting the emitted-tag lists match across a
  reset-off/reset-on parse of the same fixtures.
- **Tiny tables never reset.** The median needs a stable sample; with fewer than 4
  data-row gaps the reset is disabled and behavior is exactly step 4's. This keeps
  the small synthetic fixtures (`a data row with NO section header above it…`, the
  negative tests) behaving as before.
- **A reset never overrides a detected section**, and **prefix inference never
  overrides a detected section** (unchanged from step 4). Inference fills gaps only.

## Acceptance criteria (encoded as tests)

On the captured PaddleOCR fixtures at 144/216/288 DPI, versus the pre-change parse:

- **category accuracy strictly improves in aggregate** and regresses at no DPI:
  144 ≥ 55% (was 50.0%, measured 59.1%), 288 ≥ 50% (was 38.5%, measured 53.8%),
  216 unchanged within tolerance (no stale latch to fix there);
- **no confidently-wrong latch survives a band**: the base rows under the dropped
  `BASE` header (`RB-1`, `CBT-1`) read `base`, not `floor`, at 144 and 288 DPI —
  a targeted per-row assertion, since it is the exact defect;
- **row recall, precision, and the emitted tag set are identical** to the pre-change
  parse at every DPI (the reset is category-only);
- the **golden-28 vector invariant** above, re-asserted with the reset live.

Plus unit tests for the rule itself: a synthetic table where a mid-table section
header is dropped but the band remains → rows below the band do NOT inherit the prior
category; a synthetic with a uniformly-spaced vector-like table → no reset fires; the
`< 4 gaps` guard disables the reset on a 2-row table.

## Explicitly out of scope (but honestly named)

- **The pure-inference failure (216 DPI).** When *most* section headers are dropped,
  there is no stale section to clear — rows fall to prefix inference, and an ambiguous
  prefix (`PT`, `CT`, `P`, `SC`) honestly yields `other` where the true category was
  `floor`/`wall`. The reset neither helps nor hurts this; lifting it needs either
  fuzzier section-word recovery or the category-confidence surface below. This is why
  216 is asserted "unchanged," not "improved."
- **A category-confidence signal in the import dialog.** The natural companion —
  marking every row whose category came from inference (not a detected section) so the
  dialog can prompt "verify category" — is deferred: it touches the approval-dialog UI
  (`ImportSchedulePanel`/`TakeoffCanvas`), not the pure parser, and carries no
  harness-measurable number. Recommended as step 5a-part-2 once this lands.
- **Corpus breadth.** `K = 1.6` and the `< 4 gaps` guard are tuned on the one demo
  sheet (n=1). The *mechanism* (median-relative band detection) is layout-agnostic,
  but the constant is not yet corpus-validated — every additional vector schedule is
  free ground truth (`scripts/make-schedule-ocr-fixture.mjs` + a hand-authored
  golden), and confirming the valley holds across sheets is step 5b. No conclusion in
  the tests is stated without the "demo sheet only" qualifier.

### Non-blocking residuals (recorded)

1. **A section whose header AND band both vanish is unrecoverable here.** If an engine
   drops the header word *and* the row spacing gives no larger gap where it sat (a
   densely packed table with no blank line between sections), no band exists to key on
   and the prior category still latches. Not observed on the test layouts; the bands
   are consistently 2.7×+ the median. A different signal (a section-word *near-miss*,
   or column-content shift) would be needed, out of scope.
2. **`K` is a single constant, not per-table adaptive.** A table with unusually
   variable legitimate row spacing (multi-line wrapped remarks throughout) could push
   a legitimate gap over `1.6×` median and reset a section early — turning a correct
   inherited category into `other`. Strictly a downgrade to honest-unknown, never to a
   *wrong* confident category, and unobserved here; flagged for corpus vetting.
