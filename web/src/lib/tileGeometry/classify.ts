// web/src/lib/tileGeometry/classify.ts
//
// Cell ∩ room classification (design §3.2): for each generated TileQuad,
// intersect its NOMINAL footprint (the raw w×h rectangle honoring `rot`,
// centered at cx,cy) against the room polygon (outer ring minus holes) and
// bucket it into full / cut / corner / hole / out, with cut dimensions for
// anything that isn't full or fully out.
//
// jsts is the same JTS port polyarr.ts uses for planar noding, on the same
// rationale cutout.js:17-24 documents for turf: these boolean overlay ops
// are purely topological (ray-casting + winding on plain coordinates, never
// spherical trig), so running them on this canvas's plan-FEET coordinates
// is safe. All lengths in this module are feet until the very last step,
// where kept cut dimensions are converted to inches (×12) for the caller.
//
// jsts's own bundled .d.ts (node_modules/jsts/types) declares almost every
// method as `(...) => any` — there is no usable static surface to import.
// Rather than sprinkle `any`/`as` through this file, every jsts value is
// bound to a `const` whose EXPLICIT type is one of the narrow structural
// interfaces below; TypeScript allows an `any`-typed expression to flow
// into an explicitly-typed position without a cast, so `any` never leaks
// past the declaration site.
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import { installedFace } from "../tilePitch.ts";
import type { TileQuad } from "../tilePatterns/types.ts";
import { inToFt, ftToIn } from "../tileUnits.ts";

export type CellClass = "full" | "cut" | "corner" | "hole" | "out";
export type Classified = {
  quad: TileQuad;
  cls: CellClass;
  areaFull_sf: number;
  areaKept_sf: number;
  cut?: { w_in: number; h_in: number; lShaped: boolean };
};

type Pt = [number, number];

// The narrow slice of jsts's Geometry surface this module touches. Marked
// optional where only some subtypes implement it (only Polygon carries
// `getExteriorRing`; MultiPolygon/GeometryCollection don't) so callers
// narrow with a plain `typeof x.method === "function"` check — no cast.
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
  isValid(): boolean;
  buffer(distance: number): JstsGeometry;
}

const AREA_EPS = 1e-7; // sq ft — full/out area-ratio tolerance
const LEN_EPS = 1e-6; // ft (and reused as a dimensionless parametric-range guard) — general geometric tolerance
const CORNER_SIN_EPS = 1e-3; // sine-of-angle tolerance for "non-parallel"

// ── plain-JS ring helpers (feet, no jsts) ───────────────────────────────

// GeoJSON/jsts rings are CLOSED (first === last); this module's callers
// (tests, and eventually the pattern-generator ring output) pass OPEN
// rings, so every ring is closed right before it touches jsts.
function closeRing(ring: readonly Pt[]): Pt[] {
  if (ring.length === 0) return [];
  const [x0, y0] = ring[0];
  const [xn, yn] = ring[ring.length - 1];
  return x0 === xn && y0 === yn ? [...ring] : [...ring, [x0, y0]];
}

// Doubled signed area (shoelace) — sign carries winding direction.
function signedArea2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

// jsts's overlay graph relies on a shell/hole polygon's rings being wound
// OPPOSITE each other (the OGC convention) to tell "inside" from "hole"
// apart from ring order alone — this canvas's rings arrive in whatever
// winding the caller used, so force it explicitly rather than assume it.
function windAs(closed: readonly Pt[], positive: boolean): Pt[] {
  const wantPositive = signedArea2(closed) > 0 === positive;
  return wantPositive ? [...closed] : [...closed].reverse();
}

// Builds a jsts LinearRing from a closed, correctly-wound feet ring. Every
// polygon this module builds (tile, shell, room shell/holes — 4 call
// sites) goes through this one Coordinate-mapping step, so a future change
// to how coordinates are constructed only has to happen once.
function ring(gf: GeometryFactory, closedOriented: readonly Pt[]): JstsGeometry {
  return gf.createLinearRing(closedOriented.map(([x, y]) => new Coordinate(x, y)));
}

