# Research — tile pattern origin-alignment + multi-SKU motif prior art

**Date:** 2026-08-28 · **For:** `feat/tile-multi-sku` / the herringbone-origin question
**Method:** 3 parallel research agents — (1) our cloned reference repos, (2)
herringbone/basketweave lattice math on GitHub/web, (3) multi-color motif +
estimating + room-alignment on GitHub/web. Web claims are sourced; lattice claims
were **empirically verified** (coverage tests + rendered herringbone; scripts at
`scratchpad/hb.py`, `hb2.py`, `hb3.py`).

## Headline

Two premises the spec used to defer herringbone/basketweave are **falsified**:
1. *"origin ignored → per-surface restart unreachable"* — **honoring origin is
   mathematically clean**: translation is a free symmetry of the interlock
   (verified; no source contradicts). TileSim already implements it.
2. *"motif slot enumeration is genuinely unresolved"* — **it's resolved**: the
   fundamental cell is 2 planks (H+V) on a known lattice; a paintable motif is a
   modular wrap of the lattice index, stable under origin translation.

Both were common-shortcut problems, not hard ones. Honoring origin is *more
correct* (removes an arbitrary plan-coordinate parity artifact; makes the existing
per-room origin override actually work for these patterns) and is the same
primitive that unlocks motif painting.

## Verified lattice math

**Herringbone** (planks L×W, 2-plank motif `H=[0,L]×[0,W]`, `V=[L,L+W]×[0,L]`):
- `v1 = (L, L)`, `v2 = (W, −W)` — orthogonal (`v1·v2 = 0`); `det = 2LW` ⇒
  **2 planks per primitive cell**. Wallpaper group **pgg**.
- **Gap-free at ANY ratio** (verified 1.5, 2, 2.5, 3). "2:1 required" is FALSE —
  what 2:1 buys is that every plank corner lands on a common W×W grid (clean
  registration); non-integer ratios still tile, just with off-grid T-junctions.
  → **Our `layoutWarning` that flags non-2:1 as if not gap-free is too strong**
  (`tilePatterns` herringbone). Revisit: warn about *registration*, not gaps.

**Basketweave** (2:1 planks): block = L×L = 2 planks; standard = 2×2 blocks
checkerboard = (2L)×(2L) = **8 planks**, lattice `v1=(2L,0)`, `v2=(0,2L)`.
Wallpaper group **p4g**.

**Origin = free translation.** `field = { motif + o + i·v1 + j·v2 }`. Adding a
constant `o` to every tile is a translation ⇒ trivially still gap-free.
- `o` is meaningful **only mod the lattice ⟨v1,v2⟩** — reduce it; only fractional
  parts matter. Decompose `o` into v1/v2 components; offset along either.
- **Band/course parity is preserved under translation by construction** (parity is
  a function of the motif index and (i,j), not absolute position). This directly
  refutes the earlier "parity flips with plan position" worry — the flip only
  looked arbitrary because the anchor was arbitrary (plan `[0,0]`); a settable,
  reduced origin makes it deliberate.

## Room-alignment (the "shift/align to the measured area" step)

Solved procedurally in the trade (chalk-line + half-plank offset + dry-lay), and
in closed form:
- **Methodology (sourced):** snap a reference line on the longest wall; center &
  balance opposite-wall cuts; **no cut < ½ tile** — ANSI A108.02 §4.3.1/§4.3.2;
  Fine Homebuilding; Havwoods (herringbone = half-plank-width offset from the
  centerline). Calculators (CalcuFloor, tileprocalculator) preview it but hide the
  formula.
- **Balanced-cut formula** (grout-aware): pitch `P = tile + grout`, run `D`,
  `m = D mod P`. Centered ⇒ both edge cuts `= m/2`; no-sliver phase
  `edge_cut = (m + P)/2` ⇒ `P/2 ≤ edge_cut < P` (never a sliver). For
  herringbone/basketweave apply **in the lattice frame** (solve v1- and
  v2-components independently), then convert back.
