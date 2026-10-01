// #483 PR A — screenshots + DOM assertions from a FRESH browser profile.
//
//   npm install                        # playwright 1.63.0, pinned in package.json / package-lock.json
//   npx playwright install chromium    # its bundled Chromium (chromium-headless-shell 1243)
//   (cd <checkout>/web && npx vite --port 5287 --strictPort)    # the app under test, in another shell
//   node run.mjs --url http://localhost:5287 --repo <checkout> [--looks all|<look>,…] [--out shots] [--mode pr|base]
//
// Each look runs in its own new browser context (no stored data). The look is
// written to localStorage before the app loads (the same keys the app's own
// controls write): `ot.workspace-layout.v1` (workspace layout on/off, surface)
// and `opentakeoff_theme` (chrome light/dark). Then, through the UI only:
//   1. Load sample plan (the bundled demo).
//   2. Open → mcp/test/fixtures/reader483-set.pdf through the file chooser (A-601, A-602, A-603).
//   3. Seed the in-use code: Import from schedule around A-601's table, Deselect all,
//      tick TS-1 only, Create 1 condition.
//   4. The scenes (see SCENES below), each a screenshot plus DOM assertions.
// Every assertion prints PASS/FAIL; the run ends with "N/M passed" and exits 1 on any FAIL.
//
// --mode base runs only the demo scenes (01 and 09) — for measuring the base
// commit's dialog (no NOT USED, banner or fixture there).
//
// Public data only: the bundled demo and the tracked synthetic fixture.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const URL_ = arg("url", "http://localhost:5287");
const REPO = resolve(arg("repo", process.cwd()));
const OUT = resolve(arg("out", "shots"));
const MODE = arg("mode", "pr");
const FIXTURE = join(REPO, "mcp/test/fixtures/reader483-set.pdf");
const GOLDEN = join(REPO, "mcp/test/fixtures/reader-483/demo-p2-table.json");
mkdirSync(OUT, { recursive: true });

// ── looks: workspace layout (3 surfaces) × chrome theme, and the classic layout × chrome theme
const LOOKS = {
  "graphite-light": { enabled: true, look: "graphite", theme: "light" }, // the app's default on a light-OS machine
  "graphite-dark": { enabled: true, look: "graphite", theme: "dark" },
  "light-light": { enabled: true, look: "light", theme: "light" },
  "light-dark": { enabled: true, look: "light", theme: "dark" },
  "hud-light": { enabled: true, look: "hud", theme: "light" },
  "hud-dark": { enabled: true, look: "hud", theme: "dark" },
  "classic-light": { enabled: false, look: "graphite", theme: "light" },
  "classic-dark": { enabled: false, look: "graphite", theme: "dark" },
};
const lookArg = arg("looks", "all");
const looks = lookArg === "all" ? Object.keys(LOOKS) : lookArg.split(",");
for (const l of looks) if (!LOOKS[l]) throw new Error(`unknown look ${l}; one of ${Object.keys(LOOKS).join(", ")}`);

