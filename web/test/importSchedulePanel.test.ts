// The import dialog is view-only (parsing/normalization is the tested parent's
// job), but the category-confidence surfacing has real decision logic worth
// pinning: the per-row "verify" chip render guard, its two tooltip branches
// (prefix-guess vs "other" fallback), and the summary banner. An inverted guard
// or a wrong tooltip branch would otherwise ship green (the parser/scan tests
// only cover the flag, not what the dialog does with it). Rendered to static
// markup — no DOM/browser needed; this exercises the initial render only.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel from "../src/components/ImportSchedulePanel.jsx";

const row = (over: Record<string, unknown> = {}) => ({
  finish_tag: "RB-1", section: "", category: "base", description: "RESILIENT BASE",
  manufacturer: "VPI", style: "", spec_color: "", size: '4"', suggested: true, ...over,
});
const render = (rows: unknown[]) =>
  renderToStaticMarkup(
    React.createElement(Panel as never, { rows, existing: new Set(), palette: ["#111"], startIndex: 0, onCreate() {}, onClose() {} }),
  );

test("an inferred non-'other' row shows the verify chip with the prefix-guess tooltip", () => {
  const html = render([row({ category: "base", category_inferred: true })]);
  assert.ok(html.includes(">verify<"), "no verify chip");
  assert.ok(html.includes("--c-warning"), "chip not using the warning token");
  assert.ok(html.includes("guessed from the code prefix"), "wrong tooltip for a prefix-inferred row");
  assert.ok(!html.includes("defaulting to"), "prefix row wrongly got the 'other' tooltip");
});

test("an inferred 'other' row's tooltip says defaulting, not guessed-from-code", () => {
  const html = render([row({ finish_tag: "PT-9", category: "other", category_inferred: true })]);
  assert.ok(html.includes(">verify<"), "no verify chip on the other row");
  assert.ok(html.includes("defaulting to"), "other row missing the fallback tooltip");
  assert.ok(!html.includes("guessed from the code prefix"), "other row wrongly claims a code-prefix guess");
});

test("a confident row shows no verify chip", () => {
  const html = render([row({ category_inferred: false })]);
  assert.ok(!html.includes(">verify<"), "confident row wrongly flagged");
});

test("the summary banner counts guessed categories, and is absent when none", () => {
  const some = render([
    row({ finish_tag: "RB-1", category: "base", category_inferred: true }),
    row({ finish_tag: "CPT-1", category: "floor", category_inferred: false }),
    row({ finish_tag: "P-9", category: "other", category_inferred: true }),
  ]);
  assert.ok(/2 of 3 categor/.test(some), "banner miscounts guessed categories");
  const none = render([row({ category_inferred: false })]);
  assert.ok(!/categor(y|ies) w(as|ere) guessed/.test(none), "banner shown with nothing inferred");
});
