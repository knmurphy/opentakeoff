# Wall-Tile Slice A — Scoped Re-Review (v2)

Re-review of plan `2026-08-29-wall-tile-slice-a.md` (v2) against the prior review's
2 Critical + 5 Major, plus a scan for defects the v2 edits introduced. Anchors
re-verified against live `web/src`.

## Verdict: REVISE (1 Major, 2 Minor)

The two Criticals and four of the five Majors are genuinely closed. One Major
remains: the **binding straddle predicate names a field the tile type does not
have**, so as written it silently reintroduces the exact C1/M2 bug (corner = 0).

---

## MAJOR

### MAJ-1 — Straddle predicate `quad.x < u_k < quad.x+quad.w` references a nonexistent field → 0 straddlers → `counts.corner` stays 0 (M1/M2 regresses)
`TileQuad` is `{ cx, cy, w, h, rot, skuId, cell? }` (`tilePatterns/types.ts:7`;
confirmed by `classify.ts:104-107` using `q.cx/q.cy/q.w/q.h`). There is **no `x`
field.** The plan states `quad.x < u_k < quad.x + quad.w` as the binding rule in
FOUR load-bearing places (Task 3 "Rules", the C1/M1/M2 design-correction note,
Task 3 Step 3, Task 5 §Interfaces, and Revision-log M1). Evaluated literally,
`quad.x` is `undefined` → `undefined < u_k < NaN` is always `false` → zero cells
ever reclassify → `tileCounts(classified).corner === 0`. That is precisely the C1
symptom ("headline corner-cut count vanishes") and M2 ("counts.corner stays 0")
the v2 claims to have fixed. The correct span for an axis-aligned strip quad is
`quad.cx - quad.w/2 < u_k < quad.cx + quad.w/2`. The plan's own numeric TDD tests
(`corner === 8` / `=== 0`) would fail and force the fix, but the plan's stated
mechanism is wrong against the real type and must be corrected to `cx ± w/2`.

---

## MINOR

- **Top-course cut straddler is missed at non-integer H.** Reclassify only targets
  `full` cells (`classify.ts:392-408`). When `H_ft` is not an integer multiple of
  the module, the top course is `cut`; a straddler there stays `cut`, never
  `corner`, so `counts.corner` under-counts by the number of cut courses (usually
  1). `safe = full+cut+corner` (`tiles.ts:48`) is unchanged, so order/purchase is
  unaffected — only the corner-vs-cut EA split at fractional-height walls drifts.
  The Task 3 tests use H=8 (courses=8, no cut course) so they don't exercise it.
- **Empty tile shop-drawing page for a wall-only sheet.** `markedset.js:925`
  creates the tile page when `byShape.size > 0`; the wall summary is in `byShape`,
  but the Task 7 guard (`s.measure_role === "surface_area" → continue`) skips it in
  the draw loop (`:998-1000`). A sheet with only walls yields a furniture-only page
  with no grid. Cosmetic; Slice B (elevation sheet) territory.

---

## Held fixes (verified against code)
- **C1 (gate-widen):** widening `:370` to `|| corner_inside || corner_outside` is a
  true floor no-op — `cornerTallies` (`borders.ts:101`) counts a corner only when
  BOTH adjacent edges are trimmed, and any trimmed edge yields a `trimTallies`
  `byKind` entry, so `byKind.length>0` whenever corner counts >0. For an inside-only
  wall (byKind empty, corner_inside=1) the gate fires → `hasTrim` → `agg.joints`
  emits (`:507-522`). WallTrim carries every key the block/report read
  (byKind/length_lf/pieces/corner_*, joints.total_lf) — no missing key, no crash.
- **C2 (reject-before-loop):** `{ok:false}` → `aggFor(cond).excluded.degenerate++;
  continue;` mirrors the floor path `:314-317`; `excluded` bucket exists on the agg
  (`:303`). The null summary never enters the deref loop. In `markedset.js:924`'s
  mid-render call the reject is likewise pre-loop, so a U-turn wall can't abort the
  render.
- **M1 (phase-aware):** boundary fold → 0 straddlers is correct logic (subject to
  the MAJ-1 field-name fix).
- **M2 (reclassify→count):** `tileCounts` accumulate maps `corner`→`counts.corner`
  and keeps `safe` (`tiles.ts:31,48`); reclassifying `full`→`corner` leaves
  order/keptArea intact. Correct once the predicate reads `cx±w/2`.
- **M3 (absolute label):** an absolute east→south assertion + on-screen Task 8
  validation replaces the relativity-only test. Residual risk (physical correctness
  rests on the browser smoke) is acceptable for the convention.
- **M4 (panel source):** `computeTileTakeoff` returns `byShape` (`tileTakeoff.js:537`),
  already consumed at `markedset.js:924`; per-shape summaries carry `layout`
  (+`wallStrips`). Threading the selected shape's `byShape` entry as `selectedWall`
  is sound; `TakeoffCanvas.jsx:1318` persist caller anchor is valid for the 3rd-arg
  height change.
- **M5 (reset merge):** `summary.layout.classified = flatMap(sub-strips)` feeds
  `agg.classified.push(...)` (`:356`); multi-SKU split (`:423-424,448`) + reuse
  (`:485`) read the merged `agg.classified`. All consumers (countsBySku/cutSheet/
  reusePlan/orderTiles) are position-independent, so concatenated cross-frame cells
  are safe.
- **Task 3 vs 5 vs 6 reset:** no contradiction — the reset branch passes `classified`
  through WITHOUT reclassifying, so it never runs the wrap straddle logic over the
  merged (per-sub-strip-local) coordinates. Folds in reset only bump `corner_inside`
  and `total_lf`.
- **Anchors:** `:370`, `:507-522`, `:617-623`, `:314-317`, `:356`, `:423-424/448`,
  `:485`, `:924`, `:998-1017`, `TakeoffCanvas.jsx:1318` all match live source.
</content>
</invoke>
