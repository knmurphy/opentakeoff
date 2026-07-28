# Issue #184 audit — One-Click Area work, rounds 1–8 + answer-key pipeline

**Audited at** `21e57a0` (`claude/issue-184-hatch-periodicity-fduafy`), 2026-07-28.
**Method:** six independent auditors, each briefed to refute one pillar: bench/corpus
integrity, verification state, engine correctness, claims-vs-evidence trail, determinism
math, answer-key pipeline. Findings below were reproduced by execution — bench runs, unit
suite runs, fix-reverts, synthetic counterexample scenes, and shoelace recomputation of
every pinned golden across commit history — not by reading prose.

**Scope note.** No auditor exercised a real PDF beyond the two committed fixtures, and no
auditor could verify any "verified visually" browser claim. Those remain unaudited.

**Correction (post-audit).** Two errors in this document, found by adversarial review of the
remediation plan and fixed in place below: the confidence readout is at
`TakeoffCanvas.jsx:3168`, not `:3178`; and `origin.confidence` *is* always persisted
(`:3034`), so "the estimator sees no flag at all" in A2 applies to the **live hover readout**,
not to provenance.

**Scope gap (post-audit).** This audit covers rounds 1–8 plus `7605315`. **Round 9
(`5100108769`, branch `claude/research-prioritization-gm6w75`) postdates it and was missed.**
Round 9 independently confirms B1 (12 of 21 goldens engine-pinned, 0 human) and C1 (the three
gates inert), quantifies A6 at **560 SF double-counted, 16.6%**, softens the round-8 "not
fixable by caps" claim (`partition-bank-15in` recovers IoU 0.197 → 0.937 at a 1.0–1.1 ft
cap), and adds the first independent truth signal in the project: the VA plan's own 9 printed
`NNN SF` callouts, against which the engine reads +11.1% to −43.8%. See the remediation plan's
Scope section.

---

## What holds up

Stated first because the failures below are meaningless without it. These were attacked and
survived:

- **Every headline number in the issue reproduces exactly.** `npm run bench` prints 21
  golden probes, mean IoU 0.991, floor 0.957, 0%/0% refusal/leak, 100% correct refusals,
  4 known-fails, cross-gate 16 probes / 0 flips / pair-IoU floor 0.962 / 9 not
  cross-checked. Nothing is fabricated. Both fixture PDFs are tracked and not gitignored.
- **`npm test` 843/843, typecheck, lint, build all green.** E2E is genuinely 14/14 in real
  Chromium, with 14 `check()` calls matching the claim exactly.
- **The E2E oracle is independent, not circular.** The 120 SF truth comes from a 216×180 pt
  rectangle at a hand-declared 18 pt/ft in `make-fixture.cjs` — arithmetic done by a human,
  never by the engine. The scale is parsed from a title-block string the engine must read.
- **The 1/√2 diagonal anisotropy is exactly right**, and right for the right reason: the L1
  ball's support function gives closure at `2r·max(|nx|,|ny|)`, verified both analytically
  and discretely on the staircase.
- **The `DETERMINISM_MIN_MPPF` retraction was fully propagated.** `oneclick.ts:108` is a
  literal `8`; `:92-107` says "a PRAGMATIC CHOICE, not a derivation"; the slice doc agrees;
  grep finds zero surviving assertions of the old derivation. This is the model of how a
  retraction should land.
- **The bit-identity arithmetic checks out** — 0 differing mask cells between
  `buildMask(..., meta)` and `buildMask(..., 18)`, including through `classifyHatchSegs`.
- **The seven named hatch knobs are genuinely gone** from the entire repo.
- **Two of five round-8 reviewer repros are honest regression tests** — reverting the fix
  makes them fail (confirmed by actual revert).
- **The retractions against interest are real.** The vacuous cross-resolution gate, the −33%
  patient-room regression, and the "derived" determinism floor were all retracted by the
  author against their own prior claims. That is genuine evidence of adversarial pressure.

---

## A. Silently wrong measurements (the dangerous class)

### A1 — CRITICAL: the same click returns different square footage depending on a UI toggle

The claim *"production is stable because `MASK_MAX_DIM` pins each sheet to one resolution"*
is **wrong**. `MASK_MAX_DIM` is a cap, not a pin (`oneclick.ts:620`: `ws = min(1,
maxDim/max(imgW,imgH))`). On any sheet rendering under 3000 px — every 11×17 half-size set,
8.5×11, ARCH-A/B, letter detail — `ws = 1` and mask resolution follows the *render* scale.

The **"Hi-Res render (this sheet)"** menu item (`TakeoffCanvas.jsx:5098` → `toggleHiRes`
`:706-713` → render effect deps `:1265` → `maskCacheRef.current.clear()` `:1141`) changes
that render scale, and `hiResKeys` is persisted per-user in
`localStorage["opentakeoff_hires"]`.

