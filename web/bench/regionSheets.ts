// Pure half of the region bench's PDF adapter: a pdf.js page's measured parts
// (displayed-orientation size at RENDER_SCALE, text tokens, vector segments,
// page box and /Rotate) → a `DetectSheet` (src/lib/regionDetect.ts). The
// pdf.js half lives in regionSheets.mts; tested in test/regionSheets.test.ts.
import { longAxisLines, type DetectSheet, type DetectToken } from "../src/lib/regionDetect.ts";

/** The sheetKey.ts convention: page 1 is the bare file name, later pages
 * `file#n` (parseSheetKey splits on the last '#'). */
export function sheetKeyFor(file: string, page: number): string {
  if (!Number.isInteger(page) || page < 1) throw new Error(`sheetKeyFor: bad page ${page}`);
  return page === 1 ? file : `${file}#${page}`;
}

/** Page size in inches, displayed orientation, from the page box in points
 * (`page.view`, [x0, y0, x1, y1]) and its /Rotate; rounded to 1/1000 in. */
export function pageSizeInches(view: readonly number[], rotate: number): [number, number] {
  const wPt = Math.abs(view[2] - view[0]), hPt = Math.abs(view[3] - view[1]);
  const quarter = ((Math.round(rotate / 90) % 4) + 4) % 4;
  const [a, b] = quarter % 2 ? [hPt, wPt] : [wPt, hPt];
  const r = (pt: number) => Math.round((pt / 72) * 1000) / 1000;
  return [r(a), r(b)];
}

export interface PageParts {
  key: string;
  w: number; h: number;              // image px at RENDER_SCALE, displayed orientation
  pageIn?: [number, number];
  tokens: readonly DetectToken[];    // sheets.ts extractPageTokens output
  segs: ArrayLike<number>;           // oneclick.ts extractVectorGeometry(...).segs
}

/** Assemble a vector DetectSheet: lines are `longAxisLines` over the
 * segments; blank tokens are dropped. */
export function toDetectSheet(p: PageParts): DetectSheet {
  return {
    key: p.key, w: p.w, h: p.h,
    ...(p.pageIn ? { pageIn: [p.pageIn[0], p.pageIn[1]] as [number, number] } : {}),
    tokens: p.tokens.filter((t) => t.str.trim() !== "").map((t) => ({ ...t })),
    lines: longAxisLines(p.segs, p.w, p.h),
    source: "vector",
  };
}
