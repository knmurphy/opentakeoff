// web/src/lib/tileQA.ts
//
// Multi-room batch QA aggregator (design §2.I, M5 Task 4): a 40-room job
// isn't audited one zoom at a time, so this walks every tiled floor shape
// once and returns a flat warning list the canvas/panel can render and
// click-to-focus into. Pure — no React/DOM. Mirrors computeTileTakeoff's
// own floor-shape filter (tileTakeoff.js) so a shape either both figures
// AND gets QA'd, or neither — but where computeTileTakeoff silently skips
// an unscaled sheet (no feet to figure with), this surfaces it as a
// warning instead: an unscaled room is exactly the kind of thing a batch
// audit exists to catch.
import { hasTileSetup, type TileSetup } from "./tileSetup.ts";
import { solveTileLayout } from "./tileSolve.ts";
import { layoutWarning } from "./tilePatterns/index.ts";
import { effectiveTileSetup } from "./tileGeometry/optimize.ts";
import { fieldRingForBand } from "./tileEdges/band.ts";

export type WarningKind = "sliver" | "layout" | "hole_cut" | "unscaled" | "seam_crossing" | "band_skipped";

export type Warning = {
  condition_id: string;
  shape_id: string;
  finish_tag: string;
  sheet_id: string;
  kind: WarningKind;
  detail: string;
  at_norm?: [number, number];
};

type Condition = {
  id: string;
  finish_tag?: string;
  tile_setup?: TileSetup;
};

type Shape = {
  id: string;
  condition_id?: string;
  sheet_id?: string;
  measure_role?: string;
  verts_norm?: [number, number][];
  verts_norm_holes?: [number, number][][];
  // Per-room layout override (origin/rotation); honored via effectiveTileSetup
  // so the audited grid matches the drawn and counted grid (§4.1).
  tile_layout?: { origin?: [number, number]; rotation?: number; band?: { sku_id?: string; width_ft?: number; offset_ft?: number } } | null;
  // Set by the canvas (Task 6) when it knows a room is part of a stitched
  // group crossing a sheet boundary — this module has no way to detect
  // stitch membership from (conditions, shapes) alone, so it never
  // fabricates the flag; it only relays it.
  stitch_crossing?: boolean;
};

type SheetDims = { w: number; h: number };
type DimsFor = (sheetId: string | undefined) => SheetDims | null;
type UppFor = (sheetId: string | undefined) => number | null;

// Average of a room's normalized vertices — a simple, deterministic focus
// target for a room-level (not per-cell) warning like `band_skipped`.
function centroidNorm(verts: readonly [number, number][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [nx, ny] of verts) { sx += nx; sy += ny; }
  return [sx / verts.length, sy / verts.length];
}

