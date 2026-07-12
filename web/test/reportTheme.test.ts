// Report theme import: map a Claude Design (DTCG-flavored) tokens.json onto the
// small internal theme model the report/marked-set renderers consume, then
// project that model onto the app's real CSS custom-property names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseThemeFile, themeToCssVars } from "../src/lib/reportTheme.js";

const claude = JSON.parse(
  readFileSync(new URL("./fixtures/claude-design.tokens.json", import.meta.url), "utf8"),
);

test("imports neutral ink/paper and the web font family from a Claude Design tokens file", () => {
  const { theme } = parseThemeFile(claude);
  assert.equal(theme.color.ink, "#2E333B");
  assert.equal(theme.color.paper, "#FBFBF8");
  assert.equal(theme.font.display, "Inter Tight");
});

test("normalizes hex colors to canonical #RRGGBB (expands shorthand, adds #, upper-cases)", () => {
  const { theme } = parseThemeFile({ color: { neutral: { ink: { value: "#abc" }, paper: { value: "fbfbf8" } } } });
  assert.equal(theme.color.ink, "#AABBCC");
  assert.equal(theme.color.paper, "#FBFBF8");
});

test("imports all three web font roles", () => {
  const { theme } = parseThemeFile(claude);
  assert.equal(theme.font.display, "Inter Tight");
  assert.equal(theme.font.body, "Inter Tight");
  assert.equal(theme.font.mono, "Inter Tight");
});

test("maps accent-* groups to accent/positive/warning by color name; first match wins", () => {
  const { theme } = parseThemeFile(claude);
  assert.equal(theme.color.accent, "#125792");    // accent-345.brand-blue
  assert.equal(theme.color.positive, "#288234");  // accent-345.brand-green (before fin-green)
  assert.equal(theme.color.warning, "#CF6802");   // accent-fin.fin-orange
  assert.equal(theme.color.danger, undefined);    // no red in this palette → renderer keeps its default
});

test("themeToCssVars maps roles onto the app's real custom-property names", () => {
  const { theme } = parseThemeFile(claude);
  const vars = themeToCssVars(theme);
  assert.equal(vars["--ink"], "#2E333B");
  assert.equal(vars["--cobalt"], "#125792");
  assert.equal(vars["--paper-bright"], "#FBFBF8");
  assert.equal(vars["--c-positive"], "#288234");
  assert.equal(vars["--c-warning"], "#CF6802");
  assert.equal(vars["--f-display"], "Inter Tight");
});

test("themeToCssVars omits vars for absent roles (partial theme keeps defaults)", () => {
  const vars = themeToCssVars({ color: { ink: "#111111" }, font: {} });
  assert.equal(vars["--ink"], "#111111");
  assert.ok(!("--cobalt" in vars));
  assert.ok(!("--c-danger" in vars));
  assert.ok(!("--f-display" in vars));
});

test("drops an invalid color with a warning instead of emitting garbage", () => {
  const { theme, warnings } = parseThemeFile({ color: { neutral: { ink: { value: "rgb(1,2,3)" }, paper: { value: "#FBFBF8" } } } });
  assert.equal(theme.color.ink, undefined);
  assert.equal(theme.color.paper, "#FBFBF8");
  assert.ok(warnings.some((w) => /ink/.test(w)), `expected a warning mentioning ink, got ${JSON.stringify(warnings)}`);
});
