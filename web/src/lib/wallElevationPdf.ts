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
import type { TileLayout } from "./tileSolve.ts";
import type { Fold } from "./tileWall/unwrap.ts";
import { wallElevationLayout } from "./tileWallElevation.ts";
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
const FOLD_LABEL_SIZE = 7;
const HEADER_SIZE = 10;

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
  const P = ELEV_POINTS_PER_FT;
  const FLOOR_Y = MARGIN;
  const pageW = Math.max(1, elev.width_ft * P + MARGIN * 2);
  const pageH = Math.max(1, elev.height_ft * P + FLOOR_Y + HEADER_H);

  // updateMetadata:false is the whole determinism story (see module header):
  // without it pdf-lib stamps CreationDate/ModificationDate with the wall
  // clock, so the SAME wall regenerated twice would produce different bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([pageW, pageH]);

  const grout = rgb(0.35, 0.35, 0.35);
  const ink = rgb(0.1, 0.1, 0.1);
  const stripTopY = FLOOR_Y + elev.height_ft * P;

  // pdf-lib is y-up, origin bottom-left — SAME orientation as
  // wallElevationLayout's own coords (floor at y=0, height up the wall), so
  // these draw straight off elev.tiles/.folds with no V-flip, just the P
  // (feet -> pt) scale and the MARGIN/FLOOR_Y page offset.
  for (const t of elev.tiles) {
    const [r, g, b] = hexToUnit(t.color);
    page.drawRectangle({
      x: MARGIN + t.x * P,
      y: FLOOR_Y + t.y * P,
      width: t.w * P,
      height: t.h * P,
      color: rgb(r, g, b),
      borderColor: grout,
      borderWidth: 0.25,
    });
  }

  for (const f of elev.folds) {
    const x = MARGIN + f.x * P;
    page.drawLine({
      start: { x, y: FLOOR_Y },
      end: { x, y: stripTopY },
      thickness: 0.5,
      color: ink,
      dashArray: [4, 3],
    });
    page.drawText(f.kind, { x: x + 2, y: stripTopY + 2, size: FOLD_LABEL_SIZE, font, color: ink });
  }

  // Floor datum line.
  page.drawLine({
    start: { x: MARGIN, y: FLOOR_Y },
    end: { x: MARGIN + elev.width_ft * P, y: FLOOR_Y },
    thickness: 1,
    color: ink,
  });

  // Header.
  const header = `${tag} — ${elev.width_ft}'-0" × ${elev.height_ft}'-0" elevation`;
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
  const upp = 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE);
  return { file, upp, width_ft: elev.width_ft, height_ft: elev.height_ft };
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
