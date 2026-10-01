// Synthetic finish-schedule inputs for #484 diagnosis. Each table is drawn on a
// canvas at 200 DPI and embedded as an image-only PDF page (like a scan).
// Ground truth: every cell's text and bbox in PDF points (top-down y).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const W = process.env.W, OUT = process.env.OUT, DPI = 200, S = DPI / 72;
mkdirSync(OUT + "/inputs", { recursive: true });
const require = createRequire(W + "/package.json");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument, rgb } = require("pdf-lib");

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const CATS = [
  { pre: "CPT", mat: "CARPET TILE", mfr: ["MAKER A", "MAKER B CONTRACT", "MAKER C FLOORING", "MAKER D GROUP"], size: ['24" x 24"', '18" x 36"', '12" x 48"'] },
  { pre: "LVT", mat: "LUXURY VINYL TILE", mfr: ["MAKER E", "MAKER F", "MAKER G", "MAKER H"], size: ['6" x 48"', '9" x 59"', '18" x 18"'] },
  { pre: "RB", mat: "RESILIENT BASE", mfr: ["MAKER J", "MAKER K", "MAKER L FLOORING"], size: ['4"', '6"'] },
  { pre: "P", mat: "PAINT", mfr: ["MAKER M COATINGS", "MAKER N PAINT", "MAKER P PAINTS"], size: ["-"] },
  { pre: "ACT", mat: "ACOUSTICAL CEILING TILE", mfr: ["MAKER Q", "MAKER G", "MAKER R"], size: ["2' x 2'", "2' x 4'"] },
  { pre: "CT", mat: "CERAMIC WALL TILE", mfr: ["MAKER S", "MAKER T TILE", "MAKER U"], size: ['3" x 6"', '4" x 12"', '2" x 2"'] },
  { pre: "SV", mat: "SHEET VINYL", mfr: ["MAKER V", "MAKER W", "MAKER X"], size: ["6' ROLL"] },
  { pre: "TS", mat: "TRANSITION STRIP", mfr: ["MAKER Y", "MAKER J"], size: ["TO FIT"] },
];
const STYLES = ["SERIES ONE", "SERIES TWO BLOCK", "SERIES THREE", "SERIES FOUR", "STANDARD SERIES", "SERIES SIX", "BASIC SERIES", "SERIES EIGHT", "SOLID SERIES", "SERIES TEN"];
const COLORS = ["WHITE 51839", "PEPPER D137", "BEIGE HC-45", "DARK GRAY 7069", "WILLOW QF42", "ALMOND PL22", "CHARCOAL 4501", "LIGHT GRAY 7029", "UMBER 63", "SLATE 220"];
const DESCS = ["TYP. ALL CORRIDORS", "OFFICES AND CONFERENCE", "INSTALL ASHLAR", "MONOLITHIC INSTALL", "WET AREAS ONLY", "SEE PLANS", "EGGSHELL FINISH", "SEMI-GLOSS AT DOORS", "HEAT WELD SEAMS", "PROVIDE ATTIC STOCK"];
const REMARKS = ["", "PROVIDE 2% ATTIC STOCK", "SEE SPEC 09 65 13", "", "GROUT: 00 WHITE", "", "VERIFY WITH ARCHITECT", ""];

function rowsFor(n) {
  const counter = {};
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = CATS[i % CATS.length];
    counter[c.pre] = (counter[c.pre] || 0) + 1;
    rows.push([`${c.pre}-${counter[c.pre]}`, c.mat, pick(DESCS), pick(c.mfr), pick(STYLES), pick(COLORS), pick(c.size), pick(REMARKS)]);
  }
  return rows;
}
const HDR = ["CODE", "MATERIAL", "DESCRIPTION", "MANUFACTURER", "STYLE", "COLOR", "SIZE", "REMARKS"];