Simulated on an 11×17 (792×1224 pt) at 1/8" = 1'-0", using the repo's own slit scene:

```
Hi-Res OFF   rs 2.000   img 1584×2448   mppf 18.00   slit 0.60–0.63 ft →  97.8 SF
Hi-Res ON    rs 5.374   img 4257×6579   mppf 22.06   slit 0.60–0.63 ft → 134.0 SF   (+37.0%)
```

Both resolutions sit far above the 8 px/ft honesty floor, so nothing flags it. Outside the
flip band the same room still drifts 0.8% from the toggle alone. **Two estimators on the
same project file get different square footage from the same click, with no indication
why.**

Other resolution paths were checked and cleared: zoom touches only the detail-view overlay,
resize is transform-only, recalibration evicts the mask but preserves `dims`, group change
leaves `rs` a pure function of page point-size. Hi-Res is the one hole — and it is enough.

The honest statement: *the working raster is pinned per sheet only when the render exceeds
`MASK_MAX_DIM`; below the cap it follows render scale, which the Hi-Res toggle changes.*

### A2 — CRITICAL: confidence scores 0.95–1.00 on the three worst known failure modes

RFC item D is marked shipped. The branch's own bench output is the refutation:

```
annotation-ring-room / center      IoU 0.650  SF±35.0%        conf 1.00  [known-fail]
partition-bank-15in / mid-bay      IoU 0.197  SF±384.2% LEAK  conf 0.95  [known-fail]
tile-demising-same-pen / room-a    IoU 0.497  SF±97.4%  LEAK  conf 0.95  [known-fail]
```

A −35% measurement scores **1.00**, and `TakeoffCanvas.jsx:3168` appends it to the hover readout only when
`cf < 1` — so the estimator sees *no flag at all*. A +384% error scores 0.95, visually
indistinguishable from the 0.97 a correct door-swing trace earns.

The cause is structural: the score deducts for *which inference ran*, never for *how far it
reached*. `hatchFiltered` is a flat ×0.95 whether escalation grew the region 1.01× or 2.49×.
As a review prioritizer it is anti-correlated with error on exactly the cases that matter,
and nothing in `bench/score.ts` gates confidence against IoU, so this is untested.

Three sub-defects in `confidence.ts:41-53`:
- **`wedgeGrowth` is accepted and never read** (`:30` declares it, `:41-53` ignores it) —
  and no caller supplies it either (`TakeoffCanvas.jsx:2887`, `:3147`, `:3994`,
  `bench/run.mts:63` all omit it), so wiring it up is plumbing at four sites, not a one-line
  read. The issue lists "wedge growth" as a folded signal.
  `traceConfidence({wedges:1, wedgeGrowth:1.01})` and `({wedges:12, wedgeGrowth:2.49})` both
  return 0.97.
- **The coarse-mask deduction can never fire on scans** — `buildRasterMask` returns no
  `mppf` (`rastermask.ts:159`), and `:52` requires `mppf > 0`. The least trustworthy path
  gets only ×0.90.
- **The min-passage rule is invisible to the score** (see A3).

### A3 — HIGH: the primary sealing path bypasses both advertised gates and all provenance

The issue advertises sealing as *"guarded by a room-size cap and a ≥75%-real-boundary
rule"*, with provenance `gap_sealed_px`. But when `minPassPx > 0` — always, on any scaled
sheet — the **primary** flood runs against dilated walls and returns at `oneclick.ts:1045`,
*before* the room-size cap (`:1067`), *before* the ≥75% rule (`:1068-1069`), and without
setting `sealedPx`/`virtualFrac` (`:1070-1071`).

Reproduced: a room that genuinely leaks through a 0.44 ft slot becomes a confidently bounded
205.4 SF room with `sealedPx=undefined`, `confidence 1.00`, `factors []`. No "sealed a small
opening" readout, no `gap_sealed_px`, no deduction, neither advertised gate run. Measured
separately, the rule changes results by **35.8%** on the repo's own 0.3 ft slit fixture while
reporting a score whose own definition (`confidence.ts:5-6`) is *"the boundary is the plan's
own vector linework, verbatim."*

It cuts both ways: a real 6" pass-through or chase opening is silently severed.

### A4 — HIGH: "a curved wall's thin box can never admit the closet behind it" is false

Reproduced with no door anywhere in the scene — a 30 ft curved wall with a 2.5 ft bulge
(R ≈ 46 ft, an ordinary curved corridor wall), tessellated as 12 chords:

```
markPolylineArcs: marked=12 (detected as an arc)
ring area 365.8 SF → 415.8 SF   (+50.0 SF, +13.7%)
confidence: {"score":0.97, "factors":["door-swing-crossed"]}
```

