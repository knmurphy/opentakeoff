// Tile takeoff wiring (Task 7, docs/superpowers/plans/2026-08-26-tile-patterning-m3-m4.md
// §Task 7) — mirrors web/src/lib/rollTakeoff.js computeRollTakeoff/rollReportRows
// 1:1: the pure bridge between the canvas's shape/condition model and the tile
// engine (tileSolve.ts + tileCalc/*). Roll goods speaks {x,y} strip rings in
// feet; tile speaks [x,y] tuple rings (tileSolve's ring_ft) — otherwise the
// same conversion, the same condition-by-id grouping, and the same ×N
// multiplier convention (applied at the report seam, not on measured
// geometry). Keep pure — no React or DOM.
import { hasTileSetup } from "./tileSetup.ts";
import { solveTileLayout } from "./tileSolve.ts";
import { tileCounts, countsBySku } from "./tileCalc/tiles.ts";
import { tileGroutBags } from "./tileCalc/grout.ts";
import { cutSheet } from "./tileCalc/cutsheet.ts";
import { orderTiles } from "./tileCalc/order.ts";
import { layoutWarning } from "./tilePatterns/index.ts";
import { optimizeOrigin } from "./tileGeometry/optimize.ts";

export { hasTileSetup };

// verts_norm/verts_norm_holes → feet, using the shape's own bitmap dims + upp.
// Same normalization roll uses (rollTakeoff.js:118-120), just [x,y] tuples
// instead of {x,y} objects — tileSolve's ring_ft contract.
function ringFt(verts, dims, upp) {
  return verts.map(([nx, ny]) => [nx * dims.w * upp, ny * dims.h * upp]);
}

function consolidateCutRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.w_in}|${r.h_in}|${r.lShaped}|${r.corner}`;
    const existing = groups.get(key);
    if (existing) existing.count += r.count;
    else groups.set(key, { ...r });
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.w_in * b.h_in - a.w_in * a.h_in;
  });
}

function primarySku(tile_setup) {
  const usable = (s) => s && Number(s.w_in) > 0 && Number(s.h_in) > 0;
  return (tile_setup.skus || []).find(usable) ?? tile_setup.skus?.[0];
}

// One shape's figured tile summary — the classify+count+grout+order+cutsheet
// bundle every downstream consumer (report row, per-sheet overlay) reads.
function summarizeShape(tile_setup, ring_ft, holes_ft) {
  let solveSetup = tile_setup;
  if (tile_setup.edge_strategy === "balanced") {
    const { origin } = optimizeOrigin({ tile_setup, ring_ft, holes_ft });
    solveSetup = { ...tile_setup, origin };
  }
  const { classified } = solveTileLayout({ tile_setup: solveSetup, ring_ft, holes_ft });
  const counts = tileCounts(classified);
  const bySku = countsBySku(classified);
  const grout = tileGroutBags({ tile_setup, keptArea_sf: counts.keptArea_sf });
  const cutsheet = cutSheet(classified);
  const order = orderTiles({
    safeCount: counts.safe,
    sku: primarySku(tile_setup),
    breakage_pct: tile_setup.purchase?.breakage_pct,
    attic_pct: tile_setup.purchase?.attic_pct,
  });
  const warnings = [layoutWarning(tile_setup)].filter(Boolean);
  return { counts, bySku, grout, cutsheet, order, warnings };
}

// ── the whole takeoff, figured ──────────────────────────────────────────────
// computeTileTakeoff(conditions, shapes, dimsFor, uppFor) →
//   { byCond: Map(condition_id → summary), byShape: Map(shape_id → summary) }
//
// dimsFor(sheetId) → {w,h}|null (bitmap px), uppFor(sheetId) → feet-per-px|null.
// Shapes on unscaled/unrendered sheets are skipped — a ring needs real feet.
// Only floor_area shapes participate, and only for conditions carrying a
// usable tile_setup (hasTileSetup — the opt-in, same posture as hasRollSetup).
//
// byShape summaries are the raw per-shape figures (measured geometry, never
// multiplied). byCond aggregates the raw counts (sum of full/cut/corner/
// hole/safe/keptArea_sf, unioned+re-consolidated cutsheet, unioned warnings)
// across every shape on the condition, but purchase (order) and grout are
// figured ONCE from those condition totals — never summed per shape. Whole
// boxes round on ONE dye lot per condition (design §3.3): two shapes that
// each round up to a box on their own may fit in a single box together, so
// summing per-shape ceils over-orders. The condition's own multiplier is
// later applied — at the report seam (tileReportRows), exactly like
// computeRollTakeoff's orderFt/rollCount:
// "the condition ×N multiplier applies at the report seam like every other
// quantity" (rollTakeoff.js:100).
export function computeTileTakeoff(conditions, shapes, dimsFor, uppFor) {
  const byCond = new Map();
  const byShape = new Map();
  const tileConds = (conditions || []).filter(hasTileSetup);
  if (!tileConds.length) return { byCond, byShape };
  const condById = new Map(tileConds.map((c) => [c.id, c]));

  for (const s of shapes || []) {
    if (s.measure_role !== "floor_area") continue;
    const cond = condById.get(s.condition_id);
    if (!cond) continue;
    if (!Array.isArray(s.verts_norm) || s.verts_norm.length < 3) continue;
    const dims = dimsFor(s.sheet_id);
    const upp = uppFor(s.sheet_id);
    if (!dims || !(dims.w > 0) || !(upp > 0)) continue;

    const ring_ft = ringFt(s.verts_norm, dims, upp);
    const holes_ft = (s.verts_norm_holes || []).map((ring) => ringFt(ring, dims, upp));
    const summary = summarizeShape(cond.tile_setup, ring_ft, holes_ft);
    byShape.set(s.id, summary);

    let agg = byCond.get(cond.id);
    if (!agg) {
      agg = {
        tile_setup: cond.tile_setup,
        counts: { full: 0, cut: 0, corner: 0, hole: 0, safe: 0, keptArea_sf: 0 },
        cutRows: [],
        warnings: new Set(),
        shapeIds: [],
      };
      byCond.set(cond.id, agg);
    }
    agg.counts.full += summary.counts.full;
    agg.counts.cut += summary.counts.cut;
    agg.counts.corner += summary.counts.corner;
    agg.counts.hole += summary.counts.hole;
    agg.counts.safe += summary.counts.safe;
    agg.counts.keptArea_sf += summary.counts.keptArea_sf;
    agg.cutRows.push(...summary.cutsheet);
    for (const w of summary.warnings) agg.warnings.add(w);
    agg.shapeIds.push(s.id);
  }

  for (const agg of byCond.values()) {
    agg.cutsheet = consolidateCutRows(agg.cutRows);
    delete agg.cutRows;
    agg.warnings = Array.from(agg.warnings);
    agg.order = orderTiles({
      safeCount: agg.counts.safe,
      sku: primarySku(agg.tile_setup),
      breakage_pct: agg.tile_setup.purchase?.breakage_pct,
      attic_pct: agg.tile_setup.purchase?.attic_pct,
    });
    agg.grout = tileGroutBags({ tile_setup: agg.tile_setup, keptArea_sf: agg.counts.keptArea_sf });
  }

  return { byCond, byShape };
}

// ── report seam ─────────────────────────────────────────────────────────────
// The additive tile block for opentakeoff.report.v1 (and the Report's tile
// columns). rows = conditionTotals output — finish_tag/condition_id/
// multiplier come from there so the block can never disagree with the table
// (mirrors rollReportRows, rollTakeoff.js:163-185). ×N applies here, the same
// convention as roll: N identical units are N figurings of the same layout —
// purchase quantities (safe, boxes, grout bags, order figures) scale by
// multiplier; measured geometry (full/cut/corner/keptArea_sf) is reported
// as-measured per unit, matching roll's orderFt-is-per-unit / ×N-at-report
// posture.
export function tileReportRows(tileByCond, rows) {
  if (!tileByCond || !tileByCond.size || !Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    // rows carry the condition id under `.id` (conditionTotals' row shape —
    // see rollReportRows, rollTakeoff.js:167,171, which this mirrors); never
    // `.condition_id` (that key doesn't exist on a conditionTotals row).
    const ti = tileByCond.get(r.id);
    if (!ti) continue;
    const mult = r.multiplier || 1;
    out.push({
      condition_id: r.id,
      finish_tag: r.finish_tag,
      multiplier: r.multiplier,
      full: ti.counts.full,
      cut: ti.counts.cut,
      corner: ti.counts.corner,
      hole: ti.counts.hole,
      kept_area_sf: ti.counts.keptArea_sf,
      safe: ti.counts.safe * mult,
      boxes: ti.order.boxes * mult,
      figured: ti.order.figured * mult,
      with_margin: ti.order.withMargin * mult,
      grout_bags: ti.grout.bags * mult,
      cutsheet: ti.cutsheet,
      warnings: ti.warnings,
    });
  }
  return out;
}
