// One-Click Area — v1 geometry core (pure, no DOM; node-testable).
//
// Click inside a room → flood-fill bounded by the plan's vector linework →
// traced polygon, vertices snapped. The pipeline:
//   extractVectorGeometry  PDF op list → line segments + snap endpoints (image px)
//   buildMask              segments → downscaled 1-bit boundary raster
//   floodRegion            seed → bounded region (or "leak"/"tiny"/"boundary")
//   traceRegion            region → outer contour → RDP-simplified polygon (image px)
//
// A single-pixel Bresenham barrier is 8-connected, which provably blocks the
// 4-connected scanline fill — no dilation, so the boundary sits ~half a mask px
// inside the drawn line (sub-inch at plan scales). Text never blocks fills
// (glyphs are showText ops, not constructPath). The caller owns the
// propose → review → Create gate.
//
// Hatch (2026-07-05): hatch/poché strokes are constructPath linework too, so a
// naive mask traps the fill between hatch lines. The cure is a TIERED mask —
// walls plot bit 1, segments classified as hatch (members of a periodic
// parallel family — classifyHatchSegs) plot bit 2 — plus an escalating flood:
// the primary pass treats both as barrier (bit-identical to the original), and
// when it comes back trapped (tiny/boundary), predominantly hatch-bounded (a
// tile-grid cell), or MODERATELY hatch-bounded (a hatch-lined room — issue #32),
// a second pass re-floods with hatch transparent. The moderate tier is the only
// one bounded: it accepts the re-flood only if the area growth stays within a cap
// (grow-but-verify). If the escalated pass leaks, stays tiny, or balloons, the
// primary result stands — a misclassified wall can never make the tool worse
// than the strict mask.

export type Point = [number, number];
export interface OpList { fnArray: number[]; argsArray: any[]; }  // per-op args array, or null for arg-less ops
/** pdf.js's OPS code table (op name → numeric code); passed in so this module never imports pdfjs. */
export type OpsTable = Record<string, number>;
/** meta: one byte per segment — SEG_* bits + device line width in the high nibble.
 *  imageArea: total placed image area in device px² (scan/photo underlay detection). */
export interface VectorGeometry { points: Point[]; segs: number[]; meta: Uint8Array; imageArea: number; }
export interface MaskObj { mask: Uint8Array; mw: number; mh: number; ws: number; softCount: number; mppf?: number; }  // mppf: mask px per foot (0/absent = scale unknown)
export interface RegionResult { region: Uint8Array; mw: number; mh: number; ws: number; count?: number; }
export type FloodResult =
  | { status: "boundary" }
  | { status: "leak" }
  | { status: "tiny"; count: number }
  | { status: "ok"; region: Uint8Array; count: number; mw: number; mh: number; ws: number; mppf?: number; hardHits?: number; softHits?: number; hatchFiltered?: boolean; sealedPx?: number; virtualFrac?: number; wedges?: number; wedgeGrowth?: number };
/** Caller's snap-grid lookup: nearest true endpoint to (x,y) within maxDist, or null. */
export type NearestFn = (x: number, y: number, maxDist: number) => Point | null | undefined;

export const MASK_MAX_DIM = 3000;   // working raster cap (Uint8 ≈ 6–7 MB)
const LEAK_FRACTION = 0.30;         // fill > 30% of the sheet ⇒ not an enclosed space (ws-invariant: a fraction)
const CURVE_STEPS = 8;              // chords per bezier (door swings stay closed)

// ── resolution-independent thresholds (RFC failure mode #3) ─────────────────
// A verdict must not depend on the working raster's resolution, so every
// threshold that MEANS something physical is denominated in FEET and converted
// through the sheet scale (MaskObj.mppf). The px values are (a) the exact
// calibration point — all four ft constants reproduce the historical px
// behavior bit-for-bit at 18 mask px/ft, the corpus convention — and (b) the
// fallback when the scale is unknown, plus raster-honesty FLOORS below which
// a threshold can't shrink (you cannot tell a 1-cell room from noise no
// matter what the feet say).
const CAL_MPPF = 18;                    // calibration resolution (mask px per foot)
const TINY_PX = 30;                     // fill < this many mask px ⇒ landed in dense linework
export const TINY_SF = TINY_PX / (CAL_MPPF * CAL_MPPF);        // ≈ 0.093 SF
const TINY_PX_FLOOR = 8;
const MIN_THICK = 4;                    // region bbox thinner than this ⇒ hatch sliver, not a room
export const MIN_THICK_FT = MIN_THICK / CAL_MPPF;              // ≈ 0.22 ft
const MIN_THICK_FLOOR = 2;
const NUDGE_PX = 3;                     // seed nudge: nearest open cell (clicks land on hatch lines)
export const NUDGE_FT = NUDGE_PX / CAL_MPPF;                   // = 2 inches
// Openings narrower than this never connect two spaces — a slit between an
// annotation leader tip and a wall corner, a hairline drafting gap. Without a
// feet-true rule the answer depends on which side of a cell boundary the
// linework rounds to at the current resolution (bench: ward-room lost
// its vestibule through exactly such a slit at ws × 0.5 only).
export const MIN_PASS_FT = 0.5;
/** Dilation radius that closes sub-MIN_PASS_FT passages at maskPxPerFt.
 *  0 (rule off) when the scale is unknown or the mask is too coarse to say.
 *  ROUND, not floor: a dilation of r closes AXIS-ALIGNED gaps ≤ 2r (the
 *  Manhattan dilation reaches only r/√2 across a 45° slit, so the rule's
 *  effective threshold for diagonal gaps is ≈ MIN_PASS_FT/√2 — a known
 *  anisotropy, stable across resolutions). The effective threshold
 *  quantizes in TWO-cell steps, so no rounding can implement the half-foot
 *  rule exactly — rounding to nearest centers the error band at
 *  MIN_PASS_FT ± ONE cell (±1/mppf ft). Flooring biased it a full band
 *  low, so a 0.42 ft slit closed at one resolution and stayed open at
 *  another (bench, patient-room-137); ceiling biased it high and severed a
 *  real 0.56 ft waist between two open door leaves (ward room). Features
 *  inside the ± one-cell band remain genuinely undecidable from the raster
 *  at ANY floor — see DETERMINISM_MIN_MPPF for what is and isn't promised. */
export function minPassRadiusFor(maskPxPerFt: number): number {
  if (!Number.isFinite(maskPxPerFt) || maskPxPerFt <= 0) return 0;
  return Math.min(SEAL_R_MAX, Math.round((MIN_PASS_FT * maskPxPerFt) / 2));
}
// The engine's honesty line — a PRAGMATIC CHOICE, not a derivation (an
// earlier comment here claimed to derive it; adversarial review showed the
// claimed band was off by 2× and the criterion didn't follow). What is
// true: the min-passage dilation quantizes its effective threshold to
// MIN_PASS_FT ± one cell (±1/mppf ft), so a drawn feature within a cell of
// the threshold — a 0.56 ft waist, a 0.42 ft slit — is UNDECIDABLE from the
// raster at ANY practical floor, and its verdict can differ between two
// resolutions that are both above this line. The floor bounds the band's
// WIDTH (at 8 px/ft it is ±1.5", a quarter of the threshold), not the
// existence of near-threshold flips; full resolution-independence for
// connectivity needs vector-native topology (RFC item A). In production the
// working raster is pinned by MASK_MAX_DIM, so a given sheet always sees one
// resolution. Consumers: traceConfidence deducts on coarser masks; the bench
// gates cross-resolution agreement only at-or-above the floor (coarser runs
// are tracked, non-gating; a case with fewer than two gated resolutions is
// NOT cross-checked and says so).
export const DETERMINISM_MIN_MPPF = 8;   // mask px per foot (a cell ≤ 1.5")

// segment meta bits (extractVectorGeometry emits, classifyHatchSegs consumes)
export const SEG_CURVE = 1;         // curve chord (bezier tessellation OR a detected polyline arc) — never hatch (door swings close gaps)
export const SEG_CLIP = 2;          // clip-only path (endPath) — invisible ink, never a wall
export const SEG_FILLONLY = 4;      // filled-not-stroked path (solid poché outlines classify normally)
export const SEG_POLYARC = 8;       // provenance: SEG_CURVE came from markPolylineArcs, not a bezier op
// meta high nibble = device line width, ceil'd and capped at 15 (0 = hairline)

// polyline arc detection (markPolylineArcs) — the SHAPE thresholds are
// dimensionless geometry (turn angles, ratios), but detection as a whole is
// NOT scale-free: two of these are absolute image px (the sliver floor at
// markPolylineArcs' length test and circleFitOk's absolute residual slack),
// so a drawing rendered small enough eventually stops resolving its own arcs.
// They are raster-honesty floors, not physical thresholds — which is exactly
// why nothing PHYSICAL (a door leaf's length) may be tested here: this runs
// inside extractVectorGeometry at render time, with no sheet scale. Feet-true
// arc tests live at cluster time instead (see arcClusterFit / DOOR_R_*_FT).
export const ARC_MIN_CHORDS = 4;       // fewer chords is a corner chamfer, not an arc
export const ARC_MIN_TOTAL_TURN = 30;  // deg — shallower chains are gentle wall sweeps; door swings are ~90°
export const ARC_CHORD_TURN_MIN = 2;   // deg — near-collinear chains are straight runs with drafting jitter
export const ARC_CHORD_TURN_MAX = 45;  // deg — sharper turns are zigzags/symbols, not tessellation
export const ARC_FIT_TOL_FRAC = 0.03;  // circle-fit residual cap as a fraction of the radius (ellipse fixtures fail this)

// ── non-door curve discrimination (issue: clouds/columns read as door arcs) ──
// SEG_CURVE answers "is this curved linework?" — true of a column, a revision
// cloud and a door swing alike, and it must stay true of all three (it is what
// exempts them from hatch classification). "Is this a DOOR swing?" is a
// separate question, answered here and carried in its own mask bit, so that
// refusing a cloud can never make its chords hatch-eligible.
// Both of these are dimensionless, so they can run at render time:
export const ARC_CLOSED_TURN = 300;    // deg — a chain that sweeps this far closes on itself: a round column, a callout bubble, a north-arrow ring. A door leaf never passes 180°.
export const ARC_CUSP_MIN = 3;         // consecutive cusp reversals that make a chain a revision cloud. A mirrored DOUBLE DOOR is two arcs with ONE reversal, so it must stay under this — the naive "any cusp" form deletes double doors.
export const ARC_CUSP_R_RATIO = 1.5;   // ...and a cloud's scallops all share one radius
export const ARC_CUSP_SPAN_MULT = 8;   // ...which is small next to the chain's own run length (a double door's radius is ~1/3 of its run)
/** mask bit: this curve cell is NOT door-swing linework (closed circle / cloud
 *  scallop). A cell crossed by both a door-like and a non-door-like chord ends
 *  up flagged — deliberately conservative; clusters are judged on the FRACTION
 *  of their cells flagged, so a few shared cells can't flip a real door. */
export const MASK_NODOOR_BIT = 8;
// Feet-true door-leaf band, applied per CLUSTER (where MaskObj.mppf exists).
// NOT 2–6 ft: 1'-6" closet leaves are real, and at 1/16" = 1'-0" a ¼" paper
// scallop is 4 ft model — it would sneak in under a 6 ft cap, so the cap sits
// below it and the cusp rule catches the rest.
export const DOOR_R_MIN_FT = 1.5;
export const DOOR_R_MAX_FT = 4.5;
export const CLUSTER_FIT_TOL_FRAC = 0.05;  // per-cluster circle-fit RMS cap (fraction of the fitted radius) — cells are integer-quantized and the arc rasters 1–2 px thick, so the absolute floor below matters more
export const CLUSTER_FIT_TOL_PX = 1.5;

