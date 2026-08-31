# Spec — flag an INFERRED category so the import dialog can ask for a look

Status: proposed (step 5a-part-2 of `docs/SCHEDULE-OCR.md`). SDD; acceptance
criteria encoded in `web/test/scheduleOcr.test.ts` and `web/test/scheduleScan.test.ts`.

## Problem

Step 5a (`docs/SCHEDULE-SECTION-RESET-SPEC.md`) stops a dropped section header from
latching the *wrong* confident category onto the rows beneath it — but the honest
residuals it leaves are all the same shape: **a category the parser GUESSED rather
than READ from a section header**. Three cases produce a guessed category:

1. a row with no active section (the reset cleared it, or none was ever detected):
   category comes from finish-code prefix inference, else `"other"`;
2. the 216-DPI pure-inference miss (most headers dropped) — the same as (1);
3. the within-section false-fire (5a residual 2): a reset clears a *correct*
   detected section, and prefix inference can then produce a **wrong, checked**
   category.

In every case the row still arrives in the import dialog `suggested` per its
(guessed) category — default-checked with a color/hatch/waste the estimator never
confirmed. The category % can't tell a read category from a guessed one, and neither
can the estimator looking at the dialog. **The fix is not more guessing — it is to
mark a guessed category as guessed and surface that in the dialog**, so the one human
beat (glance, fix, uncheck, Create) includes "verify this category."

## Desired behavior

1. **`ScheduleRow` carries `category_inferred?: boolean`.** `true` means the category
   did NOT come from a detected section header (prefix inference or `"other"`);
   absent/`false` means it was read from a section. Optional, so it defaults to
   "confident" — no existing row literal or server payload needs to change, and a row
   that never sets it reads as confident (today's behavior, no false "verify" noise).
2. **The parser sets it from section provenance.** At the point of categorization,
   `category_inferred = (no active detected section)`. A detected section (present, or
   seeded above the header) → `false`. A reset row, a never-sectioned row, a
   pure-inference row → `true`. On the shipped vector path every row is under its
   section, so every row is `false` — the flag is invisible there.
3. **The scan path preserves it.** `normalizeScanRows`/`toRow` trusts a server-sent
   boolean and otherwise defaults `false` (the server VLM reader has its own
   reliability; our parser's inference uncertainty is the thing this flag names).
4. **The dialog surfaces it, non-destructively.** A row whose category is inferred
   shows a subtle "verify" marker. It does NOT change whether the row is checked
   (`suggested` is unchanged), does NOT drop or reorder rows, and does NOT block
   Create — it only makes the guess visible, so the residual-2 wrong-checked category
   is now something the estimator can catch.

## Invariants (must not regress)

- **The shipped vector path is unchanged, flag included.** Every golden-28 row is
  `category_inferred:false`; the parse (emission, category, suggested) is byte-for-byte
  as before. The 5a off-vs-on differentials still hold, and adding the flag does not
  change any category or which rows emit.
- **`suggested` is untouched.** The checkbox defaults are exactly step-5a's; the flag
  is advisory only.
- **The type stays backward-compatible.** `category_inferred` is optional; existing
  `ScheduleRow` literals and `/ai/parse-schedule` payloads keep compiling and parsing.

## Acceptance criteria (encoded as tests)

Parser (`scheduleOcr.test.ts`):
- vector golden-28: no row is `category_inferred:true` (all read from sections);
- a synthetic detected-section row → `false`; a no-section row → `true`; a reset row
  (dropped header + band) → `true`;
- on the PaddleOCR fixtures, every row the reset clears (and every pure-inference row)
  is flagged `true`, and every row under a surviving section is `false` — asserted
  against the section-provenance, not a hardcoded count.

Scan (`scheduleScan.test.ts`):
- `toRow` defaults `category_inferred` to `false` when the server omits it;
- a server-sent `category_inferred:true` is preserved.

Dialog: no unit harness exists (the panel is view-only, per its header comment). The
marker is driven by the single boolean `row.category_inferred`; the decision logic has
no branch worth a test beyond the field read. Verified by a real render in the app.

## Explicitly out of scope

- **Editing the category in the dialog.** The panel edits `finish_tag`, not category;
  letting the estimator RE-CATEGORIZE a flagged row is the natural follow-on but is a
  larger dialog change (a per-row category picker) — deferred.
- **Un-checking inferred rows by default.** Tempting, but it would hide rows the
  estimator wants and change the step-5a checkbox contract; the flag is advisory.
- **A confidence for the scan/VLM path.** The server reader could send its own
  per-row confidence; this spec only plumbs the field through, it doesn't compute one.
