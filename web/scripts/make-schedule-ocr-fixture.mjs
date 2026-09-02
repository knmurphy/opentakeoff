// Regenerates the schedule-OCR ground-truth word fixtures (docs/SCHEDULE-OCR.md)
// from vector PDFs. The trick the whole harness leans on: a VECTOR schedule's
// text layer is perfect, free ground truth — render the region to pixels and
// the discarded text layer scores whatever OCR reads the pixels back. So each
// case here is a real "marquee" over a vector schedule, extracted with the
// same viewport math the production path uses (sheets.extractRegionText), plus
// the run width detection scoring needs.
//
//   node --import tsx scripts/make-schedule-ocr-fixture.mjs
//
// Words are written to test/fixtures/schedule-ocr/<id>.words.json. The golden
// rows (<id>.golden.json) are HAND-AUTHORED against the printed table and are
// never overwritten here — they are the human side of the contract.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist";
import { RENDER_SCALE } from "../src/lib/sheets.ts";
import { parseSchedule } from "../src/lib/scheduleParse.ts";
import { wordsToTokens } from "../src/lib/ocr/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "test", "fixtures", "schedule-ocr");
const requireHere = createRequire(import.meta.url);
const PDFJS_ROOT = dirname(requireHere.resolve("pdfjs-dist/package.json"));

// Each case = one marquee an estimator would drag. Rects are image px at
// RENDER_SCALE (the canvas's stage space). The material-schedule rect on the
// demo VA sheet stops left of the ROOM FINISH LEGEND column (x≈5078) so the
// fixture holds exactly one table.
const CASES = [
  {
    id: "material-schedule",
    pdf: join(here, "..", "..", "demo", "sample-finish-plan.pdf"),
    page: 2,
    rect: { x0: 2300, y0: 250, x1: 5050, y1: 2000 },
  },
];

async function extractWords(pdfPath, pageNum, rect) {
  const bytes = await readFile(pdfPath);
  const doc = await pdfjs.getDocument({
    // getDocument may DETACH the buffer it is handed — always pass a copy
    data: new Uint8Array(bytes),
    verbosity: 0,
    standardFontDataUrl: join(PDFJS_ROOT, "standard_fonts") + "/",
    cMapUrl: join(PDFJS_ROOT, "cmaps") + "/",
    cMapPacked: true,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    const tc = await page.getTextContent();
    // Same composed-transform math as extractRegionText, kept inline because
    // this script also needs the run width (Tokens don't carry w).
    const vs = Math.hypot(vp.transform[0], vp.transform[1]) || 1;
    const words = [];
    for (const it of tc.items || []) {
      const str = it.str || "";
      if (!str.trim()) continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      const x = t[4], y = t[5], h = Math.hypot(t[2], t[3]) || it.height || 0;
      if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1) continue;
      const w = (it.width || 0) * vs;
      const r = (v) => Math.round(v * 100) / 100;
      words.push({ str, x: r(x), y: r(y), w: r(w), h: r(h) });
    }
    words.sort((a, b) => a.y - b.y || a.x - b.x);
    return words;
  } finally {
    await doc.destroy();
  }
}

for (const c of CASES) {
  const words = await extractWords(c.pdf, c.page, c.rect);
  const fixture = {
    source: "demo/sample-finish-plan.pdf",
    page: c.page,
    renderScale: RENDER_SCALE,
    rect: c.rect,
    words,
  };
  const outPath = join(outDir, `${c.id}.words.json`);
  await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n");
  const rows = parseSchedule(wordsToTokens(words));
  console.log(`${c.id}: ${words.length} words → ${outPath}`);
  console.log(`  clean parse: ${rows.length} rows (${rows.map((r) => r.finish_tag).join(", ")})`);
}
