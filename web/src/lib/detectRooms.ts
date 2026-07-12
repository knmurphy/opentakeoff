// Detect Rooms (vector) — the pure core of issue #123.
//
// The thinnest end-to-end batch path: read room-number text labels off the
// sheet's text layer, seed the EXISTING One-Click flood at each, keep only the
// clean floods, and hand the confident regions to the caller to drop into the
// One-Click proposal model as reviewable ghosts.
//
// Two pure, DOM-free, pdfjs-free units so they run straight under node:
//   roomLabelSeeds  text items + viewport transform → candidate seed points
//   detectRegions   seeds + mask → { seed, flood } for each CLEAN (ok) flood
//
// The caller (TakeoffCanvas) owns pdf.js (getTextContent), the mask (ensureMask),
// the trace→snap→area propose path (proposeRegion), and the Create gate. This
// module deliberately imports nothing from pdfjs — the viewport transform is a
// 2×3 matrix passed in and multiplied inline, mirroring oneclick.ts's OPS-as-a-
// param discipline so the whole core stays node-testable.

import { floodRegion, SENS_BALANCED } from "./oneclick";
import type { MaskObj, FloodResult } from "./oneclick";

/** A room-number label pattern: 2–3 digits with an optional trailing letter
 *  (134, 139A, 170). Same shape estimators read off a finish plan. */
export const ROOM_LABEL_RE = /^\d{2,3}[A-Z]?$/;

/** The subset of a pdf.js text item we use: the string and its own text-matrix
 *  (a 6-element [a,b,c,d,e,f]). */
export interface TextItemLike {
  str?: string;
  transform: number[];
}
export interface TextContentLike {
  items: TextItemLike[];
}

/** A room-number label found in the text layer, with its seed point already in
 *  panel-LOCAL image px (the same frame floodRegion/oneClickAt use). */
export interface RoomLabelSeed {
  str: string;
  /** seed point [x, y] in panel-local image px */
  seed: [number, number];
}

// pdf.js's Util.transform(m1, m2) — compose two 2×3 affine matrices. Inlined so
// this module never imports pdfjs (keeps the unit node-testable). The text
// item's own transform maps the glyph's local space onto PDF space; composing
// with the viewport transform lands it in device (image) px — exactly what
// extractRegionText / detectScale do via pdfjsLib.Util.transform.
function composeTransform(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Scan the page text layer for room-number labels, returning each as a seed
 *  point in panel-local image px. `viewportTransform` is `viewport.transform`
 *  (PDF space → device px), the SAME transform detectScale/extractRegionText
 *  pass to pdfjsLib.Util.transform.
 *
 *  A label item's string may be JUST the number ("134") or a name+number
 *  ("OFFICE 101", "CORRIDOR 104") — pdf.js combines a single show-text op into
 *  one item, and the "number+name" convention is common on finish plans (see
 *  issue #81). So we tokenize on whitespace and keep the item if ANY token
 *  matches the room-number pattern.
 *
 *  The seed is the label's text-matrix ORIGIN ([e, f], the item's baseline
 *  bottom-left) — design point 2's "text-item position", faithful and cheap. For
 *  a left-aligned room label the origin sits inside the room's floodable area;
 *  the flood's own 3px nudge absorbs a landing on a nearby line. (Per-glyph
 *  offset to the number itself is a later refinement, not needed here.) */
export function roomLabelSeeds(
  textContent: TextContentLike,
  viewportTransform: number[],
): RoomLabelSeed[] {
  const out: RoomLabelSeed[] = [];
  for (const it of textContent.items || []) {
    if (!it.transform) continue;
    const num = (it.str || "").trim().split(/\s+/).find((tok) => ROOM_LABEL_RE.test(tok));
    if (!num) continue;
    const t = composeTransform(viewportTransform, it.transform);
    out.push({ str: num, seed: [t[4], t[5]] });
  }
  return out;
}

/** A detected region: the label seed and the CLEAN flood it produced. The flood
 *  is always `status: "ok"` (the status gate below withholds everything else),
 *  so `hatchFiltered` is meaningful and traceRegion can consume it directly. */
export interface DetectedRegion {
  str: string;
  seed: [number, number];
  flood: Extract<FloodResult, { status: "ok" }>;
}

/** Seed the EXISTING flood at each label and apply the high-precision status
 *  gate: keep a region ONLY if floodRegion returns status "ok". leak / tiny /
 *  boundary are silently dropped.
 *
 *  CRITICAL: the gate keys off flood STATUS, not `hatchFiltered`. A grow-but-
 *  verify hatch escalation returns status "ok" WITH `hatchFiltered: true` — that
 *  is a REAL room (the majority of a finish plan), so it is kept. `hatchFiltered`
 *  is provenance carried through to Create, never a rejection reason. */
export function detectRegions(
  maskObj: MaskObj,
  seeds: RoomLabelSeed[],
  sensitivity: number = SENS_BALANCED,
): DetectedRegion[] {
  const out: DetectedRegion[] = [];
  for (const s of seeds) {
    const f = floodRegion(maskObj, s.seed[0], s.seed[1], sensitivity);
    if (f.status !== "ok") continue;   // status gate: withhold leak/tiny/boundary
    out.push({ str: s.str, seed: s.seed, flood: f });
  }
  return out;
}

