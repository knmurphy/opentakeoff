// The region detector's MCP adapter (docs/design/REGION_ANNOTATION_PLAN.md,
// task 8): a loaded page → the detector's source-neutral DetectSheet. The
// detector itself is the web app's pure module (web/src/lib/regionDetect.ts),
// imported as-is, so a headless session and the canvas classify a sheet with
// one implementation.
//
// Conventions, all shared with the canvas:
// - coordinates are image px at RENDER_SCALE in the DISPLAYED orientation
//   (the viewport applies /Rotate, so a /Rotate 90 page arrives with w/h
//   swapped against its MediaBox);
// - tokens are baselineRuns (pdf.ts): the web's extractPageTokens convention,
//   with abutting runs joined exactly as find_text joins them;
// - lines are the long axis-aligned rules longAxisLines keeps from the
//   segments extractVectorGeometry returns;
// - key is the session's sheet key (page 1 = file name, pages 2+ = name#page),
//   which parseSheetKey (web/src/lib/sheetKey.ts) inverts.
import type { BaselineRun } from "./pdf.ts";
import { longAxisLines, type DetectSheet } from "../../web/src/lib/regionDetect.ts";

export interface DetectPage {
  key: string;
  /** image px, displayed orientation */
  widthPx: number;
  heightPx: number;
  /** PDF points, displayed orientation */
  widthPt: number;
  heightPt: number;
}

export function buildDetectSheet(page: DetectPage, runs: readonly BaselineRun[], segs: ArrayLike<number>): DetectSheet {
  const w = page.widthPx, h = page.heightPx;
  return {
    key: page.key,
    w, h,
    pageIn: [page.widthPt / 72, page.heightPt / 72],
    tokens: runs.map((r) => ({ str: r.str, x: r.x, y: r.y, w: r.w, h: r.h, ...(r.rot ? { rot: r.rot } : {}) })),
    lines: longAxisLines(segs, w, h),
    source: "vector",
  };
}
