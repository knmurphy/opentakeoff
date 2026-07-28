// One-Click Area E2E — drives real Chromium against the dev server and
// SELF-VERIFIES the three doorway conditions in the fixture plan:
//   1. hover an enclosed room   → live preview reads "120 SF"
//   2. hover the cased opening  → preview reads "sealed a small opening"
//   3. hover the door-swing room→ preview ≈ 113 SF, NOT sealed (arc bounds it)
//   4. hover open sheet space   → no preview at all
//   5. Enter                    → "Created 3 takeoffs" toast
// then the Detect-rooms review gate on the same fixture:
//   6. Detect rooms             → 3 dashed proposals, and NOTHING committed
//   7. the readout states the no-room-tag ceiling even at 3-of-3
//   8. ✓ on one proposal        → exactly one new shape
//   9. ✕ on another             → no new shape (a rejection commits nothing)
//  10. Accept all               → the last one commits; ⌘Z undoes it
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
  check(/OFFICE 101/.test(lp.text || ""), `auto-naming reads the room tag (got "${lp.text}")`);
  check(!/%/.test(lp.text || ""), "verbatim vector trace shows no confidence deduction");
  await shot("02-hover-enclosed");
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);

  await hoverAt(ROOMS.confB);
  lp = await livePreview();
  check(lp.poly && /sealed a small opening/.test(lp.text || ""), `cased opening previews sealed (got "${lp.text}")`);
  check(/120(\.0)? SF/.test(lp.text || ""), `sealed room still reads 120 SF (got "${lp.text}")`);
  check(/· 9\d%/.test(lp.text || ""), `sealed trace surfaces its confidence (got "${lp.text}")`);
  await shot("03-hover-cased-sealed");
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);

  await hoverAt(ROOMS.storC);
  lp = await livePreview();
  check(lp.poly && /(119|120)(\.\d)? SF/.test(lp.text || ""), `door-swing room reads to the wall opening, swing wedge INCLUDED (got "${lp.text}")`);
  check(/incl\. door swing/.test(lp.text || ""), `readout flags the door-swing inclusion (got "${lp.text}")`);
  check(!/sealed a small opening/.test(lp.text || ""), "door-swing message wins over the raw seal note");
  check(/STOR 103/.test(lp.text || ""), `door-swing room auto-names too (got "${lp.text}")`);
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

  // ── Detect rooms — the batch pass and its review gate ────────────────────
  // The fixture's three rooms each carry a room-number tag (101/102/103), so a
  // clean pass proposes exactly three. The point of the checks below is not
  // the count: it is that the count is a PROPOSAL count, that the readout says
  // what the pass cannot reach even when it reached everything it could, and
  // that the takeoff only ever moves on an explicit accept.
  const shapeCount = () => page.locator("[data-shape-id]").count();
  const proposalCount = () => page.locator('[data-dt="proposal"]').count();
  const readout = () => page.evaluate(() => {
    const h = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Detect rooms" && d.style.textTransform === "uppercase");
    return h ? h.parentElement.textContent : "";
  });

  const before = await shapeCount();
  check(before === 3, `the 3 created takeoffs are on the sheet (got ${before})`);
  await page.click('[data-dt="run"]');
  await page.waitForFunction(() => !document.querySelector('[data-dt="cancel"]'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const proposed = await proposalCount();
  check(proposed === 3, `detection proposes the 3 tagged rooms (got ${proposed})`);
  check(await shapeCount() === before, "detection commits NOTHING on its own");
  const rd = await readout();
  check(/3 of 3 room tags produced a room/.test(rd), `readout states what was tried, not just what came back (got "${rd.slice(0, 200)}")`);
  check(/NOT detected/.test(rd) && /room-number tag/.test(rd),
    "readout carries the no-room-tag ceiling even at 3 of 3 — it must never read as a finished sheet");
  check(!/complete|finished|all rooms/i.test(rd), "readout never claims the sheet is done");
  await shot("07-detected");

  await page.locator('[data-dt="accept"]').first().click();
  await page.waitForTimeout(300);
  check(await shapeCount() === before + 1, `✓ commits exactly one takeoff (got ${await shapeCount()})`);
  check(await proposalCount() === 2, `the accepted proposal leaves the review set (got ${await proposalCount()})`);

  await page.locator('[data-dt="reject"]').first().click();
  await page.waitForTimeout(300);
  check(await shapeCount() === before + 1, "✕ commits nothing");
  check(await proposalCount() === 1, `the rejected proposal leaves the review set too (got ${await proposalCount()})`);
  await shot("08-reviewed");

  await page.click('[data-dt="accept-all"]');
  await page.waitForTimeout(300);
  check(await shapeCount() === before + 2, `Accept all commits the rest (got ${await shapeCount()})`);
  check(await proposalCount() === 0, "nothing is left to review");
  check(/NOT detected/.test(await readout()), "the ceiling stays on screen after accepting everything");

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check(await shapeCount() === before + 1, `undo removes the accepted batch in one step (got ${await shapeCount()})`);
  await shot("09-accepted-undone");

  // The chips are click targets only under the review tools (oneclick/select/
  // pan). Under a drawing tool a stray click on a ✓ must commit NOTHING — an
  // accidental commit nobody notices is worse than one they have to undo,
  // because it ends up in a bid. This is the regression that matters most.
  await page.click('[data-dt="discard"]');
  await page.waitForTimeout(200);
  await page.click('[data-dt="run"]');
  await page.waitForFunction(() => !document.querySelector('[data-dt="cancel"]'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const afterRerun = await shapeCount();
  check(await proposalCount() === 3, `a second pass re-proposes all 3 (got ${await proposalCount()})`);
  await page.keyboard.press("a");               // Area tool — drawing, not reviewing
  await page.waitForTimeout(250);
  await page.locator('[data-dt="accept"]').first().click({ force: true });   // force: the chip refuses pointer events, so this lands on the canvas underneath — exactly the stray click
  await page.waitForTimeout(400);
  check(await shapeCount() === afterRerun, `a ✓ click under the Area tool commits nothing (got ${await shapeCount()}, expected ${afterRerun})`);
  check(await proposalCount() === 3, `…and the proposal is still there to review (got ${await proposalCount()})`);
  await page.keyboard.press("Backspace");       // drop the stray trace point that click placed
  await page.keyboard.press("o");               // back to One-Click
  await page.waitForTimeout(250);
  await page.locator('[data-dt="accept"]').first().click();
  await page.waitForTimeout(400);
  check(await shapeCount() === afterRerun + 1, `…and the same chip commits once a review tool is armed (got ${await shapeCount()})`);
  await shot("10-chip-gating");

  // a whole set must be discardable without touching the takeoff
  const beforeEsc = await shapeCount();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(await proposalCount() === 0, "Esc discards the whole review set");
  check(await shapeCount() === beforeEsc, "discarding the set leaves the takeoff untouched");

  check(pageErrors.length === 0, `no page errors (got ${JSON.stringify(pageErrors)})`);

  await ctx.close();                          // flushes the video
  await browser.close();
  const video = require("fs").readdirSync(OUT).find((f) => f.endsWith(".webm"));
  if (video) require("fs").renameSync(path.join(OUT, video), path.join(OUT, "session.webm"));
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("DRIVER FAILED:", e); process.exit(1); });
