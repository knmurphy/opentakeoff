// Roll-goods wiring (lib/rollTakeoff.js, #136) — the pure bridge between the
// shape/condition model and the packing engine. The invariants:
//   - opt-in is roll_setup PRESENCE (corrupt setups read as opted out);
//   - rings convert verts_norm → feet through the sheet's dims × upp, and
//     shapes on unscaled/unrendered sheets are skipped, never guessed;
//   - overrides collect off shape.roll_layout keyed "<shapeId>:<laneIndex>"
//     with the parent's laneCount (the engine's stale-override guard reads it);
//   - the overlay rects land in SHEET PX on the right axes for both run
//     directions;
//   - report rows apply ×N (the house convention for every quantity) and
//     stay quantities-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasRollSetup, mintRollSetup, rollConfig, collectRollOverrides,
  computeRollTakeoff, rollReportRows, stripSheetRect, buildRollBands,
} from "../src/lib/rollTakeoff.js";
import { conditionTotals } from "../src/lib/totals.js";
import { ROLL_BAND_EPS_FT, ROLL_SEAM_HALF_FT } from "../src/lib/scene3d.js";

// A 20×14-ft room drawn on a 1000×1000-px sheet at upp = 0.05 ft/px:
// 20 ft = 400 px wide (x), 14 ft = 280 px tall (y), anchored at (100, 100) px.
const UPP = 0.05;
const DIMS = { w: 1000, h: 1000 };
const room = (id: string, condId: string) => ({
  id, condition_id: condId, sheet_id: "s1", measure_role: "floor_area",
  verts_norm: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.38], [0.1, 0.38]],
  computed: { area_sf: 280, perimeter_lf: 68 },
});
const dimsFor = (k: string) => (k === "s1" ? DIMS : null);
const uppFor = (k: string) => (k === "s1" ? UPP : null);

test("opt-in is roll_setup presence; corrupt setups read as opted out", () => {
  assert.equal(hasRollSetup({ roll_setup: mintRollSetup("carpet") }), true);
  assert.equal(hasRollSetup({}), false);
  assert.equal(hasRollSetup({ roll_setup: "corrupt" }), false);
  assert.equal(hasRollSetup({ roll_setup: ["x"] }), false);
  assert.equal(hasRollSetup({ roll_setup: { roll_width_ft: 0 } }), false);
});

test("mintRollSetup: engine defaults + the material class; carpet sells by SY, resilient by SF", () => {
  const c = mintRollSetup("carpet");
  assert.deepEqual({ m: c.material, w: c.roll_width_ft, u: c.price_unit }, { m: "carpet", w: 12, u: "sy" });
  assert.equal(mintRollSetup("sheet_vinyl").price_unit, "sf");
  assert.equal(mintRollSetup("nonsense").material, "carpet", "unknown class falls back, never throws");
});

test("rollConfig coerces every field and clamps direction to the engine's vocabulary", () => {
  const cfg = rollConfig({ roll_width_ft: "12", seam_allowance_in: -3, wall_overage_in: null, direction: "diagonal" });
  assert.deepEqual(cfg, { rollWidthFt: 12, rollLengthFt: 0, seamAllowanceIn: 0, wallOverageIn: 0, doorwayOverageIn: 0, direction: "auto" });
});

