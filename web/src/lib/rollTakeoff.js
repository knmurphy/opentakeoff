// Roll-goods takeoff wiring (#136) — the pure bridge between the canvas's
// shape/condition model and lib/rollgoods.js (the packing engine). The engine
// speaks polygon rings in FEET; the app stores verts normalized to a sheet's
// bitmap. This module owns that conversion plus everything derivable without
// React or the DOM: per-condition layouts, the per-sheet cut rectangles the
// overlay draws, the per-shape override plumbing, and the report rows the
// Report table / CSV / opentakeoff.report.v1 consume. Keep it pure — the same
// math must serve the canvas and any headless consumer.
//
// Opt-in contract (the engine's own header states it): OpenTakeoff conditions
// are trade-agnostic, so roll goods is a `roll_setup` object ON the condition
// — presence is the opt-in — carrying `material` (carpet | sheet_vinyl |
// rubber) for color/defaults plus the engine's spec fields. Manual per-cut
// edits live on the SHAPE as `roll_layout: { laneCount, lanes: { [laneIndex]:
// { runMin, runMax, seq? } } }` — keyed by lane so a reshaped room (lane count
// changed) drops its stale overrides via the engine's own laneCount guard.
import {
  isRollType, defaultRollSetup, computeRollLayout, rollLayoutOrderLengthFt,
  rollLayoutRollCount, rollCutNumbers, rollQtyForUnit, roundUpToInch,
  seamLfBySrc, seamLfForStrips, seamSegmentsBySrc, clipRingToLaneSlab, rollColorForType,
} from "./rollgoods.js";
import { ROLL_BAND_EPS_FT, ROLL_SEAM_HALF_FT } from "./scene3d.js";
import { round2 } from "./num.js";

// A condition is roll goods iff it carries a usable roll_setup. Corrupt
// payloads (roll_setup an array/string, width missing) read as opted OUT —
// the same defensive posture as spec/attrs sanitizing, without a hydrate pass.
export function hasRollSetup(c) {
  const rs = c?.roll_setup;
  return !!rs && typeof rs === "object" && !Array.isArray(rs) && Number(rs.roll_width_ft) > 0;
}

// Fresh setup for the opt-in select — the engine's defaults plus the material
// class the overlay colors by.
export function mintRollSetup(material) {
  const ft = isRollType(material) ? material : "carpet";
  return { material: ft, ...defaultRollSetup(ft) };
}

// roll_setup → the engine's config object, every field coerced. doorway
// overage rides along for forward-compat but stays inert until door edges
// exist on shapes (hasDoorAtEdge is never supplied — deliberately no UI knob
// for a field that would silently do nothing).
export function rollConfig(rs) {
  return {
    rollWidthFt: Math.max(0.5, Number(rs.roll_width_ft) || 12),
    rollLengthFt: Math.max(0, Number(rs.roll_length_ft) || 0),
    seamAllowanceIn: Math.max(0, Number(rs.seam_allowance_in) || 0),
    wallOverageIn: Math.max(0, Number(rs.wall_overage_in) || 0),
    doorwayOverageIn: Math.max(0, Number(rs.doorway_overage_in) || 0),
    direction: rs.direction === "ns" || rs.direction === "ew" ? rs.direction : "auto",
  };
}

// Manual per-cut overrides, flattened off every shape into the engine's
// { "<shapeId>:<laneIndex>": { runMin, runMax, seq, laneCount } } map. The
// laneCount guard is applied by the ENGINE (applyStripOverrides /
// seqFromOverrides) — this just collects.
export function collectRollOverrides(shapes) {
  const out = {};
  for (const s of shapes) {
    const rl = s.roll_layout;
    if (!rl || typeof rl !== "object" || !rl.lanes || typeof rl.lanes !== "object") continue;
    for (const [li, o] of Object.entries(rl.lanes)) {
      if (!o || typeof o !== "object") continue;
      out[`${s.id}:${li}`] = { ...o, laneCount: rl.laneCount };
    }
  }
  return out;
}

