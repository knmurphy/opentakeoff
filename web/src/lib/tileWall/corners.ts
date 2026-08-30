// web/src/lib/tileWall/corners.ts
//
// Run-keyed corners, trim, and movement joints (design task 3, 2026-08-29
// wall-tile-slice-a). Corner counting is LAYOUT-DRIVEN, not blind: a
// WRAP inside fold reclassifies the ACTUAL field cells the fold's u_ft
// straddles (phase-aware — a fold that lands exactly on a tile boundary
// straddles 0 cells, so it must not phantom-count a corner cut). A RESET
// inside fold reclassifies nothing (each sub-strip solves its own end
// column as a real `cut` — Task 6's job). Both modes still bump
// `corner_inside` and add one H-tall movement joint.
//
// Edge finishes (outside corners + exposed run endpoints) emit REAL
// `byKind` entries in the exact shape tileTakeoff.js's aggregation already
// consumes (:370-385 accumulates trimByKind/trimTotals ONLY inside
// `if (summary.trim.byKind.length)`, and :507-522 only emits the trim
// section under that same `hasTrim` gate) — an empty `byKind` would
// silently drop all wall trim/joint/corner numbers from the report, so
// every outside fold / exposed endpoint under a real edge_finish MUST push
// an entry, never just accumulate a bare count.
import type { TileSetup } from "../tileSetup.ts";
import { tileConfig } from "../tileSetup.ts";
import type { TileLayout } from "../tileSolve.ts";
import type { Classified } from "../tileGeometry/classify.ts";
import type { Fold } from "./unwrap.ts";

export type WallTrimKind = { exposure: string; length_lf: number; pieces: number; finish_neighbor: string };
export type WallTrim = {
  byKind: WallTrimKind[]; length_lf: number; pieces: number;
  corner_outside: number; corner_inside: number;
};
export type WallJoints = {
  perimeter_lf: number; field_lf: number; transition_lf: number;
  total_lf: number; fieldGridSpacing_ft: number;
};
export type WallCornerResult = {
  // WRAP: straddlers at inside folds reclassified full/cut→corner
  // (phase-aware). RESET: a per-cell clone of layout.classified, values
  // unchanged (never an alias into the caller's memoized layout).
  classified: Classified[];
  trim: WallTrim;   // byKind = edge finishes (outside corners + exposed endpoints); corner_* counts
  joints: WallJoints; // inside-only: perimeter_lf=0, field_lf=0, transition_lf=0, total_lf = Σ inside-fold H
};

// `faceLen_ft`/`facePieces` are the ALREADY-SCALED totals for this entry
// (1x for a single exposed endpoint face, 2x for an outside corner's two
// faces) — the caller does the ×1/×2 scaling; this just picks length_lf vs
// pieces by finish.
function edgeFinishEntry(
  edge_finish: "profile" | "bullnose" | "miter",
  exposure: string,
  faceLen_ft: number,
  facePieces: number,
): WallTrimKind {
  // Bullnose is a SKU swap, not an extra field cut (spec §5): the slot count
  // IS the order for those pieces, so it carries `pieces`, never `length_lf`.
  // profile/miter are strip goods measured by run length (miter's length is
  // labor, not material, but it's still an LF figure in this shape).
  if (edge_finish === "bullnose") {
    return { exposure, length_lf: 0, pieces: facePieces, finish_neighbor: "bullnose" };
  }
  return { exposure, length_lf: faceLen_ft, pieces: 0, finish_neighbor: edge_finish };
}

export function wallCorners(args: {
  folds: Fold[];
  H_ft: number;
  tile_setup: TileSetup;
  layout: TileLayout;
  corner_mode: "wrap" | "reset";
  edge_finish: "profile" | "bullnose" | "miter";
  endpoint_exposed: [boolean, boolean];
}): WallCornerResult {
  const { folds, H_ft, tile_setup, layout, corner_mode, edge_finish, endpoint_exposed } = args;

  const cfg = tileConfig(tile_setup);
  const moduleH_ft = (cfg.h_in + cfg.joint_in) / 12;
  const courses = moduleH_ft > 0 ? Math.floor(H_ft / moduleH_ft) : 0;

  // Clone (shallow, per-cell) rather than alias: layout.classified is the
  // caller's memoized solve result (tileSolve.ts's own header flags it lives
  // inside a React useMemo) — handing back a reference into it would let a
  // wrap reclassify mutate-by-reference into the caller's cached layout.
  let classified: Classified[] = layout.classified.map((c) => ({ ...c }));
  let corner_inside = 0;
  let corner_outside = 0;
  const byKind: WallTrimKind[] = [];

  for (const fold of folds) {
    if (fold.kind === "inside") {
      corner_inside += 1;
      if (corner_mode === "wrap") {
        const uK = fold.u_ft;
        // Straddle predicate: quad is CENTER-based {cx,cy,w,h,rot} (no
        // quad.x) — the fold strictly contains a cell's x-span when
        // cx - w/2 < u_k < cx + w/2. Strict inequality is what makes this
        // phase-aware: a fold sitting exactly on a tile boundary (u_k ==
        // cx ± w/2) contains 0 cells, so it reclassifies nothing rather
        // than phantom-counting a corner. `full` OR `cut` → `corner`: a
        // top-course `cut` cell that ALSO crosses the fold is still one
        // physical tile that gets mitred at the fold, so it must still
        // become a corner (reclassifying only `full` would under-count
        // corner EA by ~1 course whenever H isn't an exact multiple of the
        // module height).
        classified = classified.map((c) => {
          if (c.cls !== "full" && c.cls !== "cut") return c;
          const halfW = c.quad.w / 2;
          const lo = c.quad.cx - halfW, hi = c.quad.cx + halfW;
          if (uK > lo && uK < hi) return { ...c, cls: "corner" };
          return c;
        });
      }
      // RESET: no reclassification — each sub-strip's own end column is a
      // real `cut` from its own solve (Task 6).
    } else {
      // Outside fold: 2 exposed faces meet at the corner, both finished the
      // same way.
      corner_outside += 1;
      byKind.push(edgeFinishEntry(edge_finish, "wall_outside_corner", 2 * H_ft, 2 * courses));
    }
  }

  // Exposed run endpoints: one face each, same finish as the run's edge.
  for (const exposed of endpoint_exposed) {
    if (!exposed) continue;
    byKind.push(edgeFinishEntry(edge_finish, "wall_end", H_ft, courses));
  }

  const length_lf = byKind.reduce((s, k) => s + k.length_lf, 0);
  const pieces = byKind.reduce((s, k) => s + k.pieces, 0);

  const trim: WallTrim = { byKind, length_lf, pieces, corner_outside, corner_inside };
  const joints: WallJoints = {
    perimeter_lf: 0, field_lf: 0, transition_lf: 0,
    total_lf: corner_inside * H_ft, fieldGridSpacing_ft: 0,
  };

  return { classified, trim, joints };
}
