// Page 2 (AF600) of the image-only demo as its own one-page PDF (the page is copied unchanged).
import { createRequire } from "node:module"; import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(process.env.W + "/package.json"); const { PDFDocument } = require("pdf-lib");
const src = await PDFDocument.load(readFileSync(process.env.SRC)); const out = await PDFDocument.create();
const [pg] = await out.copyPages(src, [1]); out.addPage(pg); console.log(pg.getSize());
writeFileSync(process.env.OUT, await out.save());