test("computeRollTakeoff: a 20×14 room on a 12-ft roll figures 2 lanes and a to-scale overlay", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } }];
  const shapes = [room("r1", "cpt")];
  const { byCond, cutsBySheet } = computeRollTakeoff(conds, shapes, dimsFor, uppFor);
  const ri = byCond.get("cpt");
  assert.ok(ri, "the opted-in condition figures");
  assert.equal(ri.direction, "ns");
  assert.equal(ri.cutCount, 2, "20 ft across a 12-ft roll = 2 lanes");
  // each N–S cut runs the room's 14-ft height + 3″ wall overage per end
  const lens = ri.strips.map((s: any) => s.runMax - s.runMin);
  for (const ln of lens) assert.ok(Math.abs(ln - 14.5) < 1e-9, `cut length ${ln} = 14 + 2×0.25 wall overage`);
  // order footage: two cuts side-by-side won't fit one 12-ft width — they
  // stack down the roll: 2 × 14.5 = 29 ft, rounded up to the inch
  assert.ok(Math.abs(ri.orderFt - 29) < 1e-9, `orderFt ${ri.orderFt}`);
  assert.equal(ri.rollCount, 1, "no max roll length = one continuous roll");
  assert.ok(Math.abs(ri.qty - (29 * 12) / 9) < 0.01, "SY = orderFt × width ÷ 9");
  // overlay rects: sheet px, lanes tiling across x (ns), full-lane cut 12 ft
  // wide draws at the TRUE roll width incl. allowances, not the coverage split
  const cuts = cutsBySheet.get("s1");
  assert.equal(cuts.length, 2);
  const c0 = cuts.find((c: any) => c.laneIndex === 0);
  assert.ok(Math.abs(c0.h - 14.5 / UPP) < 1e-6, "run extent in sheet px");
  assert.ok(c0.multi && c0.laneCount === 2, "a seamed room's cuts read as multi");
  assert.ok(cuts.every((c: any) => c.num >= 1 && c.num <= 2), "numbered in cutting order");
});

test("computeRollTakeoff: unscaled sheets and non-floor shapes are skipped, never guessed", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: mintRollSetup("carpet") }];
  const offSheet = { ...room("r2", "cpt"), sheet_id: "unrendered" };
  const linear = { ...room("r3", "cpt"), measure_role: "linear" };
  const { byCond } = computeRollTakeoff(conds, [offSheet, linear], dimsFor, uppFor);
  assert.equal(byCond.size, 0, "nothing figured — no ring can speak feet");
});

test("collectRollOverrides flattens lanes with the parent laneCount; corrupt layouts are ignored", () => {
  const shapes = [
    { id: "a", roll_layout: { laneCount: 2, lanes: { 0: { runMin: 1, runMax: 9 }, 1: { seq: 3 } } } },
    { id: "b", roll_layout: "corrupt" },
    { id: "c" },
  ];
  assert.deepEqual(collectRollOverrides(shapes), {
    "a:0": { runMin: 1, runMax: 9, laneCount: 2 },
    "a:1": { seq: 3, laneCount: 2 },
  });
});

test("a manual run override rides into the figured layout (and the engine's laneCount guard drops stale ones)", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } }];
  const withOverride = [{ ...room("r1", "cpt"), roll_layout: { laneCount: 2, lanes: { 0: { runMin: 4, runMax: 20 } } } }];
  const ri = computeRollTakeoff(conds, withOverride, dimsFor, uppFor).byCond.get("cpt");
  const lane0 = ri.strips.find((s: any) => s.laneIndex === 0);
  assert.deepEqual({ min: lane0.runMin, max: lane0.runMax }, { min: 4, max: 20 }, "override applied");
  const stale = [{ ...room("r1", "cpt"), roll_layout: { laneCount: 5, lanes: { 0: { runMin: 4, runMax: 20 } } } }];
  const ri2 = computeRollTakeoff(conds, stale, dimsFor, uppFor).byCond.get("cpt");
  const lane0b = ri2.strips.find((s: any) => s.laneIndex === 0);
  assert.ok(Math.abs((lane0b.runMax - lane0b.runMin) - 14.5) < 1e-9, "a laneCount mismatch (reshaped room) drops the override");
});

test("stripSheetRect maps both run directions onto the right screen axes", () => {
  const ns = stripSheetRect({ laneAxis: "x", laneMin: 5, laneMax: 17, runMin: 5, runMax: 19 }, UPP);
  assert.deepEqual(ns, { x: 100, y: 100, w: 240, h: 280 });
  const ew = stripSheetRect({ laneAxis: "y", laneMin: 5, laneMax: 17, runMin: 5, runMax: 19 }, UPP);
  assert.deepEqual(ew, { x: 100, y: 100, w: 280, h: 240 });
  assert.equal(stripSheetRect({ laneAxis: "x", laneMin: 0, laneMax: 1, runMin: 0, runMax: 1 }, 0), null, "no upp, no rect");
});

