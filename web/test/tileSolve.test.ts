import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { getPattern } from "../src/lib/tilePatterns/index.ts";
import { slotKey } from "../src/lib/tilePatterns/slotKey.ts";

// A 4ft × 4ft room, 12×12 tiles, ZERO joint: exactly 16 full tiles, no cuts.
test("solveTileLayout: exact grid fit yields all-full, no cut (joint bridged correctly)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number,number][] = [[0,0],[4,0],[4,4],[0,4]];
  const { quads, classified } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const full = classified.filter((c) => c.cls === "full").length;
  const kept = classified.filter((c) => c.cls !== "out" && c.cls !== "hole");
  assert.equal(full, 16, "16 full 1ft tiles tile a 4ft square exactly");
  assert.equal(kept.every((c) => c.cls === "full"), true, "no cuts on an exact fit");
  assert.ok(quads.length >= 16);
});

// A 3.5ft × 4ft room: the half-foot strip must classify as cuts, not full.
test("solveTileLayout: partial row produces cut pieces (units bridged, not doubled)", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 12; ts.joint.width_in = 0; ts.origin = [0,0];
  const { classified } = solveTileLayout({ tile_setup: ts, ring_ft: [[0,0],[3.5,0],[3.5,4],[0,4]] });
  const cuts = classified.filter((c) => c.cls === "cut" || c.cls === "corner");
  assert.equal(cuts.length, 4, "one half-tile cut per row (4 rows)");
  // cut width ≈ 6in (the half foot), not 0.5 or 42
  assert.ok(cuts.every((c) => Math.abs((c.cut?.w_in ?? 0) - 6) < 0.5 || Math.abs((c.cut?.h_in ?? 0) - 6) < 0.5));
});

test("solveTileLayout: degenerate ring returns empty, does not throw", () => {
  const ts = mintTileSetup();
  assert.deepEqual(solveTileLayout({ tile_setup: ts, ring_ft: [] }).classified, []);
});

// ── assignment resolver (task 5: per-quad SKU from the repeat-unit map) ──

// A,B are IDENTICAL size (12x12in, 0 joint) — only id/color differ, so any
// skuId split we see is the resolver's doing, never a byproduct of geometry.
test("solveTileLayout: a repeat assignment stamps each quad's skuId per its named cell (not a ratio)", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222" },
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  ts.assignment = {
    mode: "repeat",
    unit: { w: 2, h: 2 },
    slots: { "0_0": "A", "1_0": "B", "0_1": "B", "1_1": "A" },
  };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const at = (i: number, j: number) => quads.find((q) => q.cell?.i === i && q.cell?.j === j);
  assert.equal(at(0, 0)?.skuId, "A");
  assert.equal(at(1, 0)?.skuId, "B");
  assert.equal(at(0, 1)?.skuId, "B");
  assert.equal(at(1, 1)?.skuId, "A");
});

test("solveTileLayout: a slot pointing at an id no longer in skus falls back to the default primary, never the dangling id or a placeholder color", () => {
  const ts = mintTileSetup();
  ts.skus = [{ id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" }];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  // unit {w:1,h:1} collapses every cell to slot "0_0" — every quad in the
  // room exercises the dangling-id fallback, not just one corner.
  ts.assignment = { mode: "repeat", unit: { w: 1, h: 1 }, slots: { "0_0": "ghost-deleted-sku" } };
  const ring: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const { quads } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  assert.ok(quads.length > 0);
  assert.ok(quads.every((q) => q.skuId === "A"));
  assert.ok(quads.every((q) => q.skuId !== "ghost-deleted-sku" && q.skuId !== "#888"));
});

test("solveTileLayout: absent assignment leaves every quad's skuId at today's primary (byte-identical to pre-change)", () => {
  const ts = mintTileSetup(); // no assignment — mintTileSetup's single default SKU
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const primaryId = ts.skus[0].id;
  assert.ok(quads.length > 0);
  assert.ok(quads.every((q) => q.skuId === primaryId));
});

// ── offset.ts floored-mod rowShift fix (carried Task-4 review finding) ──

test("brick_50: a negative-j row's floored-mod rowShift matches its positive-row phase-equivalent, so shared cx keeps the same cell.i (and thus slotKey)", () => {
  const g = getPattern("brick_50");
  const bounds = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  const quads = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  const unit = { w: 2, h: 2 }; // n=2 for brick_50 (1/0.5): j=-1 and j=1 are the same phase
  const rowNeg = quads.filter((q) => q.cell?.j === -1);
  const rowPos = quads.filter((q) => q.cell?.j === 1);
  assert.ok(rowNeg.length > 0 && rowPos.length > 0);
  const posByCx = new Map(rowPos.map((q) => [Math.round(q.cx * 1e6), q]));
  let matched = 0;
  for (const q of rowNeg) {
    const twin = posByCx.get(Math.round(q.cx * 1e6));
    if (!twin) continue;
    matched++;
    assert.equal(q.cell!.i, twin.cell!.i, `same cx=${q.cx} must share cell.i across phase-equal rows j=-1,j=1`);
    assert.equal(slotKey(q.cell!, unit), slotKey(twin.cell!, unit));
  }
  assert.ok(matched > 0, "expected overlapping cx between row j=-1 and row j=1");
});
