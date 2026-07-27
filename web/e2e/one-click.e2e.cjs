// One-Click Area E2E — drives real Chromium against the dev server and
// SELF-VERIFIES the three doorway conditions in the fixture plan:
//   1. hover an enclosed room   → live preview reads "120 SF"
//   2. hover the cased opening  → preview reads "sealed a small opening"
//   3. hover the door-swing room→ preview ≈ 113 SF, NOT sealed (arc bounds it)
//   4. hover open sheet space   → no preview at all
//   5. Enter                    → "Created 3 takeoffs" toast
// Screenshots + a video land in e2e/out/. Exit code 0 = all checks passed.
//
// Usage: node e2e/one-click.e2e.cjs   (expects the dev server on BASE_URL;
//        e2e/run.cjs orchestrates fixture + server + this script)
const path = require("path");

function loadPlaywright() {
  try { return require("playwright"); } catch { /* not a local dep */ }
  const { execSync } = require("child_process");
  const g = execSync("npm root -g").toString().trim();
  return require(path.join(g, "playwright"));
}
const { chromium } = loadPlaywright();

const OUT = path.join(__dirname, "out");
const PDF = path.join(OUT, "plan.pdf");
const URL = process.env.BASE_URL || "http://localhost:5199/";
// fixture geometry (PDF pt, y-up, 792×612 page) → canvas fractions (y flips)
const frac = (px, py) => [px / 792, (612 - py) / 612];
const ROOMS = {
  officeA: frac(168, 390),      // enclosed
  confB: frac(384, 390),        // 3' cased opening → seals
  storC: frac(600, 420),        // door swing drawn → bounds without sealing (aim above the arc)
  outside: frac(384, 200),      // open sheet → no preview
};

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 1000 },
    recordVideo: { dir: OUT, size: { width: 1680, height: 1000 } },
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });
  const livePreview = async () => page.evaluate(() => {
    const t = document.querySelector('[data-oc="live-text"]');
    const p = document.querySelector('[data-oc="live-poly"]');
    const shown = (el) => !!el && el.style.display !== "none";
    return { text: shown(t) ? t.textContent : null, poly: shown(p) };
  });
  const hoverAt = async (f) => {
    const bb = await page.locator("canvas").first().boundingBox();
    const x = bb.x + f[0] * bb.width, y = bb.y + f[1] * bb.height;
    await page.mouse.move(x - 40, y - 30, { steps: 4 });
    await page.mouse.move(x, y, { steps: 6 });
    await page.waitForTimeout(900);           // rAF + flood + (first hover) mask/DT build
  };

  await page.goto(URL);
  await page.waitForSelector("text=No PDFs yet", { timeout: 30000 });
  await page.setInputFiles('input[name="sheet-file"]', PDF);
  await page.waitForSelector("text=Set scale", { timeout: 30000 });
  await page.waitForTimeout(2500);            // pdf.js paint + text layer
  await page.click("text=Set scale");
  await page.waitForTimeout(400);
  const planSays = page.locator("text=Plan says");
  check(await planSays.count() > 0, "scale auto-detected from the title block");
  if (await planSays.count()) await planSays.first().click();
  else await page.click(`text=1/4" = 1'-0"`);
  await page.waitForTimeout(400);
  await shot("01-loaded-scaled");

  await page.keyboard.press("o");             // arm One-Click (default condition is active)
  await page.waitForTimeout(200);

  await hoverAt(ROOMS.officeA);
  let lp = await livePreview();
  check(lp.poly && /120(\.0)? SF/.test(lp.text || ""), `enclosed room previews 120 SF (got "${lp.text}")`);
  await shot("02-hover-enclosed");
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);

  await hoverAt(ROOMS.confB);
  lp = await livePreview();
  check(lp.poly && /sealed a small opening/.test(lp.text || ""), `cased opening previews sealed (got "${lp.text}")`);
  check(/120(\.0)? SF/.test(lp.text || ""), `sealed room still reads 120 SF (got "${lp.text}")`);
  await shot("03-hover-cased-sealed");
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);

  await hoverAt(ROOMS.storC);
  lp = await livePreview();
  check(lp.poly && /11[23](\.\d)? SF/.test(lp.text || ""), `door-swing room previews ~113 SF, wedge excluded (got "${lp.text}")`);
  check(!/sealed/.test(lp.text || ""), "door-swing room does NOT trigger sealing");
  await shot("04-hover-doorswing");
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);

  await hoverAt(ROOMS.outside);
  lp = await livePreview();
  check(!lp.poly, "open sheet space shows no preview");
  await shot("05-hover-outside");

  await page.keyboard.press("Enter");
  const toast = page.locator("text=Created 3 takeoffs");
  await toast.waitFor({ timeout: 5000 }).catch(() => {});
  check(await toast.count() > 0, "Enter creates all 3 takeoffs");
  await shot("06-created");

  check(pageErrors.length === 0, `no page errors (got ${JSON.stringify(pageErrors)})`);

  await ctx.close();                          // flushes the video
  await browser.close();
  const video = require("fs").readdirSync(OUT).find((f) => f.endsWith(".webm"));
  if (video) require("fs").renameSync(path.join(OUT, video), path.join(OUT, "session.webm"));
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("DRIVER FAILED:", e); process.exit(1); });