The entire 50 SF space behind the curved wall is annexed, reported at 97%, labelled "incl.
door swing", stamped `origin.door_wedges: 1`.

Two independent defects in `oneclick.ts:1111`: the bounding box is **axis-aligned**, not
chord-oriented, so a diagonal shallow arc gets a near-square box; and the ceiling
`2*wedgeCapPx` is a **constant ≈51 SF at any scale**, so any arc whose box exceeds ~40 ft²
gets a flat 51 SF allowance no matter how thin it is. The `3*2*(bw+bh)` rim also *dominates*
the box term for genuinely thin arcs — long-and-thin does not mean small.

The bench's `curved-partition` fixture never tests this: its space-behind (~17,000 cells) is
>2× its arc's allowance (~7,500), so the guard passes trivially. **The fixture does not probe
the guard's boundary.**

### A5 — HIGH: `markPolylineArcs` marks clouds, columns, callouts and elbows as door arcs

Measured chord-marking rates:

| geometry | marked SEG_CURVE |
|---|---|
| revision cloud, 6 scallops | **37 / 42** |
| detail callout bubble | **16 / 16** |
| round column | **24 / 24** |
| duct/pipe elbow 90° | **6 / 6** |
| curved millwork | **10 / 10** |
| north-arrow circle | **12 / 12** |
| ellipse fixture 1.35:1 | 0 / 20 ✓ |

Only the ellipse case in the issue's stated list actually holds. Each cloud scallop is a
clean circular arc with consistent turn sign, ≥4 chords and >30° sweep.

**The "clouds are correctly refused" claim is therefore entirely a property of the downstream
growth allowance, not of `markPolylineArcs`.** A cloud drawn tight against a wall, where
opening one scallop yields ≤51 SF of growth, would be accepted. That refusal — presented in
round 4 as a verified detection property — is one allowance-arithmetic change from breaking.

Consequence: a plain rectangular room with one round column and **no doors** returns
`wedges=1`, conf 0.97, "incl. door swing". A room with 15 round fixtures consumes the entire
`WEDGE_MAX_DOORS` budget in scanline order — so **a room with several curved fixtures can
starve its real door wedges, silently under-measuring ~5–10 SF per lost wedge**.

Also, `oneclick.ts:117-118` claims arc thresholds are "DIMENSIONLESS … resolution- and
scale-free". False: `:318` (`len < 0.5`) and `:425` (`tol = max(0.75, r*FRAC)`) are absolute
image-px, and `markPolylineArcs` runs before any `ws` scaling. At r ≈ 5–25 px the 0.75 px
floor is a 3–15% residual tolerance, far looser than the advertised 3%.

### A6 — MEDIUM: the MCP surface measures `one_click` with a different, older engine

`mcp/src/session.ts:246` calls `buildMask` **without** `pxPerFt` → `mppf = 0` → every guard
falls back to px. `:341` calls `floodRegion`, not `floodRegionSealed` — no sealing, no
minimum-passage rule, no door wedges, no `traceConfidence` anywhere in the file.
`detectRegions` (`detectRooms.ts:83`) has the same gap on both surfaces.

**An MCP `one_click` and a canvas One-Click on the same seed return different square footage
under the same name and the same `origin.method: "one_click_v1"`.** Provenance cannot
distinguish them.

### A7 — MEDIUM: escalation floor 0.02 permits a full two-room merge

The moderate band widened 17×. The only gate is `r2.count <= r1.count * 2.5`
(`oneclick.ts:746-752`) — **a 2.0× merge of two equal rooms passes cleanly**, reported at
conf 0.95. `softFrac` is computed from blocking *encounters* counted with duplicates during
the scanline walk (`:687,690,701,706`), not distinct boundary cells — so it is neither
feet-true nor traversal-order-independent, making the escalate verdict itself
resolution-sensitive at a 0.02 threshold.

### A8 — MEDIUM: the per-arc retry blocks the hover path for ~1 s and churns ~119 MB

`oneclick.ts:1114` allocates `mo.mask.slice()` per cluster per call, so the `sealCache`
WeakMap (`:804`) never hits and `hardDT` (2 passes over 9M cells) recomputes for every
cluster. Measured on a 3000×3000 mask, 6-door room:

```
floodRegionSealed: 1014 ms cold / 726 ms warm     plain floodRegion: 9.7 ms     external: 119 MB
```

This runs on the **hover** path once per rAF on entering a new region
(`TakeoffCanvas.jsx:3130`) — ~75× the plain flood, ~0.7–1 s of blocked main thread per room
hovered.

---

## B. The measurement of the measurements

### B1 — HIGH: 57% of the headline accuracy number is the engine grading itself

| bucket | probes | mean IoU |
|---|---|---|
| synthetic, truth-by-construction (`bench/corpus.ts`) | **9** | **0.9785** |
| engine-pinned real-plan (`corpus/*.json`) | **12** | **0.9996** |
| headline | 21 | 0.991 |

