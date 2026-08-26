// web/test/tilePatterns.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPattern, registry, layoutWarning } from "../src/lib/tilePatterns/index.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

test("grid is registered", () => {
  assert.ok(registry.has("grid"));
});

test("grid tiles cover the bounds on a pitch lattice, deterministically", () => {
  const g = getPattern("grid");
  const input = { bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
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
  const base = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  const shifted = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0.5, 0], rotation_deg: 0, skuId: "s1" });
  const minBase = Math.min(...base.map((q) => q.cx));
  const minShift = Math.min(...shifted.map((q) => q.cx));
  assert.ok(Math.abs((minShift - minBase) - 0.5) < 1e-9 || Math.abs((minShift - minBase) + 0.5) < 1e-9);
});

test("brick_50 offsets every other row by half a pitch", () => {
  const g = getPattern("brick_50");
  const a = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  // group by row (cy); adjacent rows' cx sets differ by ~0.5 pitch
  const byRow = new Map<number, number[]>();
  for (const q of a) { const k = Math.round(q.cy * 1e6); (byRow.get(k) ?? byRow.set(k, []).get(k)!).push(q.cx); }
  const rows = [...byRow.entries()].sort((p, n) => p[0] - n[0]).map(([, xs]) => Math.min(...xs));
  assert.ok(Math.abs(Math.abs(rows[1] - rows[0]) % 1 - 0.5) < 1e-9);
});

test("diagonal quads are rotated 45°", () => {
  const g = getPattern("diagonal");
  const a = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  assert.ok(a.length > 0);
  assert.ok(a.every((q) => Math.abs(q.rot - Math.PI / 4) < 1e-9));
});

test("grid honors rotation_deg: every quad's rot is the angle in radians", () => {
  const g = getPattern("grid");
  const input = { bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 30, skuId: "s1" };
  const a = g.generate(input);
  assert.ok(a.length > 0);
  const expected = 30 * Math.PI / 180;
  assert.ok(a.every((q) => Math.abs(q.rot - expected) < 1e-9));
});

test("grid rotation_deg:0 stays byte-identical to the unrotated lattice", () => {
  const g = getPattern("grid");
  const input = { bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
  const a = g.generate(input);
  assert.ok(a.every((q) => q.rot === 0));
  // pin two known quad centers computed directly from the (unrotated) lattice formula
  assert.ok(a.some((q) => Math.abs(q.cx - 0.5) < 1e-9 && Math.abs(q.cy - 0.5) < 1e-9));
  assert.ok(a.some((q) => Math.abs(q.cx - 9.5) < 1e-9 && Math.abs(q.cy - 9.5) < 1e-9));
});

test("grid rotation still covers every corner of the room ring", () => {
  const g = getPattern("grid");
  const unrotated = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" });
  const rotated = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 30, skuId: "s1" });
  assert.ok(rotated.length >= unrotated.length, "expanded/rotated lattice must not shrink the coverage");
  const corners: [number, number][] = [[0, 0], [10, 0], [0, 10], [10, 10]];
  for (const [px, py] of corners) {
    const covered = rotated.some((q) => Math.abs(q.cx - px) <= 1 && Math.abs(q.cy - py) <= 1);
    assert.ok(covered, `no quad near corner (${px},${py})`);
  }
});

test("brick_50 honors rotation_deg", () => {
  const g = getPattern("brick_50");
  const a = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 30, skuId: "s1" });
  assert.ok(a.length > 0);
  const expected = 30 * Math.PI / 180;
  assert.ok(a.every((q) => Math.abs(q.rot - expected) < 1e-9));
});

test("brick_50 rotation_deg:0 stays byte-identical to the unrotated offset lattice", () => {
  const g = getPattern("brick_50");
  const input = { bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
  const a = g.generate(input);
  assert.ok(a.every((q) => q.rot === 0));
});

test("diagonal honors an explicit rotation_deg override", () => {
  const g = getPattern("diagonal");
  const a = g.generate({ bounds, w_ft: 1, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 30, skuId: "s1" });
  assert.ok(a.length > 0);
  const expected = 30 * Math.PI / 180;
  assert.ok(a.every((q) => Math.abs(q.rot - expected) < 1e-9));
});

test("herringbone places interlocking rotated pairs covering the bounds", () => {
  const g = getPattern("herringbone");
  const input = { bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
  const a = g.generate(input);
  const b = g.generate(input);
  assert.deepEqual(a, b);                       // deterministic
  assert.ok(a.length > 0);
  // both axis-aligned orientations present (0 and π/2)
  const rots = new Set(a.map((q) => Math.round(q.rot * 1e6)));
  assert.equal(rots.size, 2);
});

test("herringbone ignores origin translation when rotation_deg is 0 (interlock-derived, §3.1)", () => {
  const g = getPattern("herringbone");
  const base = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  const shifted = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [5, 5], rotation_deg: 0, skuId: "s1" });
  assert.deepEqual(base, shifted);
});

test("herringbone honors rotation_deg via whole-pattern rotation about origin", () => {
  const g = getPattern("herringbone");
  const base = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" });
  const rotated = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 90, skuId: "s1" });
  assert.ok(rotated.length > 0);
  assert.notDeepEqual(base, rotated);
  // base carries {0, pi/2}; rotating the whole pattern by 90deg shifts both by pi/2
  const rots = [...new Set(rotated.map((q) => Math.round(q.rot * 1e6)))].sort((p, n) => p - n);
  assert.deepEqual(rots, [Math.round((Math.PI / 2) * 1e6), Math.round(Math.PI * 1e6)]);
});

