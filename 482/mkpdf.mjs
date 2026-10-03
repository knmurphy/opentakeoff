import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(process.cwd() + "/package.json");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument } = require("pdf-lib");
const DPI = 200, S = DPI / 72, Wpt = 17 * 72, Hpt = 11 * 72;
const c = createCanvas(Math.round(Wpt * S), Math.round(Hpt * S)), g = c.getContext("2d");
g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
const X0 = 72 * S, Y0 = 72 * S, rowH = 0.3 * 72 * S;
const cols = [["CODE", 0.9], ["MATERIAL", 3.2], ["MANUFACTURER", 1.6], ["COLOR", 1.6]];
const rows = [
  ["CPT-1", "CARPET / BROADLOOM / LOOP", "VENDOR-A", "GREY 101"],
  ["PT-O1", "PAINT / EGGSHELL", "VENDOR-B", "WHITE 601"],
  ["$SM-1", "SHEET MEMBRANE / SEALED", "VENDOR-C", "CLEAR"],
  ["G-O1(C)", "GROUT / EPOXY", "VENDOR-D", "GREY 05"],
  ["RB-1", "RUBBER BASE / 4 IN", "VENDOR-E", "BLACK 505"],
  ["LVT-1", "LUXURY VINYL TILE", "VENDOR-F", "OAK 303"],
];
g.strokeStyle = "#000"; g.lineWidth = 1.2 * S; g.fillStyle = "#000"; g.textBaseline = "middle";
g.font = `bold ${Math.round(9 * S)}px "Arial"`; g.fillText("FINISH SCHEDULE", X0, Y0 - 0.25 * 72 * S);
const all = [cols.map((c) => c[0]), ...rows];
all.forEach((r, i) => {
  let x = X0; const y = Y0 + i * rowH;
  g.font = `${i === 0 ? "bold " : ""}${Math.round(7 * S)}px "Arial"`;
  r.forEach((t, j) => { const w = cols[j][1] * 72 * S; g.strokeRect(x, y, w, rowH); g.fillText(t, x + 1.5 * S, y + rowH / 2); x += w; });
});
const doc = await PDFDocument.create(); const page = doc.addPage([Wpt, Hpt]);
const png = await doc.embedPng(c.toBuffer("image/png")); page.drawImage(png, { x: 0, y: 0, width: Wpt, height: Hpt });
writeFileSync(process.argv[2], await doc.save()); console.log("ok");
