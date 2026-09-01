// OCR engine head-to-head — the prose-job matrix bench from
// docs/OCR-ENGINES-HEAD-TO-HEAD.md (2026-08-31). Renders the demo plan's page
// 1 at RENDER_SCALE, crops two regions at 1x/2x, runs tesseract (PSM 6 + 3)
// and PaddleOCR PP-OCRv5 mobile, and scores exact-token multiset
// recall/precision against the text layer (the free ground truth).
//
// Engines are OPT-IN devDependencies, never committed (the branch-C
// benchmark's convention):
//   npm i -D tesseract.js@7.0.0 ppu-paddle-ocr@6.4.3 onnxruntime-node @napi-rs/canvas@0.1.100
//   node scripts/ocr-engines-h2h.mjs public/demo/sample-finish-plan.pdf
//
// Deterministic: repeated runs are byte-identical, so n=1 is fine for
// accuracy (never for timing). Known limitations — read the doc before
// quoting numbers: the two REGIONS are hand-placed and were shown by
// adversarial review to straddle outlined ink (the VA seal/letterhead) and
// boundary-cut GT items, so ABSOLUTE recall/precision there are deflated and
// precision comparisons are confounded; the doc's clean-GT controls and the
// branch harness are the trustworthy tables. tesseract.js 7 note: the flat
// data.words list is gone — this bench scores data.text tokens, and any
// adapter that reads data.words scores a silent zero.
import { createCanvas, Path2D as NapiPath2D, DOMMatrix as NapiDOMMatrix, ImageData as NapiImageData } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { PaddleOcrService, V5_EN_MOBILE_MODEL } from "ppu-paddle-ocr";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

globalThis.Path2D ??= NapiPath2D;
globalThis.DOMMatrix ??= NapiDOMMatrix;
globalThis.ImageData ??= NapiImageData;
const requireHere = createRequire(import.meta.url);
const PDFJS_ROOT = dirname(requireHere.resolve("pdfjs-dist/package.json"));

const PDF = process.argv[2];
const RS = 2.0;

const data = new Uint8Array(readFileSync(PDF));
const doc = await pdfjs.getDocument({
  data, verbosity: 0, isEvalSupported: false,
  standardFontDataUrl: join(PDFJS_ROOT, "standard_fonts") + "/",
  cMapUrl: join(PDFJS_ROOT, "cmaps") + "/", cMapPacked: true,
}).promise;
const page = await doc.getPage(1);
const vp0 = page.getViewport({ scale: RS });

// full-page render once (offset-viewport region renders come out blank under
// this napi/pdfjs pair — measured; hence full render + drawImage crops)
const fullCv = createCanvas(Math.ceil(vp0.width), Math.ceil(vp0.height));
const fctx = fullCv.getContext("2d");
fctx.fillStyle = "#ffffff"; fctx.fillRect(0, 0, fullCv.width, fullCv.height);
await page.render({ canvasContext: fctx, viewport: vp0, background: "#ffffff" }).promise;

// ground truth: text-layer tokens per region (glyph-box intersection)
const vs = Math.hypot(vp0.transform[0], vp0.transform[1]) || 1;
const tc = await page.getTextContent();
const marks = (tc.items || []).filter((it) => (it.str || "").trim()).map((it) => {
  const t = pdfjs.Util.transform(vp0.transform, it.transform);
  return { str: it.str, x: t[4], y: t[5], w: (it.width || 0) * vs, h: Math.hypot(t[2], t[3]) || it.height || 0 };
});
const norm = (s) => (s || "").toUpperCase().replace(/^[^A-Z0-9]+/, "").replace(/[^A-Z0-9]+$/, "");
const gtTokens = (r) => marks
  .filter((m) => m.x + m.w >= r.x0 && m.x <= r.x1 && m.y >= r.y0 && m.y - m.h <= r.y1)
  .sort((a, b) => a.y - b.y || a.x - b.x)
  .flatMap((m) => m.str.split(/\s+/)).map(norm).filter(Boolean);

const REGIONS = {
  "title-block": { x0: 4850, y0: 3700, x1: 5990, y1: 4300 },
  "room-labels": { x0: 120, y0: 1200, x1: 1950, y1: 2300 },
};

function crop(region, zoom) {
  const w = Math.round((region.x1 - region.x0) * zoom);
  const h = Math.round((region.y1 - region.y0) * zoom);
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
  x.drawImage(fullCv, region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0, 0, 0, w, h);
  return c;
}

const tess = await createWorker("eng");
const tessPsm = async (canvas, psm) => {
  await tess.setParameters({ tessedit_pageseg_mode: String(psm), user_defined_dpi: "288" });
  const png = canvas.toBuffer("image/png");
  const t0 = performance.now();
  const { data } = await tess.recognize(png, {}, { blocks: true });
  return { ms: performance.now() - t0, tokens: String(data.text || "").split(/\s+/).map(norm).filter(Boolean) };
};

const paddle = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
await paddle.initialize();
const paddleRun = async (canvas) => {
  const t0 = performance.now();
  const res = await paddle.recognize(canvas);
  const tokens = [];
  for (const line of res?.lines ?? []) for (const cell of line ?? []) {
    for (const w of String(cell.text ?? "").split(/\s+/)) { const n = norm(w); if (n) tokens.push(n); }
  }
  return { ms: performance.now() - t0, tokens };
};

const lev = (a, b) => {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};
const score = (gt, out) => {
  const a = [...gt], b = [...out];
  let matched = 0;
  for (let i = 0; i < a.length; i++) { const j = b.indexOf(a[i]); if (j >= 0) { matched++; b.splice(j, 1); } }
  const cer = lev(gt.join(" "), out.join(" ")) / Math.max(1, gt.join(" ").length);
  return {
    recall: +(matched / Math.max(1, a.length)).toFixed(3),
    precision: +(matched / Math.max(1, out.length)).toFixed(3),
    cer: +cer.toFixed(3),   // order-sensitive — read the doc before trusting this column
  };
};

console.log("region\tzoom\tengine\trecall\tprecision\tCER\tms\t(gt/out)");
for (const [name, r] of Object.entries(REGIONS)) {
  const gt = gtTokens(r);
  for (const zoom of [1, 2]) {
    const c = crop(r, zoom);
    for (const [label, run] of [
      ["tess-psm6", (cv) => tessPsm(cv, 6)],
      ["tess-psm3", (cv) => tessPsm(cv, 3)],
      ["paddle-v5", paddleRun],
    ]) {
      try {
        const { ms, tokens } = await run(c);
        const s = score(gt, tokens);
        console.log(`${name}\t${zoom}x\t${label}\t${s.recall}\t${s.precision}\t${s.cer}\t${Math.round(ms)}\t${gt.length}/${tokens.length}`);
      } catch (e) { console.log(`${name}\t${zoom}x\t${label}\tERROR ${e.message}`); }
    }
  }
}
await tess.terminate();
paddle.destroy?.();
await doc.destroy();
process.exit(0);