test("basketweave alternates horizontal/vertical pairs", () => {
  const g = getPattern("basketweave");
  const input = { bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" };
  const a = g.generate(input);
  const b = g.generate(input);
  assert.deepEqual(a, b);                       // deterministic
  assert.ok(a.length > 0);
  const rots = new Set(a.map((q) => Math.round(q.rot * 1e6)));
  assert.equal(rots.size, 2); // 0 and π/2
});

test("basketweave ignores origin translation when rotation_deg is 0 (interlock-derived, §3.1)", () => {
  const g = getPattern("basketweave");
  const base = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0], rotation_deg: 0, skuId: "s1" });
  const shifted = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [5, 5], rotation_deg: 0, skuId: "s1" });
  assert.deepEqual(base, shifted);
});

test("basketweave honors rotation_deg via whole-pattern rotation about origin", () => {
  const g = getPattern("basketweave");
  const base = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 0, skuId: "s1" });
  const rotated = g.generate({ bounds, w_ft: 2, h_ft: 1, joint_ft: 0, origin: [0, 0] as [number, number], rotation_deg: 90, skuId: "s1" });
  assert.ok(rotated.length > 0);
  assert.notDeepEqual(base, rotated);
  const rots = [...new Set(rotated.map((q) => Math.round(q.rot * 1e6)))].sort((p, n) => p - n);
  assert.deepEqual(rots, [Math.round((Math.PI / 2) * 1e6), Math.round(Math.PI * 1e6)]);
});

test("herringbone warns for non-2:1 tiles", () => {
  assert.ok(layoutWarning({ pattern: "herringbone", skus: [{ w_in: 12, h_in: 12 }] }));
  assert.equal(layoutWarning({ pattern: "herringbone", skus: [{ w_in: 24, h_in: 12 }] }), null);
  assert.equal(layoutWarning({ pattern: "grid", skus: [{ w_in: 12, h_in: 12 }] }), null);
});

// ── area-conservation (P1 coverage-bug regression) ──────────────────────
//
// The real contract a rotated lattice must honor: rotating the grid must
// NOT change how much of the room gets tiled. A lattice generated over a
// region that fully covers the room (in the lattice's own unrotated frame,
// pre-+angle rotation) always partitions the room into disjoint kept
// pieces — so summing every generated quad's `areaKept_sf` (classify.ts)
// must reproduce the room's own area, at every rotation angle, regardless
// of where `origin` sits. This is strictly stronger than "a quad exists
// near each corner" (the old, too-weak test): a lattice can graze all 4
// corners while leaving most of the room's INTERIOR uncovered — exactly
// what the grow-by-diagonal/pivot-off-center bug did (a 2,577.8 SF room,
// 12x24in grid rotated 45°, origin at the room's own corner: order dropped
// from 1542 tiles to 434, ~25% coverage, while corner quads still existed).
function areaConservationCheck(
  patternName: "grid" | "brick_50" | "brick_33" | "diagonal" | "herringbone" | "basketweave",
  ring: [number, number][],
  origin: [number, number],
  label: string,
): void {
  const ts = mintTileSetup();
  ts.pattern = patternName;
  ts.skus[0].w_in = 12; ts.skus[0].h_in = 24; ts.joint.width_in = 0.125;
  ts.origin = origin;
  const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y);
  const roomArea_sf = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const faceArea_sf = (12 / 12) * (24 / 12);
  const naiveCount = roomArea_sf / faceArea_sf;
  for (const deg of [0, 15, 30, 45, 60, 90]) {
    ts.rotation_deg = deg;
    const { quads, classified } = solveTileLayout({ tile_setup: ts, ring_ft: ring });
    const keptArea_sf = classified.reduce((sum, c) => sum + c.areaKept_sf, 0);
    const coverageRatio = keptArea_sf / roomArea_sf;
    assert.ok(
      Math.abs(coverageRatio - 1) < 0.02,
      `${label} θ=${deg}°: kept ${keptArea_sf.toFixed(1)} sf of ${roomArea_sf} sf room ` +
        `(coverage ratio ${coverageRatio.toFixed(3)}, expected ~1.0)`,
    );
    // rotating must not collapse the order to a fraction of the naive
    // lattice count (the 1542→434 regression this bug produced)
    assert.ok(
      quads.length > naiveCount * 0.5,
      `${label} θ=${deg}°: only ${quads.length} quads generated, naive estimate ~${Math.round(naiveCount)}`,
    );
  }
}

// A room living at realistic PLAN coordinates, far from the world/plan
// origin [0,0] that mintTileSetup uses as the default tile-lattice origin
// — the actual repro geometry (a 60x43ft / 2,580 SF room, matching the
// browser-verified 2,577.8 SF report) that collapsed rotated coverage to
// ~25% under the old grow-by-diagonal helper.
const farRoomRing: [number, number][] = [[500, 300], [560, 300], [560, 343], [500, 343]];

test("rotated grid conserves room area with origin far from the room (the failing case)", () => {
  areaConservationCheck("grid", farRoomRing, [0, 0], "grid far-origin");
});

test("rotated grid conserves room area at an origin off-center within the room", () => {
  areaConservationCheck("grid", farRoomRing, [510, 305], "grid off-center-origin");
});

test("rotated brick_50 conserves room area with origin far from the room", () => {
  areaConservationCheck("brick_50", farRoomRing, [0, 0], "brick_50 far-origin");
});

test("rotated diagonal conserves room area with origin far from the room", () => {
  areaConservationCheck("diagonal", farRoomRing, [0, 0], "diagonal far-origin");
});

test("rotated herringbone conserves room area with origin far from the room", () => {
  areaConservationCheck("herringbone", farRoomRing, [0, 0], "herringbone far-origin");
});

test("rotated basketweave conserves room area with origin far from the room", () => {
  areaConservationCheck("basketweave", farRoomRing, [0, 0], "basketweave far-origin");
});
