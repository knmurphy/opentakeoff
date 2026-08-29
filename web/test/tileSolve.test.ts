import { test } from "node:test";
import assert from "node:assert/strict";
import { solveTileLayout, type TileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup, assignedSkuId } from "../src/lib/tileSetup.ts";
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

test("solveTileLayout: a partial slot map (the normal case for a UI editor) falls back to the default only for the UNMAPPED cells, not the whole field", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222" },
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  // only "0_0" is mapped; "1_0" (and every other slot in the unit) is absent
  ts.assignment = { mode: "repeat", unit: { w: 2, h: 2 }, slots: { "0_0": "B" } };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const at = (i: number, j: number) => quads.find((q) => q.cell?.i === i && q.cell?.j === j);
  assert.equal(at(0, 0)?.skuId, "B", "mapped slot wins");
  assert.equal(at(1, 0)?.skuId, "A", "unmapped slot falls back to the default primary");
});

test("assignedSkuId: cell absent (a generator with no cell) resolves to the default primary directly", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 12, h_in: 12, color: "#222222" },
  ];
  ts.assignment = { mode: "repeat", unit: { w: 2, h: 2 }, slots: { "0_0": "B" } };
  assert.equal(assignedSkuId(ts, undefined), "A");
  assert.equal(assignedSkuId(ts, null), "A");
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
  const { quads, warnings } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const primaryId = ts.skus[0].id;
  assert.ok(quads.length > 0);
  assert.ok(quads.every((q) => q.skuId === primaryId));
  assert.deepEqual(warnings, []);
});

// ── Task 9 (2026-08-29 tile-multi-sku-field): same-size gate ──
// The generator lays ONE uniform tile size; a differently-sized assigned SKU
// would be counted/ordered at the wrong size. The engine must REJECT a
// multi-SKU assignment whose SKUs aren't all the same footprint as the
// field: ignore the assignment (solve single-primary) + push a QA warning.
// Never throw — this runs inside a React useMemo.

test("solveTileLayout: an assigned SKU whose size differs from the field is REJECTED — assignment ignored, warning pushed, no throw", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" }, // field/primary size
    { id: "B", name: "B", w_in: 6, h_in: 6, color: "#222222" }, // DIFFERENT size — must be rejected
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  ts.assignment = {
    mode: "repeat",
    unit: { w: 2, h: 2 },
    slots: { "0_0": "A", "1_0": "B", "0_1": "B", "1_1": "A" },
  };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  let result: TileLayout | undefined;
  assert.doesNotThrow(() => {
    result = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  });
  const { quads, warnings } = result!;
  assert.ok(quads.length > 0);
  assert.ok(quads.every((q) => q.skuId === "A"), "assignment ignored — every quad falls back to the primary");
  assert.ok(
    warnings.some((w) => typeof w === "string" && /same size|multi-size/i.test(w)),
    `expected a same-size warning, got ${JSON.stringify(warnings)}`,
  );
});

test("solveTileLayout: an assigned SKU whose size differs from the field is rejected even when the pair is just rotated (unordered w×h compare)", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 24, color: "#111111" }, // field/primary size
    { id: "B", name: "B", w_in: 24, h_in: 12, color: "#222222" }, // same footprint, rotated — ALLOWED
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  ts.assignment = {
    mode: "repeat",
    unit: { w: 2, h: 2 },
    slots: { "0_0": "A", "1_0": "B", "0_1": "B", "1_1": "A" },
  };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const result = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  assert.ok(result.quads.some((q) => q.skuId === "B"), "same-footprint rotated SKU is allowed — assignment applied");
  assert.deepEqual(result.warnings, []);
});

test("solveTileLayout: assigned SKUs that all match the field size apply the assignment normally (unchanged from Task 5) and warnings is []", () => {
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
  const { quads, warnings } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  const at = (i: number, j: number) => quads.find((q) => q.cell?.i === i && q.cell?.j === j);
  assert.equal(at(0, 0)?.skuId, "A");
  assert.equal(at(1, 0)?.skuId, "B");
  assert.deepEqual(warnings, []);
});

// ── review fix (2026-08-29): the gate must ignore UNREACHABLE stale slots ──
// assignment.slots can carry an entry that was reachable under a PRIOR
// (pattern, unit) — e.g. painted under a 3x3 unit, then the unit shrinks to
// 2x2 — and the panel never prunes it. That slot never colors a quad (the
// resolver only ever looks up REACHABLE keys), so a differently-sized SKU
// sitting on it must not trip the same-size gate for the whole assignment.
test("solveTileLayout: a differently-sized SKU on a slot UNREACHABLE for the current unit is not rejected (stale slot after a unit shrink)", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" }, // field/primary size
    { id: "B", name: "B", w_in: 6, h_in: 6, color: "#222222" }, // DIFFERENT size
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  // "2_2" was reachable at unit {w:3,h:3}; the unit below is {w:2,h:2} (only
  // i,j ∈ {0,1} reachable) — "2_2" is stale and unreachable.
  ts.assignment = { mode: "repeat", unit: { w: 2, h: 2 }, slots: { "2_2": "B" } };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads, warnings } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  assert.deepEqual(warnings, [], "stale unreachable slot must not trigger the size-mismatch warning");
  assert.ok(quads.every((q) => q.skuId === "A"), "no quad is reachable at slot 2_2 in a 2x2 unit — every quad stays on the default primary");
});

