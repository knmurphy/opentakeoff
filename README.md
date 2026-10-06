# #483 follow-up: alias headers on a box that already reads (parked)

Evidence for the work described in the #483 comment. Everything here is synthetic: invented codes, vendors and coordinates. Nothing comes from a real plan set.

The question: on `main`, a drawn box whose header is `CODE | MATERIAL | MFG | COLOR` reads rows on the first look, and MFG's cells join COLOR ("VENDOR-A GRAY"). #518's alias second look only runs on boxes that read no rows. Each design below adds a rename-only second look on a box that already reads (MFG → MANUFACTURER, NOTES → REMARKS, SPEC → PRODUCT, on the header line, nothing moved). The renamed read is used only when it passes a guard. The bar was zero reads that are correct on `main` and wrong after.

## The three designs (branches on this fork, each on `4d6cfd0e`)

| Design | Branch | Guard | Why it was not opened |
|---|---|---|---|
| 1 | `fix/483-aliases-on-read-design1` (two commits: code `ba4f74e4`, docs `4eee0934`) | same rows; same words per row | A blank or sparse MFG over left-aligned COLOR takes COLOR's cells. Words are conserved, so the guard can't see it. |
| 2 | `fix/483-aliases-on-read-design2` (two commits: code `bead07ef`, docs `96ea1257`) | only the renamed column and the column that holds its text today may change; moved words come off that column's edge | A cell arriving as two spans (OCR words, pdf.js runs): a blank MFG takes `WARM` from `WARM WHITE`. |
| 3 | `fix/483-aliases-on-read` (`231fd8c0`) | page positions: a cell is MFG's only if it overlaps MFG's header text and no other header; every other cell identical | Zero correct-to-wrong on the fuzz below, but it fixes about a quarter as many boxes as design 1. A later round found an MFG/SPEC header box reaching ≥1 px over the next column's cells claims them. |

## Results

- `results/implementer/fuzz4-three-designs.md`: the randomized grid (N=500 per cell; word and cell spans; text and OCR; left and mixed alignment; 2/3/4/8 rows). For each design, boxes with a field right on base and wrong on head, and boxes fixed.
- `results/fuzz4-reviewer/`: the reviewer's independent fuzz4 runs (design 2 era, `round2-table.md`) and raw outputs.
- `results/fuzz5-reviewer/runs/`: fuzz5 on design 3. It adds right/centred alignment, narrow alias columns, overflowing and wrapped cells, a notes block, stacked tables and header-box jitter, plus a header-fit margin sweep. This is where the overhang case appears.
- `results/implementer/mutants-design*.txt`: mutation runs. Each guard was removed in turn and the committed tests had to fail.
- `results/implementer/gates-design*.txt`: the CI gate exit codes for each design.
- `results/implementer/design3-red-on-design2.tap`: design 3's new tests failing on design 2.
- `screenshots/`: the Import-from-schedule dialog, base (`4d6cfd0e`) vs head for each design. Each covers a vector and an image-only (on-device OCR) PDF of the same invented tables (the PDFs are in `screenshots/`). The dialog shows code, description and manufacturer.

## Harness

`harness/*.mjs` compare two checkouts. Run from any `web/` with dependencies installed:

```sh
BASE=/path/to/main/web HEAD=/path/to/branch/web N=500 node --import tsx harness/fuzz4.mjs
```

- `fuzz4.mjs`: env `WORDS=0|1`, `OCR=0|1`, `AL=left|mixed`, `NR=<rows>`.
- `fuzz5.mjs`: also `HFIT NARROW OVERFLOW WRAP NOTESBLK STACK HJ`.
- `edge.mjs`, `overhang.mjs`, `recov*.mjs`: hand-made cases.
- `keep.mjs`: three boxes that read correctly on `main` and that any fix should keep that way. It runs from `web/` directly (no BASE/HEAD).