// The length/width of one strip's physical cut piece, in feet.
export const stripLenFt = (s) => Math.max(0, s.runMax - s.runMin);
export const stripWidthFt = (s) => Math.max(0, s.laneMax - s.laneMin);

// One strip's floor rectangle in SHEET PX — the overlay's frame. laneAxis "x"
// (direction ns) tiles lanes across x and runs along y; "ew" the reverse.
export function stripSheetRect(strip, upp) {
  if (!(upp > 0)) return null;
  const lane0 = strip.laneMin / upp, lane1 = strip.laneMax / upp;
  const run0 = strip.runMin / upp, run1 = strip.runMax / upp;
  return strip.laneAxis === "x"
    ? { x: lane0, y: run0, w: lane1 - lane0, h: run1 - run0 }
    : { x: run0, y: lane0, w: run1 - run0, h: lane1 - lane0 };
}

// ── the whole takeoff, figured ──────────────────────────────────────────────
// computeRollTakeoff(conditions, shapes, dimsFor, uppFor) →
//   { byCond: Map(condition_id → summary), cutsBySheet: Map(sheet_id → cut[]),
//     ringsBySrc: Map(shape_id → ring[{x,y}...] in sheet FEET) }
//
// dimsFor(sheetId) → {w,h}|null (bitmap px), uppFor(sheetId) → feet-per-px|null.
// Shapes on unscaled/unrendered sheets are skipped — a ring needs real feet.
// Only floor_area shapes participate: a roll cut is a floor piece. Interior
// holes (verts_norm_holes) deliberately do NOT shorten cuts — material runs
// past a column and the cut piece is still full length; the hole nets out of
// the AREA quantities, not the roll.
//
// summary: { material, config, direction, strips, nums, orderFt, rollCount,
//            oversize, qty, unit, cutCount, seamLf, seamByShape }
//   orderFt is roundUpToInch'd (you order to the inch) and PER UNIT — the
//   condition ×N multiplier applies at the report seam like every quantity.
//   seamLf is the figured weld-rod / seam-tape length for the whole condition
//   and seamByShape is the same rule kept per source shape (rollgoods
//   seamLfBySrc), so a per-sheet or per-room slice of the takeoff can total
//   its OWN seams instead of inheriting the condition's.
export function computeRollTakeoff(conditions, shapes, dimsFor, uppFor) {
  const byCond = new Map();
  const cutsBySheet = new Map();
  const ringsBySrc = new Map();
  const rollConds = (conditions || []).filter(hasRollSetup);
  if (!rollConds.length) return { byCond, cutsBySheet, ringsBySrc };
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  for (const c of rollConds) {
    const rs = c.roll_setup;
    const config = rollConfig(rs);
    const items = [];
    for (const s of shapes) {
      if (s.condition_id !== c.id || s.measure_role !== "floor_area") continue;
      if (!Array.isArray(s.verts_norm) || s.verts_norm.length < 3) continue;
      const dims = dimsFor(s.sheet_id), upp = uppFor(s.sheet_id);
      if (!dims || !(dims.w > 0) || !(upp > 0)) continue;
      const ring = s.verts_norm.map(([nx, ny]) => ({ x: nx * dims.w * upp, y: ny * dims.h * upp }));
      items.push({ id: s.id, name: s.label || "", ring });
      ringsBySrc.set(s.id, ring);
    }
    if (!items.length) continue;
    const layout = computeRollLayout(items, config, collectRollOverrides(shapes));
    const nums = rollCutNumbers(layout.strips);
    const orderFt = roundUpToInch(rollLayoutOrderLengthFt(layout.strips));
    const material = isRollType(rs.material) ? rs.material : "carpet";
    const unit = rs.price_unit === "lf" || rs.price_unit === "sf" || rs.price_unit === "sy" ? rs.price_unit : "sf";
    byCond.set(c.id, {
      material, config, direction: layout.direction, strips: layout.strips, nums,
      orderFt, rollCount: rollLayoutRollCount(layout.strips),
      oversize: layout.strips.some((s) => s.overRoll),
      qty: round2(rollQtyForUnit(orderFt, config.rollWidthFt, unit)), unit,
      cutCount: layout.strips.length,
      seamLf: seamLfForStrips(layout.strips), seamByShape: seamLfBySrc(layout.strips),
    });
    for (const strip of layout.strips) {
      const src = shapeById.get(strip.srcId);
      if (!src) continue;
      const upp = uppFor(src.sheet_id);
      const rect = stripSheetRect(strip, upp);
      if (!rect) continue;
      if (!cutsBySheet.has(src.sheet_id)) cutsBySheet.set(src.sheet_id, []);
      cutsBySheet.get(src.sheet_id).push({
        id: strip.id, srcId: strip.srcId, condId: c.id,
        laneIndex: strip.laneIndex, laneCount: strip.laneCount, laneAxis: strip.laneAxis,
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        runMin: strip.runMin, runMax: strip.runMax, upp,
        lenFt: stripLenFt(strip), widthFt: stripWidthFt(strip),
        num: nums.get(strip.id) || 0, overRoll: !!strip.overRoll,
        multi: strip.laneCount > 1, material,
      });
    }
  }
  return { byCond, cutsBySheet, ringsBySrc };
}