// hatch classification — a hatch/poché member is a stroke INSIDE a periodic
// parallel family: same-pen neighbors at ±pitch on both sides (and the lattice
// extending ±2 pitches at least one way), gaps equal to raster precision,
// pitch at fill scale. Walls never sit inside such a lattice; the outermost
// rows of a real fill fail it too, so hatch-region edges stay hard for free
// (see classifyHatchSegs).
export const HATCH_ANGLE_TOL = 2;      // deg — CAD hatch angle jitter is ≪ 1°
export const HATCH_MAX_PITCH = 24;     // mask px — scale-unknown fallback for the pitch cap
export const HATCH_MAX_PITCH_FT = HATCH_MAX_PITCH / 18;  // = 4/3 ft at the 18 px/ft calibration — keeps room-scale rhythm (demising walls) hard, at every resolution
export const HATCH_BOUND_FRAC = 0.7;   // ≥ this soft-bounded fraction ⇒ PREDOMINANTLY hatch (tile-grid cell): escalate unbounded
export const HATCH_ESCALATE_FRAC = 0.02; // MODERATE band [this, HATCH_BOUND_FRAC): grow-but-verify escalation. Was 0.35 when hatch classification was a loose rhythm heuristic and a high bar kept its false positives from escalating everything; with per-stroke periodicity evidence (item C), ANY real hatch run on the boundary is worth testing — a hatched alcove of a room is often < 35% of its boundary — and grow-but-verify remains the gate. The floor only skips re-floods over boundary specks. Balanced-preset value; see escalationParams.
export const HATCH_GROWTH_MAX = 2.5;     // grow-but-verify cap: reject a walls-only escalation that balloons past this × the strict area (a misclassified wall would leak or overgrow). Balanced-preset value.

// Fill sensitivity — a single 0..1 knob the estimator can dial per drawing to
// trade spill-resistance against reach (the constants above are calibrated on one
// sheet/one CAD style; other plans hatch differently). It tunes ONLY the moderate
// escalation tier: how eagerly a hatch-bounded fill escalates (escalateFrac) and
// how much area growth that escalation may add (growthMax). The trapped and
// predominantly-soft tiers stay unbounded at every setting, so lowering
// sensitivity never regresses tile-grid recovery — it only narrows the moderate
// band, and at Strict it empties (reproducing pre-#32 behavior).
export const SENS_STRICT = 0;
export const SENS_BALANCED = 0.5;      // default: the calibrated (0.35, 2.5) pair
export const SENS_AGGRESSIVE = 1;
// Notch detents interpolated piecewise-linearly: [sensitivity, escalateFrac, growthMax].
const SENS_ANCHORS: Array<[number, number, number]> = [
  [SENS_STRICT, HATCH_BOUND_FRAC, 1.5],                     // moderate band empties (escalateFrac == HATCH_BOUND_FRAC) ⇒ pre-#32
  [SENS_BALANCED, HATCH_ESCALATE_FRAC, HATCH_GROWTH_MAX],   // calibrated on the sample plan (issue #32)
  [SENS_AGGRESSIVE, 0, 4.0],                               // cross any hatch, tolerate more growth
];
export function escalationParams(sensitivity: number): { escalateFrac: number; growthMax: number } {
  const s = Math.max(0, Math.min(1, Number.isFinite(sensitivity) ? sensitivity : SENS_BALANCED));
  let a = SENS_ANCHORS[0], b = SENS_ANCHORS[SENS_ANCHORS.length - 1];
  for (let i = 1; i < SENS_ANCHORS.length; i++) { if (s <= SENS_ANCHORS[i][0]) { a = SENS_ANCHORS[i - 1]; b = SENS_ANCHORS[i]; break; } }
  const t = b[0] === a[0] ? 0 : (s - a[0]) / (b[0] - a[0]);
  return { escalateFrac: a[1] + (b[1] - a[1]) * t, growthMax: a[2] + (b[2] - a[2]) * t };
}

// ── 1. op-list walk ────────────────────────────────────────────────────────
// Same transform composition as the original snap extractor (save/restore/
// transform/constructPath), now also emitting SEGMENTS for the boundary mask
// plus one META byte per segment: curve/clip/fill bits + the device line width
// in the high nibble (setLineWidth / setGState "LW", scaled by the CTM). Form
// XObjects push/pop their matrix so hatch living inside a form lands where it
// draws. `transform` is viewport.transform; OPS is pdfjs's op-code table.
export function extractVectorGeometry(opList: OpList, transform: number[], OPS: OpsTable): VectorGeometry {
  const points: Point[] = [];
  const segs: number[] = [];
  const metaArr: number[] = [];
  let imageArea = 0;
  let m = transform.slice();
  let lw = 1;                          // graphics-state line width (user space)
  const stack: Array<[number[], number]> = [];
  const mul = (a: number[], b: number[]): number[] => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const tx = (x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const fns = opList.fnArray, A = opList.argsArray;
  // the paint op FOLLOWS its path in the op stream (clip ops may sit between):
  // endPath = clip-only (invisible), fill/eoFill = filled-not-stroked
  const paintFlags = (i: number): number => {
    for (let j = i + 1; j < fns.length && j <= i + 3; j++) {
      const f = fns[j];
      if (f === OPS.clip || f === OPS.eoClip) continue;
      if (f === OPS.endPath) return SEG_CLIP;
      if (f === OPS.fill || f === OPS.eoFill) return SEG_FILLONLY;
      break;                            // stroke / fillStroke / anything else
    }
    return 0;
  };
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i], args = A[i];
    if (fn === OPS.save) stack.push([m.slice(), lw]);
    else if (fn === OPS.restore) { const p = stack.pop(); if (p) { m = p[0]; lw = p[1]; } }
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.setLineWidth) lw = args[0];
    else if (fn === OPS.setGState) { for (const pr of args[0] || []) if (pr && pr[0] === "LW") lw = pr[1]; }
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([m.slice(), lw]); if (args && args[0]) m = mul(m, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) { const p = stack.pop(); if (p) { m = p[0]; lw = p[1]; } }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      // the singular paint ops are each preceded by their OWN `transform` op
      // (already folded into `m` above), mapping the image's unit square onto
      // the placed rect — |det m| is its device-px area. Summed per sheet, it
      // flags scan wrappers / photo underlays (a plan-area scan covers most of
      // the sheet; logos and stamps are ≪ 2%).
      imageArea += Math.abs(m[0] * m[3] - m[1] * m[2]);
    }
    else if (fn === OPS.paintImageXObjectRepeat) {
      // pdf.js FOLDS a run of identical placements into one op — no per-instance
      // `transform` op precedes it, so `m` here is just the ambient CTM (the
      // viewport transform); placement lives in the op's OWN args instead:
      // [objId, scaleX, scaleY, positions] where positions is a flat (x, y) ×
      // instanceCount array. Area = |det ambient| × |scaleX·scaleY| × count.
      const [, scaleX, scaleY, positions] = args;
      const count = positions ? positions.length >> 1 : 0;
      imageArea += Math.abs(m[0] * m[3] - m[1] * m[2]) * Math.abs(scaleX * scaleY) * count;
    }
    else if (fn === OPS.paintImageMaskXObjectRepeat) {
      // args: [objId, a, b, c, d, positions] — a..d are the per-instance local
      // transform's 2×2 (folded the same way as the repeat op above).
      const [, ra, rb, rc, rd, positions] = args;
      const count = positions ? positions.length >> 1 : 0;
      imageArea += Math.abs(m[0] * m[3] - m[1] * m[2]) * Math.abs(ra * rd - rb * rc) * count;
    }
    else if (fn === OPS.paintImageMaskXObjectGroup) {
      // args: [images] — each images[k].transform is that instance's own local
      // [a,b,c,d,e,f] (pdf.js keeps per-instance transforms here instead of
      // folding to *Repeat when the run isn't uniform enough).
      const ctmDet = Math.abs(m[0] * m[3] - m[1] * m[2]);
      for (const im of args[0] || []) {
        const t = im && im.transform;
        if (t) imageArea += ctmDet * Math.abs(t[0] * t[3] - t[1] * t[2]);
      }
    }
    else if (fn === OPS.paintInlineImageXObjectGroup) {
      // args: [img, map] — each map[k].transform is that instance's own local
      // [a,b,c,d,e,f].
      const ctmDet = Math.abs(m[0] * m[3] - m[1] * m[2]);
      for (const mp of args[1] || []) {
        const t = mp && mp.transform;
        if (t) imageArea += ctmDet * Math.abs(t[0] * t[3] - t[1] * t[2]);
      }
    }
    else if (fn === OPS.constructPath) {
      const devW = Math.min(15, Math.max(0, Math.ceil((lw || 0) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])))));
      const flags = paintFlags(i) | (devW << 4);
      const ops = args[0], co = args[1];
      let c = 0, cur: Point | null = null, start: Point | null = null;
      const visit = (p: Point) => { points.push(p); };
      const lineTo = (p: Point) => { if (cur) { segs.push(cur[0], cur[1], p[0], p[1]); metaArr.push(flags); } cur = p; visit(p); };
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = tx(co[c], co[c + 1]); start = cur; visit(cur); c += 2; }
        else if (op === OPS.lineTo) { lineTo(tx(co[c], co[c + 1])); c += 2; }
        else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
          // cubic bezier, sampled as chords; control points transform first
          // (affine maps commute with bezier interpolation)
          let p1: Point, p2: Point, p3: Point;
          if (op === OPS.curveTo) { p1 = tx(co[c], co[c + 1]); p2 = tx(co[c + 2], co[c + 3]); p3 = tx(co[c + 4], co[c + 5]); c += 6; }
          else if (op === OPS.curveTo2) { p1 = cur || tx(co[c], co[c + 1]); p2 = tx(co[c], co[c + 1]); p3 = tx(co[c + 2], co[c + 3]); c += 4; }
          else { p1 = tx(co[c], co[c + 1]); p2 = p3 = tx(co[c + 2], co[c + 3]); c += 4; }
          const p0: Point = cur || p1;
          for (let k = 1; k <= CURVE_STEPS; k++) {
            const t = k / CURVE_STEPS, u = 1 - t;
            const q: Point = [
              u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
              u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
            ];
            if (cur) { segs.push(cur[0], cur[1], q[0], q[1]); metaArr.push(flags | SEG_CURVE); }
            cur = q;
          }
          visit(p3);
        }
        else if (op === OPS.closePath) { if (cur && start) { segs.push(cur[0], cur[1], start[0], start[1]); metaArr.push(flags); cur = start; } }
        else if (op === OPS.rectangle) {
          const x = co[c], y = co[c + 1], w = co[c + 2], h = co[c + 3]; c += 4;
          const q: Point[] = [tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)];
          for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4]; segs.push(a[0], a[1], b[0], b[1]); metaArr.push(flags); visit(a); }
          cur = q[0]; start = q[0];
        }
      }
    }
  }
  const meta = Uint8Array.from(metaArr);
  markPolylineArcs(segs, meta);
  return { points, segs, meta, imageArea };
}

