// Rasterization geometry for the schedule-OCR harness (docs/SCHEDULE-OCR.md).
// PURE and DOM-free: the pixel rendering itself is environment-specific (Node
// @napi-rs/canvas in the benchmark, OffscreenCanvas in the browser worker; the
// shipping Copy-text tool renders on the MAIN thread — recognition alone runs
// in tesseract's worker), but the COORDINATE MATH that maps an engine's
// crop-pixel boxes back to the {str,x,y,h} space the fixtures and parseSchedule
// share lives here, tested, so every engine and every render path agree on one
// convention.
//
// Coordinate spaces:
//   • image-px @ RENDER_SCALE — the canvas's stage space; fixture rects and
//     ground-truth words live here (x left edge, y BASELINE growing down).
//   • crop-px — the rasterized region an engine sees: origin at the rect's
//     top-left, one crop pixel = 1 / (RENDER_SCALE·zoom_over_baseline) image
//     units. We carry the single `zoom` that relates the two.
import type { OcrWord } from "./types";

/** The region an engine was handed, and at what magnification. `rect` is in
 * image-px @ RENDER_SCALE; `zoom` is the render scale RELATIVE to the
 * RENDER_SCALE baseline (zoom 1 → 144 DPI-equivalent, zoom 2 → 288). The
 * rendered bitmap is therefore (rect width·zoom) × (rect height·zoom) px. */
export interface RenderGeometry {
  rect: { x0: number; y0: number; x1: number; y1: number };
  zoom: number;
}

/** Output bitmap dimensions for a geometry (what the renderer must allocate). */
export function renderDims(g: RenderGeometry): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round((g.rect.x1 - g.rect.x0) * g.zoom)),
    height: Math.max(1, Math.round((g.rect.y1 - g.rect.y0) * g.zoom)),
  };
}

/** A recognizer's word box in crop-px: top-left/bottom-right, y down. This is
 * the shape tesseract.js (word.bbox), PaddleOCR (quad → aabb), and ocrs all
 * reduce to. */
export interface CropBox { x0: number; y0: number; x1: number; y1: number }

/** Map a crop-px word box back to an OcrWord in image-px @ RENDER_SCALE. The
 * box's BOTTOM becomes the baseline y (glyphs rise from it, matching the text
 * layer's Token convention), its height the cap height, its left the x. */
export function cropBoxToWord(str: string, box: CropBox, g: RenderGeometry, confidence?: number): OcrWord {
  const inv = 1 / g.zoom;
  const w: OcrWord = {
    str,
    x: g.rect.x0 + box.x0 * inv,
    y: g.rect.y0 + box.y1 * inv,
    w: (box.x1 - box.x0) * inv,
    h: (box.y1 - box.y0) * inv,
  };
  if (confidence != null) w.confidence = confidence;
  return w;
}
