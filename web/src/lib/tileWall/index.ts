// web/src/lib/tileWall/index.ts
//
// Wall orchestration, wrap mode (design task 5, 2026-08-29 wall-tile-slice-a).
// The single entry point tileTakeoff.js's per-shape loop calls for a
// `surface_area` shape — the wall counterpart of tileTakeoff.js's own
// `summarizeShape` (floor). Pipeline: unwrapRun (Task 1: L-run verts →
// {L_ft, strip_ring, folds} or null on a reversing/degenerate run) →
// wallEffectiveTileSetup (Task 2: U-only balanced origin, V pinned 0) →
// solveTileLayout (the SAME field solver the floor uses, against the
// unwrapped L×H strip) → wallCorners (Task 3, wrap: reclassifies the field
// cells an inside fold's u_ft straddles full|cut→corner; emits real `byKind`
// trim entries for outside folds/exposed endpoints) → the SAME
// tileCounts/countsBySku/tileGroutBags/cutSheet/orderTiles the floor path
// uses, run over wallCorners' RECLASSIFIED `classified` so a consumer
// reading `summary.counts`/`summary.layout.classified` never sees the two
// disagree (mirrors summarizeShape's own "never diverge" posture,
// tileTakeoff.js:107-108).
//
// A null unwrapRun (reversing run, or fewer than 2 verts) returns
// `{ ok: false, reason }` INSTEAD OF a summary — never a partial/zeroed one.
// The caller (tileTakeoff.js's REJECT-BEFORE-LOOP) must check `ok` and
// exclude the shape before it ever reaches the shared byCond aggregation
// loop; a partial summary reaching that loop would corrupt every accumulator
// it touches (counts, cutsheet rows, classified cells) with garbage.
import { primaryUsableSku, type TileSetup, type WallShapeFields } from "../tileSetup.ts";
import { solveTileLayout, type TileLayout } from "../tileSolve.ts";
import { tileCounts, countsBySku, type TileCounts } from "../tileCalc/tiles.ts";
import { tileGroutBags } from "../tileCalc/grout.ts";
import { cutSheet, type CutRow } from "../tileCalc/cutsheet.ts";
import { orderTiles, type TileOrder } from "../tileCalc/order.ts";
import { layoutWarning } from "../tilePatterns/index.ts";
import { unwrapRun } from "./unwrap.ts";
import { wallEffectiveTileSetup } from "./origin.ts";
import { wallCorners, type WallTrim, type WallJoints } from "./corners.ts";

// The wall counterpart of tileTakeoff.js's `s` (a shape record) — only the
// fields this module actually reads. `tile_layout` here is the SAME
// per-room origin/rotation override the floor path reads (shapeCommands.js/
// TilePanel already write it identically for a wall shape); height and
// measure_role are NOT read here — the caller resolves height (mirroring
// shapeMetrics.js:25-27) and gates on measure_role BEFORE calling in.
export type WallShapeInput = WallShapeFields & {
  verts_norm: [number, number][];
  tile_layout?: { origin?: [number, number]; rotation?: number } | null;
};

export type WallSummarizeFailure = { ok: false; reason: string };
export type WallSummary = {
  // Never actually present on a real success object (the return below
  // builds a plain literal with no `ok` key) -- declared `?: undefined`
  // purely so `SummarizeWallResult` narrows as a clean discriminated union
  // on `ok` for callers/tests, without requiring an `as` cast at every
  // access site.
  ok?: undefined;
  counts: TileCounts;
  bySku: Map<string, TileCounts>;
  grout: { bags: number; sfPerBag: number; joint_in: number; note: string };
  cutsheet: CutRow[];
  order: TileOrder;
  warnings: string[];
  layout: TileLayout;
  ring_ft: [number, number][];
  trim: WallTrim;
  joints: WallJoints;
  wallStrips: TileLayout[];
  extent_sf: number;
};
export type SummarizeWallResult = WallSummarizeFailure | WallSummary;

// Wall material overage: a wall's field waste runs hotter than a floor's
// (more cuts per SF at typical wainscot/shower heights, mitred corners,
// end returns) — 0.10 (a FRACTION, matching orderTiles' own breakage_pct
// contract) is the wall path's OWN default, applied ONLY here so a floor's
// order (still `?? 0.05` inside orderTiles) never changes. An explicit
// `tile_setup.purchase.breakage_pct` still wins outright — this is a
// default, not a floor on the user's own figure.
// Exported so tileTakeoff.js's condition-level order recompute (the REPORTED
// figure, not just this per-shape one) can reuse the SAME constant — the
// per-shape and condition-level wall rates must never drift apart.
export const WALL_DEFAULT_BREAKAGE_PCT = 0.10;

