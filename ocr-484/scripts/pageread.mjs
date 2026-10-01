// Read page text on both sheets of the image-only demo in the real app, then search tags in the gallery.
// node pageread.mjs <tag> <profileDir|fresh> [read|check]
//   read : open the PDF, Read page text on sheet 1 (canvas control) and sheet 2 (gallery card), save the ocr:v1 cache entries
//   check: open the PDF in an existing profile WITHOUT reading: what the saved read offers (Read again?) and whether search finds it
import { writeFileSync, rmSync } from "node:fs";
import { E, persistent, body, openPdf, load } from "./lib.mjs";
const [tag, prof, mode = "read"] = process.argv.slice(2);
const PDF = E + "inputs/demo-image-only.pdf";
const TERMS = ["E-02", "CE-3", "AC-18", "CPT-2", "T1"];
const dir = prof === "fresh" ? `${E}profiles/${tag}-${Date.now()}` : prof;
if (prof === "fresh") rmSync(dir, { recursive: true, force: true });
const ctx = await persistent(dir);
const p = ctx.pages()[0] || await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
const shot = (n) => p.screenshot({ path: `${E}shots/${tag}-${n}.png` });
const out = { tag, mode, profile: dir, loadBefore: load(), sheets: {}, search: {}, errs };
const KEYS = { 1: "demo-image-only.pdf", 2: "demo-image-only.pdf#2" };
const card = async (n) => p.evaluate((k) => { const c = document.querySelector(`[data-sheetkey="${k}"]`); return c ? c.innerText.replace(/\n/g, " | ") : ""; }, KEYS[n]);
const visibleCards = () => p.evaluate(() => [...document.querySelectorAll("[data-sheetkey]")].filter((c) => c.offsetParent !== null).map((c) => ({ key: c.getAttribute("data-sheetkey"), text: c.innerText.replace(/\n/g, " | ").slice(0, 160) })));
const gallery = async () => { await p.getByRole("button", { name: /^Sheets$/ }).click(); await p.waitForTimeout(700); await p.getByText("Open visual gallery").click(); await p.waitForTimeout(3000); };
if (mode === "check") {
  // the profile from the BEFORE read: does the project come back on its own?
  await p.goto((process.env.BASE || "http://localhost:8951") + "/"); await p.waitForTimeout(6000);
  await shot("0-reopened");
  out.restored = !(await p.getByRole("button", { name: /Load sample plan/ }).count());
  out.reopenedText = (await body(p)).slice(0, 600);
  if (!out.restored) await openPdf(p, PDF, { classic: false });   // same bytes → same hash → the saved read's key
} else await openPdf(p, PDF, { classic: false });
await shot("1-loaded");
// the canvas's Read control (bottom left): its text, and whether it offers Read again
const ctrl = async () => ({ text: (await body(p)).split("\n").filter((l) => /^(Read page text|Read again|Read in [\d.]+ s · OCR.*)$/i.test(l.trim())), readAgain: await p.getByRole("button", { name: /^Read again$/i }).count() });
out.canvasControlOnOpen = await ctrl();
if (mode === "read") {
  // sheet 1: the canvas's control
  let t0 = Date.now();
  await p.getByRole("button", { name: /Read page text/i }).first().click();
  try { await p.getByRole("button", { name: /^Download$/ }).waitFor({ timeout: 15000 }); await shot("2-notice"); await p.getByRole("button", { name: /^Download$/ }).click(); out.downloadMs = Date.now() - t0; } catch { out.noNotice = true; }
  t0 = Date.now();
  let mid = false;
  while (!/Read in [\d.]+ s · OCR/.test(await body(p))) { if (!mid && /Reading tiles [1-9]/.test(await body(p))) { await shot("3-reading"); mid = true; } if (Date.now() - t0 > 1200000) throw new Error("sheet1 timeout"); await p.waitForTimeout(250); }
  out.sheets[1] = { wallMs: Date.now() - t0, label: (await body(p)).match(/Read in [\d.]+ s · OCR/)[0], loadAfter: load() };
  await shot("4-sheet1-done");
  // sheet 2: its gallery card
  await gallery();
  for (let i = 0; i < 4; i++) { await p.mouse.move(700, 500); await p.mouse.wheel(0, 600); await p.waitForTimeout(600); }
  t0 = Date.now();
  await p.getByRole("button", { name: /^Read page text/ }).last().click();
  while (!/Read in [\d.]+ s · OCR/.test(await card(2))) { if (Date.now() - t0 > 1200000) throw new Error("sheet2 timeout"); await p.waitForTimeout(250); }
  out.sheets[2] = { wallMs: Date.now() - t0, label: await card(2), loadAfter: load() };
  await shot("5-sheet2-done");
  await p.keyboard.press("Escape"); await p.waitForTimeout(800);
}
// the gallery's plan-set search
await gallery();
const box = p.getByPlaceholder("Search sheet text…");
for (const term of TERMS) {
  await box.fill(""); await box.fill(term); await p.waitForTimeout(2500);
  const txt = await body(p);
  const i = txt.indexOf("Search sheet text");
  out.search[term] = { count: (txt.match(/\d+ of \d+ sheets? match(es)?|No sheet[^\n]*/) || [null])[0], visible: await visibleCards() };
  out.search[term].ocrSheetsHit = out.search[term].visible.filter((c) => c.key.startsWith("demo-image-only")).map((c) => c.key);
  await shot(`6-search-${term}`);
}
await box.fill(""); await p.waitForTimeout(800);
out.galleryCards = [await card(1), await card(2)];
await shot("7-gallery");
await p.keyboard.press("Escape"); await p.waitForTimeout(800);
out.canvasControlAfter = await ctrl();
await shot("8-canvas");
out.cache = await p.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open("opentakeoff"); r.onerror = () => rej(r.error);
  r.onsuccess = () => { const db = r.result, o = {}; const tx = db.transaction("meta", "readonly"); const c = tx.objectStore("meta").openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return; if (String(cur.key).startsWith("ocr:v1:")) o[cur.key] = cur.value; cur.continue(); };
    tx.oncomplete = () => res(o); tx.onerror = () => rej(tx.error); };
}));
out.loadAfter = load();
writeFileSync(`${E}data/pageread-${tag}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ tag, sheets: out.sheets, canvasControlOnOpen: out.canvasControlOnOpen, canvasControlAfter: out.canvasControlAfter, cacheKeys: Object.entries(out.cache).map(([k, v]) => [k.slice(-3), v.opts, v.lines.length, Math.round(v.ms), v.rasters]), errs }, null, 1));
await ctx.close();
