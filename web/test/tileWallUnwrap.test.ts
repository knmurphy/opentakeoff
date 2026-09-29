import { test } from "node:test";
import assert from "node:assert/strict";
import { wallStripRing, unwrapRun } from "../src/lib/tileWall/unwrap.ts";

const dims = { w: 100, h: 100 }, upp = 0.1; // 1 norm unit = 10 ft; so px*upp handled via dims
// helper: put verts in feet directly by choosing dims/upp so nx*dims.w*upp = feet
// with dims.w=100, upp=0.1 → nx*10 ft. Use nx = ft/10.
const ft = (x: number) => x / 10;

test("wallStripRing: is the L×H rectangle with area L*H", () => {
  const r = wallStripRing(18, 8);
  assert.deepEqual(r, [[0, 0], [18, 0], [18, 8], [0, 8]]);
});

test("unwrapRun: single straight wall: L=openLen, no folds", () => {
  const res = unwrapRun({ verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)]], dims, upp, H_ft: 8, face_side: "left" })!;
  assert.ok(Math.abs(res.L_ft - 10) < 10 ** -6);
  assert.deepEqual(res.folds, []);
  assert.deepEqual(res.strip_ring, [[0, 0], [10, 0], [10, 8], [0, 8]]);
});

test("unwrapRun: L-shaped run: one interior fold at the first wall's length, classified by turn+face", () => {
  // wall A 10.5 ft east, then turn 'left' (north) for wall B 7.5 ft
  const res = unwrapRun({
    verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]],
    dims, upp, H_ft: 8, face_side: "left",
  })!;
  assert.ok(Math.abs(res.L_ft - 18) < 10 ** -6);
  assert.equal(res.folds.length, 1);
  assert.ok(Math.abs(res.folds[0].u_ft - 10.5) < 10 ** -6);
  assert.equal(res.folds[0].vertexIndex, 1);
  assert.ok(["inside", "outside"].includes(res.folds[0].kind));
});

test("unwrapRun: ABSOLUTE label: east→south L-run with face_side left → INSIDE (pins the convention)", () => {
  const res = unwrapRun({ verts_norm: [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]], dims, upp, H_ft: 8, face_side: "left" })!;
  assert.equal(res.folds[0].kind, "inside");   // NOT just left≠right — the literal label
});

test("unwrapRun: flipping face_side inverts every fold's inside/outside label", () => {
  const run = { verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)], [ft(10), ft(6)]] as [number,number][], dims, upp, H_ft: 8 };
  const left = unwrapRun({ ...run, face_side: "left" })!;
  const right = unwrapRun({ ...run, face_side: "right" })!;
  assert.notEqual(left.folds[0].kind, right.folds[0].kind);
});

test("unwrapRun: collapses a collinear interior vertex: no spurious fold", () => {
  const res = unwrapRun({
    verts_norm: [[ft(0), ft(0)], [ft(5), ft(0)], [ft(12), ft(0)]], // straight through at v1
    dims, upp, H_ft: 8, face_side: "left",
  })!;
  assert.ok(Math.abs(res.L_ft - 12) < 10 ** -6);
  assert.deepEqual(res.folds, []);
});

test("unwrapRun: rejects a reversing (U-turn) run with a warning, returns null", () => {
  const res = unwrapRun({
    verts_norm: [[ft(0), ft(0)], [ft(10), ft(0)], [ft(2), ft(0)]], // doubles back along the same line
    dims, upp, H_ft: 8, face_side: "left",
  });
  assert.equal(res, null);
});