function tileCorners(q: TileQuad): Pt[] {
  const hw = q.w / 2, hh = q.h / 2;
  const cos = Math.cos(q.rot), sin = Math.sin(q.rot);
  const local: Pt[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return local.map(([lx, ly]): Pt => [q.cx + lx * cos - ly * sin, q.cy + lx * sin + ly * cos]);
}

function roomPolygon(gf: GeometryFactory, outerClosed: readonly Pt[], holes: readonly Pt[][]): JstsGeometry {
  const shell = ring(gf, windAs(outerClosed, true));
  const holeRings = holes.map((h) => ring(gf, windAs(closeRing(h), false)));
  return gf.createPolygon(shell, holeRings);
}

// jsts's OverlayOp throws a non-noded TopologyException on a self-intersecting
// input polygon — reachable whenever the room ring is transiently invalid (a
// mid-drag bowtie the canvas now also gates out) or a user commits a genuinely
// self-touching room. buffer(0) is JTS's canonical make-valid: it re-nodes a
// self-intersecting shell into a valid (possibly multi-)polygon of the same
// footprint and leaves an already-valid polygon unchanged (so the common case
// is untouched). Applied once per classify pass to the room + shell, so the
// per-tile overlays below are never handed invalid input.
function makeValid(g: JstsGeometry): JstsGeometry {
  try {
    return g.isValid() ? g : g.buffer(0);
  } catch {
    return g; // buffer(0) itself failed on pathological input — safeIntersection catches the fallout
  }
}

// Last-resort guard: even a valid room can, on rare degenerate coordinates,
// trip jsts's noder. A single tile that can't be intersected degrades to "no
// overlap" rather than throwing and taking down the whole canvas — one cell
// mis-figured beats the takeoff going down (and the drag gate + makeValid keep
// this branch off the normal path).
function safeIntersection(a: JstsGeometry, b: JstsGeometry): JstsGeometry | null {
  try {
    return OverlayOp.intersection(a, b);
  } catch {
    return null;
  }
}

// Recurse to the polygonal part with the largest area — a hole can split a
// kept footprint into disjoint remnants; corner/lShaped describe the
// substantive piece, not the sum of scraps. Atomic non-polygon leaves
// (Point/LineString, or empty) report `getGeometryN(0) === this`, which
// bounds the recursion.
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

// ── tile-local frame + bounding box ──────────────────────────────────────

function toLocal(gx: number, gy: number, q: TileQuad): Pt {
  const dx = gx - q.cx, dy = gy - q.cy;
  const cos = Math.cos(q.rot), sin = Math.sin(q.rot);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

// Bounding box of the WHOLE kept geometry (every disjoint piece), in the
// tile's own (unrotated) local frame — so width/height line up with the
// tile's own w/h axes regardless of `rot`.
function localBBox(g: JstsGeometry, q: TileQuad): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const coords = g.getCoordinates();
  if (coords.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of coords) {
    const [lx, ly] = toLocal(c.x, c.y, q);
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
  }
  return { minX, maxX, minY, maxY };
}

// ── collinear-point simplification (lShaped) ─────────────────────────────

// jsts's overlay routinely re-nodes edges at intersection points, so even a
// straight-cut rectangle comes back with extra vertices sitting exactly on
// a straight run. Drop points whose perpendicular distance from the
// prev→next chord is below tolerance — this only removes REDUNDANT
// vertices (exact collinearity), never a real corner.
function simplifyCollinear(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    const dist = len < eps
      ? Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
      : Math.abs((cur[0] - prev[0]) * dy - (cur[1] - prev[1]) * dx) / len;
    if (dist > eps) out.push(cur);
  }
  return out.length >= 3 ? out : [...pts];
}

// ── room-edge contact (corner detection, §3.2) ───────────────────────────

function roomEdges(outerClosed: readonly Pt[]): Array<[Pt, Pt]> {
  const edges: Array<[Pt, Pt]> = [];
  for (let i = 0; i < outerClosed.length - 1; i++) edges.push([outerClosed[i], outerClosed[i + 1]]);
  return edges;
}

// Does room edge [p0,p1] genuinely CUT tile `q` — pass through the OPEN
// interior of its nominal rectangle — as opposed to merely running flush
// along one of the tile's own (uncut) sides? Distinguishing the two matters
// because a grid tile's own edge routinely coincides with a wall it was
// never clipped against (the tile already ended exactly there); only a
// wall that actually enters the tile's interior removed material from it.
// Liang–Barsky clip of the edge (transformed into the tile's local,
// unrotated frame) against the box [-w/2,w/2]×[-h/2,h/2], then a
// strict-interior check on the clipped chord's midpoint.
function edgeCutsTile(p0: Pt, p1: Pt, q: TileQuad, eps: number): boolean {
  const hw = q.w / 2, hh = q.h / 2;
  const a = toLocal(p0[0], p0[1], q);
  const b = toLocal(p1[0], p1[1], q);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const bounds: Array<[number, number]> = [
    [-dx, a[0] + hw], // x >= -hw
    [dx, hw - a[0]], // x <= hw
    [-dy, a[1] + hh], // y >= -hh
    [dy, hh - a[1]], // y <= hh
  ];
  for (const [p, r0] of bounds) {
    if (Math.abs(p) < eps) {
      if (r0 < 0) return false;
      continue;
    }
    const r = r0 / p;
    if (p < 0) { if (r > t0) t0 = r; } else if (r < t1) t1 = r;
    if (t0 > t1) return false;
  }
  if (t1 - t0 <= eps) return false;
  const tm = (t0 + t1) / 2;
  const mx = a[0] + tm * dx, my = a[1] + tm * dy;
  return mx > -hw + eps && mx < hw - eps && my > -hh + eps && my < hh - eps;
}