`pin-goldens.mts:84-87` floods with `floodRegionSealed`, traces, rounds to 0.1 px, and writes
that as `golden` — at `MASK_MAX_DIM`, byte-identical to the bench's factor-1 baseline. The
0.997–1.000 readings are self-comparison plus raster noise.

`score.ts:200-215` makes **no distinction** — one flat mean. Proof by removal: with both
corpus JSONs moved aside the bench prints `mean IoU 0.979` and **still exits 0**. The entire
0.979 → 0.991 lift is tautology. The floor 0.957 is a *synthetic* probe; all 12 pinned probes
sit at ≥0.997 and structurally cannot set the floor.

The last comment states this correctly — *"the corpus so far proves regression safety"* — but
**the issue body, which declares itself "the current state", never discloses it** while
presenting 0.991/0.957 as its accuracy headline.

### B2 — HIGH: there is no CI gate, contradicting a round-6 claim

`.github/workflows/ci.yml` runs `npm ci`, `typecheck`, `test`, `build`. **`lint`, `bench` and
`e2e` are absent entirely.** `package.json:16` defines `check` including lint; CI doesn't use
it. Round 6 claims *"E ✅ … scored corpus with golden fixtures + CI gate"* and `run.mts:6`
says "wire it into CI next to the unit suite". **There is no CI gate.** Every gate claim
beyond unit tests + typecheck + build is a manual one-off, and the multi-door wedge fix is
gated only by a suite CI never runs.

### B3 — HIGH: `knownFail` is unbounded exclusion, and it is hiding live failures now

`score.ts:201` removes known-fails from mean, floor, refusal rate, leak rate, correct-refusal
rate, cross-disagreement and cross-floor-IoU; `run.mts:65` also removes them from coverage
totals. **There is no check anywhere that a known-fail still fails** — no xpass detection.

Live consequences in the current run:
- `va-finish-plan/open-margin` prints **`NOT refused`** — the engine fails the only real-plan
  refusal probe — and is dropped before "100% correct refusals" is computed.
- The two probes printing **`LEAK`** (`partition-bank-15in`, `tile-demising-same-pen`) are
  excluded from `leakRate`, so the bench reports 0% leak while two probes visibly leak on the
  same screen.

Any future regression can be neutralized with one `knownFail: true`.

### B4 — HIGH: deleting a corpus file passes silently

`run.mts:103` discovers cases by directory listing with no expected-count assertion.
Empirically, deleting `va-finish-plan.json` (8 of 21 probes, the only hard real plan) yields
`golden probes: 13 … bench passed`, exit 0. A dropped fixture is indistinguishable from a
passing one.

### B5 — HIGH: "100% correct refusals" and "0% leak" are near-vacuous

"100% correct refusals" is over **3 probes, all synthetic**. Zero real-plan refusal probes
gate; the only one fails and is excluded (B3).

"Leak rate 0%" is not independently measurable: `score.ts:133` defines leak as `iou < 0.5 &&
area > 1.5×`, and any IoU < 0.5 already fails the 0.90 floor gate. **`maxLeakRate: 0` can
never be the binding gate** — 0% leak is a mathematical consequence of the floor gate
passing, not evidence.

### B6 — HIGH: no real plan is cross-checked, and what's behind the exclusion is severe

All 9 VA probes are `[NO GATED PAIR — not cross-checked]`; the 16 gated probes are 12
synthetic + 4 from a 891-byte generated PDF. The headline `pair-IoU floor 0.962` describes
synthetic rectangles.

Re-running every VA golden at all three factors:

| probe | golden | ×1 (8.93 px/ft) | ×0.75 (6.70) | ×0.5 (4.46) |
|---|---|---|---|---|
| ward-room-294sf | 229.3 SF | 229.3 | **108.8 (−52.6%)** | 138.7 (−39.5%) |
| patient-toilet-137a | 39.2 | 39.3 | 38.6 | **15.5 (−60.6%)** |
| patient-room-137 | 161.4 | 161.3 | 141.4 (−12.3%) | 152.6 |
| elevator-e01 | 136.8 | 136.8 | 132.5 | 122.8 (−10.2%) |

**The min-passage rule did not make the real plan resolution-stable; the honesty floor
relocated the instability below the gate.** Note the history: `2730050` set the floor to
**6**, at which the VA ×0.75 run (6.696) *was* gated; `92c1242` raised it to **8**, which
excludes it. The effect is visible in the repo; the intent is not, and the round-8 commit
gives an independent band-width rationale. Worth stating plainly because the constant that
decides whether the flagship plan is checked lives inside the artifact under test.

