# Door openings & perimeter — investigation findings

**Status:** investigation on branch `feat/oneclick-door-openings` (off the `#190`
One-Click RFC base). Written 2026-07-28. The code slices on this branch
**should not merge** — they don't work on real plans (see §4). This doc records
what was validated, what failed, the root cause, and the path that unblocks the
feature, so the next pass starts fully informed.

Goal the user set: at a door, the measured perimeter should **exclude the
opening span** (base/trim doesn't run across a doorway) and the span should be
**tracked** so we can offer an auto material-transition (threshold strip) line.

All code refs are `web/src/lib/oneclick.ts` / `web/src/pages/TakeoffCanvas.jsx`.

---

## 1. The bug is real, on real plans (validated)

One-Click's door-swing **wedge annex** (`floodRegionSealed`, the curve-transparent
retry) bounds the room with a messy boundary that **inflates the perimeter**.
Reproduced two ways:

- **Synthetic leaf-angle sweep** through the real `floodRegionSealed`: most
  angles clean, but a 60° leaf leaves a slit — area −2.8%, **perimeter +5.2%**,
  an 8-vertex detour around an empty wedge pocket.
- **Real plan** (`sample-finish-plan.pdf`, an ANDERSON/VA set): scale calibrated
  from the door-swing arc-radius histogram; **7 of 12** sampled doors inflated
  perimeter **+5% to +14%** when the wedge annexed (e.g. `(1978,1441)`: area
  +5.6%, perim +13.7%).

This matches the user's report ("inflates the perimeter, every time").

## 2. What was tried and FAILED

### 2a. Diagonal-leaf absorption (PR #193 — closed)
First hypothesis: the door **leaf** (line ~90° to the arc) leaves a 1–2px slit
the axis-only pinch-absorption missed. Generalized the pinch to diagonals +
iterate-to-convergence. Adversarial review + a real reproduction proved it
targets the **wrong mechanism**: the 60° failure is byte-identical pre/post-fix.
It also added a perf blocker (unbounded hover-path loop) and an over-absorption
regression. Closed. Lesson: the leaf slit is not the cause.

### 2b. `classifyPerimeter` via dt "virtual boundary" (this branch, slices 1–3)
Second approach: split the traced ring into WALL runs (hug linework, `dt≤3`) vs
OPENING spans (the synthetic seal, `dt>3`), exclude openings from perimeter,
track them. Unit-tested green on **synthetic open-gap doors**.

**Smoke test on the real plan killed it.** Created 5 doored shapes; read back from
IndexedDB — every one had `door_opening_lf: null`, including a **2-wedge** room:

| area | perim | wedges | door_opening_lf |
|---|---|---|---|
| 40 SF | 31.65 | 1 | null |
| 154 SF | 64.04 | 1 | null |
| 270 SF | 143.5 | 2 | null |

**Root cause of the miss:** real plans **draw the door frame/jamb linework** at
the opening, so the annexed boundary hugs linework (`dt≤3`) everywhere — the
"open space" the dt-detector looks for doesn't exist. At real plan scales the
opening is also only a few mask cells wide, well under the `dt>3` floor. The
unit tests passed because their synthetic doors had **open gaps** (no frame) —
an unrealistic model.

## 3. What WORKS as a detector (proven, not yet usable)

An **arc-adjacency** detector — flag ring edges near the door's own
`MASK_CURVE_BIT` (swing-arc) cells — **reliably locates and counts every door**.
On real doors the arc-adjacent ring span tracks the wedge count exactly:

| wedges | arc-adjacent ring span |
|---|---|
| 1 | ~6–7 ft |
| 3 | ~21 ft |
| 11 | ~71 ft |

So detection is solvable from the door's arc (unlike dt). **But** the span is
~2× the true door width, because after the annex the traced ring **still hugs
the curved arc** instead of crossing the doorway as a straight jamb chord.

## 4. The actual root blocker

The wedge annex **does not produce clean geometry**. The swing pocket isn't
filled to the jamb line, so the boundary detours along the arc (the +5–14%
inflation) and there is **no clean jamb-to-jamb chord** to (a) exclude from the
base perimeter or (b) record as the transition span. Every downstream detector —
dt or arc-adjacency — inherits this messy boundary.

Therefore the whole door-opening/transition feature is **blocked on a
wedge-annexation rework**, not on the opening detector.

## 5. Recommended path (unblocks perimeter + chord + tracking together)

Rework `floodRegionSealed`'s wedge annex so the annexed region is **filled to the
wall plane and the doorway is crossed by a straight jamb chord**, using the arc's
hinge (fit-circle centre) and its wall-meeting endpoint (the strike jamb) — the
arc-adjacency signal (§3) already localizes the arc; circle-fit geometry
(`circleFitOk` exists) gives the hinge/radius. Once the boundary is clean:

- **Perimeter** = wall runs only (the detour is gone).
- **Opening chord** = hinge→strike-jamb ≈ door width — exclude from base, and
- **Track** it: `door_openings_lf` per door → `transitionLf` (already built) →
  the material-transition line item.

Validate on the **real-door headless harness** (real linework, real arc
tessellation, real frames) — NOT synthetic open-gap fixtures, which is what hid
the failure this time.

## 6. Salvageable pieces on this branch (do not merge as the door fix)

- `classifyPerimeter(ring, mo)` — sound function; its **dt detector is the wrong
  model** for framed doors. Keep the fine-grained wall/opening ring-walk; swap
  the per-edge classifier for the arc/chord signal after the annex is clean.
- `transitionLf(shapes, conditionId?, multiplier?)` in `totals.js` — correct and
  tested; ready to consume real `door_opening_lf` once it's populated.
- The condition-readout "transitions (doorways)" line — correct; inert until
  spans are populated.
- Wiring in `proposeRegion` (perimeter split + span storage) — correct plumbing;
  inert because the detector finds nothing on real plans.

## 7. Sibling follow-ups (independent)

- **Detect Rooms** path recomputes via `ocMetrics` (no mask context) — needs its
  own wiring once the annex/detector are fixed.
- Robust door detection ultimately couples to the symbol recognizer
  (`docs/SYMBOL_DETECTION_RESEARCH.md`): an analytically-detected door gives the
  jamb chord for free and would supersede the raster arc-adjacency heuristic.
