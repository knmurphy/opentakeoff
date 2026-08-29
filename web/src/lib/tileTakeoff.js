// Tile takeoff wiring (Task 7, docs/superpowers/plans/2026-08-26-tile-patterning-m3-m4.md
// §Task 7) — mirrors web/src/lib/rollTakeoff.js computeRollTakeoff/rollReportRows
// 1:1: the pure bridge between the canvas's shape/condition model and the tile
// engine (tileSolve.ts + tileCalc/*). Roll goods speaks {x,y} strip rings in
// feet; tile speaks [x,y] tuple rings (tileSolve's ring_ft) — otherwise the
// same conversion, the same condition-by-id grouping, and the same ×N
// multiplier convention (applied at the report seam, not on measured
// geometry). Keep pure — no React or DOM.
import { hasTileSetup, primaryUsableSku } from "./tileSetup.ts";
import { edgeExposures } from "./tileEdges/expose.ts";
import { trimTallies, cornerTallies } from "./tileCalc/borders.ts";
import { movementJoints } from "./tileCalc/joints.ts";
import { solveTileLayout } from "./tileSolve.ts";
import { tileCounts, countsBySku } from "./tileCalc/tiles.ts";
import { tileGroutBags } from "./tileCalc/grout.ts";
import { cutSheet } from "./tileCalc/cutsheet.ts";
import { orderTiles } from "./tileCalc/order.ts";
import { reusePlan } from "./tileCalc/reuse.ts";
import { layoutWarning } from "./tilePatterns/index.ts";
import { effectiveTileSetup } from "./tileGeometry/optimize.ts";
import { fieldRingForBand, ringCornerCount } from "./tileEdges/band.ts";
import { inToFt } from "./tileUnits.ts";

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
    const sku = skuById.get(id) ?? primaryUsableSku(tile_setup);
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
// `primaryUsableSku` uses elsewhere) — `summary.band.sku_id` is always the
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
  const { fieldRing_ft, rings, band: resolvedBand, invalidWidth } = fieldRingForBand({ ring_ft, holes_ft, band: bandCfg });
  let band;
  if (invalidWidth) {
    warnings.push("Band width must be > 0 — band skipped.");
  } else if (resolvedBand) {
    if (rings) {
      const foundSku = (tile_setup.skus || []).find((s) => s.id === resolvedBand.sku_id);
      const bandSku = foundSku ?? primaryUsableSku(tile_setup);
      if (!foundSku && bandSku) {
        warnings.push(`Band SKU "${resolvedBand.sku_id}" not on this condition — figured from ${bandSku.name || bandSku.id}.`);
      }
      const bandTileLen_ft = inToFt(Math.max(Number(bandSku?.w_in) || 0, Number(bandSku?.h_in) || 0));
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
        warnings.push(`Band skipped: SKU "${resolvedBand.sku_id}" has no usable tile size for a band.`);
      }
    } else {
      warnings.push(`Band skipped: room too small for a ${resolvedBand.width_ft}ft band at ${resolvedBand.offset_ft}ft offset.`);
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
    sku: primaryUsableSku(tile_setup),
    breakage_pct: tile_setup.purchase?.breakage_pct,
    attic_pct: tile_setup.purchase?.attic_pct,
  });
  const summary = { counts, bySku, grout, cutsheet, order, warnings, layout, ring_ft: fieldRing_ft };
  if (band) summary.band = band;
  const reuseOpts = tile_setup.purchase?.reuse;
  if (reuseOpts?.enabled) {
    // Task 8 (2026-08-29 tile-multi-sku-field): With-reuse pools offcuts by
    // quad.skuId, but a left-diagonal offcut can't fill a right-diagonal
    // gap and two different products can never share a box — a kept field
    // spanning 2+ SKUs guards this informational per-shape figure off, the
    // same kept-cell filter (`cls !== "out" && cls !== "hole"`) Task 6's
    // keptBySku uses, so an out/hole cell's stray skuId can never trip it.
    // The condition-level `agg.reuse`/`agg.reuseOrder` finalize (byCond,
    // below) is the actual purchase figure and carries the honest
    // `reuseDowngradedMulti` flag; this one is display-only.
    const keptSkus = new Set(classified.filter((c) => c.cls !== "out" && c.cls !== "hole").map((c) => c.quad.skuId));
    if (keptSkus.size < 2) {
      summary.reuse = reusePlan({
        classified,
        sku: primaryUsableSku(tile_setup),
        pattern: layout.config.pattern,
        sliver_threshold_in: reuseOpts.sliver_threshold_in,
        kerf_in: reuseOpts.kerf_in,
      });
    }
  }
  // Trim + movement joints (M8 Task 8, design §3.4/§3.3) — read the ROOM's
  // own full ring (the `ring_ft` param, never the band-eroded `fieldRing_ft`)
  // so a shape's edge_overrides drive the exact same exposures
  // TakeoffCanvas.jsx's tileOverlayForShape hands edgeExposures (drawn ==
  // counted). Confirmed-only (trimTallies' default) — an unconfirmed
  // suggestion never auto-commits to a bid line (§3.4). transitions_lf stays
  // 0: wiring material-transition runs into the joint LF is out of scope here.
  const overrides = Object.fromEntries(
    Object.entries(tile_layout?.edge_overrides || {}).map(([i, o]) => [i, o?.exposure]),
  );
  const exposures = edgeExposures({ ring_ft, overrides });
  // Trim pieces are cut at the field SKU's long dimension (a 12×24 tile →
  // 2 ft bullnose pieces), never the 1.0 ft fallback — that fallback is only
  // for callers with no SKU on hand (borders.ts DEFAULT_PIECE_LF).
  const fieldSku = primaryUsableSku(tile_setup);
  const piece_lf = fieldSku ? Math.max(Number(fieldSku.w_in) || 0, Number(fieldSku.h_in) || 0) / 12 : 1.0;
  const byKind = trimTallies(exposures, { piece_lf: piece_lf > 0 ? piece_lf : 1.0 });
  const corners = cornerTallies(ring_ft, exposures);
  summary.trim = {
    byKind,
    length_lf: byKind.reduce((sum, k) => sum + k.length_lf, 0),
    pieces: byKind.reduce((sum, k) => sum + k.pieces, 0),
    corner_outside: corners.outside,
    corner_inside: corners.inside,
  };
  summary.joints = movementJoints({ ring_ft });
  return summary;
}

