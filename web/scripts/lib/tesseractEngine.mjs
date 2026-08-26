// Tesseract.js as an OcrEngine adapter for the benchmark (docs/SCHEDULE-OCR.md).
// This is the FLOOR baseline — a widely-available engine that runs in both Node
// and the browser, so its numbers set the bar PaddleOCR/ocrs must clear. Lives
// in scripts/ (a devDependency, benchmark-only) so tesseract.js never enters
// the app bundle. Emits OcrWord[] via the shared crop→image mapper, so the same
// harness that scored the oracle scores this.
import { createWorker } from "tesseract.js";
import { cropBoxToWord } from "../../src/lib/ocr/raster.ts";

/** Create a tesseract engine. `psm` is the page-segmentation mode (Tesseract's
 * layout assumption): 3 = auto, 6 = uniform block, 11 = sparse text. Default 3
 * — measured: PSM 6 assumes ONE uniform block and collapses on a sparse ruled
 * table (0.6% recall), while auto/sparse recover the cells (~47%). Layout mode
 * is itself a variable the benchmark sweeps. */
export async function createTesseractEngine({ psm = 3 } = {}) {
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
  return {
    id: `tesseract-psm${psm}`,
    /** rendered = { png, geometry } from renderRegion; opts.dpi silences
     * tesseract's resolution guess (a PNG carries no DPI, so it estimates and
     * warns) and lets its internal scaling match the real render. `data.words`
     * is tesseract.js's flat word list — same bboxes as walking the block tree,
     * fewer surprises. */
    async recognize(rendered, { dpi } = {}) {
      if (dpi) await worker.setParameters({ user_defined_dpi: String(Math.round(dpi)) });
      const { data } = await worker.recognize(rendered.png, {}, { blocks: true });
      const words = [];
      for (const wd of data.words ?? []) {
        const str = (wd.text ?? "").trim();
        if (!str) continue;
        words.push(cropBoxToWord(str, wd.bbox, rendered.geometry, (wd.confidence ?? 0) / 100));
      }
      return words;
    },
    dispose: () => worker.terminate(),
  };
}
