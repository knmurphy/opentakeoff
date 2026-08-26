// One-off: capture PaddleOCR's OcrWord[] output on the demo material schedule
// at several DPIs, so the parser's cell-level spatial handling can be tested
// DETERMINISTICALLY against real detector output without the heavy engine at
// test time (docs/SCHEDULE-OCR.md, step 4). Writes
// test/fixtures/schedule-ocr/<id>.paddle-<dpi>.json.
//
//   npm i -D ppu-paddle-ocr    (opt-in; models download to ~/.cache)
//   node --import tsx scripts/capture-paddle-tokens.mjs
import { openDoc, renderRegion } from "./lib/renderRegion.mjs";
import * as ppu from "ppu-paddle-ocr";
import * as napi from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cropBoxToWord } from "../src/lib/ocr/raster.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = join(here, "..", "test", "fixtures", "schedule-ocr");
const DPIS = [144, 216, 288];
const CASES = { "material-schedule": { pdf: join(here, "..", "..", "demo", "sample-finish-plan.pdf"), page: 2 } };

const svc = new ppu.PaddleOcrService({ model: ppu.V5_EN_MOBILE_MODEL });
await svc.initialize();

for (const [id, src] of Object.entries(CASES)) {
  const fixture = JSON.parse(readFileSync(join(fixDir, `${id}.words.json`), "utf8"));
  const doc = await openDoc(src.pdf);
  for (const dpi of DPIS) {
    const zoom = dpi / (72 * fixture.renderScale);
    const rendered = await renderRegion(doc, src.page, { rect: fixture.rect, zoom });
    const img = await napi.loadImage(rendered.png);
    const cv = napi.createCanvas(rendered.width, rendered.height);
    cv.getContext("2d").drawImage(img, 0, 0);
    const res = await svc.recognize(cv);
    rendered.release();
    const words = [];
    for (const line of res?.lines ?? []) {
      for (const cell of line ?? []) {
        const str = (cell.text ?? "").trim();
        if (!str || !cell.box) continue;
        const { x, y, width, height } = cell.box;
        const w = cropBoxToWord(str, { x0: x, y0: y, x1: x + width, y1: y + height }, rendered.geometry, cell.confidence);
        // round for a stable, readable fixture
        const r = (v) => Math.round(v * 100) / 100;
        words.push({ str: w.str, x: r(w.x), y: r(w.y), w: r(w.w), h: r(w.h), confidence: r(w.confidence ?? 0) });
      }
    }
    const out = { source: fixture.source, page: src.page, dpi, renderScale: fixture.renderScale, rect: fixture.rect, engine: "paddle-ppocrv5-en-mobile", words };
    const path = join(fixDir, `${id}.paddle-${dpi}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    console.log(`${id} @ ${dpi}dpi: ${words.length} cell tokens → ${path}`);
  }
  await doc.destroy();
}
await svc.destroy();