// ── the whole takeoff, figured ──────────────────────────────────────────────
// computeTileTakeoff(conditions, shapes, dimsFor, uppFor, cache?) →
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
export function computeTileTakeoff(conditions, shapes, dimsFor, uppFor, cache) {
  const byCond = new Map();
  const byShape = new Map();
  const tileConds = (conditions || []).filter(hasTileSetup);
  // No tile conditions at all → no tiled shape can be live, so any cached
  // summaries are dead. Clear here too (the eviction loop below is unreachable
  // on this early return) to honor "the cache tracks the live tiled-shape set".
  if (!tileConds.length) {
    if (cache) cache.clear();
    return { byCond, byShape };
  }
  const condById = new Map(tileConds.map((c) => [c.id, c]));

  // Optional cross-render solve cache (perf #2). A shape's summary is a PURE
  // function of (tile_setup, verts_norm, verts_norm_holes, scale, tile_layout);
  // the key below is exactly those inputs, so a HIT guarantees byte-identical
  // inputs and therefore a byte-identical solve — a reused summary can never
  // diverge from a fresh figuring (the drawn==counted contract). tile_setup is
  // stringified ONCE per condition. NUL separators can't occur inside a JSON
  // number/array, so distinct field runs can never alias into one key.
  //
  // A cached summary (and its layout.classified cells) is reused BY REFERENCE
  // across renders. Every downstream reader — byCond finalize below, the canvas
  // overlay, tileQA, tileReportRows, the MCP snapshot — only READS it (audited).
  // Keep it so: mutating a summary or a classified cell in place would silently
  // corrupt the next render's reuse.
  const setupSigById = cache ? new Map(tileConds.map((c) => [c.id, JSON.stringify(c.tile_setup)])) : null;
  const seenShapeIds = cache ? new Set() : null;

  // get-or-create the condition aggregate — pulled out so a shape SKIPPED
  // below (unscaled sheet, degenerate ring) can still land its exclusion on
  // a real byCond entry (FIX 6): the alternative, silently dropping a
  // condition whose only shapes were skipped, reports "no tile work" to
  // export_report/MCP instead of the honest "scale missing"/"degenerate
  // ring" — a hole in the bid a batch audit exists to catch.
  const aggFor = (cond) => {
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
        trimByKind: new Map(),
        trimTotals: { length_lf: 0, pieces: 0, corner_outside: 0, corner_inside: 0 },
        jointTotals: { perimeter_lf: 0, field_lf: 0, transition_lf: 0, total_lf: 0, fieldGridSpacing_ft: 0 },
        hasTrim: false,
        excluded: { unscaled: 0, degenerate: 0 },
      };
      byCond.set(cond.id, agg);
    }
    return agg;
  };

  for (const s of shapes || []) {
    if (s.measure_role !== "floor_area") continue;
    const cond = condById.get(s.condition_id);
    if (!cond) continue;
    if (!Array.isArray(s.verts_norm) || s.verts_norm.length < 3) {
      aggFor(cond).excluded.degenerate++;
      continue;
    }
    const dims = dimsFor(s.sheet_id);
    const upp = uppFor(s.sheet_id);
    // FIX 7: `dims.h > 0` is required alongside `dims.w > 0` (tileQA.ts's
    // own unscaled-sheet gate checks both) — a zero-height bitmap figures
    // an all-zero room silently otherwise.
    if (!dims || !(dims.w > 0) || !(dims.h > 0) || !(upp > 0)) {
      aggFor(cond).excluded.unscaled++;
      continue;
    }

    let summary;
    const sig = cache
      ? setupSigById.get(cond.id) +
        "\u0000" + upp + "\u0000" + dims.w + "\u0000" + dims.h +
        "\u0000" + JSON.stringify(s.verts_norm) +
        "\u0000" + JSON.stringify(s.verts_norm_holes || null) +
        "\u0000" + JSON.stringify(s.tile_layout || null)
      : null;
    const cached = cache ? cache.get(s.id) : null;
    if (cached && cached.sig === sig) {
      summary = cached.summary;
    } else {
      const ring_ft = ringFt(s.verts_norm, dims, upp);
      const holes_ft = (s.verts_norm_holes || []).map((ring) => ringFt(ring, dims, upp));
      summary = summarizeShape(cond.tile_setup, ring_ft, holes_ft, s.tile_layout);
      if (cache) cache.set(s.id, { sig, summary });
    }
    if (seenShapeIds) seenShapeIds.add(s.id);
    byShape.set(s.id, summary);

    const agg = aggFor(cond);
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
    if (summary.trim.byKind.length) {
      agg.hasTrim = true;
      for (const k of summary.trim.byKind) {
        const existing = agg.trimByKind.get(k.exposure);
        if (!existing) {
          agg.trimByKind.set(k.exposure, { length_lf: k.length_lf, pieces: k.pieces, finish_neighbor: k.finish_neighbor, sharedNeighbor: true });
        } else {
          existing.length_lf += k.length_lf;
          existing.pieces += k.pieces;
          if (existing.finish_neighbor !== k.finish_neighbor) existing.sharedNeighbor = false;
        }
      }
      agg.trimTotals.length_lf += summary.trim.length_lf;
      agg.trimTotals.pieces += summary.trim.pieces;
      agg.trimTotals.corner_outside += summary.trim.corner_outside;
      agg.trimTotals.corner_inside += summary.trim.corner_inside;
    }
    // Movement joints are pure ring geometry — every contributed shape adds its
    // perimeter/field LF whether or not it carries a confirmed trim edge (the
    // finalize `hasTrim` gate is what withholds the whole joint figure when NO
    // shape on the condition had a confirmed trim edge).
    agg.jointTotals.perimeter_lf += summary.joints.perimeter_lf;
    agg.jointTotals.field_lf += summary.joints.field_lf;
    agg.jointTotals.transition_lf += summary.joints.transition_lf;
    agg.jointTotals.total_lf += summary.joints.total_lf;
    agg.jointTotals.fieldGridSpacing_ft = summary.joints.fieldGridSpacing_ft;
  }

  for (const agg of byCond.values()) {
    agg.cutsheet = consolidateCutRows(agg.cutRows);
    delete agg.cutRows;
    if (agg.excluded.unscaled > 0) {
      agg.warnings.add(`${agg.excluded.unscaled} room(s) excluded from tile figures: unscaled sheet.`);
    }
    if (agg.excluded.degenerate > 0) {
      agg.warnings.add(`${agg.excluded.degenerate} room(s) excluded from tile figures: degenerate ring.`);
    }
    delete agg.excluded;
    agg.warnings = Array.from(agg.warnings);
    // Multi-SKU purchase (Task 6, docs/superpowers/sdd/2026-08-29-tile-multi-sku-field):
    // an assignment field paints two-or-more DIFFERENT products into one
    // condition (design §3.2/Task 5's per-quad `quad.skuId`) — different
    // SKUs never share a box, so each one purchases as its own order, rolled
    // up HERE at the condition level. `kept` filters to full|cut|corner (a
    // hole/out cell is never purchased — tileCalc/tiles.ts's own accumulate
    // agrees: it skips "out" entirely and never folds "hole" into `safe`),
    // filtered into a NEW array — `agg.classified` itself is never mutated
    // (it's deleted a few lines down; With-reuse above already established
    // this same never-mutate posture). `keptBySku.size <= 1` (no assignment,
    // or an assignment that happens to resolve every kept cell to the same
    // SKU) keeps the pre-Task-6 single-order path byte-identical — a
    // checkerboard/multi-SKU field is opt-in, never a behavior change for an
    // existing single-SKU condition.
    const kept = agg.classified.filter((c) => c.cls !== "out" && c.cls !== "hole");
    const keptBySku = countsBySku(kept);
    if (keptBySku.size <= 1) {
      agg.order = orderTiles({
        safeCount: agg.counts.safe,
        sku: primaryUsableSku(agg.tile_setup),
        breakage_pct: agg.tile_setup.purchase?.breakage_pct,
        attic_pct: agg.tile_setup.purchase?.attic_pct,
      });
    } else {
      // A bucket's id may name a SKU no longer on this condition (stale
      // assignment after a SKU delete) — fall back to the field's own
      // primary usable SKU, mirroring assignedSkuId's (tileSetup.ts) own
      // fallback so a PO line can never aggregate under a phantom/dangling
      // material. `agg.orderBySku` is the stable shape the report seam
      // (Task 7) reads: [{ sku_id, safe, boxes, figured, with_margin }],
      // sorted by sku_id for a deterministic order — the same convention
      // `agg.band` uses a few lines below (M7 Task 7.2). The scalar
      // `agg.order` stays present too (every existing reader — TilePanel,
      // tileReportRows, reportColumns, markedset — keeps reading it), set to
      // the SUM across every per-SKU order so a multi-SKU condition never
      // silently drops out of a total/summary that hasn't been taught about
      // `orderBySku` yet.
      const skuById = new Map((agg.tile_setup.skus || []).map((s) => [s.id, s]));
      const perSku = [];
      for (const [id, counts] of keptBySku) {
        const sku = skuById.get(id) ?? primaryUsableSku(agg.tile_setup);
        const order = orderTiles({
          safeCount: counts.safe,
          sku,
          breakage_pct: agg.tile_setup.purchase?.breakage_pct,
          attic_pct: agg.tile_setup.purchase?.attic_pct,
        });
        perSku.push({ sku_id: id, safe: counts.safe, boxes: order.boxes, figured: order.figured, with_margin: order.withMargin });
      }
      perSku.sort((a, b) => (a.sku_id < b.sku_id ? -1 : a.sku_id > b.sku_id ? 1 : 0));
      agg.orderBySku = perSku;
      agg.order = {
        figured: perSku.reduce((sum, o) => sum + o.figured, 0),
        withMargin: perSku.reduce((sum, o) => sum + o.with_margin, 0),
        boxes: perSku.reduce((sum, o) => sum + o.boxes, 0),
      };
    }
    agg.grout = tileGroutBags({ tile_setup: agg.tile_setup, keptArea_sf: agg.counts.keptArea_sf });
    // With-reuse (M6, Invariants): figured ONCE per condition, over every
    // contributing shape's classified cells pooled together — never summed
    // from byShape reuse figures. Strictly additive: `agg.order` (Safe)
    // above is untouched either way.
    const reuseOpts = agg.tile_setup.purchase?.reuse;
    // Task 8 (2026-08-29 tile-multi-sku-field): reusePlanForCondition pools
    // whole-tile counts per SKU bucket but reuseOrder below boxes the whole
    // condition as ONE sku (primaryUsableSku) — a left-diagonal offcut
    // can't fill a right-diagonal gap, and different SKUs never share a
    // box. `keptBySku` (computed just above for the multi-SKU order split,
    // Task 6) is the SAME kept-cell filter, so reuse guards off exactly
    // when the order split turns on. Guard reuse OFF and report the
    // downgrade honestly via `reuseDowngradedMulti` — tileReportRows reads
    // it through a two-variable split so the absent `agg.reuse`/
    // `agg.reuseOrder` can never NPE the report row.
    if (reuseOpts?.enabled && keptBySku.size >= 2) {
      agg.reuseDowngradedMulti = true;
    } else if (reuseOpts?.enabled) {
      agg.reuse = reusePlanForCondition(agg.tile_setup, agg.classified, reuseOpts);
      agg.reuseOrder = orderTiles({
        safeCount: agg.reuse.wholeTiles,
        sku: primaryUsableSku(agg.tile_setup),
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
    // Trim + movement joints (M8 Task 8, design §3.4/§3.3): absent when no
    // shape on the condition carried a confirmed trim edge, mirroring the
    // band absent-when-empty convention — a no-trim room never reports a
    // fabricated trim/joint line.
    if (agg.hasTrim) {
      const byKind = Array.from(agg.trimByKind, ([exposure, g]) => ({
        exposure,
        length_lf: g.length_lf,
        pieces: g.pieces,
        ...(g.sharedNeighbor && g.finish_neighbor !== undefined ? { finish_neighbor: g.finish_neighbor } : {}),
      })).sort((a, b) => a.exposure.localeCompare(b.exposure));
      agg.trim = {
        byKind,
        length_lf: agg.trimTotals.length_lf,
        pieces: agg.trimTotals.pieces,
        corner_outside: agg.trimTotals.corner_outside,
        corner_inside: agg.trimTotals.corner_inside,
      };
      agg.joints = { ...agg.jointTotals };
    }
    delete agg.trimByKind;
    delete agg.trimTotals;
    delete agg.jointTotals;
    delete agg.hasTrim;
    delete agg.classified;
  }

  // Evict entries for shapes no longer figured this pass (deleted, re-tagged
  // off floor_area, or moved onto an unscaled sheet) so the cache tracks the
  // live tiled-shape set and never grows unbounded across a session.
  if (cache) {
    for (const id of cache.keys()) if (!seenShapeIds.has(id)) cache.delete(id);
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
// `reuse_enabled` is true. Task 8 (2026-08-29 tile-multi-sku-field) adds a
// SECOND downgrade path: a multi-color field (byCond finalize sets
// `ti.reuseDowngradedMulti`, never figures `ti.reuse`/`ti.reuseOrder`)
// still reports `reuse_enabled: true` (reuse was requested) but
// `reuse_downgraded: "multi-color field"` and zeroed `reuse_whole`/
// `reuse_with_margin`/`reuse_boxes` — an honest downgrade, not a silent
// mis-boxing across products that can't share a box. `reuseFigured` below
// gates the real-figure reads so this path can never NPE on the absent
// objects.
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
    // Task 8 (2026-08-29 tile-multi-sku-field): a multi-color field guards
    // condition-level reuse off (byCond finalize, above) — `ti.reuse`/
    // `ti.reuseOrder` are then ABSENT, not zeroed. `reuseFigured` gates the
    // real figures below (never read `ti.reuse.*`/`ti.reuseOrder.*` when
    // false — that's the NPE this split prevents); `reuseEnabled` is only
    // the REPORTED flag, true whenever reuse was requested — figured or
    // honestly downgraded.
    const reuseFigured = Boolean(ti.reuse && ti.reuseOrder);
    const reuseEnabled = reuseFigured || Boolean(ti.reuseDowngradedMulti);
    const bySku = ti.orderBySku && ti.orderBySku.length > 1
      ? new Map((ti.tile_setup.skus || []).map((s) => [s.id, s]))
      : null;
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
      reuse_whole: reuseFigured ? ti.reuseOrder.figured * mult : 0,
      reuse_with_margin: reuseFigured ? ti.reuseOrder.withMargin * mult : 0,
      reuse_boxes: reuseFigured ? ti.reuseOrder.boxes * mult : 0,
      reuse_downgraded: ti.reuseDowngradedMulti ? "multi-color field" : (reuseFigured && ti.reuse.downgraded ? ti.reuse.downgraded : null),
      cutsheet: ti.cutsheet,
      warnings: ti.warnings,
      // Trim + movement joints (M8 Task 8): trim/joint LF are purchase
      // figures (installed linear stock, order rounds by pieces) so they
      // scale by the condition ×N multiplier like Safe/boxes/grout; corner
      // EA is an as-measured count of the room's own geometry, never ×N. The
      // per-kind breakdown scales the SAME way (its length_lf must sum to the
      // ×N trim_lf beside it, and pieces are ordered per unit).
      trim_lf: ti.trim ? ti.trim.length_lf * mult : 0,
      corner_outside: ti.trim ? ti.trim.corner_outside : 0,
      corner_inside: ti.trim ? ti.trim.corner_inside : 0,
      joint_lf: ti.joints ? ti.joints.total_lf * mult : 0,
      trim_by_kind: ti.trim
        ? ti.trim.byKind.map((k) => ({ ...k, length_lf: k.length_lf * mult, pieces: k.pieces * mult }))
        : [],
      // Multi-SKU purchase (Task 7, docs/superpowers/sdd/2026-08-29-tile-
      // multi-sku-field): additive — present ONLY when byCond's finalize
      // (Task 6) split the condition's kept cells across 2+ SKUs
      // (`ti.orderBySku`); a single-SKU/no-assignment condition never gets
      // this key, so a tile-less/single-SKU export stays byte-identical.
      // Each entry's safe/boxes/figured/with_margin get the SAME ×N scaling
      // as the scalar fields above — the row's own safe/boxes/figured/
      // with_margin equal the SUM of these already-scaled entries (scaling
      // then summing is the same as summing then scaling). name/color
      // resolve from the condition's tile_setup.skus by sku_id; a bucket
      // whose id no longer names a real SKU (stale assignment after a SKU
      // delete — the same edge case byCond's own orderBySku finalize falls
      // back for, tileTakeoff.js:423) falls back to the field's own
      // primaryUsableSku, same chain, never a dangling id or a placeholder
      // color (tileSetup.ts:68).
      ...(bySku
        ? {
            by_sku: ti.orderBySku.map((o) => {
              const sku = bySku.get(o.sku_id) ?? primaryUsableSku(ti.tile_setup);
              return {
                sku_id: o.sku_id,
                name: sku?.name ?? o.sku_id,
                color: sku?.color ?? "#999999",
                safe: o.safe * mult,
                boxes: o.boxes * mult,
                figured: o.figured * mult,
                with_margin: o.with_margin * mult,
              };
            }),
          }
        : {}),
    });
  }
  return out;
}
