# Schedule-OCR ground truth

Fixtures for the browser-OCR evaluation harness (`docs/SCHEDULE-OCR.md`).

- `<id>.words.json` — **machine-extracted, regenerable**: the vector text layer
  of one schedule "marquee", as positioned words (`{str,x,y,w,h}`, image px at
  `RENDER_SCALE`, y = baseline). Regenerate with
  `node --import tsx scripts/make-schedule-ocr-fixture.mjs`. Because the source
  region is vector, this text is *perfect* ground truth for any OCR engine that
  reads the same region rasterized.
- `<id>.golden.json` — **hand-authored, never regenerated**: the true
  `ScheduleRow[]` for the same table, transcribed from the printed sheet.
  Authoring rules: text is verbatim as printed, source typos included
  (`SHERWIN WILLIALS`, `CERAMC`, `ACOUSTIAL` are all really printed that way);
  REMARKS-column content (grout notes, sheen notes) is excluded because
  `ScheduleRow` has no remarks field; `category`/`suggested` follow what the
  section header *means*, not what today's parser produces — so golden scoring
  measures absolute correctness and known parser limitations show up as a
  stable, documented gap (see the oracle baseline in `docs/SCHEDULE-OCR.md`).

Cases:

| id | source | page | what it is |
|---|---|---|---|
| `material-schedule` | `demo/sample-finish-plan.pdf` | 2 | The VA renovation set's MATERIAL SCHEDULE — 28 rows, 6 sections, mixed-case remarks, a lone-letter code, blank cells. |
