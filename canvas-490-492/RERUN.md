# Re-run the #490 / #491 evidence

Inputs are the tracked demo plan (`web/public/demo/sample-finish-plan.pdf`) and an image-only copy of it made by `scripts/make-set.mjs` (both pages rendered at 200 DPI, no text layer). Builds compared: the PR's base (#487 head `4a0f2290`) and the PR head, each served by `npx vite` from its own checkout with its own `node_modules` (two servers sharing one `node_modules` share Vite's dependency cache and load React twice).

```bash
W=<checkout>/web
cd $W && node scripts/stage-ocr-model.mjs && npx vite --port 5241 --strictPort   # base checkout; head checkout on 5242
mkdir -p run && cd run && npm i playwright           # outside the repo
W=$W OUT=$PWD node ../scripts/make-set.mjs && cp demo-image-only.pdf image-only.pdf

# #490: demo plan, then the image-only copy; reads the new tab's label
S=$PWD PORT=5241 node ../scripts/c1.mjs c1-before    # image-only.pdf is read from $S
S=$PWD PORT=5242 node ../scripts/c1.mjs c1-after

# #491: Snap on, 1,200 cursor positions over AF101 per tool (Area as the control,
# Pin, Import from schedule); counts positions where the snap star and the
# "snap" chip show
node ../scripts/sweep.mjs before 5241 > sweep-before.json
node ../scripts/sweep.mjs after 5242 > sweep-after.json
```

The scripts launch Playwright's chrome-headless-shell from its default cache path; edit `executablePath` for another browser. `c1.mjs` expects the image-only PDF at `$S/image-only.pdf`. Staging the OCR models in both checkouts keeps the two screenshots alike apart from the tab (without them **Read page text** is hidden).