// corner = the tile is genuinely cut by ≥ 2 room boundary edges that are
// NOT collinear with each other — two cutting edges that are really the
// same straight wall (a redundant ring vertex split it in two) don't make
// a corner.
function isCorner(quad: TileQuad, edges: ReadonlyArray<[Pt, Pt]>, eps: number): boolean {
  const touched: number[] = [];
  for (let i = 0; i < edges.length; i++) if (edgeCutsTile(edges[i][0], edges[i][1], quad, eps)) touched.push(i);
  for (let i = 0; i < touched.length; i++) {
    for (let j = i + 1; j < touched.length; j++) {
      const [a0, a1] = edges[touched[i]];
      const [b0, b1] = edges[touched[j]];
      const ax = a1[0] - a0[0], ay = a1[1] - a0[1];
      const bx = b1[0] - b0[0], by = b1[1] - b0[1];
      const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (mag > eps && Math.abs(ax * by - ay * bx) / mag > CORNER_SIN_EPS) return true;
    }
  }
  return false;
}

// ── the public entry point ───────────────────────────────────────────────

export function classifyLayout(
  quads: TileQuad[],
  roomRing: [number, number][],
  holes: [number, number][][],
  joint_in: number,
): Classified[] {
  const gf = new GeometryFactory();
  // This codebase's `_in` suffix always means inches (tileSetup.ts's
  // TileJoint.width_in); tilePitch.ts's `j` is feet, matching TileQuad's
  // own units, so the joint is converted once here at the module boundary.
  const jointFt = inToFt(joint_in);
  const outerClosed = closeRing(roomRing);
  const edges = roomEdges(outerClosed);
  const shell: JstsGeometry = makeValid(gf.createPolygon(ring(gf, windAs(outerClosed, true))));
  const room = makeValid(roomPolygon(gf, outerClosed, holes));

  return quads.map((quad): Classified => {
    const areaFull_sf = quad.w * quad.h;
    const tile: JstsGeometry = gf.createPolygon(ring(gf, closeRing(tileCorners(quad))));
    const kept = safeIntersection(room, tile);
    const areaKept_sf = kept ? Math.max(0, kept.getArea()) : 0;

    if (!kept || areaKept_sf < AREA_EPS) {
      const shellKept = safeIntersection(shell, tile);
      const cls: CellClass = shellKept && shellKept.getArea() > AREA_EPS ? "hole" : "out";
      return { quad, cls, areaFull_sf, areaKept_sf: 0 };
    }

    if (areaKept_sf >= areaFull_sf - AREA_EPS) {
      return { quad, cls: "full", areaFull_sf, areaKept_sf };
    }

    // Partial: cut, refined to corner on ≥2 non-collinear room-edge contacts.
    const face = installedFace(quad.w, quad.h, jointFt);
    const bbox = localBBox(kept, quad);
    let w_in = 0, h_in = 0;
    if (bbox) {
      const halfW = face.w / 2, halfH = face.h / 2;
      w_in = ftToIn(Math.max(0, Math.min(bbox.maxX, halfW) - Math.max(bbox.minX, -halfW)));
      h_in = ftToIn(Math.max(0, Math.min(bbox.maxY, halfH) - Math.max(bbox.minY, -halfH)));
    }
    const largest = largestPolygonPart(kept);
    const keptRing = largest ? exteriorRingPts(largest) : null;
    const lShaped = keptRing ? simplifyCollinear(keptRing, LEN_EPS).length > 4 : false;
    const cls: CellClass = isCorner(quad, edges, LEN_EPS) ? "corner" : "cut";
    return { quad, cls, areaFull_sf, areaKept_sf, cut: { w_in, h_in, lShaped } };
  });
}
