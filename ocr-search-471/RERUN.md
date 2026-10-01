# Re-run the #471 evidence

Everything here runs against a production build served with the production headers. Inputs are the tracked demo plan only.

```bash
W=<repo>/web                                   # the PR branch's web/ directory
cd $W && npm ci && npm run stage:ocr && npm run build
netlify dev --dir dist --offline --port 8931 --no-open   # applies web/public/_headers; leave running

mkdir -p run && cd run && npm i playwright@1.63   # outside the repo
export BASE=http://localhost:8931                 # optional (default)
export CHROMIUM=/path/to/chrome                   # optional; unset uses Playwright's bundled Chromium

# Inputs: the demo plan as a 200 DPI image-only PDF, and the same with a stamp (3 lines) and one line of 9 runs
W=$W OUT=$PWD node ../scripts/make-set.mjs        # → demo-image-only.pdf
W=$W node ../scripts/make-stamp.mjs               # → demo-stamped.pdf (reads demo-image-only.pdf)

node ../scripts/capture-final.mjs                 # screenshots 01–09 into ./ev/
for i in 1 2 3; do node ../scripts/measure3.mjs $i; done   # time and memory → run-<i>.json
cp demo-image-only.pdf ../scripts/ && node ../scripts/capture-worker-output.mjs   # raw worker output for the seam fixture and the recall figure
```

`measure3.mjs` samples the browser tab's renderer RSS with `ps` every 250 ms (macOS/Linux). Run it on an idle machine: background CPU load roughly doubled read times in one of our runs.

Screenshots 10–17 were taken with short one-off Playwright steps on the same build:
- 10: `navigator.clipboard.writeText` stubbed to reject, then a Copy text box.
- 11, 12: a `VITE_OCR=off` build (`VITE_OCR=off npx vite build --outDir dist-off`).
- 13, 14: `demo-stamped.pdf` added, then sheet 1 read from its card and "received" searched.
- 15, 16: `page.route("**/models/ocr/manifest.json", r => r.abort())`, then Retry with the route released.
- 17: classic layout, ⋯ → Import from schedule, a box around the MATERIAL SCHEDULE on AF600.
