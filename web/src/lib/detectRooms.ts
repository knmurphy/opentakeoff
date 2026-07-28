// Detect Rooms (vector) — batch room detection from the sheet's own text
// layer. The thinnest end-to-end path: read room-number text labels, seed the
// EXISTING One-Click flood at each, keep only the clean floods, and hand the
// confident regions to the caller to trace/commit — the same shape a single
// One-Click call already produces, just N of them from one pass.
//
// Both pure, DOM-free, pdfjs-free units so they run straight under node:
//   roomLabelSeeds  positioned text items → candidate seed points
//   detectRegions   seeds + mask → { seed, flood } for each CLEAN (ok) flood,
//                   through the SAME sealed flood the click path uses
//
// The caller owns pdf.js/the DOM (extracting positioned text, building the
// mask via oneclick.ts, tracing/committing results) — this module imports
// nothing from pdfjs and takes text already resolved to seed-space px, so it
// works identically whether the caller is the browser canvas or the MCP
// server's Node-side session (mcp/src/pdf.ts's positionedText already does
// the viewport-transform composition; this module has no need to redo it).

import { floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, SENS_BALANCED } from "./oneclick.ts";
import type { MaskObj, FloodResult } from "./oneclick.ts";

/** A room-number label pattern: 2–3 digits with an optional trailing letter
 *  (134, 139A, 170) — the same shape estimators read off a finish plan. */
export const ROOM_LABEL_RE = /^\d{2,3}[A-Z]?$/;

/** One positioned text item, already resolved to the caller's seed-space px
 *  (image px for the browser canvas; the same for the MCP server, which
 *  resolves it via pdfjs.Util.transform in positionedText). */
export interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
}

/** A room-number label found in the text layer, with its seed point. */
export interface RoomLabelSeed {
  str: string;
  seed: [number, number];
}

/** Scan positioned text items for room-number labels, returning each as a
 *  seed point. An item's string may be JUST the number ("134") or a
 *  name+number ("OFFICE 101", "CORRIDOR 104") — a single text run often
 *  carries both on a finish plan — so this tokenizes on whitespace and keeps
 *  the item if ANY token matches the room-number pattern. The seed is the
 *  item's own anchor point (its text-matrix origin, already resolved by the
 *  caller) — for a left-aligned room label that sits inside the room's
 *  floodable area; the flood's own few-px nudge absorbs landing near a wall. */
export function roomLabelSeeds(items: PositionedTextItem[]): RoomLabelSeed[] {
  const out: RoomLabelSeed[] = [];
  for (const it of items) {
    const num = (it.str || "").trim().split(/\s+/).find((tok) => ROOM_LABEL_RE.test(tok));
    if (!num) continue;
    out.push({ str: num, seed: [it.x, it.y] });
  }
  return out;
}

/** A detected region: the label seed and the CLEAN flood it produced. The
 *  flood is always status "ok" (the gate below withholds everything else),
 *  so `hatchFiltered` is meaningful and traceRegion can consume it directly. */
export interface DetectedRegion {
  str: string;
  seed: [number, number];
  flood: Extract<FloodResult, { status: "ok" }>;
}

/** Seed the SAME flood the click path uses at each label and apply the
 *  high-precision status gate: keep a region ONLY if the flood returns status
 *  "ok". leak / tiny / boundary are silently dropped — a batch detector must
 *  never propose a bad trace just because a label happened to be there.
 *
 *  The gate keys off flood STATUS, not `hatchFiltered`. A grow-but-verify
 *  hatch escalation still returns status "ok" with hatchFiltered: true — that
 *  is a real room (most rooms on a finish plan are hatched), so it's kept.
 *  hatchFiltered rides through as provenance, never a rejection reason.
 *
 *  PARITY: this calls `floodRegionSealed` with the scale-derived parameters,
 *  exactly like the canvas's click sites and the bench. It used to call the
 *  raw `floodRegion`, which meant a batch detection measured with the
 *  pre-sealing engine — no cased-opening seal, no door-swing wedges, and no
 *  minimum-passage rule — while a click on the same room measured with all
 *  three. On the VA finish plan that gap was mean IoU 0.817 vs 0.999 against
 *  the pinned goldens, and 16.6% of the sheet's proposed floor double-counted
 *  (two labels flooding one conjoined space through an unsealed doorway) vs
 *  0.0% (issue #184 round 9). The three helpers each degrade safely when the
 *  sheet scale is unknown (`mppf` absent): the default seal ladder, no door
 *  retry, no min-passage dilation. */
export function detectRegions(
  maskObj: MaskObj,
  seeds: RoomLabelSeed[],
  sensitivity: number = SENS_BALANCED,
): DetectedRegion[] {
  const mppf = maskObj.mppf ?? 0;
  const radii = sealRadiiFor(mppf), wedgeCapPx = doorWedgeCapPx(mppf), minPassPx = minPassRadiusFor(mppf);
  const out: DetectedRegion[] = [];
  for (const s of seeds) {
    const f = floodRegionSealed(maskObj, s.seed[0], s.seed[1], sensitivity, radii, wedgeCapPx, minPassPx);
    if (f.status !== "ok") continue;
    out.push({ str: s.str, seed: s.seed, flood: f });
  }
  return out;
}
