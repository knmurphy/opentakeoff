// Node-side PDF region rasterization for the schedule-OCR engine benchmark
// (docs/SCHEDULE-OCR.md). Environment-specific glue — it uses @napi-rs/canvas
// (pdfjs-dist's optional dep, already installed) and so lives in scripts/, out
// of the app bundle. The browser worker will do the same job with
// OffscreenCanvas; both feed the SAME pure geometry (src/lib/ocr/raster.ts).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import * as pdfjs from "pdfjs-dist";
import { RENDER_SCALE } from "../../src/lib/sheets.ts";
import { renderDims } from "../../src/lib/ocr/raster.ts";

const requireHere = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(requireHere.resolve("pdfjs-dist/package.json"));

let _napi;
async function napiCanvas() {
  if (!_napi) {
    _napi = await import("@napi-rs/canvas");
    globalThis.Path2D ??= _napi.Path2D;
    globalThis.DOMMatrix ??= _napi.DOMMatrix;
    globalThis.ImageData ??= _napi.ImageData;
  }
  return _napi;
}

export async function openDoc(pdfPath) {
  await napiCanvas();
  const bytes = await readFile(pdfPath);
  return pdfjs.getDocument({
    data: new Uint8Array(bytes), // getDocument may detach — pass a copy
    verbosity: 0,
    standardFontDataUrl: path.join(PDFJS_ROOT, "standard_fonts") + "/",
    cMapUrl: path.join(PDFJS_ROOT, "cmaps") + "/",
    cMapPacked: true,
    isEvalSupported: false,
  }).promise;
}

/** Rasterize a region (image-px @ RENDER_SCALE rect) at `zoom` relative to the
 * RENDER_SCALE baseline. Returns raw RGBA (the RasterImage shape rastermask +
 * a real engine consume) and a PNG buffer (what tesseract.js recognizes
 * directly) — both copies, so they outlive the canvas — plus the LIVE canvas
 * (PaddleOCR wants a getContext-able surface) and a `release()` the caller must
 * call when done with it. Rendered on explicit white so a dark theme never
 * inverts the ink — the raster-mask discipline. */
export async function renderRegion(doc, pageNum, geometry) {
  const napi = await napiCanvas();
  const page = await doc.getPage(pageNum);
  const { rect, zoom } = geometry;
  const { width, height } = renderDims(geometry);
  const rvp = page.getViewport({ scale: RENDER_SCALE * zoom, offsetX: -rect.x0 * zoom, offsetY: -rect.y0 * zoom });
  // Render pdf.js straight into a plain @napi-rs canvas (not pdf.js's own
  // NodeCanvasFactory canvas — PaddleOCR's recognize() stalls on that wrapper).
  // Explicit white first so a dark theme never inverts the ink.
  const canvas = napi.createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, viewport: rvp, background: "#ffffff" }).promise;
  const rgba = new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data);
  const png = Buffer.from(canvas.toBuffer("image/png"));
  return { rgba, png, width, height, geometry, canvas, release: () => page.cleanup?.() };
}