// ── 1b. polyline arc detection ─────────────────────────────────────────────
// Door swings on many real plans are POLYLINES, not beziers — CAD exports
// tessellate the arc into lineTo chords — so they carry no SEG_CURVE bit: the
// mask can't recognize them as door linework (no curve-transparent retry, no
// wedge unification), and to a rhythm-based hatch classifier their chords can
// masquerade as pattern rows. An arc is GEOMETRY, not rhythm: consecutive
// chained chords, turning consistently in one direction by similar amounts,
// whose vertices all sit on one circle. Detect exactly that and give the
// chords the same SEG_CURVE the bezier tessellation gets (SEG_POLYARC records
// the provenance). Chains tolerate endpoint gaps up to a chord length so
// DASHED arcs (phantom door leaves) detect too, while a dashed straight line
// has no turn and never qualifies. Ellipse fixtures (toilets, sinks) fail the
// circle fit; chamfers are too short; zigzag symbols flip turn sign.
export function markPolylineArcs(segs: number[], meta: Uint8Array): number {
  const n = segs.length >> 2;
  if (!meta || n < ARC_MIN_CHORDS) return 0;
  let marked = 0;
  const len = (i: number) => Math.hypot(segs[i * 4 + 2] - segs[i * 4], segs[i * 4 + 3] - segs[i * 4 + 1]);
  // chains hold CHORD indices — segments long enough to carry a direction.
  // Sub-half-px slivers (dash-pattern pen-down artifacts) neither join nor
  // break a chain: they're bridged, and marked with the window they sit in.
  let chain: number[] = [];
  const flush = () => {
    if (chain.length >= ARC_MIN_CHORDS) marked += scanChainForArcs(segs, meta, chain);
    chain = [];
  };
  for (let i = 0; i < n; i++) {
    if (meta[i] & (SEG_CURVE | SEG_CLIP)) { flush(); continue; }
    if (len(i) < 0.5) continue;                        // sliver — bridge it
    if (chain.length) {
      const p = chain[chain.length - 1];
      // same path & pen (identical meta), endpoints joined or dash-gapped
      // less than the longer of the two chords (dash gaps run shorter than
      // their dashes; anything longer is separate linework)
      const gap = Math.hypot(segs[i * 4] - segs[p * 4 + 2], segs[i * 4 + 1] - segs[p * 4 + 3]);
      if (meta[i] !== meta[p] || gap > Math.max(len(i), len(p))) flush();
    }
    chain.push(i);
  }
  flush();
  return marked;
}

// One chain of joined same-pen chords: find maximal windows of consistent
// uniform turning, then confirm each window's vertices against a fitted
// circle before marking. The fit is the arbiter — turn statistics alone
// would admit near-circular polylines that aren't arcs.
function scanChainForArcs(segs: number[], meta: Uint8Array, chain: number[]): number {
  let marked = 0;
  for (const w of scanChainWindows(segs, chain)) {
    // mark the seg-index RANGE so bridged slivers ride along — but only segs
    // sharing the chain's meta (a foreign path's sliver interleaved in the
    // stream must not be stamped)
    const cm = meta[chain[w.c0]];
    for (let j = chain[w.c0]; j <= chain[w.c1]; j++) if (meta[j] === cm) meta[j] |= SEG_CURVE | SEG_POLYARC;
    marked += w.c1 - w.c0 + 1;
  }
  return marked;
}

/** One confirmed arc inside a chain: chord range (chain indices), the signed
 *  total turn across it (deg), and the circle it fits. */
interface ArcWindow { c0: number; c1: number; turn: number; r: number; }

// The window scanner both marking and non-door discrimination run on.
function scanChainWindows(segs: number[], chain: number[]): ArcWindow[] {
  const m = chain.length;
  const dirs: number[] = [], lens: number[] = [];
  for (const i of chain) {
    const dx = segs[i * 4 + 2] - segs[i * 4], dy = segs[i * 4 + 3] - segs[i * 4 + 1];
    dirs.push(Math.atan2(dy, dx) * 180 / Math.PI);
    lens.push(Math.hypot(dx, dy));
  }
  // turn[k] = signed direction change entering chord k (k ≥ 1), in (−180, 180]
  const turn: number[] = [0];
  for (let k = 1; k < m; k++) {
    let t = dirs[k] - dirs[k - 1];
    if (t > 180) t -= 360; if (t <= -180) t += 360;
    turn.push(t);
  }
  const ratioOk = (k: number) => {
    const r = Math.max(lens[k], lens[k - 1]) / Math.max(1e-9, Math.min(lens[k], lens[k - 1]));
    return r <= 3;                     // uniform tessellation (dash phase shortens end dashes)
  };
  const signedTurn = (k: number) => Math.abs(turn[k]) >= ARC_CHORD_TURN_MIN && Math.abs(turn[k]) <= ARC_CHORD_TURN_MAX && ratioOk(k);
  // a dash pattern can split ONE tessellation chord into two near-collinear
  // pieces, so an ISOLATED sub-threshold turn continues a window; two in a
  // row is a straight run and breaks it
  const neutral = (k: number) => Math.abs(turn[k]) < ARC_CHORD_TURN_MIN && ratioOk(k);
  const out: ArcWindow[] = [];
  let s = 1;
  while (s < m) {
    if (!signedTurn(s)) { s++; continue; }
    const sgn = Math.sign(turn[s]);
    let e = s, bridged = false;
    for (let k = s + 1; k < m; k++) {
      if (signedTurn(k) && Math.sign(turn[k]) === sgn) { e = k; bridged = false; continue; }
      if (neutral(k) && !bridged) { bridged = true; continue; }
      break;
    }
    // window of turns [s..e] covers chords s-1 .. e (trailing neutrals
    // excluded). A joined stub meeting the arc at a plausible turn (a
    // threshold tick, a leader drawn continuous with the swing) rides in as
    // the window's first or last chord and its off-circle vertex fails the
    // fit — so on failure, retry with the end chords trimmed instead of
    // discarding the whole arc (adversarial review, round 8).
    if (e - s + 2 >= ARC_MIN_CHORDS) {
      let total = 0; for (let j = s; j <= e; j++) total += Math.abs(turn[j]);
      if (total >= ARC_MIN_TOTAL_TURN) {
        for (const [c0, c1] of [[s - 1, e], [s, e], [s - 1, e - 1], [s, e - 1]] as const) {
          if (c1 - c0 + 1 < ARC_MIN_CHORDS) continue;
          let t = 0, signed = 0;
          for (let j = c0 + 1; j <= c1; j++) { t += Math.abs(turn[j]); signed += turn[j]; }
          const fit = t < ARC_MIN_TOTAL_TURN ? null : circleFitOk(segs, chain, c0, c1);
          if (!fit) continue;
          out.push({ c0, c1, turn: signed, r: fit.r });
          break;
        }
      }
    }
    s = e + 1;
  }
  return out;
}

/** Per-chord verdict: this curve chord is NOT door-swing linework. Runs over
 *  every SEG_CURVE chord — bezier tessellation included, since CAD emits
 *  circles as beziers and extractVectorGeometry stamps SEG_CURVE on those
 *  unconditionally, so a discriminator scoped to the polyline path would never
 *  see a bezier-drawn column.
 *
 *  Two dimensionless refusals (the feet-true radius band is a CLUSTER-time
 *  test — there is no sheet scale here):
 *    1. a chain sweeping ≥ ARC_CLOSED_TURN closes on itself — column, callout
 *       bubble, north arrow. Nothing that closes is a door leaf.
 *    2. a CUSP CHAIN — four or more equal-radius arcs meeting at reversals —
 *       is a revision cloud. The naive "consecutive arcs with opposite turn
 *       sign" form also describes a mirrored DOUBLE DOOR, so all three of
 *       similar radius, SMALL radius (relative to the chain's own run) and
 *       ≥ ARC_CUSP_MIN reversals are required; a double door has one. */
export function flagNonDoorArcs(segs: number[], meta: Uint8Array): Uint8Array {
  const n = segs.length >> 2;
  const veto = new Uint8Array(n);
  if (!meta || n < ARC_MIN_CHORDS) return veto;
  const len = (i: number) => Math.hypot(segs[i * 4 + 2] - segs[i * 4], segs[i * 4 + 3] - segs[i * 4 + 1]);
  let chain: number[] = [];
  const flush = () => {
    if (chain.length >= ARC_MIN_CHORDS) judgeChain(segs, chain, veto);
    chain = [];
  };
  for (let i = 0; i < n; i++) {
    // Slivers are bridged BEFORE the membership test, unlike markPolylineArcs:
    // pdf.js emits a ZERO-LENGTH lineTo between the two half-circle beziers of
    // a CAD circle, and letting that break the chain split every bezier circle
    // into two 180° halves — neither of which closes (measured on the corpus's
    // real plan; the column read as two door-sized arcs).
    if (len(i) < 0.5) continue;
    if (!(meta[i] & SEG_CURVE) || (meta[i] & SEG_CLIP)) { flush(); continue; }
    if (chain.length) {
      const p = chain[chain.length - 1];
      const gap = Math.hypot(segs[i * 4] - segs[p * 4 + 2], segs[i * 4 + 1] - segs[p * 4 + 3]);
      if (meta[i] !== meta[p] || gap > Math.max(len(i), len(p))) flush();
    }
    chain.push(i);
  }
  flush();
  return veto;
}

function judgeChain(segs: number[], chain: number[], veto: Uint8Array): void {
  const wins = scanChainWindows(segs, chain);
  if (!wins.length) return;
  const stamp = (w: ArcWindow) => { for (let j = chain[w.c0]; j <= chain[w.c1]; j++) veto[j] = 1; };
  // 1. closed circles
  let closed = false;
  for (const w of wins) if (Math.abs(w.turn) >= ARC_CLOSED_TURN) { stamp(w); closed = true; }
  if (closed) return;
  // 3. cusp chains (revision clouds). Windows separated by at most one chord
  // are joined at a cusp — the sharp reversal that broke the turn window.
  if (wins.length <= ARC_CUSP_MIN) return;
  let run = 1, best = 1;
  for (let k = 1; k < wins.length; k++) {
    if (wins[k].c0 - wins[k - 1].c1 <= 2 && Math.sign(wins[k].turn) === Math.sign(wins[k - 1].turn)) run++;
    else run = 1;
    if (run > best) best = run;
  }
  if (best <= ARC_CUSP_MIN) return;                    // ≤ 3 arcs in a row ⇒ ≤ 2 reversals
  let rmin = Infinity, rmax = 0, span = 0;
  for (const w of wins) { if (w.r < rmin) rmin = w.r; if (w.r > rmax) rmax = w.r; }
  for (const i of chain) span += Math.hypot(segs[i * 4 + 2] - segs[i * 4], segs[i * 4 + 3] - segs[i * 4 + 1]);
  if (!(rmin > 0) || rmax > rmin * ARC_CUSP_R_RATIO) return;       // radii must match
  if (rmax * ARC_CUSP_SPAN_MULT > span) return;                    // ...and be small next to the run
  for (const w of wins) stamp(w);
}

// Kasa least-squares circle through the chords' vertices, centroid-centered
// for conditioning; accept when every vertex sits on the circle to within
// ARC_FIT_TOL_FRAC of the radius (a hair of absolute slack for PDF coordinate
// rounding). Tessellation vertices of a true arc lie exactly on it.
// Returns the fitted circle (the RADIUS is what the cloud test needs), or null.
function circleFitOk(segs: number[], chain: number[], c0: number, c1: number): { cx: number; cy: number; r: number } | null {
  const xs: number[] = [], ys: number[] = [];
  xs.push(segs[chain[c0] * 4]); ys.push(segs[chain[c0] * 4 + 1]);
  for (let k = c0; k <= c1; k++) { const i = chain[k]; xs.push(segs[i * 4 + 2]); ys.push(segs[i * 4 + 3]); }
  const m = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < m; i++) { mx += xs[i]; my += ys[i]; }
  mx /= m; my /= m;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (let i = 0; i < m; i++) {
    const x = xs[i] - mx, y = ys[i] - my, z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return null;               // collinear — no circle
  const cx = (sxz * syy - syz * sxy) / (2 * det);
  const cy = (syz * sxx - sxz * sxy) / (2 * det);
  let r = 0;
  for (let i = 0; i < m; i++) r += Math.hypot(xs[i] - mx - cx, ys[i] - my - cy);
  r /= m;
  if (!(r > 0)) return null;
  const tol = Math.max(0.75, r * ARC_FIT_TOL_FRAC);
  for (let i = 0; i < m; i++) {
    if (Math.abs(Math.hypot(xs[i] - mx - cx, ys[i] - my - cy) - r) > tol) return null;
  }
  return { cx: cx + mx, cy: cy + my, r };
}