test("rollReportRows: ×N applies like every reported quantity; only figured conditions emit; quantities-only", () => {
  const conds = [
    { id: "cpt", finish_tag: "CPT-1", multiplier: 3, roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } },
    { id: "vct", finish_tag: "VCT-1" },
  ];
  const shapes = [room("r1", "cpt"), room("r9", "vct")];
  const { byCond } = computeRollTakeoff(conds, shapes, dimsFor, uppFor);
  const rows = rollReportRows(byCond, conditionTotals(conds, shapes));
  assert.equal(rows.length, 1, "only the roll-goods condition emits a row");
  const r = rows[0];
  assert.deepEqual(
    { tag: r.finish_tag, lf: r.order_lf, rolls: r.rolls, unit: r.order_unit },
    { tag: "CPT-1", lf: 87, rolls: 3, unit: "sy" },   // 29 ft × 3 units
  );
  assert.ok(!("price" in r) && !("cost" in r), "quantities only — no dollars, ever");
  assert.deepEqual(rollReportRows(null, []), []);
});

// ── ringsBySrc threading ─────────────────────────────────────────────────────

test("computeRollTakeoff threads out ringsBySrc — the same feet ring the layout used, keyed by shape id", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: mintRollSetup("carpet") }];
  const { ringsBySrc } = computeRollTakeoff(conds, [room("r1", "cpt")], dimsFor, uppFor);
  assert.equal(ringsBySrc.size, 1);
  assert.deepEqual(ringsBySrc.get("r1"), [
    { x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 19 }, { x: 5, y: 19 },
  ]);
  assert.deepEqual([...computeRollTakeoff([], [], dimsFor, uppFor).ringsBySrc], [], "no roll conditions → an empty map, never a throw");
});

// ── buildRollBands — the rolls payload builder (spec addendum r3 rev 3) ─────

function shoelaceArea(poly: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

test("buildRollBands: parity — even laneIndex skipped, odd banded; z joined by srcId via slabZBySrc; material palette fill", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } }];
  const { byCond, ringsBySrc } = computeRollTakeoff(conds, [room("r1", "cpt")], dimsFor, uppFor);
  const ri = byCond.get("cpt");
  assert.equal(ri.strips.length, 2, "20 ft across a 12-ft roll = 2 lanes");
  const entries = [{ condId: "cpt", tag: "CPT-1", material: "carpet", strips: ri.strips }];
  const { bands } = buildRollBands(entries, ringsBySrc, new Map([["r1", 0.5]]));
  assert.equal(bands.length, 1, "only the odd lane bands — the alternating-stripe rule");
  const [band] = bands;
  assert.equal(band.laneIndex, 1);
  assert.ok(Math.abs(band.z - (0.5 + ROLL_BAND_EPS_FT)) < 1e-9, "z = owning slab z1 + eps");
  assert.deepEqual(
    { shapeId: band.shapeId, condId: band.condId, tag: band.tag, fill: band.fill },
    { shapeId: "r1", condId: "cpt", tag: "CPT-1", fill: "#c9a876" },
  );
});

test("buildRollBands: single-lane exception — laneCount===1 bands its one lane (nothing to alternate against)", () => {
  const conds = [{ id: "sv", finish_tag: "SV-1", roll_setup: { ...mintRollSetup("sheet_vinyl"), direction: "ns" } }];
  // 10 ft wide, 30 ft tall — one lane off a 12-ft roll (mirrors seamLf.test.ts's single-lane fixture)
  const shapes = [{
    id: "r2", condition_id: "sv", sheet_id: "s1", measure_role: "floor_area",
    verts_norm: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.7], [0.1, 0.7]],
    computed: { area_sf: 300, perimeter_lf: 80 },
  }];
  const { byCond, ringsBySrc } = computeRollTakeoff(conds, shapes, dimsFor, uppFor);
  const ri = byCond.get("sv");
  assert.equal(ri.strips.length, 1, "single lane");
  const entries = [{ condId: "sv", tag: "SV-1", material: "sheet_vinyl", strips: ri.strips }];
  const { bands } = buildRollBands(entries, ringsBySrc, new Map([["r2", 0]]));
  assert.equal(bands.length, 1, "single-lane exception — nothing to alternate against");
  assert.equal(bands[0].laneIndex, 0);
});

