# #483 PR A: measured expected vs observed

**Head** is `fix/483-schedule-reader-gaps`. The reader code is at `4fef1918`; the head checkout measured was `b0e458d4`, which adds only a docs line on top. **Base** is upstream main `60c82e34`.

Only public inputs were used: the bundled demo `web/public/demo/sample-finish-plan.pdf`, every tracked `mcp/test/fixtures/*.pdf`, and the synthetic twins in `web/test/fixtures/reader483Fixtures.ts`. All of these PDFs except `reader483-set.pdf` (new in this PR) are byte-identical at base and head. The span extraction is unchanged too: `pageSpans.ts`, `sheets.ts`, `textjoin.ts` and `mcp/src/pdf.ts` have no diff.

The scripts live in `repro/`. Each tree's reader is loaded by path, so the same script measures both trees:

- `measure.mts` writes every read for one checkout as JSON.
- `compare.mts` diffs the two JSON files and checks them against the PR's own oracles: the committed goldens, `expectedChanges`, and the reader483-set rows that `mcp/test/scheduleImport.test.ts` asserts.

## Reproduce

```bash
HEAD=$PWD                                   # this branch's checkout
REPRO=<path to repro/>
git worktree add --detach /tmp/base-483 60c82e34
(cd /tmp/base-483/web && npm ci) && (cd /tmp/base-483/mcp && npm ci)
cp $HEAD/web/test/fixtures/reader483Fixtures.ts /tmp/base-483/web/test/fixtures/   # for (c) only; it imports only exports base already has
(cd $HEAD/mcp && node --import tsx $REPRO/measure.mts $HEAD $HEAD $REPRO/out/head.json)
(cd /tmp/base-483/mcp && node --import tsx $REPRO/measure.mts /tmp/base-483 $HEAD $REPRO/out/base.json)
rm /tmp/base-483/web/test/fixtures/reader483Fixtures.ts
(cd $HEAD/web && node --import tsx $REPRO/compare.mts $HEAD $REPRO/out/base.json $REPRO/out/head.json)
# the PR's own oracle tests for (a)-(c):
(cd $HEAD/mcp && node --import tsx --test --test-name-pattern "reader483-set|#483 golden" test/scheduleImport.test.ts)   # 10/10 pass
(cd $HEAD/web && node --import tsx --test test/reader483Goldens.test.ts test/expectedChanges483.test.ts)                  # 66/66 pass
```

The output of `compare.mts` is saved as `repro/out/measured-tables.md`. Every number below is copied from it.

## Summary

| Row | Expected | Observed | Unexplained diff |
|---|---|---|---|
| (a) Demo MATERIAL SCHEDULE marquee, table box and page box | Base and head read the same rows, field for field | 28 = 28 rows, keys identical, every `readScheduleSpans` field identical, `readFinishTable(marquee)` identical, head = committed golden — in both boxes | none |
| (b) `reader483-set.pdf` A-601 / A-602 / A-603, table box and page box | the rows asserted by `mcp/test/scheduleImport.test.ts` (14 + skipped SEAL / 0 + skipped EPOX, CONC, SEAL / 4) | all 6 reads are as expected, every field (`key_rule`, `unticked_reason` and `not_used_text` included) | none |
| (c) 31 characterization twins, every entry point | whole-sheet twins unchanged; changes only where `expectedChanges` lists them | 27 byte-identical, 4 changed. Each changed twin equals its expected read, and only the marquee `readScheduleSpans` / `parseSchedule` entry points change. The base read equals the committed golden for all 31 | none |
| (d) Whole-sheet `buildSheetGraph`, 11 PDFs, 23 pages | identical | identical for all 11 (tables, rows, rooms, notes, every field) | none |
| (e) Drawn-box sweep: 14 table regions + 23 page boxes | identical except where a newer rule applies | 32 identical (each listed with its base/head read); 5 differ, all on `reader483-set.pdf`, each tied to a rule below | none |
| (f) Test totals | no failures | web 2,734 → 2,998 tests (0 fail, 3 skipped at both); mcp 274 → 286 (0 fail) | none |

