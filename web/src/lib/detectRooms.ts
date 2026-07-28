// Detect Rooms (vector) — batch room detection from the sheet's own text
// layer. The thinnest end-to-end path: read room-number text labels, seed the
// EXISTING One-Click flood at each, keep only the clean floods, and hand the
// confident regions to the caller to trace/commit — the same shape a single
// One-Click call already produces, just N of them from one pass.
//
// Pure, DOM-free, pdfjs-free units so they run straight under node:
//   roomLabelSeeds  positioned text items → candidate seed points
//   oneClickArgs    mask px per foot → the canvas's scale-derived flood args
//   floodAtSeed     mask + seed → the One-Click engine, canvas-identical
//   detectRegions   seeds + mask → { seed, flood } for each CLEAN (ok) flood
//
// A6 (audit): floodAtSeed/oneClickArgs exist because the argument derivation a
// One-Click needs — seal radii, door-wedge cap, minimum-passage radius, all
// functions of the sheet scale — was written out at each call site, and the
// non-canvas ones (this module, mcp/src/session.ts) simply didn't write it:
// they called the raw floodRegion on a scale-less mask. Two surfaces, one
// origin.method ("one_click_v1"), different square footage. Now every non-
// canvas caller goes through floodAtSeed, and web/test/engineParity.test.ts
// pins it against the canvas's own inline call.
//
// The caller owns pdf.js/the DOM (extracting positioned text, building the
// mask via oneclick.ts, tracing/committing results) — this module imports
// nothing from pdfjs and takes text already resolved to seed-space px, so it
// works identically whether the caller is the browser canvas or the MCP
// server's Node-side session (mcp/src/pdf.ts's positionedText already does
// the viewport-transform composition; this module has no need to redo it).

import {
  floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, SENS_BALANCED,
} from "./oneclick.ts";
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

/** The scale-derived flood arguments a One-Click uses, for a sheet where one
 *  foot spans `maskPxPerFt` mask px. Byte-for-byte what TakeoffCanvas.jsx
 *  computes at a click:
 *      const mppf = mo.ws / upp;
 *      floodRegionSealed(mo, x, y, fillSens, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf))
 *
 *  At maskPxPerFt ≤ 0 (no scale on the sheet) each helper returns its own
 *  documented scale-blind fallback — the hairline SEAL_RADII floor, no door
 *  wedge retry, minimum-passage rule off. That is a WEAKER measurement, not an
 *  equivalent one, so `scaleBlind` is returned alongside for callers to surface
 *  rather than guess a scale nobody supplied. */
export function oneClickArgs(maskPxPerFt: number): {
  mppf: number; scaleBlind: boolean; radii: number[]; wedgeCapPx: number; minPassPx: number;
} {
  const mppf = Number.isFinite(maskPxPerFt) && maskPxPerFt > 0 ? maskPxPerFt : 0;
  return {
    mppf,
    scaleBlind: mppf <= 0,
    radii: sealRadiiFor(mppf),
    wedgeCapPx: doorWedgeCapPx(mppf),
    minPassPx: minPassRadiusFor(mppf),
  };
}

/** The One-Click engine at one seed — the single entry point every non-canvas
 *  surface (batch detection, the MCP server) measures through, so none of them
 *  can drift from the canvas again. `maskPxPerFt` defaults to the mask's own
 *  `mppf`, which buildMask derives from the sheet scale and which is exactly
 *  the canvas's `mo.ws / upp`; raster masks carry none (buildRasterMask doesn't
 *  set it) and pass it explicitly, as the canvas does. */
export function floodAtSeed(
  maskObj: MaskObj,
  ix: number,
  iy: number,
  sensitivity: number = SENS_BALANCED,
  maskPxPerFt: number = maskObj.mppf || 0,
): FloodResult {
  const a = oneClickArgs(maskPxPerFt);
  return floodRegionSealed(maskObj, ix, iy, sensitivity, a.radii, a.wedgeCapPx, a.minPassPx);
}

/** A detected region: the label seed and the CLEAN flood it produced. The
 *  flood is always status "ok" (the gate below withholds everything else),
 *  so `hatchFiltered` is meaningful and traceRegion can consume it directly. */
export interface DetectedRegion {
  str: string;
  seed: [number, number];
  flood: Extract<FloodResult, { status: "ok" }>;
}

/** Seed the EXISTING flood at each label and apply the high-precision status
 *  gate: keep a region ONLY if the flood returns status "ok". leak / tiny /
 *  boundary are silently dropped — a batch detector must never propose a bad
 *  trace just because a label happened to be there.
 *
 *  The gate keys off flood STATUS, not `hatchFiltered`. A grow-but-verify
 *  hatch escalation still returns status "ok" with hatchFiltered: true — that
 *  is a real room (most rooms on a finish plan are hatched), so it's kept.
 *  hatchFiltered rides through as provenance, never a rejection reason.
 *
 *  A6 (audit): the flood is `floodAtSeed` — floodRegionSealed with the SAME
 *  scale-derived arguments the canvas passes at a One-Click (gap sealing,
 *  door-swing inclusion, the feet-true minimum-passage rule). It used to be the
 *  raw `floodRegion`, so a batch detection and a canvas click on the same seed
 *  measured DIFFERENT square footage while both stamped origin.method
 *  "one_click_v1"; provenance could not tell them apart. Swapping the engine
 *  changed which flood runs and nothing else — the gate above is untouched. */
export function detectRegions(
  maskObj: MaskObj,
  seeds: RoomLabelSeed[],
  sensitivity: number = SENS_BALANCED,
  maskPxPerFt: number = maskObj.mppf || 0,
): DetectedRegion[] {
  const out: DetectedRegion[] = [];
  for (const s of seeds) {
    const f = floodAtSeed(maskObj, s.seed[0], s.seed[1], sensitivity, maskPxPerFt);
    if (f.status !== "ok") continue;
    out.push({ str: s.str, seed: s.seed, flood: f });
  }
  return out;
}
