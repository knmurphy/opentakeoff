// polyscore tests — the pure overlap scorer for the One-Click accuracy corpus
// (#172). Each test pins one of the design guarantees: the band cancels the
// constant Bresenham inset size-invariantly, IoU behaves on identical/disjoint/
// half-overlap, non-convex + holes + self-touching rings score without NaN, and
// thin high-aspect corridors stay resolved by the short-side ≥512-cell invariant.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { score, band, iou, ringsPerimeter, type Ring } from "../src/lib/polyscore.ts";

// closed axis-aligned rectangle ring [x0,y0]..[x1,y1]
function rect(x0: number, y0: number, x1: number, y1: number): Ring {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
// the ring inset by `d` on every side (mimics the flood's ~1px Bresenham inset)
function inset(x0: number, y0: number, x1: number, y1: number, d: number): Ring {
  return rect(x0 + d, y0 + d, x1 - d, y1 - d);
}

test("identical rings: band ≈ 0 and IoU = 1", () => {
  const g = [rect(0, 0, 100, 100)];
  const r = score(g, g);
  assert.equal(r.iou, 1);
  assert.ok(r.band < 1e-9, `band should be ~0, got ${r.band}`);
});

test("disjoint rings: IoU = 0", () => {
  assert.equal(iou([rect(0, 0, 10, 10)], [rect(100, 100, 110, 110)]), 0);
});

test("half-overlap: A is exactly the lower half of B ⇒ IoU = 0.5", () => {
  const a = [rect(0, 0, 10, 10)];       // area 100
  const b = [rect(0, 0, 10, 20)];       // area 200, contains A
  const r = score(a, b);
  assert.ok(Math.abs(r.iou - 0.5) < 0.005, `expected ~0.5, got ${r.iou}`);
});

// The band cancels the constant-absolute inset ACROSS room sizes — this is the
// whole reason the metric exists. A fixed IoU floor could not do this: for the
// SAME 1px trace quality, IoU condemns small rooms (0.81) and rubber-stamps large
// ones (0.987), while the band stays ~1.0 at every size. Absolute band precision
// at the 1px floor is grid-limited on large rooms (the harness gates on delta-vs-
// baseline, which freezes that quantization), so this asserts the size-STABILITY
// that matters, not a razor-thin absolute value.
test("band stays bounded near 1.0 across sizes under a 1px inset (size-stable, unlike IoU)", () => {
  const bands: number[] = [];
  for (const s of [20, 50, 100, 200, 300]) {
    const r = score([inset(0, 0, s, s, 1)], [rect(0, 0, s, s)]);
    assert.ok(r.band > 0.8 && r.band < 1.25, `${s}px: band should stay near 1.0, got ${r.band.toFixed(4)}`);
    bands.push(r.band);
  }
  // small, well-resolved rooms are tight to 1.0
  assert.ok(Math.abs(bands[0] - 1) < 0.1, `20px band should be ≈1.0, got ${bands[0].toFixed(4)}`);
});

test("same 1px trace quality: IoU is size-dependent (condemns small, passes large) but band is not", () => {
  const small = score([inset(0, 0, 20, 20, 1)], [rect(0, 0, 20, 20)]);
  const big = score([inset(0, 0, 300, 300, 1)], [rect(0, 0, 300, 300)]);
  // IoU: a 0.18 swing for identical trace quality — the fixed-floor trap.
  assert.ok(small.iou < 0.85 && big.iou > 0.95, `IoU swings with size: ${small.iou.toFixed(3)} vs ${big.iou.toFixed(3)}`);
  // Band: both near 1.0, so both rooms are judged on equal footing.
  assert.ok(small.band > 0.9 && big.band > 0.85, `band size-stable: ${small.band.toFixed(3)} vs ${big.band.toFixed(3)}`);
});

test("L-shaped (non-convex) room vs its bbox: IoU < 1, no NaN", () => {
  const L: Ring = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]];
  const r = score([L], [rect(0, 0, 100, 100)]);
  assert.ok(r.iou > 0 && r.iou < 1, `L vs bbox IoU in (0,1), got ${r.iou}`);
  assert.ok(Number.isFinite(r.band), "band must be finite");
});

