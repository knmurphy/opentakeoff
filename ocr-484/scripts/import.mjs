// Import from schedule in the UI: classic layout, ⋯ → Import from schedule, two corners round `rect` (pt).
// node import.mjs <tag> <pdf> <pageW,pageH pt> <x0,y0,x1,y1 pt> [noshots]
import { writeFileSync } from "node:fs";
import { E, browser, body, openPdf, mapper, load } from "./lib.mjs";
const [tag, pdf, pageS, rectS, noshots] = process.argv.slice(2);
const pagePt = pageS.split(",").map(Number), rect = rectS.split(",").map(Number);
const shots = !noshots;
const shot = async (p, n) => { if (shots) { await p.screenshot({ path: `${E}shots/${tag}-${n}.png` }); } };
const b = await browser();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
const loadBefore = load();
await openPdf(p, pdf);
await p.getByTitle(/^More — guide/).first().click(); await p.waitForTimeout(400);
await p.getByText("Import from schedule").first().click(); await p.waitForTimeout(400);
const m = await mapper(p, pagePt);
await p.mouse.click(...m.at(rect[0], rect[1])); await p.waitForTimeout(300);
await p.mouse.move(...m.at(rect[2], rect[3])); await p.waitForTimeout(300);
await shot(p, "1-box");
await p.mouse.click(...m.at(rect[2], rect[3]));
const t0 = Date.now(); const statuses = []; let midShot = false, downloadAt = null, readStart = null;
const status = () => p.evaluate(() => document.querySelector("[data-import-read-status]")?.innerText.trim() ?? "");
let ended = null;
while (Date.now() - t0 < 1200000) {
  if (await p.getByRole("button", { name: /^Download$/ }).count()) { await shot(p, "2-notice"); await p.getByRole("button", { name: /^Download$/ }).click(); downloadAt = Date.now() - t0; }
  const s = (await status()).replace(/\s*Cancel$/, "");
  if (s && (!statuses.length || statuses.at(-1).s !== s)) { statuses.push({ ms: Date.now() - t0, s }); if (/Reading/.test(s) && readStart == null) readStart = Date.now() - t0; }
  if (!midShot && /rasters? read|Reading the schedule/.test(s) && (/rasters read/.test(s) || Date.now() - t0 > 4000)) { await shot(p, "3-reading"); midShot = /rasters read/.test(s); }
  const dlg = await p.getByRole("dialog").filter({ hasText: /Import from schedule —/ }).count();
  if (dlg) { ended = "dialog"; break; }
  if (statuses.length && !s) { await p.waitForTimeout(800); if (!(await status())) { ended = "message"; break; } }
  await p.waitForTimeout(200);
}
const elapsed = Date.now() - t0;
await p.waitForTimeout(600);
await shot(p, "4-result");
const txt = await body(p);
const dialog = ended === "dialog" ? await p.getByRole("dialog").filter({ hasText: /Import from schedule —/ }).first().innerText() : null;
const title = dialog ? dialog.split("\n").find((l) => /Import from schedule —/.test(l)) : null;
const message = txt.split("\n").find((l) => /No schedule found|Found finish codes|Couldn't read|too large|stopped responding|schedule/i.test(l) && !/Import from schedule$/.test(l)) ?? null;
const out = { tag, pdf, rect, ended, elapsed, readMs: readStart == null ? null : elapsed - readStart, downloadAt, statuses, title, message, dialog, errs, loadBefore, loadAfter: load() };
writeFileSync(`${E}data/import-${tag}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ tag, ended, elapsed, title, message: ended === "message" ? message : undefined, statuses: statuses.map((x) => x.s) }));
await b.close();
