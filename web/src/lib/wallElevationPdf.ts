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
// the DEVELOPED elevation (per-wall flat panels with a bold break-line +
// corner marker at each corner) instead of one continuous flat strip with
// dashed fold marks, matching the NKBA drafting convention the TilePanel
// preview (Task 2 v2) already draws. `developedElevationLayout`
// (developedElevation.ts) is the SINGLE source of truth for that re-slice —
// this module feeds it `wallElevationLayout`'s own tiles/folds/dims
// verbatim, same as TilePanel does, and only converts the result's feet to
// PDF points and draws. pdf-lib pages are y-up, origin bottom-left — the
// SAME orientation `wallElevationLayout`/`developedElevationLayout` already
// use (floor at y=0, height up the wall), so panel tiles draw straight off
// `panel.xOffset`/tile x/y with no V-flip (unlike TilePanel's SVG, which
// flips because SVG is y-down).
//
// Slice C fix pass (2026-09-29, review I2/I3/M2/M3):
// - The sheet carries a KNOWN scale, so panels ABUT (gap_ft: 0) with the
//   break-line on the shared edge; the page is the true run length and any
//   measurement across a corner is exact. Only the unscaled panel preview
//   keeps a gap. `width_ft` is therefore the physical run length again.
// - A right-faced run is mirrored (elevationMirrored) so the sheet reads as
//   seen facing the tile.
// - Each panel is labeled with its length; corner marks say "INSIDE CORNER" /
//   "OUTSIDE CORNER" and stagger when neighbours would overprint.
import type { TileLayout } from "./tileSolve.ts";
import type { Fold } from "./tileWall/unwrap.ts";
import { wallElevationLayout } from "./tileWallElevation.ts";
import { developedElevationLayout, elevationMirrored } from "./developedElevation.ts";
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
const HEADER_H = 48; // pt: space above the strip for corner marks (2 rows), the view note and the header
const BREAK_LABEL_SIZE = 7; // pt: each break's corner marker
const PANEL_LABEL_SIZE = 8; // pt: each panel's "Wall N" label
const HEADER_SIZE = 10;
const BREAK_LINE_W = 2; // pt: bold corner break-line — distinct from the 0.25pt tile/grout stroke
const PANEL_LABEL_DROP = 16; // pt below FLOOR_Y (the floor datum) for the panel label baseline
const BREAK_LABEL_RISE = 2; // pt above stripTopY for the corner marker (first row)
const BREAK_LABEL_ROW = 9; // pt between the two staggered corner-marker rows
const NOTE_SIZE = 7;
const NOTE_RISE = 21; // pt above stripTopY: the viewing note
const HEADER_RISE = 32; // pt above stripTopY: the header line

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

// Feet-inches to the nearest 1/8" — the precision a setter cuts to — e.g.
// 12.53125 -> "12'-6 3/8\"". Rounds once on eighths so carries are exact.
export function formatFeetInchesEighths(ft: number): string {
  const total = Math.round(ft * 96);
  const feet = Math.floor(total / 96);
  const rem = total % 96;
  const inches = Math.floor(rem / 8);
  let n = rem % 8, d = 8;
  while (n && n % 2 === 0) { n /= 2; d /= 2; }
  return `${feet}'-${inches}${n ? ` ${n}/${d}` : ""}"`;
}

export function cornerMarkLabel(kind: string): string {
  return kind === "inside" ? "INSIDE CORNER" : "OUTSIDE CORNER";
}

// The sheet's header text. Pure so the real-width rule is pinned by a test:
// it states the physical run length, never a drawn width.
export function elevationHeader(tag: string, width_ft: number, height_ft: number): string {
  return `${tag} — ${formatFeetInchesEighths(width_ft)} × ${formatFeetInchesEighths(height_ft)} elevation`;
}

export const ELEVATION_VIEW_NOTE = "Viewed facing the tiled face. Wall 1 = first traced segment.";

