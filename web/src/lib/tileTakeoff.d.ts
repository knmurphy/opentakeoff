// Types for tileTakeoff.js (kept .js, mirroring rollTakeoff.js) — the seam
// between the canvas's shape/condition model and the tile engine. Hand-written
// because the module stays JS; keep in sync with the shapes summarizeShape /
// computeTileTakeoff / tileReportRows actually build. The consumers that hold
// this contract honest: mcp/src/session.ts (imports these types instead of an
// `as` cast) and web/test/tileTakeoff.test.ts (reads every field below).
import type { TileSetup } from "./tileSetup.ts";
import type { TileCounts } from "./tileCalc/tiles.ts";
import type { TileOrder } from "./tileCalc/order.ts";
import type { CutRow } from "./tileCalc/cutsheet.ts";
import type { ReusePlanResult } from "./tileCalc/reuse.ts";
import type { TrimTally } from "./tileCalc/borders.ts";
import type { JointTally } from "./tileCalc/joints.ts";
import type { TileLayout } from "./tileSolve.ts";
import type { Classified } from "./tileGeometry/classify.ts";

// tileGroutBags' return (tileCalc/grout.ts, an inline object literal there).
export type TileGroutResult = {
  bags: number;
  sfPerBag: number;
  joint_in: number;
  note: string;
};

// A shape's interior band figure (summarizeShape). `outer`/`inner` are the
// band annulus rings in feet; `sku_id` is always the RESOLVED sku's id.
export type TileShapeBand = {
  sku_id: string;
  tiles: number;
  corner: number;
  lf: number;
  outer: [number, number][];
  inner: [number, number][];
};

// A condition's per-SKU band line (byCond aggregate — summed across shapes).
export type TileConditionBand = {
  sku_id: string;
  tiles: number;
  corner: number;
  lf: number;
};

// Per-shape/per-condition trim tally (M8 Task 8, summarizeShape / byCond
// finalize) — confirmed-only edge exposures grouped by kind, plus the
// corner EA cornerTallies derives from the same confirmed edge set.
export type TileTrimSummary = {
  byKind: TrimTally[];
  length_lf: number;
  pieces: number;
  corner_outside: number;
  corner_inside: number;
};

// One shape's figured tile summary — the byShape value. Raw measured
// geometry, never multiplied. `wallStrips`/`extent_sf` (Task 5, 2026-08-29
// wall-tile-slice-a) are present ONLY for a `surface_area` (wall) shape's
// summary (summarizeWallShape, tileWall/index.ts) — absent for a
// `floor_area` shape's, exactly like `band`/`reuse` are absent unless that
// shape opted in. `wallStrips` is `[layout]` in wrap mode (ONE strip
// solved); `extent_sf` is the unwrapped run's own L_ft * H_ft, distinct
// from `counts.keptArea_sf` (the actually-tiled area net of joints/cuts).
export type TileShapeSummary = {
  counts: TileCounts;
  bySku: Map<string, TileCounts>;
  grout: TileGroutResult;
  cutsheet: CutRow[];
  order: TileOrder;
  warnings: string[];
  layout: TileLayout;
  ring_ft: [number, number][];
  band?: TileShapeBand;
  reuse?: ReusePlanResult;
  trim: TileTrimSummary;
  joints: JointTally;
  wallStrips?: TileLayout[];
  extent_sf?: number;
};

// One SKU's own purchase line within a multi-SKU condition (Task 6, spec
// docs/superpowers/specs/2026-08-28-tile-multi-sku-field.md §5.4): a checkerboard/
// assignment field paints two-or-more DIFFERENT products into one
// condition, and different SKUs never share a box, so each figures its OWN
// order — `safe` is that SKU's own kept-cell count (countsBySku's bucket),
// `boxes`/`figured`/`with_margin` are that SKU's own orderTiles() result.
export type TileConditionSkuOrder = {
  sku_id: string;
  safe: number;
  boxes: number;
  figured: number;
  with_margin: number;
};

