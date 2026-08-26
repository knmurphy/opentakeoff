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

- **The clean vector text-layer path is byte-for-byte unchanged.** On a vector
  schedule every section header is present and in order, so `section` is always
  set before each data row → category comes from the section, prefix inference
  is never consulted, and the header row is skipped as before. The existing
  `scheduleParse.test.ts` suite and the golden-28 fixture test stay green
  untouched.
- **Nothing is invented.** No table header (anchors) → `[]`. Junk stays `[]`.
  A lone number is still never a code. The header-structure gate is the only
  thing that authorizes rows; that gate is unchanged.

## Acceptance criteria (encoded as tests)

- On the captured PaddleOCR fixtures, **row recall ≥ 75% at ALL of 144/216/288
  DPI**, and the 216 case specifically rises from 17.9% to ≥ 75% — i.e. the
  section-header collapse is gone and recall is bounded only by the engine's
  code-cell read rate, not by section-detection luck.
- A synthetic schedule whose first section header is missing still yields every
  data row (the minimal regression test for the gate removal), with pre-section
  rows categorized by prefix inference or `"other"`.
- All pre-existing parser tests pass unchanged.

## Explicitly out of scope

- **Stale-section categories.** When a middle section header is missed, rows
  inherit the previous section's category (a base row can read as `floor`).
  Fixing this needs section-*boundary* signal the OCR output doesn't provide;
  it is pre-existing, unchanged here, and category is editable in the dialog.
- **Misread finish tags.** `CT-2` read as `C-2` is an engine CER problem; the
  row still emits under the misread tag. Recovering it is a scoring/fuzzy-tag
  concern, not this parser change.
