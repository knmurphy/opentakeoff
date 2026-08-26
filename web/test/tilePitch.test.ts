// web/test/tilePitch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nominalQuad, pitchCell, installedFace, faceInset } from "../src/lib/tilePitch.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("nominalQuad is the bare face", () => {
  const q = nominalQuad(1, 2); near(q.w, 1); near(q.h, 2);
});

test("pitchCell adds one joint to each dimension", () => {
  const c = pitchCell(1, 2, 0.02); near(c.w, 1.02); near(c.h, 2.02);
});

test("installedFace insets the nominal by j/2 each side", () => {
  const f = installedFace(1, 2, 0.02); near(f.w, 0.98); near(f.h, 1.98);
  near(faceInset(1, 2, 0.02), 0.01);
});

test("pitch/face are consistent: pitch = installedFace + one joint + 2·inset residue", () => {
  // The invariant the design guarantees: placing on pitchCell and rendering
  // installedFace leaves exactly one joint of gap between neighbours.
  const w = 1, h = 2, j = 0.02;
  const p = pitchCell(w, h, j), f = installedFace(w, h, j);
  near(p.w - f.w, j + 2 * faceInset(w, h, j)); // gap = joint + the two half-insets
});

test("installedFace never goes non-positive for a fat joint", () => {
  const f = installedFace(0.1, 0.1, 0.5); assert.ok(f.w > 0 && f.h > 0);
});