// ── 2. hatch classification ────────────────────────────────────────────────
// PERIODICITY evidence, decided per stroke (issue #184 item C — replaces the
// parallel-row run heuristic). A stroke is hatch iff it sits INSIDE a local
// periodic lattice of its own family: same-angle, SAME-PEN neighbors at ±p on
// both sides — and the lattice extending to ±2p on at least one side — every
// gap equal to within half a mask cell, for some pitch p at fill scale
// (≤ pitchCapPx, feet-true when the scale is known). That one statement
// replaces five knobs of the old classifier:
//   • run length / regularity band / majority vote — CAD hatch pitch is
//     machine-exact, so gaps match to raster precision or the family isn't
//     hatch; five equal-pitched overlapping rows is the evidence, not ten
//     loosely-similar gaps out-voting their outliers.
//   • tangential-overlap fraction — each lattice neighbor must overlap the
//     stroke at all (≥ half a cell): hatch is an areal fill, so its rows
//     stack; scattered same-angle linework that happens to be evenly offset
//     (door arc chords, dimension ticks) doesn't.
//   • pen-width protect ratio — the pen IS part of the pattern: lattice
//     neighbors must match the stroke's width nibble, so a heavy wall
//     overprinting a hairline family finds no same-pen lattice and stays
//     hard, without a ratio to tune.
//   • span protect ratio — a wall riding a fill's rhythm still needs same-pen
//     equal-pitch neighbors BOTH sides; where it does ride them, the
//     escalation's grow-but-verify cap is the backstop (unchanged).
//   • extremal-row protection — the outermost rows of a fill have no ±p
//     neighbor outside the fill, so they fail the lattice and stay hard for
//     free (tile/hatch edges coincide with walls).
// Curve chords are exempt (bezier AND detected polyline arcs — door swings
// must keep closing gaps, and an arc is never a periodic family); clip-only
// paths are soft outright (invisible ink); filled-not-stroked outlines bound
// SOLID ink (wall poché) and are exempt — making them transparent lets the
// escalated fill cross a solid black band. The half-cell tolerances are the
// raster's own honesty floor (two lines closer than half a cell plot on the
// same cells; offsets carry ~1e-14 float noise — the corpus caught a pitch
// sitting exactly ON the cap splitting on that noise at one resolution), not
// tunables.
interface HatchPiece { i: number; d: number; t0: number; t1: number; w: number; }
export function classifyHatchSegs(segs: number[], meta: Uint8Array, ws: number, pitchCapPx: number = HATCH_MAX_PITCH): Uint8Array {
  const n = segs.length >> 2;
  const soft = new Uint8Array(n);
  if (!meta || !n) return soft;
  const HALF_CELL = 0.5;                         // mask px — raster resolution floor
  interface Cand { i: number; ang: number; x1: number; y1: number; x2: number; y2: number; w: number; }
  const cand: Cand[] = [];
  for (let i = 0; i < n; i++) {
    const mt = meta[i];
    if (mt & SEG_CURVE) continue;
    if (mt & SEG_CLIP) { soft[i] = 1; continue; }
    if (mt & SEG_FILLONLY) continue;
    const x1 = segs[i * 4] * ws, y1 = segs[i * 4 + 1] * ws, x2 = segs[i * 4 + 2] * ws, y2 = segs[i * 4 + 3] * ws;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.75) continue;                    // sub-cell specks can't form rows
    let ang = Math.atan2(dy, dx) * 180 / Math.PI; // fold to [0,180): direction-free
    if (ang < 0) ang += 180; if (ang >= 180) ang -= 180;
    cand.push({ i, ang, x1, y1, x2, y2, w: meta[i] >> 4 });
  }
  if (cand.length < 5) return soft;              // a lattice is 5 rows minimum
  cand.sort((a, b) => a.ang - b.ang);
  // sweep into angle clusters; a near-0° cluster merges with a near-180° one
  const clusters: Cand[][] = [];
  let cl: Cand[] = [cand[0]];
  for (let k = 1; k < cand.length; k++) {
    if (cand[k].ang - cand[k - 1].ang <= HATCH_ANGLE_TOL) cl.push(cand[k]);
    else { clusters.push(cl); cl = [cand[k]]; }
  }
  clusters.push(cl);
  if (clusters.length > 1) {
    const first = clusters[0], last = clusters[clusters.length - 1];
    if (first[0].ang < HATCH_ANGLE_TOL && last[last.length - 1].ang > 180 - HATCH_ANGLE_TOL) {
      for (const s of last) s.ang -= 180;        // fold across the seam for the mean
      clusters[0] = last.concat(first);
      clusters.pop();
    }
  }
  for (const members of clusters) {
    if (members.length < 5) continue;
    let sum = 0; for (const s of members) sum += s.ang;
    const th = (sum / members.length) * Math.PI / 180;
    const dxu = Math.cos(th), dyu = Math.sin(th);      // along the family
    const nxu = -dyu, nyu = dxu;                        // across it
    const pieces: HatchPiece[] = members.map((s) => ({
      i: s.i,
      d: ((s.x1 + s.x2) / 2) * nxu + ((s.y1 + s.y2) / 2) * nyu,
      t0: Math.min(s.x1 * dxu + s.y1 * dyu, s.x2 * dxu + s.y2 * dyu),
      t1: Math.max(s.x1 * dxu + s.y1 * dyu, s.x2 * dxu + s.y2 * dyu),
      w: s.w,
    })).sort((a, b) => a.d - b.d);
    // group into ROWS at raster resolution (anchor-based: a piece joins the
    // row when its offset is within half a cell of the row's first piece —
    // dashed/collinear pieces of one drawn line land together)
    const rowOf = new Int32Array(pieces.length);
    const rowD: number[] = [];
    const rowPieces: HatchPiece[][] = [];
    for (let k = 0; k < pieces.length; k++) {
      if (rowD.length && pieces[k].d - rowD[rowD.length - 1] <= HALF_CELL) {
        rowOf[k] = rowD.length - 1; rowPieces[rowPieces.length - 1].push(pieces[k]);
      } else {
        rowOf[k] = rowD.length; rowD.push(pieces[k].d); rowPieces.push([pieces[k]]);
      }
    }
    // per-row t0-sorted pieces + a prefix-max of t1: queries bisect to the
    // last piece starting before the window and walk left only while an
    // overlap is still possible — without this, a cap-wide band of dense
    // same-angle non-overlapping linework (stipple textures, tick swarms)
    // makes the per-piece loop quadratic (adversarial review, round 8)
    for (const rp of rowPieces) rp.sort((a, b) => a.t0 - b.t0);
    const rowMaxT1: number[][] = rowPieces.map((rp) => {
      const m: number[] = new Array(rp.length);
      let mx = -Infinity;
      for (let i = 0; i < rp.length; i++) { mx = Math.max(mx, rp[i].t1); m[i] = mx; }
      return m;
    });
    // does row j hold a piece of pen width w overlapping [t0, t1]?
    const rowHas = (j: number, w: number, t0: number, t1: number): boolean => {
      const P = rowPieces[j], M = rowMaxT1[j];
      let lo = 0, hi = P.length - 1, last = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (P[mid].t0 <= t1 - HALF_CELL) { last = mid; lo = mid + 1; } else hi = mid - 1; }
      for (let i = last; i >= 0; i--) {
        if (M[i] < t0 + HALF_CELL) break;              // nothing further left can overlap
        const p = P[i];
        if (p.w === w && Math.min(p.t1, t1) - Math.max(p.t0, t0) >= HALF_CELL) return true;
      }
      return false;
    };
    // nearest row from j (exclusive) in direction dir with a matching piece,
    // within the pitch cap; −1 when none
    const nearestRow = (j: number, dir: 1 | -1, w: number, t0: number, t1: number): number => {
      for (let r = j + dir; r >= 0 && r < rowD.length; r += dir) {
        if (Math.abs(rowD[r] - rowD[j]) > pitchCapPx + HALF_CELL) break;
        if (rowHas(r, w, t0, t1)) return r;
      }
      return -1;
    };
    // any row at offset ≈ target (± half cell) with a matching piece?
    const rowAt = (target: number, w: number, t0: number, t1: number): boolean => {
      let lo = 0, hi = rowD.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rowD[mid] < target - HALF_CELL) lo = mid + 1; else hi = mid; }
      for (let r = lo; r < rowD.length && rowD[r] <= target + HALF_CELL; r++) {
        // the bisection can land on the last row when target is beyond every
        // row — enforce the lower bound too, or the nearest-below row would
        // spuriously validate lattice positions that don't exist
        if (rowD[r] >= target - HALF_CELL && rowHas(r, w, t0, t1)) return true;
      }
      return false;
    };
    for (let k = 0; k < pieces.length; k++) {
      const c = pieces[k];
      const j = rowOf[k];
      const up = nearestRow(j, 1, c.w, c.t0, c.t1);
      const dn = nearestRow(j, -1, c.w, c.t0, c.t1);
      // a true pattern edge (nothing of the family beyond it within a pitch)
      // stays hard — tile/hatch edges coincide with walls
      if (up < 0 || dn < 0) continue;
      const pUp = rowD[up] - rowD[j], pDn = rowD[j] - rowD[dn];
      const at = (mult: number, p: number) => rowAt(rowD[j] + mult * p, c.w, c.t0, c.t1);
      for (const p of pUp === pDn ? [pUp] : [pUp, pDn]) {
        if (p < HALF_CELL || p > pitchCapPx + HALF_CELL) continue;
        // interior: ±p both sides, lattice extending to ±2p at least one way
        const interior = at(1, p) && at(-1, p) && (at(2, p) || at(-2, p));
        // clipped edge: a fill's LAST row before its bounding wall has a
        // remainder gap (< pitch) to the wall, not a pitch gap — accept a
        // deeper three-step lattice on one side when the OPPOSITE side is
        // bounded within a pitch (the clip signature; a lone pattern edge
        // with open space beyond stays hard). The bound must be tested on
        // the side away from the lattice: testing min(pUp, pDn) is a
        // tautology (p is always one of them), which let any same-pen
        // stroke within the CAP on the far side soften a pattern edge
        // (adversarial review, round 8).
        const clipped =
          (at(1, p) && at(2, p) && at(3, p) && pDn <= p + HALF_CELL) ||
          (at(-1, p) && at(-2, p) && at(-3, p) && pUp <= p + HALF_CELL);
        if (interior || clipped) { soft[c.i] = 1; break; }
      }
    }
  }
  return soft;
}

