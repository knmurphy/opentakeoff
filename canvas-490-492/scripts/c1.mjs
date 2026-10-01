import { chromium } from "playwright";
const tag = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`http://localhost:${process.env.PORT}/`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Load sample plan" }).click();
await p.waitForTimeout(6000);
await p.screenshot({ path: `${tag}-1-demo.png` });
const inputs = await p.$$("input[type=file]");
for (const i of inputs) { const acc = await i.getAttribute("accept"); if (!acc || /pdf/.test(acc)) { await i.setInputFiles(process.env.S + "/image-only.pdf"); break; } }
await p.waitForTimeout(6000);
await p.screenshot({ path: `${tag}-2-imageonly.png` });
const body = await p.evaluate(() => document.body.innerText);
console.log(tag, "AF101 occurrences:", (body.match(/AF101/g) || []).length, "image-only mentions:", (body.match(/image-only/g) || []).length);
console.log("errs", errs);
await b.close();
