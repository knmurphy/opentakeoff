# Top-3 bench hardening: seed instability, scorer mutation tests, human-SF gate rows

Branch: `docs/corpus-vet` (worktree /tmp/ot-corpus-doc), on top of `95ceefd`.
Evidence base: `docs/evidence/one-click/va-corridor-handmeasure.json`; fresh probe run 2026-07-28 (production rings, `oneClickRing` snapped, factor 1 mppf 8.93, gated; ×0.75/×0.5 sub-DETERMINISM floor → cross-res ungated on this case).

## Task 1 — encode seed instability (VA plan, T1 corridor)

Measured: T1 "connecting corridor" (printed 270 SF, hand 271.8):
- seed [2023,1078] → 158.1 SF, conf 0.990, signals {wedges 1, wedgeGrowth 1.002, curveFrac 0.008, minPassDelta 0.146, areaSF 158.1, mppf 8.9}
- seed [1879,1078] (same corridor, ~8 ft away) → 1525.8 SF, conf 1.000, signals {areaSF 1525.8, mppf 8.9} only — leak through openings, zero engine-internal signal
- (also observed: [1951,1078] → 41.8 SF fragment, conf 0.93 — documented in prose, NOT added as a probe, to avoid a second exemption; the a/b pair already encodes the 10× disagreement)