// One condition's aggregated tile summary — the byCond value. Counts are
// summed across the condition's shapes; order/grout/reuse are figured ONCE
// from those totals (never summed per shape). `orderBySku` is present only
// when the condition's kept cells (full|cut|corner) span 2+ distinct SKUs
// (Task 6) — absent for the overwhelmingly common single-SKU field, in
// which case `order` is byte-identical to the pre-Task-6 figuring. When
// `orderBySku` IS present, the scalar `order.figured/boxes/withMargin` are
// the SUM across every `orderBySku` entry — `order.perBox`/`order.dyeLots`
// have no single coherent value across two different products' box sizes,
// so they are NOT set on the multi-SKU scalar `order` (read `orderBySku`
// for a real per-SKU perBox via each entry's own SKU, or the boxes/figured/
// with_margin fields directly).
export type TileConditionSummary = {
  tile_setup: TileSetup;
  counts: TileCounts;
  cutsheet: CutRow[];
  warnings: string[];
  shapeIds: string[];
  order: TileOrder;
  orderBySku?: TileConditionSkuOrder[];
  grout: TileGroutResult;
  reuse?: ReusePlanResult;
  reuseOrder?: TileOrder;
  // Task 8 (2026-08-29 tile-multi-sku-field): set true (never false — absent
  // otherwise) when `purchase.reuse.enabled` was requested but the
  // condition's kept cells span 2+ distinct SKUs — reuse pools offcuts per
  // SKU but boxes them all as ONE SKU, so a mixed field guards `reuse`/
  // `reuseOrder` off entirely (both stay absent) rather than mis-boxing
  // across products. tileReportRows reads this to report `reuse_enabled:
  // true` + `reuse_downgraded: "multi-color field"` without ever reading
  // the absent `reuse`/`reuseOrder` objects.
  reuseDowngradedMulti?: boolean;
  band?: TileConditionBand[];
  trim?: TileTrimSummary;
  joints?: JointTally;
};


export type TileTakeoff = {
  byCond: Map<string, TileConditionSummary>;
  byShape: Map<string, TileShapeSummary>;
};

// One SKU's own report-row purchase line within a mixed condition's
// `by_sku[]` (Task 7, spec docs/superpowers/specs/2026-08-28-tile-multi-sku-field.md §5.7)
// — TileConditionSkuOrder's byCond figures, ×N-scaled the same as the row's
// own scalar purchase fields, plus the resolved SKU's display name/color
// (tile_setup.skus by sku_id; falls back to the raw id / a neutral color
// when the id no longer resolves).
export type TileReportSkuRow = {
  sku_id: string;
  name: string;
  color: string;
  safe: number;
  boxes: number;
  figured: number;
  with_margin: number;
};

// The additive tile row for opentakeoff.report.v1's `tile_goods` block
// (tileReportRows). ×N multiplier applied to purchase quantities; measured
// geometry reported as-measured per unit.
export type TileReportRow = {
  condition_id: string;
  finish_tag: string;
  multiplier: number;
  full: number;
  cut: number;
  corner: number;
  hole: number;
  kept_area_sf: number;
  safe: number;
  boxes: number;
  figured: number;
  with_margin: number;
  grout_bags: number;
  reuse_enabled: boolean;
  reuse_whole: number;
  reuse_with_margin: number;
  reuse_boxes: number;
  reuse_downgraded: string | null;
  cutsheet: CutRow[];
  warnings: string[];
  trim_lf: number;
  corner_outside: number;
  corner_inside: number;
  joint_lf: number;
  trim_by_kind: TrimTally[];
  // Task 7: present ONLY when the condition's byCond aggregate split kept
  // cells across 2+ SKUs (`orderBySku.length > 1`) — absent for the
  // overwhelmingly common single-SKU condition, keeping a tile-less/
  // single-SKU export byte-identical to pre-Task-7.
  by_sku?: TileReportSkuRow[];
};

export function hasTileSetup(c: unknown): boolean;

export function reusePlanForCondition(
  tile_setup: TileSetup,
  classified: Classified[],
  reuseOpts: { enabled?: boolean; sliver_threshold_in?: number; kerf_in?: number },
): ReusePlanResult;

// The optional `cache` is a cross-render per-shape solve cache: computeTileTakeoff
// reuses a shape's prior summary when its inputs (tile_setup/verts/scale/tile_layout)
// are byte-identical, and prunes entries for shapes it no longer figures. Omit it
// (MCP, tests) for the pure, un-cached behavior.
export type TileTakeoffCache = Map<string, { sig: string; summary: TileShapeSummary }>;

export function computeTileTakeoff(
  conditions: readonly unknown[],
  shapes: readonly unknown[],
  dimsFor: (sheetId: string) => { w: number; h: number } | null,
  uppFor: (sheetId: string) => number | null,
  cache?: TileTakeoffCache,
): TileTakeoff;

export function tileReportRows(
  tileByCond: Map<string, TileConditionSummary>,
  rows: readonly Record<string, unknown>[],
): TileReportRow[];