// ── 3. boundary mask ───────────────────────────────────────────────────────
// Segments (image px) → Uint8Array raster at ws = maskDim/imageDim. Single-px
// Bresenham; coincident endpoints round to the same cell so chained walls stay
// continuous. Without meta the mask is bit-identical to the original (every
// cell 1). With meta, wall cells carry bit 1 and suspected-hatch cells bit 2 —
// a cell crossed by both keeps bit 1, so hard always wins. Curve chords (door
// swings, curved walls) additionally carry bit 4: still hard, but identifiable
// so annexDoorWedges can recognize a swing arc on a region's boundary.
export const MASK_CURVE_BIT = 4;
export function buildMask(segs: number[], imgW: number, imgH: number, maxDim = MASK_MAX_DIM, meta: Uint8Array | null = null, pxPerFt = 0, basePxPerFt = 0): MaskObj {
  // A1 (audit): the working raster must be a property of the SHEET, not of the
  // render scale. It used to be `ws = min(1, maxDim/imgmax)` — a CAP, not a pin —
  // so on any sheet rendering under the cap the mask resolution just followed the
  // render, and the per-sheet "Hi-Res render" toggle silently changed measured
  // square footage (11×17 at 1/8": 97.8 SF vs 134.0 SF, +37%). Above the cap the
  // resolution was pinned but `Math.round(seg*ws)` still quantized in RENDER px,
  // so cap-bound sheets shifted too (VA plan: −3.96% on one probe at identical mppf).
  //
  // Fix: map into the BASELINE render (RENDER_SCALE) before choosing the raster and
  // before quantizing. k is this render's ratio to baseline; basePxPerFt is px/ft at
  // baseline, which is render-independent by construction. At the default render
  // k === 1 exactly and every number below is bit-identical to the old behaviour,
  // so this is a no-op for every existing caller that doesn't pass basePxPerFt.
  const k = (Number.isFinite(basePxPerFt) && basePxPerFt > 0 && Number.isFinite(pxPerFt) && pxPerFt > 0)
    ? basePxPerFt / pxPerFt : 1;
  const bW = imgW * k, bH = imgH * k;                       // image dims at baseline
  const wsB = Math.min(1, maxDim / Math.max(bW, bH, 1));    // baseline raster scale
  const mw = Math.max(2, Math.ceil(bW * wsB)), mh = Math.max(2, Math.ceil(bH * wsB));
  const ws = k * wsB;                                       // image px → mask px at THIS render
  const mask = new Uint8Array(mw * mh);
  // pxPerFt = IMAGE px per foot (the sheet scale at this render). When known,
  // the hatch pitch cap converts to mask px through it, so whether a rhythm
  // reads as hatch or as walls is a property of the DRAWING, not of ws.
  // mppf = pxPerFt*k*wsB = basePxPerFt*wsB — the render scale cancels exactly.
  const mppf = Number.isFinite(pxPerFt) && pxPerFt > 0 ? pxPerFt * ws : 0;
  const soft = meta ? classifyHatchSegs(segs, meta, ws, mppf > 0 ? HATCH_MAX_PITCH_FT * mppf : HATCH_MAX_PITCH) : null;
  // curve chords that are demonstrably not door swings (closed circles, cloud
  // scallops) — a SEPARATE plane from SEG_CURVE, so refusing them never makes
  // them hatch-eligible (classifyHatchSegs still skips every SEG_CURVE chord)
  const noDoor = meta ? flagNonDoorArcs(segs, meta) : null;
  let softCount = 0;
  for (let i = 0, si = 0; i + 3 < segs.length; i += 4, si++) {
    let v = soft && soft[si] ? 2 : 1;
    if (v === 1 && meta && (meta[si] & SEG_CURVE)) v = 1 | MASK_CURVE_BIT;
    if ((v & MASK_CURVE_BIT) && noDoor && noDoor[si]) v |= MASK_NODOOR_BIT;
    if (v === 2) softCount++;
    // Quantization needs no separate baseline step: ws is now baseline-derived
    // (ws = k·wsB) and mw/mh come from the baseline dims, so seg*ws already lands
    // on the baseline grid. Measured: Math.round(seg*ws) and Math.round(seg*k*wsB)
    // agree on 400k random (rs, wsB, seg) draws — 0 differences. The audit plan
    // listed this as a separate fix (1.1i); it is subsumed by pinning ws.
    let x0 = Math.round(segs[i] * ws), y0 = Math.round(segs[i + 1] * ws);
    const x1 = Math.round(segs[i + 2] * ws), y1 = Math.round(segs[i + 3] * ws);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      if (x0 >= 0 && y0 >= 0 && x0 < mw && y0 < mh) mask[y0 * mw + x0] |= v;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  return { mask, mw, mh, ws, softCount, mppf };
}

// ── 4. flood fill ──────────────────────────────────────────────────────────
// Scanline fill from an image-px seed. `barrier` picks which mask bits block:
// 3 = walls + hatch (the strict original behavior), 1 = walls only. hardHits/
// softHits count blocking encounters so the caller can tell a wall-bounded
// region from a hatch-bounded one.
function floodPass(maskObj: MaskObj, ix: number, iy: number, barrier: number): FloodResult {
  const { mask, mw, mh, ws } = maskObj;
  // feet-true guards when the scale is known (identical to the px values at
  // the 18 px/ft calibration), px fallbacks + floors otherwise — see the
  // resolution-independence block up top
  const mppf = maskObj.mppf || 0;
  const tinyPx = mppf > 0 ? Math.max(TINY_PX_FLOOR, Math.round(TINY_SF * mppf * mppf)) : TINY_PX;
  const minThick = mppf > 0 ? Math.max(MIN_THICK_FLOOR, Math.round(MIN_THICK_FT * mppf)) : MIN_THICK;
  const nudge = mppf > 0 ? Math.max(NUDGE_PX, Math.round(NUDGE_FT * mppf)) : NUDGE_PX;
  let sx = Math.round(ix * ws), sy = Math.round(iy * ws);
  if (sx < 0 || sy < 0 || sx >= mw || sy >= mh) return { status: "boundary" };
  if (mask[sy * mw + sx] & barrier) {
    // nudge: nearest open cell (clicks often land on hatch lines)
    let found: Point | null = null;
    for (let r = 1; r <= nudge && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = sx + dx, ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < mw && ny < mh && !(mask[ny * mw + nx] & barrier)) { found = [nx, ny]; break; }
      }
    }
    if (!found) return { status: "boundary" };
    sx = found[0]; sy = found[1];
  }
  const region = new Uint8Array(mw * mh);
  const cap = Math.floor(mw * mh * LEAK_FRACTION);
  let count = 0, leaked = false, hardHits = 0, softHits = 0;
  let bx0 = sx, bx1 = sx, by0 = sy, by1 = sy;
  const stack: number[][] = [[sx, sy]];
  while (stack.length) {
    const popped = stack.pop() as number[];
    const px = popped[0], py = popped[1];
    let x0 = px;
    while (x0 > 0 && !(mask[py * mw + x0 - 1] & barrier) && !region[py * mw + x0 - 1]) x0--;
    if (x0 > 0 && (mask[py * mw + x0 - 1] & barrier)) { if (mask[py * mw + x0 - 1] & 1) hardHits++; else softHits++; }
    let x1 = px;
    while (x1 < mw - 1 && !(mask[py * mw + x1 + 1] & barrier) && !region[py * mw + x1 + 1]) x1++;
    if (x1 < mw - 1 && (mask[py * mw + x1 + 1] & barrier)) { if (mask[py * mw + x1 + 1] & 1) hardHits++; else softHits++; }
    if (x0 === 0 || x1 === mw - 1 || py === 0 || py === mh - 1) leaked = true;
    if (x0 < bx0) bx0 = x0; if (x1 > bx1) bx1 = x1; if (py < by0) by0 = py; if (py > by1) by1 = py;
    let upOpen = false, downOpen = false;
    for (let x = x0; x <= x1; x++) {
      const idx = py * mw + x;
      if (region[idx]) { upOpen = downOpen = false; continue; }
      region[idx] = 1; count++;
      if (py > 0) {
        const u = idx - mw;
        if (!(mask[u] & barrier) && !region[u]) { if (!upOpen) { stack.push([x, py - 1]); upOpen = true; } }
        else { if (mask[u] & barrier) { if (mask[u] & 1) hardHits++; else softHits++; } upOpen = false; }
      }
      if (py < mh - 1) {
        const d = idx + mw;
        if (!(mask[d] & barrier) && !region[d]) { if (!downOpen) { stack.push([x, py + 1]); downOpen = true; } }
        else { if (mask[d] & barrier) { if (mask[d] & 1) hardHits++; else softHits++; } downOpen = false; }
      }
    }
    if (count > cap) return { status: "leak" };
  }
  if (leaked) return { status: "leak" };
  // hatch/text slivers: plenty of cells but no room-like thickness
  if (count < tinyPx || bx1 - bx0 + 1 < minThick || by1 - by0 + 1 < minThick) return { status: "tiny", count };
  return { status: "ok", region, count, mw, mh, ws, mppf: mppf || undefined, hardHits, softHits };
}

// The escalating fill. Pass 1 is the strict mask (walls + hatch — exactly the
// original behavior; masks with no soft cells never go further). When the strict
// pass is bounded by hatch, re-flood with hatch transparent (pass 2). Three tiers
// keyed off how much of the strict fill's boundary is soft (hatch) vs hard (wall):
//   • trapped (tiny/boundary): strict found no room — escalate UNBOUNDED (any
//     clean re-flood beats nothing).
//   • predominantly soft (≥ HATCH_BOUND_FRAC, e.g. a lone tile-grid cell): the
//     strict fill is a sliver of the real room — escalate UNBOUNDED.
//   • moderate ([HATCH_ESCALATE_FRAC, HATCH_BOUND_FRAC)): any real hatch run on
//     the boundary (hatched alcoves of a room are often well under a third of
//     its boundary; the floor only skips boundary specks). Escalate
//     GROW-BUT-VERIFY: accept walls-only only if it stays a clean "ok", GROWS
//     the region (an escalation that changes nothing isn't one — and must not
//     cost confidence), and stays ≤ growthMax×. A misclassified wall then
//     either leaks or balloons and is discarded — the escalation can never do
//     worse than the strict pass.
//   • lightly soft (< escalateFrac) or a leak: strict result stands
//     (removing linework only leaks more).
// `sensitivity` (0..1) dials the moderate tier's escalateFrac/growthMax via
// escalationParams; the default is the calibrated Balanced preset.
export function floodRegion(maskObj: MaskObj, ix: number, iy: number, sensitivity: number = SENS_BALANCED): FloodResult {
  const r1 = floodPass(maskObj, ix, iy, 3);
  if (!maskObj.softCount) return r1;
  if (r1.status === "leak") return r1;
  const { escalateFrac, growthMax } = escalationParams(sensitivity);
  let growthCap = Infinity;                            // unbounded unless we're in the moderate band
  if (r1.status === "ok") {
    const blocks = (r1.hardHits || 0) + (r1.softHits || 0);
    const softFrac = blocks ? (r1.softHits || 0) / blocks : 0;
    if (softFrac < escalateFrac) return r1;            // lightly hatch-bounded ⇒ strict is right
    if (softFrac < HATCH_BOUND_FRAC) growthCap = growthMax; // moderate ⇒ grow-but-verify
  }
  const r2 = floodPass(maskObj, ix, iy, 1);
  if (r2.status === "ok" && (r1.status !== "ok" || (r2.count > r1.count && r2.count <= r1.count * growthCap))) {
    r2.hatchFiltered = true;
    return r2;
  }
  return r1;
}

// ── 4b. leak recovery — seal door-width gaps ───────────────────────────────
// A room with an open doorway (no door swing drawn, or a faded line on a scan)
// is the flood's classic dead end: the fill escapes through the opening and the
// whole click comes back "leak". Sealing recovers it: re-flood with the HARD
// (wall) cells dilated by an escalating radius r — a square dilation closes any
// passage up to 2r mask px wide — then grow the bounded region back r steps
// against the ORIGINAL mask so the boundary still sits on the true linework
// everywhere except across the sealed opening (where the fill may reach up to
// r px past the wall ends — sub-inch at plan scales, and the seed star + review
// gate still apply). Soft (hatch) cells are never dilated: thickening a hatch
// family would fuse the pattern into a solid block and starve the fill.
//
// Every non-"ok" status gets a sealing attempt — not just "leak". A hatched
// room behind a doorway reads as TINY, not leak: the strict pass is trapped by
// the hatch, and the escalated walls-only pass leaks through the door and is
// discarded. On the sealed mask that same escalation is bounded and succeeds.
// A genuine dense-linework tiny/boundary just fails again on every radius
// (dilation only adds barrier) and the original status stands — the retries
// cost little because trapped floods are small and dilated masks are cached.
//
// RADII ARE SCALE-DEPENDENT. A doorway is feet wide, and how many mask px that
// is depends on the sheet's scale and render resolution — at 1/4" = 1'-0" a
// 3'-0" door can be anywhere from ~20 to ~160 mask px. Callers that know the
// scale should pass sealRadiiFor(maskPxPerFt); the exported SEAL_RADII default
// is the scale-blind floor (hairline drafting gaps only).
export const SEAL_RADII = [1, 2, 4];    // fallback — seals gaps up to 2/4/8 px wide
export const DOOR_SEAL_MAX_FT = 5;      // widest opening sealing will bridge (3'-0" doors + margin)
export const SEAL_R_MAX = 128;          // absolute radius cap (cost + the Uint8 distance transform)
export const SEAL_VIRTUAL_MAX = 0.25;   // a sealed region's boundary must be ≥75% real linework

