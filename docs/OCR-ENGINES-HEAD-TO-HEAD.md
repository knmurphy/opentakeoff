# OCR engines, head to head — a decision record

**Status:** research + decision record, 2026-08-31. Nothing here changes shipped behavior by itself; the one behavioral outcome (the word-confidence floor) is already committed on this branch and cited below.
**Question:** tesseract.js vs PaddleOCR PP-OCRv5 (the `ppu-paddle-ocr` ONNX port) — which engine belongs in which job, and is the downstream parsing good enough?
**How this was produced:** a from-scratch bench on the bundled demo plan (`web/public/demo/sample-finish-plan.pdf`), three adversarial review passes over the bench *and its methods* (one re-running every cell with variants), and a matched-DPI re-run of the schedule-OCR branch's own harness with its tesseract arm repaired. Raw JSON + variant instruments from the review live under `/tmp/ocr-h2h*/` (ephemeral); the reproducible matrix bench is committed at `web/scripts/ocr-engines-h2h.mjs`.

## The story in one paragraph

Four OCR efforts existed on this fork with no reconciliation: the shipped raster engine (scan *geometry*, no text reading), the login-gated Gemini schedule reader (the only shipped scan *text* reader, commercial deploy only), the unmerged `claude/browser-ocr-library-f3le2q` branch (PaddleOCR for schedule import — DECISION.md's chosen work, mature), and this branch's Copy-text tool (tesseract for region prose reads). This document is the head-to-head those efforts never had.

## Results that survived adversarial review

### 1. Schedule job — matched DPI, the branch harness, tesseract arm repaired

tesseract.js 7 removed the flat `data.words` output the branch's benchmark adapter read; unrepaired, tesseract silently scores **zero** (0/28 rows at every DPI). The repaired adapter (committed to the browser-ocr branch, `696df99`) walks the block tree. Same fixture, same golden rows, PSM 3, tesseract.js 7.0.0:

| DPI | tesseract recall / precision / CER / category | paddle recall / precision / CER / category |
|---|---|---|
| 144 | 96.4% / 100% / 7.2% / **100%** | 78.6% / 88.0% / **0.7%** / 59.1% |
| 216 | 92.9% / 92.9% / 8.3% / 100% | 92.9% / 96.3% / **0.8%** / 57.7% |
| 288 | 96.4% / 96.4% / 5.5% / 100% | 92.9% / 96.3% / **0.9%** / 53.8% |

- **The character-accuracy gap is matched-DPI real: 6–10× CER at every DPI.** (An earlier reading here blamed best-vs-best DPI framing for the gap; the matched cells disprove that. Paddle types characters ~8× more cleanly.)
- **Tesseract finds and classifies the rows as well or better** — recall equal or higher at every DPI, and category 100% vs paddle's 54–59% (the stale-section latch is paddle's weakness on this fixture, not a shared one; the branch doc's "~80%, equally subject" footnote was pessimistic).
- Paddle's row losses land as *fuzzy-recoverable* (96.4% fuzzy at 216+); tesseract's cost lands as editable field typos. Behind the approval dialog both are defensible — see the open decision below.

### 2. Prose job (Copy-text) — clean-GT controls are the trustworthy cells

The from-scratch bench's two hand-placed regions were **methodologically invalid** (adversarial finding: the "room labels" region contained no room labels — recall ceiling 0.40 by construction; the title-block crop sliced the real block; 73% of its ink was outlined letterhead + VA seal absent from the text-layer ground truth, so "extra" tokens were *correct reads of unGT'd ink*, with true blank-ink junk at title-1× of: PSM 6 = 5 tokens, PSM 3 = 0, paddle = 1). The clean controls — 100% text-layer ink, no boundary cuts — say:

