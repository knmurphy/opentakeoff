// web/src/lib/wallWrapped.ts
//
// Task 1 (2026-08-29 wall-tile-slice-c) — the wrapped/fanned elevation
// view's bend transform. wallElevationLayout (tileWallElevation.ts) lays a
// wall run's tiles out FLAT along u (0..width_ft), with folds noted as
// x-positions only -- it never bends anything. This module takes that
// same flat tile list plus each fold's PLAN turn angle and hinges each
// post-fold run about its corner, so a corner drawn at 90° in plan reads
// as an actual 90° bend in the elevation, not a straight seam.
//
// PURE geometry only (Math, no DOM/React/deps) so it composes with any
// renderer -- an SVG, a canvas, a future 3D view -- without dragging
// tileOverlay along. Deterministic; never mutates its input tile array.
//
// THE TRANSFORM CHAIN: segment i (the run between fold i-1 and fold i,
// 0-indexed with segment 0 being pre-first-fold) needs a single rigid
// (rotation + translation) map from FLAT elevation space into WRAPPED
// space. Rather than track an angle and an offset separately, each
// segment's map is a 2x3 affine matrix built by composing pure rotations
// as folds accumulate left-to-right:
//   - segment 0's matrix is identity (nothing bent it yet).
//   - crossing fold k does two things: (a) its hinge pivot is fold k's
//     floor point (foldsU[k], 0) run through the PRE-fold-k matrix (i.e.
//     where that point already landed after all EARLIER folds) -- NOT a
//     flat (foldsU[k], 0), because after fold k-1 that point itself is no
//     longer axis-aligned with the original strip; (b) segment k+1's
//     matrix is "rotate by turnAngles[k] about that pivot" COMPOSED WITH
//     (applied after) the running matrix.
// A pure rotation-about-a-point is itself an affine map (linear rotation
// plus a translation that keeps the pivot fixed), so this composition
// stays a single 2x3 matrix per segment with no separate pivot bookkeeping
// at apply time -- each tile's 4 corners just get matrix-multiplied once
// by its own segment's matrix, in the ORIGINAL flat (x,y), not some
// segment-local frame. That works because the composed matrix already
// encodes every earlier hinge's translation.
export type WrappedTile = { pts: [number, number][]; cls: string; color: string };
export type WrappedLayout = {
  tiles: WrappedTile[];
  hinges: { x: number; y: number; kind: string }[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

// 2x3 affine: x' = a*x + c*y + e; y' = b*x + d*y + f.
type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const apply = (m: Mat, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

// Compose m2 AFTER m1 (apply m1 first, then m2) into one matrix.
const compose = (m2: Mat, m1: Mat): Mat => ({
  a: m2.a * m1.a + m2.c * m1.b,
  b: m2.b * m1.a + m2.d * m1.b,
  c: m2.a * m1.c + m2.c * m1.d,
  d: m2.b * m1.c + m2.d * m1.d,
  e: m2.a * m1.e + m2.c * m1.f + m2.e,
  f: m2.b * m1.e + m2.d * m1.f + m2.f,
});

// Rotation by `theta` (radians, + = CCW in this y-up frame) about a fixed
// pivot (px, py), expressed as a single affine matrix.
const rotationAbout = (theta: number, px: number, py: number): Mat => {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return {
    a: cos, b: sin,
    c: -sin, d: cos,
    e: px - px * cos + py * sin,
    f: py - px * sin - py * cos,
  };
};

export function wallWrappedLayout(args: {
  elevationTiles: { x: number; y: number; w: number; h: number; cls: string; color: string }[];
  width_ft: number;
  foldsU: number[];
  foldKinds: string[];
  turnAngles: number[];
}): WrappedLayout {
  const { elevationTiles, width_ft, foldsU, foldKinds, turnAngles } = args;

  // Segment boundaries in flat u; segment i spans [boundaries[i], boundaries[i+1]].
  const boundaries = [0, ...foldsU, width_ft];

  // Build each segment's matrix by walking the folds left to right,
  // accumulating rotations about each fold's running-transformed pivot.
  const segMats: Mat[] = [IDENTITY];
  const hinges: { x: number; y: number; kind: string }[] = [];
  let running = IDENTITY;
  for (let k = 0; k < foldsU.length; k++) {
    const [px, py] = apply(running, foldsU[k], 0);
    hinges.push({ x: px, y: py, kind: foldKinds[k] });
    running = compose(rotationAbout(turnAngles[k], px, py), running);
    segMats.push(running);
  }

  const segCount = boundaries.length - 1;
  const segmentFor = (cx: number): number => {
    let seg = 0;
    for (let i = 0; i < segCount; i++) if (cx >= boundaries[i] - 1e-9) seg = i;
    return seg;
  };

  const tiles: WrappedTile[] = elevationTiles.map(t => {
    const m = segMats[segmentFor(t.x + t.w / 2)];
    const pts: [number, number][] = [
      [t.x, t.y],
      [t.x + t.w, t.y],
      [t.x + t.w, t.y + t.h],
      [t.x, t.y + t.h],
    ].map(([x, y]) => apply(m, x, y));
    return { pts, cls: t.cls, color: t.color };
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of tiles) for (const [x, y] of tile.pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bbox = tiles.length > 0 ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  return { tiles, hinges, bbox };
}

// Task 2 (2026-08-29 wall-tile-slice-c) — the PLAN-side counterpart to the
// bend transform above: `wallWrappedLayout` takes `turnAngles` as an input
// rather than deriving them itself (kept pure/geometry-only, no coupling to
// how a caller happens to know its run's corners), so something upstream of
// it has to turn a run's raw plan vertices into that per-fold angle list.
// This is that something -- TilePanel is the one real caller (it reads the
// selected wall shape's own `verts_norm` + the SAME `folds` the elevation
// strip already draws its dashed fold-lines from), but it's exported and
// tested standalone here because the geometry has nothing to do with React.
//
// SIGN: literal `atan2(cross, dot)` on the incoming/outgoing plan-segment
// vectors, in whatever frame `verts_norm` itself is already in (this repo's
// convention is normalized image space, y DOWN) -- no coordinate flip, no
// face_side sign correction (unwrapRun's OWN inside/outside kind already
// folds face_side in; this helper answers a narrower question -- "which way
// does the run's plan direction bend" -- independent of which side is
// tiled). Passed straight through to `wallWrappedLayout`'s `turnAngles` with
// no further adjustment; the on-screen bend direction that produces is a
// rendering question the caller's own visual check settles, not something
// this pure function can decide by staring at the formula harder.
export function runTurnAngles(
  verts_norm: [number, number][] | null | undefined,
  folds: { vertexIndex: number }[] | null | undefined,
): number[] {
  const verts = Array.isArray(verts_norm) ? verts_norm : [];
  const fs = Array.isArray(folds) ? folds : [];
  return fs.map((f) => {
    const i = f.vertexIndex;
    const a = verts[i - 1], b = verts[i], c = verts[i + 1];
    if (!a || !b || !c) return 0; // out-of-range vertexIndex (defensive, shouldn't happen for a real fold) — no bend rather than NaN
    const inx = b[0] - a[0], iny = b[1] - a[1];
    const outx = c[0] - b[0], outy = c[1] - b[1];
    return Math.atan2(inx * outy - iny * outx, inx * outx + iny * outy);
  });
}
