# Scoped Re-Review — Wall-Tile Patterning Design Spec v2

**Date:** 2026-08-29
**Target:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md` (v2)
**Scope:** verify each prior Critical/Major fix actually resolves its finding and is
code-consistent; scan for new contradictions the v2 edits introduced. Not re-litigating
settled-sound items.
**Code verified against:** `web/src/lib/{tileGeometry/classify.ts, tileCalc/tiles.ts,
tilePatterns/grid.ts, tileSolve.ts, tileTakeoff.js, markedset.js}`.

## Verdict: REVISE (1 Critical, 1 Major)

---

## CRITICAL

### CV-1 — The reconciliation "fix" reopens scope-M4 / domain-C1: the engine has NO module-footprint area; its cells are TILE-footprint, so `Σ kept area == L×H` is false by the grout fraction. (§3.4, §11.1)

The v2 headline fix (§14, domain C1 / scope M4) is: tile the full field, cells are
**module-footprint (tile + its joint) that partition the ring**, so
`Σ kept-field module area == L×H == area_sf` **exactly, no tolerance needed** (§3.4, §11.1).

This is false against the code the spec calls verbatim reuse (§3.3):

- `tilePatterns/grid.ts` places quads on **module pitch** (`pitchCell(w_ft,h_ft,joint_ft)`)
  but every quad is **tile-sized**: `w: w_ft, h: h_ft` (joint excluded). Quads do not cover
  the plane — there are joint gaps between them.
- `tileGeometry/classify.ts:373` `areaFull_sf = quad.w * quad.h` = tile face (grout
  excluded); `areaKept_sf` = (tile rect ∩ room) (`:383-384`). No module rectangle is ever
  clipped.
- `tileCalc/tiles.ts:40,52-67` `keptArea_sf` sums `areaKept_sf`; `tileTakeoff.js:354,598`
  aggregates/reports it as `kept_area_sf`. **No module-area quantity exists anywhere.**

So the only "kept area" the reused engine can produce is the **tile-footprint** sum, which
= `L×H − grout fraction` (~1–3% of field). Against `area_sf = L×H` (`shapeMetrics.js:29`)
that invariant is off by grout on **every** layout with a nonzero joint — it exceeds "one
tile" past ~50 SF, which is exactly the scope-M4 failure the fix claimed to close. §9's ADD
list (items 6–9) does **not** add a module-footprint reconciliation computation, and §3.3
lists `countsBySku` as verbatim. The fix renamed the basis to "module" without providing
the number; as written, invariant #1 is reliably-false with the engine's output (or
trivially-true if collapsed to `L×H==area_sf`, testing nothing — M4's other horn).
**Fix:** either add a module-footprint kept-area computation to Slice A (clip module rects,
or a counting argument) and list it in §9 ADD, or restate §11.1 against tile-footprint with
an explicit grout-aware formula. This is a Slice-A blocker (invariant #1 is a Slice-A test).

---

## MAJOR

### MV-1 — Two v2-added invariants disagree on the outside-fold-under-bullnose piece count. (§11.4 vs §11.6 / §5)

Both are Slice-A tests; they collide on the same case. Worked case — 2-segment run, one
interior vertex classified **outside**, `wall_edge_finish: "bullnose"`, wrap:
- §11.4: "wrap → … an end cut **per outside fold face**" → **2** cut pieces at that fold.
- §5 table + §11.6: bullnose "**replaces** the field tile … `bullnose` = **one EA**, the
  field cut is converted."

Three live readings, no ruling: 2 bullnose EA (contradicts §11.6), or 1 bullnose + 1
unconverted field end cut (an undocumented per-face asymmetry — §5's conversion applied to
only one of the two faces), or 1 piece total (contradicts §11.4's "per face"). The
unresolved question is whether "one EA" is counted **per exposed face-slot or per outside
corner**. This is *not* domain-M2 re-litigated (that was "don't count a field cut *and* a
bullnose at one slot" — settled); it is the **new** §11.4 count invariant interacting with
the bullnose conversion. An implementer writes two Slice-A tests that disagree. **Fix:**
state the outside-fold piece count per finish (per-corner vs per-face), and reconcile §11.4
with §11.6/§5.

## Fixes that HOLD (one line each)

- **1(b) wall origin U-only + pinned V datum** — internally consistent. §4.2 (sub-strip
  balances its own U, shares the run's pinned V datum) and §11.2 (one shared V/course grid)
  now agree; §9 ADD-6 replaces the 2D optimizer. Holds.
- **1(c) corner-cut piece-count invariant §11.4** — matches §4.2 wrap/reset semantics
  (wrap: one straddling cut per inside fold + an end cut per outside-fold face; reset: two
  end cuts per shared fold) and is area-independent/testable. **Qualified:** it is NOT
  consistent with §11.6/§5 on the outside-fold-under-bullnose count — see MV-1; ships only
  after that is reconciled.
- **1(d) plan-render suppression §9 CLOSE** — correct gate. `markedset.js:998-1006` is the
  only plan-quad draw loop, gated solely on `tileByShape.get(s.id)` + `ring.length<3`; a
  `measure_role` skip of `surface_area` there is sufficient (DXF already `floor_area`-gated,
  `dxf.ts:232`). The `:216` mis-citation is corrected. Holds.
- **1(e) summarizeShape run-keyed branch + jointTotals guard** — correct. `tileTakeoff.js:391-395`
  confirms `agg.jointTotals` accumulates unconditionally per shape, emission gated at `:507`
  (`agg.hasTrim`); `:220 cornerTallies(ring_ft)` / `:228 movementJoints({ring_ft})` are
  floor-ring-coupled. Branching `surface_area` onto a run-keyed joint LF (or zero) and
  suppressing the strip-ring tallies prevents the bogus `2(L+H)` on mixed conditions. Holds.
- **Data model (§8) internal consistency** — every declared field is used (`face_side`,
  `endpoint_exposed`, `wall_corner_mode`, `wall_edge_finish`, `wall_waste_pct`,
  `wall_corner_overrides`); index spaces distinct and documented (run-vertex overrides vs
  `edge_overrides` ring-edge). Holds — except the naming propagation miss in the Minor below.

## MINOR

- **M-7 rename didn't fully propagate (§4.2:204).** §8 declares `wall_corner_overrides`;
  §4.2 still refers to "(§8 `corner_overrides`…)" — the pre-rename bare name whose entire
  purpose (engine M-7) was to stop an implementer cross-wiring into the ring-edge
  `edge_overrides` space. Rename to `wall_corner_overrides`.
- **Stale cross-ref (§3.4:154).** "opening deductions (§2, §12, **§11.7**)" — the openings
  invariant is §11 item **9**; item 7 is byShape. Should be §11.9.
- **Bullnose conversion vs "additive / partitions the ring" (§3.4 vs §5).** §3.4 says trim
  is purely additive and every cell counts toward `Σ kept-field module area == L×H`; §5
  bullnose says the outside-corner **field cut EA is suppressed/converted** to a bullnose EA.
  The two adjustments act on different axes (reveal-width area vs piece count) and are
  probably consistent, but the spec never states whether a bullnose-converted corner cell
  still counts in the reconciliation area (it must, for "exact" to hold). One line resolves
  it. Feeds CV-1's ambiguity about what "kept-field" area includes.
