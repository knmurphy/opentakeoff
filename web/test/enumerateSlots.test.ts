// web/test/enumerateSlots.test.ts
//
// enumerateSlots(pattern, unit) — the paint-the-unit grid's slot list (M9/
// Task 11). It MUST build keys with the same slotKey/PLANK_ARITY the
// generators + resolver already use, or painting is a silent no-op: an
// arity-1 pattern's cell must omit `p` (slotKey → "i_j"), matching what
// grid/brick_50/brick_33/diagonal quads actually carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enumerateSlots } from "../src/lib/tilePatterns/enumerateSlots.ts";
import { slotKey, PLANK_ARITY } from "../src/lib/tilePatterns/slotKey.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("enumerateSlots: grid 2x2 — 4 slots, row-major (j outer, i inner), no _p suffix", () => {
  const slots = enumerateSlots("grid", { w: 2, h: 2 });
  assert.deepEqual(
    slots.map((s) => s.slot),
    ["0_0", "1_0", "0_1", "1_1"],
  );
  for (const s of slots) assert.equal(s.p, undefined, `arity-1 slot ${s.slot} must carry no p`);
});

test("enumerateSlots: herringbone 1x1 — 4 slots, one per plank role, keys end _0.._3", () => {
  const slots = enumerateSlots("herringbone", { w: 1, h: 1 });
  assert.deepEqual(
    slots.map((s) => s.slot),
    ["0_0_0", "0_0_1", "0_0_2", "0_0_3"],
  );
  assert.deepEqual(slots.map((s) => s.p), [0, 1, 2, 3]);
});

test("enumerateSlots: basketweave 2x1 — arity 2, two planks per cell", () => {
  const slots = enumerateSlots("basketweave", { w: 2, h: 1 });
  assert.deepEqual(
    slots.map((s) => s.slot),
    ["0_0_0", "0_0_1", "1_0_0", "1_0_1"],
  );
});

test("enumerateSlots: every arity-1 pattern's slots match /^\\d+_\\d+$/ — the silent-no-op invariant", () => {
  for (const pattern of ["grid", "brick_50", "brick_33", "diagonal"]) {
    const slots = enumerateSlots(pattern, { w: 3, h: 2 });
    assert.equal(slots.length, 6, `${pattern}: expected 6 slots for a 3x2 unit`);
    for (const s of slots) {
      assert.match(s.slot, /^\d+_\d+$/, `${pattern} slot "${s.slot}" must have no plank suffix`);
    }
  }
});

test("enumerateSlots: keys match slotKey/PLANK_ARITY directly (no drift between the two)", () => {
  for (const pattern of Object.keys(PLANK_ARITY)) {
    const unit = { w: 2, h: 2 };
    const slots = enumerateSlots(pattern, unit);
    const arity = PLANK_ARITY[pattern];
    assert.equal(slots.length, 4 * arity);
    for (const s of slots) {
      const cell = arity === 1 ? { i: s.i, j: s.j } : { i: s.i, j: s.j, p: s.p };
      assert.equal(s.slot, slotKey(cell, unit));
    }
  }
});

test("enumerateSlots: i,j span the unit — every (i,j) in 0..w-1 x 0..h-1 appears", () => {
  const slots = enumerateSlots("grid", { w: 3, h: 2 });
  const pairs = new Set(slots.map((s) => `${s.i},${s.j}`));
  for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) assert.ok(pairs.has(`${i},${j}`), `missing (${i},${j})`);
});

test("enumerateSlots: unknown pattern falls back to arity 1 (PLANK_ARITY default)", () => {
  const slots = enumerateSlots("mystery" as unknown as string, { w: 1, h: 1 });
  assert.deepEqual(slots, [{ slot: "0_0", i: 0, j: 0 }]);
});

// Round-trip: paint one enumerateSlots-built slot key straight into an
// assignment and confirm solveTileLayout's quads actually pick it up — the
// proof that the paint grid's keys are not just shaped like slotKey's
// output, they ARE the keys the resolver reads. A and B are the SAME size
// (12x12in) — a mismatched size would trip the same-size gate (tileSolve.ts)
// and skip the resolver loop entirely, making this pass for the wrong reason.
test("enumerateSlots: a slot built here reaches the matching quad through solveTileLayout", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222" },
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const unit = { w: 2, h: 2 };
  const slots = enumerateSlots(ts.pattern, unit);
  const painted = slots[2]; // {i:0,j:1} — row-major 3rd entry for a 2x2 grid unit
  assert.equal(painted.slot, "0_1");
  ts.assignment = { mode: "repeat", unit, slots: { [painted.slot]: "B" } };

  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const skuIds = new Set(quads.map((q) => q.skuId));
  assert.ok(skuIds.has("A") && skuIds.has("B"), `expected both A and B among quad skuIds, got ${[...skuIds]}`);
  const paintedQuad = quads.find((q) => q.cell?.i === painted.i && q.cell?.j === painted.j);
  assert.equal(paintedQuad?.skuId, "B");
});
