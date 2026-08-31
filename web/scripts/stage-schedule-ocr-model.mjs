// Stage the browser schedule-OCR model for dev/CI/self-hosting (docs/SCHEDULE-OCR.md
// step 6). Mirrors scripts/fetch-voice-model.mjs: downloads the PaddleOCR PP-OCRv5
// English mobile det+rec ONNX-runtime models + character dict into
// web/public/models/paddle-ocr/ so the app serves them SAME-ORIGIN — the
// client-only pledge means the running app never talks to a model CDN; this
// script is the only place the network is involved, at build/dev time.
//
//   node scripts/stage-schedule-ocr-model.mjs          # skip files already present
//   node scripts/stage-schedule-ocr-model.mjs --force  # re-download everything
//
// The directory is gitignored (~13 MB doesn't belong in git history); CI restores
// it from actions/cache keyed on MODEL_REV. Scanned-schedule import simply stays
// off ("not installed on this deployment") when the files are absent — the same
// feature-absence-never-breakage discipline voice uses.
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The PP-OCRv5 English mobile pair — the "ceiling" engine measured in
// docs/SCHEDULE-OCR.md Experiment 3 (0.8% CER). MODEL_REV is pinned to an
// IMMUTABLE HuggingFace commit (not the moving "main" ref) for reproducible
// builds, and each file's sha256 is VERIFIED against the pin below — a
// re-pushed/tampered repo is rejected, never staged. To update: bump MODEL_REV
// to the new commit, refresh the sha256s (the script prints the actual on
// mismatch), and bump the CI cache key.
const MODEL_REV = "bf1d5edb0335d3262be7caf13f766ba274b4cadd";
const BASE = `https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/${MODEL_REV}`;
// remote path → local basename (flattened; the worker points the service here) + sha256.
const FILES = [
  ["detection/PP-OCRv5_mobile_det_infer.ort", "det.ort", "30acfc4e21f2a23669d01a75aaeb92190f96874613108a0f7086bed264420abc"],
  ["recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort", "rec.ort", "74ff9e508379375b5149a3c7764221fa9ba7680b7e2f2e458f26b7c7993a89b0"],
  ["recognition/multi/en/v5/ppocrv5_en_dict.txt", "dict.txt", "c60d46e9e01d500ed6388fe8681051eac9cf6692e0d57238315be171927a0a1b"],
];

const here = dirname(fileURLToPath(import.meta.url));
const destRoot = join(here, "..", "public", "models", "paddle-ocr");
const force = process.argv.includes("--force");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const verify = (local, buf, want) => {
  const got = sha256(buf);
  if (got !== want) { console.error(`\nSHA256 MISMATCH ${local}\n  want ${want}\n  got  ${got}`); process.exit(1); }
  return got;
};

let total = 0;
for (const [remote, local, want] of FILES) {
  const dest = join(destRoot, local);
  mkdirSync(dirname(dest), { recursive: true });
  if (!force && existsSync(dest)) {
    const buf = readFileSync(dest);
    verify(local, buf, want);   // a cached-but-corrupt file is caught too
    total += buf.length;
    console.log(`  = ${local}  ${(buf.length / 1e6).toFixed(1)} MB  sha256 ${want.slice(0, 12)}… (cached, verified)`);
    continue;
  }
  const url = `${BASE}/${remote}`;
  process.stdout.write(`  ↓ ${local} … `);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`\nFAILED ${res.status} ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  verify(local, buf, want);     // reject a tampered/re-pushed model before writing
  writeFileSync(dest, buf);
  total += buf.length;
  console.log(`${(buf.length / 1e6).toFixed(2)} MB  sha256 ${want.slice(0, 12)}… (verified)`);
}
// onnxruntime-web's WASM runtime is NOT staged here: the worker pins it to the
// bundler's SAME-ORIGIN assets via `?url` imports (src/scheduleOcr.worker.ts, the
// STT-adapter pattern), so Vite hashes it into dist/assets and no CDN is ever hit.
// Only the models \u2014 which the package would otherwise fetch from a CDN \u2014 are staged.
console.log(`\nStaged ${FILES.length} model files, ${(total / 1e6).toFixed(1)} MB -> public/models/paddle-ocr/ (gitignored; scanned-schedule import stays off if absent).`);