// ── assertions
let pass = 0, fail = 0;
const results = [];
function check(look, scene, name, ok, detail) {
  const line = `${ok ? "PASS" : "FAIL"} [${look}] ${scene}: ${name}${ok ? "" : `  — got ${JSON.stringify(detail)}`}`;
  ok ? pass++ : fail++;
  results.push(line);
  console.log(line);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── expected text (from docs/USER_GUIDE.md "Import from schedule", not read from the app's source)
const RULE = "A four- or five-letter code with no number is read only when the header or a read row is above it, it fills two or more other columns, and a row with a numbered code, like CPT-1, comes after it";
const BANNER_P1 = `1 code wasn't read: SEAL. ${RULE} — if it's a finish, add it as a condition yourself.`;
const BANNER_P2 = `3 codes weren't read: EPOX, CONC, SEAL. ${RULE} — if they're finishes, add them as conditions yourself.`;
const P1_CODES = ["CPT-1", "CPT-2", "CPT-3SAT", "CPT-3EGG", "EPOX", "LVT-1", "VCT-1", "FTB-01", "FTB-02", "RB-1", "P-1", "P-2", "CG-1", "TS-1"];
const DEMO_CODES = JSON.parse(readFileSync(GOLDEN, "utf8")).readScheduleSpans.rows.map((r) => r.finish_tag).sort();

// ── fixture / demo boxes, in page px at the app's render scale (the MCP test's boxes)
const BOX = {
  demo: { x0: 2950, y0: 250, x1: 4720, y1: 1900 },
  a601: { x0: 80, y0: 60, x1: 1150, y1: 940 },
  a602: { x0: 80, y0: 60, x1: 1150, y1: 330 },
  a603: { x0: 80, y0: 60, x1: 1150, y1: 370 },
};

// ── in-page readers (run with page.evaluate)
function dialogState() {
  const d = document.querySelector("[role=dialog]"); if (!d) return null;
  const groups = [...d.querySelectorAll("label > input[type=checkbox]")].filter((e) => !e.closest("label").querySelector('button[title="Click to fix the code"]'))
    .map((e) => ({ label: e.parentElement.innerText.replace(/\s+/g, " ").trim(), state: e.dataset.state ?? null, checked: e.checked, indeterminate: e.indeterminate }));
  const rows = [...d.querySelectorAll('button[title="Click to fix the code"], label input[type=text], label input:not([type])')].map((b) => {
    const row = b.closest("label").parentElement; const cb = row.querySelector("input[type=checkbox]");
    const ids = (cb.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
    const group = (() => { let g = row.parentElement; return g.querySelector(":scope > label")?.innerText.replace(/\s+/g, " ").trim(); })();
    return { code: b.innerText || b.value, group, checked: cb.checked, disabled: cb.disabled, text: row.innerText.replace(/\s+/g, " ").trim(),
      describedby: cb.getAttribute("aria-describedby"), described: ids.map((i) => document.getElementById(i)?.textContent ?? null),
      flag: [...row.querySelectorAll("label > span")].map((s) => s.textContent.trim()).find((t) => /^(in use|duplicate|needs a code)$/.test(t)) ?? null };
  });
  const note = d.querySelector("[role=note]");
  const ae = document.activeElement;
  return { theme: document.documentElement.dataset.theme, look: document.querySelector(".app-shell")?.dataset.workspaceLook ?? "classic",
    title: document.getElementById(d.getAttribute("aria-labelledby"))?.innerText ?? null, describedby: d.getAttribute("aria-describedby"),
    banner: note?.innerText ?? null, bannerId: note?.id ?? null,
    buttons: [...d.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    active: { text: ae?.innerText ?? null, inDialog: !!ae && d.contains(ae), tag: ae?.tagName },
    groups, rows };
}
// WCAG 2.x contrast from computed styles: colour → sRGB via a 1×1 canvas, opacity multiplied up
// the ancestors, the colour blended over the first opaque ancestor background.
function contrast() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.99) return c; } return [255, 255, 255, 1]; };
  const opOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const m = (el, prop) => { if (!el) return null; const fg = rgba(getComputedStyle(el)[prop]); const bg = bgOf(el); const a = fg[3] * opOf(el); const mix = [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))); return { fg: getComputedStyle(el)[prop], opacity: +opOf(el).toFixed(3), bg: `rgb(${bg.slice(0, 3).join(",")})`, rendered: `rgb(${mix.join(",")})`, ratio: +ratio(mix, bg).toFixed(2) }; };
  const d = document.querySelector("[role=dialog]");
  const nu = d.querySelector('[id$="-notused"]');
  const spans = [...d.querySelectorAll("label > span")];
  const dup = spans.find((s) => s.textContent.trim() === "duplicate");
  const codeBtns = [...d.querySelectorAll('button[title="Click to fix the code"]')];
  const unlocked = codeBtns.find((b) => !b.closest("label").querySelector("input[type=checkbox]").disabled);
  return { theme: document.documentElement.dataset.theme, look: document.querySelector(".app-shell")?.dataset.workspaceLook ?? "classic",
    banner: m(d.querySelector("[role=note]"), "color"), notUsedText: m(nu, "color"), notUsedBorder: m(nu, "borderLeftColor"),
    duplicate: m(dup, "color"), fromDescription: m(d.querySelector('span[title^="Category guessed"]'), "color"),
    rowDescription: m(unlocked?.nextElementSibling, "color") };
}

