// Marquee containment (#113): center-in-STAGE-rect with panel xOffset applied.
// The center-point convention is shared with shapesInZone — these tests pin the
// shape-type fallbacks (count point, linear midpoint) and the panel translation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapesInStageRect } from "../src/lib/marquee.js";

// One 1000×800 panel at xOffset 0; a second identical panel side-by-side at 1000.
const PANELS: Record<string, { img: { w: number; h: number }; xOffset: number }> = {
  A: { img: { w: 1000, h: 800 }, xOffset: 0 },
  B: { img: { w: 1000, h: 800 }, xOffset: 1000 },
};
const byKey = (k: string) => PANELS[k] ?? null;

const poly = (id: string, sheet: string, verts: number[][]) =>
  ({ id, sheet_id: sheet, verts_norm: verts });

// A 0.2×0.2 square centered on (0.3, 0.3) → stage center (300, 240) on panel A.
const sqA = poly("sq-a", "A", [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]]);

test("polygon centroid inside the rect selects; outside does not", () => {
  assert.deepEqual(shapesInStageRect([sqA], [[250, 200], [350, 300]], byKey), ["sq-a"]);
  assert.deepEqual(shapesInStageRect([sqA], [[500, 500], [900, 700]], byKey), []);
});

test("count shape (1 vertex) selects when its point is inside — corner-inclusive", () => {
  const count = poly("cnt", "A", [[0.5, 0.5]]);                  // stage (500, 400)
  assert.deepEqual(shapesInStageRect([count], [[500, 400], [600, 500]], byKey), ["cnt"]);
  assert.deepEqual(shapesInStageRect([count], [[501, 401], [600, 500]], byKey), []);
});

test("linear (2 vertices) selects by MIDPOINT even when both endpoints are outside", () => {
  // endpoints stage (100, 400) and (900, 400); midpoint (500, 400)
  const lin = poly("lin", "A", [[0.1, 0.5], [0.9, 0.5]]);
  assert.deepEqual(shapesInStageRect([lin], [[450, 350], [550, 450]], byKey), ["lin"]);
});

test("panel xOffset translates containment — same normalized shape, different panels", () => {
  const sqB = { ...sqA, id: "sq-b", sheet_id: "B" };             // stage center (1300, 240)
  const rectOverB: [number[], number[]] = [[1250, 200], [1350, 300]];
  assert.deepEqual(shapesInStageRect([sqA, sqB], rectOverB, byKey), ["sq-b"]);
});

test("shapes on non-visible or degenerate panels are excluded", () => {
  const ghost = { ...sqA, id: "ghost", sheet_id: "Z" };          // panelByKey → null
  const flat = { ...sqA, id: "flat", sheet_id: "F" };
  const withFlat = (k: string) => (k === "F" ? { img: { w: 0, h: 0 }, xOffset: 0 } : byKey(k));
  assert.deepEqual(shapesInStageRect([ghost, flat], [[0, 0], [2000, 800]], withFlat), []);
});

test("reversed corners are normalized — [b,a] ≡ [a,b]", () => {
  assert.deepEqual(shapesInStageRect([sqA], [[350, 300], [250, 200]], byKey), ["sq-a"]);
});
