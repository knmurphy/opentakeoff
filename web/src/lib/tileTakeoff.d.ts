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

// One shape's figured tile summary — the byShape value. Raw measured
// geometry, never multiplied.
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
};

// One condition's aggregated tile summary — the byCond value. Counts are
// summed across the condition's shapes; order/grout/reuse are figured ONCE
// from those totals (never summed per shape).
export type TileConditionSummary = {
  tile_setup: TileSetup;
  counts: TileCounts;
  cutsheet: CutRow[];
  warnings: string[];
  shapeIds: string[];
  order: TileOrder;
  grout: TileGroutResult;
  reuse?: ReusePlanResult;
  reuseOrder?: TileOrder;
  band?: TileConditionBand[];
};

export type TileTakeoff = {
  byCond: Map<string, TileConditionSummary>;
  byShape: Map<string, TileShapeSummary>;
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
