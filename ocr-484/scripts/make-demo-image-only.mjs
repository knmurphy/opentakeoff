import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const W = process.env.W, OUT = process.env.OUT, DPI = 200;
const require = createRequire(W + "/package.json");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument } = require("pdf-lib");
const pdfjs = await import(W + "/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(readFileSync(W + "/public/demo/sample-finish-plan.pdf"));
const doc = await pdfjs.getDocument({ data, standardFontDataUrl: W + "/node_modules/pdfjs-dist/standard_fonts/", disableFontFace: true }).promise;
const out = await PDFDocument.create();
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: DPI / 72 });
  const c = createCanvas(Math.round(vp.width), Math.round(vp.height)), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const img = await out.embedPng(c.toBuffer("image/png"));
  out.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
  console.log("page", n, "pt", vp1.width, vp1.height, "in", (vp1.width/72).toFixed(1), (vp1.height/72).toFixed(1));
}
const bytes = await out.save();
writeFileSync(OUT + "/demo-image-only.pdf", bytes);
const d2 = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
for (let n = 1; n <= d2.numPages; n++) console.log("check page", n, "textItems", (await (await d2.getPage(n)).getTextContent()).items.length);
console.log("bytes", bytes.length);
