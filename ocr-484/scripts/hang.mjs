// Watchdog in the browser: the page's Worker is wrapped (init script, no shipped code changed) so the FIRST
// "recognize" message posted to the OCR worker is dropped: the worker never answers it, as a hung engine.
// Then Import from schedule on the rotated table (one small raster: its deadline is the 120 s floor), real wait.
// Afterwards a second import of the same box (nothing dropped) must succeed on the restarted engine.
// node hang.mjs <tag> <maxWaitMs>
import { writeFileSync } from "node:fs";
import { E, browser, body, openPdf, mapper, load } from "./lib.mjs";
const [tag, maxWaitS = "300000"] = process.argv.slice(2);
const MAXW = Number(maxWaitS);
const b = await browser();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.addInitScript(() => {
  const log = (window.__hangLog = []);
  window.__dropLeft = 1;
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(u, o) { super(u, o); log.push({ t: performance.now(), ev: "new Worker" }); this.addEventListener("message", (e) => { const d = e.data; if (d && d.type) log.push({ t: performance.now(), ev: "msg " + d.type, id: d.id }); }); }
    postMessage(m, tr) {
      if (m && m.type) log.push({ t: performance.now(), ev: "post " + m.type, id: m.id, w: m.width, h: m.height });
      if (m && m.type === "recognize" && window.__dropLeft > 0) { window.__dropLeft--; log.push({ t: performance.now(), ev: "DROPPED recognize", id: m.id, w: m.width, h: m.height }); return; }
      return super.postMessage(m, tr);
    }
    terminate() { log.push({ t: performance.now(), ev: "terminate" }); return super.terminate(); }
  };
});
const out = { tag, loadBefore: load(), runs: [], errs };
await openPdf(p, E + "inputs/rotated.pdf");
out.visibility = await p.evaluate(() => document.visibilityState);
const status = () => p.evaluate(() => document.querySelector("[data-import-read-status]")?.innerText.trim().replace(/\s*Cancel$/i, "") ?? "");
const footerMsg = async () => (await body(p)).split("\n").find((l) => /No schedule found|Found finish codes|Couldn't read|stopped responding/i.test(l)) ?? null;
async function importBox(n) {
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.getByTitle(/^More — guide/).first().click(); await p.waitForTimeout(400);
  await p.getByText("Import from schedule").first().click(); await p.waitForTimeout(400);
  const m = await mapper(p, [1224, 792]);
  await p.mouse.click(...m.at(62, 55.6)); await p.waitForTimeout(300);
  await p.mouse.click(...m.at(1072, 410));
  const t0 = Date.now(); const seen = []; let shots = 0;
  const run = { n, statuses: seen };
  while (Date.now() - t0 < MAXW) {
    if (await p.getByRole("button", { name: /^Download$/ }).count()) { await p.getByRole("button", { name: /^Download$/ }).click(); run.downloadAt = Date.now() - t0; }
    const s = await status();
    if (s && (!seen.length || seen.at(-1).s !== s)) seen.push({ ms: Date.now() - t0, s });
    if (n === 1 && shots < 2 && Date.now() - t0 > (shots ? 100000 : 30000)) { await p.screenshot({ path: `${E}shots/${tag}-run${n}-waiting-${shots ? "100s" : "30s"}.png` }); shots++; }
    const msg = await footerMsg();
    if (!s && seen.length && msg) { run.message = msg; break; }
    if (await p.getByRole("dialog").filter({ hasText: /Import from schedule —/ }).count()) { run.message = "dialog"; break; }
    await p.waitForTimeout(500);
  }
  run.elapsed = Date.now() - t0;
  run.finalStatus = await status();
  run.endedBy = run.message ? "result" : "maxWait";
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${E}shots/${tag}-run${n}-end.png` });
  out.runs.push(run);
  console.log(JSON.stringify(run));
}
await importBox(1);
// BEFORE has no watchdog: the first read never ends; cancel it so the second can try
if (out.runs[0].endedBy === "maxWait") { const c = p.getByRole("button", { name: /^Cancel$/i }); if (await c.count()) { await c.first().click(); out.cancelled = true; await p.waitForTimeout(1000); } }
await importBox(2);
out.log = await p.evaluate(() => window.__hangLog);
out.loadAfter = load();
writeFileSync(`${E}data/hang-${tag}.json`, JSON.stringify(out, null, 1));
await b.close();