Changes:
1. `web/bench/corpus/va-finish-plan.json`: two new probes, both `shapeClass: "corridor"`:
   - `t1-corridor` seed [2023,1078], golden = its own snapped 12-vert ring (pinned; regression-only like every probe on this case), tags ["corridor","seed-instability"].
   - `t1-corridor-adjacent-seed` seed [1879,1078], `knownFail: true`, golden = the SAME ring as `t1-corridor`, tags ["corridor","seed-instability","known-limit"]. Scores LEAK (1525.8 vs 158.1 SF, IoU ≈ 0.10) — the tracked known-fail IS the disagreement: two seeds in one corridor, 10× apart. Probe-level adjudication note records the convention (golden authored as the adjacent seed's region) and the hand-measure context.
2. `web/bench/score.ts`: `CONF_GATE_EXEMPT["va-finish-plan/t1-corridor-adjacent-seed"]` with `xfailAbove: 0.90`, reason naming all 8 signals as measured (raster false, hatchFiltered false, wedges undefined, wedgeGrowth undefined, curveFrac undefined, minPassDelta undefined, areaSF 1525.8, mppf 8.9) + "XFAIL DIRECTION". Same class as corridor-open-ends: flood exits through genuinely open mouths, needs item A.
3. `web/test/benchScore.test.ts`: exemption-key bound 4 → 5.
4. `web/bench/run.mts`: EXPECT → `{ goldenProbes: 24, refusalProbes: 3, knownFails: 6, cases: 2 }`.

Risk checked: probe A enters the accurate population at conf 0.99 ≥ floorAbs 0.88 — passes. Probe A's corridor region does not overlap the existing room probes (coverage overlap gate) — verified by bench run before commit. knownFail probe is excluded from coverage rows and cross/aggregate by existing code.

## Task 2 — scorer mutation test + independent cross-check (`web/test/benchScore.test.ts` only)

1. Independent analytic IoU for axis-aligned rect pairs (pure arithmetic intersection/union, no rasterization, coded inline in the test): compare `polyIoU` within tolerance 0.01 on: identical, half-overlap, disjoint, containment.
2. `ringAreaAbs` cross-checked against an independently written shoelace on a concave polygon and a rect (exact equality on integer coords).
3. Vertex-mutation: square (0,0)-(100,100); pull corner (100,100) → (100+d,100+d). Mutated quad ⊇ square, so analytic IoU = 10⁴/shoelace(mutated). d=1 → 0.9901, d=5 → 0.9524. Assert `polyIoU` within ±0.01 of analytic and strictly decreasing in d. This is the "does the scorer actually move when the ring is wrong by a known amount" mutation check.

No production code changes.

## Task 3 — human-measured SF gate rows (first independent human truth in the gates)

Constraint discovered: NO hand polygons exist — the campaign recorded SF only. `from-takeoff.mts` (polygon-golden path) therefore CANNOT be used without fabricating geometry, which its independence guard exists to forbid. Design: SF-only human rows. **Deviation from handoff plan** ("EXPECT.cases 2→3"): no new case file; rows attach to the existing `va-finish-plan` case. Remediation Phase-4 *interim criterion* (prove the gates fire) is satisfied by a unit test on the pure gate function.

1. `web/bench/score.ts`: pure `humanSfGate(rows, maxErr)` where row = `{ probe, handSF, engineSF (null = no trace), knownFail? }` → failures:
   - !knownFail && (engineSF null || |engine−hand|/hand > maxErr) → gate failure
   - knownFail && engineSF != null && err ≤ maxErr → "now passes — re-pin" (xpass, loud)
2. `web/bench/corpus/va-finish-plan.json`: `humanSfProbes` array:
   - `CE-4-corridor` seed [4030,858], hand_sf 248.6 → engine 235.3 (−5.3%), knownFail
   - `CE-5-corridor` seed [4064,2437], hand_sf 563.8 → engine 624.2 (+10.7%), knownFail
   - each with `source` pointing at the hand-measure evidence file + date.
3. `web/bench/run.mts`: after pinned-case loop, flood+snap each humanSf seed at factor 1, print a "human-measured SF (hand truth, SF-only)" block, push `humanSfGate(rows, THRESHOLDS.humanMaxSfErr).failures`, add `EXPECT.humanSfProbes: 2` + count check, include block in results.json.
4. `web/test/benchScore.test.ts`: humanSfGate fires at 3.0% error, passes at 2.0%, fails on missing trace, xpass fires when a knownFail row lands inside the band.
5. Docs: `web/bench/README.md` (new section: SF-only human truth; polygon-golden human case still open — remediation Phase 4), `CHANGELOG.md`, slice doc note.

## Verification
`cd /tmp/ot-corpus-doc/web && npm run check` green; bench output shows: 24 gating goldens, 6 known-fails all still failing, 5 exemptions each with direction, human-SF block with both rows outside the 2.5% band and marked known-fail. Delete `bench/tmp-seedprobe.mts` before commit.

## Adversarial review — response ledger (3 reviewer subagents, 2026-07-28)

| # | Finding (severity) | Response |
|---|---|---|
| 1 | pin-goldens.mts re-pin silently deletes new probes + humanSfProbes (BLOCKER, BenchMechanics + UpstreamMaintainer) | FIXED: `t1-corridor` added to PINNED; `seedPairs`/`humanSfProbes` carried through from `prior` in the output object with a hand-authored-fields comment. |
| 2 | Task 1 golden launders the adjacent seed's engine region as truth; blind spot on converge-to-truth; forces a 5th CONF_GATE exemption (MAJOR, Metrology + UpstreamMaintainer) | REDESIGNED as proposed: knownFail golden probe + exemption DROPPED; disagreement encoded symmetrically as `seedPairs` SF-ratio row (9.65×, xpass < 1.5×) via pure `seedPairGate`. Exemption list stays at 4. EXPECT.knownFails stays 5. |
| 3 | Human-SF gate is a centerline-vs-wall-to-wall category error; both rows knownFail → gate inert; "human truth in the gates" overstates (BLOCKER/MAJOR, Metrology) | ACCEPTED: rows relabeled "convention-unmatched reference rows, xpass-only, not binding" everywhere (score.ts docs, run.mts banner, bench README, slice doc, CHANGELOG). CE-5's +10.7% documented as convention-compatible; CE-4's −5.3% as a convention-understated genuine undercount. Binding deferred to a centerline-measured human row. |
| 4 | Broken evidence chain: handmeasure.json engine column (229/606, modal) contradicts encoded 235.3/624.2 (snapped) (MAJOR, UpstreamMaintainer) | FIXED: `engine_snapped_sf` columns added to CE-4/CE-5/T1 rows with a note distinguishing modal (un-snapped, callout harness) from production (snapped) quantities; humanSfProbes `source` states the measurement date/path. |
| 5 | d=1 mutation tolerance 0.01 passes a stuck-at-1.0 scorer (MINOR, Metrology) | FIXED: d=1 held to ±0.005 (stuck scorer misses by 0.0099 → fails); exact equality asserted on integer-aligned rect cases; monotonicity kept. |
| 6 | README bullets/counts go stale (12→13 pinned, 12-of-23→13-of-24, "no case feeds them") (MINOR, UpstreamMaintainer) | FIXED: bucket table + Honest-limits rewritten; "real error, not a convention" claim re-derived at both magnitudes (modal −37.5% ≫ convention; CE-4/CE-5 5–11% convention-dominated). |
| 7 | Dead ISSUE_184_REMEDIATION_PLAN.md citations (MINOR, UpstreamMaintainer) | FIXED: shipped docs justify the SF-only deviation on its own merits (no hand polygons; from-takeoff independence guard); no dead citations added. |
| 8 | humanSfProbes count check placement trap; exemption-test is a literal array (MINORs, BenchMechanics) | Handled: counts accumulate globally with `?? []`, checked post-loop; no exemption-test change needed after redesign (#2). |
| 9 | cloud-corridor overlap with t1-corridor (NIT, BenchMechanics) | Verified empirically: bench overlap 0.00 SF (0.000%), gate 0.5%. |

Outcome: EXPECT = { goldenProbes: 24, refusalProbes: 3, knownFails: 5, cases: 2, humanSfRows: 2, seedPairs: 1 }; bench green.
