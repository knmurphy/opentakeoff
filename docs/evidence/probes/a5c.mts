// A5c / F7(g) — a closed ring on a room's boundary (a round column, a callout
// bubble) still hands its interior to the room as floor. That MEASUREMENT is
// unchanged and corpus-pinned; what changed is the CLAIM: the result now carries
// `ringWedges`, the canvas readout says "incl. ring interior" instead of
// asserting a door swing, and MCP reports `ring_interiors`.
//
// This probe measures the end-to-end flood (not the allowance a5.mts measures)
// on four scenes at 18 px/ft on a 1000x800 sheet:
//   1  round column, 3 ft dia, inside a plain room, NO DOOR ANYWHERE
//   2  callout bubble, 4 ft dia, same room, no door
//   3  a real 3'-0" door leaf + swing arc, no ring        (negative control)
//   4  a room with BOTH a door and a column               (mixed)
// and reports, per scene: annexed cells/SF vs the no-retry flood, `wedges`,
// `ringWedges`, whether the ring's own centre cell became floor, confidence, and
// the exact READOUT STRING each surface would emit — the canvas hover badge
// (transcribed from TakeoffCanvas.jsx's expression, asserted here to still match
// the source) and the MCP `ring_interiors` receipt key.
//
// Independent of doorArcs.test.ts's fixture: this is an axis-aligned room with
// the ring placed on the WEST wall rather than free-standing in the middle, so
// the flood meets the ring on its boundary.
//
// On BEFORE `ringWedges` does not exist, so the probe reports it absent and shows
// that the same scene was described as a door swing.
import { readFileSync } from "fs";
import {
  buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor,
  SENS_BALANCED, SEG_CURVE, traceRegion, ringArea,
} from "../src/lib/oneclick.ts";
import { traceConfidence } from "../src/lib/confidence.ts";

