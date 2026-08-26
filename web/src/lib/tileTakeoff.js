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
import { reusePlan } from "./tileCalc/reuse.ts";
import { layoutWarning } from "./tilePatterns/index.ts";
import { effectiveTileSetup } from "./tileGeometry/optimize.ts";
import { fieldRingForBand, ringCornerCount } from "./tileEdges/band.ts";

export { hasTileSetup, reusePlanForCondition };

// verts_norm/verts_norm_holes → feet, using the shape's own bitmap dims + upp.
// Same normalization roll uses (rollTakeoff.js:118-120), just [x,y] tuples
// instead of {x,y} objects — tileSolve's ring_ft contract.
function ringFt(verts, dims, upp) {
  return verts.map(([nx, ny]) => [nx * dims.w * upp, ny * dims.h * upp]);
}

// Sum of edge lengths of a CLOSED-implicitly OPEN ring (feet) — the band's
// outer ring perimeter, in the same [x,y] tuple/feet space as `ring_ft`
// (bandRings, like classify.ts/tileSolve.ts, never repeats the first point).
function ringPerimeterFt(ring) {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  return perimeter;
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

// With-reuse condition-level pooling (design §3.3, M6 Task 6.2/Invariants):
// grain-locked reuse pools each SKU's offcuts separately (a directional
// tile's grain runs one way, so one SKU never donates an offcut to another's
// cut), so classified cells are bucketed by `quad.skuId` and `reusePlan` runs
// once per bucket; whole-tile figures sum across SKUs into one condition-
// level plan. `downgraded` is pattern-driven (AABB-approximate patterns),
// so every bucket agrees on it — the first bucket to report one carries it.
function reusePlanForCondition(tile_setup, classified, reuseOpts) {
  const skuById = new Map((tile_setup.skus || []).map((s) => [s.id, s]));
  const bySkuId = new Map();
  for (const c of classified) {
    const id = c.quad.skuId;
    const bucket = bySkuId.get(id);
    if (bucket) bucket.push(c);
    else bySkuId.set(id, [c]);
  }
  let wholeTiles = 0;
  let offcutsUsed = 0;
  let scrapped = 0;
  const reuseMap = [];
  let downgraded;
  for (const [id, cells] of bySkuId) {
    const sku = skuById.get(id) ?? primarySku(tile_setup);
    const plan = reusePlan({
      classified: cells,
      sku,
      pattern: tile_setup.pattern,
      sliver_threshold_in: reuseOpts.sliver_threshold_in,
      kerf_in: reuseOpts.kerf_in,
    });
    wholeTiles += plan.wholeTiles;
    offcutsUsed += plan.offcutsUsed;
    scrapped += plan.scrapped;
    reuseMap.push(...plan.reuseMap);
    if (plan.downgraded && !downgraded) downgraded = plan.downgraded;
  }
  const result = { wholeTiles, offcutsUsed, scrapped, reuseMap };
  if (downgraded) result.downgraded = downgraded;
  return result;
}

// One shape's figured tile summary — the classify+count+grout+order+cutsheet
// bundle every downstream consumer (report row, per-sheet overlay, QA, MCP
// snapshot) reads. `tile_layout` is the shape's per-room override
// (origin/rotation); effectiveTileSetup (optimize.ts) is the SOLE origin/
// rotation resolver, so the counts figured here match the grid the canvas
// draws and the layout the MCP snapshot exports byte for byte. The solved
// `layout` (config + quads + classified) and `ring_ft` ride the summary so a
// consumer never has to re-solve — and therefore can never diverge. `reuse`
// (With-reuse offcut pool, M6) is additive and present only when the
// condition opted in (`purchase.reuse.enabled`) — a per-shape informational
// figure; the condition-level `reuse`/`reuseOrder` figured once in
// computeTileTakeoff's byCond finalize (Invariants) is the purchase figure.
// `tile_layout.band` (M7 Task 7.2) is figured FIRST, before the field solve:
// `fieldRingForBand` (tileEdges/band.ts, pure — the SAME helper
// TakeoffCanvas.jsx's `tileOverlayForShape` calls, so the two field-solve
// paths stay byte-identical by construction, not by two authors reading
// the same comment) re-scopes the field ring to the band's inner ring
// whenever the band config is geometrically usable (both
// `effectiveTileSetup`'s origin search and `solveTileLayout`'s classify
// pass take the re-scoped ring — the band consumes that perimeter area, so
// the field must stop there, design §3.4). Sizing the band itself (tile
// count, miter corners) is a SEPARATE concern layered on top: it needs a
// real SKU with a positive tile size, resolved by `sku_id` (falling back
// to the condition's primary SKU on a bad/missing id, the same fallback
// `primarySku` uses elsewhere) — `summary.band.sku_id` is always the
// RESOLVED sku's id, never the raw (possibly invalid) config id, so a bad
// `sku_id` can never silently aggregate a PO line under a phantom
// material. A geometry collapse (room too small) or a resolved SKU with no
// usable size each withhold `summary.band` and push an honest warning
// instead of guessing (never a tiles: Infinity/NaN). No `tile_layout.band`
// at all is byte-identical to the pre-M7 behavior — no `band` key, field
// solves against `ring_ft`.
function summarizeShape(tile_setup, ring_ft, holes_ft, tile_layout) {
  const warnings = [layoutWarning(tile_setup)].filter(Boolean);
  const bandCfg = tile_layout?.band;
  const { fieldRing_ft, rings } = fieldRingForBand({ ring_ft, holes_ft, band: bandCfg });
  let band;
  if (bandCfg && bandCfg.sku_id && Number(bandCfg.width_ft) > 0) {
    if (rings) {
      const bandSku = (tile_setup.skus || []).find((s) => s.id === bandCfg.sku_id) ?? primarySku(tile_setup);
      const bandTileLen_ft = Math.max(Number(bandSku?.w_in) || 0, Number(bandSku?.h_in) || 0) / 12;
      if (bandSku && bandTileLen_ft > 0) {
        const lf = ringPerimeterFt(rings.outer);
        band = {
          sku_id: bandSku.id,
          tiles: Math.ceil(lf / bandTileLen_ft),
          corner: ringCornerCount(rings.outer),
          lf,
          outer: rings.outer,
          inner: rings.inner,
        };
      } else {
        warnings.push(`Band skipped: SKU "${bandCfg.sku_id}" has no usable tile size for a band.`);
      }
    } else {
      const offset_ft = Number(bandCfg.offset_ft) || 0;
      warnings.push(`Band skipped: room too small for a ${bandCfg.width_ft}ft band at ${offset_ft}ft offset.`);
    }
  }
  const solveSetup = effectiveTileSetup({ tile_setup, tile_layout, ring_ft: fieldRing_ft, holes_ft });
  const layout = solveTileLayout({ tile_setup: solveSetup, ring_ft: fieldRing_ft, holes_ft });
  const { classified } = layout;
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
  const summary = { counts, bySku, grout, cutsheet, order, warnings, layout, ring_ft: fieldRing_ft };
  if (band) summary.band = band;
  const reuseOpts = tile_setup.purchase?.reuse;
  if (reuseOpts?.enabled) {
    summary.reuse = reusePlan({
      classified,
      sku: primarySku(tile_setup),
      pattern: layout.config.pattern,
      sliver_threshold_in: reuseOpts.sliver_threshold_in,
      kerf_in: reuseOpts.kerf_in,
    });
  }
  return summary;
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
    const summary = summarizeShape(cond.tile_setup, ring_ft, holes_ft, s.tile_layout);
    byShape.set(s.id, summary);

    let agg = byCond.get(cond.id);
    if (!agg) {
      agg = {
        tile_setup: cond.tile_setup,
        counts: { full: 0, cut: 0, corner: 0, hole: 0, safe: 0, keptArea_sf: 0 },
        cutRows: [],
        classified: [],
        warnings: new Set(),
        shapeIds: [],
        bandBySku: new Map(),
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
    agg.classified.push(...summary.layout.classified);
    for (const w of summary.warnings) agg.warnings.add(w);
    agg.shapeIds.push(s.id);
    if (summary.band) {
      const id = summary.band.sku_id;
      const totals = agg.bandBySku.get(id);
      if (totals) {
        totals.tiles += summary.band.tiles;
        totals.corner += summary.band.corner;
        totals.lf += summary.band.lf;
      } else {
        agg.bandBySku.set(id, { tiles: summary.band.tiles, corner: summary.band.corner, lf: summary.band.lf });
      }
    }
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
    // With-reuse (M6, Invariants): figured ONCE per condition, over every
    // contributing shape's classified cells pooled together — never summed
    // from byShape reuse figures. Strictly additive: `agg.order` (Safe)
    // above is untouched either way.
    const reuseOpts = agg.tile_setup.purchase?.reuse;
    if (reuseOpts?.enabled) {
      agg.reuse = reusePlanForCondition(agg.tile_setup, agg.classified, reuseOpts);
      agg.reuseOrder = orderTiles({
        safeCount: agg.reuse.wholeTiles,
        sku: primarySku(agg.tile_setup),
        breakage_pct: agg.tile_setup.purchase?.breakage_pct,
        attic_pct: agg.tile_setup.purchase?.attic_pct,
      });
    }
    // Interior band (M7 Task 7.2): per-SKU band figures summed across every
    // shape on the condition — a band SKU orders as its own line, deterministic
    // by sku_id (design §3.4, Contract). No shape on the condition carried a
    // band → `agg.band` stays absent (never an empty array).
    if (agg.bandBySku.size) {
      agg.band = Array.from(agg.bandBySku, ([sku_id, v]) => ({ sku_id, ...v })).sort((a, b) =>
        a.sku_id < b.sku_id ? -1 : a.sku_id > b.sku_id ? 1 : 0,
      );
    }
    delete agg.bandBySku;
    delete agg.classified;
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
// posture. `reuse_enabled`/`reuse_whole`/`reuse_with_margin`/`reuse_boxes`/
// `reuse_downgraded` (M6) are additive: present with real figures only when
// the condition's `purchase.reuse` opted in (byCond carries `reuseOrder` in
// that case — Task 6.2); absent reuse reports `reuse_enabled: false,
// reuse_whole: 0, reuse_with_margin: 0, reuse_boxes: 0, reuse_downgraded:
// null`. `reuse_whole`/`reuse_with_margin`/`reuse_boxes` scale by the same
// ×N multiplier as Safe boxes, mirroring Safe's figured/with_margin pair.
// `reuse_downgraded` carries the pattern-driven downgrade reason string
// (reusePlanForCondition) when reuse was requested but no savings could be
// modeled for the pattern — numbers then equal Safe even though
// `reuse_enabled` is true.
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
    const reuseEnabled = Boolean(ti.reuse && ti.reuseOrder);
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
      reuse_enabled: reuseEnabled,
      reuse_whole: reuseEnabled ? ti.reuseOrder.figured * mult : 0,
      reuse_with_margin: reuseEnabled ? ti.reuseOrder.withMargin * mult : 0,
      reuse_boxes: reuseEnabled ? ti.reuseOrder.boxes * mult : 0,
      reuse_downgraded: reuseEnabled && ti.reuse.downgraded ? ti.reuse.downgraded : null,
      cutsheet: ti.cutsheet,
      warnings: ti.warnings,
    });
  }
  return out;
}
