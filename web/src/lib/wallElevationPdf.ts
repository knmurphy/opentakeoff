// web/src/lib/wallElevationPdf.ts
//
// Task 1 (2026-08-29 wall-tile-slice-b) — draws a wall's tiled elevation
// strip (Slice A's wallElevationLayout, tileWallElevation.ts) into a real,
// DETERMINISTIC one-page PDF so it can be stored as an ordinary sheet.
// Determinism is the whole safety story: contribute.js content-hashes every
// stored PDF, so regenerating the SAME wall on demand must reproduce
// byte-identical output or every regen would look like a changed sheet.
// Follows the imageToPdf idiom (ingest.js:116-143) precisely: dynamic
// `await import("pdf-lib")`, `PDFDocument.create({ updateMetadata: false })`
// so pdf-lib never stamps a wall-clock CreationDate/ModificationDate, and no
// Date/Math.random/other nondeterminism anywhere in the draw path.
//
// Task 3 v2 (2026-08-29 wall-tile-slice-c) — the generated SHEET now draws
// the DEVELOPED elevation (per-wall flat panels, gap-separated, with a bold
// break-line + inside/outside marker at each corner) instead of one
// continuous folded/bent strip, matching the NKBA drafting convention the
// TilePanel preview (Task 2 v2) already draws. `developedElevationLayout`
// (developedElevation.ts) is the SINGLE source of truth for that re-slice —
// this module feeds it `wallElevationLayout`'s own tiles/folds/dims
// verbatim, same as TilePanel does, and only converts the result's feet to
// PDF points and draws. pdf-lib pages are y-up, origin bottom-left — the
// SAME orientation `wallElevationLayout`/`developedElevationLayout` already
// use (floor at y=0, height up the wall), so panel tiles draw straight off
// `panel.xOffset`/tile x/y with no V-flip (unlike TilePanel's SVG, which
// flips because SVG is y-down). `upp` is UNCHANGED — still the per-foot
// constant `1/(ELEV_POINTS_PER_FT*RENDER_SCALE)` — only the page WIDTH
// grows (by the inter-panel gaps); Slice B's handler reads `upp` for scale,
// never `width_ft` as a physical wall-length (verified: TakeoffCanvas.jsx's
// only use of the returned width_ft is `dimsChanged`'s same-wall-regen
// comparator and its own round-tripped persisted record, both of which
// only care that the SAME wall reproduces the SAME value, not what it
// physically means).
import type { TileLayout } from "./tileSolve.ts";
import type { Fold } from "./tileWall/unwrap.ts";
import { wallElevationLayout } from "./tileWallElevation.ts";
import { developedElevationLayout } from "./developedElevation.ts";
import { RENDER_SCALE } from "./sheets.ts";

// 36 pt/ft == 1/2" = 1'-0" architectural scale (36pt = 0.5in @ 72pt/in, the
// standard PDF point). `upp` below mirrors sheets.ts's Scale.upp convention
// (real feet per image pixel AT RENDER_SCALE, see sheets.ts's `arch()`): a
// page drawn at ELEV_POINTS_PER_FT points/ft, rasterized at RENDER_SCALE
// px/pt like every other sheet, yields ELEV_POINTS_PER_FT*RENDER_SCALE px/ft
// — upp is the reciprocal of that, feet/px. `arch(0.5)` (sheets.ts) computes
// the same number from the other direction: 1/(0.5*72*RENDER_SCALE) ==
// 1/(ELEV_POINTS_PER_FT*RENDER_SCALE).
export const ELEV_POINTS_PER_FT = 36;

export type WallElevationPdf = {
  file: File;
  upp: number;
  width_ft: number;
  height_ft: number;
};

const MARGIN = 24; // pt: left/right/bottom margin around the drawn strip
const HEADER_H = 28; // pt: space reserved above the strip for the header line
const BREAK_LABEL_SIZE = 7; // pt: each break's inside/outside marker
const PANEL_LABEL_SIZE = 8; // pt: each panel's "Wall N" label
const HEADER_SIZE = 10;
const BREAK_LINE_W = 2; // pt: bold corner break-line — distinct from the 0.25pt tile/grout stroke
const PANEL_LABEL_DROP = 16; // pt below FLOOR_Y (the floor datum) for the panel label baseline
const BREAK_LABEL_RISE = 2; // pt above stripTopY for the inside/outside marker

