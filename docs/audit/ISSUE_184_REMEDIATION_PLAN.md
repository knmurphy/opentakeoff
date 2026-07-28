# Issue #184 — remediation plan

Companion to [`ISSUE_184_AUDIT.md`](./ISSUE_184_AUDIT.md). Finding IDs (A1, B3, …) refer to
that document.

**Effort labels are rough relative sizing (S / M / L), not estimates.** Each phase instead
carries **exit criteria** — falsifiable checks that must exist and pass. Judge progress by
those, not by the labels.

---

## Sequencing rationale

Three constraints drive the order:

1. **The gates must work before the fixes land.** Every fix below is guarded by `bench` or
   `e2e`, and CI runs neither (B2). Fixing engine behaviour first means fixing it into a
   suite that cannot hold it. Phase 0 is therefore not optional prep — it is what makes the
   rest verifiable.
2. **Confidence gates item F upstream.** The issue's "next session starts at item F" is the
   one item of remaining work that should **not** start yet. Batch fill consumes confidence
   thresholds to decide which rooms to auto-accept; confidence currently scores 0.95–1.00 on
   the three worst known failure modes (A2). Building batch fill on top of that propagates
   the defect at scale, silently, across every room on a sheet. **Item F is blocked on Phase
   2.**
3. **Fix the human-truth guards before the first real answer key exists.** Once a human
   measures a plan and it is pinned through a leaky guard (C3, C4), the corruption is
   invisible and permanent. C3/C4 are small and must precede any real measurement work.

---

## Phase 0 — make the gates real

Nothing here changes engine behaviour. It changes whether we can tell when engine behaviour
changes.

| # | Task | Finding | Size |
|---|---|---|---|
| 0.1 | Add `bench`, `e2e`, `lint` to `.github/workflows/ci.yml`. Prefer invoking `npm run check` so the definition lives in one place. | B2 | S |
| 0.2 | Assert an expected probe count in `bench/run.mts`; fail on mismatch. A corpus that shrinks must go red, not green. | B4 | S |
| 0.3 | **Xpass detection**: a `knownFail` probe that now passes must fail the run with "known-fail now passes — re-pin or drop the flag". | B3 | S |
| 0.4 | Report known-fail probes in a separate always-printed block with their IoU and SF error, so `open-margin`'s live `NOT refused` and the two `LEAK` rows are visible in the summary rather than only in the per-probe stream. | B3 | S |
| 0.5 | Drop `maxLeakRate` or redefine it. As written it is unreachable — leak implies IoU < 0.5, which the 0.90 floor already catches. Reporting "0% leak" as evidence is misleading. | B5 | S |
| 0.6 | Label the refusal-rate denominator in output (`3 synthetic probes`), and make `correctRefusalRate` return `n/a` rather than `1` on an empty set. | B5 | S |
| 0.7 | Split the headline into two lines: `synthetic (independent truth): n=9 mean … floor …` and `engine-pinned (regression-only): n=12 …`. Never print a blended accuracy figure again. | B1 | S |

**Exit criteria**
- CI red on: a deleted corpus file, a known-fail that starts passing, an e2e regression, a
  lint error.
- `npm run bench` output states the independent/pinned split on its face.

---

## Phase 1 — the live product bug

**A1 is the only finding that is actively wrong for users today.** It ships in the current
build.

### 1.1 Decouple mask resolution from render scale (M)

The fix is exact, not a mitigation, because `buildMask` consumes **vector** segments
(`oneclick.ts:619`) — mask resolution is free, not limited by the render.

Today `ws = min(1, maxDim / max(imgW, imgH))`, so mask resolution tracks the rendered image,
which the Hi-Res toggle changes. Instead derive the target mask dimension from the page's
**point** size:

```
ws = clamp(mwTarget / imgW)        where mwTarget = f(pagePtW), capped by MASK_MAX_DIM
mppf = pxPerFt · ws
     = (rs · ptPerFt) · mwTarget / (pagePtW · rs)
     = ptPerFt · mwTarget / pagePtW          ← rs cancels exactly
```

`mppf` becomes a property of the sheet and its calibration, invariant under render scale.
Allow `ws > 1` (currently clamped): upsampling vector segments loses nothing, and the
`MASK_MAX_DIM` cap still bounds cost.