export function summarizeWallShape(
  tile_setup: TileSetup,
  wallShape: WallShapeInput,
  dims: { w: number; h: number },
  upp: number,
  resolvedHeight_ft: number,
): SummarizeWallResult {
  // A non-positive height (no cond.height_ft anywhere in the resolve chain,
  // or an explicit height_override:true/height_ft:0 — both legitimate per
  // shapeMetrics.js:21-27) collapses `wallStripRing(L, H)` to a zero-area
  // rectangle: solveTileLayout's own ringBounds guard (`!(maxY > minY)`)
  // then returns an empty classified with NO warning, so counts/order all
  // read as honest zeros. But `wallCorners` counts folds from geometry
  // alone — a fold's corner_inside/corner_outside bump is independent of
  // H_ft — so an inside/outside fold on a zero-height run would still trip
  // the GATE-WIDEN in tileTakeoff.js and fabricate a trim/joints block for
  // a wall with no actual height. Reject before any of that runs, exactly
  // like an unwrappable run — never a partial/zeroed summary.
  if (!(resolvedHeight_ft > 0)) return { ok: false, reason: "no_height" };

  const face_side = wallShape.face_side ?? "left";
  const unwrapped = unwrapRun({
    verts_norm: wallShape.verts_norm,
    dims,
    upp,
    H_ft: resolvedHeight_ft,
    face_side,
  });
  if (!unwrapped) return { ok: false, reason: "reversing_or_degenerate" };

  const { L_ft, strip_ring, folds, warnings: unwrapWarnings } = unwrapped;

  const solveSetup = wallEffectiveTileSetup({
    tile_setup,
    strip_ring,
    tile_layout: wallShape.tile_layout,
  });
  const layout = solveTileLayout({ tile_setup: solveSetup, ring_ft: strip_ring });

  const corner_mode = tile_setup.wall_corner_mode ?? "wrap";
  const edge_finish = tile_setup.wall_edge_finish ?? "profile";
  // Array.isArray, not just `?? [false,false]`: untrusted/imported shape data
  // (MCP import_takeoff, a corrupted persisted project) isn't guaranteed to
  // match WallShapeFields' declared tuple type at runtime, and wallCorners
  // `for...of`-iterates this value -- a non-iterable value here would throw
  // and take the WHOLE shared takeoff loop down with it, exactly the failure
  // mode REJECT-BEFORE-LOOP exists to prevent. Same "corrupt payload reads
  // as the safe default" posture as tileSetup.ts's own runtime guards.
  const endpoint_exposed: [boolean, boolean] = Array.isArray(wallShape.endpoint_exposed)
    ? wallShape.endpoint_exposed
    : [false, false];

  const corners = wallCorners({
    folds,
    H_ft: resolvedHeight_ft,
    tile_setup: solveSetup,
    layout,
    corner_mode,
    edge_finish,
    endpoint_exposed,
  });

  // Every downstream figure (counts, sku split, grout, cutsheet, order)
  // reads the RECLASSIFIED `classified` — never the pre-corners `layout`'s
  // own — so a consumer of `summary.counts` and a consumer of
  // `summary.layout.classified` (the canvas overlay, the multi-SKU/reuse
  // pooling in tileTakeoff.js's byCond finalize) can never disagree about
  // which cells are corners. `layout` itself is a shallow copy with only
  // `classified` swapped — config/bounds/quads/warnings stay the solver's
  // own.
  const classified = corners.classified;
  const reclassifiedLayout: TileLayout = { ...layout, classified };

  const counts = tileCounts(classified);
  const bySku = countsBySku(classified);
  const grout = tileGroutBags({ tile_setup, keptArea_sf: counts.keptArea_sf });
  const cutsheet = cutSheet(classified);
  // Non-null: the caller (tileTakeoff.js's computeTileTakeoff) only reaches
  // this module for a condition that already passed `hasTileSetup`
  // (skus.some(usableSku)) — mirrors summarizeShape's own unchecked
  // `primaryUsableSku(tile_setup)` call at the same seam (tileTakeoff.js:175).
  const order = orderTiles({
    safeCount: counts.safe,
    sku: primaryUsableSku(tile_setup)!,
    breakage_pct: tile_setup.purchase?.breakage_pct ?? WALL_DEFAULT_BREAKAGE_PCT,
    attic_pct: tile_setup.purchase?.attic_pct,
  });

  const warnings = [layoutWarning(tile_setup), ...unwrapWarnings, ...(layout.warnings || [])].filter(
    (w): w is string => Boolean(w),
  );

  return {
    counts,
    bySku,
    grout,
    cutsheet,
    order,
    warnings,
    layout: reclassifiedLayout,
    ring_ft: strip_ring,
    trim: corners.trim,
    joints: corners.joints,
    wallStrips: [reclassifiedLayout],
    extent_sf: L_ft * resolvedHeight_ft,
  };
}