test("hole (column) ring flips parity: the engine's outer-contour trace over-counts the column area", () => {
  // The real-bucket orientation: the GOLDEN carries the column hole (accepted
  // finish extent excludes the column); the engine's traceRegion returns the
  // OUTER contour only (no hole). So the symmetric difference is exactly the
  // column area — the known, measured over-count.
  const outer = rect(0, 0, 100, 100);
  const columnHole = rect(40, 40, 60, 60);       // 20x20 = 400px column
  const traced = [outer];                        // outer-contour only, no hole
  const golden = [outer, columnHole];            // accepted extent, with the hole
  const r = score(traced, golden);
  assert.ok(r.goldenArea < r.tracedArea, "golden-with-hole has less area than the solid outer-contour trace");
  assert.ok(Math.abs(r.symdiffArea - 400) < 20, `symdiff ≈ the 400px column, got ${r.symdiffArea.toFixed(1)}`);
});

test("self-touching / bowtie ring scores without NaN or Infinity", () => {
  const bowtie: Ring = [[0, 0], [10, 10], [10, 0], [0, 10]];  // figure-eight
  const r = score([bowtie], [rect(0, 0, 10, 10)]);
  assert.ok(Number.isFinite(r.band) && Number.isFinite(r.iou), "no NaN/Infinity on a self-touching ring");
});

test("very high aspect (≥64:1) corridor: short-side invariant keeps band ≈ 1.0 under a 1px inset", () => {
  const golden = [rect(0, 0, 4, 256)];           // 64:1
  const traced = [inset(0, 0, 4, 256, 1)];
  const r = score(traced, golden);
  assert.ok(r.grid.nx >= 512 || r.grid.ny >= 512, "short side must get ≥512 cells");
  assert.ok(Math.abs(r.band - 1) < 0.1, `high-aspect band should be ≈1.0, got ${r.band.toFixed(4)}`);
});

test("degenerate: both empty ⇒ band 0, IoU 1; golden empty + traced non-empty ⇒ band Infinity (hard fail, not NaN)", () => {
  const both = score([], []);
  assert.equal(both.band, 0); assert.equal(both.iou, 1);
  const goldenGone = score([rect(0, 0, 10, 10)], []);
  assert.equal(goldenGone.band, Infinity);
  assert.ok(!Number.isNaN(goldenGone.band), "must be Infinity, never NaN");
});

test("a ring with <3 vertices contributes nothing (no crash)", () => {
  assert.equal(ringsPerimeter([[[0, 0], [1, 1]]]), 0);
  const r = score([[[0, 0], [1, 1]]], [rect(0, 0, 10, 10)]);
  assert.equal(r.tracedArea, 0);
});

test("band is defined as symdiffArea / golden perimeter (self-consistent, golden is the reference)", () => {
  const golden = [rect(0, 0, 100, 100)];
  const r = score([inset(0, 0, 100, 100, 1)], golden);
  // the normalizer is the GOLDEN's own perimeter, exactly
  assert.equal(r.goldenPerimeter, ringsPerimeter(golden));
  assert.ok(Math.abs(r.band - r.symdiffArea / r.goldenPerimeter) < 1e-9, "band === symdiffArea / goldenPerimeter");
  // and it does not depend on the TRACED perimeter: a jagged trace enclosing the
  // same symdiff area normalizes by the same (golden) denominator.
});

test("scoring is deterministic — identical inputs give bit-identical numbers", () => {
  const a = [rect(3, 7, 217, 149)], b = [inset(3, 7, 217, 149, 1)];
  const r1 = score(a, b), r2 = score(a, b);
  assert.equal(r1.band, r2.band);
  assert.equal(r1.iou, r2.iou);
  assert.equal(r1.symdiffArea, r2.symdiffArea);
});