**Raster/scan path is different and must be handled separately.** `buildRasterMask` derives
the mask from the rendered image, so its resolution is genuinely tied to render scale and
cannot be decoupled. For that path: record the mask resolution in `origin`, and when a
sheet's render scale changes, mark existing raster-derived takeoffs as needing re-verification
rather than silently leaving them at a stale resolution.

### 1.2 Regression test (S)

Build masks for the same sheet at two render scales; assert identical `mppf` and identical
`floodRegionSealed` counts on the same seed. This is the test whose absence let A1 ship —
`resolutionInvariance.test.ts:123` asserts only that `ws` caps at 1.

### 1.3 Provenance (S)

Record `mppf` in `origin` for every trace. Without it there is no way to audit whether two
measurements of the same room were taken at the same resolution.

**Exit criteria**
- Toggling Hi-Res on a sub-cap sheet produces byte-identical masks and identical measured SF.
- The test in 1.2 fails if 1.1 is reverted.

---

## Phase 2 — confidence (RFC item D). Blocks item F.

The current score deducts for *which* inference ran, never *how far* it reached. That is why
a −35% measurement scores 1.00 and the badge disappears entirely.

### 2.1 Make deductions magnitude-scaled (M)

| signal | today | proposed |
|---|---|---|
| raster | flat ×0.90 | keep flat — genuinely binary |
| sealed | ×(1 − virtualFrac) | **keep** — this one is already magnitude-aware and is the model for the rest |
| hatch-filtered | flat ×0.95 | scale by escalation growth ratio against the 2.5× cap |
| door wedges | flat ×0.97 | scale by `wedgeGrowth` — **already plumbed at `confidence.ts:30` and simply never read** — and by wedge count against allowance consumed |
| min-passage | **absent** | **new factor** (2.2) |
| coarse mask | never fires on scans | fix by plumbing `mppf` through `buildRasterMask` (2.3) |

### 2.2 Disclose the primary seal path (M) — A3

`oneclick.ts:1031-1047` returns at `:1045` before the room-size cap (`:1067`), before the
≥75%-real-boundary rule (`:1068-1069`), and without setting `sealedPx`/`virtualFrac`. Three
changes:

- Set provenance on the min-passage path: a `min_pass_px` field alongside `gap_sealed_px`.
- Emit a confidence factor scaled by how much the dilation changed the result — compare the
  min-passage flood count against the raw flood count. On the repo's own 0.3 ft slit fixture
  that difference is 35.8%, and it currently reports `score 1.00, factors []`.
- Decide whether the two advertised gates should apply to this path (see Decision D-1).
- Surface it in the readout, as sealing already is.

Then correct `confidence.ts:5-6`, which defines 1.00 as "the plan's own vector linework,
verbatim" — a definition the min-passage path violates on every scaled sheet.

### 2.3 Plumb `mppf` into the raster path (S) — overlaps remaining-work item 2

`buildRasterMask` returns no `mppf` (`rastermask.ts:159`), so `confidence.ts:52` can never
fire on scans. The least trustworthy input currently takes the smallest deduction.

### 2.4 The gate that would have caught this (S)

Add to `bench/score.ts` a direct anti-correlation check:

> **No probe with IoU < 0.90 may report confidence > 0.90.**

This fails today on all three known-fails (0.650→1.00, 0.197→0.95, 0.497→0.95) and is the
single highest-value line in this plan: it converts "confidence is a review prioritizer" from
an assertion into a gated property.

### 2.5 Show the badge unconditionally (S)

`TakeoffCanvas.jsx:3178` renders only when `cf < 1`, so a wrong-but-confident trace shows
nothing at all. Show the score always, or show an explicit "verbatim" marker at 1.00 — the
absence of a badge currently reads as "no inference ran" when it may mean "inference ran and
wasn't measured".

### 2.6 Guard the exported API (S)

`traceConfidence({virtualFrac: NaN})` returns `NaN`. Unreachable from engine paths today, but
the function is exported.

**Exit criteria**
- The 2.4 gate is in CI and green — meaning every known-fail scores below 0.90.
- Reverting any magnitude scaling makes 2.4 fail.
- **Only then is item F unblocked.**

