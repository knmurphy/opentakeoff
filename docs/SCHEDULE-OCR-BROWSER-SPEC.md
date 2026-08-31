# Spec — client-side PaddleOCR: the scanned-schedule reader in the browser

Status: implemented (step 6 of `docs/SCHEDULE-OCR.md`). SDD. Validated end-to-end in
real Chromium via Playwright (the harness under `web/ocr-harness.*`, deleted after
validation). Companion code: `web/src/scheduleOcr.worker.ts`,
`web/src/lib/scheduleOcrClient.ts`, `web/scripts/stage-schedule-ocr-model.mjs`, and
the `importScheduleFromScan` wiring in `web/src/pages/TakeoffCanvas.jsx`.

## Problem

"Import from schedule" reads a vector text layer for free, but a **scanned** schedule
has no text layer. Until now its only reader was the paid, OAuth-gated Gemini path
(`/ai/parse-schedule`, 501 on any deployment without a key) — so scanned schedules
had exactly one reader, and none at all on a self-hosted static deploy. Steps 0–5
built and hardened the parser to read PaddleOCR output at the measured ceiling (0.8%
CER); step 6 puts that engine in the browser so a scan is read **on-device** — no
login, no network, no paid call — feeding the SAME `parseSchedule` the vector path
uses.

## Architecture (the seam, validated)

```
marquee → rasterizeRegion (canvas RGBA + geometry)
        → scheduleOcrClient.recognize()  ── postMessage(transfer rgba) ─▶ scheduleOcr.worker
                                                                            │ PaddleOcrService (PP-OCRv5 en mobile)
                                                                            │   onnxruntime-web (WebGPU▸WASM, 1 thread)
                                                                            │   cell boxes → cropBoxToWord → OcrWord[]
        ◀──────────────────────────── postMessage(words) ───────────────────┘
        → parseSchedule(wordsToTokens(words)) → ScheduleRow[] → the one import dialog
```

- **The engine runs in a Worker** (`scheduleOcr.worker.ts`), off the main thread, per
  the perf bar (pan/zoom stays smooth) — the stt.worker.ts precedent. It maps each
  recognized cell box to an `OcrWord` with the SAME pure `cropBoxToWord` the Node
  benchmark uses (`src/lib/ocr/raster.ts`), so a scan and a vector sheet land in one
  coordinate space and the parser never learns which engine fed it.
- **The main-thread client** (`scheduleOcrClient.ts`) owns the worker lifecycle and
  exposes `ensureReady()` + `recognize()`, mirroring `voiceRecognizerClient.ts`. The
  rgba buffer is transferred (zero-copy).
- **`parseSchedule` is unchanged** — the whole 5a/5a-part-2 parser (blank-band reset,
  category_inferred) reads the OCR words exactly as it reads vector tokens.

## Client-only pledge & same-origin staging

The running app never talks to a model CDN. Two same-origin assets make that true:

- **Models** (`scripts/stage-schedule-ocr-model.mjs` → `public/models/paddle-ocr/`,
  gitignored, ~13 MB): the PP-OCRv5 English mobile det + rec `.ort` + char dict, which
  ppu-paddle-ocr would otherwise fetch from HuggingFace. Staged at build/dev time,
  mirroring `fetch-voice-model.mjs`. CI restores from `actions/cache`.
- **The onnxruntime-web WASM runtime** is pinned to the **bundler's** same-origin
  assets via `?url` imports in the worker (`ort-wasm-simd-threaded.jsep.{mjs,wasm}`),
  set as `ort.env.wasm.wasmPaths = { mjs, wasm }` — the exact pattern
  `src/lib/stt/transformersJs.ts` already uses. So Vite hashes the runtime into
  `dist/assets` (no CDN, no separate staging, no duplicate copy). The package's
  default (a jsdelivr CDN) is never reached — proven by the spike, which failed on the
  CDN fetch until `wasmPaths` was pinned.

**Deployment constraints, all satisfied** (the same envelope voice ships under):
no COOP/COEP ⇒ no SharedArrayBuffer ⇒ `numThreads = 1` (WebGPU, when present, needs no
cross-origin isolation); CSP `worker-src 'self' blob:`, `script-src 'self'
'wasm-unsafe-eval'`, `connect-src *` all cover the worker, the wasm compile, and the
same-origin model fetch — the STT path already loads onnxruntime-web this way in
production, so CSP compatibility is a settled precedent, not a new risk.

## Graceful absence & the reader precedence

`category_inferred`-style feature-absence, not breakage: `ensureReady()` HEAD-probes
`/models/paddle-ocr/det.ort` and distinguishes **uninstalled** (no model on this
origin — 404 or an SPA `index.html`) from a real error. When the model isn't staged,
the client reports uninstalled and `importScheduleFromScan` **falls through to the
existing AI-reader path** unchanged.

`importScheduleFromScan` precedence (all under one `scanBusyRef` guard):
1. **On-device OCR** when the model is staged: rasterize → recognize → parseSchedule;
   if it yields rows, open the dialog and stop.
2. **AI reader (Gemini)** as the fallback when OCR is absent OR read the pixels but
   parsed no table — the login/org gates and messaging are unchanged.
3. Neither reachable → the existing advice ("drag around the CODE / MATERIAL header",
   or "needs the on-device OCR model or the AI backend").

The vector path is untouched: a token-bearing box still parses straight from the text
layer before any of this.

## Measured (n=1, the harness sheet; real Chromium)

- **Correctness**: a rendered finish schedule read to `CPT-1 / BROADLOOM CARPET /
  SHAW`, `RB-1 / RESILIENT BASE / JOHNSONITE`, `ACT-1 / ACOUSTICAL CEILING / USG` —
  codes + descriptions + manufacturers, boxes and confidences, mapped through the
  shared geometry.
- **Timing**: ~2.6 s per region recognize after a one-time model+wasm init. Acceptable
  for a deliberate import action; the worker keeps the canvas responsive throughout.
- **Weight**: models ~13 MB (staged, gitignored); onnxruntime-web jsep runtime ~27 MB
  (bundled asset, code-split — loads only when a scan is imported). Both are same-origin.

## Invariants (must not regress)

- **The vector path and the AI-reader path are unchanged** when the model is absent —
  a deployment that doesn't stage the model behaves exactly as before step 6.
- **No CDN at runtime.** `wasmPaths` is pinned to bundled assets; models are
  same-origin. The only network in the whole feature is the build-time staging script.
- **One reader in flight** (`scanBusyRef`) — a rapid re-marquee never starts a second
  OCR run (the worker is serial) or a second paid call.
- **`parseSchedule` is the single downstream** — no OCR-specific row logic; the engine
  is judged by the same parser and its rows carry `category_inferred` like any other.

## Explicitly out of scope / residuals

- **Full-app Playwright coverage.** Validation drove the real client+worker+staging in
  Chromium (probe → init → recognize → transfer → words) and the app build; it did NOT
  script the whole PDF-load → marquee → dialog flow (heavy, brittle). The wiring is
  additive and follows the existing scan path; the pure seam is unit-tested.
- **Engine/model choice is fixed** to PP-OCRv5 English mobile (the Experiment-3
  ceiling). Other languages/sizes are a staging-script change, not a code change.
- **Perf is n=1.** ~2.6 s is one sheet on one machine; region size, DPI, and WebGPU
  availability move it. No worker warm-pool or cancellation yet — a second import waits
  on the first (surfaced as "still reading…").
- **Recognition tuning** (per-line vs per-box strategy, detection thresholds) is left
  at the library defaults that Experiment 3 measured; revisit only if a real corpus
  shows a gap the parser can't absorb.
