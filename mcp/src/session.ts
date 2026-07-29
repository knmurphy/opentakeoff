// One-document session state: the loaded plan, per-sheet scale + lazy geometry
// caches, and the in-memory takeoff (conditions + shapes). All coordinates are
// image px at RENDER_SCALE = 2.0 (PDF pt × 2, origin top-left, y down) — the
// browser canvas's native space. Shapes and conditions are field-identical to
// what the canvas commits (web/src/pages/TakeoffCanvas.jsx), so an exported
// takeoff round-trips into the app.
import path from "node:path";
import { openPdf, positionedText, OPS, type DocHandle, type PageHandle } from "./pdf.ts";
import { UserError, round1, round2 } from "./format.ts";
import { STANDARD_SCALES, RENDER_SCALE, detectScale, extractSheetNumber, type DetectedScale } from "../../web/src/lib/sheets.ts";
import {
  extractVectorGeometry, buildMask, oneClickRing, ringArea,
  MASK_MAX_DIM, SENS_BALANCED, type MaskObj, type VectorGeometry, type Point, type FloodResult,
} from "../../web/src/lib/oneclick.ts";
import { traceConfidence, floodSignals } from "../../web/src/lib/confidence.ts";
import { roomLabelSeeds, detectRegions, floodAtSeed, oneClickArgs } from "../../web/src/lib/detectRooms.ts";
import { buildSnapGrid, nearestSnap, closedMetrics, openLen } from "../../web/src/lib/geometry.js";
import { conditionTotals, grandTotals } from "../../web/src/lib/totals.js";

