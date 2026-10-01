// #471 evidence capture: read both sheets of demo-image-only.pdf with the real
// shipped engine (web/dist on :8931), recording every worker "recognize"
// request (geometry) and "result" reply (words, sheet coords) by id, plus the
// app's own ocr:v1:* cache entries. Fresh profile each run (a cache hit sends
// no recognize).
import { chromium } from "playwright";
import { writeFileSync, rmSync } from "node:fs";
const D = new URL(".", import.meta.url).pathname;
const PROFILE = `${D}/profile-cap-${Date.now()}`;
rmSync(PROFILE, { recursive: true, force: true });
const EXE = process.env.CHROMIUM || undefined; // Chrome/Chromium binary; unset = Playwright's bundled one
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, executablePath: EXE, viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  const cap = { events: [] };
  window.__ocrCap = cap;
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(u, o) {
      super(u, o);
      this.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type === "result") cap.events.push({ kind: "result", id: d.id, words: d.words ?? [] });
        else if (d && d.type === "error" && d.id != null) cap.events.push({ kind: "error", id: d.id, message: d.message });
      });
    }
    postMessage(m, t) {
      if (m && m.type === "recognize") {
        const g = m.geometry;
        cap.events.push({ kind: "recognize", id: m.id, width: m.width, height: m.height, geometry: { rect: { ...g.rect }, zoom: g.zoom } });
      }
      return super.postMessage(m, t);
    }
  };
});
const page = ctx.pages()[0] || await ctx.newPage();
const shot = async (n) => { await page.screenshot({ path: `${D}/shots/${n}.png` }); };
const body = () => page.locator("body").innerText();
async function waitFor(re, ms = 900000) { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(await body())) return; await page.waitForTimeout(500); } throw new Error("timeout " + re); }
const mark = (label) => page.evaluate((l) => window.__ocrCap.events.push({ kind: "mark", label: l }), label);

await page.goto((process.env.BASE || "http://localhost:8931") + "/"); await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Load sample plan/ }).click(); await page.waitForTimeout(5000);
await page.getByRole("button", { name: /^Sheets$/ }).click(); await page.waitForTimeout(700);
await page.getByText("Open visual gallery").click(); await page.waitForTimeout(2000);
await page.locator("input[type=file]").first().setInputFiles(D + "/demo-image-only.pdf"); await page.waitForTimeout(10000);
await shot("01-loaded");
await mark("sheet1");
await page.getByRole("button", { name: /Read page text/i }).first().click();
await page.getByRole("button", { name: /^Download$/ }).waitFor({ timeout: 15000 });
await shot("02-notice");
await page.getByRole("button", { name: /^Download$/ }).click();
await waitFor(/Reading tiles 0\//);
await waitFor(/Read in [\d.]+ s · OCR/);
await shot("03-sheet1-done");
const label1 = (await body()).match(/Read in [\d.]+ s · OCR/)[0];
await mark("sheet2");
await page.getByRole("button", { name: /^Sheets$/ }).click(); await page.waitForTimeout(700);
await page.getByText("Open visual gallery").click(); await page.waitForTimeout(3000);
for (let i = 0; i < 4; i++) { await page.mouse.move(700, 500); await page.mouse.wheel(0, 600); await page.waitForTimeout(600); }
await page.waitForTimeout(2000);
await shot("04-gallery");
await page.getByRole("button", { name: /^Read page text/ }).last().click();
const card2 = async () => { const ls = (await body()).split("\n"); const i = ls.findIndex((l) => l.trim() === "demo-image-only · 2"); return i < 0 ? "" : ls.slice(i, i + 4).join(" | "); };
{ const t = Date.now(); while (!/Read in [\d.]+ s · OCR/.test(await card2())) { if (Date.now() - t > 900000) throw new Error("sheet2 timeout"); await page.waitForTimeout(500); } }
await shot("05-sheet2-done");
const label2 = await card2();
await page.waitForTimeout(1500);
const events = await page.evaluate(() => window.__ocrCap.events);
const cache = await page.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open("opentakeoff");
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result, out = {};
    const tx = db.transaction("meta", "readonly"), os = tx.objectStore("meta");
    const c = os.openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return; if (String(cur.key).startsWith("ocr:v1:")) out[cur.key] = cur.value; cur.continue(); };
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error);
  };
}));
writeFileSync(`${D}/capture.json`, JSON.stringify({ label1, label2, events, cache }));
console.log(JSON.stringify({ label1, label2, events: events.length, recog: events.filter((e) => e.kind === "recognize").length, cacheKeys: Object.keys(cache) }));
await ctx.close();
