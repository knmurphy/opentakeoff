// One-Click Area E2E — drives real Chromium against the dev server and
// SELF-VERIFIES the three doorway conditions in the fixture plan:
//   1. hover an enclosed room   → live preview reads "120 SF"
//   2. hover the cased opening  → preview reads "sealed a small opening"
//   3. hover the door-swing room→ preview reads 120 SF, "incl. door swing" (the
//                                  wedge is INCLUDED; the arc no longer bounds the fill)
//   4. hover open sheet space   → no preview at all
//   5. Enter                    → "Created 3 takeoffs" toast
// Screenshots + a video land in e2e/out/. Exit code 0 = all checks passed.
//
// Usage: node e2e/one-click.e2e.cjs   (expects the dev server on BASE_URL;
//        e2e/run.cjs orchestrates fixture + server + this script)
const path = require("path");

// playwright is a real devDependency now (it used to be resolved off a GLOBAL
// install, which meant `npm ci` on a clean machine produced a driver that could
// not even require its own browser library). Fail loudly with the fix instead.
let chromium;
try { ({ chromium } = require("playwright")); }
catch {
  console.error("cannot load playwright — run `npm ci` in web/ (and `npx playwright install chromium`)");
  process.exit(1);
}

const OUT = path.join(__dirname, "out");
const PDF = path.join(OUT, "plan.pdf");
const URL = process.env.BASE_URL || "http://127.0.0.1:5199/";
// Waits are condition-based, not wall-clock. QUIET is how long the live readout
// must hold still before it counts as final (it lands in two beats: geometry
// first, then the async room-name upgrade); the caps are only there so a hung
// app reports a FAIL with the text it actually showed rather than hanging.
const QUIET_MS = Number(process.env.E2E_QUIET_MS || 600);
const CAP_MS = Number(process.env.E2E_CAP_MS || 20000);
const LOAD_MS = Number(process.env.E2E_LOAD_MS || 60000);
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
  page.setDefaultTimeout(CAP_MS);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });
  const livePreview = async () => page.evaluate(() => {
    const t = document.querySelector('[data-oc="live-text"]');
    const p = document.querySelector('[data-oc="live-poly"]');
    const shown = (el) => !!el && el.style.display !== "none";
    return { text: shown(t) ? t.textContent : null, poly: shown(p) };
  });
  // The preview engine (ocLiveMove → requestAnimationFrame → ocLiveRun) does its
  // work in the frame after the last mousemove, so two frames is a real
  // happens-after barrier — no sleep needed to know it ran.
  const frames = (n = 2) => page.evaluate((k) => new Promise((res) => {
    const step = () => (--k <= 0 ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);
  // Hover, then wait for the readout to REACH `want` and hold still. Falling
  // through on the cap (instead of throwing) is deliberate: the checks below
  // still run and print the text the app actually settled on.
  const hoverAt = async (f, want) => {
    const bb = await page.locator("canvas").first().boundingBox();
    const x = bb.x + f[0] * bb.width, y = bb.y + f[1] * bb.height;
    await page.mouse.move(x - 40, y - 30, { steps: 4 });
    await page.mouse.move(x, y, { steps: 6 });
    await frames(2);
    const t0 = Date.now();
    let sig = null, since = Date.now();
    for (;;) {
      const lp = await livePreview();
      const cur = JSON.stringify(lp);
      if (cur !== sig) { sig = cur; since = Date.now(); }
      if (Date.now() - since >= QUIET_MS && want(lp)) return lp;
      if (Date.now() - t0 >= CAP_MS) return lp;
      await page.waitForTimeout(40);
    }
  };
  const shows = (lp) => lp.poly && !!lp.text;
  const hidden = (lp) => !lp.poly;
  // Commit the candidate, then wait for the preview to retract. That retraction
  // is what guarantees the NEXT hover reads fresh geometry rather than the
  // previous room's still-displayed readout.
  const commit = async () => {
    await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction(() => {
      const p = document.querySelector('[data-oc="live-poly"]');
      return !p || p.style.display === "none";
    });
  };

  await page.goto(URL, { timeout: LOAD_MS });
  await page.waitForSelector("text=No PDFs yet", { timeout: LOAD_MS });
  await page.setInputFiles('input[name="sheet-file"]', PDF);
  await page.waitForSelector("text=Set scale", { timeout: LOAD_MS });
  // "pdf.js has painted" as a condition rather than a guessed 2.5 s: the panel
  // canvas leaves its unsized 300×150 default and carries actual dark ink.
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas");
    if (!c || c.width <= 300 || c.height <= 150) return false;
    const t = document.createElement("canvas"); t.width = 60; t.height = 45;
    const g = t.getContext("2d"); g.drawImage(c, 0, 0, 60, 45);
    const d = g.getImageData(0, 0, 60, 45).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && d[i] < 200) return true;
    return false;
  }, null, { timeout: LOAD_MS });
  await page.click("text=Set scale");
  const planSays = page.locator("text=Plan says");
  // scale detection is async (it waits on the pdf.js text layer) — wait for the
  // offer instead of sleeping, but still ASSERT on it so a miss is a real FAIL.
  await planSays.first().waitFor({ timeout: CAP_MS }).catch(() => {});
  check(await planSays.count() > 0, "scale auto-detected from the title block");
  if (await planSays.count()) await planSays.first().click();
  else await page.click(`text=1/4" = 1'-0"`);
  await page.waitForFunction(() => !document.body.innerText.includes("Set scale first"));
  await shot("01-loaded-scaled");

  await page.keyboard.press("o");             // arm One-Click (default condition is active)
  await page.waitForFunction(() => document.body.innerText.includes("Click inside a room"));

  let lp = await hoverAt(ROOMS.officeA, shows);
  check(lp.poly && /120(\.0)? SF/.test(lp.text || ""), `enclosed room previews 120 SF (got "${lp.text}")`);
  check(/OFFICE 101/.test(lp.text || ""), `auto-naming reads the room tag (got "${lp.text}")`);
  check(!/%/.test(lp.text || ""), "verbatim vector trace shows no confidence deduction");
  await shot("02-hover-enclosed");
  await commit();

  lp = await hoverAt(ROOMS.confB, shows);
  check(lp.poly && /sealed a small opening/.test(lp.text || ""), `cased opening previews sealed (got "${lp.text}")`);
  check(/120(\.0)? SF/.test(lp.text || ""), `sealed room still reads 120 SF (got "${lp.text}")`);
  check(/· 9\d%/.test(lp.text || ""), `sealed trace surfaces its confidence (got "${lp.text}")`);
  await shot("03-hover-cased-sealed");
  await commit();

  lp = await hoverAt(ROOMS.storC, shows);
  check(lp.poly && /(119|120)(\.\d)? SF/.test(lp.text || ""), `door-swing room reads to the wall opening, swing wedge INCLUDED (got "${lp.text}")`);
  check(/incl\. door swing/.test(lp.text || ""), `readout flags the door-swing inclusion (got "${lp.text}")`);
  check(!/sealed a small opening/.test(lp.text || ""), "door-swing message wins over the raw seal note");
  check(/STOR 103/.test(lp.text || ""), `door-swing room auto-names too (got "${lp.text}")`);
  await shot("04-hover-doorswing");
  await commit();

  // commit() left the preview retracted, so a still-hidden readout two frames
  // after this hover means the engine ran on open space and refused — not that
  // we simply looked too early.
  lp = await hoverAt(ROOMS.outside, hidden);
  check(!lp.poly, "open sheet space shows no preview");
  await shot("05-hover-outside");

  await page.keyboard.press("Enter");
  const toast = page.locator("text=Created 3 takeoffs");
  await toast.waitFor({ timeout: CAP_MS }).catch(() => {});
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
