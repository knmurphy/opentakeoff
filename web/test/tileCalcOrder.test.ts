import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTiles, materialWasteMultiplier, PATTERN_WASTE } from "../src/lib/tileCalc/order.ts";

const sku = (o = {}) => ({ id: "s", name: "T", w_in: 12, h_in: 12, color: "#000", ...o });

test("orderTiles: breakage margin + whole-box rounding on one dye lot", () => {
  const o = orderTiles({ safeCount: 100, sku: sku({ per_box: 8 }), breakage_pct: 0.05, attic_pct: 0 });
  assert.equal(o.figured, 100);            // 12x12 is not large-format
  assert.equal(o.withMargin, 105);         // +5% breakage
  assert.equal(o.boxes, 14);               // ceil(105/8)
  assert.equal(o.dyeLots, 1);
});

test("orderTiles: attic stock adds on top of breakage", () => {
  const o = orderTiles({ safeCount: 100, sku: sku({ per_box: 10 }), breakage_pct: 0.05, attic_pct: 0.10 });
  assert.equal(o.withMargin, 115);         // ceil(100*1.05 + 100*0.10)
  assert.equal(o.boxes, 12);
});

test("materialWasteMultiplier: large format bumps the figured count", () => {
  assert.equal(materialWasteMultiplier(sku({ w_in: 24, h_in: 48 })), 1.15);
  assert.equal(materialWasteMultiplier(sku()), 1.0);
  const o = orderTiles({ safeCount: 100, sku: sku({ w_in: 24, h_in: 48, per_box: 4 }) });
  assert.equal(o.figured, 115);
});

test("PATTERN_WASTE: diagonal/herringbone carry more heuristic waste than grid", () => {
  assert.ok(PATTERN_WASTE.diagonal > PATTERN_WASTE.grid);
  assert.ok(PATTERN_WASTE.herringbone > PATTERN_WASTE.grid);
});

// FIX 5 (P2) — a non-positive per_box (0, or negative via a bad import/MCP
// edit_condition payload) used to ceil to Infinity or a negative box count.
// It must fall back to sold-each (1 per "box") instead.
test("orderTiles: per_box 0 or negative falls back to sold-each, never Infinity/negative boxes", () => {
  const zero = orderTiles({ safeCount: 100, sku: sku({ per_box: 0 }), breakage_pct: 0.05, attic_pct: 0 });
  assert.equal(zero.perBox, 1);
  assert.ok(Number.isFinite(zero.boxes) && zero.boxes > 0);
  assert.equal(zero.boxes, zero.withMargin);

  const negative = orderTiles({ safeCount: 100, sku: sku({ per_box: -4 }), breakage_pct: 0.05, attic_pct: 0 });
  assert.equal(negative.perBox, 1);
  assert.ok(Number.isFinite(negative.boxes) && negative.boxes > 0);
  assert.equal(negative.boxes, negative.withMargin);
});
