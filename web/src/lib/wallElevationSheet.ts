// web/src/lib/wallElevationSheet.ts
//
// Task 2 (2026-08-29 wall-tile-slice-b) — the pure comparator behind
// TakeoffCanvas.jsx's generateWallElevationSheet handler's dims-change
// confirm guard (I1, plan review): regenerating a wall whose PREVIOUSLY
// generated elevation sheet is bound to shapes must warn before replacing
// it if the wall's drawn dims changed (marks on the old sheet may no
// longer line up), but a same-dims regen (SKU/color only, M4) must NEVER
// prompt. Kept out of TakeoffCanvas.jsx so this comparison is unit-testable
// without a DOM/React harness — the handler itself is UI-glue, verified by
// the browser smoke instead.
//
// EPS mirrors the house tolerance TakeoffCanvas.jsx already uses for its
// own scale-mismatch float compares (e.g. `Math.abs(scaleDet.upp - upp) >
// 1e-9` at the scale chip). `next` here comes from a fresh
// wallElevationLayout/buildWallElevationPdf call (tileWallElevation.ts);
// `prev` comes from a JSON round-trip through the annotations payload — a
// same wall/same tile_setup regen is deterministic (no Date/Math.random
// anywhere in the geometry path, same as wallElevationPdf.ts's own
// determinism story) so exact equality would likely hold too, but the
// epsilon costs nothing and guards against any future float-noise source
// without risking a false negative (a REAL size change differs by inches,
// not by 1e-9 ft).
const EPS = 1e-9;

export type WallElevDims = { width_ft: number; height_ft: number };

// `prev` is null/undefined the first time a wall is generated (nothing
// persisted yet to compare against) — never a confirm in that case, only
// on an actual, later, size change.
export function dimsChanged(prev: WallElevDims | null | undefined, next: WallElevDims): boolean {
  if (!prev) return false;
  return Math.abs(prev.width_ft - next.width_ft) > EPS || Math.abs(prev.height_ft - next.height_ft) > EPS;
}
