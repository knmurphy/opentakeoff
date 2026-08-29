// Wall-tiling data model (design §8): TileSetup wall fields + shape-level
// WallShapeFields, and tileLayoutSig's height-aware 3rd param. A wall's
// persisted tile layout must invalidate when its RESOLVED height changes —
// tileLayoutSig only sees `shape` + `tile_setup`, never the condition, so a
// wall's resolved height (override -> shape.height_ft -> cond.height_ft) is
// threaded in explicitly by the caller as an optional 3rd argument.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileLayoutSig, type TileLayoutShape } from "../src/lib/tileLayoutSig.js";
import { mintTileSetup, type TileSetup } from "../src/lib/tileSetup.js";

const ts = mintTileSetup();

// Typed (no `as any`) fixture — pins that TileLayoutShape itself, not just
// call-site casts, actually carries measure_role/face_side/etc.
const wallShape: TileLayoutShape = {
  verts_norm: [[0, 0], [0.1, 0], [0.1, 0.1]],
  measure_role: "surface_area",
  face_side: "left",
};

test("tileLayoutSig: changes when resolved height changes", () => {
  const a = tileLayoutSig(wallShape, ts, 8);
  const b = tileLayoutSig(wallShape, ts, 9);
  assert.notEqual(a, b);
});

test("tileLayoutSig: changes when face_side flips", () => {
  const a = tileLayoutSig(wallShape, ts, 8);
  const b = tileLayoutSig({ ...wallShape, face_side: "right" }, ts, 8);
  assert.notEqual(a, b);
});

test("tileLayoutSig: changes when wall_corner_mode changes", () => {
  const a = tileLayoutSig(wallShape, ts, 8);
  const b = tileLayoutSig(wallShape, { ...ts, wall_corner_mode: "reset" } as TileSetup, 8);
  assert.notEqual(a, b);
});

test("tileLayoutSig: changes when wall_edge_finish changes", () => {
  const a = tileLayoutSig(wallShape, ts, 8);
  const b = tileLayoutSig(wallShape, { ...ts, wall_edge_finish: "bullnose" } as TileSetup, 8);
  assert.notEqual(a, b);
});

test("tileLayoutSig: a floor shape's sig is unchanged whether the new 3rd param is omitted or explicitly undefined", () => {
  const floor: TileLayoutShape = { verts_norm: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]] };
  const omitted = tileLayoutSig(floor, ts);
  const explicitUndefined = tileLayoutSig(floor, ts, undefined);
  assert.equal(omitted, explicitUndefined);
});

// Bonus coverage for the other fields the binding ruling requires folded in.
test("tileLayoutSig: changes when endpoint_exposed changes", () => {
  const a = tileLayoutSig({ ...wallShape, endpoint_exposed: [true, false] }, ts, 8);
  const b = tileLayoutSig({ ...wallShape, endpoint_exposed: [false, false] }, ts, 8);
  assert.notEqual(a, b);
});

test("tileLayoutSig: changes when wall_corner_overrides changes", () => {
  const a = tileLayoutSig({ ...wallShape, wall_corner_overrides: { 0: { mode: "reset" } } }, ts, 8);
  const b = tileLayoutSig({ ...wallShape, wall_corner_overrides: { 0: { mode: "wrap" } } }, ts, 8);
  assert.notEqual(a, b);
});

test("tileLayoutSig: reordering wall_corner_overrides keys (insertion order) does NOT flip the sig", () => {
  const forward = { ...wallShape, wall_corner_overrides: { 0: { mode: "wrap" as const }, 1: { mode: "reset" as const } } };
  const reversedOverrides: TileLayoutShape["wall_corner_overrides"] = {};
  for (const [k, v] of Object.entries(forward.wall_corner_overrides).reverse()) reversedOverrides![Number(k)] = v;
  const backward = { ...wallShape, wall_corner_overrides: reversedOverrides };
  assert.equal(tileLayoutSig(forward, ts, 8), tileLayoutSig(backward, ts, 8));
});

test("tileLayoutSig: changes when measure_role differs (wall vs floor, same verts)", () => {
  const floorRole: TileLayoutShape = { ...wallShape, measure_role: "floor_area" };
  const a = tileLayoutSig(wallShape, ts, 8);
  const b = tileLayoutSig(floorRole, ts, 8);
  assert.notEqual(a, b);
});

test("tileLayoutSig: changes when height_override flips (same height_ft)", () => {
  const withOverride: TileLayoutShape = { ...wallShape, height_ft: 8, height_override: true };
  const withoutOverride: TileLayoutShape = { ...wallShape, height_ft: 8, height_override: false };
  const a = tileLayoutSig(withOverride, ts, 8);
  const b = tileLayoutSig(withoutOverride, ts, 8);
  assert.notEqual(a, b);
});

test("mintTileSetup: sets wall-only defaults (corner mode, edge finish)", () => {
  const minted = mintTileSetup();
  assert.equal(minted.wall_corner_mode, "wrap");
  assert.equal(minted.wall_edge_finish, "profile");
});

// Deliberate NON-default: purchase.breakage_pct is a live floor input
// (tileCalc/order.ts falls back to 0.05 when absent) and TileSetup has no
// wall/floor discriminator, so mintTileSetup must NOT default it — doing so
// would silently change every floor condition's material overage too. Wall
// overage is threaded explicitly by the wall orchestration path instead.
test("mintTileSetup: does NOT default purchase.breakage_pct (would contaminate floor conditions)", () => {
  const minted = mintTileSetup();
  assert.equal(minted.purchase, undefined);
});
