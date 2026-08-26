// PaddleOCR (PP-OCRv5) as an OcrEngine adapter for the benchmark
// (docs/SCHEDULE-OCR.md) via ppu-paddle-ocr — the community onnxruntime port
// that runs in Node (here) and the browser (its shipping target). This is the
// CEILING candidate the tesseract floor is measured against. Models download
// once to ~/.cache/ppu-paddle-ocr on first init.
//
// PaddleOCR is a detector+recognizer. Its recognize() returns { text, lines,
// confidence } where `lines` is an array of LINES, each line an array of CELL
// objects ({ text, box:{x,y,width,height}, confidence }). One box per cell is a
// good fit for the column-banding parser; it also means word-granularity
// detection recall understates it — the fair cross-engine metric is row recall.
import { cropBoxToWord } from "../../src/lib/ocr/raster.ts";

/** `model` is one of ppu-paddle-ocr's exported model presets (default:
 * V5_EN_MOBILE_MODEL — the English PP-OCRv5 mobile det+rec pair). */
export async function createPaddleEngine({ model } = {}) {
  const ppu = await import("ppu-paddle-ocr");
  const napi = await import("@napi-rs/canvas");
  const svc = new ppu.PaddleOcrService({ model: model ?? ppu.V5_EN_MOBILE_MODEL });
  await svc.initialize();
  return {
    id: "paddle-ppocrv5-en-mobile",
    /** rendered = { png, width, height, geometry } from renderRegion. Decode
     * the PNG into a canvas (PaddleOCR wants a getContext-able surface). */
    async recognize(rendered) {
      const img = await napi.loadImage(rendered.png);
      const cv = napi.createCanvas(rendered.width, rendered.height);
      cv.getContext("2d").drawImage(img, 0, 0);
      const res = await svc.recognize(cv);
      const words = [];
      for (const line of res?.lines ?? []) {
        for (const cell of line ?? []) {
          const str = (cell.text ?? "").trim();
          if (!str || !cell.box) continue;
          const { x, y, width, height } = cell.box; // top-left origin, crop px
          words.push(cropBoxToWord(str, { x0: x, y0: y, x1: x + width, y1: y + height }, rendered.geometry, cell.confidence));
        }
      }
      return words;
    },
    dispose: () => svc.destroy(),
  };
}
