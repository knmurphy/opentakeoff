// web/src/lib/tileCalc/cutsheet.ts
//
// Per-room cut sheet (design §3.2/§4.x milestone note): every non-full,
// non-hole, non-out piece the classifier produced gets consolidated into
// counted rows by its rounded cut dimensions + shape flags, so a fabricator
// sees "4x this exact cut" instead of 4 duplicate entries. The consolidated
// cross-room batch and its Marked-Set rendering are a later milestone (M8);
// this module only groups what one `classifyLayout` call returned.

import type { Classified } from "../tileGeometry/classify.ts";

export type CutRow = {
  w_in: number;
  h_in: number;
  count: number;
  lShaped: boolean;
  corner: boolean;
};

const DEFAULT_ROUND_IN = 0.125; // snap to nearest 1/8"

export function cutSheet(classified: Classified[], opts?: { round_in?: number }): CutRow[] {
  const round_in = opts?.round_in ?? DEFAULT_ROUND_IN;
  const groups = new Map<string, CutRow>();

  for (const c of classified) {
    if (c.cls !== "cut" && c.cls !== "corner") continue;
    if (!c.cut) continue;
    const w_in = Math.round(c.cut.w_in / round_in) * round_in;
    const h_in = Math.round(c.cut.h_in / round_in) * round_in;
    const lShaped = c.cut.lShaped;
    const corner = c.cls === "corner";
    const key = `${w_in}|${h_in}|${lShaped}|${corner}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { w_in, h_in, count: 1, lShaped, corner });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const aSize = a.w_in * a.h_in;
    const bSize = b.w_in * b.h_in;
    return bSize - aSize;
  });
}