test("buildRollBands: no band/seam without a built slab — a strip whose srcId has no slabZBySrc entry emits nothing", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } }];
  const { byCond, ringsBySrc } = computeRollTakeoff(conds, [room("r1", "cpt")], dimsFor, uppFor);
  const ri = byCond.get("cpt");
  const entries = [{ condId: "cpt", tag: "CPT-1", material: "carpet", strips: ri.strips }];
  const { bands, seams } = buildRollBands(entries, ringsBySrc, new Map());
  assert.equal(bands.length, 0);
  assert.equal(seams.length, 0);
});

test("buildRollBands: seam is footprint-clipped to ~2×ROLL_SEAM_HALF_FT wide, run-clamped to the de-overaged overlap, z joined like a band", () => {
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } }];
  const { byCond, ringsBySrc } = computeRollTakeoff(conds, [room("r1", "cpt")], dimsFor, uppFor);
  const ri = byCond.get("cpt");
  const entries = [{ condId: "cpt", tag: "CPT-1", material: "carpet", strips: ri.strips }];
  const { seams } = buildRollBands(entries, ringsBySrc, new Map([["r1", 0]]));
  assert.equal(seams.length, 1, "one interior lane boundary");
  const [seam] = seams;
  const xs = seam.poly.map((p: any) => p.x), ys = seam.poly.map((p: any) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  assert.ok(Math.abs(width - 2 * ROLL_SEAM_HALF_FT) < 1e-6, `seam width ${width} ≈ 2×ROLL_SEAM_HALF_FT`);
  assert.ok(Math.abs(Math.min(...ys) - 5) < 1e-6 && Math.abs(Math.max(...ys) - 19) < 1e-6, "run-clamped to the room's own [5,19] extent");
  assert.ok(Math.abs(seam.z - (0 + ROLL_BAND_EPS_FT)) < 1e-9, "z = owning slab z1 + eps, same rule as a band");
  assert.equal(seam.shapeId, "r1");
  assert.equal(seam.condId, "cpt");
  assert.equal(seam.tag, "CPT-1");
  assert.ok(!("fill" in seam), "seams carry no fill — ink is chosen at render time from the slab's luminance");
});

test("buildRollBands: clipRingToLaneSlab footprint-clips a band — a concave notch is excised, not striped over as a plain rectangle", () => {
  // A rectangle with a rectangular notch bitten into the odd (banded) lane's
  // own x-range, mid-run (y 10–20 of 30) — a naive bounding-box band would
  // stripe straight across the notch; the footprint clip must not.
  const notchedRing = [
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 15, y: 10 },
    { x: 15, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 0, y: 30 },
  ];
  const toNorm = (p: { x: number; y: number }): [number, number] => [p.x / 50, p.y / 50];
  const notchedShape = {
    id: "notch", condition_id: "cpt", sheet_id: "s1", measure_role: "floor_area",
    verts_norm: notchedRing.map(toNorm),
    computed: { area_sf: 20 * 30 - 5 * 10, perimeter_lf: 0 },
  };
  const conds = [{ id: "cpt", finish_tag: "CPT-1", roll_setup: { ...mintRollSetup("carpet"), direction: "ns" } }];
  const { byCond, ringsBySrc } = computeRollTakeoff(conds, [notchedShape], dimsFor, uppFor);
  const ri = byCond.get("cpt");
  const lane1 = ri.strips.find((s: any) => s.laneIndex === 1);
  assert.ok(lane1, "the notched room still needs 2 lanes off a 12-ft roll");
  const entries = [{ condId: "cpt", tag: "CPT-1", material: "carpet", strips: ri.strips }];
  const { bands } = buildRollBands(entries, ringsBySrc, new Map([["notch", 0]]));
  const band = bands.find((b: any) => b.laneIndex === 1);
  assert.ok(band, "the odd lane bands");
  const area = shoelaceArea(band!.poly);
  const bboxArea = (lane1.coverMax - lane1.coverMin) * 30; // the naive (wrong) bounding rectangle
  assert.ok(area < bboxArea - 40, `clipped area ${area} must exclude the 50-sf notch (bbox ${bboxArea}), not stripe over it`);
});
