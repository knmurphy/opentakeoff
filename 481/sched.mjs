// Drive one on-device page read of an image-only PDF in a fresh browser
// context and record every word the OCR worker returns.
//   node read.mjs <port> <tag> <pdf> <outdir>
// Writes <outdir>/<tag>-words.json (all worker `result` replies, in order),
// <tag>-1-before.png (Read page text offered), <tag>-2-read.png.
import { chromium } from "playwright"; // npm i playwright && npx playwright install chromium
import { writeFileSync } from "node:fs";
const [port, tag, pdf, OUT] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "light" });
await ctx.addInitScript(() => {
  try { localStorage.setItem("ot.workspace-layout.v1", JSON.stringify({ version: 1, enabled: false })); } catch {}
  // Record the OCR worker's replies without changing them.
  const W = window.Worker;
  window.__ocr = [];
  window.__tiles = [];
  window.Worker = class extends W {
    postMessage(m, t) {
      if (m && m.type === "recognize" && m.rgba) {
        // Chroma (max-min) histogram of the tile as rendered, and how far
        // Rec. 601 luma is from the R byte ppu reads. Read-only.
        const d = m.rgba, h = [0, 0, 0, 0, 0];
        let diff = 0, maxDiff = 0;
        for (let p = 0; p < d.length; p += 4) {
          const r = d[p], g = d[p + 1], b = d[p + 2];
          const c = Math.max(r, g, b) - Math.min(r, g, b);
          h[c === 0 ? 0 : c <= 8 ? 1 : c <= 32 ? 2 : c <= 64 ? 3 : 4]++;
          const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          if (y !== r) { diff++; if (Math.abs(y - r) > maxDiff) maxDiff = Math.abs(y - r); }
        }
        window.__tiles.push({ id: m.id, w: m.width, h: m.height, rect: m.geometry?.rect, chroma: h, yNeR: diff, maxDiff });
      }
      return super.postMessage(m, t);
    }
    constructor(...a) {
      super(...a);
      this.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type === "result") window.__ocr.push({ id: d.id, words: d.words.map((w) => ({ str: w.str, x: w.x, y: w.y, w: w.w, h: w.h, confidence: w.confidence })) });
        if (d && d.type === "ready") window.__ready = performance.now();
      });
    }
  };
});
const page = await ctx.newPage();
const log = (...a) => console.log(`[${tag}]`, ...a);
page.on("pageerror", (e) => log("PAGEERROR", e.message));
await page.goto(`http://localhost:${port}/`);
await page.locator("input[type=file]").first().setInputFiles(pdf);
await page.waitForTimeout(6000);
const v = page.getByRole("button", { name: "VIEW", exact: true });
if (await v.count()) { await v.nth(0).click(); await page.waitForTimeout(4000); }
// Import from schedule: box the MATERIAL SCHEDULE (screen coords for the
// demo sheet at the default fit), accept the download notice, screenshot the dialog.
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/${tag}-1-before.png` });
await page.getByRole("button", { name: "⋯" }).click(); await page.waitForTimeout(400);
await page.getByText("Import from schedule", { exact: true }).click(); await page.waitForTimeout(400);
const [x0, y0, x1, y1] = (process.env.BOX || "815,275,1140,550").split(",").map(Number);
await page.mouse.move(x0, y0); await page.mouse.click(x0, y0); await page.waitForTimeout(250);
await page.mouse.move(x1, y1); await page.waitForTimeout(250); await page.mouse.click(x1, y1);
await page.waitForTimeout(1500);
const dl = page.getByRole("button", { name: /^Download/i });
if (await dl.count()) await dl.click();
const t0 = Date.now(); let st = "";
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(500);
  if (await page.evaluate(() => !![...document.querySelectorAll("span")].find((e) => e.textContent.startsWith("Import from schedule —")))) { st = "dialog"; break; }
}
const secs = (Date.now() - t0) / 1000;
log("state:", st, secs.toFixed(1) + "s");
await page.screenshot({ path: `${OUT}/${tag}-2-dialog.png` });
const dialogText = await page.evaluate(() => document.body.innerText);
writeFileSync(`${OUT}/${tag}-dialog.txt`, dialogText);
const replies = await page.evaluate(() => window.__ocr);
const tiles = await page.evaluate(() => window.__tiles);
for (const t of tiles) log("tile", t.id, `${t.w}x${t.h}`, "rect", t.rect && [t.rect.x0, t.rect.y0, t.rect.x1, t.rect.y1].map(Math.round).join(","), "chroma[0,1-8,9-32,33-64,>64]", t.chroma.join(","), "Y!=R", t.yNeR, "max|Y-R|", t.maxDiff);
const stored = {}; void (() => new Promise((res, rej) => {
  const r = indexedDB.open("opentakeoff");
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const tx = r.result.transaction("meta", "readonly"), st = tx.objectStore("meta"), out = {};
    const c = st.openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return res(out); if (String(cur.key).startsWith("ocr:v1:")) out[cur.key] = cur.value; cur.continue(); };
  };
}));
writeFileSync(`${OUT}/${tag}-words.json`, JSON.stringify({ state: st, secs, replies, tiles }, null, 1));
log("stored entries:", Object.keys(stored).length, Object.values(stored).map((v) => `${v.lines?.length} lines opts=${v.opts} rasters=${v.rasters}`).join("; "));
log("replies:", replies.length, "words:", replies.reduce((n, r) => n + r.words.length, 0));
await browser.close();