// tileWarnings(conditions, shapes, dimsFor, uppFor) → Warning[]
//
// dimsFor(sheetId) → sheet bitmap px dims | null, uppFor(sheetId) →
// feet-per-px | null — same contract as computeTileTakeoff. Only
// floor_area shapes on a condition carrying a usable tile_setup
// participate (hasTileSetup — the opt-in). Read byCond from
// computeTileTakeoff if you need condition totals; this walks classified
// cells per shape directly, which sidesteps the byShape.order/grout
// over-order footgun entirely (no purchase figures are read here).
export function tileWarnings(
  conditions: readonly Condition[] | null | undefined,
  shapes: readonly Shape[] | null | undefined,
  dimsFor: DimsFor,
  uppFor: UppFor,
): Warning[] {
  const warnings: Warning[] = [];
  const tileConds = (conditions || []).filter(hasTileSetup);
  if (!tileConds.length) return warnings;
  const condById = new Map(tileConds.map((c) => [c.id, c]));

  for (const s of shapes || []) {
    if (s.measure_role !== "floor_area") continue;
    const cond = condById.get(s.condition_id || "");
    if (!cond || !cond.tile_setup) continue;
    if (!Array.isArray(s.verts_norm) || s.verts_norm.length < 3) continue;

    const finish_tag = cond.finish_tag || "";
    const sheet_id = s.sheet_id || "";
    const dims = dimsFor(s.sheet_id);
    const upp = uppFor(s.sheet_id);

    if (!dims || !(dims.w > 0) || !(dims.h > 0) || !(upp && upp > 0)) {
      warnings.push({
        condition_id: cond.id,
        shape_id: s.id,
        finish_tag,
        sheet_id,
        kind: "unscaled",
        detail: sheet_id
          ? `Sheet "${sheet_id}" is unscaled; set its scale before this room's tile layout can be checked.`
          : "This room's sheet is unscaled; set its scale before the tile layout can be checked.",
      });
      continue;
    }

    const tile_setup = cond.tile_setup;
    const setupWarning = layoutWarning(tile_setup);
    if (setupWarning) {
      warnings.push({
        condition_id: cond.id,
        shape_id: s.id,
        finish_tag,
        sheet_id,
        kind: "layout",
        detail: setupWarning,
      });
    }

    if (s.stitch_crossing) {
      warnings.push({
        condition_id: cond.id,
        shape_id: s.id,
        finish_tag,
        sheet_id,
        kind: "seam_crossing",
        detail: "This room's tile layout crosses a sheet seam — stitching across sheets needs a human seam decision.",
      });
    }

    const ring_ft: [number, number][] = s.verts_norm.map(([nx, ny]) => [nx * dims.w * upp, ny * dims.h * upp]);
    const holes_ft: [number, number][][] = (s.verts_norm_holes || []).map((hole) =>
      hole.map(([nx, ny]): [number, number] => [nx * dims.w * upp, ny * dims.h * upp]),
    );

    // The SAME shared helper summarizeShape (tileTakeoff.js) calls — the
    // single source of the usable-band decision (band.ts) — so a configured
    // band whose geometry collapses (room too small) or whose width_ft is
    // not positive figures no field re-scope there and pushes a warning
    // that never leaves the condition card; surface both here too, so a
    // batch audit catches them without opening every room's panel. Passing
    // `fieldRing_ft` (not the raw `ring_ft`) into effectiveTileSetup and
    // solveTileLayout below is the FIX for the P1 finding: the audited grid
    // must be the SAME ring computeTileTakeoff's summarizeShape solves
    // against, or a banded room is audited on phantom band-annulus cells
    // the takeoff never orders.
    const bandCfg = s.tile_layout?.band;
    const { fieldRing_ft, rings, band, invalidWidth } = fieldRingForBand({ ring_ft, holes_ft, band: bandCfg });
    if (invalidWidth) {
      warnings.push({
        condition_id: cond.id,
        shape_id: s.id,
        finish_tag,
        sheet_id,
        kind: "band_skipped",
        detail: "Band width must be > 0 — band skipped.",
        at_norm: centroidNorm(s.verts_norm),
      });
    } else if (band && !rings) {
      warnings.push({
        condition_id: cond.id,
        shape_id: s.id,
        finish_tag,
        sheet_id,
        kind: "band_skipped",
        detail: `Band skipped: room too small for a ${band.width_ft}ft band at ${band.offset_ft}ft offset.`,
        at_norm: centroidNorm(s.verts_norm),
      });
    }

    const solveSetup = effectiveTileSetup({ tile_setup, tile_layout: s.tile_layout, ring_ft: fieldRing_ft, holes_ft });
    const { config, classified } = solveTileLayout({ tile_setup: solveSetup, ring_ft: fieldRing_ft, holes_ft });
    const halfW_in = config.w_in / 2;
    const halfH_in = config.h_in / 2;

    for (const c of classified) {
      if (c.cls === "cut" && c.cut && (c.cut.w_in < halfW_in || c.cut.h_in < halfH_in)) {
        warnings.push({
          condition_id: cond.id,
          shape_id: s.id,
          finish_tag,
          sheet_id,
          kind: "sliver",
          detail: `Cut tile ${c.cut.w_in.toFixed(2)}in × ${c.cut.h_in.toFixed(2)}in is under half the ${config.w_in}in × ${config.h_in}in tile — hard to cut cleanly, ugly at the grout line.`,
          at_norm: [c.quad.cx / upp / dims.w, c.quad.cy / upp / dims.h],
        });
      } else if (c.cls === "hole" && c.cut) {
        // classifyLayout never attaches `cut` to a "hole" cell today (a
        // tile fully swallowed by a hole reports cls:"hole" with no cut
        // metadata); this branch exists per design §2.I for the day a
        // hole-straddled tile carries its own cut dims, without inventing
        // that geometry here.
        warnings.push({
          condition_id: cond.id,
          shape_id: s.id,
          finish_tag,
          sheet_id,
          kind: "hole_cut",
          detail: "A hole straddles this tile; it will need a custom cut.",
          at_norm: [c.quad.cx / upp / dims.w, c.quad.cy / upp / dims.h],
        });
      }
    }
  }

  return warnings;
}