The production VA mask sits at 8.929 px/ft — **11.6% above the floor**. A floor of 9 would
flag it as `coarse-mask` at production resolution.

### B7 — HIGH: IoU ≥ 0.90 is indefensible as a determinism criterion for an estimating tool

For nested rings, IoU 0.90 = 10.0% area loss; un-nested worst case is +11.1%. **The gate
admits −10.0% to +11.1% area disagreement between two resolutions of the same click** — on a
300 SF room at ~$6/SF that is ±$180–200; on a 5,000 SF job at $8/SF, ±$4,000.

The repo's own human-measured gate is `humanMaxSfErr = 0.025` — **4× tighter on the same
quantity**. The cross gate measures shape overlap when the product sells area. A direct
`|SF_a − SF_b|/SF ≤ 0.025` cross-resolution gate would cost nothing and mean something.

Also: only 13 of the 16 "cross probes" contribute a `minPairIoU` (the other 3 are refusal
probes with null rings, trivially agreeing), and `run.mts:78` hardcodes `statusAgree: true`
for ungated rows, so a genuine flip on a VA probe would render as unremarkable.

---

## C. The answer-key pipeline (commit `7605315`)

### C1 — HIGH: zero human-authored truth exists; all three new gates are dead code

`grep humanMeasured bench/corpus/*.json` → empty. `bench/corpus/sealed/` **does not exist**.
`run.mts:159` (`if (!cv.humanMeasured) continue`) means `humanMaxSfErr` (2.5%),
`humanCoverageBand` (±2%) and `humanOverlapFrac` (0.5%) **never evaluate**. The pipeline has
never processed a real human payload that survives in version control.

### C2 — HIGH: the strongest claim in that comment is false as coded

> "case total within ±2% of the human total (floor in *no* probe can't hide — this is the
> check that would have caught the 78 SF annotation band structurally)"

`score.ts:88-103` sums golden over the golden probe rings and engine over the *same rows*.
Floor that no golden probe covers is absent from **both** sums. Arithmetic on the live
corpus: delete the 19.0 SF band probe — literally reproducing "floor in no probe" — and
`sumGolden` and `sumEngine` drop by the same amount; **the ratio stays 1.000 and passes.**

In a human-key world the band is caught only because the human's polygon includes it, at
which point `maxSfErr` fires first and harder. The ±2% total adds a tighter aggregate band,
not new structural visibility. The code's own comments (`score.ts:84-86`, `run.mts:83-84`)
assert the false version.

### C3 — HIGH: `--allow-machine` still stamps the case as human truth

