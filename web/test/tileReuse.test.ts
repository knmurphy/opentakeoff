// web/test/tileReuse.test.ts
//
// Task 6.1 (docs/superpowers/plans/2026-08-28-tile-patterning-m6-m7.md
// §M6): the pure with-reuse offcut pool. Fixtures build `Classified[]`
// directly (dims we control) rather than routing through a solved layout —
// reuse.ts only reads `cls`/`cut`, never `quad` geometry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reusePlan } from "../src/lib/tileCalc/reuse.ts";
import type { Classified } from "../src/lib/tileGeometry/classify.ts";
import type { TileSku, TilePattern } from "../src/lib/tileSetup.ts";

const DUMMY_QUAD = { cx: 0, cy: 0, w: 1, h: 1, rot: 0, skuId: "sku1" };

function fullCell(): Classified {
  return { quad: DUMMY_QUAD, cls: "full", areaFull_sf: 1, areaKept_sf: 1 };
}

function cutCell(w_in: number, h_in: number, lShaped = false): Classified {
  return {
    quad: DUMMY_QUAD, cls: "cut", areaFull_sf: 1, areaKept_sf: 0.5,
    cut: { w_in, h_in, lShaped },
  };
}

function cornerCell(w_in: number, h_in: number): Classified {
  return {
    quad: DUMMY_QUAD, cls: "corner", areaFull_sf: 1, areaKept_sf: 0.3,
    cut: { w_in, h_in, lShaped: false },
  };
}

const SKU_24: TileSku = { id: "sku1", name: "Field 24x24", w_in: 24, h_in: 24, color: "#999" };
const SKU_12x24: TileSku = { id: "sku1", name: "Plank 12x24", w_in: 12, h_in: 24, color: "#999" };
const GRID: TilePattern = "grid";

test("1. straight cuts pack into offcuts -> wholeTiles < safe", () => {
  const classified = [cutCell(20, 20), cutCell(3, 20)];
  const plan = reusePlan({ classified, sku: SKU_24, pattern: GRID, sliver_threshold_in: 2, kerf_in: 0.125 });
  assert.equal(plan.wholeTiles, 1, "second cut reused the first tile's offcut");
  assert.equal(plan.offcutsUsed, 1);
  assert.ok(plan.wholeTiles < 2, "safe would be 2 (one whole tile per cut)");
  assert.equal(plan.reuseMap.length, 1);
  assert.deepEqual(plan.reuseMap[0].from_in, [24, 24]);
  assert.deepEqual(plan.reuseMap[0].cuts_in, [[3, 20]]);
});

test("2. grain-lock: a cut that fits only when the offcut is rotated 90 deg opens a new tile", () => {
  // Cut 1 (10x20) opens a 12x24 tile, leaving a 10x3.875 offcut in the pool
  // (height-direction leftover). Cut 2 (3.875x10) is that offcut's dims
  // TRANSPOSED — it would fit if rotation were allowed, but grain-lock (no
  // 90-degree rotation) must refuse it.
  const classified = [cutCell(10, 20), cutCell(3.875, 10)];
  const plan = reusePlan({ classified, sku: SKU_12x24, pattern: GRID, sliver_threshold_in: 2, kerf_in: 0.125 });
  assert.equal(plan.offcutsUsed, 0, "grain-lock refused the rotated-only fit");
  assert.equal(plan.wholeTiles, 2, "both cuts opened their own tile");
});

test("3. a sub-threshold remainder is scrapped, not pooled", () => {
  // Cut 1 (22x22 from a 24x24 tile) leaves two 1.875-wide strips — both
  // below the 2in sliver threshold, so both scrap. Cut 2 (1.5x1.5) would
  // fit a 1.875x1.875-class remnant had one survived; since the pool is
  // empty it must open its own tile (and its own leftovers include a
  // third sub-threshold 1.5-wide strip).
  const classified = [cutCell(22, 22), cutCell(1.5, 1.5)];
  const plan = reusePlan({ classified, sku: SKU_24, pattern: GRID, sliver_threshold_in: 2, kerf_in: 0.125 });
  assert.equal(plan.scrapped, 3);
  assert.equal(plan.offcutsUsed, 0);
  assert.equal(plan.wholeTiles, 2);
});

test("4. an L-shaped cut and a corner cell each consume a whole tile with no offcut", () => {
  const classified = [cutCell(20, 20, true), cornerCell(6, 6)];
  const plan = reusePlan({ classified, sku: SKU_24, pattern: GRID, sliver_threshold_in: 2, kerf_in: 0.125 });
  assert.equal(plan.wholeTiles, 2);
  assert.equal(plan.offcutsUsed, 0);
  assert.equal(plan.scrapped, 0);
  assert.deepEqual(plan.reuseMap, []);
});

test("5. diagonal/herringbone/basketweave are auto-downgraded: wholeTiles === safe", () => {
  const classified = [fullCell(), fullCell(), cutCell(20, 20), cornerCell(6, 6)];
  for (const pattern of ["diagonal", "herringbone", "basketweave"] as const) {
    const plan = reusePlan({ classified, sku: SKU_24, pattern, sliver_threshold_in: 2, kerf_in: 0.125 });
    assert.equal(plan.wholeTiles, 4, `${pattern}: full(2)+cut(1)+corner(1) = safe`);
    assert.equal(plan.offcutsUsed, 0);
    assert.equal(plan.scrapped, 0);
    assert.deepEqual(plan.reuseMap, []);
    assert.ok(typeof plan.downgraded === "string" && plan.downgraded.includes(pattern));
  }
  // grid is unaffected by the downgrade path.
  const gridPlan = reusePlan({ classified, sku: SKU_24, pattern: GRID, sliver_threshold_in: 2, kerf_in: 0.125 });
  assert.equal(gridPlan.downgraded, undefined);
});

test("6. determinism: the same input yields a deep-equal plan every time", () => {
  const classified = [
    cutCell(20, 20), cutCell(3, 20), cutCell(22, 22), cutCell(1.5, 1.5),
    cutCell(10, 20, true), cornerCell(6, 6), fullCell(), fullCell(),
  ];
  const args = { classified, sku: SKU_24, pattern: GRID, sliver_threshold_in: 2, kerf_in: 0.125 } as const;
  const first = reusePlan(args);
  const second = reusePlan({ ...args, classified: [...classified] });
  assert.deepEqual(first, second);
});
