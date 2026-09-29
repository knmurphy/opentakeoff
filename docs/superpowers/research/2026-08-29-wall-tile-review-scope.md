# Adversarial Review — Wall-Tile Patterning Design Spec (scope / coherence / buildability)

**Date:** 2026-08-29
**Target:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md`
**Lens:** internal consistency, ambiguity that stalls an implementer, YAGNI, slice viability, testability.
**Provenance check:** the three cited research docs (`m10-investigation`, `prior-art-corners-sketch`, `layout-conventions`) were read; load-bearing citation ranges were spot-checked. Engine claims were verified against `web/src/lib/markedset.js`.

## Verdict: REVISE

The spec is well-grounded and its citations largely hold. But it ships three defects that produce wrong numbers or block an implementer on the Slice A path (the "quantities" MVP that is the whole point), plus a clutch of Majors. None are fatal to the design; all are fixable in a revision.

---

## Critical

### C1 — Vertical / course origin policy for walls is undefined; the reused floor optimizer's objective is wrong for a wall. (§4.4, §3.3, §11.3)
§4.4 discusses balancing **horizontal end cuts** ("balanced end cuts ≥ ½ tile") and nothing else. But the grounding research it cites states a wall has **two independent balancing axes** — horizontal *and* vertical — and that the vertical axis is **not symmetric**: "full tiles start at the batten line, cut courses land at floor and ceiling/top-of-wainscot" (`layout-conventions.md:33,35`). A floor's `optimizeOrigin` (reused verbatim per §3.3) balances both axes symmetrically like a floor. Run over a wall strip it will center the courses top-to-bottom, which is the wrong convention (full course at the batten/floor line, cut at the top). This directly changes the **cut-tile piece count** — the headline Slice A deliverable — yet the spec never specifies the vertical origin rule or acknowledges the reused objective diverges from wall practice. An implementer has no basis to decide, and "reuse the floor optimizer" silently ships the wrong answer. **Fix:** state the vertical origin policy (full/near-full course at the floor line, cut at top, by default) and specify how the reused optimizer is constrained or replaced on the v-axis for walls.

### C2 — No invariant pins the corner-cut *piece count*; reconciliation cannot catch a miscount. (§11, §5)
The feature exists to count corner cuts / trim. Yet every §11 invariant is blind to a corner-cut count error: the reconciliation invariant (1) conserves **area**, which is identical whether a corner is counted as one straddling tile or two half-tiles; classification (4) only tests inside/outside labels; trim (5) tests unit *kind* (EA/LF) not *count*. So the one quantity the feature adds — pieces/cuts at corners — has no falsifiable test. A wrap run that double-counts a corner cut, or a reset run that miscounts its two end cuts per fold, passes all seven invariants. **Fix:** add an invariant fixing exact corner-cut counts for a known run under both wrap (one straddling cut per interior fold) and reset (two end cuts per shared fold), independent of area.

### C3 — Opening the role gate routes wall shapes into the plan-space tile renderer; Slice A must suppress it, and the spec doesn't say so. (§9 item 2)
Verified in `web/src/lib/markedset.js`: the marked-set tile-cell loop (~line 997) gates purely on `tileByShape.get(s.id)` and then reads `s.verts_norm` mapped to plan coordinates `[nx*W, ny*H]` (line 1005), requiring `ring.length ≥ 3`. A multi-wall `surface_area` run has ≥3 verts (its traced centerline), so once §9's role gate admits it into `computeTileTakeoff`, it acquires a summary and this loop draws tile quads **along the wall's plan centerline** — geometrically meaningless. §9 correctly notes wall tiles render "in elevation space… not the plan placement," but frames that as a *rendering choice* for Slice B, not as a **Slice A suppression requirement**. Opening the compute gate without gating this render path is a Slice A correctness bug the spec omits. **Fix:** §9/Slice A must explicitly exclude `surface_area` from the plan-space marked-set/DXF quad loop, not merely "open the gate."

---

## Major

### M1 — Herringbone corner reset: "forced" (§8) vs "auto-default" (§4.2), and both over-claim the source. (§4.2, §8, §13)
§4.2 calls herringbone/diagonal reset an "**auto-default**" (implying override-able); §8 calls it "**forced** `reset` for herringbone/diagonal patterns" (implying locked). One word each, opposite meanings — an implementer cannot tell whether a per-corner override may force-wrap a herringbone corner. Compounding it: the cited source (`layout-conventions.md:92`) explicitly says sources are "**silent**… stated as observed practice, not a codified rule." So "forced" (removing user choice) is *stronger than the grounding warrants*. The task-flagged interaction — how per-corner overrides compose with the herringbone auto-reset — is left entirely unaddressed. **Fix:** make it a default (not forced), grounded as observed-practice; state that a per-corner override wins over it.

### M2 — Reset sub-strip boundaries and corner allowance are unspecified. (§3.2, §4.2)
The unwrap uses pure centerline fold-lines `u_k = Σ upp·|seg_i|`, and reconciliation depends on `L×H = area_sf`, so tile thickness / corner allowance at inside corners is (deliberately) ignored — but this is never stated. Under **reset**, the spec says the run "splits at each corner into sub-strips" and "joints do not cross the corner," but never says whether each sub-strip spans `[u_{k-1}, u_k]` exactly, which side owns the fold-line tile, or that each corner therefore carries **two** independent end cuts (one per abutting sub-strip). These are the exact numbers Slice A must produce. **Fix:** state sub-strip boundaries are exact centerline segments with no corner allowance (consistent with reconciliation), and that reset yields two end cuts per shared fold.

### M3 — `wall_edge_finish: "miter"` is a selectable option with no defined counting output. (§5, §8, §11.5)
§5 maps profile → LF and bullnose → EA, but never says what quantity a **miter** finish produces (it's a fabrication method, not a purchased trim line). §8 offers it as a first-class enum value and §11.5 tests "units EA/LF per §5" — miter maps to neither. Either define its output (e.g., a labor/cut line, or "no trim material, corner-cut count only") or drop it for Slice A as YAGNI. As written it's an incomplete knob.

### M4 — Reconciliation tolerance ("within one tile's rounding") is unpinned and may be trivially-true or reliably-false. (§3.4, §11.1)
The flagship acceptance test compares "Σ kept-cell area" to `area_sf` within "one tile's rounding," but never defines whether a kept cell's area is its **tile footprint** (grout excluded) or its **module footprint** (tile + joint). If tile-footprint, Σ kept area = `L×H` minus the grout fraction (~1–3% of field), which exceeds one tile on any wall past ~50 SF — the test then fails on correct layouts. If module-footprint, cells partition the ring exactly and the tolerance is pointless. (I did not confirm the engine's cell-area basis in `classifyLayout`, so the direction is unverified — but the spec ambiguity stands regardless.) **Fix:** pin the tolerance as a formula and name which area is meant.

### M5 — One height per run makes stepped/unequal-height runs unrepresentable, and it's not in out-of-scope. (§3.1, §4.1, §2)
§3.1 resolves a single `H` for the whole run, so a run spanning walls of differing heights or crossing a floor step cannot be modeled. §4.1's "course heights align automatically and non-optionally" only holds under equal height + a shared floor line — a precondition never stated. §2's out-of-scope list omits it. **Fix:** declare unequal-height runs out of scope (or state the equal-height guard) so the invariant's premise is explicit.

### M6 — §8 omits the waste-overage field. (§5, §8)
§5 requires exposing a flat overage as "a user-editable trade default… defaulting off" — a persisted setting — but §8 (which claims to enumerate the data-model additions) doesn't list it. Add it or state where it lives.

### M7 — Slice A's "correct orderable quantities" is only true for hole-free walls. (§12, §2, §3.4)
Openings (doors/windows) are out of scope, and the reconciliation invariant is asserted only for a "hole-free wall." Any real wall with a doorway over-orders. This is an honest MVP boundary, but the Slice A deliverable line ("correct orderable wall-tile quantities") overstates it. **Fix:** qualify the Slice A deliverable as hole-free-wall-accurate, openings deferred.

---

## Minor

- **N1 — `face_side` coordinate handedness undefined (§3.1/§4.3).** "Left of drawn direction" + cross-product sign depends on `verts_norm` y-orientation (screen y-down vs math y-up). Invariant 4's flip test catches a *relative* error but not a globally-inverted absolute convention if the ground-truth author shares the mistake. Pin the handedness.
- **N2 — `corner_overrides` keyed by `vertexIndex` is edit-fragile (§8).** The prior-art research (`prior-art…:Q4`) warns that positional-index keys re-anchor under polyline edits; inserting/moving a vertex silently mis-applies overrides. Same class of bug, unaddressed.
- **N3 — Per-corner override lives "on the elevation" (§4.2/§10), i.e. Slice B.** So in Slice A the *adjust* half of the doctrine is reachable only at the per-run level; per-corner adjust is unavailable until B. Coherent, but note the doctrine is partially deferred.
- **N4 — The sliver "flag" output (§13) isn't in the Slice A list (§12).** The wrap-sliver ruling promises the optimizer "flags" a sub-½ end cut; that flag is a Slice A output not enumerated.
- **N5 — §4.4's "no cut smaller than half a tile" reads as absolute** but §13 (and the source's "*usually* no cuts smaller than half," `layout-conventions.md:29`) treat it as a soft objective that wrap may violate. Word it as a soft objective to avoid an implementer coding a hard constraint that breaks wrap.

---

## What holds up (so the revision doesn't over-correct)

- Provenance is real: the drop of "reset-inside/wrap-outside" (`:50,58,137`), the half-tile rule (`:28-33`), the two-continuities reframe (`:42-51`), and "waste % traces only to aggregator sites" (`:117-128`) are all faithfully supported by the conventions doc.
- The engine-reuse thesis (pure over `ring_ft`) and the reconciliation identity `L×H ≡ area_sf` are sound.
- Slice A is genuinely independent of Slice B for *quantities + panel preview* — the preview reuses the quad math in elevation space, not the synthetic-sheet plumbing. C3 is the one hidden coupling, and it's a suppression requirement, not a dependency.
- No §13 open question blocks Slice A: face-side inference (explicit default suffices) and elevation sheet scale (Slice B) are correctly deferrable.

## Load-bearing gaps to resolve before the Slice A plan
C1 (vertical origin), C2 (corner-count invariant), C3 (plan-render suppression), M1 (herringbone forced-vs-default + override interaction), M2 (reset sub-strip semantics), M4 (reconciliation tolerance definition).
