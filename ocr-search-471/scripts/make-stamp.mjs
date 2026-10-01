// The image-only demo plus a few real text runs drawn on top: a stamp and two typed fields on sheet 1 (3 runs),
// and 9 short runs on sheet 2 (just over the scan threshold).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const W = process.env.W; const require = createRequire(W + "/package.json");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const doc = await PDFDocument.load(readFileSync("demo-image-only.pdf"));
const f = await doc.embedFont(StandardFonts.Helvetica);
const [p1, p2] = doc.getPages();
p1.drawText("RECEIVED SEP 30 2026", { x: 2300, y: 2050, size: 28, font: f, color: rgb(0.7, 0, 0) });
p1.drawText("SCANNED BY OFFICE", { x: 60, y: 30, size: 14, font: f });
p1.drawText("JOB 4471", { x: 2600, y: 80, size: 18, font: f });
for (let i = 0; i < 9; i++) p2.drawText("NOTE " + (i + 1), { x: 60 + i * 150, y: 2100, size: 14, font: f });
writeFileSync("demo-stamped.pdf", await doc.save());
const pdfjs = await import(W + "/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const d = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("demo-stamped.pdf")) }).promise;
for (let n = 1; n <= 2; n++) { const tc = await (await d.getPage(n)).getTextContent(); console.log("page", n, "items", tc.items.filter((i) => i.str.trim()).length, tc.items.map((i) => i.str).filter((s) => s.trim()).join(" | ")); }
