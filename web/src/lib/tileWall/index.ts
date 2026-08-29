// web/src/lib/tileWall/index.ts
//
// Wall orchestration — wrap AND reset modes (design tasks 5 and 6,
// 2026-08-29 wall-tile-slice-a). The single entry point tileTakeoff.js's
// per-shape loop calls for a `surface_area` shape — the wall counterpart of
// tileTakeoff.js's own `summarizeShape` (floor). Pipeline: unwrapRun (Task 1:
// L-run verts → {L_ft, strip_ring, folds} or null on a reversing/degenerate
// run) → effectiveCornerMode (Task 6: resolves wrap vs reset — a per-corner
// override wins, else tile_setup.wall_corner_mode, else the pattern default,
// which is "reset" for herringbone/diagonal since a phase-locked field can't
// wrap a corner without a visible seam break) → for WRAP, ONE
// wallEffectiveTileSetup (Task 2: U-only balanced origin, V pinned 0) +
// solveTileLayout call against the full unwrapped L×H strip; for RESET, the
// SAME two calls run ONCE PER SUB-STRIP (the run split at every fold —
// inside and outside — into [u_{k-1},u_k] segments, each its own
// independently-balanced L_seg×H strip) and the sub-strips' `classified`
// arrays are concatenated into one merged layout (M5 — see below) →
// wallCorners (Task 3: wrap reclassifies the field cells an inside fold's
// u_ft straddles full|cut→corner; reset reclassifies nothing — each
// sub-strip's own end column is already a real `cut` from its own solve —
// but both emit real `byKind` trim entries for outside folds/exposed
// endpoints) → the SAME tileCounts/countsBySku/tileGroutBags/cutSheet/
// orderTiles the floor path uses, run over wallCorners' RECLASSIFIED
// `classified` (wrap) or the MERGED `classified` (reset) so a consumer
// reading `summary.counts`/`summary.layout.classified` never sees the two
// disagree (mirrors summarizeShape's own "never diverge" posture,
// tileTakeoff.js:107-108).
//
// M5 (binding, reset only): `summary.layout.classified` MUST be the
// concatenation of EVERY sub-strip's cells, never just the first —
// tileTakeoff.js:356's condition-level `agg.classified.push(...summary.
// layout.classified)` feeds the multi-SKU order split/reuse pooling
// (:423-424,448,485), so a multi-SKU reset wall whose merge dropped a
// sub-strip would silently order from a fraction of its own cells.
// `summary.wallStrips` carries the RAW per-sub-strip layouts (for
// rendering) — wrap keeps its own one-element convention (`wallStrips[0] ===
// summary.layout`, the reclassified layout); reset's sub-strips are never
// individually reclassified (wallCorners' reset branch is a no-op clone), so
// there is no reclassified-vs-raw distinction to preserve there.
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
import { unwrapRun, wallStripRing, type Fold } from "./unwrap.ts";
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
  // Task 8 (panel elevation-strip preview) — the SAME `folds` unwrapRun
  // produced (u_ft along the WHOLE run, inside/outside kind, run-vertex
  // index), carried through untouched so a per-shape consumer (TilePanel's
  // elevation SVG) can draw corner fold-lines and label each fold
  // inside/outside without re-deriving them from raw verts_norm itself.
  folds: Fold[];
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

// A phase-locked pattern (herringbone/diagonal) can't wrap continuously
// around a corner without a visible seam break mid-tile — the pattern's own
// 45°/interlocking geometry only reads cleanly against a straight run — so
// those two patterns default to "reset" (each wall segment its own
// balanced sub-strip) rather than wrap's single continuous strip. Every
// other pattern keeps wrapping as the default.
function patternDefaultCornerMode(pattern: TileSetup["pattern"]): "wrap" | "reset" {
  return pattern === "herringbone" || pattern === "diagonal" ? "reset" : "wrap";
}