/** The escalation ladder for a sheet where one foot spans `maskPxPerFt` mask px:
 *  1, 2, 4, … doubling up to the radius that bridges a DOOR_SEAL_MAX_FT opening
 *  (a dilation of r closes gaps ≤ 2r). Falls back to SEAL_RADII when the scale
 *  is unknown or degenerate. */
export function sealRadiiFor(maskPxPerFt: number): number[] {
  if (!Number.isFinite(maskPxPerFt) || maskPxPerFt <= 0) return SEAL_RADII;
  const maxR = Math.min(SEAL_R_MAX, Math.ceil((DOOR_SEAL_MAX_FT * maskPxPerFt) / 2));
  const radii: number[] = [];
  for (let r = 1; r < maxR; r *= 2) radii.push(r);
  radii.push(maxR);
  return radii;
}

// Distance transforms + dilated masks are pure functions of the mask; memoized
// per mask identity so hover-preview and click share the work (a sheet's mask
// object is cached upstream).
interface SealScratch { dt: Uint8Array; byR: Map<number, MaskObj>; }
const sealCache = new WeakMap<Uint8Array, SealScratch>();

// MANHATTAN (city-block) distance to the nearest HARD cell, two-pass chamfer,
// saturating at 255 (radii are capped far below). One O(n) pass pair makes
// every dilation radius an O(n) threshold instead of r erosion sweeps.
//
// Manhattan, not chessboard, deliberately: growRegionBack walks this field by
// STRICT descent, and the city-block metric has no plateau faces — every open
// cell at distance d has a 4-neighbor at d−1 (step toward its wall), so the
// stolen band is fully recoverable, while the ridge in front of a sealed
// doorway (where two jamb fronts tie) stays a strict-descent dead end.
// Chessboard contours are squares whose flat faces plateau for r cells at a
// stretch — descent stalls inside rooms and creeps through doorways instead.
function hardDT(mask: Uint8Array, mw: number, mh: number): Uint8Array {
  const dt = new Uint8Array(mw * mh).fill(255);
  for (let y = 0; y < mh; y++) {                       // forward: W, N
    const row = y * mw;
    for (let x = 0; x < mw; x++) {
      const i = row + x;
      if (mask[i] & 1) { dt[i] = 0; continue; }
      let d = 255;
      if (x > 0) d = Math.min(d, dt[i - 1] + 1);
      if (y > 0) d = Math.min(d, dt[i - mw] + 1);
      dt[i] = Math.min(255, d);
    }
  }
  for (let y = mh - 1; y >= 0; y--) {                  // backward: E, S
    const row = y * mw;
    for (let x = mw - 1; x >= 0; x--) {
      const i = row + x;
      let d = dt[i];
      if (x < mw - 1) d = Math.min(d, dt[i + 1] + 1);
      if (y < mh - 1) d = Math.min(d, dt[i + mw] + 1);
      dt[i] = Math.min(255, d);
    }
  }
  return dt;
}

/** Diamond (Manhattan) dilation of the HARD cells by r — every cell within
 *  city-block distance r of a wall becomes barrier; along a wall's axis a gap
 *  of ≤ 2r closes. Soft (bit 2) cells carry over untouched; a soft cell
 *  swallowed by the dilation becomes 3, and hard wins every barrier test.
 *  `dt` lets floodRegionSealed reuse its cached distance transform; standalone
 *  callers may omit it. */
export function dilateHardMask(mo: MaskObj, r: number, dt?: Uint8Array): MaskObj {
  const { mask, mw, mh, ws, softCount, mppf } = mo;
  const n = mw * mh;
  const d = dt || hardDT(mask, mw, mh);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (d[i] <= r ? 1 : 0) | (mask[i] & 2);
  return { mask: out, mw, mh, ws, softCount, mppf };
}

// Grow the sealed-mask region back toward the true linework (4-connected BFS,
// ≤ r layers) into cells open on the ORIGINAL mask. Two constraints keep the
// growth honest at door-scale radii:
//   • dt[cell] ≤ r — only cells the dilation actually stole are recoverable;
//   • dt never INCREASES along a growth path — the region descends (or moves
//     level) toward the walls it was pushed off of. Plateau moves are what
//     recover corner blocks and wall-hugging runs (their dt is min-of-two-walls
//     and holds constant along one axis). The doorway still can't be crossed:
//     past the wall plane the Manhattan distance to the jambs strictly RISES,
//     so every path out of the opening would have to ascend — forbidden. That
//     asymmetry (plateaus inside, ascent outside) is the whole trick.
// With ascent forbidden the walk is naturally confined; no step budget needed.
// `barrier` mirrors the fill that produced the region: walls-only when it
// escalated past hatch, walls+hatch otherwise.
function growRegionBack(f: { region: Uint8Array; count: number; mw: number; mh: number }, orig: MaskObj, r: number, barrier: number, dt: Uint8Array): void {
  const { region, mw, mh } = f;
  const mask = orig.mask;
  let frontier: number[] = [];
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) {
      const i = row + x;
      if (!region[i]) continue;
      if ((x > 0 && !region[i - 1]) || (x < mw - 1 && !region[i + 1]) || (y > 0 && !region[i - mw]) || (y < mh - 1 && !region[i + mw])) frontier.push(i);
    }
  }
  const tryGrow = (from: number, to: number, next: number[]) => {
    if (!region[to] && !(mask[to] & barrier) && dt[to] <= r && dt[to] <= dt[from]) { region[to] = 1; f.count++; next.push(to); }
  };
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % mw, y = (i / mw) | 0;
      if (x > 0) tryGrow(i, i - 1, next);
      if (x < mw - 1) tryGrow(i, i + 1, next);
      if (y > 0) tryGrow(i, i - mw, next);
      if (y < mh - 1) tryGrow(i, i + mw, next);
    }
    frontier = next;
  }
}

// ── 4c. door-swing inclusion — measure to the wall opening ─────────────────
// A drawn door (leaf + swing arc) bounds the flood, which keeps rooms from
// merging through their doorways — but the swing wedge behind the arc IS floor
// the estimator must count: flooring runs under the door. The wedge is NOT an
// enclosed pocket (its far edge is the open doorway itself), so it cannot be
// annexed by flooding "behind the arc" — that walks straight out the opening.
//
// Instead, doorways UNIFY: re-flood with CURVE cells (bit 4) transparent so
// the arc no longer bounds the room, and let gap sealing close the doorway at
// the wall plane exactly as it would a cased opening. The result reads to the
// threshold, wedge included, neighbor still excluded — with every sealing
// sanity gate in force.
//
// PER ARC, not all at once (adversarial review, round 8): a room ringed by
// several open doorways used to open every boundary arc in one retry — the
// combined growth blew the allowance, the whole retry was rejected, and a
// multi-door room lost every wedge (~a quarter-circle of real floor per
// door). Now each arc CLUSTER (connected curve cells; dash gaps bridge)
// retries independently and its acceptance is bounded by the arc's OWN
// GEOMETRY, re-fitted from the cluster's cells (arcClusterFit →
// wedgeAllowance): the sector the leaf sweeps about the fitted hinge, boxed in
// the arc's CHORD FRAME, capped at two 5-ft doors' worth.
//
// The claim that used to stand here — that a curved wall's thin box could
// never admit the closet behind it — was FALSE, and this is the correction.
// The box was AXIS-ALIGNED, so a diagonal shallow arc got a near-square one;
// the ceiling was a constant ≈51 SF at every scale that ignored the arc's own
// radius; and the rim was denominated in mask px. A 30 ft wall with a 2.5 ft
// bulge annexed the whole ~50 SF behind it, at 0.97 confidence, labelled
// "incl. door swing", with no door anywhere in the scene. What actually keeps
// a curved wall honest is its RADIUS: 46 ft is not a door leaf, and a cluster
// that fits one clean circle of non-leaf radius gets no allowance at all.
export const WEDGE_SLACK = 1.3;        // growth head-room over the ideal quarter-circle
export const WEDGE_GROWTH_FRAC = 0.30; // or this fraction of the region — corridors touch many doors
export const WEDGE_MAX_DOORS = 12;     // absolute ceiling on the fractional allowance — 30% of a
                                       // giant region (sheet-margin space) is not a door's worth
/** Per-door growth allowance (mask cells) at maskPxPerFt: a DOOR_SEAL_MAX_FT
 *  leaf's swing wedge, with slack. 0 (skip the door retry) when the scale is
 *  unknown. */
export function doorWedgeCapPx(maskPxPerFt: number): number {
  if (!Number.isFinite(maskPxPerFt) || maskPxPerFt <= 0) return 0;
  return Math.round((Math.PI / 4) * (DOOR_SEAL_MAX_FT * maskPxPerFt) ** 2 * WEDGE_SLACK);
}

/** Curve cells hugging THIS region's boundary (Chebyshev ≤ 3, covering a
 *  2-px arc raster), grouped into CLUSTERS — one per door arc; gaps up to
 *  3 cells bridge, so a dashed arc is one cluster. Locality is what makes
 *  the retry work on dense plans: a hospital wing has dozens of drawn
 *  doors, and opening arcs beyond the clicked room's boundary merges
 *  spaces through doorways the seal ladder can't all close. (Per-click
 *  build, no cache — the retry only runs on curve-adjacent rooms, and the
 *  hover path already caches per room.) */
function boundaryCurveClusters(mo: MaskObj, region: Uint8Array): number[][] {
  const { mw, mh } = mo;
  const src = mo.mask;
  const isNear = new Uint8Array(mw * mh);
  const near: number[] = [];
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) {
      const i = row + x;
      if (!(src[i] & MASK_CURVE_BIT)) continue;
      let n = false;
      for (let dy = -3; dy <= 3 && !n; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= mh) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < mw && region[ny * mw + nx]) { n = true; break; }
        }
      }
      if (n) { near.push(i); isNear[i] = 1; }
    }
  }
  // expand from the near cells through EVERY connected curve cell: a door
  // that swings into the clicked space has only part of its arc hugging the
  // boundary, but the retry must open (and the allowance must be sized by)
  // the WHOLE arc — a partial cluster's bounding box under-sizes the wedge
  // and the door is wrongly rejected
  const clusters: number[][] = [];
  const seen = new Uint8Array(mw * mh);
  for (const s of near) {                    // scanline order ⇒ deterministic clusters
    if (seen[s]) continue;
    const cl: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      cl.push(i);
      const x = i % mw, y = (i / mw) | 0;
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= mh) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= mw) continue;
          const j = ny * mw + nx;
          if (!seen[j] && (src[j] & MASK_CURVE_BIT)) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    clusters.push(cl);
  }
  return clusters;
}

