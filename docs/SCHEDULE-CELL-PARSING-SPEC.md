# Spec — schedule parsing must not lose rows to a missing section header

Status: implemented (step 4 of `docs/SCHEDULE-OCR.md`). This is the written spec
the change was built against (SDD), and the acceptance criteria its tests encode
(TDD). Companion tests: `web/test/scheduleOcr.test.ts`
("cell-level / section-independent" block). Fixtures: real PaddleOCR output at
`web/test/fixtures/schedule-ocr/material-schedule.paddle-{144,216,288}.json`.

## Problem

`parseSchedule` (`web/src/lib/scheduleParse.ts`) gates every data row on a
previously-detected **section header**: `if (!section || !looksLikeCode(...))
continue`. Section headers in a real schedule are standalone single words
(`FLOORING`, `BASE`, `WALLS`, `MILLWORK`, `CEILINGS`, `MISC. FINISHES`) sitting
on their own line — the single easiest thing for an OCR detector to miss, and it
misses them unpredictably across render DPI.

Measured (Experiment 3, PaddleOCR PP-OCRv5 on the demo material schedule): the
data rows are detected fine at every DPI, but section-header detection is
erratic, so row recall swings **17.9%–92.9%**. At 216 DPI PaddleOCR emitted only
`MISC. FINISHES` as a standalone header; `section` stayed `null` through the
whole table above it, and **22 correctly-detected rows were silently dropped** —
not because their text was unreadable, but because the word above them wasn't.

A lost row is silent data loss (it never reaches the approval dialog). Gating it
on the single most-droppable token on the sheet is the wrong dependency.

## Desired behavior

1. **A row's existence does not depend on a section header.** Inside a detected
   table (the header row with column anchors was found), any row whose first
   cell is code-shaped yields a `ScheduleRow`, whether or not a section header
   preceded it.
2. **Section headers still drive `category` when present.** A detected section
   sets the current category for the rows beneath it, exactly as before.
3. **When no section is active, category is inferred conservatively** from the
   finish-code's alpha prefix (a small, documented map of *unambiguous*
   flooring-trade prefixes: `CPT/VCT/LVT…→floor`, `RB/CBT→base`, `ACT→ceiling`),
   and falls back to `"other"` (unsuggested) when the prefix is ambiguous
   (`PT`, `CT`, `P`, …) or unknown. Guessing is never allowed to *override* a
   detected section — inference fills gaps only.
4. **The header row is never emitted as data.** Previously the `!section` gate
   incidentally skipped it (section is null at the header); now that the gate is
   gone, the header row and anything above it are skipped explicitly.

## Invariants (must not regress)

- **The golden vector fixture is unchanged (verified), and the clean vector path
  is preserved for the real layouts we test.** On a vector schedule every
  section header is present and in order, so `section` is set before each data
  row → category comes from the section, prefix inference is never consulted,
  and the header row is skipped. The golden-28 test still yields 28 rows, 100%
  recall, 100% category, 20 perfect, 0 duplicate tags — identical to pre-change.
  A section label sitting *above* the column header is explicitly handled (the
  parser seeds the section from rows above the header index), pinned by a test,
  so that layout does not silently fall to prefix inference.
- **Nothing is invented.** No table header → `[]`. A repeated header (a second
  stacked table) never emits a `CODE` row. A code-shaped cell only becomes a row
  if it fills the CODE column PLUS at least one other (a lone revision bubble
  `A` or a stray `GC` note fills one column and is rejected). A lone number is
  never a code. A finish code whose alpha prefix is a section word (`BASE-1`) is
  NOT eaten as a section — it carries a dash-suffix that a bare section label
  never has. Each of these is pinned by a negative test.

## Acceptance criteria (encoded as tests)

Not a single exact-tag recall number (it double-charges the parser for the
engine's code-cell CER). On the captured PaddleOCR fixtures at 144/216/288 DPI:
- **rows emitted ≥ 24/28** — the gate removal keeps producing rows;
- **fuzzy-tag recall (edit ≤ 1) ≥ 87%** — rows are emitted and matchable modulo
  the engine's tag CER;
- **row precision ≥ 85%** — the gate removal did not open the floodgates to junk;
- **category ≥ 35%, pinned as a documented-BAD characterization** — so the known
  gap (below) is visible in the suite and cannot silently regress to zero or be
  hidden behind a blended average;
- **the collapse is gone**: min exact recall ≥ 78% and the across-DPI spread
  ≤ 20 pts (was 75 pts, 17.9%→92.9%).

Plus: negative tests for every "nothing is invented" clause above, a
missing-first-section synthetic, a section-above-header synthetic, and the full
pre-existing parser suite unchanged.

## Explicitly out of scope (but honestly named)

- **Stale-section categories — and note this change *reshapes* the failure, it
  does not leave it untouched.** Before, a missed mid-table section header
  *dropped* every row beneath it (silent data loss). Now those rows are
  *emitted* but inherit the previous section's category (a base row reads as
  `floor`) and come back `suggested:true`, so they are default-checked in the
  import dialog with the wrong color/hatch/waste. That is a strictly better
  failure (a visible, editable row beats a missing one) but it is a NEW
  population of miscategorized rows, not an unchanged one. Measured category on
  the OCR path is 38–58%. Fixing it needs section-*boundary* signal the OCR
  output doesn't provide (e.g. clearing the section at a blank band, or a
  confidence flag on inferred categories surfaced in the dialog).
- **Misread finish tags.** `CT-2` read as `C-2` is an engine CER problem; the
  row still emits under the misread tag. The harness now reports fuzzy-tag
  recall to separate this from parser behavior; recovering the tag in
  production (so `normalizeScanRows` doesn't drop it) is future parser work.

### Non-blocking residuals (recorded, adversarial review round 2)

Known limits of the fixes above, none affecting the shipped vector path or the
acceptance criteria:

1. **The `filled < 2` junk gate drops a code-ONLY row.** A row where the engine
   read only the CODE cell (or whose other cells all banded into CODE) is
   dropped — the deliberate recall/precision trade that suppresses lone-token
   junk. A row with just a tag carries no takeoff value anyway.
2. **A bare, unsuffixed section-word code is still absorbed as a section.**
   `BASE`/`WALL`/`TRIM`/`FLOOR` as a lone first cell (no dash-suffix) is read as
   a section header, so no row. Real finish tags almost always carry a suffix
   (`RB-1`), so exposure is low; the dash guard only rescues suffixed codes.
3. **A multi-word note that bands across ≥ 2 columns can still emit a row**
   (`GC TO VERIFY ALL` → a `GC` row). The `filled ≥ 2` gate stops lone notes,
   not prose that spreads across the table; it surfaces in `rowPrecision`.
4. **`clusterRows` tolerance keys off the incoming token's height**
   (`tol = max(h·0.6, 4)`), so an unusually tall cell box (a wrapped multi-line
   remark) that sorts first in a row could merge it upward. Not observed on the
   test layouts; a latent PaddleOCR cell-box hazard.
