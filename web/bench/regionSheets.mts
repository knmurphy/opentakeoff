// PDF → DetectSheet[] in node (pdf.js legacy build), for the region bench.
// One DetectSheet per page: viewport at RENDER_SCALE with the page's own
// /Rotate (displayed orientation), tokens via sheets.ts extractPageTokens,
// lines via oneclick.ts extractVectorGeometry → longAxisLines, page size in
// inches from the page box. Pure parts: regionSheets.ts.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { extractVectorGeometry } from "../src/lib/oneclick.ts";
import { extractPageTokens } from "../src/lib/sheets.ts";
import { RENDER_SCALE } from "../src/lib/takeoffConstants.ts";
import type { DetectSheet } from "../src/lib/regionDetect.ts";
import { sheetKeyFor, pageSizeInches, toDetectSheet } from "./regionSheets.ts";

const req = createRequire(import.meta.url);
let pdfjsP: Promise<any> | null = null;
const pdfjs = () => (pdfjsP ??= import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")));

/** Every page of the PDF at `path` as a DetectSheet keyed by `file` (the
 * sheet-key file name). */
export async function loadPdfSheets(path: string, file: string): Promise<DetectSheet[]> {
  const lib = await pdfjs();
  const data = new Uint8Array(readFileSync(path));
  const doc = await lib.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const out: DetectSheet[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: RENDER_SCALE });
      const ops = await page.getOperatorList();
      const g = extractVectorGeometry(ops, vp.transform, lib.OPS);
      const tc = await page.getTextContent();
      out.push(toDetectSheet({
        key: sheetKeyFor(file, n), w: vp.width, h: vp.height,
        pageIn: pageSizeInches(page.view, page.rotate),
        tokens: extractPageTokens(tc, vp), segs: g.segs,
      }));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