/** A boundary curve cluster, re-fitted as geometry.
 *  A cluster is a bag of mask CELLS — it carries no radius, and a per-SEGMENT
 *  bit can't supply one (buildMask ORs bits per crossing segment, so a cell
 *  touched by two different arcs carries both). Re-fitting the circle from the
 *  cells themselves is what actually works, and it is the only place the
 *  sheet scale (MaskObj.mppf) is available, so the feet-true door-leaf test
 *  lives here rather than in render-time arc detection. */
export interface ArcClusterFit {
  cx: number; cy: number;      // fitted centre, mask px (the HINGE of a door arc)
  r: number;                   // fitted radius, mask px
  rms: number;                 // fit residual, mask px
  good: boolean;               // one circle explains the cluster (a double door's two arcs do not)
  sweep: number;               // angular extent about the centre, radians
  noDoorFrac: number;          // fraction of cells flagged MASK_NODOOR_BIT
  bu: number; bn: number;      // CHORD-FRAME extents (along / across the arc's own chord), mask px
  buH: number; bnH: number;    // ...the same box widened to reach the hinge (only meaningful when `good`)
}

/** Least-squares circle through a cluster's cells + its chord-frame extent.
 *  The chord frame is the whole point of the extent: an axis-aligned box gives
 *  a DIAGONAL shallow arc a near-square box (a 30 ft chord at 45° boxes
 *  21 ft × 21 ft instead of 30 ft × its 2.5 ft sagitta), which is how a curved
 *  wall used to buy itself a door's worth of allowance. */
export function arcClusterFit(cl: number[], mw: number, mask: Uint8Array): ArcClusterFit {
  const m = cl.length;
  const X = (i: number) => i % mw, Y = (i: number) => (i / mw) | 0;
  let mx = 0, my = 0, noDoor = 0;
  for (const i of cl) { mx += X(i); my += Y(i); if (mask[i] & MASK_NODOOR_BIT) noDoor++; }
  mx /= m; my /= m;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const i of cl) {
    const x = X(i) - mx, y = Y(i) - my, z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
  }
  // principal axis of the cells = the arc's own chord direction (a shallow arc
  // is dominated by its chord); the covariance is already accumulated above
  const tr = sxx + syy, dsc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr / 2 + dsc;
  let ux = sxy, uy = l1 - sxx;
  if (Math.hypot(ux, uy) < 1e-9) { ux = 1; uy = 0; } else { const L = Math.hypot(ux, uy); ux /= L; uy /= L; }
  let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const i of cl) {
    const x = X(i) - mx, y = Y(i) - my;
    const a = x * ux + y * uy, b = -x * uy + y * ux;
    if (a < u0) u0 = a; if (a > u1) u1 = a; if (b < n0) n0 = b; if (b > n1) n1 = b;
  }
  const bu = u1 - u0 + 1, bn = n1 - n0 + 1;
  const base = { cx: mx, cy: my, r: 0, rms: Infinity, good: false, sweep: 0, noDoorFrac: noDoor / m, bu, bn, buH: bu, bnH: bn };
  const det = sxx * syy - sxy * sxy;
  if (m < ARC_MIN_CHORDS || Math.abs(det) < 1e-9) return base;
  const cx = (sxz * syy - syz * sxy) / (2 * det), cy = (syz * sxx - sxz * sxy) / (2 * det);
  let r = 0;
  for (const i of cl) r += Math.hypot(X(i) - mx - cx, Y(i) - my - cy);
  r /= m;
  if (!(r > 0)) return base;
  let s2 = 0;
  const angs: number[] = [];
  for (const i of cl) {
    const dx = X(i) - mx - cx, dy = Y(i) - my - cy;
    const d = Math.hypot(dx, dy) - r;
    s2 += d * d;
    angs.push(Math.atan2(dy, dx));
  }
  const rms = Math.sqrt(s2 / m);
  angs.sort((a, b) => a - b);
  let gap = angs[0] + 2 * Math.PI - angs[angs.length - 1];
  for (let k = 1; k < angs.length; k++) if (angs[k] - angs[k - 1] > gap) gap = angs[k] - angs[k - 1];
  // the hinge (fitted centre) in the SAME chord frame, so the wedge's box can
  // reach it — a quarter arc's own box is smaller than the wedge it bounds
  const hu = cx * ux + cy * uy, hn = -cx * uy + cy * ux;
  return {
    ...base,
    cx: cx + mx, cy: cy + my, r, rms,
    good: rms <= Math.max(CLUSTER_FIT_TOL_PX, CLUSTER_FIT_TOL_FRAC * r),
    sweep: Math.max(0, 2 * Math.PI - gap),
    buH: Math.max(u1, hu) - Math.min(u0, hu) + 1,
    bnH: Math.max(n1, hn) - Math.min(n0, hn) + 1,
  };
}

/** The growback rim, in FEET. The retry's boundary may sit up to the seal
 *  growback margin (dt ≤ 3 cells at the 18 px/ft calibration — 2 inches)
 *  outside the arc's own extent, so the allowance carries a rim of that
 *  width. Written as 3 CELLS it was not feet-true: the rim's AREA is
 *  width × perimeter, and with the perimeter growing as mppf the rim shrank
 *  as 1/mppf in SF — the same drawing got a different allowance at a
 *  different raster. Denominated in feet it is resolution-free, with the
 *  3-cell raster-honesty floor kept below the calibration point. */
export const WEDGE_RIM_FT = 3 / CAL_MPPF;              // = 2 inches
export function wedgeRimPx(maskPxPerFt: number): number {
  if (!Number.isFinite(maskPxPerFt) || maskPxPerFt <= 0) return 3;
  return Math.max(3, Math.round(WEDGE_RIM_FT * maskPxPerFt));
}

/** Growth (mask cells) a cluster's curve-transparent retry may add, and
 *  whether the cluster looks like a door swing at all.
 *
 *  A door retry annexes the SECTOR between the arc and its hinge — and the
 *  hinge is the fitted circle's CENTRE, so the sector is 0.5·θ·r², bounded
 *  independently by the cluster's chord-frame box (which must include that
 *  centre, or a quarter-arc's box would be smaller than its own wedge).
 *  Two refusals, and the line between them is whether the cluster's OWN
 *  geometry already bounds the growth:
 *    • flagged non-door (closed circle / cloud scallop) AND no clean circle
 *      fit — a cloud explains nothing about how far a hole in it can reach, so
 *      only the refusal stands between it and 51 SF of the next room. A
 *      flagged cluster that DOES fit one circle needs no refusal: the sector
 *      bound below is its own interior, and the corpus's real plan counts the
 *      floor inside a drawn ring as floor.
 *    • one clean circle whose radius is not a door leaf — what a curved wall
 *      always is. Here geometry does NOT help: a 46 ft radius sweeps a 700 SF
 *      sector, so the old constant ceiling (2 × a 5 ft door's wedge ≈ 51 SF at
 *      every scale) let a 30 ft × 2.5 ft wall annex the ~50 SF behind it. Only
 *      the upper edge of the band refuses — an arc SHORTER than a closet leaf
 *      is bounded by its own tiny sector, so DOOR_R_MIN_FT governs ranking. */
export function wedgeAllowance(fit: ArcClusterFit, mppf: number, wedgeCapPx: number): number {
  if (fit.noDoorFrac > 0.5 && !fit.good) return 0;
  if (fit.good && mppf > 0 && fit.r / mppf > DOOR_R_MAX_FT) return 0;
  const rim = wedgeRimPx(mppf);
  const bu = fit.good ? fit.buH : fit.bu, bn = fit.good ? fit.bnH : fit.bn;
  let area = bu * bn;
  if (fit.good) area = Math.min(area, 0.5 * fit.sweep * fit.r * fit.r);
  area += 2 * rim * (bu + bn) + 4 * rim * rim;
  return Math.min(2 * wedgeCapPx, Math.round(area * WEDGE_SLACK));
}

/** How door-like a cluster is, for RANKING (the wedge budget is finite, and
 *  taking clusters in scanline order let a row of curved fixtures spend it
 *  before the room's real doors were ever reached). Higher is more door-like. */
function doorLikeness(fit: ArcClusterFit, mppf: number): number {
  let s = 1 - fit.noDoorFrac;
  const swDeg = (fit.sweep * 180) / Math.PI;
  if (fit.good) {
    s += 1;
    if (mppf > 0 && fit.r / mppf >= DOOR_R_MIN_FT && fit.r / mppf <= DOOR_R_MAX_FT) s += 4;
    if (swDeg >= 45 && swDeg <= 190) s += 2;
  }
  return s;
}

// Walk the seed up the distance field until it clears the dilation radius —
// a click near a wall lands inside the dilated barrier, where floodPass's
// 3-px nudge can't rescue it. Strict ascent never crosses a wall (dt = 0), so
// the walk stays in the seed's own open component; if it stalls on a ridge
// before clearing r, the original seed stands and the attempt fails as before.
function ascendSeed(dt: Uint8Array, mw: number, mh: number, ws: number, ix: number, iy: number, r: number): [number, number] {
  let cx = Math.max(0, Math.min(mw - 1, Math.round(ix * ws)));
  let cy = Math.max(0, Math.min(mh - 1, Math.round(iy * ws)));
  for (let step = 0; step < 2 * r && dt[cy * mw + cx] <= r; step++) {
    let bx = cx, by = cy, bd = dt[cy * mw + cx];
    if (cx > 0 && dt[cy * mw + cx - 1] > bd) { bd = dt[cy * mw + cx - 1]; bx = cx - 1; by = cy; }
    if (cx < mw - 1 && dt[cy * mw + cx + 1] > bd) { bd = dt[cy * mw + cx + 1]; bx = cx + 1; by = cy; }
    if (cy > 0 && dt[(cy - 1) * mw + cx] > bd) { bd = dt[(cy - 1) * mw + cx]; bx = cx; by = cy - 1; }
    if (cy < mh - 1 && dt[(cy + 1) * mw + cx] > bd) { bd = dt[(cy + 1) * mw + cx]; bx = cx; by = cy + 1; }
    if (bx === cx && by === cy) break;                 // stalled on a ridge
    cx = bx; cy = by;
  }
  return [cx / ws, cy / ws];
}

