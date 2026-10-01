# Rerun: #484 browser evidence (before vs after, real engine, real browser)

BEFORE = upstream/main 60c82e34 (`verify-base`), AFTER = fix/484-ocr-large-boxes 01c5d8e9 (`verify-484`).
Playwright from `scratchpad/impl-C/node_modules` (symlinked here as `node_modules`); chrome-headless-shell 1234 (macOS arm64).
Inputs: tracked demo plan + synthetic tables only. No tracked file is edited.

```bash
S=<scratchpad>; E=$S/ev-484
# builds
for c in verify-base verify-484; do (cd $S/$c/web && npm run stage:ocr && npm run build); done
# inputs: synthetic tables with every brand/product name replaced by generic text (same seed, same array lengths)
cd $S/verify-484/web && W=$PWD OUT=$E node $E/scripts/make-inputs-generic.mjs
# the original generator too (brand names; used only for no-screenshot cross-checks)
W=$PWD OUT=$E/inputs-brand node $S/diag-484/repro/make-inputs.mjs
cp $S/recapture/demo-image-only.pdf $E/inputs/      # (from diag-484/repro/make-demo-image-only.mjs)
W=$PWD SRC=$E/inputs/demo-image-only.pdf OUT=$E/inputs/demo-image-only-p2.pdf node $E/scripts/make-demo-p2.mjs   # AF600 page alone
W=$PWD SRC=$PWD/public/demo/sample-finish-plan.pdf OUT=$E/inputs/demo-vector-p2.pdf node $E/scripts/make-demo-p2.mjs  # text-layer reference

# serve ONE build at a time, same port (item 5 needs the same origin). netlify.toml has base=web, so run from the repo root:
cd $S/verify-base && netlify dev --dir web/dist --offline --port 8951 --no-open &
cd $E/scripts
ps -Ao pcpu,comm -r | head          # record load (each script also snapshots it)
node import.mjs before-large  $E/inputs/large.pdf 2592,1728 105,80,1915,1515
node import.mjs before-af600  $E/inputs/demo-image-only-p2.pdf 3024,2160 1464,108,2455,949
node import.mjs before-rotated $E/inputs/rotated.pdf 1224,792 62,55.6,1072,410
node import.mjs before-large-brand $E/inputs-brand/inputs/large.pdf 2592,1728 105,80,1915,1515 noshots
node import.mjs before-af600-vector $E/inputs/demo-vector-p2.pdf 3024,2160 1464,108,2455,949 noshots
node pageread.mjs before-read $E/profiles/upgrade read     # item 5 step 1: this profile is reopened on AFTER
node pageread.mjs before-read2 fresh read                  # more timing runs: before-read3, before-read4
node hang.mjs before-hang 200000
kill <netlify pid>
cd $S/verify-484 && netlify dev --dir web/dist --offline --port 8951 --no-open &
node pageread.mjs after-upgrade $E/profiles/upgrade check  # item 5 step 2: FIRST, before anything else on AFTER
node import.mjs after-large ... (same five as above, after- tags)
node pageread.mjs after-read fresh read                    # and after-read2..4
node hang.mjs after-hang 300000
kill <netlify pid>; rm -rf $S/verify-*/.netlify $S/verify-*/web/.netlify

# scoring
python3 score-dialogs.py $E                                 # data/dialogs-scored.json
cd $S/verify-base/web && node $E/scripts/to-runs.mjs $E/data/pagereads-all.json before-read before-read2 after-read after-read2 \
  && node --import tsx $E/scripts/recall.mts $E/data/pagereads-all.json $E/data/recall.json   # recall.mts = diag-484/repro/g/recall.mts, paths filled
python3 timing.py $E                                        # data/timing.json
```

## Scripts
- `lib.mjs`: launch, open a PDF (Load sample plan → gallery file input), pt → screen mapping at fit.
- `import.mjs`: classic layout, ⋯ (More) → Import from schedule, two clicks round the box; clicks Download on the notice; records every status line (`[data-import-read-status]`), the result dialog or footer message. Fresh browser profile per run.
- `pageread.mjs`: `read` = Read page text on sheet 1 (canvas control) and sheet 2 (gallery card), then gallery search for E-02, CE-3, AC-18, CPT-2, T1; saves the app's `ocr:v1:*` IndexedDB entries. `check` = reopen a profile without reading.
- `hang.mjs`: an init script subclasses `window.Worker` so the FIRST `recognize` message to the OCR worker is dropped (never reaches the worker: a silent hang). No shipped code or timer is changed; the wait is real. Then a second import of the same box.
- `score-dialogs.py`, `to-runs.mjs`, `recall.mts`, `timing.py`: scoring.

## What this evidence commit holds

- Scripts with absolute paths use `__WEB__` for the checkout's `web/` directory; replace it before running.
- Synthetic tables: `make-inputs-generic.mjs` (generic vendor names). The earlier `make-inputs.mjs` is not included.
- `make-demo-image-only.mjs` renders the tracked demo plan to the 200 DPI image-only PDF.
- Published data is scores and timings only: `recall.json` (in-app page reads), `diagnosis-g1-recall.json` (diagnosis harness, per-line vs per-box), `timing.json` (process snapshots removed), `hang-*.json`, `measure-after-*.json` (the USER_GUIDE time and memory table). Raw OCR text of the demo plan (`pagereads-all.json`, `dialogs-scored.json`, import reads) isn't published: the demo names manufacturers. The scripts regenerate it.