// ── report seam ─────────────────────────────────────────────────────────────
// The additive roll_goods block for opentakeoff.report.v1 (and the ctx the
// Report's roll columns read). rows = conditionTotals output — finish_tag and
// multiplier come from there so the block can never disagree with the table.
// ×N applies here, the same convention as every other reported quantity: N
// identical units are N cuttings of the same layout.
export function rollReportRows(rollByCond, rows) {
  if (!rollByCond || !rollByCond.size || !Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const ri = rollByCond.get(r.id);
    if (!ri) continue;
    const mult = r.multiplier || 1;
    out.push({
      condition_id: r.id, finish_tag: r.finish_tag, material: ri.material,
      roll_width_ft: ri.config.rollWidthFt, roll_length_ft: ri.config.rollLengthFt,
      direction: ri.direction, cuts: ri.cutCount,
      order_lf: round2(ri.orderFt * mult), rolls: ri.rollCount * mult,
      order_qty: round2(ri.qty * mult), order_unit: ri.unit,
      oversize: ri.oversize,
      // seam_lf APPENDS last (the additive-only convention the roll_goods
      // block already follows): the figured weld-rod / seam-tape length, ×N
      // like every other reported quantity. 0 is a real answer — a layout
      // whose rooms each fit one strip has no seams to weld.
      seam_lf: round2((ri.seamLf || 0) * mult),
    });
  }
  return out;
}

// Per-SHAPE figured seam LF across every roll-goods condition —
// computeRollTakeoff's summaries re-keyed by shape id, which is what a
// materials row with basis "seam_lf" divides against (web/src/lib/totals.js).
// Per shape rather than per condition on purpose: the report's group-by-sheet
// and group-by-room slices run the SAME conditionTotals over a subset of
// shapes, and a condition-level figure handed to a slice would report the
// whole project's welding on every page of it.
export function seamLfByShape(rollByCond) {
  const out = new Map();
  if (!rollByCond || typeof rollByCond.forEach !== "function") return out;
  rollByCond.forEach((ri) => {
    if (!ri || !(ri.seamByShape instanceof Map)) return;
    ri.seamByShape.forEach((lf, shapeId) => out.set(shapeId, (out.get(shapeId) || 0) + lf));
  });
  return out;
}

