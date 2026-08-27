// Room membership for selection isolation (spec addendum 2026-08-26e, r5 rev 2).
// isolate3D(selectedId, shapes) — signature unchanged, sole call site
// (TakeoffCanvas ~1187) untouched. All membership math runs in NORMALIZED
// verts space (scale-free, no upp).
import { pointInPoly } from "./geometry.js";
import { insetRing, centroid2 } from "./scene3d.js";

const RUN_SAMPLE_FRACTION = 0.6; // ≥60% of samples decides join/drop for runs
const INTERIOR_SAMPLES_PER_SEGMENT = 8;

// v0 (pre-r5) isolation, kept verbatim as the honest-scope fallback: a
// selected shape's room = itself, shapes whose origin.derived reaches it,
// and label-equal siblings. Everything else — including every unlinked,
// unlabeled shape — stays visible (it can't be attributed).
function legacyIsolate(selectedId, shapes, sel) {
  const vis = new Set([selectedId]);
  for (const s of shapes) {
    const d = s.origin?.derived;
    const linked = d && (d.from_shape_id === selectedId || (Array.isArray(d.between_shape_ids) && d.between_shape_ids.includes(selectedId)));
    if (linked) vis.add(s.id);
    else if (s.label && sel.label && s.label === sel.label) vis.add(s.id);
    else if (!s.origin?.derived && !s.label) vis.add(s.id); // unlinked: stays
  }
  return vis;
}

// The selected shape's room(s) — a SET (a transition reaches two floors).
// floor_area selected → itself; otherwise every floor_area one hop away via
// origin.derived (from_shape_id + every id in between_shape_ids). No room
// resolves → caller falls back to legacyIsolate wholesale.
function resolveRoomFloors(sel, shapes) {
  const rooms = new Set();
  if (sel.measure_role === "floor_area") {
    rooms.add(sel.id);
    return rooms;
  }
  const d = sel.origin?.derived;
  if (!d) return rooms;
  const candidateIds = [];
  if (d.from_shape_id) candidateIds.push(d.from_shape_id);
  if (Array.isArray(d.between_shape_ids)) candidateIds.push(...d.between_shape_ids);
  for (const id of candidateIds) {
    const f = shapes.find((s) => s.id === id && s.measure_role === "floor_area");
    if (f) rooms.add(f.id);
  }
  return rooms;
}

// Derived links + label equality, walked FROM the resolved room floors (not
// the selected shape) — selecting a base ring or transition isolates the
// full room family. Graph admission takes PRECEDENCE over membership: it is
// consulted first, and membership only governs the shapes it doesn't admit.
function graphAdmits(shape, roomIds, roomLabels) {
  const d = shape.origin?.derived;
  if (d) {
    if (d.from_shape_id && roomIds.has(d.from_shape_id)) return true;
    if (Array.isArray(d.between_shape_ids) && d.between_shape_ids.some((id) => roomIds.has(id))) return true;
  }
  return !!(shape.label && roomLabels.has(shape.label));
}