// ── ring-merge dedup ────────────────────────────────────────────────────────
// The status gate keeps every CLEAN flood, but two seeds in one room (a room with
// two labels), a fragment poly mostly inside a full room, and a concave room
// seeded twice all emit DUPLICATE/overlapping floods. The cheap per-seed
// pointInPoly skip in TakeoffCanvas misses these (near-identical rings from two
// seeds, and fragment floods). dedupeRegions is the real geometric dedup: cluster
// regions that overlap substantially and keep ONE representative per cluster.
//
// INTERSECTION METHOD — mask popcount, NOT polygon clipping. Every region in one
// detectRooms call floods the SAME MaskObj, so every flood.region shares identical
// mw/mh/ws. The intersection area of two regions is then exactly the number of
// mask cells set in BOTH — popcount(region_i AND region_j). This is:
//   • exact at mask resolution (no clipper rounding),
//   • concave-native (a U-shaped room's two overlapping floods intersect correctly
//     where Sutherland–Hodgman would be wrong, its clip poly being non-convex),
//   • degenerate-safe (two abutting rooms sharing a WALL share zero interior cells,
//     so their intersection is 0 — no shared-edge clipper pathology),
//   • order-independent (AND is commutative; clustering is by geometry).
// Failure mode of the approximation: sub-cell detail below one mask cell (~1/ws px)
// is invisible. That is far finer than a room boundary, so it never affects the
// dup-vs-distinct decision (see OVERLAP_THRESH). Regions from DIFFERENT masks must
// never be compared this way — the guard below fails loud if a batch ever mixes
// mask geometries.

/** Two regions are the SAME room when their containment ratio
 *  `intersection / min(areaA, areaB)` reaches this. Chosen at 0.5: a real dup
 *  (a fragment mostly inside a full room, or two near-identical rings) normalizes
 *  toward ~1.0 because min() is the smaller/contained region; two abutting DISTINCT
 *  rooms share only a wall, so their interior masks intersect at ~0. The gap
 *  between those is enormous, so the exact threshold is not sensitive — 0.5 sits
 *  squarely in the empty middle and is robust to trace/flood jitter. */
export const OVERLAP_THRESH = 0.5;

/** Exact intersection area (mask cells set in BOTH) of two same-mask regions.
 *
 *  Fails loud on mismatched lengths rather than silently truncating: same-mask
 *  regions always share `region.length === mw*mh`, so a length mismatch means two
 *  DIFFERENT mask geometries slipped into one batch (e.g. a future raster+vector
 *  mixed pass). `Math.min` would quietly compare only the shared prefix and return
 *  a garbage overlap; throwing here makes that a hard, obvious failure. On valid
 *  equal-length input this is byte-identical to the old popcount (`n === a.length`). */
function intersectionCount(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`intersectionCount: region length mismatch (${a.length} vs ${b.length})`);
  }
  const n = a.length;
  let c = 0;
  for (let i = 0; i < n; i++) if (a[i] && b[i]) c++;
  return c;
}

/** Containment overlap of two regions: intersection / min(area). A fragment mostly
 *  inside a full room → ~1; two near-identical rings → ~1; abutting rooms → ~0. */
function containmentOverlap(a: DetectedRegion, b: DetectedRegion): number {
  const inter = intersectionCount(a.flood.region, b.flood.region);
  const denom = Math.min(a.flood.count, b.flood.count);
  return denom > 0 ? inter / denom : 0;
}

/** Collapse duplicate/fragment floods to one region per overlap cluster.
 *
 *  Two regions are clustered when `containmentOverlap >= OVERLAP_THRESH`. Clusters
 *  are transitive (union-find), so a chain A–B, B–C groups A,B,C even if A,C don't
 *  directly overlap enough. The KEPT representative of a cluster is the LARGER-area
 *  region (a fragment flood is smaller than the full-room flood it sits inside);
 *  ties break deterministically on `str` then `seed` so the result is IDENTICAL
 *  regardless of input order.
 *
 *  Order-independence holds because: intersection (AND) is commutative, so the
 *  overlap graph is order-free; union-find over that graph yields the same
 *  partition for any input order; and the representative is chosen by a total
 *  order on (count, str, seed), not by first-seen. The output preserves the input
 *  order of the surviving representatives (stable filter). */
export function dedupeRegions(regions: DetectedRegion[]): DetectedRegion[] {
  const n = regions.length;
  if (n <= 1) return regions.slice();
  // Guard: mask-popcount intersection is only valid across regions that share the
  // SAME mask geometry. A single detectRooms call always does; fail loud otherwise.
  const { mw, mh } = regions[0].flood;
  for (let i = 1; i < n; i++) {
    if (regions[i].flood.mw !== mw || regions[i].flood.mh !== mh) {
      throw new Error("dedupeRegions: regions must share one mask geometry (same mw/mh)");
    }
  }
  // union-find over the overlap graph
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (containmentOverlap(regions[i], regions[j]) >= OVERLAP_THRESH) union(i, j);
    }
  }
  // pick the best representative per cluster by a TOTAL order (order-independent):
  // larger area first, then lexicographic str, then seed x, then seed y.
  const better = (i: number, j: number): boolean => {
    const a = regions[i], b = regions[j];
    if (a.flood.count !== b.flood.count) return a.flood.count > b.flood.count;
    if (a.str !== b.str) return a.str < b.str;
    if (a.seed[0] !== b.seed[0]) return a.seed[0] < b.seed[0];
    return a.seed[1] < b.seed[1];
  };
  const rep = new Map<number, number>();  // cluster root → chosen member index
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const cur = rep.get(r);
    if (cur === undefined || better(i, cur)) rep.set(r, i);
  }
  const keep = new Set(rep.values());
  return regions.filter((_, i) => keep.has(i));   // stable: preserves input order of survivors
}