---

## Phase 3 — the two false "can never" claims

### 3.1 Curved-wall annexation (M) — A4

Two independent defects at `oneclick.ts:1111`:
- The bounding box is **axis-aligned**; a diagonal shallow arc gets a near-square box.
  Compute it in the arc's **chord frame** instead.
- The ceiling `2*wedgeCapPx` is a **constant ≈51 SF at any scale**. Make it feet-true and
  proportional to the arc's own radius — a door swing's area is bounded by its radius, so the
  allowance should be too.
- The `3*2*(bw+bh)` rim dominates the box term for thin arcs; re-derive it as a feet-true
  growback margin.

**Fixture**: the existing `curved-partition` passes trivially — its space-behind is >2× its
allowance. Add one at the guard's boundary, where space-behind is just under the allowance.
That is the case the reproduction found: 30 ft wall, 2.5 ft bulge, +50 SF annexed at conf
0.97 with no door in the scene.

### 3.2 Arc semantics — make the cloud refusal a detection property (L) — A5

Today `markPolylineArcs` marks clouds 37/42, columns 24/24, callouts 16/16, elbows 6/6. The
"clouds are correctly refused" claim rests entirely on a downstream growth allowance and is
one arithmetic change from breaking.

Four discriminators, cheap and testable, roughly in order of value:

1. **Reject closed circles** (sweep ≳ 300°) — kills columns, callouts, north arrows outright.
2. **Feet-true radius band.** A door leaf is ~2–6 ft. Kills large millwork and duct elbows,
   and small cloud scallops. Requires `mppf`, so it applies only on scaled sheets — state
   that limit rather than hiding it.
3. **Cusp-chain rejection.** A cloud scallop chains into another arc of similar radius with a
   sign reversal at the cusp. That is the cloud signature and nothing else has it.
4. **Hinge attachment.** A door swing terminates at hard linework at the hinge and usually
   pairs with a leaf. Highest value, most work.

Land 1–3 first; they are small and remove most of the false-positive surface.

### 3.3 Wedge budget starvation (S) — A5

