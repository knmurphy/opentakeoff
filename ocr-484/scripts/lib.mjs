// Shared helpers for the #484 browser evidence (real app build, real engine).
import { chromium } from "playwright";
import { execSync } from "node:child_process";
export const E = new URL("..", import.meta.url).pathname;
export const EXE = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";
export const BASE = process.env.BASE || "http://localhost:8951";
export const load = () => execSync("ps -Ao pcpu,pid,comm -r | head -6").toString();
export async function browser() { return chromium.launch({ executablePath: EXE }); }
export async function persistent(dir) { return chromium.launchPersistentContext(dir, { executablePath: EXE, viewport: { width: 1440, height: 900 } }); }
export const body = (p) => p.locator("body").innerText();
export async function waitText(p, re, ms = 900000) { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(await body(p))) return Date.now() - t; await p.waitForTimeout(300); } throw new Error("timeout " + re); }
/** Open the app, load the sample, then open `pdf` through the gallery's file input. */
export async function openPdf(p, pdf, { classic = true } = {}) {
  await p.goto(BASE + "/"); await p.waitForTimeout(2500);
  await p.getByRole("button", { name: /Load sample plan/ }).click(); await p.waitForTimeout(5000);
  await p.getByRole("button", { name: /^Sheets$/ }).click(); await p.waitForTimeout(700);
  await p.getByText("Open visual gallery").click(); await p.waitForTimeout(2000);
  await p.locator("input[type=file]").first().setInputFiles(pdf); await p.waitForTimeout(9000);
  if (classic && await p.getByRole("button", { name: "Classic layout" }).count()) { await p.getByRole("button", { name: "Classic layout" }).click(); await p.waitForTimeout(1500); }
}
/** pt → screen px on the canvas showing the page (fit view). */
export async function mapper(p, pagePt) {
  const r = await p.evaluate(() => { const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0].getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
  const s = r.w / pagePt[0];
  return { r, s, at: (x, y) => [r.x + x * s, r.y + y * s] };
}
