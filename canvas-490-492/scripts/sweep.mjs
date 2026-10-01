import { chromium } from "playwright";
const [tag, port] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Load sample plan" }).click();
await p.waitForTimeout(7000);
await p.getByRole("button", { name: "All controls" }).first().click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: "Snap", exact: true }).first().click();
await p.waitForTimeout(500);
const pts = []; for (let x = 600; x < 960; x += 6) for (let y = 300; y < 480; y += 9) pts.push([x, y]);
const out = {};
async function sweep(label) {
  let star = 0, chip = 0, last = null;
  for (const [x, y] of pts) {
    await p.mouse.move(x, y);
    const st = await p.evaluate(() => ({
      star: [...document.querySelectorAll('path[fill="#1f6b4a"]')].some((e) => e.style.display === "block"),
      chip: document.body.innerText.split("\n").some((l) => l.trim() === "snap"),
    }));
    if (st.star) { star++; last = [x, y]; }
    if (st.chip) chip++;
  }
  const at = last || [951, 400];
  await p.mouse.move(...at);
  await p.screenshot({ path: `${tag}-${label}.png`, clip: { x: at[0] - 200, y: at[1] - 120, width: 400, height: 240 } });
  out[label] = { positions: pts.length, star, chip };
}
async function arm(name) {
  await p.keyboard.press("Escape"); await p.keyboard.press("v"); await p.waitForTimeout(200);
  if (name === "area") { await p.keyboard.press("a"); }
  else if (name === "pin") { await p.getByRole("button", { name: "Pin" }).first().click(); }
  else if (name === "schedule") {
    if (!(await p.getByTitle(/^More — guide/).count())) { await p.getByRole("button", { name: "All controls" }).first().click(); await p.waitForTimeout(400); }
    await p.getByTitle(/^More — guide/).first().click(); await p.waitForTimeout(400);
    await p.screenshot({ path: `${tag}-menu.png` });
    await p.getByText("Import from schedule").first().click();
  }
  await p.waitForTimeout(300);
  await p.mouse.move(700, 600); await p.waitForTimeout(150);
  await p.screenshot({ path: `${tag}-${name}-armed.png` });
  const toolName = await p.evaluate(() => (document.body.innerText.match(/\n(\w+)\s*\n?\s*x \d+ · y \d+ px/) || [])[1] || "");
  console.error(name, "footer tool names:", JSON.stringify(toolName));
  const hint = await p.evaluate(() => document.body.innerText.split("\n").find((l) => /click two corners|drag around|first corner|Import from schedule —/i.test(l)) || "");
  return { hint, toolName };
}
for (const t of ["area", "pin", "schedule"]) { out[t + "_hint"] = await arm(t); await sweep(t); }
console.log(JSON.stringify({ tag, ...out, errs }, null, 1));
await b.close();