- **Dense clean text at 2× (≈288 DPI-equivalent): parity.** tesseract-PSM3 0.875 recall / 0.955 precision ≈ paddle 0.90 / 0.982.
- **Large regions at 1×: paddle clearly ahead** (0.884 vs 0.253 recall on the page-2 schedule block) — it is the more zoom-tolerant engine.
- **PSM 6 is the wrong mode for everything but tight paragraphs** — worse in all ~30 measured cells, catastrophic on tables (0.008 recall on the material schedule). **But PSM 3 is not shippable in the app**: at tesseract's auto-estimated DPI with the marquee zoom clamp (1–3×) it collapses (0.385 recall on the title block at 2×, below PSM 6's 0.615; zero tokens at 144 on sparse regions). PSM 6 output is bit-identical across every DPI setting — the stable choice — so the app keeps PSM 6.
- **Sparse scattered plan text defeats every engine/config tested** (≤0.40 recall); the Copy-text receipt preview is the designed mitigation and stays mandatory.
- **Warm per-region latency:** sub-half-second for small crops both engines; **multi-second for schedule-sized crops** (tess 2.8–3.6 s, paddle 1.5–1.9 s on ~1850×2000). All Node timings; paddle's browser-worker (single-thread WASM) timing is the branch's still-open Experiment 4/5.

### 3. Integration reality

tesseract: staged static files (`/ocr/`, `scripts/stage-ocr.mjs`), no wasm plumbing, running in production on this branch. Paddle: needs the branch's worker + staged ONNX models + ort-web wasm path pinning (the STT `?url` pattern — **not** a COOP/COEP/threading problem; the branch ships it single-thread WASM under no-COI). A bare-page `ppu` init that hangs is a wasm-path symptom, not an isolation one.

## Shipped behavioral outcome (already on this branch)

**Word-confidence floor, 0.60** in `web/src/lib/ocr/tesseract.ts` — measured: drops tesseract's sparse-ink junk with **zero recall loss** in every cell (sparse precision 0.235→0.667, 0.571→0.8, 0.667→1.0). A paddle adapter must **not** copy this floor: its confidence is per-line, and filtering on it destroys recall (0.846→0.385) — both facts are in the code comment.

## What the review chain got wrong before it got right (the part worth remembering)

1. First report: "paddle 8× more accurate" — right magnitude, best-vs-best framing.
2. Adversarial pass: "doesn't reproduce; likely DPI artifact" — **wrong**; my crude joined-string CER on different regions was the non-reproducing instrument. The branch's IoU-matched corpus CER is the sound one, and under it the gap holds at matched DPI.
3. The truth needed the branch's own harness re-run with its tesseract arm repaired — which also flipped category (100% vs "~80%") and row recall in tesseract's favor.

**Method lessons, for the next bench:** place regions on content that actually exists (verify against the text layer first); score only GT tokens whose glyphs are fully inside the crop; split precision into on-GT-ink / on-other-ink / on-blank (on-blank is the honest hallucination rate); set `user_defined_dpi` honestly per zoom or sweep it (PSM 3 is DPI-chaotic); n=1 is acceptable for accuracy (both engines are deterministic) and worthless for timing; and **tesseract.js ≥7 empties `data.words` unless you walk the block tree** — the trap that zeroed two independent benches.

## The open decision (owner's call)

The browser-ocr branch wired **paddle** as the on-device schedule reader on the strength of the 10× CER headline. The matched-DPI repair keeps the character gap but shows tesseract at 100% category and equal-or-better row recall — so with the approval dialog as the safety net, **either engine is defensible for schedules**, and tesseract (already staged, running in the app, zero wasm plumbing) is now arguable there too. Remaining unmeasured number: paddle's browser-worker timing under single-thread WASM (branch Experiment 4/5).

## Reproducing

```bash
cd web
npm i -D tesseract.js@7.0.0 ppu-paddle-ocr@6.4.3 onnxruntime-node @napi-rs/canvas@0.1.100   # opt-in engines, never committed
node scripts/ocr-engines-h2h.mjs public/demo/sample-finish-plan.pdf                          # prose-job matrix (deterministic)
```

Schedule job: `git show claude/browser-ocr-library-f3le2q:web/scripts/schedule-ocr-engine-benchmark.mjs` (run in that branch's worktree; engines per its header). See `docs/SCHEDULE-OCR.md` on that branch for the reproduction note and raw-number pointers.