## (a) Demo marquee

| Box | rows base | rows head | keys identical | every field identical | readFinishTable identical | head = golden |
|---|---|---|---|---|---|---|
| table box (2950,250)–(4720,1900) | 28 | 28 | true | true | true | true |
| page box | 28 | 28 | true | true | true | true |

These numbers are computed by deep-equality of the full JSON reads, not by comparing codes alone.

## (b) reader483-set.pdf

| Sheet | box | expected rows | observed (head) | skipped expected / observed | every field as expected | base (reference) |
|---|---|---|---|---|---|---|
| A-601 | table | 14 | 14 | SEAL / SEAL | true | 9 rows: CPT-1, CPT-3SAT, CPT-3EGG, LVT-1, VCT-1, RB-1, P-1SAT, P-2, CG-1 |
| A-601 | page | 14 | 14 | SEAL / SEAL | true | same 9 |
| A-602 | table | 0 | 0 | EPOX, CONC, SEAL / same | true | refused: no-table |
| A-602 | page | 0 | 0 | EPOX, CONC, SEAL / same | true | refused: no-table |
| A-603 | table | 4 | 4 | none / none | true | 3 rows: CPT-1, RB-1 (`RUBBER BASE EPOXY FLOORING`), PT-1 |
| A-603 | page | 4 | 4 | none / none | true | same 3 |

## (c) Twins

There are 31 twins. 27 are byte-identical at base and head through every entry point: `extractTable`, `readFinishTable(marquee)`, the graph's tables and notes, `resolveTag`, `readScheduleSpans` and `parseSchedule`. The four span-shape controls are identical too. Base reads equal the committed goldens for all 31; the goldens were captured at `7e70bec8`, and #487 merged in between without changing any twin.

| Changed twin | entry points that changed | change kinds (expectedChanges) | head = expected read |
|---|---|---|---|
| both-short-cpt-rb-epox-pt | marquee.readScheduleSpans, marquee.parseSchedule | added-row, unglue | true |
| mq-c-above-c1-not-used | marquee.readScheduleSpans, marquee.parseSchedule | unglue, group-drop, added-row, unticked | true |
| mq-mark-bases-ftb-only | marquee.readScheduleSpans, marquee.parseSchedule | refusal-flip, added-row, description-prefix | true |
| mq-alternation | marquee.readScheduleSpans, marquee.parseSchedule | added-row, unglue | true |

`mq-c-epox-19-c1-c2` is listed in `expectedChanges` with no change, and it doesn't change. For the `both-` twins, the whole-sheet entry points are unchanged.

## (d) Whole-sheet reads

These run `textSpans` → `{x: x0, y: y0, w, h, rot}` on every page, with `sheet_number` from `extractSheetNumber`, then `buildSheetGraph`, as `mcp/src/session.ts` does it. `segs` (drawn-delta linework) is left out in both trees because it only feeds revision markers.

| PDF | pages | tables | kinds (rows) | rows | identical |
|---|---|---|---|---|---|
| sample-finish-plan.pdf (demo) | 2 | 2 | room-finish (29), finish (28) | 57 | true |
| annotated-set.pdf | 2 | 1 | finish (3) | 3 | true |
| layered-plan.pdf | 1 | 0 | — | 0 | true |
| mep-set.pdf | 2 | 4 | finish (2), equipment (3), equipment (1), equipment (1) | 7 | true |
| multibuilding-set.pdf | 5 | 3 | room-finish (2), finish (3), room-finish (2) | 7 | true |
| reader483-set.pdf | 3 | 2 | finish (9), finish (3) | 12 | true |
| scanned-plan.pdf | 1 | 0 | — (no text layer) | 0 | true |
| symbol-labels.pdf | 1 | 0 | — | 0 | true |
| symbol-lum.pdf | 1 | 0 | — | 0 | true |
| symbol-plan.pdf | 1 | 0 | — | 0 | true |
| symbol-set.pdf | 4 | 1 | finish (3) | 3 | true |

