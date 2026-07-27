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
| **E** — scored benchmark corpus | Golden fixtures (synthetic truth-by-construction + pinned reviewed real-plan traces), rasterized-IoU scorer, gating runner reporting mean/floor IoU, refusal rate, leak rate, correct-refusal rate, per-probe confidence | `web/bench/**` |
| Engine fixes the work surfaced | Hatch pitch-run float-noise tolerance (corpus catch); dilated-seed ascent + deepest-cell retry seeding; region-bitmap semantics | `web/src/lib/oneclick.ts` |
| Tests for all of the above | Seal/wedge/curve suites, scorer + confidence tests | `web/test/geometry.test.ts` (additions), `web/test/confidence.test.ts`, `web/test/benchScore.test.ts` |

Plus a **minimal integration diff** for upstream's canvas: `floodRegion` →
`floodRegionSealed(..., sealRadiiFor(mppf), doorWedgeCapPx(mppf))` at the
click/probe sites, the new provenance fields, and (optionally) the readout
suffixes. Nothing else from our `TakeoffCanvas.jsx` goes upstream.

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
- `bench/` imports only `oneclick` / `confidence` / `geometry` / `score` ✓
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