// ── UI helpers
async function main() {
  const browser = await chromium.launch();
  const contrastByLook = {};
  for (const lookName of looks) {
    const L = LOOKS[lookName];
    const narrowLater = [];
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 983 }, colorScheme: L.theme, deviceScaleFactor: 1 });
    await ctx.addInitScript((L) => {
      try {
        localStorage.setItem("ot.workspace-layout.v1", JSON.stringify({ version: 1, enabled: L.enabled, layout: { look: L.look }, saved: [] }));
        localStorage.setItem("opentakeoff_theme", L.theme);
      } catch { /* storage blocked: the run's look check fails loudly below */ }
    }, L);
    const page = await ctx.newPage();
    const shot = async (name, el) => { const p = join(OUT, `${name}--${lookName}.png`); await (el ?? page).screenshot({ path: p }); return p; };
    const vis = (loc) => loc.filter({ visible: true }).first();
    const dialog = () => page.getByRole("dialog");

    await page.goto(URL_);
    await vis(page.getByRole("button", { name: /Load sample plan/ })).click();
    await page.locator("canvas").first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some((c) => c.width > 1000));
    // the sheet renders behind a "Rendering sheet…" overlay that takes the pointer until it's done
    const settle = async () => { await page.waitForTimeout(150); await page.getByText(/^Rendering sheet/).first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {}); };
    await settle();
    const seen = await page.evaluate(() => ({ look: document.querySelector(".app-shell")?.dataset.workspaceLook ?? "classic", theme: document.documentElement.dataset.theme }));
    check(lookName, "setup", "the look applied (layout surface, chrome theme)", seen.look === (L.enabled ? L.look : "classic") && seen.theme === L.theme, seen);

    const showControls = async () => { const b = page.getByRole("button", { name: "All controls" }); if (await b.isVisible().catch(() => false)) { await b.click(); await page.getByRole("button", { name: "Close controls" }).waitFor(); } };
    const hideControls = async () => { const b = page.getByRole("button", { name: "Close controls" }); if (await b.isVisible().catch(() => false)) { await b.click(); await page.getByRole("button", { name: "All controls" }).waitFor(); } };
    const sheetLabel = async () => (await vis(page.locator('button[title^="Sheet — the sheets"]')).innerText()).replace(/\s+/g, " ");
    // (dispatched: in the classic layout the quantity readout overlaps the fit button)
    const fit = async () => { await vis(page.locator('button[title="Fit sheet to view"]')).dispatchEvent("click"); await page.waitForTimeout(400); };
    // Click two corners of a page-px box on the sheet canvas (the canvas is page px at the app's render scale).
    const drawBox = async (b) => {
      const c = await page.evaluate(() => { const cv = [...document.querySelectorAll("canvas")].filter((x) => x.width > 300).sort((p, q) => q.width * q.height - p.width * p.height)[0]; const r = cv.getBoundingClientRect(); return { x: r.x, y: r.y, s: r.width / cv.width, w: cv.width, h: cv.height }; });
      const at = (x, y) => [c.x + x * c.s, c.y + y * c.s];
      const [ax, ay] = at(b.x0, b.y0), [bx, by] = at(b.x1, b.y1);
      await page.mouse.click(ax, ay); await page.waitForTimeout(150); await page.mouse.click(bx, by);
      return { canvas: c, from: [ax, ay].map(Math.round), to: [bx, by].map(Math.round) };
    };
    // ⋯ → Import from schedule, then (workspace layout) close the controls strip so one chrome shows, then the box.
    const importFrom = async (b) => {
      await showControls();
      await vis(page.locator("button", { hasText: "⋯" })).click();
      await vis(page.getByText("Import from schedule", { exact: true })).click();
      if (L.enabled) await hideControls();
      await fit();
      const where = await drawBox(b);
      await dialog().waitFor({ timeout: 15000 }).catch(async () => { const f = await shot("_FAILED-no-dialog"); throw new Error(`[${lookName}] no dialog after box ${JSON.stringify(where)} — see ${f}`); });
      await page.waitForTimeout(300);
      return page.evaluate(dialogState);
    };
    const listBox = () => dialog().locator(':scope > div:has(button[title="Click to fix the code"])').first();
    const scrollList = async (to) => { await listBox().evaluate((e, w) => { e.scrollTop = w === "top" ? 0 : e.scrollHeight; }, to); await page.waitForTimeout(150); };
    const closeDialog = async () => { await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" }); };
    const createCount = (s) => Number((s.buttons.find((t) => /^create \d+ condition/i.test(t)) || "").match(/\d+/)?.[0] ?? NaN);
    const gotoPage = async (n) => {
      await showControls();
      for (let i = 0; i < 6 && !(await sheetLabel()).includes(`${n}/`); i++) {
        const cur = Number((await sheetLabel()).match(/(\d+)\/\d+/)?.[1]);
        await vis(page.locator(`button[title="${cur > n ? "Previous" : "Next"} sheet"]`)).click(); await page.waitForTimeout(600); await settle();
      }
      return sheetLabel();
    };

    if (MODE === "pr") {
      // 2. Open the fixture through the app's Open button (file chooser)
      const [fc] = await Promise.all([page.waitForEvent("filechooser"), vis(page.getByRole("button", { name: /^\+?\s*Open$/ })).click()]);
      await fc.setFiles(FIXTURE);
      await page.waitForFunction(() => /A-60\d|reader483/.test(document.body.innerText), null, { timeout: 20000 });
      await settle();
      const p1label = await gotoPage(1);
      check(lookName, "setup", "fixture open on its sheet 1 (A-601)", /1\/3/.test(p1label), p1label);
      await shot("_a601-sheet");

      // 3. Seed TS-1 as a condition through the dialog
      let s = await importFrom(BOX.a601);
      await vis(dialog().getByRole("button", { name: "Deselect all" })).click();
      const ts1 = dialog().locator('button[title="Click to fix the code"]', { hasText: /^TS-1$/ }).locator("xpath=ancestor::label").locator("input[type=checkbox]");
      await ts1.scrollIntoViewIfNeeded(); await ts1.check();
      s = await page.evaluate(dialogState);
      check(lookName, "setup", "seed: only TS-1 ticked → Create 1 condition", createCount(s) === 1 && s.rows.filter((r) => r.checked).map((r) => r.code).join() === "TS-1", { create: createCount(s), ticked: s.rows.filter((r) => r.checked).map((r) => r.code) });
      await dialog().getByRole("button", { name: /^Create 1 condition$/i }).click();
      await dialog().waitFor({ state: "detached" });
      // the condition list differs by layout (a <select> in the workspace chrome, a panel in classic)
      const conds = await page.evaluate(() => [...document.querySelectorAll("option, button, span, div")].filter((e) => !e.closest("[role=dialog]") && e.childElementCount === 0 && e.textContent.trim() === "TS-1").length);
      check(lookName, "setup", "TS-1 is now a condition (shown outside the dialog)", conds > 0, conds);

      // 02 — A-601: banner, NOT USED label, Floor group dash
      s = await importFrom(BOX.a601);
      await scrollList("top");
      await shot("02-p1-banner-notused-mixed", dialog());
      check(lookName, "02", "banner text exact (1 code: SEAL)", s.banner === BANNER_P1, s.banner);
      check(lookName, "02", "dialog aria-describedby = banner id", !!s.bannerId && s.describedby === s.bannerId, [s.describedby, s.bannerId]);
      check(lookName, "02", "title: 14 finishes found", s.title === "Import from schedule — 14 finishes found", s.title);
      check(lookName, "02", "the 14 codes, as the MCP test reads them", eq([...s.rows.map((r) => r.code)].sort(), [...P1_CODES].sort()), s.rows.map((r) => r.code));
      const floor = s.groups.find((g) => /^FLOOR/i.test(g.label));
      check(lookName, "02", "Floor group: dash (data-state some, unchecked, indeterminate)", floor?.state === "some" && floor.checked === false && floor.indeterminate === true, floor);
      check(lookName, "02", "no other group is indeterminate", s.groups.filter((g) => g !== floor).every((g) => !g.indeterminate), s.groups);
      const cpt2 = s.rows.find((r) => r.code === "CPT-2");
      check(lookName, "02", "CPT-2 NOT USED: unticked, pickable, described by its NOT USED label", cpt2 && !cpt2.checked && !cpt2.disabled && /-notused$/.test(cpt2.describedby || "") && /^NOT USED/.test(cpt2.described[0] || ""), cpt2);
      check(lookName, "02", "CPT-2 hidden note: \"The schedule marks this row not used. Select it to create a condition anyway.\"", (cpt2?.described[0] || "").endsWith(" The schedule marks this row not used. Select it to create a condition anyway."), cpt2?.described);
      contrastByLook[lookName] = { p1: await page.evaluate(contrast) };

      // 03 — bottom of the list: TS-1 in use, from description, NOT USED
      await scrollList("bottom");
      await shot("03-p1-twolabel-inuse", dialog());
      const t = s.rows.find((r) => r.code === "TS-1");
      check(lookName, "03", "TS-1 locked (in use)", t?.disabled === true && t.flag === "in use", t);
      check(lookName, "03", "TS-1 aria-describedby = guess + notused ids (in-use flag not in it)", /-guess \S+-notused$/.test(t?.describedby || ""), t?.describedby);
      check(lookName, "03", "TS-1 note without \"Select it…\" (not pickable)", (t?.described[1] || "").endsWith("NOT USED The schedule marks this row not used.") && !/Select it/.test(t?.described[1] || ""), t?.described);

      // 04 — click the Floor dash
      await scrollList("top");
      const before = createCount(s);
      await dialog().locator("label > input[type=checkbox]").first().click();
      s = await page.evaluate(dialogState);
      const f2 = s.groups.find((g) => /^FLOOR/i.test(g.label));
      await shot("04-p1-floor-dash-clicked", dialog());
      check(lookName, "04", "Floor → all, checked, not indeterminate", f2?.state === "all" && f2.checked && !f2.indeterminate, f2);
      check(lookName, "04", "CPT-2 (NOT USED) now ticked", s.rows.find((r) => r.code === "CPT-2")?.checked === true, s.rows.find((r) => r.code === "CPT-2"));
      check(lookName, "04", "Create count +1 (CPT-2)", createCount(s) === before + 1, [before, createCount(s)]);
      await closeDialog();

      // 05 — rename P-2 to P-1: the renamed row shows duplicate
      s = await importFrom(BOX.a601);
      const before5 = createCount(s);
      await dialog().locator('button[title="Click to fix the code"]', { hasText: /^P-2$/ }).click();
      await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("P-1"); await page.keyboard.press("Enter");
      await page.waitForTimeout(250);
      s = await page.evaluate(dialogState);
      const p1s = s.rows.filter((r) => r.code === "P-1");
      await dialog().locator('button[title="Click to fix the code"]', { hasText: /^P-1$/ }).last().scrollIntoViewIfNeeded();
      await shot("05-p1-duplicate-after-rename", dialog());
      check(lookName, "05", "two rows read P-1", p1s.length === 2, s.rows.map((r) => r.code));
      check(lookName, "05", "the first (SAT — PAINT) keeps P-1: ticked, pickable", p1s[0]?.checked && !p1s[0].disabled && /SAT — PAINT/.test(p1s[0].text), p1s[0]);
      check(lookName, "05", "the renamed row: locked, flag duplicate", p1s[1]?.disabled && p1s[1].flag === "duplicate", p1s[1]);
      check(lookName, "05", "exactly one duplicate flag with the rename tooltip", (await dialog().locator('span[title="Click the code to rename it."]').count()) === 1, null);
      check(lookName, "05", "Create count −1", createCount(s) === before5 - 1, [before5, createCount(s)]);
      contrastByLook[lookName].dup = await page.evaluate(contrast);
      await closeDialog();

      // 06 — A-602: no rows read
      await gotoPage(2);
      await shot("_a602-sheet");
      s = await importFrom(BOX.a602);
      await shot("06-p2-zero-rows", dialog());
      check(lookName, "06", "title: no rows read", s.title === "Import from schedule — no rows read", s.title);
      check(lookName, "06", "banner text exact (3 codes)", s.banner === BANNER_P2, s.banner);
      check(lookName, "06", "dialog aria-describedby = banner id", !!s.bannerId && s.describedby === s.bannerId, [s.describedby, s.bannerId]);
      check(lookName, "06", "the only button is Close", eq(s.buttons, ["Close"]), s.buttons);
      check(lookName, "06", "focus on Close, inside the dialog", s.active.text === "Close" && s.active.inDialog, s.active);
      await page.keyboard.press("Escape");
      const closed = await dialog().waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false);
      check(lookName, "06", "Esc closes it", closed, null);

      // 07 — A-603: short table, each code on its own row
      await gotoPage(3);
      await shot("_a603-sheet");
      s = await importFrom(BOX.a603);
      await shot("07-p3-short-table", dialog());
      check(lookName, "07", "4 rows: CPT-1, EPOX, PT-1 under No section; RB-1 under Base", eq(s.rows.map((r) => [r.code, (r.group || "").replace(/\s*\d+$/, "").toUpperCase()]), [["CPT-1", "NO SECTION"], ["EPOX", "NO SECTION"], ["PT-1", "NO SECTION"], ["RB-1", "BASE"]]), s.rows.map((r) => [r.code, r.group]));
      const rb = s.rows.find((r) => r.code === "RB-1");
      check(lookName, "07", "RB-1 from description, description RUBBER BASE only", /^from description/i.test(rb?.described[0] || "") && /RB-1 RUBBER BASE ·/.test(rb?.text || "") && !/EPOXY/.test(rb?.text || ""), rb);
      check(lookName, "07", "no banner", s.banner === null, s.banner);
      await closeDialog();

      // 08 — 375 px: the TS-1 row's code, flag and two descriptors don't overlap
      // The box is drawn at 1200 px, then the viewport narrows to 375 × 812 with the dialog open
      // (the dialog is fixed, min(560px, 100vw − 32px) wide, so it reflows the same as one opened
      // at 375; the classic layout's wrapped toolbars leave too little canvas to draw on at 375).
      await gotoPage(1);
      s = await importFrom(BOX.a601);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(600);
      const row = dialog().locator('button[title="Click to fix the code"]', { hasText: /^TS-1$/ }).locator("xpath=ancestor::label/..");
      await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
      const rects = await row.evaluate((r) => {
        const R = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: b.right, b: b.bottom }; };
        const hit = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
        const code = R(r.querySelector('button[title="Click to fix the code"]'));
        const flagEl = [...r.querySelectorAll("label > span")].find((s) => s.textContent.trim() === "in use");
        const flag = flagEl ? R(flagEl) : null;
        const ds = [...r.querySelectorAll('[id$="-guess"], [id$="-notused"]')].map(R);
        const pairs = [...ds.map((d) => hit(code, d)), flag ? hit(code, flag) : null, ds.length === 2 ? hit(ds[0], ds[1]) : null, ...(flag ? ds.map((d) => hit(flag, d)) : [])];
        return { viewport: innerWidth, dialog: r.closest("[role=dialog]").getBoundingClientRect().width, code, flag, descriptors: ds, anyOverlap: pairs.some(Boolean), nDesc: ds.length, scrollW: document.documentElement.scrollWidth };
      });
      await shot("08-p1-375px-twolabel-inuse");
      await shot("08-p1-375px-dialog", dialog());
      check(lookName, "08", "375 px viewport, dialog 343 px wide (100vw − 32)", rects.viewport === 375 && Math.round(rects.dialog) === 343, [rects.viewport, rects.dialog]);
      check(lookName, "08", "TS-1: code, in-use flag, 2 descriptors — no two intersect", rects.nDesc === 2 && !!rects.flag && !rects.anyOverlap, rects);
      narrowLater.push(rects);
      await closeDialog();
      await page.setViewportSize({ width: 1200, height: 983 });
      await page.waitForTimeout(600);
    }

    // 01 — the demo's MATERIAL SCHEDULE (sample plan, sheet 2 = AF600)
    if (MODE === "pr") { await showControls(); await vis(page.locator("button", { hasText: /AF101|AF600|sample-finish/ })).click().catch(() => {}); await page.waitForTimeout(1200); }
    const dlabel = await gotoPage(2);
    check(lookName, "01", "demo sheet 2 (AF600)", /AF600|2\/2/.test(dlabel), dlabel);
    let s = await importFrom(BOX.demo);
    await shot("01-demo");
    const codes = s.rows.map((r) => r.code).sort();
    check(lookName, "01", "title: 28 finishes found", s.title === "Import from schedule — 28 finishes found", s.title);
    check(lookName, "01", "the 28 codes equal the base golden demo-p2-table.json", eq(codes, DEMO_CODES), codes);
    check(lookName, "01", "no banner, no aria-describedby", s.banner === null && s.describedby === null, [s.banner, s.describedby]);
    check(lookName, "01", "0 NOT USED labels", s.rows.every((r) => !/NOT USED/.test(r.text)), null);
    check(lookName, "01", "no group indeterminate", s.groups.every((g) => !g.indeterminate), s.groups);
    const inUse = s.rows.filter((r) => r.flag === "in use").map((r) => r.code);
    const expectInUse = MODE === "pr" ? ["CPT-1", "VCT-1", "RB-1", "CT-1", "TS-1"] : ["CPT-1", "VCT-1", "RB-1", "CT-1"];
    check(lookName, "01", `in use: ${expectInUse.join(", ")} (the sample's starter conditions${MODE === "pr" ? " + seeded TS-1" : ""})`, eq([...inUse].sort(), [...expectInUse].sort()), inUse);
    check(lookName, "01", `Create ${MODE === "pr" ? 17 : 18} conditions`, createCount(s) === (MODE === "pr" ? 17 : 18), s.buttons);
    const groupsLine = s.groups.map((g) => `${g.label}=${g.state ?? (g.checked ? "checked" : "unchecked")}`);
    console.log(`INFO [${lookName}] 01 groups: ${groupsLine.join(", ")}`);
    await scrollList("bottom");
    await shot("01b-demo-end", dialog());
    await closeDialog();

    // 09 — the demo dialog with P-2 renamed P-1 (a duplicate on the bundled demo; measurable at base too)
    s = await importFrom(BOX.demo);
    await dialog().locator('button[title="Click to fix the code"]', { hasText: /^P-2$/ }).click();
    await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("P-1"); await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    s = await page.evaluate(dialogState);
    await dialog().locator('button[title="Click to fix the code"]', { hasText: /^P-1$/ }).last().scrollIntoViewIfNeeded();
    await shot("09-demo-duplicate", dialog());
    check(lookName, "09", "demo: the renamed P-2 shows duplicate", s.rows.filter((r) => r.code === "P-1").map((r) => r.flag).join() === ",duplicate", s.rows.filter((r) => r.code === "P-1"));
    contrastByLook[lookName] = { ...(contrastByLook[lookName] || {}), demo: await page.evaluate(contrast) };
    await closeDialog();

    await ctx.close();
  }
  await browser.close();
  console.log(`CONTRAST ${JSON.stringify(contrastByLook)}`);
  console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ""}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log(`\n${pass}/${pass + fail + 1} passed — aborted: ${e.message}`); process.exit(1); });
