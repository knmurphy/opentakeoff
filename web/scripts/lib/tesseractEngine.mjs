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
      // tesseract.js 7 populates blocks/paragraphs/lines/words — the flat
      // data.words list is gone (bench repair 2026-08-31: the original read
      // data.words, which silently yields ZERO words on tesseract.js 7 and
      // under-measures the tesseract floor)
      const words = [];
      const walk = (n) => {
        if (!n) return;
        if (n.words) for (const wd of n.words) {
          const str = (wd.text ?? "").trim();
          if (!str) continue;
          words.push(cropBoxToWord(str, wd.bbox, rendered.geometry, (wd.confidence ?? 0) / 100));
        }
        for (const k of ["lines", "paragraphs", "blocks"]) if (n[k]) for (const c of n[k]) walk(c);
      };
      walk(data);
      return words;
    },
    dispose: () => worker.terminate(),
  };
}