`clusters.slice(0, WEDGE_MAX_DOORS)` takes clusters in **scanline order**, so curved
fixtures can consume the entire budget before real doors are reached, silently
under-measuring ~5–10 SF per lost wedge. Rank clusters by door-likelihood (3.2's score) rather
than position, and record when the budget truncates.

### 3.4 Honest thresholds (S)

`oneclick.ts:117-118` claims arc thresholds are "DIMENSIONLESS … resolution- and scale-free".
`:318` and `:425` are absolute image-px. Either make them scale-relative or correct the
comment.

**Exit criteria**
- A fixture for each of: curved wall with no door, revision cloud, round column, room with
  curved fixtures + one real door. All must measure correctly *without* relying on the growth
  allowance.
- 3.1's boundary fixture fails if the chord-frame box is reverted.

---

## Phase 4 — truth

### 4.1 Fix the human guards before any real measurement (S) — C3, C4

- `from-takeoff.mts:183` sets `humanMeasured: true` **unconditionally**. Set it only when no
  probe carries `machine-origin`.
- `:117` treats a missing `origin` as human. **Reject** shapes with absent provenance — the
  repo's own policy already says so (`CHANGELOG.md:36`).
- Validate the input payload against a schema rather than bare `JSON.parse`.

These are small and must land before the first human key, or the corruption is permanent and
invisible.

### 4.2 Correct the coverage claim, in code and prose (S) — C2

`score.ts:88-103` sums golden and engine over the **same rows**, so floor in no probe is
absent from both and the ratio stays 1.000. Either:
- **(a)** implement what was claimed — compare against a case-level total floor area the human
  supplies independently of the probe list; or
- **(b)** correct `score.ts:84-86`, `run.mts:83-84` and the issue comment to say the ±2% check
  is a tighter aggregate band, not structural coverage.

**(a) is the honest version and is what would actually catch the 78 SF class.** Recommend (a),
with (b) as the immediate correction regardless.

### 4.3 Sealed protocol (S) — C6

- `run.mts:104` truthiness → exact `=== "1"`.
- Gitignore `bench/corpus/sealed/`.
- Do not write sealed goldens into `results.json`; one run currently leaves the full answer
  key on disk.
- Accept that run-once is discipline, or enforce it with a committed ledger. Say which in the
  doc — currently it reads as enforced.

### 4.4 Seed independence (M) — C5

`interiorSeed` picks maximum boundary clearance — systematically the engine's easiest case,
erasing the near-wall / in-hatch / doorway-adjacent seed classes the hand-built corpus
deliberately probes. Prefer the human's **actual click** where the export carries it; where it
does not, sample several seeds per room and require agreement. Also fix the latent
outside-the-polygon return.

### 4.5 Deducts vs outer-contour (M) — C7

`from-takeoff.mts:115` subtracts deducts from the golden while `traceRegion` returns the outer
contour only, so any plan with >2% deducted floor fails the ±2% gate for a non-engine reason.
Either subtract interior islands from the engine area or exclude deducts from the comparison —
and state which semantics the answer key uses.

### 4.6 Get real plans measured (L — needs you)

**This is the long pole and it is not an engineering task.** The audit's central finding is
that 57% of the accuracy headline is the engine graded against its own output, and that no
human-authored truth exists at all. Every gate in 4.1–4.5 is dead code until this happens.

Per the round-9 comment: 2–3 measured plans in different drafting styles, plus one held
sealed. **Different firms matter more than more sheets from one firm** — every failure mode
the audit found was style-dependent.

---

## Phase 5 — determinism, honestly

### 5.1 Replace ring-IoU with SF error in the cross gate (S) — B7

IoU ≥ 0.90 admits −10.0%/+11.1% area disagreement — 4× looser than the repo's own 2.5% human
SF gate, on the same quantity. Gate `|SF_a − SF_b| / SF ≤ 0.025` directly. Costs nothing and
measures what the product sells.

### 5.2 Say plainly that no real plan is cross-checked (S) — B6

All 9 VA probes are excluded; the headline `pair-IoU floor 0.962` describes synthetic
rectangles and a 891-byte generated PDF.

### 5.3 Decide what to do about the floor (M) — B6, Decision D-2

`ward-room-294sf` reads −52.6% at ×0.75. The floor moved 6 → 8 between `2730050` and
`92c1242`, and the VA ×0.75 run at 6.696 px/ft sits between them. The min-passage rule did not
make the real plan resolution-stable; the floor relocated the instability below the gate.

Options: raise production mask resolution so the flagship plan clears the floor with margin
(it currently sits 11.6% above it); or accept the instability and gate it explicitly as a
tracked known-fail with its magnitude stated. **What is not acceptable is the current state,
where it is neither fixed nor visible.**

### 5.4 Feet-true the remaining hardcoded px (M) — D13

`dt > 3` in `virtualBoundaryFrac` (`:1183`), the cluster bridge radius (`:956`), the growback
rim (`:1111`) are mask px, so the ≥75% gate physically tightens and dashed-arc bridging
degrades as `mppf` rises — contradicting the feet-true story for the entire sealing/wedge
path. Also note the px **floors** dominate at the VA plan's production 8.929 px/ft (`nudge` is
3 px = 4", **3× the feet-true 2"**).

### 5.5 Fix or retract "bit-identical … regression-tested" (S) — D14 / audit §3

The arithmetic is correct but the test compares one `floodRegion` count on a hatch-free scene
— it cannot observe `HATCH_MAX_PITCH_FT` bit-identity at all. Either compare masks bitwise at
the four constants' decision boundaries, or soften the claim.

---

## Phase 6 — the record

Cheap, and the audit's most numerous findings. Do it in one pass.