// Two-row stagger for corner marks: a mark moves to the upper row when it
// would overlap the previous mark on the lower row. Widths and x in the same
// units. Returns the row (0 or 1) for each mark, in input order.
export function staggerRows(xs: number[], widths: number[], pad = 0): number[] {
  const rows: number[] = [];
  let lastRight0 = -Infinity;
  xs.forEach((x, i) => {
    const left = x - widths[i] / 2;
    if (left >= lastRight0 + pad) { rows.push(0); lastRight0 = x + widths[i] / 2; }
    else rows.push(1);
  });
  return rows;
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
  face_side?: "left" | "right";
}): Promise<WallElevationPdf> {
  const { wallStrips, folds, skuColor, tag, name } = args;
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const elev = wallElevationLayout(wallStrips, folds, skuColor);
  // developedElevationLayout is the SAME re-slice TilePanel's preview uses
  // (module header), fed elev's tiles/folds/dims verbatim — with gap_ft: 0,
  // because this page is at a known scale (review I2), and the same mirror
  // rule the preview uses (review I3).
  const dev = developedElevationLayout({
    tiles: elev.tiles,
    foldsU: elev.folds.map((f) => f.x),
    foldKinds: elev.folds.map((f) => f.kind),
    width_ft: elev.width_ft,
    height_ft: elev.height_ft,
    gap_ft: 0,
    mirror: elevationMirrored(args.face_side),
  });
  const P = ELEV_POINTS_PER_FT;
  const FLOOR_Y = MARGIN;

  // updateMetadata:false is the whole determinism story (see module header):
  // without it pdf-lib stamps CreationDate/ModificationDate with the wall
  // clock, so the SAME wall regenerated twice would produce different bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const header = elevationHeader(tag, elev.width_ft, elev.height_ft);
  // The page is the run at scale plus margins, widened only when the header
  // text is longer than a short wall (the strip itself stays at scale).
  const textW = Math.max(font.widthOfTextAtSize(header, HEADER_SIZE), font.widthOfTextAtSize(ELEVATION_VIEW_NOTE, NOTE_SIZE));
  const pageW = Math.max(1, dev.total_width_ft * P + MARGIN * 2, textW + MARGIN * 2);
  const pageH = Math.max(1, dev.height_ft * P + FLOOR_Y + HEADER_H);
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
    // Panel label ("Wall N · 10'-6\""), centered under the panel, below the floor line.
    const cx = MARGIN + (p.xOffset + p.segWidth_ft / 2) * P;
    drawCentered(`${p.label} · ${formatFeetInchesEighths(p.segWidth_ft)}`, cx, FLOOR_Y - PANEL_LABEL_DROP, PANEL_LABEL_SIZE);
  }

  const marks = dev.breaks.map((b) => cornerMarkLabel(b.kind));
  const rows = staggerRows(
    dev.breaks.map((b) => MARGIN + b.x * P),
    marks.map((m) => font.widthOfTextAtSize(m, BREAK_LABEL_SIZE)),
    4,
  );
  for (const [i, b] of dev.breaks.entries()) {
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
    drawCentered(marks[i], x, stripTopY + BREAK_LABEL_RISE + rows[i] * BREAK_LABEL_ROW, BREAK_LABEL_SIZE);
  }

  // Header states the physical run length (elevationHeader), plus a one-line
  // note on how the sheet is oriented and how walls are numbered.
  page.drawText(ELEVATION_VIEW_NOTE, { x: MARGIN, y: stripTopY + NOTE_RISE, size: NOTE_SIZE, font, color: ink });
  page.drawText(header, { x: MARGIN, y: stripTopY + HEADER_RISE, size: HEADER_SIZE, font, color: ink });

  const saved = await doc.save();
  // Copy into a fresh Uint8Array(length) — TS's DOM lib types BlobPart as
  // ArrayBufferView<ArrayBuffer>, but pdf-lib's save() return type is
  // Uint8Array<ArrayBufferLike> (which also covers SharedArrayBuffer, a real
  // mismatch tsc --noEmit catches under strict). The `new Uint8Array(length)`
  // overload is the one DOM types as backed by a plain ArrayBuffer.
  const bytes = new Uint8Array(saved.length);
  bytes.set(saved);
  const file = new File([bytes], name, { type: "application/pdf" });
  // upp is the reciprocal of a per-foot constant (module header), never a
  // function of the page's drawn width. width_ft is the physical run length
  // (no gaps on the sheet — review I2).
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
