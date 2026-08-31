// Stage the Copy-text OCR reader's files into public/ocr/ — same-origin
// serving only (the fetch-voice-model.mjs / RFC #59 precedent; the
// client-only pledge has no CDN fallback). Everything is pinned by
// package.json: no downloads here, just copies out of node_modules.
//   • tesseract.js/dist/worker.min.js      the recognizer worker script
//     (+ its .LICENSE.txt — the minified banner points at it)
//   • tesseract.js-core LSTM cores only    the worker feature-detects ONE tier
//     (relaxedsimd-lstm / simd-lstm / lstm) at runtime — the legacy OEM cores
//     and the asm.js `.js` fallbacks are never requested with OEM=1 (LSTM
//     ONLY) and would only bloat the deploy
//   • @tesseract.js-data/eng 4.0.0_best_int the integerized "best" english
//     model — ~3 MB against the standard build's 11 MB, and the int model is
//     what the int8 wasm cores are built to run; staged AS eng.traineddata.gz
//     (the name tesseract's langPath fetch expects)
// Sources are validated BEFORE the output dir is wiped (an incomplete
// node_modules fails the build without destroying a good staging), and the
// output is then rebuilt from scratch so a re-run can never leave a stale
// variant behind. Idempotent; wired into postinstall AND build (Netlify's
// install may run with either) and fails loudly when the source set is
// incomplete — a silent skip would ship a deployment whose Copy-text tool
// can't read scans.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const out = join(web, "public", "ocr");
const nm = (p) => join(web, "node_modules", p);

// ── validate sources first (nothing is touched on failure) ──────────────────
const tessDist = join(nm("tesseract.js"), "dist");
const workerSrc = join(tessDist, "worker.min.js");
const workerLicenseSrc = join(tessDist, "worker.min.js.LICENSE.txt");
const coreDir = join(nm("tesseract.js-core"));
const langSrc = join(nm("@tesseract.js-data"), "eng", "4.0.0_best_int", "eng.traineddata.gz");
const missing = [workerSrc, workerLicenseSrc, coreDir, langSrc].filter((p) => !existsSync(p));
// exactly the three LSTM tiers' wasm pairs — see header for why nothing else
const coreFiles = existsSync(coreDir)
  ? readdirSync(coreDir).filter((f) => /^tesseract-core-(?:relaxedsimd-|simd-)?lstm\.wasm(\.js)?$/.test(f))
  : [];
if (coreFiles.length < 6) missing.push(`expected 6 LSTM core files (3 tiers × wasm+wasm.js) in ${coreDir}, found ${coreFiles.length}`);
if (missing.length) {
  console.error(`stage-ocr: missing source files (npm install incomplete?).\n  ${missing.join("\n  ")}\nRun \`npm ci\` in web/ to restore node_modules from the lockfile.`);
  process.exit(1);
}

// ── restage from scratch ─────────────────────────────────────────────────────
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const staged = [];
const copy = (src, dest) => { copyFileSync(src, join(out, dest)); staged.push(dest); };

copy(workerSrc, "worker.min.js");
copy(workerLicenseSrc, "worker.min.js.LICENSE.txt");
for (const f of coreFiles) copy(join(coreDir, f), f);
copy(langSrc, "eng.traineddata.gz");

const total = staged.reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`stage-ocr: ${staged.length} files, ${(total / 1e6).toFixed(1)} MB → public/ocr/`);
