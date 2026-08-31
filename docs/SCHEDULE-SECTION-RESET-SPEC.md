# Spec — a dropped section header must not latch its category onto the next section's rows

Status: implemented (step 5a of `docs/SCHEDULE-OCR.md`, "category correctness").
This is the written spec the change was built against (SDD); its acceptance
criteria are encoded as tests (TDD) in `web/test/scheduleOcr.test.ts`
("blank-band section reset" block). Fixtures: the real PaddleOCR output at
`web/test/fixtures/schedule-ocr/material-schedule.paddle-{144,216,288}.json` plus
the vector `material-schedule.words.json`. **Every real-fixture figure here is the
one demo material schedule (n=1)** — see the corpus caveat under out-of-scope.

## Problem

Step 4 (`docs/SCHEDULE-CELL-PARSING-SPEC.md`) decoupled *row emission* from section
detection: a code-shaped first cell yields a row whether or not a section header was
seen. That stopped the silent row-dropping, but it *reshaped* the failure into a
category one, which step 4 named as out of scope and parked for here.

`parseSchedule` carries the current section forward across rows and only clears it at
a repeated table header. So when an OCR engine drops a **mid-table** section word —
the single most droppable token on the sheet, a standalone `BASE`/`WALLS`/`CEILINGS`
on its own line — the *previous* section's category **latches** onto every row
beneath it until the next detected header.

Measured (PaddleOCR PP-OCRv5 on the demo material schedule, reset OFF):

| DPI | sections detected | category acc | checked-and-wrong rows | what latches |
|---|---|---|---|---|
| 144 | FLOORING, MILLWORK, CEILINGS | 50.0% | 8 | BASE+WALLS rows read `floor`; MISC reads `ceiling` |
| 216 | (MISC only) | 57.7% | 1 | no latch — pure prefix inference (a different failure) |
| 288 | FLOORING, MILLWORK | 38.5% | 9 | BASE+WALLS read `floor`; CEILINGS+MISC read `other` |

A latched category is worse than a missing one *in a specific way*: the row is
emitted `suggested: true` (default-checked in the import dialog) with the wrong
color/hatch/waste, so a base row bids as `floor` **silently**. The primary goal is
to drive that **checked-and-wrong** count down — convert a confidently-wrong,
default-checked category into either the **correct** category (where the finish-code
prefix is unambiguous) or an **honest, unchecked `other`** that forces a look.

## The mechanism, and what actually measures it

**A dropped section header leaves its two neighbouring data rows adjacent, separated
by a blank band** — a vertical gap larger than the table's data-row pitch. The reset
keys on that gap measured relative to the pitch, with two guards that keep it off the
shipped vector path:

1. **It fires only between two ADJACENT data rows.** A *present* section header sits
   between its neighbours as a recognized section-label row, which breaks the
   data→data adjacency — so a band around a detected header is never a candidate. A
   dropped header leaves no such row, so its neighbours are adjacent and the band is
   seen.
2. **The pitch is the median of adjacent data→data gaps only** (a true median — the
   two central values averaged for an even count). It excludes header and
   section-band gaps, so a minority of dropped-header bands cannot inflate it.

Keyed on the pitch-relative gap, **never an absolute `k·h`**: the vector text layer
reports cap-height and PaddleOCR reports full glyph extent (the box-convention
mismatch noted in `docs/SCHEDULE-OCR.md`), so any absolute multiple that fires on an
OCR band also fires on vector rows.

**Measured gap distribution (below the header, relative to the data-row pitch):**

| source | largest non-section data→data gap | dropped-section bands |
|---|---|---|
| vector `words.json` | **1.06×** | 1.93–1.94× — but every one lands on a recognized section-label row |
| PaddleOCR 144 | 1.11× | RB-1 2.98×, others to 3.98× |
| PaddleOCR 216 | 1.13× | 2.97–2.99× |
| PaddleOCR 288 | 1.12× | **1.94× (above CT-4)**, others to 3.01× |

`K = 1.6` separates the two: on the demo sheet the largest non-section data→data gap
is 1.06× the pitch and the smallest dropped-section band is 1.94×. **This is a ~0.34
margin to the nearest firing band, not a wide valley** — the earlier "clean valley /
margin ≥1.1" framing was wrong, and gaps at 1.84–2.09× do fire. The constant is tuned
on n=1 and is not corpus-validated (step 5b). `MIN_GAP_SAMPLES = 4`: below four
adjacent data→data gaps the pitch is noise and the reset is disabled (step-4 behavior).

## Desired behavior

1. **A blank band between two adjacent data rows clears a stale section.** When the
   gap exceeds `K × pitch`, the current section is cleared (`section = ""`,
   `sectionCat = null`) before the current row is categorized. The row then takes its
   category from conservative prefix inference (step 4), else `other`.
2. **A detected section header still wins.** A present header is a section-label row,
   so it both breaks the adjacency (no false reset) and sets the category directly.
3. **The reset is a section-ATTRIBUTION change only.** It changes `section`,
   `category`, and the derived `suggested` flag — never which rows are emitted, and
   never a content cell (`finish_tag`/description/manufacturer/style/color/size). It
   acts only below the column header.

The reset is exposed behind `ParseOptions.sectionReset` (default `true`). The tests
pass `false` to measure its effect against the pre-reset parse; production always
runs it on.

## Invariants (must not regress)

