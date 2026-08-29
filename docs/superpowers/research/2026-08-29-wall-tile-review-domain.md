# Adversarial Domain-Correctness Review — Wall-Tile Patterning Design Spec

**Date:** 2026-08-29
**Target:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md`
**Against:** `docs/superpowers/research/2026-08-29-wall-tile-layout-conventions.md`
**Lens:** Break the domain model. Assume wrong until evidence says otherwise.

**VERDICT: REVISE** (1 Critical, 4 Major).

---

## CRITICAL

### C1 — Zero-width folds: no field width is allocated to trim, so the reconciliation invariant is false on any run with corners (§3.2, §3.4, §11.1 vs §4.4, §5)

The unwrap sets fold positions as pure cumulative geometry, `u_k = Σ upp·|seg_i|`
(§3.2), and §3.4 declares the gross field "identically" `L × H = area_sf`. **Nowhere**
— not §3.2, §3.4, §5, or the §8 data model — is any field width subtracted for trim.

But the spec's own requirements put material *inside* the field at every corner:
§4.4 mandates a **movement joint at every corner / change of plane**, and §5 puts a
**profile at every outside corner**. A movement-joint profile (DILEX family) and an edge
profile (RONDEC etc.) each occupy real field width, not a hairline grout line
(research `:82`). So the width available for field tile is `L − Σ w_trim`, not `L`.

Consequence: the §3.4 / §11.1 acceptance invariant ("`Σ kept-cell area == area_sf`,
within one tile") is exact **only at zero corners**. With trim consuming width, kept
field area is short by `Σ w_trim × H`, and **that error scales with corner count** — a
many-cornered run blows past "one tile's rounding." This is the compatibility guarantee
Kevin explicitly asked for, and the spec's own §4.4/§5 break it. Either the strip must
allocate width to each movement joint / profile (and reconcile against `area_sf` net of
trim reveals), or §11.1 must be restated as an inequality with a corner-scaled tolerance.

(Secondary: "within one tile's rounding" is ambiguous under the multi-SKU repeat-unit
painting the spec commits to in §7 — *which* tile's size sets the tolerance?)

---

## MAJOR

### M1 — "Flows straight through" (§4.2) directly contradicts "always terminate the field" (§4.3) on the default path at every outside corner

The unwrap builds **one** continuous strip over all folds (§3.2), and wrap-default
(§4.2) says the pattern "flows straight through; a tile straddling a corner fold-line is
a corner cut whose offcut conceptually starts the next wall." That offcut-carry is the
**inside-corner** practice in the research ("cut into the inside corner and reuse the
cut-off piece to start the adjacent wall" — conventions `:48,55`). Outside corners are
the research's repeatedly-flagged interrupted case: "outside corners are the ones
necessarily interrupted… terminated with a miter, a bullnose, or a metal profile before
the adjacent face begins" (`:50`), "always physically interrupted" (`:67`).

The spec's §4.3 agrees ("Outside corners… always terminate the field") — which is an
**unreconciled contradiction** with §3.2/§4.2. On the default path the reader cannot
tell what an outside corner does: one continuous origin across the arris (pattern
straight through), or a terminated field with a fresh start? The offcut-carry accounting
does not hold uniformly — with a miter or bullnose finish each face carries its **own**
finished edge at the arris, so there is no single tile "cut once, both pieces used"
(only the square-cut-plus-profile case leaves a reusable offcut). Fix: classify
inside/outside (§4.3) **before** building the strip; wrap's offcut-carry is inside-only;
the outside-corner layout behavior must be defined, not left contradictory.

### M2 — Outside corners double-count: field corner-cut EA **and** a bullnose EA for the same tile position (§5)

§5 lists "Field-tile corner **cuts** … tiles straddling a corner fold (wrap) or the end
cuts (reset)" as **"part of piece count,"** and *separately* assigns every outside corner
a finish-edge line switchable to **bullnose EA**. A bullnose at an outside corner is a
field tile **replaced** by a finished-edge piece — you order **one** tile for that slot,
a bullnose. Counting a field corner-cut EA *and* a bullnose EA orders two pieces for one
position. Research `:56,78` frames bullnose/miter/profile as the alternatives that finish
the edge *in place of* a raw field tile. The spec must state the outside-corner field cut
is **suppressed/converted** when the finish is bullnose. (The miter sub-case is weaker —
a miter is labor on the field tile, not a separate material line, so "cut + miter" is not
necessarily a double count; the bullnose case is the airtight defect. The profile case is
legitimately a square cut **plus** an LF line and is not double-counted.)

### M3 — "Derive order waste from cut count" is under-specified; defaulting all overage OFF under-orders (§5 waste bullet)

Refusing the hard-coded 10/15/18 % is correct and fully backed (research `:119-128`:
standards silent; the figures trace only to aggregators). But the replacement — "derive
order waste from the *actual computed corner/perimeter cut count*… any flat overage…
defaulting off" — does not yield an order quantity:

- A cut count is not a scrap quantity. Whether two half-tile cuts consume one tile
  (offcut reused) or two (scrapped) needs an **offcut-reuse/packing model the spec never
  defines**. Wrap's entire economy is offcut reuse (research `:125`), so
  cut-count → tiles-to-order is undefined without it.
- Real orders carry **breakage and attic stock / spares**, which research `:119` states
  is a **separate named project quantity** (CSI extra-materials), not derivable from
  layout geometry. Spoiled miters (research `:126`) are pure scrap the geometric count
  cannot see. Defaulting every overage OFF ships a knowingly short order.

The refusal is sound; the derivation that replaces it is not specified well enough to
produce a defensible order, and the OFF default under-specifies real orders.

### M4 — `face_side` is per-run, but a U-turn / self-touching run switches face side mid-run (§3.1)

The run carries a single per-shape `face_side: "left" | "right"` (§3.1). At a **U-turn**
(the run reverses ~180°, e.g. a pony-wall / peninsula return), the tiled face stays on
the same physical side of the wall while the drawn direction flips, so relative to drawn
direction the face is "left" on the way out and "right" on the way back — **one per-run
value cannot describe the run**, and every interior-vertex inside/outside classification
downstream of the reversal inverts. The reversal vertex is *also* a degenerate cross
product (antiparallel edges), which §4.3's turn-direction test cannot classify, and a
self-touching run breaks the monotone-`u` and wrapped-view assumptions. The task named
these cases; the §3.1 data model does not handle them. Minimum fix: make `face_side`
per-segment (or reject/split reversing runs) and guard the antiparallel cross product.

---

## MINOR (fix in the plan)

- **Collinear / zero-cross-product interior vertices** (§4.3/§4.4): a straight-through
  vertex is neither inside nor outside and is not a change of plane, yet the unwrap
  inserts a fold `u_k` and §4.4 counts a movement joint at "every corner" — spurious fold
  + spurious movement-joint LF. Collapse collinear vertices before building the strip.
- **Run endpoints undecided** (§4.3 vs §5): classification covers only interior vertices,
  but §5 charges finish-edge trim to "exposed field edges (end of a half-wall)." Nothing
  decides whether `u=0`/`u=L` are exposed (trim) or butt an untiled wall/floor (no trim).
  Endpoint trim is therefore always-on (over-count) or always-off (under-count).
- **§4.4 vs §5 internal inconsistency:** §4.4 says movement joint at "every corner /
  change of plane"; §5 assigns them to **inside** corners only. Research `:82` puts the
  movement-joint (DILEX) family at inside corners/changes of plane and edging (RONDEC) at
  outside — supporting §5, so §4.4's "every corner" wording is the wrong one.
- **Herringbone/diagonal "forced reset"** (§8): research labels cross-corner herringbone
  "**observed practice, not a codified rule**," standards "**silent**" (`:92`).
  Defaulting to reset is fine; **forcing** it (§8 `forced "reset"`) over-reads a silent
  source and contradicts the spec's own per-corner-override doctrine (§4.2). Make it a
  default, not a lock.
- **`face_side` default "left"** (§3.1, §13): a wrong default silently inverts the entire
  trim BOM (movement-joint LF ↔ finish-edge). Deferring inference is fine; surface the
  classification visibly so a wrong side is caught, since the failure mode is a silently
  incorrect order, not a cosmetic flip.

---

## SOUND — verified, not manufactured

- **Two-continuities model (§4.1)** is faithful to conventions `:42-51`: course height is
  automatic off the level batten; offset-phase is the only real choice.
- **Reconciliation area-conservation *logic* (§3.4)** is correct **as far as it goes**:
  full-rectangle tiled area is origin-invariant, and reset sub-strips partition
  `[0,L]×[0,H]` so `Σ w_i·H = L·H` exactly — center-and-balance origin shifts and
  reset-per-wall do **not** change kept area. The invariant fails only because trim width
  is unallocated (see C1), not because of origins or sub-strips. No origin/sub-strip
  counterexample exists.
- **Dropping "reset-inside / wrap-outside" (§4.2)** is correct — research `:50,58,137`
  calls it geometrically backwards and unfound in any authoritative source.
- **Inside/outside via cross-product + `face_side`, flip inverts all (§4.3, §11.4)** is
  geometrically correct for the *non-degenerate* interior vertices of an open polyline
  (degenerate cases in M4/Minors).
- **Trim units (§5): bullnose EA, profile LF, movement-joint LF** match research `:84`.
- **Outside corner = always a finished edge** matches research `:67`.
- **Refusing the 10/15/18 % constants** is correct per research `:119-128` (the weakness
  is the derivation that replaces them — M3 — not the refusal).

---

## Verdict

**REVISE.** C1 falsifies the headline reconciliation invariant on any run with corners
(the spec's own §4.4/§5 trim consumes field width the model never allocates, error
scaling with corner count). M1 leaves the default-path outside-corner behavior
self-contradictory; M2 double-counts bullnose outside corners; M3 leaves order quantities
under-specified; M4 is a §3.1 data-model gap on reversing runs. The corner-continuity
theory and the origin/sub-strip area logic are sound — the failures are all in applying a
uniform, zero-width, wrap-everywhere strip to outside corners and trim, which the research
repeatedly singles out as the interrupted, material-bearing case.