// ── rolls payload builder (3D lane bands + seams) ───────────────────────────
// buildRollBands(entries, ringBySrc, slabZBySrc) → {bands, seams} — the pure
// join of the figured layout onto the BUILT 3D slabs (spec addendum r3 rev
// 3). entries = [{condId, tag, material, strips}], one per roll-goods
// condition (rollTakeoff.byCond, joined by the caller's memo). ringBySrc and
// slabZBySrc are keyed by shape/srcId — ringBySrc from this module's own
// ringsBySrc (the exact feet ring the layout used), slabZBySrc from the
// caller's built slabs (condition thickness_in/12, nominal fallback). A strip
// whose srcId has no slabZBySrc entry emits NOTHING — no band/seam without a
// built slab (a room on another sheet, or a slab that failed to build).
//
// Bands: the COVERAGE polygon per lane — clipRingToLaneSlab (the engine's own
// footprint clip) against the lane's [coverMin, coverMax] AND the strip's
// de-overaged run interval, so a concave room notches correctly instead of
// striping over floor that isn't there. PARITY: odd laneIndex bands; a
// single-lane room (laneCount === 1) bands its one lane (nothing to
// alternate against). z sits eps above the owning slab's top, joined by
// srcId. Fill is the roll MATERIAL palette (rollColorForType) — never the
// condition color (an opaque slab under an equal-color band is invisible).
//
// Seams: from seamSegmentsBySrc (single source of truth for "where lanes
// meet"), each interior coverage boundary → a thin ROLL_SEAM_HALF_FT-wide
// strip, footprint-clipped the same way and run-clamped to the segment's
// overlap — so a seam bridging a concave notch clips to the room rather than
// drawing ink across the void (disclosed: drawn length can then read shorter
// than the priced seamLfBySrc figure, which prices the bridged bounds).
export function buildRollBands(entries, ringBySrc, slabZBySrc) {
  const bands = [], seams = [];
  const slabZFor = (srcId) => (slabZBySrc && typeof slabZBySrc.get === "function" ? slabZBySrc.get(srcId) : undefined);
  const ringFor = (srcId) => (ringBySrc && typeof ringBySrc.get === "function" ? ringBySrc.get(srcId) : undefined);

  for (const entry of entries || []) {
    const { condId, tag, material, strips } = entry || {};
    const fill = rollColorForType(material);
    for (const strip of strips || []) {
      const slabZ = slabZFor(strip.srcId);
      if (!(slabZ != null)) continue;                    // no band without a built slab
      const laneCount = strip.laneCount || 1;
      if (!(laneCount === 1 || (strip.laneIndex || 0) % 2 === 1)) continue; // parity, single-lane exception
      const ring = ringFor(strip.srcId);
      if (!ring) continue;
      const runLo = strip.runMin + (strip.minOverageFt || 0);
      const runHi = strip.runMax - (strip.maxOverageFt || 0);
      if (!(runHi > runLo)) continue;
      const laneAxis = strip.laneAxis;
      const runAxis = laneAxis === "x" ? "y" : "x";
      const poly = clipRingToLaneSlab(
        clipRingToLaneSlab(ring, laneAxis, strip.coverMin, strip.coverMax),
        runAxis, runLo, runHi
      );
      if (poly.length < 3) continue;
      bands.push({ poly, z: slabZ + ROLL_BAND_EPS_FT, fill, tag, shapeId: strip.srcId, condId, laneIndex: strip.laneIndex });
    }

    const segByShape = seamSegmentsBySrc(strips);
    for (const [srcId, segs] of segByShape) {
      const slabZ = slabZFor(srcId);
      if (!(slabZ != null)) continue;                    // no seam without a built slab
      const ring = ringFor(srcId);
      if (!ring) continue;
      for (const seg of segs) {
        const runAxis = seg.laneAxis === "x" ? "y" : "x";
        const poly = clipRingToLaneSlab(
          clipRingToLaneSlab(ring, seg.laneAxis, seg.boundary - ROLL_SEAM_HALF_FT, seg.boundary + ROLL_SEAM_HALF_FT),
          runAxis, seg.runLo, seg.runHi
        );
        if (poly.length < 3) continue;
        seams.push({ poly, z: slabZ + ROLL_BAND_EPS_FT, tag, shapeId: srcId, condId });
      }
    }
  }
  return { bands, seams };
}
