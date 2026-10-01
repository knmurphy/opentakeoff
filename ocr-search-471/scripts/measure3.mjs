// 471 measurement: N runs, fresh profile each. Sheet 1 read from the canvas (first ever: download + engine start,
// then the read); sheet 2 read from its gallery card with the engine already running. Renderer RSS sampled every 250 ms.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
const D = process.cwd(), RUN = process.argv[2] || "1", PROFILE = `${D}/profile-run${RUN}`;
rmSync(PROFILE, { recursive: true, force: true });
const EXE = process.env.CHROMIUM || undefined; // Chrome/Chromium binary; unset = Playwright's bundled one
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, executablePath: EXE, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${D}/shots/run${RUN}-${n}.png` });
function renderer() {
  const rows = execSync("ps -axo pid=,ppid=,rss=,command=", { maxBuffer: 64 << 20 }).toString().trim().split("\n").map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], rss: +m[3] * 1024, cmd: m[4] }; }).filter(Boolean);
  const root = rows.find((r) => r.cmd.includes(PROFILE) && !/--type=/.test(r.cmd)); if (!root) return 0;
  const set = new Set([root.pid]); let grew = true;
  while (grew) { grew = false; for (const r of rows) if (!set.has(r.pid) && set.has(r.ppid)) { set.add(r.pid); grew = true; } }
  return rows.filter((r) => set.has(r.pid) && /--type=renderer/.test(r.cmd)).reduce((a, r) => Math.max(a, r.rss), 0);
}
let peak = 0; const iv = setInterval(() => { peak = Math.max(peak, renderer()); }, 250);
const body = () => page.locator("body").innerText();
async function waitFor(re, ms = 600000) { const t = Date.now(); while (Date.now() - t < ms) { const b = await body(); if (re.test(b)) return Date.now(); await page.waitForTimeout(250); } throw new Error("timeout " + re); }
await page.goto((process.env.BASE || "http://localhost:8931") + "/"); await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Load sample plan/ }).click(); await page.waitForTimeout(5000);
await page.getByRole("button", { name: /^Sheets$/ }).click(); await page.waitForTimeout(700);
await page.getByText("Open visual gallery").click(); await page.waitForTimeout(2000);
await page.locator("input[type=file]").first().setInputFiles(D + "/demo-image-only.pdf"); await page.waitForTimeout(8000);
// --- sheet 1, canvas, first ever read
await page.waitForTimeout(2000); const base1 = renderer(); peak = base1;
await page.getByRole("button", { name: /Read page text/i }).first().click();
await page.getByRole("button", { name: /^Download$/ }).waitFor({ timeout: 15000 });
const tD = Date.now(); await page.getByRole("button", { name: /^Download$/ }).click();
const tStart1 = await waitFor(/Reading tiles 0\//);
const tDone1 = await waitFor(/Read in [\d.]+ s · OCR/); const peak1 = peak; await shot("sheet1-done");
const label1 = (await body()).match(/Read in [\d.]+ s · OCR/)[0];
// --- sheet 2, gallery card, engine running
await page.getByRole("button", { name: /^Sheets$/ }).click(); await page.waitForTimeout(700);
await page.getByText("Open visual gallery").click(); await page.waitForTimeout(3000);
for (let i = 0; i < 4; i++) { await page.mouse.move(700, 500); await page.mouse.wheel(0, 600); await page.waitForTimeout(600); }
await page.waitForTimeout(2000); const base2 = renderer(); peak = base2;
const t2 = Date.now(); await page.getByRole("button", { name: /^Read page text/ }).last().click();
// sheet 2's own card: the lines right after its title
const card2 = async () => { const ls = (await body()).split("\n"); const i = ls.findIndex((l) => l.trim() === "demo-image-only · 2"); return i < 0 ? "" : ls.slice(i, i + 4).join(" | "); };
async function waitCard(re) { const t = Date.now(); while (Date.now() - t < 600000) { if (re.test(await card2())) return Date.now(); await page.waitForTimeout(250); } throw new Error("timeout card " + re); }
const tStart2 = await waitCard(/Reading tiles 0\//);
const tDone2 = await waitCard(/Read in [\d.]+ s · OCR/); const peak2 = peak; await shot("sheet2-done");
const labels = [await card2()];
clearInterval(iv);
const mb = (b) => Math.round(b / 1e6);
const r = { run: RUN, setupDownloadAndStartS: (tStart1 - tD) / 1000, sheet1ReadS: (tDone1 - tStart1) / 1000, sheet1Label: label1,
  sheet2StartS: (tStart2 - t2) / 1000, sheet2ReadS: (tDone2 - tStart2) / 1000, labels,
  sheet1: { baseMB: mb(base1), peakMB: mb(peak1), addedMB: mb(peak1 - base1) }, sheet2: { baseMB: mb(base2), peakMB: mb(peak2), addedMB: mb(peak2 - base2) } };
writeFileSync(`${D}/run-${RUN}.json`, JSON.stringify(r, null, 1)); console.log(JSON.stringify(r));
await ctx.close();
