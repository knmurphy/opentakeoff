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