// Copied from the canvas (web/src/pages/TakeoffCanvas.jsx) so conditions and
// snap behavior minted here are identical to the browser's. PALETTE/HATCH_IDS
// are user data — never re-theme them.
const SNAP_CELL = 24; // snap-grid bucket, raster px
// The one-click vertex-snap TOLERANCE used to live here as a local `SNAP_TOL = 7`,
// duplicating the canvas's literal 7. It is now oneclick.SNAP_TOL_PX, applied
// inside the shared `oneClickRing` — one number, one place (audit F7(b)).
const PALETTE = ["#c96442", "#2f7d54", "#2563eb", "#9333ea", "#b8860b", "#0d9488", "#be185d", "#1f2937", "#dc2626", "#0891b2"];
const HATCH_IDS = ["solid", "diag", "diag2", "cross", "diagdense", "horiz", "vert", "grid", "brick", "plank", "herring", "basket", "checker", "wave", "fleur", "speckle"];
// uid mirrors web/src/lib/provenance.js mintUuid: crypto.randomUUID is a
// global in Node 20+, with the same non-secure-context fallback the browser
// build carries so the two sides mint identically-shaped ids.
const mintUuid = (): string =>
  (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const uid = (p: string): string => `${p}-${mintUuid()}`;

export const ANN_SCHEMA = "opentakeoff.takeoff_canvas.v1"; // web/src/lib/store.js

export type MeasureRole = "floor_area" | "deduct" | "linear";

export interface Condition {
  id: string;
  finish_tag: string;
  color: string;
  fill: string;
  hatch: string;
  multiplier: number;
  waste_pct: number;
  materials: unknown[];
}

/** Shape provenance (contribution.v2 vocabulary — mirrors the canvas +
 * web/src/lib/provenance.js). Truthfulness rules: `actor` is omitted for a
 * human at the canvas and "agent" for MCP/automation; `reviewed` is true ONLY
 * after a human affirmed the shape at an explicit review gate — this server
 * has no such gate, so everything it commits is reviewed: false. */
export interface ShapeOrigin {
  method: "manual" | "one_click_v1" | "agent_v1";
  /** Omitted = human. "agent" = the shape was produced by MCP/automation. */
  actor?: "agent";
  /** A human affirmed this shape at an explicit review gate. */
  reviewed?: boolean;
  /** one_click: the flood-fill seed, normalized to sheet dims. */
  seed_norm?: [number, number];
  hatch_filtered?: true;
  raster_traced?: true;
  fill_sensitivity?: number;
  /** traceConfidence's 0–1 score and the factors behind it (web/src/lib/
   *  confidence.ts) — the same receipt the canvas stamps at Create. */
  confidence?: number;
  confidence_factors?: string[];
  /** Gap-sealing / door-swing receipts, mirroring the canvas's origin. */
  gap_sealed_px?: number;
  door_wedges?: number;
  /** Wedges that annexed a closed drawn RING's interior (round column, callout
   *  bubble) rather than a door swing — a subset of `door_wedges` (audit F7(g)). */
  ring_interiors?: number;
  /** Minimum-passage receipts (audit F7(d)): the radius that ran and the fraction
   *  of the verbatim flood it removed. 1 = the drawn linework bounded nothing and
   *  the rule is the entire measurement. Both absent when the rule changed nothing. */
  min_pass_px?: number;
  min_pass_delta?: number;
  /** The sheet had no scale when this was measured, so the engine ran with
   *  its scale-blind fallbacks (see Session.engineArgs). */
  scale_blind?: true;
  /** Machine's original trace, frozen on first human edit (provenance.js). */
  proposed_verts_norm?: [number, number][];
  edited?: boolean;
  edited_before_create?: boolean;
  copied?: boolean;
  /** Per-kind tally of human corrections (provenance.js). */
  edits?: Record<string, number>;
}

export interface Shape {
  id: string;
  sheet_id: string;
  condition_id: string;
  measure_role: MeasureRole;
  verts_norm: [number, number][];
  computed: { area_sf: number; perimeter_lf: number };
  origin?: ShapeOrigin;
}

interface SheetState {
  key: string;
  pageNum: number;
  widthPt: number;
  heightPt: number;
  widthPx: number;
  heightPx: number;
  sheetNumber: string | null;
  detected: DetectedScale | null;
  /** real feet per image px at RENDER_SCALE; null until set_scale */
  upp: number | null;
  text: { str: string; x: number; y: number }[];
  page: PageHandle;
  // lazy per-sheet caches (built once, reused by identity)
  geo?: VectorGeometry;
  snap?: ReturnType<typeof buildSnapGrid>;
  /** undefined = not built yet; null = sheet has zero vector segments (a scan) */
  mask?: MaskObj | null;
  /** the `upp` the cached mask was built at. The mask carries the sheet scale
   *  (mppf), so set_scale after a mask was built INVALIDATES it — otherwise the
   *  first tool call on a sheet would pin a scale-blind raster for the session
   *  and every later measurement would silently use px fallbacks. */
  maskUpp?: number | null;
  /** rendered-page PNG at IMAGE_MAX_EDGE, built on first resource read */
  png?: Uint8Array;
}

/** Resource images cap their long edge here: the largest edge the mainstream
 * vision models take without downscaling — these renders exist to be looked at
 * by agents, so this is the native resolution of that audience. */
export const IMAGE_MAX_EDGE = 1568;

export interface SheetSummary {
  sheet: string;
  page: number;
  width_pt: number;
  height_pt: number;
  width_px: number;
  height_px: number;
  sheet_number?: string;
  detected_scale?: string;
}

const sheetSummary = (s: SheetState): SheetSummary => ({
  sheet: s.key,
  page: s.pageNum,
  width_pt: s.widthPt,
  height_pt: s.heightPt,
  width_px: s.widthPx,
  height_px: s.heightPx,
  ...(s.sheetNumber ? { sheet_number: s.sheetNumber } : {}),
  ...(s.detected ? { detected_scale: s.detected.label } : {}),
});

export class Session {
  file: string | null = null;
  private doc: DocHandle | null = null;
  private sheets = new Map<string, SheetState>();
  conditions: Condition[] = [];
  shapes: Shape[] = [];

  /** load_plan replaces the session's document: the old doc is destroyed and
   * ALL state — scales, caches, conditions, shapes — is cleared. */
  async loadPlan(filePath: string) {
    if (this.doc) await this.doc.destroy().catch(() => {});
    this.doc = null;
    this.sheets.clear();
    this.conditions = [];
    this.shapes = [];
    this.file = null;

    const doc = await openPdf(filePath);
    this.doc = doc;
    this.file = path.basename(filePath);
    for (let n = 1; n <= doc.numPages; n++) {
      const ph = await doc.page(n);
      // sheet-key codec: page 1 = bare file name, pages 2+ = "name#page"
      // (parseSheetKey in web/src/lib/sheets.ts is the inverse)
      const key = n === 1 ? this.file : `${this.file}#${n}`;
      this.sheets.set(key, {
        key,
        pageNum: n,
        widthPt: ph.widthPt,
        heightPt: ph.heightPt,
        widthPx: ph.viewport.width,
        heightPx: ph.viewport.height,
        sheetNumber: extractSheetNumber(ph.textContent, ph.viewport),
        detected: detectScale(ph.textContent, ph.viewport),
        upp: null,
        text: positionedText(ph),
        page: ph,
      });
    }
    return {
      file: this.file,
      page_count: doc.numPages,
      sheets: [...this.sheets.values()].map(sheetSummary),
      note: "Replaced the previous session — all prior scales, conditions, and shapes were cleared.",
    };
  }

  sheet(name: string): SheetState {
    if (!this.doc) throw new UserError("No plan loaded — call load_plan first.");
    const hit = this.sheets.get(name);
    if (hit) return hit;
    // convenience: accept the title-block sheet number (e.g. "A-101") too
    const wanted = name.toUpperCase().replace(/\s+/g, "");
    for (const s of this.sheets.values()) if (s.sheetNumber === wanted) return s;
    throw new UserError(`Unknown sheet "${name}" — loaded sheets: ${[...this.sheets.keys()].join(", ")}.`);
  }

  /** Resource-URI addressing: sheets by 1-based page number. */
  sheetForPage(page: number): SheetState {
    if (!this.doc) throw new UserError("No plan loaded — call load_plan first.");
    for (const s of this.sheets.values()) if (s.pageNum === page) return s;
    throw new UserError(`No page ${page} — the loaded plan has pages 1–${this.sheets.size}.`);
  }

  /** Every loaded sheet, in page order — [] before any plan loads. */
  sheetList(): SheetState[] {
    return [...this.sheets.values()].sort((a, b) => a.pageNum - b.pageNum);
  }

  /** The takeoff://sheets index payload — cheap (no geometry is built). */
  index() {
    if (!this.doc) {
      return { file: null, page_count: 0, sheets: [], hint: "No plan loaded — call the load_plan tool with a PDF path, then list resources again." };
    }
    return {
      file: this.file,
      page_count: this.sheets.size,
      sheets: this.sheetList().map((s) => ({
        ...sheetSummary(s),
        scale_set: s.upp != null,
        shape_count: this.shapes.filter((x) => x.sheet_id === s.key).length,
      })),
    };
  }

  /** Rendered-page PNG, long edge capped at IMAGE_MAX_EDGE (never above the
   * canvas-native RENDER_SCALE), cached per sheet until the next load_plan. */
  async renderSheetPng(page: number): Promise<Uint8Array> {
    const s = this.sheetForPage(page);
    if (!s.png) {
      const scale = Math.min(RENDER_SCALE, IMAGE_MAX_EDGE / Math.max(s.widthPt, s.heightPt));
      s.png = await s.page.renderPng(scale);
    }
    return s.png;
  }

  private async ensureGeometry(s: SheetState): Promise<VectorGeometry> {
    if (!s.geo) {
      const opList = await s.page.operatorList();
      s.geo = extractVectorGeometry(opList, s.page.viewport.transform, OPS);
      s.snap = buildSnapGrid(s.geo.points, SNAP_CELL);
    }
    return s.geo;
  }

  /** v1 masks come from the sheet's vector linework only. Raster seam: a scanned
   * sheet would render via a node canvas into a future rastermask module that
   * returns this same MaskObj shape.
   *
   * A6 (audit): the SHEET SCALE rides into the mask, exactly as the canvas does
   * it (TakeoffCanvas.jsx ensureMask). Without it MaskObj.mppf was 0 and every
   * feet-true guard in the engine — the hatch pitch cap, the tiny/thickness
   * floors, the seed nudge — silently fell back to raw pixel constants, so the
   * same seed measured differently here than on the canvas. This server always
   * works at RENDER_SCALE (pdf.ts pins the viewport there), so the baseline
   * px/ft equals this render's px/ft and buildMask's render-independence factor
   * k is exactly 1 — passing both is documentation, not arithmetic. */
  async ensureMask(name: string): Promise<MaskObj | null> {
    const s = this.sheet(name);
    if (s.mask === undefined || s.maskUpp !== s.upp) {
      const geo = await this.ensureGeometry(s);
      const pxPerFt = s.upp != null && s.upp > 0 ? 1 / s.upp : 0;
      s.mask = geo.segs.length
        ? buildMask(geo.segs, s.widthPx, s.heightPx, MASK_MAX_DIM, geo.meta, pxPerFt, pxPerFt)
        : null;
      s.maskUpp = s.upp;
    }
    return s.mask;
  }

  /** The engine arguments for a flood on `mask` — derived by the SHARED
   *  oneClickArgs (web/src/lib/detectRooms.ts), which is pinned against the
   *  canvas's own inline call in web/test/engineParity.test.ts. `mask.mppf`
   *  comes from buildMask above and IS the canvas's `mo.ws / upp`.
   *
   *  NO SCALE, NO PRETEND SCALE. When the sheet has no scale set, mppf is 0 and
   *  every rule falls back to what oneclick.ts documents for the scale-unknown
   *  case: the hairline SEAL_RADII floor (drafting gaps only, never a doorway),
   *  no door-swing wedge retry, and the minimum-passage rule OFF. That is a
   *  DIFFERENT measurement from the scaled one, so `scaleBlind` is surfaced in
   *  every reply and provenance receipt it produces rather than left silent. */
  private engineArgs(mask: MaskObj) {
    return oneClickArgs(mask.mppf || 0);
  }

  /** The confidence + engine receipts shared by one_click and detect_rooms —
   *  the same fields the canvas puts on a proposal's origin. */
  private receipts(f: Extract<FloodResult, { status: "ok" }>, scaleBlind: boolean, areaSF?: number) {
    // Route through the shared adapter, not a hand-listed field set. This site
    // was the fifth such list and silently went stale the moment hatchTier,
    // wedgeGrowth, curveFrac, min-passage and areaSF landed — MCP would have
    // reported HIGHER confidence than the canvas for the same click, which is
    // A6 (engine parity) reopening through the confidence surface.
    const conf = traceConfidence(floodSignals(f, { mppf: f.mppf, areaSF }));
    return {
      confidence: conf.score,
      ...(conf.factors.length ? { confidence_factors: conf.factors } : {}),
      ...(f.hatchFiltered ? { hatch_filtered: true as const } : {}),
      ...(f.sealedPx ? { gap_sealed_px: f.sealedPx } : {}),
      // AUDIT F7(d): the minimum-passage receipts, which the canvas has minted
      // since A3 (TakeoffCanvas.jsx, `min_pass_px` / `min_pass_delta` on the
      // proposal's origin and on the agent one-click reply) and this list did
      // not — A6's failure class again, a hand-listed field set going stale
      // under a new engine signal. Without them an MCP caller cannot tell a
      // verbatim 40 SF closet from a 40 SF closet the rule TRIMMED 26% off, or
      // from one the rule is the sole reason exists at all: `confidence` moves
      // but nothing says why in a machine-readable field.
      //
      // The condition is `minPassDelta` truthy, matching the canvas exactly, and
      // it is the engine that decides when that is set — not this site. Since the
      // F1/F2 fix (474c243) the TRIMMING path sets both whenever the rule removed
      // anything (`d > 0`) and returns without running the ladder's gates, while
      // the CREATING path (`minPassDelta === 1`, the verbatim linework bounds
      // nothing) sets them alongside gap_sealed_px + virtualFrac. A rule that ran
      // and changed nothing still sets neither: provenance for that is noise.
      ...(f.minPassDelta ? { min_pass_px: f.minPassPx, min_pass_delta: f.minPassDelta } : {}),
      ...(f.wedges ? { door_wedges: f.wedges } : {}),
      // F7(g): a wedge that annexed the interior of a closed drawn RING (a round
      // column, a callout bubble) is not a door swing. Same measurement — this
      // only stops `door_wedges` from being the whole story about what happened.
      ...(f.ringWedges ? { ring_interiors: f.ringWedges } : {}),
      ...(scaleBlind ? { scale_blind: true as const } : {}),
    };
  }

  async sheetInfo(name: string) {
    const s = this.sheet(name);
    const geo = await this.ensureGeometry(s);
    return {
      ...sheetSummary(s),
      seg_count: geo.segs.length >> 2,
      has_vector_linework: geo.segs.length > 0,
      scale_set: s.upp != null,
      ...(s.upp != null ? { upp: s.upp } : {}),
      shape_count: this.shapes.filter((x) => x.sheet_id === s.key).length,
    };
  }

  private scaleGate(s: SheetState): string {
    return `Set the scale for ${s.key} first — use set_scale${s.detected ? ` (detected: ${s.detected.label})` : ""}.`;
  }

  setScale(name: string, mode: { label?: string; upp?: number; calibrate?: { p1: [number, number]; p2: [number, number]; feet: number }; use_detected?: boolean }) {
    const s = this.sheet(name);
    let upp: number;
    let label: string | undefined;
    let source: string;
    if (mode.label !== undefined) {
      const sc = STANDARD_SCALES.find((x) => x.label === mode.label);
      if (!sc) throw new UserError(`Unknown scale label ${JSON.stringify(mode.label)}. Valid labels: ${STANDARD_SCALES.map((x) => x.label).join(" | ")}`);
      upp = sc.upp;
      label = sc.label;
      source = "label";
    } else if (mode.upp !== undefined) {
      if (!(mode.upp > 0)) throw new UserError("upp must be a positive number (real feet per image px at render scale 2.0).");
      upp = mode.upp;
      source = "upp";
    } else if (mode.calibrate !== undefined) {
      const { p1, p2, feet } = mode.calibrate;
      const px = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (!(px > 0)) throw new UserError("Calibration points are identical — click two points along a known dimension.");
      if (!(feet > 0)) throw new UserError("Calibration feet must be positive.");
      upp = feet / px;
      source = "calibrate";
    } else if (mode.use_detected) {
      if (!s.detected) throw new UserError(`No detected scale for ${s.key} — read the title block with read_sheet_text, or calibrate from a known dimension.`);
      upp = s.detected.upp;
      label = s.detected.label;
      source = "detected";
    } else {
      throw new UserError("Provide exactly one of: label, upp, calibrate, use_detected.");
    }
    s.upp = upp;
    return { sheet: s.key, upp, ...(label ? { label } : {}), source };
  }

  private conditionFor(tag: string): Condition {
    let c = this.conditions.find((x) => x.finish_tag === tag);
    if (!c) {
      // field-identical to the canvas's addCondition, palette rotation included
      const lc = PALETTE[this.conditions.length % PALETTE.length];
      c = {
        id: uid("cnd"),
        finish_tag: tag,
        color: lc,
        fill: lc,
        hatch: HATCH_IDS[1 + (this.conditions.length % (HATCH_IDS.length - 1))],
        multiplier: 1,
        waste_pct: 0,
        materials: [],
      };
      this.conditions.push(c);
    }
    return c;
  }

  private commit(s: SheetState, tag: string, role: MeasureRole, vertsPx: Point[], computed: Shape["computed"], origin?: Shape["origin"]): Shape {
    const c = this.conditionFor(tag);
    const shape: Shape = {
      id: uid("shp"),
      sheet_id: s.key,
      condition_id: c.id,
      measure_role: role,
      verts_norm: vertsPx.map(([x, y]) => [x / s.widthPx, y / s.heightPx]),
      computed,
      ...(origin ? { origin } : {}),
    };
    this.shapes.push(shape);
    return shape;
  }

  async oneClick(name: string, x: number, y: number, opts: { condition?: string; role: "floor_area" | "deduct"; returnVerts: boolean }) {
    const s = this.sheet(name);
    const mask = await this.ensureMask(name);
    if (!mask) throw new UserError("This sheet has no vector linework (likely a scan); raster fallback not yet available in the MCP server.");
    // A6 (audit): the SEALED flood, through the shared floodAtSeed — the same
    // entry point detect_rooms uses and the canvas's engine with the canvas's
    // scale-derived arguments. This used to be the raw floodRegion: no gap
    // sealing, no minimum-passage rule, no door wedges, so an MCP one_click and
    // a canvas One-Click on the same seed disagreed while both stamped
    // origin.method "one_click_v1".
    const eng = this.engineArgs(mask);
    const f = floodAtSeed(mask, x, y, SENS_BALANCED, eng.mppf);
    if (f.status === "leak") throw new UserError("That space isn't enclosed on the plan linework — the fill spilled through a gap or opening.");
    if (f.status !== "ok") throw new UserError("Landed in dense linework (hatching or text).");
    // F7(b): THE shared ring (oneclick.oneClickRing) — the canvas's three sites
    // and the bench go through the same helper, so an MCP one_click and a canvas
    // One-Click on one seed cannot compose the trace differently. The snap
    // tolerance is the helper's SNAP_TOL_PX; nothing here restates it.
    const ring = oneClickRing(f, { nearest: (px, py, d) => (s.snap ? nearestSnap(s.snap, px, py, d) : null) });
    if (ring.length < 3) throw new UserError("Couldn't trace that space into a polygon.");
    const areaPx2 = ringArea(ring);
    const perimPx = closedMetrics(ring).perim;
    const rec = this.receipts(f, eng.scaleBlind, s.upp ? areaPx2 * s.upp * s.upp : undefined);
    const common = {
      status: "ok" as const,
      nverts: ring.length,
      ...rec,
      ...(opts.returnVerts ? { verts: ring.map(([vx, vy]) => [round1(vx), round1(vy)]) } : {}),
    };
    if (s.upp == null) {
      // preview only — px quantities, never committed without a scale
      return {
        ...common,
        area_px2: round1(areaPx2),
        perimeter_px: round1(perimPx),
        warning: `No scale set for ${s.key} — quantities unavailable, and the fill ran SCALE-BLIND (gap sealing limited to hairline drafting gaps, door-swing inclusion and the minimum-passage rule off), so this outline can differ from the scaled one. Call set_scale${s.detected ? ` (detected: ${s.detected.label})` : ""} and re-run.`,
      };
    }
    const upp = s.upp;
    const area_sf = round2(areaPx2 * upp * upp);
    const perimeter_lf = round2(perimPx * upp);
    let shape_id: string | undefined;
    if (opts.condition) {
      // actor + reviewed: false — this is a machine-proposed trace no human
      // has affirmed; only an explicit human review gate may set reviewed.
      shape_id = this.commit(s, opts.condition, opts.role, ring, { area_sf, perimeter_lf }, {
        method: "one_click_v1",
        actor: "agent",
        seed_norm: [x / s.widthPx, y / s.heightPx],
        reviewed: false,
        fill_sensitivity: SENS_BALANCED,
        ...rec,
      }).id;
    }
    return { ...common, area_sf, perimeter_lf, ...(shape_id ? { shape_id } : {}) };
  }

  /** Batch room detection: read every room-number label off the sheet's text
   *  layer, seed the existing One-Click flood at each, and trace/commit
   *  exactly like oneClick — just N of them from one call instead of N
   *  reasoning-heavy round-trips. Same contract as oneClick: no scale → a
   *  px-only preview per room; no condition → nothing commits (a review
   *  pass, not a proposal-acceptance gate — this server has none). A region
   *  that traces to a degenerate ring (<3 verts) is dropped from the batch
   *  rather than failing the whole call — one bad label must not sink every
   *  other clean detection on the sheet. */
  async detectRooms(name: string, opts: { condition?: string; role: "floor_area" | "deduct"; returnVerts: boolean }) {
    const s = this.sheet(name);
    const mask = await this.ensureMask(name);
    if (!mask) throw new UserError("This sheet has no vector linework (likely a scan); raster fallback not yet available in the MCP server.");
    const seeds = roomLabelSeeds(s.text);
    // A6 (audit): detectRegions now runs the sealed engine; the mask carries the
    // sheet scale, so it derives the same seal radii / wedge cap / min-passage
    // radius the canvas uses. Nothing here re-gates the result — the batch gate
    // is still flood STATUS alone.
    const eng = this.engineArgs(mask);
    const regions = detectRegions(mask, seeds, SENS_BALANCED, eng.mppf);
    const rooms = regions
      .map((r) => {
        const ring = oneClickRing(r.flood, { nearest: (px, py, d) => (s.snap ? nearestSnap(s.snap, px, py, d) : null) });   // F7(b): the shared ring, as in oneClick above
        if (ring.length < 3) return null; // couldn't trace into a polygon — drop, don't sink the batch
        const areaPx2 = ringArea(ring);
        const perimPx = closedMetrics(ring).perim;
        const rec = this.receipts(r.flood, eng.scaleBlind, s.upp ? areaPx2 * s.upp * s.upp : undefined);
        const common = {
          label: r.str,
          nverts: ring.length,
          ...rec,
          ...(opts.returnVerts ? { verts: ring.map(([vx, vy]) => [round1(vx), round1(vy)]) } : {}),
        };
        if (s.upp == null) {
          return { ...common, area_px2: round1(areaPx2), perimeter_px: round1(perimPx) };
        }
        const upp = s.upp;
        const area_sf = round2(areaPx2 * upp * upp);
        const perimeter_lf = round2(perimPx * upp);
        let shape_id: string | undefined;
        if (opts.condition) {
          shape_id = this.commit(s, opts.condition, opts.role, ring, { area_sf, perimeter_lf }, {
            method: "one_click_v1",
            actor: "agent",
            seed_norm: [r.seed[0] / s.widthPx, r.seed[1] / s.heightPx],
            reviewed: false,
            fill_sensitivity: SENS_BALANCED,
            ...rec,
          }).id;
        }
        return { ...common, area_sf, perimeter_lf, ...(shape_id ? { shape_id } : {}) };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return {
      detected: rooms.length,
      rooms,
      ...(s.upp == null ? { warning: `No scale set for ${s.key} — quantities unavailable, and every fill ran SCALE-BLIND (gap sealing limited to hairline drafting gaps, door-swing inclusion and the minimum-passage rule off), so these outlines can differ from the scaled ones. Call set_scale${s.detected ? ` (detected: ${s.detected.label})` : ""} and re-run.` } : {}),
    };
  }

  measurePolygon(name: string, verts: Point[], opts: { condition?: string; role: "floor_area" | "deduct" }) {
    const s = this.sheet(name);
    if (s.upp == null) throw new UserError(this.scaleGate(s));
    const met = closedMetrics(verts);
    const area_sf = round2(met.area * s.upp * s.upp);
    const perimeter_lf = round2(met.perim * s.upp);
    let shape_id: string | undefined;
    // agent-supplied coordinates are a hand trace by a machine hand: manual
    // method, agent actor — and never reviewed (no human affirmed anything).
    if (opts.condition) shape_id = this.commit(s, opts.condition, opts.role, verts, { area_sf, perimeter_lf }, { method: "manual", actor: "agent" }).id;
    return { area_sf, perimeter_lf, nverts: verts.length, ...(shape_id ? { shape_id } : {}) };
  }

  measureLine(name: string, pts: Point[], opts: { condition?: string }) {
    const s = this.sheet(name);
    if (s.upp == null) throw new UserError(this.scaleGate(s));
    const length_lf = round2(openLen(pts) * s.upp);
    let shape_id: string | undefined;
    // area_sf stays 0 — the canvas only mints border SF when the condition has a thickness
    if (opts.condition) shape_id = this.commit(s, opts.condition, "linear", pts, { area_sf: 0, perimeter_lf: length_lf }, { method: "manual", actor: "agent" }).id;
    return { length_lf, npts: pts.length, ...(shape_id ? { shape_id } : {}) };
  }

  summary() {
    const rows = conditionTotals(this.conditions, this.shapes) as Record<string, unknown>[];
    // strip presentation fields for a compact agent-facing reply
    const lean = rows.map(({ color, fill, hatch, materials, ...rest }) => rest);
    return { conditions: lean, totals: grandTotals(rows) };
  }

  deleteShape(id: string) {
    const i = this.shapes.findIndex((x) => x.id === id);
    if (i < 0) throw new UserError(`No shape with id ${JSON.stringify(id)}.`);
    this.shapes.splice(i, 1);
    return { deleted: id, shape_count: this.shapes.length };
  }

  /** The exact browser save payload (TakeoffCanvas.jsx autosave + the schema key
   * store.saveAnnotations stamps) — importable by the app. */
  exportPayload() {
    if (!this.doc) throw new UserError("No plan loaded — call load_plan first.");
    return {
      schema: ANN_SCHEMA,
      project_name: "",
      units: "imperial",
      sheets: [...this.sheets.values()].filter((s) => s.upp != null).map((s) => ({ sheet_id: s.key, units_per_px: s.upp })),
      conditions: this.conditions,
      shapes: this.shapes,
      markups: [],
      sheet_group: [],
      last_group: [],
      sheet_tabs: [],
      sheet_levels: {},
    };
  }

  readSheetText(name: string, region?: { x0: number; y0: number; x1: number; y1: number }) {
    const s = this.sheet(name);
    const items = region
      ? s.text.filter((t) => t.x >= region.x0 && t.x <= region.x1 && t.y >= region.y0 && t.y <= region.y1)
      : s.text;
    return { sheet: s.key, items, text: items.map((t) => t.str).join(" ") };
  }
}
