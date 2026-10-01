// The state docs/img/verify-import-schedule-dialog.png shows: classic layout, light chrome,
// 1600 × 1000, the bundled demo's material schedule (sheet AF600), dialog scrolled to its end,
// fresh profile (the sample's starter conditions only). Writes the full page and the dialog crop.
//
//   node docs-image.mjs --url http://localhost:5287 --out <dir> --tag head
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const URL_ = arg("url", "http://localhost:5287"), OUT = resolve(arg("out", "shots-docs")), TAG = arg("tag", "head");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "light", deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  localStorage.setItem("ot.workspace-layout.v1", JSON.stringify({ version: 1, enabled: false, layout: { look: "graphite" }, saved: [] }));
  localStorage.setItem("opentakeoff_theme", "light");
});
const page = await ctx.newPage();
const vis = (l) => l.filter({ visible: true }).first();
const settle = async () => { await page.waitForTimeout(150); await page.getByText(/^Rendering sheet/).first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {}); };
await page.goto(URL_);
await vis(page.getByRole("button", { name: /Load sample plan/ })).click();
await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some((c) => c.width > 1000));
await settle();
await vis(page.locator('button[title="Next sheet"]')).click(); await page.waitForTimeout(600); await settle();
await vis(page.locator("button", { hasText: "⋯" })).click();
await vis(page.getByText("Import from schedule", { exact: true })).click();
await vis(page.locator('button[title="Fit sheet to view"]')).dispatchEvent("click"); await page.waitForTimeout(400);
const c = await page.evaluate(() => { const cv = [...document.querySelectorAll("canvas")].filter((x) => x.width > 300).sort((p, q) => q.width * q.height - p.width * p.height)[0]; const r = cv.getBoundingClientRect(); return { x: r.x, y: r.y, s: r.width / cv.width }; });
await page.mouse.click(c.x + 2950 * c.s, c.y + 250 * c.s); await page.waitForTimeout(150); await page.mouse.click(c.x + 4720 * c.s, c.y + 1900 * c.s);
const dlg = page.getByRole("dialog"); await dlg.waitFor();
await dlg.locator(':scope > div:has(button[title="Click to fix the code"])').first().evaluate((e) => { e.scrollTop = e.scrollHeight; });
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, `docs-dialog-page--${TAG}.png`) });
await dlg.screenshot({ path: join(OUT, `docs-dialog-crop--${TAG}.png`) });
const info = await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); return { title: d.querySelector("span").innerText, create: [...d.querySelectorAll("button")].map((b) => b.innerText).at(-1), lastRows: [...d.querySelectorAll('button[title="Click to fix the code"]')].slice(-12).map((b) => b.closest("label").parentElement.innerText.replace(/\s+/g, " ")) }; });
console.log(JSON.stringify(info, null, 1));
await browser.close();