const W = 1000, H = 800, PXFT = 18;
const L = (s: number[], x0: number, y0: number, x1: number, y1: number) => s.push(x0, y0, x1, y1);
const circle = (cx: number, cy: number, r: number, n: number) => {
  const s: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    L(s, cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  return s;
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) => {
  const s: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, b = a0 + ((a1 - a0) * (i + 1)) / n;
    L(s, cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  return s;
};

// a plain room 150..600 x 150..500 (19.7% of the sheet, well inside the 30% leak
// cap), optionally with a 3 ft opening in the east wall
function room(opening: boolean): number[] {
  const s: number[] = [];
  L(s, 4, 4, W - 4, 4); L(s, W - 4, 4, W - 4, H - 4); L(s, W - 4, H - 4, 4, H - 4); L(s, 4, H - 4, 4, 4);
  L(s, 150, 150, 600, 150);
  if (opening) { L(s, 600, 150, 600, 280); L(s, 600, 280 + 3 * PXFT, 600, 500); }
  else L(s, 600, 150, 600, 500);
  L(s, 600, 500, 150, 500); L(s, 150, 500, 150, 150);
  return s;
}

interface Scene { name: string; segs: number[]; curveFrom: number; curveCount: number; centre: [number, number] | null; }
function scenes(): Scene[] {
  const out: Scene[] = [];
  {  // 1 — round column, 3 ft dia, ON the west wall, no door in the scene
    const base = room(false), col = circle(150, 325, 1.5 * PXFT, 32);
    out.push({ name: "round column 3 ft dia, no door", segs: [...base, ...col], curveFrom: base.length >> 2, curveCount: col.length >> 2, centre: [150, 325] });
  }
  {  // 2 — callout bubble, 4 ft dia, same place
    const base = room(false), b = circle(150, 325, 2 * PXFT, 32);
    out.push({ name: "callout bubble 4 ft dia, no door", segs: [...base, ...b], curveFrom: base.length >> 2, curveCount: b.length >> 2, centre: [150, 325] });
  }
  {  // 3 — a real 3'-0" door: leaf + swing arc, NO ring (negative control)
    const base = room(true), leaf: number[] = [];
    L(leaf, 600, 280, 600 + 3 * PXFT, 280);
    const a = arc(600, 280, 3 * PXFT, 0, Math.PI / 2, 8);
    out.push({ name: "real 3'-0\" door (NEGATIVE CONTROL)", segs: [...base, ...leaf, ...a], curveFrom: (base.length + leaf.length) >> 2, curveCount: a.length >> 2, centre: null });
  }
  {  // 4 — both a door and a column
    const base = room(true), leaf: number[] = [];
    L(leaf, 600, 280, 600 + 3 * PXFT, 280);
    const a = arc(600, 280, 3 * PXFT, 0, Math.PI / 2, 8), col = circle(150, 325, 1.5 * PXFT, 32);
    out.push({ name: "door AND column (mixed)", segs: [...base, ...leaf, ...a, ...col], curveFrom: (base.length + leaf.length) >> 2, curveCount: (a.length + col.length) >> 2, centre: [150, 325] });
  }
  {  // 5 — FREE-STANDING column in the middle of the room: this is the scene where
     //     the annexed area IS the ring's own interior (pi*r^2), i.e. the
     //     measurement the operator policy question is about.
    const base = room(false), col = circle(375, 325, 1.5 * PXFT, 32);
    out.push({ name: "free-standing round column 3 ft dia (interior-as-floor)", segs: [...base, ...col], curveFrom: base.length >> 2, curveCount: col.length >> 2, centre: [375, 325] });
  }
  return out;
}

// the canvas hover badge, transcribed from TakeoffCanvas.jsx; asserted below to
// still be a substring of the source, so this string cannot drift from the app
const badge = (wedges: number, ringWedges: number) =>
  wedges ? (ringWedges >= wedges ? " · incl. ring interior" : ringWedges ? " · incl. door swing + ring interior" : " · incl. door swing") : "";
const CANVAS_SRC = readFileSync("src/pages/TakeoffCanvas.jsx", "utf8");

const out: any = {
  probe: "A5c",
  canvasSaysRingInterior: CANVAS_SRC.includes('" · incl. ring interior"'),
  canvasSaysDoorSwingPlusRing: CANVAS_SRC.includes('" · incl. door swing + ring interior"'),
  mcpReportsRingInteriors: (() => { try { return readFileSync("../mcp/src/session.ts", "utf8").includes("ring_interiors"); } catch { return "unreadable"; } })(),
  canvasReportsRingInteriors: CANVAS_SRC.includes("ring_interiors"),
  scenes: [],
};

for (const sc of scenes()) {
  const meta = new Uint8Array(sc.segs.length >> 2);
  for (let i = sc.curveFrom; i < sc.curveFrom + sc.curveCount; i++) meta[i] = SEG_CURVE;
  const mo: any = buildMask(sc.segs, W, H, 3000, meta, PXFT, PXFT);
  const mppf = mo.mppf ?? 0;
  // scene 5 puts the column at the room's centre, so seed off to the side
  const seed: [number, number] = sc.centre && sc.centre[0] === 375 ? [250, 200] : [375, 325];
  const bare: any = floodRegionSealed(mo, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), 0);
  const f: any = floodRegionSealed(mo, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  const row: any = { scene: sc.name, bareStatus: bare.status, status: f.status };
  if (bare.status === "ok" && f.status === "ok") {
    const ringSF = ringArea(traceRegion(f)) / (PXFT * PXFT);
    const wedges = f.wedges ?? 0, ringWedges = f.ringWedges ?? 0;
    row.bareCells = bare.count; row.bareSF = +(bare.count / (mppf * mppf)).toFixed(2);
    row.cells = f.count; row.cellSF = +(f.count / (mppf * mppf)).toFixed(2); row.ringSF = +ringSF.toFixed(2);
    row.annexedCells = f.count - bare.count; row.annexedSF = +((f.count - bare.count) / (mppf * mppf)).toFixed(2);
    row.wedges = f.wedges ?? null;
    row.ringWedges = "ringWedges" in f ? f.ringWedges : "field absent on this state";
    row.wedgeGrowth = f.wedgeGrowth != null ? +f.wedgeGrowth.toFixed(4) : null;
    if (sc.centre) {
      const idx = Math.round(sc.centre[1] * mo.ws) * mo.mw + Math.round(sc.centre[0] * mo.ws);
      row.ringCentreIsFloor_noRetry = bare.region[idx] === 1;
      row.ringCentreIsFloor_withRetry = f.region[idx] === 1;
      row.ringOwnInteriorSF = +((Math.PI * Math.pow(sc.name.includes("4 ft") ? 2 * PXFT : 1.5 * PXFT, 2)) / (PXFT * PXFT)).toFixed(2);
    }
    const c = traceConfidence({
      hatchFiltered: f.hatchFiltered, hatchTier: f.hatchTier, sealedPx: f.sealedPx, virtualFrac: f.virtualFrac,
      wedges: f.wedges, wedgeGrowth: f.wedgeGrowth, curveFrac: f.curveFrac,
      minPassPx: f.minPassPx, minPassDelta: f.minPassDelta, areaSF: ringSF, mppf: f.mppf ?? mppf,
    } as any);
    row.conf = c.score; row.factors = c.factors;
    // F7(g), the part the fix did not reach: `floodSignals` never forwards
    // `ringWedges` into ConfidenceInput and confidence.ts has no notion of it,
    // so the FACTOR STRING still asserts a door swing on a scene with no door.
    // Those factors are persisted as `origin.confidence_factors` on the canvas
    // (TakeoffCanvas.jsx:3122) and returned by MCP `one_click` (session.ts:316),
    // beside the corrected `ring_interiors` — two receipts on one shape that
    // disagree.
    row.factorAssertsDoorSwing = c.factors.some((x) => x.startsWith("door-swing-crossed"));
    row.factorContradictsRingInteriors = row.factorAssertsDoorSwing && ringWedges >= wedges && wedges > 0;
    row.hoverBadge = badge(wedges, ringWedges);
    row.mcpProvenance = { ...(wedges ? { door_wedges: wedges } : {}), ...(ringWedges ? { ring_interiors: ringWedges } : {}) };
  }
  out.scenes.push(row);
}
console.log(JSON.stringify(out, null, 1));
