// The scope-summary reference EXPORT plugin (#169). Two mandates:
//   1. its descriptor passes validateDescriptor with the frozen key set and a
//      VOID onSelect(ctx) that does its own ctx.download (not the spike's
//      returning run(ctx));
//   2. buildScopeSummary produces the right Markdown from a stub ctx (assert the
//      actual rows/sections), and onSelect wires it through ctx.download.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDescriptor, DESCRIPTOR_KEYS } from "../src/lib/plugins/descriptor.ts";
import descriptor from "../src/features/scope-summary/plugin.js";
import { buildScopeSummary, scopeSummaryFilename } from "../src/features/scope-summary/summary.js";
import type { CanvasContext } from "../src/lib/plugins/context.ts";

// A minimal stub ctx exercising only the accessors the summary reads.
function stubCtx(over: Partial<{
  projectName: string;
  units: string;
  conditions: Record<string, unknown>[];
  shapes: Record<string, unknown>[];
  onDownload: (f: string, t: string, m?: string) => void;
}> = {}): CanvasContext {
  const noop = () => {};
  return {
    version: "1.0",
    units: over.units ?? "imperial",
    getConditions: () => over.conditions ?? [],
    getShapes: () => over.shapes ?? [],
    getActiveConditionId: () => null,
    getSelectedShapeId: () => null,
    getProjectName: () => over.projectName ?? "",
    commands: { dispatchShape: noop },
    storage: {} as CanvasContext["storage"],
    download: over.onDownload ?? noop,
  };
}

test("descriptor passes validateDescriptor with the frozen key set", () => {
  const r = validateDescriptor(descriptor);
  assert.equal(r.ok, true);
  // No key outside the frozen four.
  const extra = Object.keys(descriptor).filter(
    (k) => !(DESCRIPTOR_KEYS as readonly string[]).includes(k),
  );
  assert.deepEqual(extra, []);
  assert.equal(descriptor.overlays.length, 0);
  assert.equal(descriptor.exports.length, 1);
});

test("export slot uses the frozen VOID onSelect(ctx) — returns nothing, downloads itself", () => {
  const slot = descriptor.exports[0];
  assert.equal(typeof slot.onSelect, "function");
  const downloaded: { filename: string; text: string; mime?: string }[] = [];
  const ctx = stubCtx({
    projectName: "Maple Street Remodel",
    onDownload: (filename, text, mime) => { downloaded.push({ filename, text, mime }); },
  });
  const ret = slot.onSelect(ctx);
  assert.equal(ret, undefined, "onSelect is void");
  assert.equal(downloaded.length, 1, "onSelect performed its own ctx.download");
  assert.equal(downloaded[0].filename, "maple-street-remodel-scope.md");
  assert.equal(downloaded[0].mime, "text/markdown");
  assert.match(downloaded[0].text, /# Takeoff scope — Maple Street Remodel/);
});

test("buildScopeSummary groups shapes under their condition by label", () => {
  const text = buildScopeSummary(stubCtx({
    projectName: "Job A",
    units: "imperial",
    conditions: [
      { id: "c1", finish_tag: "LVT-1", color: "#a00" },
      { id: "c2", finish_tag: "CPT-2" },
    ],
    shapes: [
      { id: "s1", condition_id: "c1", label: "Room" },
      { id: "s2", condition_id: "c1", label: "Room" },
      { id: "s3", condition_id: "c1", label: "Closet" },
      { id: "s4", condition_id: "c2", label: "Hall" },
    ],
  }));
  assert.match(text, /^# Takeoff scope — Job A$/m);
  assert.match(text, /- Units: imperial/);
  assert.match(text, /- Conditions: 2/);
  assert.match(text, /- Shapes: 4/);
  assert.match(text, /## LVT-1 \(#a00\)/);
  assert.match(text, /- Shapes: 3/);
  assert.match(text, /  - Room: 2/);
  assert.match(text, /  - Closet: 1/);
  assert.match(text, /## CPT-2/);
  assert.match(text, /  - Hall: 1/);
});

test("buildScopeSummary lists orphan shapes under Unassigned", () => {
  const text = buildScopeSummary(stubCtx({
    projectName: "Orphans",
    conditions: [{ id: "c1", finish_tag: "T" }],
    shapes: [
      { id: "s1", condition_id: "c1", label: "A" },
      { id: "s2", condition_id: "gone", label: "B" }, // dead condition_id
      { id: "s3", label: "C" }, // no condition
    ],
  }));
  assert.match(text, /## Unassigned shapes/);
  assert.match(text, /- Shapes: 2/);
  assert.match(text, /  - B: 1/);
  assert.match(text, /  - C: 1/);
});

test("scopeSummaryFilename is filesystem-safe and falls back", () => {
  assert.equal(scopeSummaryFilename("Maple St. #4"), "maple-st-4-scope.md");
  assert.equal(scopeSummaryFilename(""), "untitled-scope.md");
  assert.equal(scopeSummaryFilename("   "), "untitled-scope.md");
});
