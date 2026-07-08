// lineStyles — the pure dash-pattern + dark-boost primitive shared by the canvas
// (SVG) and the marked-set PDF. These pin the two contracts that bite: solid must
// return a FALSY value (not [] / "") so no stray dash attribute is drawn, and
// boostForDark must preserve hue while lightening only genuinely dark colors.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINE_STYLES, LINE_STYLE_IDS, dashArrayFor, pdfDashFor, boostForDark, luminance,
} from "../src/lib/lineStyles.js";

test("LINE_STYLES exposes the four expected styles", () => {
  assert.deepEqual(LINE_STYLE_IDS, ["solid", "dashed", "dotted", "dashdot"]);
  const styles = LINE_STYLES as Record<string, { label: string }>;
  for (const id of LINE_STYLE_IDS) assert.ok(styles[id].label);
});

test("dashArrayFor: dashed returns a space-joined SVG string at scale 1", () => {
  assert.equal(dashArrayFor("dashed", 1), "6 4");
  assert.equal(dashArrayFor("dashdot", 1), "8 3 1 3");
});

test("dashArrayFor: divides the pattern by the stage scale (screen-relative)", () => {
  assert.equal(dashArrayFor("dashed", 2), "3 2");
  assert.equal(dashArrayFor("dotted", 4), "0.25 0.75");
});

test("dashArrayFor + pdfDashFor: solid and unknown are FALSY (never [] or empty string)", () => {
  for (const style of ["solid", "wobble", undefined]) {
    const svg = dashArrayFor(style as string, 1);
    assert.ok(!svg, `svg dash for ${style} must be falsy, got ${JSON.stringify(svg)}`);
    assert.notDeepEqual(svg, []);
    const pdf = pdfDashFor(style as string);
    assert.ok(!pdf, `pdf dash for ${style} must be falsy, got ${JSON.stringify(pdf)}`);
    // the exact bug guarded: pdf-lib treats [] as truthy
    assert.notDeepEqual(pdf, []);
  }
});

test("pdfDashFor: dashed returns a fresh page-point array (no scale)", () => {
  assert.deepEqual(pdfDashFor("dashed"), [6, 4]);
  // a fresh copy each call — mutating one must not corrupt the source pattern
  const a = pdfDashFor("dashed") as number[];
  a[0] = 99;
  assert.deepEqual(pdfDashFor("dashed"), [6, 4]);
});

test("boostForDark: a dark color is lightened", () => {
  const dark = "#1f2937"; // near-black navy — invisible on the dark canvas
  const out = boostForDark(dark);
  assert.notEqual(out.toLowerCase(), dark.toLowerCase());
  assert.ok(luminance(out) > luminance(dark), "boosted color must be brighter");
});

test("boostForDark: a light color passes through unchanged", () => {
  assert.equal(boostForDark("#ffffff"), "#ffffff");
  assert.equal(boostForDark("#e8e2d4"), "#e8e2d4");
});

test("boostForDark: hue is preserved when lightening a dark color", () => {
  // a dark saturated blue → still blue after the boost
  const [h] = rgbHsl(boostForDark("#101d6b"));
  assert.ok(Math.abs(h - 235) < 12, `expected a blue hue near 235°, got ${h}`);
});

// local HSL for the hue assertion (kept out of the lib's public surface)
function rgbHsl(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  const r = parseInt(s.slice(0, 2), 16) / 255, g = parseInt(s.slice(2, 4), 16) / 255, b = parseInt(s.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh;
  if (max === r) hh = ((g - b) / d) % 6;
  else if (max === g) hh = (b - r) / d + 2;
  else hh = (r - g) / d + 4;
  hh *= 60;
  if (hh < 0) hh += 360;
  return [hh, sat, l];
}