/** Draw a table onto ctx (pt coords scaled by S). Returns ground truth. */
function drawTable(ctx, { x0, y0, colW, rowH, hdrH, hdr, rows, fontPt = 9, rotateHeader = false, title, wrap = {} }) {
  const cells = [];
  const totalW = colW.reduce((a, b) => a + b, 0);
  const rowHs = rows.map((_, i) => (wrap[i] ? rowH * 1.75 : rowH));
  const totalH = hdrH + rowHs.reduce((a, b) => a + b, 0);
  ctx.save(); ctx.scale(S, S);
  ctx.fillStyle = "#000"; ctx.strokeStyle = "#000"; ctx.lineWidth = 0.7;
  if (title) {
    ctx.font = `bold ${fontPt * 1.6}px Arial`;
    ctx.fillText(title, x0, y0 - 10);
    cells.push({ row: -2, col: 0, text: title, bbox: [x0, y0 - 10 - fontPt * 1.6, x0 + ctx.measureText(title).width, y0 - 10] });
  }
  ctx.strokeRect(x0, y0, totalW, totalH);
  let x = x0;
  for (let c = 0; c < colW.length; c++) { if (c) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + totalH); ctx.stroke(); } x += colW[c]; }
  let y = y0 + hdrH;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + totalW, y); ctx.lineWidth = 1.4; ctx.stroke(); ctx.lineWidth = 0.7;
  // header
  ctx.font = `bold ${fontPt}px Arial`;
  x = x0;
  for (let c = 0; c < hdr.length; c++) {
    const t = hdr[c], tw = ctx.measureText(t).width;
    if (rotateHeader) {
      ctx.save(); ctx.translate(x + colW[c] / 2 + fontPt * 0.35, y0 + hdrH - 4); ctx.rotate(-Math.PI / 2); ctx.fillText(t, 0, 0); ctx.restore();
      cells.push({ row: -1, col: c, text: t, rotated: true, bbox: [x + colW[c] / 2 - fontPt * 0.4, y0 + hdrH - 4 - tw, x + colW[c] / 2 + fontPt * 0.35, y0 + hdrH - 4] });
    } else {
      const by = y0 + hdrH / 2 + fontPt * 0.36;
      ctx.fillText(t, x + 4, by);
      cells.push({ row: -1, col: c, text: t, bbox: [x + 4, by - fontPt * 0.72, x + 4 + tw, by] });
    }
    x += colW[c];
  }
  ctx.font = `${fontPt}px Arial`;
  for (let r = 0; r < rows.length; r++) {
    const rh = rowHs[r];
    x = x0;
    for (let c = 0; c < rows[r].length; c++) {
      const t = rows[r][c];
      const lines = wrap[r] && wrap[r][c] ? wrap[r][c] : [t];
      lines.forEach((ln, k) => {
        if (!ln) return;
        const by = lines.length > 1 ? y + rh / 2 - fontPt * 0.25 + (k - 0.5) * fontPt * 1.25 + fontPt * 0.36 : y + rh / 2 + fontPt * 0.36;
        ctx.fillText(ln, x + 4, by);
        cells.push({ row: r, col: c, line: k, text: ln, bbox: [x + 4, by - fontPt * 0.72, x + 4 + ctx.measureText(ln).width, by] });
      });
      x += colW[c];
    }
    y += rh;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + totalW, y); ctx.stroke();
  }
  ctx.restore();
  return { cells, bbox: [x0, y0 - (title ? 10 + fontPt * 1.6 : 0), x0 + totalW, y0 + totalH], codes: rows.map((r) => r[0]), header: hdr };
}

/** Revision cloud: arcs (scallops) around a rectangle, as CAD draws one. */
function cloudPath(x0, y0, x1, y1, r) {
  const pts = [];
  const edge = (ax, ay, bx, by) => { const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / (2 * r))); for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]); };
  edge(x0, y0, x1, y0); edge(x1, y0, x1, y1); edge(x1, y1, x0, y1); edge(x0, y1, x0, y0);
  pts.push(pts[0]);
  return pts;
}
function strokeCloudCanvas(ctx, pts, lw) {
  ctx.save(); ctx.scale(S, S); ctx.lineWidth = lw; ctx.strokeStyle = "#000"; ctx.beginPath();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, rr = Math.hypot(bx - ax, by - ay) / 2;
    const a0 = Math.atan2(ay - cy, ax - cx);
    ctx.moveTo(ax, ay); ctx.arc(cx, cy, rr, a0, a0 + Math.PI, false); // bulge outward (clockwise ring)
  }
  ctx.stroke(); ctx.restore();
}
function cloudSvg(pts) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], rr = Math.hypot(bx - ax, by - ay) / 2;
    d += ` A ${rr} ${rr} 0 0 1 ${bx} ${by}`;
  }
  return d;
}