// Outward ring push so containment reaches PAST the wall line (runs traced
// on wall linework are the dominant case). eps = 1% of the ring's own bbox
// min dimension. <3-vertex or degenerate (zero-extent) ring → no ring,
// degrade rather than throw.
function outsetRingFor(shape) {
  const ring = shape.verts_norm;
  if (!ring || ring.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const minDim = Math.min(maxX - minX, maxY - minY);
  if (!(minDim > 0)) return null;
  return insetRing(ring, -0.01 * minDim);
}

// A floor contains (x, y) when it's in its OUTSET outer ring and in none of
// its holes, tested RAW (not outset) — geometry.js's own hole pattern.
function floorContains(floor, outset, x, y) {
  if (!outset || !pointInPoly(x, y, outset)) return false;
  const holes = floor.verts_norm_holes || [];
  return !holes.some((h) => h.length >= 3 && pointInPoly(x, y, h));
}

// Every OTHER floor_area's outset ring (a room's own ring is excluded via
// excludeId — needed so an unlabeled floor never self-matches as "other").
function containingFloors(x, y, floors, outsets, excludeId) {
  const hits = [];
  for (const f of floors) {
    if (f.id === excludeId) continue;
    if (floorContains(f, outsets.get(f.id), x, y)) hits.push(f.id);
  }
  return hits;
}

// Single representative point: exactly one resolved room contains it → join;
// exactly one OTHER room (and no resolved room) → drop; else (no room, or
// 2+ rooms — the shared-wall overlap) → stay. Never silently shrink.
function classifyPoint(x, y, floors, outsets, roomIds, excludeId) {
  const hits = containingFloors(x, y, floors, outsets, excludeId);
  if (hits.length !== 1) return "stay";
  return roomIds.has(hits[0]) ? "join" : "drop";
}

// Fractional sample vote (runs, and the concave-fallback vertex
// supermajority): ≥60% of samples inside the resolved rooms' outsets →
// join; else ≥60% inside other rooms' outsets → drop; else stay. Zero
// samples → stay.
function classifyBySamples(samples, floors, outsets, roomIds, excludeId) {
  if (samples.length === 0) return "stay";
  let inResolved = 0, inOther = 0;
  for (const [x, y] of samples) {
    const hits = containingFloors(x, y, floors, outsets, excludeId);
    if (hits.some((id) => roomIds.has(id))) inResolved++;
    if (hits.some((id) => !roomIds.has(id))) inOther++;
  }
  const n = samples.length;
  if (inResolved / n >= RUN_SAMPLE_FRACTION) return "join";
  if (inOther / n >= RUN_SAMPLE_FRACTION) return "drop";
  return "stay";
}

// Closed rings (deducts, and unlinked unlabeled floor_area): representative
// = centroid2; a concave ring's centroid can fall outside its OWN raw ring
// (a chevron) — fall back to the run-style vertex supermajority over the
// ring's own vertices (no interior sampling).
function classifyClosedRing(shape, floors, outsets, roomIds) {
  const ring = shape.verts_norm || [];
  if (ring.length === 0) return "stay";
  const [cx, cy] = centroid2(ring);
  if (pointInPoly(cx, cy, ring)) return classifyPoint(cx, cy, floors, outsets, roomIds, shape.id);
  return classifyBySamples(ring, floors, outsets, roomIds, shape.id);
}

// Runs (undecorated linear + surface_area): every vertex plus ≈8 evenly
// spaced interior points per segment — a 2-vertex run's endpoints sit ON
// walls, so interior samples alone would miss the headline case.
function runSamples(path) {
  const samples = [...path];
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    for (let k = 1; k <= INTERIOR_SAMPLES_PER_SEGMENT; k++) {
      const t = k / (INTERIOR_SAMPLES_PER_SEGMENT + 1);
      samples.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  return samples;
}

// Per-shape membership triage for everything the graph walk did not admit.
// Defaults (labeled-other-room floors, derived-elsewhere runs, and any
// other unrecognized shape) keep today's DROP.
function classifyShape(shape, floors, outsets, roomIds) {
  switch (shape.measure_role) {
    case "count": {
      const p = shape.verts_norm?.[0];
      return p ? classifyPoint(p[0], p[1], floors, outsets, roomIds, shape.id) : "stay";
    }
    case "deduct":
      return classifyClosedRing(shape, floors, outsets, roomIds);
    case "floor_area":
      // Graph admission already caught label/derived matches to a resolved
      // room; reaching here with a label or a derived link means it belongs
      // to a different room — default drop. Only unlinked, unlabeled floors
      // get point-in-polygon triage.
      return shape.label || shape.origin?.derived ? "drop" : classifyClosedRing(shape, floors, outsets, roomIds);
    case "linear":
    case "surface_area":
      // Same reasoning: a derived (decorated) run that graph admission
      // didn't accept is linked to a different room — default drop.
      return shape.origin?.derived ? "drop" : classifyBySamples(runSamples(shape.verts_norm || []), floors, outsets, roomIds, shape.id);
    default:
      return "drop";
  }
}

export function isolate3D(selectedId, shapes) {
  if (!selectedId) return null;
  const sel = shapes.find((s) => s.id === selectedId);
  if (!sel) return null;

  const roomIds = resolveRoomFloors(sel, shapes);
  if (roomIds.size === 0) return legacyIsolate(selectedId, shapes, sel);

  const roomLabels = new Set();
  for (const id of roomIds) {
    const f = shapes.find((s) => s.id === id);
    if (f?.label) roomLabels.add(f.label);
  }

  const vis = new Set([selectedId, ...roomIds]);
  const undecided = [];
  for (const s of shapes) {
    if (vis.has(s.id)) continue;
    if (graphAdmits(s, roomIds, roomLabels)) vis.add(s.id);
    else undecided.push(s);
  }

  const floors = shapes.filter((s) => s.measure_role === "floor_area");
  const outsets = new Map(floors.map((f) => [f.id, outsetRingFor(f)]));

  for (const s of undecided) {
    if (classifyShape(s, floors, outsets, roomIds) !== "drop") vis.add(s.id);
  }
  return vis;
}
