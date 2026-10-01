// PR evidence on the final build: one fresh profile, the full flow, a screenshot per step.
import { chromium } from "playwright";
import { rmSync, writeFileSync } from "node:fs";
const D = process.cwd(), PROFILE = D + "/profile-ev", BASE = process.env.BASE || "http://localhost:8931";
rmSync(PROFILE, { recursive: true, force: true });
const EXE = process.env.CHROMIUM || undefined; // Chrome/Chromium binary; unset = Playwright's bundled one
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, executablePath: EXE, viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = ctx.pages()[0] || await ctx.newPage();
const out = {}; const errs = []; page.on("console", (m) => { if (m.type() === "error" && !/cloudflareinsights|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
const reqs = []; page.on("request", (r) => { if (/models\/ocr|ort-wasm|\.onnx/.test(r.url())) reqs.push(r.url().replace(BASE, "")); });
const shot = (n) => page.screenshot({ path: `${D}/ev/${n}.png` });
const body = () => page.locator("body").innerText();
const gallery = async () => { if (!(await page.getByPlaceholder("Search sheet text…").count())) { await page.getByRole("button", { name: /^Sheets$/ }).click(); await page.waitForTimeout(700); await page.getByText("Open visual gallery").click(); await page.waitForTimeout(3000); } };
await page.goto(BASE + "/"); await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Load sample plan/ }).click(); await page.waitForTimeout(5000);
await gallery();
await page.getByPlaceholder("Search sheet text…").fill("corridor"); await page.waitForTimeout(3000); await shot("01-search-text-layer");
await page.getByPlaceholder("Search sheet text…").fill(""); await page.waitForTimeout(500);
await page.locator("input[type=file]").first().setInputFiles(D + "/demo-image-only.pdf"); await page.waitForTimeout(9000);
await shot("02-read-control"); out.reqsBeforeRead = reqs.length;
await page.getByRole("button", { name: /Read page text/i }).first().click(); await page.waitForTimeout(1500);
await shot("03-notice"); out.reqsAtNotice = [...reqs];
await page.getByRole("button", { name: /^Download$/ }).click();
for (let i = 0; i < 200; i++) { await page.waitForTimeout(500); if (/Reading tiles [2-9]/.test(await body())) break; }
await shot("04-progress");
for (let i = 0; i < 400; i++) { await page.waitForTimeout(500); if (/Read in [\d.]+ s · OCR/.test(await body())) break; }
await shot("05-read-done");
// copy a box on the read scan
await page.getByRole("button", { name: /Copy text/i }).first().click(); await page.waitForTimeout(600);
await page.mouse.click(1068, 378); await page.waitForTimeout(300); await page.mouse.click(1200, 470); await page.waitForTimeout(3000);
await shot("06-copy-ocr"); out.clipOcr = (await page.evaluate(() => navigator.clipboard.readText().catch((e) => "ERR " + e.message))).slice(0, 300);
await gallery();
await page.getByPlaceholder("Search sheet text…").fill("corridor"); await page.waitForTimeout(3000);
await page.getByText("OCR", { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(500);
await shot("07-search-ocr-hit"); out.match = (await body()).match(/\d+ of \d+ sheets? match/i)?.[0];
await page.getByPlaceholder("Search sheet text…").fill(""); await page.waitForTimeout(500);
for (let i = 0; i < 4; i++) { await page.mouse.move(700, 500); await page.mouse.wheel(0, 500); await page.waitForTimeout(600); }
await shot("08-gallery-cards");
// cancel a read of sheet 2 → Stopping…
const btns = await page.getByRole("button", { name: /^Read page text$/ }).all();
let card = null; for (const b of btns) { const bb = await b.boundingBox(); if (bb && bb.y < 600) { card = b; } }
if (card) { await card.click(); for (let i = 0; i < 120; i++) { await page.waitForTimeout(250); if (/Reading tiles [1-9]/.test(await body())) break; }
  await page.getByRole("button", { name: /^Cancel$/ }).last().click(); await page.waitForTimeout(300); await shot("09-stopping"); }
writeFileSync(D + "/ev/capture.json", JSON.stringify({ ...out, reqsTotal: reqs, consoleErrors: errs }, null, 1));
console.log(JSON.stringify({ ...out, consoleErrors: errs.length }));
await ctx.close();
