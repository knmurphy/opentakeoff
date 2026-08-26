import { test } from "node:test";
import assert from "node:assert/strict";
import { movementJoints } from "../src/lib/tileCalc/joints.ts";

test("movementJoints: 10x10 room, spacing 24 — perimeter only, no field lines", () => {
  const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const j = movementJoints({ ring_ft: ring, spacing_ft: 24 });
  assert.equal(j.perimeter_lf, 40);
  assert.equal(j.field_lf, 0);
  assert.equal(j.total_lf, 40);
  assert.equal(j.fieldGridSpacing_ft, 24);
});

test("movementJoints: 60x30 room, spacing 24 — perimeter + field grid", () => {
  const ring: [number, number][] = [[0, 0], [60, 0], [60, 30], [0, 30]];
  const j = movementJoints({ ring_ft: ring, spacing_ft: 24 });
  assert.equal(j.perimeter_lf, 180);
  assert.equal(j.field_lf, 120);
  assert.equal(j.total_lf, 300);
});

test("movementJoints: transitions_lf adds to total", () => {
  const ring: [number, number][] = [[0, 0], [60, 0], [60, 30], [0, 30]];
  const j = movementJoints({ ring_ft: ring, spacing_ft: 24, transitions_lf: 12 });
  assert.equal(j.perimeter_lf, 180);
  assert.equal(j.field_lf, 120);
  assert.equal(j.transition_lf, 12);
  assert.equal(j.total_lf, 312);
});

test("movementJoints: spacing_ft defaults to 24 and reports fieldGridSpacing_ft", () => {
  const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const j = movementJoints({ ring_ft: ring });
  assert.equal(j.fieldGridSpacing_ft, 24);
  assert.equal(j.perimeter_lf, 40);
});