- **The shipped vector path is byte-for-byte unchanged** — asserted by
  `parseSchedule(words, {sectionReset:false})` deep-equalling the default parse on the
  vector fixture. This holds **not because vector gaps are small** (a vector section
  boundary reaches ~1.94× the pitch) **but because those large gaps land on recognized
  section-label rows, which break the data→data adjacency the reset requires.** The
  golden-28 result is identical: 28 rows, 100% row recall, **100% category**, 20
  perfect, 0 duplicate tags. This is proven on n=1; see residual 1 for the layout that
  breaks it.
- **Emission and content are untouched at every DPI** — the off-vs-on parse yields an
  identical `finish_tag` list and identical content cells, and identical scored row
  recall/precision (asserted as equalities, not floors).
- **Tiny tables never reset** (`< 4` adjacent data→data gaps → pitch is `null`).
- **A detected section always wins over inference and over the reset.**

## Acceptance criteria (encoded as tests)

Off-vs-on differential on the PaddleOCR fixtures at 144/216/288 DPI:

- **checked-and-wrong never rises, and strictly falls where a stale section latches**
  (144: 8→0, 288: 9→0). This is the primary metric — it measures the honesty win the
  category % cannot see.
- **category accuracy never regresses**, and rises on the stale-latch DPIs (144:
  50.0→59.1%, 288: 38.5→53.8%). Per-DPI floors (0.55/0.55/0.50) pin it against silent
  regression. **This gain is narrow: it is exactly the rows whose code prefix is
  unambiguous** (RB/CBT→base, ACT→ceiling); the band detection contributes nothing to
  *this* number (a cruder threshold would score identically here). Its real work is
  the checked-wrong reduction above.
- **216 is genuinely unchanged** — the off-vs-on parse is deep-equal (no stale latch to
  clear). It is a regression pin, not a result the change moved.
- **the exact defect**: RB-1/CBT-1 read `floor` with the reset off and recover to
  `base` with it on (144 and 288), asserted with presence checks so neither pin is
  vacuous.

Plus unit tests: a dropped header + band (rows below shed the stale category); a
dropped header with NO band (residual 1 — still latches); a header-padding gap with a
section seeded above the header and ≥4 data rows (no spurious reset — the adjacency
guard); a present mid-table header (wins over the reset); the `<4-gaps` guard; and the
within-section false-fire residual below.

## Explicitly out of scope (but honestly named)

- **The pure-inference failure (216 DPI).** When *most* section headers are dropped,
  there is no stale section to clear — rows fall to prefix inference, and an ambiguous
  prefix (`PT`, `CT`, `P`, `SC`) honestly yields `other` where the true category was
  `floor`/`wall`. The reset neither helps nor hurts this (216's one checked-wrong row
  survives). Lifting it needs fuzzier section-word recovery or a category-confidence
  surface (below).
- **A category-confidence signal in the import dialog.** Marking every row whose
  category came from inference (not a detected section) so the dialog can prompt
  "verify category" — deferred: it touches the approval-dialog UI
  (`ImportSchedulePanel`/`TakeoffCanvas`), not the pure parser. Recommended as step
  5a-part-2; it is also the honest fix for the residuals below.
- **Corpus breadth.** `K = 1.6` and the `< 4` guard are tuned on one sheet (n=1). The
  *mechanism* (pitch-relative band detection between adjacent data rows) is
  layout-agnostic, but the constant and the ~0.34 margin are not corpus-validated —
  every additional vector schedule is free ground truth
  (`scripts/make-schedule-ocr-fixture.mjs` + a hand-authored golden); confirming the
  margin holds across sheets is step 5b.

### Residuals (recorded, some are net-negative — do not soft-pedal)

1. **A section whose header AND band both vanish is unrecoverable.** A densely packed
   table with no blank line between sections gives no band to key on, and the prior
   category latches. Pinned by the "no band still latches" test. Not observed on the
   test layouts (bands are 1.9×+ the pitch).
2. **A within-section band can FALSE-FIRE the reset — and the result can be a WRONG,
   default-checked category, not merely honest-unknown.** The reset cannot distinguish
   a dropped-header band from a legitimate large gap between two data rows of the same
   *detected* section (a wrapped multi-line remark that clusters as its own row, a
   spacer/subtotal line). After a false reset, prefix inference runs: an ambiguous
   prefix lands on `other` (a downgrade), but a code whose prefix *disagrees* with its
   true section becomes a confidently-wrong `suggested:true` bid — e.g. a floor-prefixed
   `RF-9` inside a `WALLS` section reads `floor`, checked. This is the exact failure the
   feature exists to prevent, reintroduced in a narrow layout; pinned by the
   "within-section band … can false-fire" test. Exposure on the demo sheet is zero
   (golden-28 unchanged), and the adjacency guard removes the far more common
   present-header false-fire, but the net-negative case is real and is the strongest
   argument for the deferred category-confidence surface.
3. **The pitch is contaminated on a majority-band layout.** If most sections are a
   single row with a dropped header, most adjacent data→data gaps *are* bands, the
   median rises to band size, and no reset fires — the feature silently no-ops on a
   layout it targets. A robust low-side statistic (a low percentile) would resist this;
   deferred pending a fixture that exhibits it.
4. **`K` is a single constant, not per-table adaptive** (residual 2 is its sharp edge).
   Corpus vetting (step 5b) is where a per-layout or learned threshold would be earned.