## (e) Drawn-box sweep

There are 37 boxes: every table region the head graph finds, padded 12 px (14 boxes), and every page box (23). The region lists are identical at base and head. 32 reads are identical. The 5 that differ are all on the new fixture, and `readFinishTable(marquee)` is identical in all 5:

| PDF | page | box | base | head | rule (USER_GUIDE "Import from schedule") |
|---|---|---|---|---|---|
| reader483-set.pdf | 1 | page | 9 rows | 14 rows, skipped SEAL | CPT-2 and TS-1 → **NOT USED rows**; FTB-01 `CUT (C)`, FTB-02 `COVE`, lone `P-1 SAT` → **codes with a word after them** (CPT-3 SAT/EGG keep their glued codes, since the split would clash); EPOX → **four- and five-letter codes** (filled); SEAL (one cell) → named in the notice. At base, CPT-2, EPOX, FTB-01, FTB-02 and TS-1 were missing with no notice. |
| reader483-set.pdf | 1 | MATERIAL SCHEDULE region | 9 rows | 14 rows, skipped SEAL | same as above |
| reader483-set.pdf | 2 | page | refused: no-table | 0 rows, skipped EPOX, CONC, SEAL | **four- and five-letter codes**: none qualifies (no numbered row after), so all three are named and the dialog is titled "no rows read" |
| reader483-set.pdf | 3 | page | 3 rows (RB-1 = `RUBBER BASE EPOXY FLOORING`) | 4 rows | **each code on its own line**: EPOX's line leaves RB-1 (unglue); **four- and five-letter codes**: EPOX is a row |
| reader483-set.pdf | 3 | MATERIAL SCHEDULE region | 3 rows | 4 rows | same as above |

None of the demo, MEP, SYMBOLS, MULTI, annotated or layered boxes changed.

Every box is listed below, so you can check where each table box landed. The demo's MATERIAL SCHEDULE region reads 28 rows and mep's reads 2. Room-finish and equipment regions are refused at both base and head, because the finish reader doesn't read them. `compare.mts` stops if the base and head region lists differ, since it pairs the boxes by index.

