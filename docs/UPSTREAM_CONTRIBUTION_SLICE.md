# Upstream contribution slice — RFC Kentucky-ai/opentakeoff#60

The mirror of `PARENT_FORK_PORTS.md`: that doc tracks upstream → fork ports;
this one tracks what we intend to contribute fork → upstream, and — just as
importantly — what we deliberately keep OUT of that PR. The One-Click work on
`enhance-one-click-area` (tracked in #184) interleaves two kinds of change:
implementations of what the upstream RFC specifies, and extensions the RFC
never asked for. The PR must be the former only; the latter keep evolving
here and may become their own proposals later.

## The slice — implements the RFC, goes in the PR

| RFC item | What we built | Files |
|---|---|---|
| **B** — gap-closing tolerance | Seal ladder: scale-aware radii (`sealRadiiFor`), Manhattan distance-transform dilation, never-ascending growback, room-size + virtual-boundary gates; `gap_sealed_px` provenance | `web/src/lib/oneclick.ts` |
| **B-adjacent** — failure mode #2 ("unclosed door swings") | Curve marking (mask bit 4 from `SEG_CURVE`), LOCAL curve-transparent retry with grow-but-verify, leaf absorption for perimeter integrity, `door_wedges` provenance. **Note for the PR description:** "swing wedge included, measured to the wall plane" is a measurement-policy choice — call it out explicitly as a review point, with the flooring-practice rationale | `web/src/lib/oneclick.ts` |
| **D** — confidence + metadata | `traceConfidence`: transparent 0–1 score with named factors over engine signals; `virtualFrac` / `wedgeGrowth` surfaced on `FloodResult`; `origin.confidence` + `confidence_factors` | `web/src/lib/confidence.ts`, `web/src/lib/oneclick.ts` |
| **E** — scored benchmark corpus | Golden fixtures (synthetic truth-by-construction + pinned reviewed real-plan traces), rasterized-IoU scorer, gating runner reporting mean/floor IoU, refusal rate, leak rate, correct-refusal rate, per-probe confidence; **cross-resolution runs** (ws × 1/0.75/0.5) gated on verdict agreement + pairwise ring IoU at-or-above the determinism floor | `web/bench/**` |
| **C** — periodicity-based hatch classification | Per-stroke lattice evidence replaces the parallel-row run heuristic: a stroke is hatch iff same-pen overlapping neighbors sit at ±pitch both sides (lattice extending ±2 pitches; a clipped fill edge takes a 3-step one-sided lattice bounded within ONE pitch on the opposite side), gaps equal to raster precision, pitch ≤ the feet-true cap. Retires `HATCH_MIN_RUN` / `HATCH_PITCH_TOL` / `HATCH_MIN_REGULAR` / `HATCH_OVERLAP_FRAC` / `ROW_EPS` / `WIDE_PROTECT_RATIO` / `SPAN_PROTECT_RATIO` (pen width is family membership; pattern edges fail the lattice naturally). **Polyline-arc recognition** (`markPolylineArcs` + `SEG_POLYARC`): CAD-tessellated door swings — solid and dashed — are detected as circle geometry (chain → uniform turning → least-squares circle fit, with end-chord trim-retry so a joined stub can't kill an arc) and get the same `SEG_CURVE`/`MASK_CURVE_BIT` as bezier arcs. **Per-arc-cluster door retries**: each boundary arc opens independently with an allowance from its own bounding box (+ the 3-cell growback rim), so multi-door rooms keep every wedge and a curved wall's thin box can never admit the closet behind it. The escalation floor (`HATCH_ESCALATE_FRAC` 0.35 → 0.02) reflects the classifier's precision. **Known limitations, fixture-tracked as bench known-fails**: repetitive real architecture at sub-cap pitch (15" cubby banks) genuinely IS a lattice and annexes; a same-pen demising wall on a shared tile module merges; solid annotation rings (inset finish tags) bound the flood so rooms with them read to the ring, the band measurable only as its own click | `web/src/lib/oneclick.ts` |
| **Failure mode #3** — cross-resolution determinism | Feet-true thresholds through `MaskObj.mppf` (tiny/thin-region guards, seed nudge, hatch pitch cap — px behavior preserved bit-for-bit at the 18 px/ft calibration and as the scale-unknown fallback); the **minimum-passage rule** (`MIN_PASS_FT` / `minPassRadiusFor`: axis-aligned slits ≤ the threshold never connect, at any resolution — the Manhattan dilation reaches only ≈1/√2 of that across diagonal slits, a stable known anisotropy; the radius rounds to NEAREST, centering the ±1-cell quantization band on the threshold); `DETERMINISM_MIN_MPPF` honesty floor (8 px/ft, a pragmatic line: features within a cell of the threshold stay undecidable at ANY floor — vector-native topology, item A, is the real fix) + `coarse-mask` confidence factor. **Honest gate scope**: the bench cross-checks only cases with ≥2 resolutions at/above the floor and says so per-case — the VA plan at the production `MASK_MAX_DIM` has a single gated resolution, so its cross-resolution behavior is TRACKED (visible per-run numbers) but not gated | `web/src/lib/oneclick.ts`, `web/src/lib/confidence.ts`, `web/bench/run.mts` |
| **E follow-up** — callout cross-check | `bench/callouts.ts` (pure core) + `bench/callouts.mts` (`npm run bench:callouts`): parse the plan's own printed `NNN SF` area annotations, sweep a feet-true seed grid around each anchor, and report the modal region against what the drawing claims — with the nearby text that says what the callout annotates, and a seed-stability flag so a glyph-interior artifact can't enter an average. **Reports, never gates** (a callout may annotate a finish zone rather than a room's floor, so a disagreement is a question for a human, not a regression). Rationale: 12 of the corpus's 21 gating goldens are the engine's own reviewed traces, so the headline IoU is a self-consistency record; printed callouts are the one quantity on a plan the engine did not author | `web/bench/callouts.ts`, `web/bench/callouts.mts`, `web/test/callouts.test.ts` |
| **Batch/agent parity** — `detectRegions` | The tag-seeded batch detector ran the RAW `floodRegion`, so it measured with the pre-sealing engine (no seal ladder, no door wedges, no minimum-passage rule) while a click on the same room got all three: mean IoU 0.817 vs 0.999 on the VA plan's pinned probes, and 16.6% of sheet-wide proposed floor double-counted through unsealed doorways vs 0.0%. Now derives the scale-dependent parameters from `MaskObj.mppf` and calls `floodRegionSealed`, exactly like the click sites and the bench. Relevant to RFC item F, which builds on this path | `web/src/lib/detectRooms.ts`, `web/test/detectRooms.test.ts` |
| Engine fixes the work surfaced | Hatch pitch-run float-noise tolerance (corpus catch); dilated-seed ascent + deepest-cell retry seeding; region-bitmap semantics | `web/src/lib/oneclick.ts` |
| Tests for all of the above | Seal/wedge/curve suites, scorer + confidence tests, resolution-invariance suite | `web/test/geometry.test.ts` (additions), `web/test/confidence.test.ts`, `web/test/benchScore.test.ts`, `web/test/resolutionInvariance.test.ts` |

Plus a **minimal integration diff** for upstream's canvas: `floodRegion` →
`floodRegionSealed(..., sealRadiiFor(mppf), doorWedgeCapPx(mppf),
minPassRadiusFor(mppf))` at the click/probe sites, the sheet scale passed into
`buildMask` (with mask-cache eviction on recalibration), the new provenance
fields, and (optionally) the readout suffixes. Nothing else from our
`TakeoffCanvas.jsx` goes upstream.

**Measurement-policy note for the PR (like the wedge policy):** the
minimum-passage rule means a space reachable only through a sub-half-foot
drawn gap (annotation leader tips, drafting slits) is measured as its own
room, not annexed — that changed one pinned golden (`ward-room-294sf`, whose
old 294 SF trace annexed a vestibule through a leader-tip slit that flipped
with resolution; it is now two probes, room + vestibule, deterministic at
every scale — see `docs/evidence/one-click/va-plan-ward-room-repin-min-passage.png`).

**Second measurement-policy note (item C):** precise hatch classification
separates FINISH ZONES. A patterned floor area (a PT-tile toilet room, a
patterned flooring patch) is bounded by its pattern's own edge rows, so it
measures as its own click instead of merging with the adjacent room — the
old classifier merged `patient-room-137` with its toilet room only because
the toilet's dashed door arc misclassified as hatch. Six VA goldens were
deliberately re-pinned for this and for polyline-arc door unification, and a
dense-hatch toilet-room probe was added — see
`docs/evidence/one-click/va-plan-item-c-hatch-vs-arcs.png` and
`docs/evidence/one-click/va-plan-item-c-repins.png`. The round-8 adversarial
re-pin audit then corrected two of those re-pins: `patient-room-137` also
has a solid finish-tag ANNOTATION RING inset from its walls that the flood
cannot yet see past — the ~1–2 ft perimeter band is real carpeted floor,
pinned as its own probe (`patient-room-137-band`) plus a synthetic
known-fail carrying the wall-to-wall intent; and multi-door rooms now keep
every swing wedge via per-arc-cluster retries (`ward-vestibule` re-pinned
with its wedges). Adjacent rooms sharing an open doorway tile along the
shared swing arc with ~zero overlap; the arc line rather than the threshold
plane as the interface is a small known bias (threshold detection is an
open item).

## Fork extensions — NOT in the RFC, stay out of the PR

| Extension | Why it's ours | Files |
|---|---|---|
| **Auto-naming** (rooms label themselves from plan text) | The RFC's only text-layer use is item F, where room tags are *seeds for batch fill* — not labels. Labeling is our product idea; could pair with a future F implementation as its own proposal | `web/src/lib/roomName.ts`, `web/test/roomName.test.ts`, canvas wiring, `origin.auto_named` |
| **Live hover preview** | Pure UX layer over the engine; the RFC is engine-scoped | `ocLive*` in `web/src/pages/TakeoffCanvas.jsx` |
| **Fixture-sized hint** | UX papercut fix from our VA-plan testing | canvas readout + propose message |
| **Browser E2E harness** | App-level verification (drives OUR canvas); the RFC's corpus requirement is `bench/`, not this | `web/e2e/**` |
| **Evidence pack** | Fork record backing #184 | `docs/evidence/one-click/**` |
| **Doorway-transition auto-measure** | Our idea, needs design | #185 (unbuilt) |

## Entanglement audit (keep it this way)

- `oneclick.ts` imports nothing fork-specific ✓
- `confidence.ts` stands alone ✓
- `bench/` imports only `oneclick` / `confidence` / `geometry` / `score` / `callouts` (bench-local) ✓
- `detectRooms.ts` imports only `oneclick`; the engine never imports it ✓
- `roomName.ts` imports only `geometry`; the engine never imports it ✓
- The ONLY place slice and extensions meet is `TakeoffCanvas.jsx` call sites ✓

New slice code must not import extension modules (an engine file importing
`roomName.ts` would weld the PR shut). Run this check before assembling.

## Assembly plan (when we pull the trigger)

1. Fresh branch from `upstream/main`; apply the slice as **one commit per RFC
   item** (B, B-adjacent, D, E, fixes) for reviewability.
2. `oneclick.ts` shares history with upstream — the diff should apply near
   cleanly; `confidence.ts` and `bench/` are new files.
3. Verify upstream has the demo PDFs the pinned corpus cases reference
   (`demo/sample-plan.pdf`, `demo/sample-finish-plan.pdf`); re-pin or bundle
   fixtures if not.
4. Port the minimal canvas integration diff against *their* canvas.
5. PR description in the RFC's vocabulary — B/D/E headers, the bench
   scoreboard up front, the wedge measurement policy flagged for discussion,
   and the corpus-caught-a-live-bug story as the opener.
