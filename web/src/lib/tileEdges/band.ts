// web/src/lib/tileEdges/band.ts
//
// Interior band offset geometry (design §3.4, plan §M7 Task 7.1): given a
// room ring (+holes) plus an offset and width in FEET, produce the two
// concentric rings that bound an interior band/listello — a border of tile
// running parallel to the room's own walls, inset `offset_ft` from them and
// `width_ft` thick. `outer` is the room boundary buffered inward by
// `offset_ft`; `inner` is the same boundary buffered inward by
// `offset_ft + width_ft`. The caller builds the band's tileable annulus as
// `outer` with `inner` as a hole; the field pattern then classifies against
// `inner` as its new outer boundary (the band consumes field area — design
// §3.4 "consume field area").
//
// jsts is the same JTS port classify.ts uses for cell∩room classification,
// on the same rationale: buffer/offset-curve construction is purely
// topological (planar noding + polygonization on plain coordinates, never
// spherical trig), so running it on this canvas's plan-FEET coordinates is
// safe. This module never converts units — feet in, feet out, matching
// tileSolve's `ring_ft` contract (open rings, closed only at the jsts
// boundary).
//
// A negative buffer (erosion) COLLAPSES to an empty geometry once the inset
// distance exceeds half the polygon's narrowest span — a real, common case
// (a band too wide, or offset too deep, for the room), not an error. `outer`
// and `inner` are eroded independently and either collapsing returns
// `null`; the caller treats `null` as "no band drawn" (plan §M7 7.1).
//
// The erosion uses a MITRE join (not jsts's default round join) so a
// rectangular room's corners stay square corners under the offset instead
// of rounding off — a listello follows the room's own wall lines, not an
// approximation of them.
//
// jsts's own bundled .d.ts (node_modules/jsts/types) declares almost every
// method as `(...) => any` — there is no usable static surface to import.
// Rather than sprinkle `any`/`as` through this file, every jsts value is
// bound to a `const`/return type that is one of the narrow structural
// interfaces below (mirroring classify.ts's ring/winding helpers, which
// aren't exported from there — duplicated here rather than export-coupling
// two independent modules); TypeScript allows an `any`-typed expression to
// flow into an explicitly-typed position without a cast, so `any` never
// leaks past the declaration site.
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js";

export type BandRings = { outer: [number, number][]; inner: [number, number][] };

type Pt = [number, number];

// The narrow slice of jsts's Geometry surface this module touches — see
// classify.ts:40-54 for the identical rationale and shape.
interface JstsCoordinate {
  x: number;
  y: number;
}
interface JstsGeometry {
  getArea(): number;
  getCoordinates(): JstsCoordinate[];
  getNumGeometries(): number;
  getGeometryN(n: number): JstsGeometry;
  getExteriorRing?(): JstsGeometry;
}

const AREA_EPS = 1e-7; // sq ft — buffer-collapse tolerance, matches classify.ts

// ── plain-JS ring helpers (feet, no jsts) — mirror classify.ts's approach ──

// GeoJSON/jsts rings are CLOSED (first === last); this module's callers
// (tests, and tileSolve's `ring_ft` contract) pass OPEN rings, so every ring
// is closed right before it touches jsts, and reopened right after.
function closeRing(r: readonly Pt[]): Pt[] {
  if (r.length === 0) return [];
  const [x0, y0] = r[0];
  const [xn, yn] = r[r.length - 1];
  return x0 === xn && y0 === yn ? [...r] : [...r, [x0, y0]];
}

// Doubled signed area (shoelace) — sign carries winding direction.
function signedArea2(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[i + 1];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

// jsts's overlay/buffer graph relies on a shell/hole polygon's rings being
// wound OPPOSITE each other (the OGC convention) to tell "inside" from
// "hole" apart from ring order alone — force it explicitly rather than
// assume the caller's winding.
function windAs(closed: readonly Pt[], positive: boolean): Pt[] {
  const wantPositive = signedArea2(closed) > 0 === positive;
  return wantPositive ? [...closed] : [...closed].reverse();
}

function ring(gf: GeometryFactory, closedOriented: readonly Pt[]): JstsGeometry {
  return gf.createLinearRing(closedOriented.map(([x, y]) => new Coordinate(x, y)));
}

function roomPolygon(gf: GeometryFactory, outerClosed: readonly Pt[], holes: readonly Pt[][]): JstsGeometry {
  const shell = ring(gf, windAs(outerClosed, true));
  const holeRings = holes.map((h) => ring(gf, windAs(closeRing(h), false)));
  return gf.createPolygon(shell, holeRings);
}

// Recurse to the polygonal part with the largest area — a negative buffer
// on a room with a hole (or an oddly-shaped room) can split the surviving
// solid into disjoint remnants; the band ring is the substantive piece, not
// the sum of scraps. Atomic non-polygon leaves (Point/LineString, or empty)
// report `getGeometryN(0) === this`, which bounds the recursion.
function largestPolygonPart(g: JstsGeometry): JstsGeometry | null {
  if (typeof g.getExteriorRing === "function") return g;
  let best: JstsGeometry | null = null;
  const n = g.getNumGeometries();
  for (let i = 0; i < n; i++) {
    const child = g.getGeometryN(i);
    if (child === g) continue;
    const part = largestPolygonPart(child);
    if (part && (!best || part.getArea() > best.getArea())) best = part;
  }
  return best;
}

function exteriorRingPts(part: JstsGeometry): Pt[] | null {
  if (typeof part.getExteriorRing !== "function") return null;
  return part.getExteriorRing().getCoordinates().map((c): Pt => [c.x, c.y]);
}

// Inward (erosion) buffer by `distance_ft` — mitre join (see header) — of
// `room`, reduced to the largest part's OPEN exterior ring. Null when the
// erosion collapses the polygon (room too small for this inset).
function insetExteriorRing(room: JstsGeometry, distance_ft: number): Pt[] | null {
  const params = new BufferParameters();
  params.setJoinStyle(BufferParameters.JOIN_MITRE);
  const buffered: JstsGeometry = BufferOp.bufferOp(room, -distance_ft, params);
  if (buffered.getArea() < AREA_EPS) return null;
  const part = largestPolygonPart(buffered);
  if (!part) return null;
  const pts = exteriorRingPts(part);
  if (!pts || pts.length === 0) return null;
  // reopen: jsts hands back a CLOSED exterior ring (first === last).
  const [x0, y0] = pts[0];
  const [xn, yn] = pts[pts.length - 1];
  return x0 === xn && y0 === yn ? pts.slice(0, -1) : pts;
}

// ── the public entry point ───────────────────────────────────────────────

export function bandRings({
  ring_ft,
  holes_ft = [],
  offset_ft,
  width_ft,
}: {
  ring_ft: [number, number][];
  holes_ft?: [number, number][][];
  offset_ft: number;
  width_ft: number;
}): BandRings | null {
  const gf = new GeometryFactory();
  const room = roomPolygon(gf, closeRing(ring_ft), holes_ft);
  const outer = insetExteriorRing(room, offset_ft);
  if (!outer) return null;
  const inner = insetExteriorRing(room, offset_ft + width_ft);
  if (!inner) return null;
  return { outer, inner };
}
