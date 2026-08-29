// web/src/lib/tilePatterns/enumerateSlots.ts
//
// The paint-the-unit panel control's slot list (M9 Task 11): every slot a
// repeat-unit assignment can paint, in the SAME key space slotKey.ts +
// PLANK_ARITY already define for the generators/resolver. Iterates
// i∈0..unit.w-1, j∈0..unit.h-1, and — for a multi-plank pattern
// (herringbone/basketweave) — p∈0..arity-1 per cell.
//
// CRITICAL: for an arity-1 pattern (grid/brick_50/brick_33/diagonal — the
// default/primary case) `cell` omits `p` entirely, so slotKey emits "i_j".
// A `p: 0` would emit "i_j_0" instead, which no arity-1 generator quad
// carries (their quads' cell.p is null) — painting that slot would be a
// SILENT NO-OP (assignedSkuId never finds a matching quad to override).
// Do not "helpfully" default p to 0 here; slotKey.ts deliberately does not
// collapse p===0 either (herringbone's p:0 leading-V role needs its suffix).
import { slotKey, PLANK_ARITY, type TileCell } from "./slotKey.ts";

export type EnumeratedSlot = { slot: string; i: number; j: number; p?: number };

export function enumerateSlots(pattern: string, unit: { w: number; h: number }): EnumeratedSlot[] {
  const arity = PLANK_ARITY[pattern] ?? 1;
  const out: EnumeratedSlot[] = [];
  for (let j = 0; j < unit.h; j++) {
    for (let i = 0; i < unit.w; i++) {
      if (arity === 1) {
        const cell: TileCell = { i, j };
        out.push({ slot: slotKey(cell, unit), i, j });
      } else {
        for (let p = 0; p < arity; p++) {
          const cell: TileCell = { i, j, p };
          out.push({ slot: slotKey(cell, unit), i, j, p });
        }
      }
    }
  }
  return out;
}
