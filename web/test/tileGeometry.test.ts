// web/test/tileGeometry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLayout } from "../src/lib/tileGeometry/classify.ts";

// a 2ft × 2ft room, 1ft tiles, no joint → 4 full tiles, none cut
const room: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
const quads = [
  { cx: 0.5, cy: 0.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 1.5, cy: 0.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 0.5, cy: 1.5, w: 1, h: 1, rot: 0, skuId: "s" },
  { cx: 1.5, cy: 1.5, w: 1, h: 1, rot: 0, skuId: "s" },
];

test("a tile fully inside is full; one entirely outside is out", () => {
  const withOut = [...quads, { cx: 5, cy: 5, w: 1, h: 1, rot: 0, skuId: "s" }];
  const c = classifyLayout(withOut, room, [], 0);
  assert.equal(c.filter((x) => x.cls === "full").length, 4);
  assert.equal(c.filter((x) => x.cls === "out").length, 1);
});

test("a half-overhanging tile is cut with the right kept dimension", () => {
  // room 1.5ft wide → the second column is cut to 0.5ft
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 2], [0, 2]];
  const c = classifyLayout(quads, narrow, [], 0);
  const cut = c.find((x) => x.cls === "cut" || x.cls === "corner");
  assert.ok(cut, "a cut tile exists");
  assert.ok(Math.abs(cut!.cut!.w_in - 6) < 1e-3);   // 0.5ft = 6in kept
});

test("a hole punches tiles over it to 'hole'/'cut'", () => {
  const hole: [number, number][] = [[0.75, 0.75], [1.25, 0.75], [1.25, 1.25], [0.75, 1.25]];
  const c = classifyLayout(quads, room, [hole], 0);
  assert.ok(c.some((x) => x.cls === "cut" || x.cls === "hole"));
});

test("a corner tile touches two room edges", () => {
  const narrow: [number, number][] = [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]];
  const c = classifyLayout(quads, narrow, [], 0);
  assert.ok(c.some((x) => x.cls === "corner"));
});