test("solveTileLayout: a differently-sized SKU on a REACHABLE slot is still rejected (guard against over-loosening the gate)", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 6, h_in: 6, color: "#222222" }, // DIFFERENT size
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  // Same stale "2_2" entry as above, PLUS a reachable "0_0" naming the same
  // differently-sized SKU — the gate must still fire on the reachable one.
  ts.assignment = { mode: "repeat", unit: { w: 2, h: 2 }, slots: { "2_2": "B", "0_0": "B" } };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads, warnings } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  assert.ok(
    warnings.some((w) => typeof w === "string" && /same size|multi-size/i.test(w)),
    `expected a same-size warning, got ${JSON.stringify(warnings)}`,
  );
  assert.ok(quads.every((q) => q.skuId === "A"), "assignment ignored — every quad falls back to the primary");
});

test("solveTileLayout: a stale slot keyed for a DIFFERENT pattern's arity (e.g. after switching pattern away from herringbone) is unreachable and does not trip the gate", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 6, h_in: 6, color: "#222222" }, // DIFFERENT size
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  ts.pattern = "grid"; // arity 1 — slotKey never emits a "_p" suffix for grid
  // "0_0_3" was reachable back when this field was herringbone (arity 4,
  // plank role 3) at the same unit; switching the pattern to grid makes it
  // unreachable — grid's own slots never carry a "_p" suffix
  // (enumerateSlots.ts / PLANK_ARITY.grid === 1).
  ts.assignment = { mode: "repeat", unit: { w: 1, h: 1 }, slots: { "0_0_3": "B" } };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { quads, warnings } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  assert.deepEqual(warnings, [], "a slot keyed for a different pattern's arity must not trigger the size-mismatch warning");
  assert.ok(quads.every((q) => q.skuId === "A"));
});

// The gate's enumerateSlots(config.pattern, assignment.unit) call and
// assignedSkuId()'s own slotKey() both index through unit.w/unit.h —
// TileAssignment's type requires `unit`, but this is a runtime guard, no
// load-time sanitizer (tileSetup.ts's house posture), so a corrupt/partial
// persisted payload can still land with `slots` present and `unit` missing.
// A differently-sized SKU on that payload used to be SAFE pre-reachable-gate
// (the old check read Object.values(slots) directly, never touching `unit`,
// so it detected the mismatch and warned without ever calling the resolver)
// — the reachable-only gate must not turn that into a crash.
test("solveTileLayout: assignment.slots present but assignment.unit missing (corrupt payload) never throws — quads fall back to the default primary", () => {
  const ts = mintTileSetup();
  ts.skus = [
    { id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" },
    { id: "B", name: "B", w_in: 6, h_in: 6, color: "#222222" }, // DIFFERENT size
  ];
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  // @ts-expect-error — deliberately malformed: no `unit` key at all
  ts.assignment = { mode: "repeat", slots: { "0_0": "B" } };
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  let result: TileLayout | undefined;
  assert.doesNotThrow(() => {
    result = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  });
  assert.ok(result!.quads.length > 0);
  assert.ok(result!.quads.every((q) => q.skuId === "A"), "corrupt unit — assignment can't be resolved, every quad falls back to the primary");
});

test("assignedSkuId: assignment present but slots undefined (malformed payload) falls back to the default and does not throw", () => {
  const ts = mintTileSetup();
  ts.skus = [{ id: "A", name: "A", w_in: 12, h_in: 12, color: "#111111" }];
  // @ts-expect-error — deliberately malformed: no `slots` key at all
  ts.assignment = { mode: "repeat", unit: { w: 2, h: 2 } };
  let result;
  assert.doesNotThrow(() => {
    result = assignedSkuId(ts, { i: 0, j: 0 });
  });
  assert.equal(result, "A");
});

test("solveTileLayout: no assignment at all — layout.warnings is []", () => {
  const ts = mintTileSetup();
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const { warnings } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
  assert.deepEqual(warnings, []);
});

test("solveTileLayout: degenerate ring — warnings is [] on the empty-layout path too", () => {
  const ts = mintTileSetup();
  const { warnings, classified } = solveTileLayout({ tile_setup: ts, ring_ft: [] });
  assert.deepEqual(classified, []);
  assert.deepEqual(warnings, []);
});

// ── offset.ts floored-mod rowShift fix (carried Task-4 review finding) ──

// n = round(1/fraction): brick_50 (fraction 0.5) has n=2, so j=-1 and j=1 are
// the same phase; brick_33 (fraction 1/3) has n=3, so j=-1 and j=2 are.
// Commit message claims the fix for both offset patterns — cover both.
for (const [pattern, negJ, posJ, n] of [["brick_50", -1, 1, 2], ["brick_33", -1, 2, 3]] as const) {
  test(`${pattern}: a negative-j row's floored-mod rowShift matches its positive-row phase-equivalent, so shared cx keeps the same cell.i (and thus slotKey)`, () => {
    const g = getPattern(pattern);
    const bounds = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    const quads = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
    const unit = { w: n, h: n };
    const rowNeg = quads.filter((q) => q.cell?.j === negJ);
    const rowPos = quads.filter((q) => q.cell?.j === posJ);
    assert.ok(rowNeg.length > 0 && rowPos.length > 0);
    const posByCx = new Map(rowPos.map((q) => [Math.round(q.cx * 1e6), q]));
    let matched = 0;
    for (const q of rowNeg) {
      const twin = posByCx.get(Math.round(q.cx * 1e6));
      if (!twin) continue;
      matched++;
      assert.equal(q.cell!.i, twin.cell!.i, `same cx=${q.cx} must share cell.i across phase-equal rows j=${negJ},j=${posJ}`);
      assert.equal(slotKey(q.cell!, unit), slotKey(twin.cell!, unit));
    }
    assert.ok(matched > 0, `expected overlapping cx between row j=${negJ} and row j=${posJ}`);
  });
}