`from-takeoff.mts:183` sets `humanMeasured: true` **unconditionally**. Machine shapes get
only a per-probe `"machine-origin"` tag that is printed and never read for gating. A case
built entirely from One-Click shapes prints `[HUMAN-MEASURED — gated]` and gates as
independent truth — contradicting its own commit message ("they do NOT count as human
truth").

### C4 — HIGH: the `origin.method` guard is advisory; a missing `origin` reads as human

`from-takeoff.mts:117`: `const machine = !!s.origin?.method && s.origin.method !== "manual"`.
No `origin`, `origin: {}`, or `undefined` method ⇒ **human**. Input is arbitrary
`JSON.parse` with no schema check. This contradicts the repo's own stated policy
(`CHANGELOG.md:36`: *"defaulting it to human would corrupt any human-vs-machine split"*).

Vectors checked: edit-after-One-Click is correctly closed (`provenance.js:34-44` preserves
`origin.method`); missing origin is open; `--allow-machine` is open; a human re-tracing the
engine's on-screen outline is undetectable in principle — the design doc names this anchoring
bias itself but the pipeline has no control for it.

### C5 — MEDIUM: seed selection systematically draws the engine's easiest case

`interiorSeed` (`from-takeoff.mts:86-103`) picks maximum clearance from the boundary. It is
engine-independent code, so it is not *tuned* to the engine — but maximum clearance is
precisely the easy flood seed, systematically avoiding the near-wall, in-hatch,
doorway-adjacent and thin-neck seeds the engine carries dedicated machinery for and the
hand-built corpus deliberately probes. **The answer key is independent; the query is not.**
The human's real click is never used even where one exists.

Latent bug: if the centroid falls outside the polygon and no 24×24 grid sample lands inside,
it returns the centroid — **a point outside the room** — with no warning.

### C6 — MEDIUM: "negative-tested" is a one-off; the sealed protocol is discipline, not tooling

`THRESHOLDS` is a non-exported local; nothing in `web/test/` imports `bench/run.mts`.
`benchScore.test.ts:107-126` tests coverage arithmetic only, and its "shrunk room" is 2% —
*under* the 2.5% gate. Nothing proves a bad human case exits non-zero.

`run.mts:104` checks `process.env.BENCH_SEALED` for **truthiness**, so `BENCH_SEALED=0` loads
sealed cases. Run-once is enforced by nothing — no counter, ledger or marker. `run.mts:155`
unconditionally writes `results.json` containing **every sealed probe's goldens**, and
`bench/corpus/sealed/` is **not gitignored**, so a sealed holdout dropped there gets
committed.

### C7 — MEDIUM: a built-in false-failure for any plan with real deducts

`from-takeoff.mts:115` subtracts every deduct shape from the **golden** total, but
`traceRegion` returns the **outer contour only** — interior islands are never subtracted from
the engine area (the issue itself says fixtures are "included via outer-contour semantics").
On any plan where the estimator deducts >2% of floor, the case fails the ±2% gate for a
reason that is not an engine error.

---

## D. Claims, evidence, and the written record

### D1 — HIGH: "3 probes cover the full floor" is false by ~21 SF

Room + band + toilet = 161.4 + 19.0 + 39.2 = **219.6 SF** against the pre-round-8 golden of
**240.8 SF** (which round 8 states included the toilet). ~21 SF of the same floor is in no
probe. The round-8 review contradicts itself on this too — *"~78 SF of perimeter band was in
no probe"* followed by a 20.8 SF strip pin said to complete the coverage. The claim is
repeated in the body as current state.

### D2 — HIGH: the pinned band is 19.0 SF, not the 20.8 SF claimed

Shoelace on the actual 10-vertex golden = **19.04 SF** (~9% off). Both the review comment and
`2ea5487`'s commit message say 20.8. Bench reports IoU 1.000, so engine and golden agree —
the 20.8 figure has no source.

### D3 — HIGH: round 4's "verified visually" reading is contradicted by round 8, unretracted

Round 4: *"VA PATIENT ROOM 137: 249.3 SF … **toilet correctly excluded**"*, presented as
verified wall-to-wall on screen. Round 8: *"the old patient-room-137 golden **merged the
patient room with its PT-tile toilet room**"*. These cannot both be true, and the golden
arithmetic (241.1 ≈ 161 room + 41 toilet + ~38 band) supports round 8. 249.3 SF is never
retracted — and is not even the value pinned at the time (241.1).

This matters beyond the number: it is the clearest evidence that "verified visually" carried
no weight, which retroactively discounts every other claim resting on it.

### D4 — HIGH: test counts are wrong in three places

| claim | source | actual |
|---|---|---|
| "837 unit tests" | issue body + round-8 review + `2ea5487` | **835** at that commit |
| "847 unit tests (+10)" | `7605315` commit message | **843** (+8) |
| "833 tests" | round-8 working log | 833 ✓ |
| "825 tests" | round 7 | 825 ✓ |

Measured by checking out each commit and running the suite. The body's 837 is stale
regardless — HEAD is 843.

### D5 — HIGH: the evidence index points at a branch that lacks the evidence it cites

The body's `Evidence index:` and slice-doc links target `enhance-one-click-area`, which has
19 evidence files to HEAD's 23. **Missing there: `va-plan-ward-room-repin-min-passage.png`,
`va-plan-item-c-hatch-vs-arcs.png`, `va-plan-item-c-repins.png`,
`va-plan-round8-review-remediation.png`** — every piece of round 7–8 evidence, which is
exactly what those bullets cite by name. The linked slice doc on that branch has **no item C
row, no failure-mode-#3 row, and none of the three measurement-policy notes** the body
attributes to it.

Rounds 1–4 links all resolve correctly. Two round-8 image links are malformed
(double-backtick-wrapped URLs) and render broken — they are the only visual evidence in their
comments.

### D6 — HIGH: no artifact of the "four independent reviewers" exists

Searched `docs/`, `web/bench/`, `web/test/` and the full git log across all branches. What
exists: one commit message asserting the reviews, authored by the same account with the
**same `Claude-Session` ID as `92c1242`, the commit being "independently" reviewed**; two
regression tests naming a reviewer finding; three known-fail fixtures; one issue comment by
the same author.

The claim is self-reported with no independent trace. Its credibility rests entirely on the
retractions against interest being genuine — which they are. But "four independent reviewers"
is not established, and the review's own methodology note (*"a re-pinned corpus proves
self-consistency, not correctness"*) is not reflected in the body.

### D7 — HIGH: reviewer repros became regression tests in only 2 of 5 cases

Verified by reverting each fix:

| round-8 finding | regression test? | fails on revert? |
|---|---|---|
| 1 clipped-edge tautology | `geometry.test.ts:743` | **yes** ✓ |
| 2 joined stub kills arc | `geometry.test.ts:678` | **yes** ✓ |
| 3 O(N²) lattice perf | **none** | **no — 843/843 + bench pass with O(N²) restored** |
| 4 multi-door wedges | bench only (`corpus.ts:143`) | bench fails 0.660; all unit tests pass |
| 5 vacuous cross-res gate | `resolutionInvariance.test.ts` | yes ✓ |

Finding 4's guard is a suite CI never runs (B2). Finding 3 has nothing at all — the largest
hatch fixture is ~150 segments, orders of magnitude below where the blowup lives.

### D8 — MEDIUM: the perf numbers exist nowhere in the repo

*"23 s at 40k segs → 0.39 s"* and *"~285 ms per VA-sized sheet"*: the strings and numbers
appear in no test, script, benchmark or output artifact. `run.mts` has no timing output. The
substance is real — an auditor independently reproduced 11.25 s → 0.09 s at 40k segs — but
nothing re-measures it, and reverting the fix passes every gate the repo has.

Same for *"37,048 of 71,819 segments were hatch"*, the *"75/80-seed sweep"* (round 2), the
*"0.56 ft waist"* and *"0.42 ft slit"* (prose only in `oneclick.ts:83,85,97`), and the design
doc's bit-for-bit round-trip table, which rests on a script the doc says was **not
committed**.

### D9 — MEDIUM: numbers that moved without retraction

- **Corridor "1,718 SF"** (rounds 1 and 2, *"its 1,718 SF read stands"*) was **never** a
  pinned value: 1684.8 → 1705.1 → 1706.2. The evidence filename still encodes it.
- **`ward-room-294sf`** still carries 294 in its probe name while measuring 229.3 — a figure
  round 7 explicitly retracted as "a raster accident".
- **"0.04 SF overlap"** in the body is superseded by the 0.02 SF the bench now prints.
- **Vestibule**: the fix is framed as recovering a 13.7% under-count against a
  reviewer-approved 50.3 SF, but the remediated pin is **65.8 SF — 30.8% *above* it**. The
  overshoot is never adjudicated.
- **Sample-plan total**: round 1's 1,751.9 SF vs round 3's 4×436.2 = 1,744.8 vs the bench's
  1,744.7. Never reconciled.
- Round 3's headless-vs-browser gap "133.7 vs 127.8" is 4.4%, not "~3–4%", and both are
  superseded by 136.8.

### D10 — MEDIUM: the RFC is nowhere in the fork, and round 5 quotes a paraphrase

Round 5 presents *"no engine PR without corpus results showing mean/floor IoU, refusal rate,
and leak rate"* **inside quotation marks**. The RFC's actual sentence is *"No engine PR is
reviewable without corpus results: mean/floor IoU, refusal rate, leak rate, per-fixture
deltas."* — reworded, and it drops a requirement.

The slice doc paraphrases items B/C/D/E and failure modes #2/#3 in its own words, quotes
nothing, and never mentions failure modes #1, #4, #5, #6 despite the body attributing item C
to "failure modes #1 and #4". It also renders failure mode #2 as *"unclosed door swings"* in
quotes; the RFC's heading is **"Boundary gaps leak."**

Fetched directly, the substantive **sequencing claims do check out** — items A–F match, and
"F unblocked per upstream's sequencing" and "A corpus-gated" are both supported by RFC text.
But none of that is verifiable from the repo alone.

### D11 — MEDIUM: "operator request" has no artifact

The round-8 wall-attached casework item is attributed to an operator request. No file,
commit, issue or comment records it; the only record is the assertion, by the same author.

### D12 — MEDIUM: the body is two commits stale and omits its own biggest caveat

`7605315` (answer-key pipeline, including a **user-facing "Export takeoff data (JSON)"**
menu item) and `21e57a0` (791-line design doc) appear nowhere in the body — not in the
commit list, not in shipped work, not in remaining work, which still says "next session
starts at item F". The body declares itself "the current state".

More seriously, it omits the caveat its own latest comment states: that every real-plan
golden is engine-authored (B1).

### D13 — MEDIUM: knob reduction is knob *relocation*

The seven named constants are genuinely gone, and the classifier's **exported** surface
shrank 12 → 6. But module-wide named constants went **42 → 41**, and the replacements moved
into unexported literals that are tunables in fact and harder to test or dial: `HALF_CELL =
0.5` (`:471`, doing `ROW_EPS`'s and `HATCH_PITCH_TOL`'s job), `cand.length < 5` /
`members.length < 5` (`:488,507` — `HATCH_MIN_RUN`'s job, now duplicated), `len < 0.75`
(`:483`), `ratioOk r <= 3` (`:354`), the ±2p / 3-step lattice depths, plus new wedge-path
magic (Chebyshev 3 at `:956,983`, the rim and `2*wedgeCapPx` at `:1111`).

Related and worse: the hardcoded 3s — `dt > 3` in `virtualBoundaryFrac` (`:1183`), the
cluster bridge radius (`:956`), the growback rim (`:1111`) — are **mask px, not feet-true**,
so the ≥75% gate physically tightens and dashed-arc cluster bridging degrades as `mppf`
rises. That contradicts the "feet-true through `MaskObj.mppf`" story for the entire
sealing/wedge path.

### D14 — MEDIUM: the entanglement audit is an assertion list, not an audit

`UPSTREAM_CONTRIBUTION_SLICE.md:71-80` is five checkmarked bullets. Line 80 says "Run this
check before assembling" and **no such check exists**. Spot-checked:

- *"`oneclick.ts` imports nothing fork-specific ✓"* — **true, strongly**: zero imports.
- *"`confidence.ts` stands alone ✓"* — **false as written**: `confidence.ts:22` imports
  `DETERMINISM_MIN_MPPF` from `./oneclick`. Harmless (both are slice) but inaccurate.
- *"the ONLY place slice and extensions meet is `TakeoffCanvas.jsx` ✓"* — counterexample:
  `geometry.js` is imported by both `bench/score.ts` (slice) and `roomName.ts` (declared fork
  extension).

**Concrete cherry-pick hazard:** `geometry.js` — source of `pointInPoly`, which
`bench/score.ts:8` needs — is listed **nowhere** in the slice table, and the plan never
verifies upstream exports it. Applying the slice as classified may not compile. (Unproven —
no access to the upstream repo.)

The doc also classifies **nothing** from `7605315` — not `from-takeoff.mts`, not the
`humanMeasured` gate tier, not the sealed protocol, not the new export feature it calls a
fork extension. The doc that claims to classify "every piece" is incomplete for its own
branch.

### D15 — LOW: shipped checkboxes contradicted inside their own bullets

- **Item C `[x]`** ships with `annotation-ring-room` at IoU 0.650 — and that same defect is
  cited as *verified evidence* one section later ("PATIENT ROOM 137 reads … to its finish-tag
  annotation ring") and as *bug #17* one section after that.
- **Failure mode #3 `[x]`** concedes inside its own bullet that the floor is "a pragmatic
  line, not a derivation", while the real plan is uncross-checked (B6).

### D16 — LOW: assorted

- `e2e/one-click.e2e.cjs:6` and `make-fixture.cjs:7` document the **opposite** contract
  ("preview ≈ 113 SF, NOT sealed") from what the harness now asserts. Anyone reading the
  harness to learn the contract gets the wrong answer.
- `confidence.test.ts:11-13` asserts the implementation's own constants back at itself —
  `CONF_RASTER` could become 0.05 and it passes. (The composition tests are sound.)
- `roomName.ts:79` returns a bare number line as a room name, so a keynote or door tag "213"
  inside a region becomes the label.
- `TINY_SF` bit-identity survives only because of `Math.round` — the product at 18 px/ft is
  29.999999999999996.
- At the VA plan's production 8.929 px/ft, the px **floors** dominate: `nudge` is 3 px = 4",
  **3× the feet-true 2"**. "Feet-true thresholds" are inoperative at production resolution on
  the only real plan in the corpus.
- A one-off, non-reproducible `vite` build failure resolving the **dynamic** `fflate` import
  (`ingest.js:67`); two subsequent clean builds succeeded. Cause unknown; worth a look.
- `traceConfidence({virtualFrac: NaN})` returns `score: NaN` — unreachable from engine paths,
  but the function is exported and unguarded.

---

## Priority

**Fix before any upstream PR:**
1. A1 Hi-Res resolution flip — a live product bug producing different SF for the same click.
2. A2/A3 confidence anti-correlation and the undisclosed primary seal path — RFC item D does
   not currently do its job, and item D is what gates item F upstream.
3. A4/A5 curved-wall annexation and non-door arc detection — both silently wrong, both with
   fixtures that pass trivially.
4. B2 put `bench`, `e2e` and `lint` in CI. Every other gate claim depends on this.
5. B3 xpass detection on known-fails, and a probe-count assertion (B4).

**Fix before the claims are repeated:**
6. D1–D5 the arithmetic and evidence-link errors in the body; retract D3 and D9 explicitly.
7. C2 the ±2% structural-coverage claim, in the code comments as well as the issue.
8. C3/C4 make the human guard actually enforcing, or stop labelling cases human.

**Reframe rather than fix:**
9. B1 state the engine-pinned split wherever 0.991/0.957 appears. The number is a
   regression-stability metric; it is a good one, and it is not accuracy.
10. B6/B7 replace ring-IoU with an SF-error cross gate, and say plainly that no real plan is
    cross-resolution verified.
11. D6 downgrade "four independent reviewers" to what the artifacts support.

**Structural:**
12. A6 the MCP surface must call the same engine or stop claiming `one_click_v1`.
13. C1 the answer-key pipeline is untested end-to-end until one human-measured plan exists.
    Until then the three new gates are aspirational.