// Renders a feet value as architectural feet-inches (nearest inch), e.g.
// 17.5 -> "17'-6\"". Rounds to the nearest INCH first (not feet, then
// inches separately) so a value like 11.98 carries correctly into the next
// foot ("12'-0\"") instead of overflowing to "11'-12\"".
export function formatFeetInches(ft: number): string {
  const totalInches = Math.round(ft * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'-${inches}"`;
}

// wallElevationLayout's tile colors are always caller-resolved hex (the
// condition's per-SKU `skuColor`), never a CSS name or rgb() string, so a
// plain #rgb/#rrggbb parse (leading '#' optional) is the whole job.
function hexToUnit(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function buildWallElevationPdf(args: {
  wallStrips: TileLayout[];
  folds: Fold[];
  skuColor: (id: string) => string;
  tag: string;
  name: string;
}): Promise<WallElevationPdf> {
  const { wallStrips, folds, skuColor, tag, name } = args;
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const elev = wallElevationLayout(wallStrips, folds, skuColor);
  // developedElevationLayout is the SAME re-slice TilePanel's preview uses
  // (module header) — fed elev's tiles/folds/dims verbatim, no gap_ft
  // override here, so both consumers share the ONE default (0.5ft) defined
  // in developedElevation.ts rather than two literals that could drift.
  const dev = developedElevationLayout({
    tiles: elev.tiles,
    foldsU: elev.folds.map((f) => f.x),
    foldKinds: elev.folds.map((f) => f.kind),
    width_ft: elev.width_ft,
    height_ft: elev.height_ft,
  });
  const P = ELEV_POINTS_PER_FT;
  const FLOOR_Y = MARGIN;
  // Page width is the DEVELOPED total (raw run width + inter-panel gaps),
  // wider than elev.width_ft whenever there's more than one panel; a
  // straight run (one panel, no gap) has dev.total_width_ft === elev.width_ft,
  // so the page is byte-for-byte the same size as before this task.
  const pageW = Math.max(1, dev.total_width_ft * P + MARGIN * 2);
  const pageH = Math.max(1, dev.height_ft * P + FLOOR_Y + HEADER_H);

  // updateMetadata:false is the whole determinism story (see module header):
  // without it pdf-lib stamps CreationDate/ModificationDate with the wall
  // clock, so the SAME wall regenerated twice would produce different bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([pageW, pageH]);

  const grout = rgb(0.35, 0.35, 0.35);
  const ink = rgb(0.1, 0.1, 0.1);
  const stripTopY = FLOOR_Y + dev.height_ft * P;

  // Centers `text` on `cx` — every label below/above the strip is centered
  // on its panel or break, not left-aligned, so widthOfTextAtSize (the same
  // idiom markedset.js already uses for its own centered/right-aligned PDF
  // text) is unavoidable here.
  const drawCentered = (text: string, cx: number, y: number, size: number) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: cx - w / 2, y, size, font, color: ink });
  };

  // pdf-lib is y-up, origin bottom-left — SAME orientation
  // developedElevationLayout's panels already use (floor at y=0, height up
  // the wall; a panel's own tiles are panel-local, `panel.xOffset` is the
  // laid-out-frame offset already carrying the inter-panel gaps), so these
  // draw straight off panel.xOffset + tile.x/y with no V-flip, just the P
  // (feet -> pt) scale and the MARGIN/FLOOR_Y page offset.
  for (const p of dev.panels) {
    for (const t of p.tiles) {
      const [r, g, b] = hexToUnit(t.color);
      page.drawRectangle({
        x: MARGIN + (p.xOffset + t.x) * P,
        y: FLOOR_Y + t.y * P,
        width: t.w * P,
        height: t.h * P,
        color: rgb(r, g, b),
        borderColor: grout,
        borderWidth: 0.25,
      });
    }
    // Per-panel floor datum line, spanning only THIS panel's own extent —
    // a developed elevation's panels are independent flat surfaces, not
    // bridged across the corner gap (a single continuous line there would
    // misread as one uncut wall). A straight run (one panel) draws exactly
    // one line across the full width, identical to the pre-Task-3v2 draw.
    page.drawLine({
      start: { x: MARGIN + p.xOffset * P, y: FLOOR_Y },
      end: { x: MARGIN + (p.xOffset + p.segWidth_ft) * P, y: FLOOR_Y },
      thickness: 1,
      color: ink,
    });
    // Panel label ("Wall N"), centered under the panel, below the floor line.
    const cx = MARGIN + (p.xOffset + p.segWidth_ft / 2) * P;
    drawCentered(p.label, cx, FLOOR_Y - PANEL_LABEL_DROP, PANEL_LABEL_SIZE);
  }

  for (const b of dev.breaks) {
    const x = MARGIN + b.x * P;
    // Bold corner break-line (solid, thicker than the tile/grout stroke) —
    // the NKBA drafting convention's terminating vertical line between two
    // independently-drawn panels, distinct from a plain dashed fold mark.
    page.drawLine({
      start: { x, y: FLOOR_Y },
      end: { x, y: stripTopY },
      thickness: BREAK_LINE_W,
      color: ink,
    });
    drawCentered(b.kind, x, stripTopY + BREAK_LABEL_RISE, BREAK_LABEL_SIZE);
  }

  // Header. Uses elev.width_ft (the wall's REAL developed width, before the
  // 0.5ft decorative inter-panel gaps developedElevationLayout inserts at
  // each corner) — never dev.total_width_ft, which is the gap-INFLATED
  // drawn width and would misreport the wall's actual length to a human
  // reading the sheet. The RETURN value below (width_ft: dev.total_width_ft)
  // is unaffected — this only changes the human-readable text.
  const header = `${tag} — ${formatFeetInches(elev.width_ft)} × ${formatFeetInches(elev.height_ft)} elevation`;
  page.drawText(header, { x: MARGIN, y: stripTopY + 12, size: HEADER_SIZE, font, color: ink });

  const saved = await doc.save();
  // Copy into a fresh Uint8Array(length) — TS's DOM lib types BlobPart as
  // ArrayBufferView<ArrayBuffer>, but pdf-lib's save() return type is
  // Uint8Array<ArrayBufferLike> (which also covers SharedArrayBuffer, a real
  // mismatch tsc --noEmit catches under strict). The `new Uint8Array(length)`
  // overload is the one DOM types as backed by a plain ArrayBuffer.
  const bytes = new Uint8Array(saved.length);
  bytes.set(saved);
  const file = new File([bytes], name, { type: "application/pdf" });
  // upp is UNCHANGED by this task — still the reciprocal of a per-foot
  // constant (module header), never a function of the page's drawn width —
  // only width_ft below grows, to dev.total_width_ft (the DRAWN width,
  // including inter-panel gaps; module header explains why Slice B's
  // handler never treats this as a physical wall-length).
  const upp = 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE);
  return { file, upp, width_ft: dev.total_width_ft, height_ft: dev.height_ft };
}