| # | Task | Finding |
|---|---|---|
| 6.1 | Correct "3 probes cover the full floor" — it is short by ~21 SF (161.4 + 19.0 + 39.2 = 219.6 vs 240.8) | D1 |
| 6.2 | Correct the band figure: **19.0 SF**, not 20.8 | D2 |
| 6.3 | **Explicitly retract** round 4's "toilet correctly excluded / 249.3 SF" — round 8 contradicts it and it still stands | D3 |
| 6.4 | Correct the test counts (837 → 835 at `2ea5487`; 847 → 843 at `7605315`) | D4 |
| 6.5 | Repoint the evidence index and slice-doc links at the branch that actually holds rounds 7–8 evidence; fix the two malformed image links | D5 |
| 6.6 | Retract or annotate: corridor "1,718 SF" (never a pinned value), the 0.04 SF overlap (now 0.02), the vestibule "recovery" that overshoots its baseline by 30.8%, the sample-plan total | D9 |
| 6.7 | Rename `ward-room-294sf` — it measures 229.3 and the 294 was retracted as a raster accident | D9 |
| 6.8 | Downgrade "four independent reviewers" to what the artifacts support; note that 2 of 5 repros became regression tests | D6, D7 |
| 6.9 | Either commit a perf harness or mark "23 s → 0.39 s", "~285 ms", "37,048 of 71,819", the seed sweep, and the 0.56 ft / 0.42 ft figures as unrepeated one-off measurements | D8 |
| 6.10 | Replace the quoted RFC paraphrase with the actual sentence; either vendor the RFC text or stop attributing claims to it | D10 |
| 6.11 | Update the body for `7605315` and `21e57a0`, and add the engine-pinned caveat wherever 0.991/0.957 appears | D12, B1 |
| 6.12 | Add the missing regression test for the O(N²) lattice fix, or state that it is unguarded | D7 |
| 6.13 | Fix the e2e header comments, which document the opposite contract | D16 |
| 6.14 | Correct the entanglement audit: `confidence.ts:22` does import from `./oneclick`; add `geometry.js` to the slice table; classify `7605315`'s files; either write the check line 80 promises or drop it | D14 |

---

## Also, unscheduled

- **A6 — MCP divergence (M).** `mcp/src/session.ts:341` calls `floodRegion`, not
  `floodRegionSealed`, with no `pxPerFt` and no confidence. It must call the same engine or
  stop reporting `origin.method: "one_click_v1"`. Right now provenance cannot distinguish two
  materially different measurements. Same gap in `detectRegions` (`detectRooms.ts:83`), which
  also affects batch fill — **fold this into item F when it unblocks**.
- **A7 — escalation floor (M).** The 0.02 floor's only bound is a 2.5× cap, which passes a
  clean 2.0× two-room merge at conf 0.95. `softFrac` counts blocking encounters with
  duplicates during the scanline walk, so it is neither feet-true nor order-independent —
  making the escalate verdict itself resolution-sensitive.
- **A8 — hover perf (M).** ~1 s blocked main thread and ~119 MB churn per room hovered, from
  `mo.mask.slice()` per cluster defeating the `sealCache` WeakMap. User-visible on the
  interactive path.
- **D16 — `roomName.ts:79`** returns a bare number line as a room name, so a keynote "213"
  becomes the label.
- **The `fflate` dynamic-import build failure** — seen once, not reproduced. Worth a look
  before it is seen in CI.

---

## Decisions needed

- **D-1.** Should the room-size cap and the ≥75%-real-boundary rule apply to the min-passage
  primary path? Applying them is more conservative and matches what the issue already claims;
  it may also refuse rooms that currently measure fine. My recommendation: apply them, and let
  the corpus show what it costs.
- **D-2.** Phase 5.3 — raise production mask resolution, or accept and explicitly gate the
  real-plan instability?
- **D-3.** Does the audit go on the public record as a comment on #184? It is currently a
  branch doc only.
- **D-4.** Phase 4.2 — implement independent case-level truth (a), or correct the claim (b)?
  Recommend (a) eventually, (b) immediately.

---

## What this plan does not fix

- **Annotation semantics** (`annotation-ring-room`, IoU 0.650), the **partition-bank** and
  **tile-demising** pitch ambiguities. The audit agrees with the issue's own assessment: these
  need richer semantics than a raster classifier has, and **RFC item A (vector-native face
  extraction) is the real fix**. Nothing here changes that. What Phase 2.4 does change is that
  they will at least *report* low confidence instead of 0.95–1.00.
- **Any claim resting on visual verification.** No auditor could check a browser measurement,
  and D3 shows at least one "verified visually" claim was wrong. Treat the remaining ones as
  unverified until a human key exists (4.6).