| PDF | page | box | base | head | identical |
|---|---|---|---|---|---|
| sample-finish-plan.pdf (demo) | 1 | page | refused: no-table | refused: no-table | true |
| sample-finish-plan.pdf (demo) | 2 | page | 28 rows | 28 rows | true |
| sample-finish-plan.pdf (demo) | 2 | room-finish table "ROOM FINISH SCHEDULE - BASEMENT" region | refused: no-table | refused: no-table | true |
| sample-finish-plan.pdf (demo) | 2 | finish table "MATERIAL SCHEDULE" region | 28 rows | 28 rows | true |
| annotated-set.pdf | 1 | page | refused: no-table | refused: no-table | true |
| annotated-set.pdf | 2 | page | refused: no-color-style-pattern (AIR DISTRIBUTION SCHEDULE) | refused: no-color-style-pattern (AIR DISTRIBUTION SCHEDULE) | true |
| annotated-set.pdf | 2 | finish table "AIR DISTRIBUTION SCHEDULE" region | refused: no-color-style-pattern | refused: no-color-style-pattern | true |
| layered-plan.pdf | 1 | page | refused: no-table | refused: no-table | true |
| mep-set.pdf | 1 | page | refused: no-table | refused: no-table | true |
| mep-set.pdf | 2 | page | 2 rows | 2 rows | true |
| mep-set.pdf | 2 | finish table "MATERIAL SCHEDULE" region | 2 rows | 2 rows | true |
| mep-set.pdf | 2 | equipment table "ELECTRIC BASEBOARD HEATER SCHEDULE" region | refused: no-table | refused: no-table | true |
| mep-set.pdf | 2 | equipment table "FAN SCHEDULE" region | refused: no-table | refused: no-table | true |
| mep-set.pdf | 2 | equipment table "DIFFUSER, GRILLE, REGISTER SCHEDULE" region | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 1 | page | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 2 | page | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 3 | page | 3 rows | 3 rows | true |
| multibuilding-set.pdf | 4 | page | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 5 | page | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 3 | room-finish table "ROOM FINISH SCHEDULE - BUILDING A" region | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 3 | finish table "MATERIAL SCHEDULE" region | 3 rows | 3 rows | true |
| multibuilding-set.pdf | 4 | room-finish table "ROOM FINISH SCHEDULE - BUILDING B" region | refused: no-table | refused: no-table | true |
| multibuilding-set.pdf | 5 | room-finish table "ROOM FINISH SCHEDULE - BUILDING B" region | refused: no-table | refused: no-table | true |
| reader483-set.pdf | 1 | page | 9 rows | 14 rows, skipped ["SEAL"] | false |
| reader483-set.pdf | 2 | page | refused: no-table | 0 rows, skipped ["EPOX","CONC","SEAL"] | false |
| reader483-set.pdf | 3 | page | 3 rows | 4 rows | false |
| reader483-set.pdf | 1 | finish table "MATERIAL SCHEDULE" region | 9 rows | 14 rows, skipped ["SEAL"] | false |
| reader483-set.pdf | 3 | finish table "MATERIAL SCHEDULE" region | 3 rows | 4 rows | false |
| scanned-plan.pdf | 1 | page | refused: no-table | refused: no-table | true |
| symbol-labels.pdf | 1 | page | refused: no-table | refused: no-table | true |
| symbol-lum.pdf | 1 | page | refused: no-table | refused: no-table | true |
| symbol-plan.pdf | 1 | page | refused: no-table | refused: no-table | true |
| symbol-set.pdf | 1 | page | refused: no-table | refused: no-table | true |
| symbol-set.pdf | 2 | page | refused: no-table | refused: no-table | true |
| symbol-set.pdf | 3 | page | refused: no-table | refused: no-table | true |
| symbol-set.pdf | 4 | page | 3 rows | 3 rows | true |
| symbol-set.pdf | 4 | finish table "FINISH SCHEDULE" region | 3 rows | 3 rows | true |

## (f) Test totals

Both trees ran on the same machine (Node v24.21.0) with the voice and OCR models **not** staged in either tree, so the same three voice tests skip in both.

| Suite | base `60c82e34` | head | command |
|---|---|---|---|
| web | 2,734 tests, 2,731 pass, 0 fail, 3 skipped | 2,998 tests, 2,995 pass, 0 fail, 3 skipped | `npm test --prefix web` (head: inside `npm run check --prefix web`, exit 0) |
| mcp | 274 tests, 274 pass, 0 fail | 286 tests, 286 pass, 0 fail | `npm test --prefix mcp` |

The readiness review's 2,991 / 2,988 / 3 skipped was taken at `bcd3663d` with the models staged. There, the 3 skips were the SUPERSEDED tests that wave A deleted. Here, the 3 skips are the voice tests, because the models are unstaged.

## The one docs line this wave added (`b0e458d4`)

`repro/limit-every-second-line.mts` builds a CODE | MATERIAL | MANUFACTURER | COLOR table in which every row's second line starts with a four- or five-letter word in the code column. It covers 48 cases: OWNER, SHEEN, FIELD and PRIME × 1–2 cells × line spacing 28/31/34 × row padding 0/6.

- **Head:** 36 of 48 cases don't read as wraps. The word lines become rows of their own (`OWNER=SEMI-GLOSS | ACME DIV.`), or are skipped and named in the notice, and the rows above lose `SEMI-GLOSS` / `ACME DIV.`. The 12 that read as wraps are the FIELD cases, which the reader never takes for a code.
- **Base:** all 48 read as wraps.

`repro/limit-one-plain-line.mts` runs the same table with one row's second line plain. In all 144 cases the reader returns 4 rows with nothing skipped.

Commands: `(cd <tree>/web && node --import tsx $REPRO/limit-every-second-line.mts <tree>)` and `(cd $HEAD/web && node --import tsx $REPRO/limit-one-plain-line.mts $HEAD)`.