async function makePdf(name, wIn, hIn, draw) {
  const wPt = wIn * 72, hPt = hIn * 72;
  const c = createCanvas(Math.round(wPt * S), Math.round(hPt * S)), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  const gt = draw(ctx);
  const doc = await PDFDocument.create();
  const page = doc.addPage([wPt, hPt]);
  page.drawImage(await doc.embedPng(c.toBuffer("image/png")), { x: 0, y: 0, width: wPt, height: hPt });
  if (gt.vectorAfter) gt.vectorAfter(page, hPt);
  delete gt.vectorAfter;
  writeFileSync(`${OUT}/inputs/${name}.pdf`, await doc.save());
  writeFileSync(`${OUT}/inputs/${name}.gt.json`, JSON.stringify({ name, pagePt: [wPt, hPt], dpi: DPI, ...gt }, null, 1));
  writeFileSync(`${OUT}/inputs/${name}.png`, c.toBuffer("image/png"));
  console.log(name, "page", wIn, "x", hIn, "in; table bbox pt", gt.bbox.map((v) => +v.toFixed(1)).join(","), "=", ((gt.bbox[2] - gt.bbox[0]) / 72).toFixed(1), "x", ((gt.bbox[3] - gt.bbox[1]) / 72).toFixed(1), "in");
}

// (a) LARGE: 60 rows x 8 cols, ~24 x 20 in
const colsL = [80, 230, 230, 230, 230, 280, 150, 290].map((v) => v * 0.9 * 1.0);
await makePdf("large", 36, 24, (ctx) => drawTable(ctx, { x0: 120, y0: 120, colW: colsL.map((v) => v * 1.15), rowH: 22.5, hdrH: 30, hdr: HDR, rows: rowsFor(60), title: "FINISH SCHEDULE" }));

// (b) ROTATED: 10 rows, header row rotated 90 degrees
await makePdf("rotated", 17, 11, (ctx) => drawTable(ctx, { x0: 72, y0: 90, colW: [60, 150, 150, 140, 120, 150, 70, 150], rowH: 22, hdrH: 90, hdr: HDR, rows: rowsFor(10), rotateHeader: true, title: "FINISH SCHEDULE" }));

// (c) TWO-LINE: dense (row height 15 pt), some description cells wrap
{
  const rows = rowsFor(16);
  const wrap = {};
  const TWO = [["BULLNOSE EDGE AT", "VERTICAL TERMINATION"], ["INSTALL WITH", "PRESSURE SENSITIVE ADH."], ["HEAT WELD ALL", "SEAMS, COLOR MATCH"], ["SEMI-GLOSS AT", "DOOR FRAMES ONLY"], ["MONOLITHIC INSTALL", "TURN AT CORNERS"]];
  [1, 4, 7, 10, 13].forEach((r, k) => { rows[r][2] = TWO[k].join(" "); wrap[r] = { 2: TWO[k] }; });
  await makePdf("twoline", 17, 11, (ctx) => drawTable(ctx, { x0: 72, y0: 90, colW: [55, 130, 130, 120, 115, 150, 70, 150], rowH: 15, hdrH: 20, hdr: HDR, rows, fontPt: 7.5, title: "FINISH SCHEDULE", wrap }));
}

// (d) CLOUD: raster cloud and vector (hybrid) cloud
for (const variant of ["cloud-raster", "cloud-hybrid"]) {
  seed = 99;
  let cloud;
  await makePdf(variant, 17, 11, (ctx) => {
    const gt = drawTable(ctx, { x0: 72, y0: 90, colW: [60, 150, 150, 140, 120, 150, 70, 150], rowH: 22, hdrH: 26, hdr: HDR, rows: rowsFor(12), title: "FINISH SCHEDULE" });
    // cloud around rows 3-6, columns 3-6 (pt, top-down), scallop radius 9 pt
    const cx0 = 72 + 60 + 150 + 150 - 10, cx1 = 72 + 60 + 150 + 150 + 140 + 120 + 150 + 10, cy0 = 90 + 26 + 22 * 3 - 6, cy1 = 90 + 26 + 22 * 7 + 6;
    cloud = { rect: [cx0, cy0, cx1, cy1], r: 9, lw: 1.6 };
    const pts = cloudPath(cx0, cy0, cx1, cy1, cloud.r);
    if (variant === "cloud-raster") strokeCloudCanvas(ctx, pts, cloud.lw);
    else gt.vectorAfter = (page, hPt) => page.drawSvgPath(cloudSvg(pts), { x: 0, y: hPt, borderColor: rgb(0, 0, 0), borderWidth: cloud.lw });
    gt.cloud = { ...cloud, variant, nScallops: pts.length - 1 };
    return gt;
  });
}