// The stable sheet-registry key for a generated elevation PDF: one per wall
// SHAPE under its condition tag. Uses the FULL shapeId (never truncated) so
// two walls sharing a tag never collide on a shortened id.
export function wallElevationSheetName(tag: string, shapeId: string): string {
  return `${tag}-elev-${shapeId}.pdf`;
}

// The scale-provenance row the sheet registry records for a generated
// elevation PDF. Unlike an agent-set scale (totals.js/session.ts's
// scale_confirmed gate — see totals.js:501), this scale is KNOWN, not a
// guess: we drew the page ourselves at ELEV_POINTS_PER_FT, so it carries no
// scale_confirmed field to gate on.
export function wallElevationScaleRow(upp: number): { units_per_px: number; scale_source: string } {
  return { units_per_px: upp, scale_source: "wall-elevation-generated" };
}

// Task 3 (2026-08-29 wall-tile-slice-b) — the panel's Generate/Regenerate
// button is a pure function of three things: is a FIGURED wall actually
// selected (a floor selection, no selection, or a wall this pass hasn't
// figured yet — unscaled sheet, reversing/degenerate run — all read
// `selectedWall` as null or wallStrips-empty, and disable the button rather
// than let it fire on nothing to draw), and whether THIS shape's sheet key
// is already in the open sheet set. The key is derived by REUSING
// wallElevationSheetName (never re-derived here) so the button's label and
// generateWallElevationSheet's own regen-vs-first-gen branch (Task 2,
// TakeoffCanvas.jsx) can never disagree about which sheet a click replaces
// — the C1 guard (full shapeId, not just the tag) applies transitively.
export function elevationButtonState(args: {
  selectedWall: { wallStrips?: TileLayout[] } | null | undefined;
  existingSheetKeys: string[];
  tag: string;
  shapeId: string;
}): { enabled: boolean; label: string } {
  const { selectedWall, existingSheetKeys, tag, shapeId } = args;
  const enabled = !!selectedWall?.wallStrips?.length;
  const key = wallElevationSheetName(tag, shapeId);
  const label = (existingSheetKeys || []).includes(key) ? "Regenerate elevation sheet" : "Generate elevation sheet";
  return { enabled, label };
}