// One base-flood + seal-ladder attempt against a specific mask. The dt used
// for growback/virtual-boundary checks is the ATTEMPT mask's own transform, so
// the curve-transparent retry measures distance to walls-without-arcs.
//
// `minPassPx` > 0 turns on the feet-true minimum-passage rule: the PRIMARY
// flood runs against walls dilated by that radius (closing sub-MIN_PASS_FT
// slits — see minPassRadiusFor), grown back onto the true linework. This is a
// SEMANTIC default, not a repair: whether a hair-width slit connects two
// spaces must be a property of the drawing, never of the mask resolution. If
// the dilated flood fails (open space still leaks; the dilation ate a
// sliver-sized region), everything falls back exactly to the old behavior:
// raw flood first, then the seal ladder — sealing still only ever improves.
function sealAttempt(mo: MaskObj, ix: number, iy: number, sensitivity: number, radii: number[], minPassPx = 0): FloodResult {
  const scratch = (): SealScratch => {
    let s = sealCache.get(mo.mask);
    if (!s) { s = { dt: hardDT(mo.mask, mo.mw, mo.mh), byR: new Map() }; sealCache.set(mo.mask, s); }
    return s;
  };
  if (minPassPx > 0) {
    const s = scratch();
    let dm = s.byR.get(minPassPx);
    if (!dm) { dm = dilateHardMask(mo, minPassPx, s.dt); s.byR.set(minPassPx, dm); }
    const [ax, ay] = ascendSeed(s.dt, mo.mw, mo.mh, mo.ws, ix, iy, minPassPx);
    const f = floodRegion(dm, ax, ay, sensitivity);
    if (f.status === "ok") {
      growRegionBack(f, mo, minPassPx, f.hatchFiltered ? 1 : 3, s.dt);
      return f;
    }
  }
  const base = floodRegion(mo, ix, iy, sensitivity);
  if (base.status === "ok") return base;
  const sc = scratch();
  for (const r of radii) {
    if (r <= minPassPx) continue;   // a subset of the primary's dilation — already failed harder
    let dm = sc.byR.get(r);
    if (!dm) { dm = dilateHardMask(mo, r, sc.dt); sc.byR.set(r, dm); }
    const [ax, ay] = ascendSeed(sc.dt, mo.mw, mo.mh, mo.ws, ix, iy, r);
    const f = floodRegion(dm, ax, ay, sensitivity);
    if (f.status !== "ok") continue;
    growRegionBack(f, mo, r, f.hatchFiltered ? 1 : 3, sc.dt);
    // Two sanity gates keep sealing honest — without them, dilating hard enough
    // eventually STARVES any big open space (a lobby, the sheet itself) under
    // the leak cap and reports a giant "sealed" blob:
    //   • the grown region must still satisfy the room-size cap the plain
    //     flood enforces (a room is never 30% of the sheet);
    //   • the seal must be LOCAL — most of the region's boundary must hug real
    //     linework (dt ≤ 3), with only door-width virtual runs. A starved blob
    //     ends at descent watersheds in open space and fails this immediately.
    if (f.count > f.mw * f.mh * 0.30) continue;
    const vf = virtualBoundaryFrac(f, sc.dt);
    if (vf > SEAL_VIRTUAL_MAX) continue;
    f.sealedPx = r;
    f.virtualFrac = +vf.toFixed(3);   // confidence signal: how much boundary is synthetic
    return f;
  }
  return base;
}

/** floodRegion, plus leak recovery (see sealAttempt), plus door-swing
 *  inclusion: when `wedgeCapPx` > 0 and the result is bounded by drawn door
 *  linework, each boundary arc cluster gets its own curve-transparent retry
 *  re-measuring to the wall opening; a retry is kept only when its growth
 *  stays inside the arc's own bounding-box allowance. Accepted wedges union. */
export function floodRegionSealed(mo: MaskObj, ix: number, iy: number, sensitivity: number = SENS_BALANCED, radii: number[] = SEAL_RADII, wedgeCapPx = 0, minPassPx = 0): FloodResult {
  const r1 = sealAttempt(mo, ix, iy, sensitivity, radii, minPassPx);
  if (!wedgeCapPx || r1.status !== "ok") return r1;
  const clusters = boundaryCurveClusters(mo, r1.region);
  if (!clusters.length) return r1;
  // the global ceiling across all accepted wedges keeps the old semantics:
  // a giant region's fractional allowance is still never more than
  // WEDGE_MAX_DOORS' worth of 5-ft doors
  const globalAllowance = Math.max(wedgeCapPx, Math.min(Math.round(r1.count * WEDGE_GROWTH_FRAC), WEDGE_MAX_DOORS * wedgeCapPx));
  const { mw, mh } = mo;
  let region: Uint8Array | null = null;
  let count = r1.count;
  let wedges = 0;
  let hatchFiltered = !!r1.hatchFiltered;
  let sealedPx = r1.sealedPx, virtualFrac = r1.virtualFrac;
  // Judge every cluster as GEOMETRY first (re-fitted circle: radius, sweep,
  // chord-frame extent), then spend the finite wedge budget on the most
  // door-like ones. Ranking, not scanline order: a room ringed with curved
  // millwork used to exhaust the budget before its real doors were reached.
  // Ties break on first-cell index, so the order stays deterministic.
  const ranked = clusters
    .map((cl) => {
      const fit = arcClusterFit(cl, mw, mo.mask);
      return { cl, fit, allow: wedgeAllowance(fit, mo.mppf || 0, wedgeCapPx), rank: doorLikeness(fit, mo.mppf || 0), at: cl[0] };
    })
    .filter((c) => c.allow >= 1)
    .sort((a, b) => (b.rank - a.rank) || (a.at - b.at));
  for (const { cl, allow: clusterAllowance } of ranked.slice(0, WEDGE_MAX_DOORS)) {
    // open ONLY this cluster's cells
    const m2mask = mo.mask.slice();
    for (const i of cl) m2mask[i] = m2mask[i] & ~1;
    const m2: MaskObj = { mask: m2mask, mw, mh, ws: mo.ws, softCount: mo.softCount, mppf: mo.mppf };
    let sc2 = sealCache.get(m2.mask);
    if (!sc2) { sc2 = { dt: hardDT(m2.mask, mw, mh), byR: new Map() }; sealCache.set(m2.mask, sc2); }
    // retry from the ROOM'S most interior cell, not the click — the retry's
    // sealed floods dilate the walls, and a click near a wall (or a hover
    // sweeping in from a neighbor) would start inside the dilated barrier.
    // Any cell of r1's region floods the same space, so pick the deepest
    // one; this also makes the retry deterministic per room per door.
    let bi = -1, bd = -1;
    for (let i = 0; i < r1.region.length; i++) if (r1.region[i] && sc2.dt[i] > bd) { bd = sc2.dt[i]; bi = i; }
    const sx = bi < 0 ? ix : (bi % mw) / mo.ws, sy = bi < 0 ? iy : Math.floor(bi / mw) / mo.ws;
    const r2 = sealAttempt(m2, sx, sy, sensitivity, radii, minPassPx);
    if (r2.status !== "ok" || r2.count <= r1.count) continue;
    const growth = r2.count - r1.count;
    if (growth > clusterAllowance) continue;           // curved wall / open paper, not a door
    if (count - r1.count + growth > globalAllowance) continue;
    if (!region) region = r1.region.slice();
    for (let i = 0; i < region.length; i++) if (r2.region[i] && !region[i]) { region[i] = 1; count++; }
    wedges++;
    if (r2.hatchFiltered) hatchFiltered = true;
    if (r2.sealedPx && (!sealedPx || r2.sealedPx > sealedPx)) sealedPx = r2.sealedPx;
    if (r2.virtualFrac != null && (virtualFrac == null || r2.virtualFrac > virtualFrac)) virtualFrac = r2.virtualFrac;
  }
  if (!wedges || !region) return r1;
  const out: FloodResult & { status: "ok" } = {
    status: "ok", region, count, mw, mh, ws: r1.ws, mppf: r1.mppf,
    hardHits: r1.hardHits, softHits: r1.softHits,
    hatchFiltered: hatchFiltered || undefined, sealedPx, virtualFrac,
  };
  // Absorb the door LEAF: the straight leaf line stays a barrier through the
  // retry, leaving a 1–2 px slit between the room and the annexed wedge. The
  // outer contour would dive up that slit and back, inflating perimeter_lf by
  // ~2 leaf lengths per door — a baseboard over-count. The leaf is exactly
  // the barrier pinched between r1's region and the annexed delta, so absorb
  // only that: real wall stubs (pinched between r1 and r1) keep their slit —
  // baseboard genuinely runs around those.
  const reg = region, reg1 = r1.region, mask = mo.mask;
  const isDelta = (i: number) => reg[i] && !reg1[i];
  for (let pass = 0; pass < 2; pass++) {               // Bresenham lines raster up to 2 px thick
    for (let y = 1; y < mh - 1; y++) {
      const row = y * mw;
      for (let x = 1; x < mw - 1; x++) {
        const i = row + x;
        if (reg[i] || !(mask[i] & 1)) continue;
        const pinchH = reg[i - 1] && reg[i + 1], pinchV = reg[i - mw] && reg[i + mw];
        if ((pinchH && (isDelta(i - 1) || isDelta(i + 1))) || (pinchV && (isDelta(i - mw) || isDelta(i + mw)))) { reg[i] = 1; out.count++; }
      }
    }
  }
  out.wedges = wedges;
  out.wedgeGrowth = +(out.count / r1.count).toFixed(3); // confidence signal: how much the door retries grew
  return out;
}

// Fraction of a region's boundary cells that do NOT hug original linework
// (dt > 3): 0 for a fully wall-bounded room, ≈ door/perimeter for a legit
// seal, large for a dilation-starved blob whose edges sit in open space.
function virtualBoundaryFrac(f: { region: Uint8Array; mw: number; mh: number }, dt: Uint8Array): number {
  const { region, mw, mh } = f;
  let boundary = 0, virtual = 0;
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) {
      const i = row + x;
      if (!region[i]) continue;
      if ((x > 0 && !region[i - 1]) || (x < mw - 1 && !region[i + 1]) || (y > 0 && !region[i - mw]) || (y < mh - 1 && !region[i + mw])) {
        boundary++;
        if (dt[i] > 3) virtual++;
      }
    }
  }
  return boundary ? virtual / boundary : 1;
}

// ── 5. contour trace + simplify ────────────────────────────────────────────
// Moore-neighbor trace of the region's OUTER boundary, then closed-ring RDP.
// Returns image-px vertices.
export function traceRegion(reg: RegionResult, epsMaskPx = 1.5): Point[] {
  const { region, mw, mh, ws } = reg;
  let s = -1;
  for (let i = 0; i < region.length; i++) if (region[i]) { s = i; break; }
  if (s < 0) return [];
  const sx = s % mw, sy = (s / mw) | 0;
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < mw && y < mh && !!region[y * mw + x];
  // Moore neighborhood, clockwise from W
  const N = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const pts: Point[] = [];
  let cx = sx, cy = sy, dir = 6;          // entered heading south (came from the open row above)
  const maxSteps = mw * mh * 4;
  for (let step = 0; step < maxSteps; step++) {
    pts.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;        // start search 90° counter-clockwise of arrival
      const nx = cx + N[d][0], ny = cy + N[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
    }
    if (!found) break;                     // isolated pixel
    if (cx === sx && cy === sy && pts.length > 2) break;
  }
  const ring = rdpClosed(pts, epsMaskPx);
  return ring.map(([x, y]) => [x / ws, y / ws] as Point);
}

function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
}
function rdpOpen(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts.slice();
  let imax = 0, dmax = -1;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], a, b); if (d > dmax) { dmax = d; imax = i; } }
  if (dmax <= eps) return [a, b];
  const left = rdpOpen(pts.slice(0, imax + 1), eps);
  const right = rdpOpen(pts.slice(imax), eps);
  return left.slice(0, -1).concat(right);
}
// Closed ring: anchor at the two mutually-farthest-ish points (first vertex and
// the vertex farthest from it), simplify each half, rejoin.
export function rdpClosed(pts: Point[], eps: number): Point[] {
  if (pts.length < 4) return pts.slice();
  let split = 0, dmax = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > dmax) { dmax = d; split = i; }
  }
  const h1 = rdpOpen(pts.slice(0, split + 1), eps);
  const h2 = rdpOpen(pts.slice(split).concat([pts[0]]), eps);
  const ring = h1.slice(0, -1).concat(h2.slice(0, -1));
  return ring.length >= 3 ? ring : pts.slice();
}

// ── 6. vertex snap + cleanup ───────────────────────────────────────────────
// Pull traced corners onto true PDF endpoints (the ruling: "vertices snapped").
// Collapses any post-snap duplicates; refuses a snap set that would degenerate
// the ring.
export function snapVertices(poly: Point[], nearest: NearestFn, tolPx = 6, minGapPx = 2): Point[] {
  const snapped: Point[] = poly.map(([x, y]) => {
    const hit = nearest(x, y, tolPx);
    return hit ? [hit[0], hit[1]] as Point : [x, y] as Point;
  });
  const out: Point[] = [];
  for (const p of snapped) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > minGapPx) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= minGapPx) out.pop();
  return out.length >= 3 ? out : poly;
}

// Shoelace in whatever px the ring is in (caller multiplies by upp²).
export function ringArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