// Mode-selection precedence (design §4.5, binding ruling 1): a per-corner
// override (`wallShape.wall_corner_overrides`, keyed by the SAME run-vertex
// index `Fold.vertexIndex` uses — tileSetup.ts:47-49) wins outright over the
// condition-level `tile_setup.wall_corner_mode`, which itself wins over the
// pattern default above. This resolves to ONE overall mode for the whole
// run — both the reset sub-strip split below and the single `wallCorners`
// call operate on the WHOLE run, not per-fold — so when more than one fold
// carries a DIFFERENT override, the first fold in the run's own u_ft order
// wins. A truly mixed-mode single run (one corner wrap, another reset) is
// out of scope for this slice — no test exercises it, and supporting it for
// real would need wallCorners itself to accept a per-fold mode, not just an
// overall one.
function effectiveCornerMode(
  tile_setup: TileSetup,
  wallShape: WallShapeInput,
  folds: Fold[],
): "wrap" | "reset" {
  for (const fold of folds) {
    const override = wallShape.wall_corner_overrides?.[fold.vertexIndex]?.mode;
    if (override) return override;
  }
  return tile_setup.wall_corner_mode ?? patternDefaultCornerMode(tile_setup.pattern);
}

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

  const corner_mode = effectiveCornerMode(tile_setup, wallShape, folds);
  const edge_finish = tile_setup.wall_edge_finish ?? "profile";
  // Array.isArray, not just `?? [false,false]`: untrusted/imported shape data
  // (MCP import_takeoff, a corrupted persisted project) isn't guaranteed to
  // match WallShapeFields' declared tuple type at runtime, and wallCorners
  // `for...of`-iterates this value -- a non-iterable value here would throw
  // and take the WHOLE shared takeoff loop down with it, exactly the failure
  // mode REJECT-BEFORE-LOOP exists to prevent. Same "corrupt payload reads
  // as the safe default" posture as tileSetup.ts's own runtime guards.
  // `.slice(0, 2)`: a run only has two ends -- a corrupt/imported array
  // longer than 2 would otherwise have wallCorners' `for...of` iterate every
  // extra element and over-count wall_end trim; a shorter-than-2 array is
  // left as-is (a missing index reads as falsy/not-exposed, same as today).
  const endpoint_exposed: [boolean, boolean] = Array.isArray(wallShape.endpoint_exposed)
    ? (wallShape.endpoint_exposed.slice(0, 2) as [boolean, boolean])
    : [false, false];

  // `subStrips` is non-null ONLY in reset mode — it holds the raw, per-
  // sub-strip solves (Task 6's `wallStrips`, unmodified by wallCorners,
  // which never reclassifies a reset corner's cells). `layoutForCorners` is
  // what wallCorners actually classifies against: wrap's own single-strip
  // `layout`, or reset's SYNTHETIC whole-run layout whose `classified` is
  // the concatenation of every sub-strip's cells (M5 — never just the
  // first). `cornersTileSetup` is whichever TileSetup wallCorners reads for
  // its module-height/courses figure — that figure only depends on
  // h_in/joint_in (tileConfig), never origin, so a reset run's raw
  // condition-level `tile_setup` is exactly as correct there as any one
  // sub-strip's own origin-resolved setup would be.
  let subStrips: TileLayout[] | null = null;
  let layoutForCorners: TileLayout;
  let cornersTileSetup: TileSetup;

  if (corner_mode === "reset") {
    // Split the run at EVERY fold — inside and outside alike, an outside
    // corner breaks a straight run just as much as an inside one — into
    // [u_{k-1}, u_k] segments; the two run endpoints (0 and L_ft) bound the
    // first/last segment. A run with F folds always produces exactly F+1
    // sub-strips (F=0 -> 1 sub-strip, byte-identical to wrap for that shape
    // — ruling 4). Each segment is its OWN wallStripRing, solved
    // independently through the SAME wallEffectiveTileSetup + solveTileLayout
    // pair wrap uses for the whole run — U rebalances from that segment's
    // own centerline, V stays pinned to the shared floor datum 0.
    //
    // A duplicated interior vertex (zero-length edge) clears BOTH
    // collapseCollinear's drop test and unwrapRun's U-turn reject (cross AND
    // dot are both exactly 0), so it can surface as a fold at the SAME u_ft
    // as its neighbor -- boundaries then contains a repeat, producing a
    // zero-length segment here. Left as-is deliberately: wallStripRing(0,H)
    // -> solveTileLayout's own ringBounds guard (`!(maxX>minX)`) returns an
    // empty layout (no throw, no warning), so it just degrades to one extra
    // empty wallStrips entry rather than corrupting the F+1 invariant by
    // filtering it out.
    //
    // `wallShape.tile_layout.origin`, when pinned, is passed to EVERY
    // sub-strip's wallEffectiveTileSetup call literally as-is (never
    // translated by this segment's own start offset) -- each sub-strip's
    // ring is re-based to start at LOCAL u=0 (wallStripRing's own contract),
    // so a pinned origin is read as "this many feet from THIS segment's own
    // start", i.e. phase-consistent across every sub-strip, not "this many
    // feet from the whole run's start". Untested (no fixture pins a
    // reset+pinned-origin combination); the renderer/Task 7 is the first
    // real consumer that would need to agree with this reading.
    const boundaries = [0, ...folds.map((f) => f.u_ft), L_ft];
    const strips: TileLayout[] = [];
    for (let i = 1; i < boundaries.length; i++) {
      const segLen = boundaries[i] - boundaries[i - 1];
      const segRing = wallStripRing(segLen, resolvedHeight_ft);
      const segSetup = wallEffectiveTileSetup({
        tile_setup,
        strip_ring: segRing,
        tile_layout: wallShape.tile_layout,
      });
      strips.push(solveTileLayout({ tile_setup: segSetup, ring_ft: segRing }));
    }
    subStrips = strips;
    layoutForCorners = {
      config: strips[0].config,
      bounds: strips[0].bounds,
      quads: strips.flatMap((w) => w.quads),
      classified: strips.flatMap((w) => w.classified),
      warnings: strips.flatMap((w) => w.warnings || []),
    };
    cornersTileSetup = tile_setup;
  } else {
    const solveSetup = wallEffectiveTileSetup({
      tile_setup,
      strip_ring,
      tile_layout: wallShape.tile_layout,
    });
    layoutForCorners = solveTileLayout({ tile_setup: solveSetup, ring_ft: strip_ring });
    cornersTileSetup = solveSetup;
  }

  const corners = wallCorners({
    folds,
    H_ft: resolvedHeight_ft,
    tile_setup: cornersTileSetup,
    layout: layoutForCorners,
    corner_mode,
    edge_finish,
    endpoint_exposed,
  });

  // Every downstream figure (counts, sku split, grout, cutsheet, order)
  // reads the RECLASSIFIED/merged `classified` — never `layoutForCorners`'s
  // own pre-corners value — so a consumer of `summary.counts` and a
  // consumer of `summary.layout.classified` (the canvas overlay, the
  // multi-SKU/reuse pooling in tileTakeoff.js's byCond finalize) can never
  // disagree about which cells are corners, or (reset) about which cells
  // exist at all. `reclassifiedLayout` is a shallow copy of
  // `layoutForCorners` with only `classified` swapped — config/bounds/quads/
  // warnings stay whichever branch above produced.
  const classified = corners.classified;
  const reclassifiedLayout: TileLayout = { ...layoutForCorners, classified };
  // wrap: the one-element convention pins `wallStrips[0] === summary.layout`
  // (the SAME reclassified layout object). reset: `wallStrips` is the raw
  // per-sub-strip array — never individually reclassified, since wallCorners'
  // reset branch is a no-op clone — so there is no reclassified-vs-raw
  // distinction to preserve there.
  const wallStrips: TileLayout[] = subStrips ?? [reclassifiedLayout];

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

  const warnings = [layoutWarning(tile_setup), ...unwrapWarnings, ...(layoutForCorners.warnings || [])].filter(
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
    wallStrips,
    extent_sf: L_ft * resolvedHeight_ft,
    folds,
  };
}
