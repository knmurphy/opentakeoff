// web/test/tilePatterns.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPattern, registry } from "../src/lib/tilePatterns/index.ts";

const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

test("grid is registered", () => {
  assert.ok(registry.has("grid"));
});

test("grid tiles cover the bounds on a pitch lattice, deterministically", () => {
  const g = getPattern("grid");
  const input = { bounds, w: 1, h: 1, joint: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
  const a = g.generate(input);
  const b = g.generate(input);
  assert.deepEqual(a, b);                       // deterministic
  // 10×10 area, 1ft pitch → at least a 10×10 = 100 quad lattice covering it
  assert.ok(a.length >= 100);
  // every quad carries the sku and the pitch extents
  assert.ok(a.every((q) => q.skuId === "s1" && q.w === 1 && q.h === 1));
  // centers land on a lattice stepping by pitch (1ft here)
  const xs = [...new Set(a.map((q) => Math.round(q.cx * 1e6) / 1e6))].sort((p, n) => p - n);
  assert.ok(Math.abs((xs[1] - xs[0]) - 1) < 1e-9);
});

test("origin shift moves the whole lattice by the offset", () => {
  const g = getPattern("grid");
  const base = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  const shifted = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0.5, 0], rotation_deg: 0, skuId: "s1" });
  const minBase = Math.min(...base.map((q) => q.cx));
  const minShift = Math.min(...shifted.map((q) => q.cx));
  assert.ok(Math.abs((minShift - minBase) - 0.5) < 1e-9 || Math.abs((minShift - minBase) + 0.5) < 1e-9);
});

test("brick_50 offsets every other row by half a pitch", () => {
  const g = getPattern("brick_50");
  const a = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  // group by row (cy); adjacent rows' cx sets differ by ~0.5 pitch
  const byRow = new Map<number, number[]>();
  for (const q of a) { const k = Math.round(q.cy * 1e6); (byRow.get(k) ?? byRow.set(k, []).get(k)!).push(q.cx); }
  const rows = [...byRow.entries()].sort((p, n) => p[0] - n[0]).map(([, xs]) => Math.min(...xs));
  assert.ok(Math.abs(Math.abs(rows[1] - rows[0]) % 1 - 0.5) < 1e-9);
});

test("diagonal quads are rotated 45°", () => {
  const g = getPattern("diagonal");
  const a = g.generate({ bounds, w: 1, h: 1, joint: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  assert.ok(a.length > 0);
  assert.ok(a.every((q) => Math.abs(q.rot - Math.PI / 4) < 1e-9));
});
