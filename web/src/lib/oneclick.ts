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

export type Point = [number, number];
export interface OpList { fnArray: number[]; argsArray: any[][]; }
/** pdf.js's OPS code table (op name → numeric code); passed in so this module never imports pdfjs. */
export type OpsTable = Record<string, number>;
export interface VectorGeometry { points: Point[]; segs: number[]; }
export interface MaskObj { mask: Uint8Array; mw: number; mh: number; ws: number; }
export interface RegionResult { region: Uint8Array; mw: number; mh: number; ws: number; count?: number; }
export type FloodResult =
  | { status: "boundary" }
  | { status: "leak" }
  | { status: "tiny"; count: number }
  | { status: "ok"; region: Uint8Array; count: number; mw: number; mh: number; ws: number };
/** Caller's snap-grid lookup: nearest true endpoint to (x,y) within maxDist, or null. */
export type NearestFn = (x: number, y: number, maxDist: number) => Point | null | undefined;

export const MASK_MAX_DIM = 3000;   // working raster cap (Uint8 ≈ 6–7 MB)
const LEAK_FRACTION = 0.30;         // fill > 30% of the sheet ⇒ not an enclosed space
const TINY_PX = 30;                 // fill < 30 mask px ⇒ landed in dense linework
const MIN_THICK = 4;                // region bbox thinner than 4 mask px ⇒ hatch sliver, not a room
const CURVE_STEPS = 8;              // chords per bezier (door swings stay closed)

// ── 1. op-list walk ────────────────────────────────────────────────────────
// Same transform composition as the original snap extractor (save/restore/
// transform/constructPath), now also emitting SEGMENTS for the boundary mask.
// `transform` is viewport.transform; OPS is pdfjs's op-code table.
export function extractVectorGeometry(opList: OpList, transform: number[], OPS: OpsTable): VectorGeometry {
  const points: Point[] = [];
  const segs: number[] = [];
  let m = transform.slice();
  const stack: number[][] = [];
  const mul = (a: number[], b: number[]): number[] => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const tx = (x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const fns = opList.fnArray, A = opList.argsArray;
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i], args = A[i];
    if (fn === OPS.save) stack.push(m.slice());
    else if (fn === OPS.restore) { const p = stack.pop(); if (p) m = p; }
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.constructPath) {
      const ops = args[0], co = args[1];
      let c = 0, cur: Point | null = null, start: Point | null = null;
      const visit = (p: Point) => { points.push(p); };
      const lineTo = (p: Point) => { if (cur) segs.push(cur[0], cur[1], p[0], p[1]); cur = p; visit(p); };
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
            if (cur) segs.push(cur[0], cur[1], q[0], q[1]);
            cur = q;
          }
          visit(p3);
        }
        else if (op === OPS.closePath) { if (cur && start) { segs.push(cur[0], cur[1], start[0], start[1]); cur = start; } }
        else if (op === OPS.rectangle) {
          const x = co[c], y = co[c + 1], w = co[c + 2], h = co[c + 3]; c += 4;
          const q: Point[] = [tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)];
          for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4]; segs.push(a[0], a[1], b[0], b[1]); visit(a); }
          cur = q[0]; start = q[0];
        }
      }
    }
  }
  return { points, segs };
}

// ── 2. boundary mask ───────────────────────────────────────────────────────
// Segments (image px) → Uint8Array raster at ws = maskDim/imageDim. Single-px
// Bresenham; coincident endpoints round to the same cell so chained walls stay
// continuous.
export function buildMask(segs: number[], imgW: number, imgH: number, maxDim = MASK_MAX_DIM): MaskObj {
  const ws = Math.min(1, maxDim / Math.max(imgW, imgH, 1));
  const mw = Math.max(2, Math.ceil(imgW * ws)), mh = Math.max(2, Math.ceil(imgH * ws));
  const mask = new Uint8Array(mw * mh);
  const plot = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < mw && y < mh) mask[y * mw + x] = 1; };
  for (let i = 0; i + 3 < segs.length; i += 4) {
    let x0 = Math.round(segs[i] * ws), y0 = Math.round(segs[i + 1] * ws);
    const x1 = Math.round(segs[i + 2] * ws), y1 = Math.round(segs[i + 3] * ws);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  return { mask, mw, mh, ws };
}

// ── 3. flood fill ──────────────────────────────────────────────────────────
// Scanline fill from an image-px seed. Returns {status, region?, count?}.
export function floodRegion(maskObj: MaskObj, ix: number, iy: number): FloodResult {
  const { mask, mw, mh, ws } = maskObj;
  let sx = Math.round(ix * ws), sy = Math.round(iy * ws);
  if (sx < 0 || sy < 0 || sx >= mw || sy >= mh) return { status: "boundary" };
  if (mask[sy * mw + sx]) {
    // nudge: nearest open cell within 3 px (clicks often land on hatch lines)
    let found: Point | null = null;
    for (let r = 1; r <= 3 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = sx + dx, ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < mw && ny < mh && !mask[ny * mw + nx]) { found = [nx, ny]; break; }
      }
    }
    if (!found) return { status: "boundary" };
    sx = found[0]; sy = found[1];
  }
  const region = new Uint8Array(mw * mh);
  const cap = Math.floor(mw * mh * LEAK_FRACTION);
  let count = 0, leaked = false;
  let bx0 = sx, bx1 = sx, by0 = sy, by1 = sy;
  const stack: number[][] = [[sx, sy]];
  while (stack.length) {
    const popped = stack.pop() as number[];
    const px = popped[0], py = popped[1];
    let x0 = px;
    while (x0 > 0 && !mask[py * mw + x0 - 1] && !region[py * mw + x0 - 1]) x0--;
    let x1 = px;
    while (x1 < mw - 1 && !mask[py * mw + x1 + 1] && !region[py * mw + x1 + 1]) x1++;
    if (x0 === 0 || x1 === mw - 1 || py === 0 || py === mh - 1) leaked = true;
    if (x0 < bx0) bx0 = x0; if (x1 > bx1) bx1 = x1; if (py < by0) by0 = py; if (py > by1) by1 = py;
    let upOpen = false, downOpen = false;
    for (let x = x0; x <= x1; x++) {
      const idx = py * mw + x;
      if (region[idx]) { upOpen = downOpen = false; continue; }
      region[idx] = 1; count++;
      if (py > 0) {
        const u = idx - mw;
        if (!mask[u] && !region[u]) { if (!upOpen) { stack.push([x, py - 1]); upOpen = true; } }
        else upOpen = false;
      }
      if (py < mh - 1) {
        const d = idx + mw;
        if (!mask[d] && !region[d]) { if (!downOpen) { stack.push([x, py + 1]); downOpen = true; } }
        else downOpen = false;
      }
    }
    if (count > cap) return { status: "leak" };
  }
  if (leaked) return { status: "leak" };
  // hatch/text slivers: plenty of cells but no room-like thickness
  if (count < TINY_PX || bx1 - bx0 + 1 < MIN_THICK || by1 - by0 + 1 < MIN_THICK) return { status: "tiny", count };
  return { status: "ok", region, count, mw, mh, ws };
}

// ── 4. contour trace + simplify ────────────────────────────────────────────
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

// ── 5. vertex snap + cleanup ───────────────────────────────────────────────
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