- **This is exactly our existing `edge_strategy: balanced/start_full` +
  sliver-avoidance optimizer (`DESIGN §3.2`)** — we already do it for uniform
  patterns; the only gap is that herringbone/basketweave don't honor `origin` to
  feed it.

## Data model — store the repeat, keyed unit-relative

Both the local and web agents converge: store `slot → {skuId, orientation}` keyed
**unit-relative**, not absolute cells, not runtime-random.
- **TileSim** (`refs/TileSim`, cleanest borrow): herringbone adds `originOffset`
  *after* the integer lattice `(a,b)`, so `cellId = a_b_H|V` is **stable under an
  origin shift**; per-position assignment is `tileOverrides: cellId→tileTypeId`,
  resolved `overrides[cellId] ?? defaultTileTypeId`, counted per type. Full
  working assign→render→count pipeline — missing only the *repeat* abstraction.
  Motif drop-in: `slotId = (a mod mW)_(b mod mH)_orient`, look up `motif[slotId]`;
  reuses the existing lookup seam; composes with origin-honoring for free.
- **Tiled/TMX** (BSD `libtiled`): slot-indexed array with **flip/rotate flags
  packed into the top bits of each cell value** — the orientation-aware slot model
  (herringbone H/V, Versailles rotation) to mirror.
- **SVG `<pattern>`** / **CAD `.PAT`** (`angle, origin, delta-x, delta-y`) — the
  "define once + origin+delta" render/alignment structure.

**Anti-patterns / corroboration:** `refs/tiletakeoff` and **clarkx/Parquet**
(Blender) both have real herringbone/basketweave but **hardcode the anchor to
bounds/(0,0), no origin param** — the exact bug we have; it's a common shortcut,
not a considered decision. `refs/TileCalculator` has the clean *absolute-index*
grid scheme (`col = floor((minX−offset)/module)`) worth adopting so grid/brick
assignments also survive origin shifts. **Tactile/TactileJS** (Kaplan,
isohedral.ca) is the serious lattice/transform primitive but parameterizes tile
*shape*, not field origin.

## Corrections for future (not this slice)

- **Versailles module is ÷8 sq ft, not ÷4.** The widely-copied ÷4 "4-tile module"
  is arithmetically broken (piece areas sum to 6.22 sq ft). Correct closing set:
  2×(8×8) + 1×(8×16) + 2×(16×16) + 1×(16×24) = 1152 in² = exactly 8 sq ft. Canonical
  per-piece *coordinates* are published only as vendor diagram images (a gap).
- **Accents** = an override rule (`nth`-style `{stride, offset}→skuId`, à la CSS
  `nth-child`) on top of the base repeat, not baked into cells.
- **Estimating:** apply waste **per color** (a left-diagonal offcut can't fill a
  right-diagonal gap → per-color waste runs higher than blended). We already count
  cuts geometrically, so we don't need the calculator-blog waste-% tables (which
  cite TCNA/ANSI but are **secondary, unverified** against the primary docs).

## Design implication

The deferral of herringbone/basketweave was based on now-falsified premises.
Recommended restructure:
1. **Origin-honoring for herringbone/basketweave** — a bounded generator change
   (verified vectors + origin-mod-lattice + balanced-cut phase; the `scratchpad/hb*.py`
   coverage tests are ready-made oracles). A correctness fix on its own merits,
   independent of multi-SKU; makes the per-room origin override honest; also fix
   the over-strong non-2:1 warning.
2. **Multi-SKU repeat-unit painting** — now applicable to **all** patterns
   (uniform via col/row, intrinsic-motif via lattice-index-mod), because #1 gives
   stable origin-relative slot keys everywhere.

Sequencing (#1 before/with #2, and whether motif-painting for herringbone joins
this slice or a fast-follow) is a scoping call — but none of it is blocked on
unknowns anymore.
