# One-Click engine: measured before/after evidence pack

**BEFORE** = `21e57a0` (tip before any of this work) · **AFTER** = `94a5d46` on `claude/issue-184-hatch-periodicity-fduafy`

Every number below was produced by running the same probe script against both states. Nothing is
copied from a commit message, a code comment, or `docs/audit/`. Where a claim on record did **not**
reproduce, or reproduced with a different magnitude, that is said so in the section.

---

## Summary — what materially changed for a user

Three things a user can see. **(1)** The per-sheet "Hi-Res render" toggle no longer changes measured
square footage on sheets that render below the 3000 px raster cap: on a synthetic 11×17 at 1/8″ with
a near-threshold wall slot, 61 of 61 slot widths gave a different answer with the toggle on BEFORE
(worst −32.8%, 140.7 SF → 94.6 SF) and 0 of 61 on AFTER. On cap-bound sheets — including the VA
finish plan, where the toggle *is* reachable — **nothing changed at all** (see A1, contradiction #1).
**(2)** The batch "Detect Rooms" path and the MCP server now measure with the same engine as the
canvas: on the VA finish plan, 25 of 64 seeds returned different square footage across those three
surfaces on BEFORE (worst: 68.9 SF on the canvas vs 285.6 SF from batch/MCP for the same click, all
three stamping `origin.method: "one_click_v1"`); on AFTER, 0. **(3)** A curved wall with no door in
the scene no longer annexes the floor behind it (47.6 SF annexed on BEFORE at confidence 0.97,
0 SF on AFTER), and the hover path on a 6-door room costs 161 ms warm instead of 1483 ms, with
bit-identical output. Alongside those, the bench was re-pinned so it scores the ring the product
actually returns (up to 8.6% different from what it scored before) and now fails loudly when a corpus
fixture disappears, which it previously did not.

**What did not improve:** three of the eight defects are only *partly* fixed, and the pack says where.

---

## How to reproduce everything

```bash
S=/tmp/claude-0/-home-user-opentakeoff/dbe6d1ab-0f3a-55b4-8dbe-8256f09f5b5d/scratchpad
git worktree add -b ev/before $S/wt-before 21e57a0
git worktree add -b ev/after  $S/wt-after  origin/claude/issue-184-hatch-periodicity-fduafy
ln -sfn $S/wt-184/web/node_modules $S/wt-before/web/node_modules
ln -sfn $S/wt-184/web/node_modules $S/wt-after/web/node_modules
ln -sfn $S/wt-184/mcp/node_modules $S/wt-before/mcp/node_modules   # A6 only
ln -sfn $S/wt-184/mcp/node_modules $S/wt-after/mcp/node_modules    # A6 only

# probe sources (UNTRACKED, written by this pack)
for w in before after; do mkdir -p $S/wt-$w/web/evprobe; \
  cp docs/evidence/probes/*.mts $S/wt-$w/web/evprobe/; done
```

Each probe below is one file, byte-identical in both worktrees. Where the AFTER API grew a parameter
(`buildMask`'s 7th argument `basePxPerFt`) the probe passes it unconditionally; on BEFORE that
parameter does not exist and JS drops it, which is the point — BEFORE has no way to receive it.
Where a symbol exists only on AFTER (`flagNonDoorArcs`, `arcClusterFit`, `wedgeAllowance`) the probe
reads it off the module namespace and reports its absence rather than failing to load.

Environment: node v22.22.2, 4 cores, load average ≈1.3 during the timing runs.

---

## Headline table

| # | Defect | Quantity measured | BEFORE | AFTER | Verdict |
|---|---|---|---|---|---|
| A1 | Hi-Res changed measured SF | render scales (of 61 slot widths) where the toggle changes the answer, below-cap sheet | 61 / 61, worst −32.8% | 0 / 61 | **fixed below the cap** |
| A1 | …same, cap-bound sheet (VA plan, `autoRenderScale` 2.0704) | rs 2.000 → 2.070 drift, worst probe | −7.03% | −7.03% (byte-identical block) | **NOT fixed** |
| A3 | Seal path bypassed its own guards | oversize-through-a-slot scene | `ok`, 749.7 SF, 30.5% of sheet, conf **1.00**, no provenance | `leak` (refused) | fixed |
| A3 | …legitimate min-passage use | `two-doorways` fixture | 18.9 SF, conf **1.00**, no provenance | 18.9 SF, conf **0.85**, `undecidable-passage` | fixed (signal added) |
| A4 | Curved wall annexed space behind it | annexed SF, 30 ft chord / 2.5 ft bulge, **no door in scene** | **+47.6 SF** (447.4 → 497.4), `wedges: 1`, conf 0.97 | **0 SF**, `wedges` unset, conf 0.84 | fixed |
| A4 | control: real 3′-0″ door | annexed SF | +7.33 SF | +7.33 SF | unchanged (good) |
| A5 | Non-doors as door arcs | door-allowance a shape may spend, SF | cloud 51.0, column 7.3, bubble 24.9, millwork 22.2–51.0, elbow 8.7 | 0, 5.9, 19.6, **0**, **8.6** | **partly fixed** |
| A5 | negative control: ellipse (bezier) | door-allowance SF | 19.7 | **19.9 (worse)** | **regression, small** |
| A2 | Confidence vs error | conf of probes >2.5% SF error | 1.00, 1.00, 1.00, 0.95, 0.95 | 1.00, 0.85, 0.85 | **partly fixed** |
| A6 | Batch/MCP used a different engine | divergent seeds, VA plan, 64 seeds | **25** (worst 68.9 vs 285.6 SF) | **0** | fixed |
| A5b | Bench scored a ring the product never returned | bench-ring vs production-ring SF, VA rooms | up to **+8.57%**, ungated | goldens re-pinned to the production ring; gap now reported | fixed |
| A8 | Hover cost | 6-door room, 3000×3000 mask, warm ms (median of 15) | **1483 ms** | **161 ms** (9.2×) | fixed |
| A8 | …output | region digest / count / ring | identical | identical | bit-identical ✔ |
| — | test count (`web`) | | 843 | 934 | +91 |
| — | `npm run bench` in CI | | not run | run | added |
| — | bench with a corpus fixture deleted | exit code | **0 (passes)** | **1 (fails, names it)** | fixed |

---

## A1 — the Hi-Res toggle changed measured square footage

**Probe** (`docs/evidence/probes/a1.mts`, `a1b.mts`). `a1.mts` renders each real corpus PDF at the
baseline `RENDER_SCALE = 2.0` and at the Hi-Res scale the product's own `autoRenderScale()` picks
(5.3743 for the 1224×792 pt `sample-plan.pdf`; 2.0704 for the 3024×2160 pt `sample-finish-plan.pdf`),
extracts vector geometry at each, builds the mask exactly as `TakeoffCanvas.jsx:2845` does, floods the
same seeds, and reports `mppf`, mask dims, differing mask cells, and SF. It also runs the synthetic
slit scene taken verbatim from the AFTER branch's own `web/test/resolutionInvariance.test.ts`.
`a1b.mts` sweeps a 11×17 @ 1/8″ scene (two rooms, 96 SF and 48 SF, separated by a party wall with a
single slot) across slot widths 0.30–0.90 ft in 0.01 ft steps at rs 2.000 and rs 5.374.

```bash
cd $S/wt-before/web && node --import tsx evprobe/a1.mts     # and a1b.mts
cd $S/wt-after/web  && node --import tsx evprobe/a1.mts     # and a1b.mts
```

### Below the raster cap — fixed

Synthetic slit scene (`resolutionInvariance.test.ts`'s own `a1Scene`), 11×17 @ 1/8″:

| state | rs | image | ws | mask | mppf | SF (ring) | mask cells differing from rs 2.0 |
|---|---|---|---|---|---|---|---|
| BEFORE | 2.000 | 1800×1400 | 1.000000 | 1800×1400 | 18.00 | 882.23 | 0 |
| BEFORE | 2.070 | 1863×1449 | 1.000000 | 1863×1449 | 18.63 | 882.82 | dims differ |
| BEFORE | 3.000 | 2700×2100 | 1.000000 | 2700×2100 | 27.00 | 884.45 | dims differ |
| BEFORE | 5.374 | 4837×3762 | 0.620270 | 3001×2334 | 30.00 | 884.89 | dims differ |
| AFTER | 2.000 | 1800×1400 | 1.000000 | 1800×1400 | 18.00 | 882.23 | 0 |
| AFTER | 2.070 | 1863×1449 | 0.966184 | 1800×1400 | 18.00 | 882.23 | **0** |
| AFTER | 3.000 | 2700×2100 | 0.666667 | 1800×1400 | 18.00 | 882.23 | **0** |
| AFTER | 5.374 | 4837×3762 | 0.372162 | 1800×1400 | 18.00 | 882.23 | **0** |

`sample-plan.pdf` (below the cap at baseline), all four rooms:

| state | rs | mask | mppf | cell SF | ring SF | Δ vs rs 2.0 |
|---|---|---|---|---|---|---|
| BEFORE | 2.0000 | 2448×1584 | 36.0000 | 437.377 | 436.176 | — |
| BEFORE | 5.3743 | 3000×1942 | 44.1123 | 437.845 / 437.228 | 436.864 / 436.248 | +0.11% / −0.03% |
| AFTER | 2.0000 | 2448×1584 | 36.0000 | 437.377 | 436.176 | — |
| AFTER | 5.3743 | 2449×1585 | **36.0000** | 437.377 | 436.176 | **0.00%** |

Slot-width sweep (`a1b.mts`), 61 widths, rs 2.000 vs rs 5.374:

| state | mppf OFF → ON | widths where Hi-Res changes the answer | worst |
|---|---|---|---|
| BEFORE | 18.00 → 22.0581 | **61 / 61** | slot 0.62–0.63 ft: **140.72 SF → 94.59 SF (−32.8%)** |
| AFTER | 18.00 → **18.00** | **0 / 61** | — |

*Reading:* the defect is real and its severity matches the claim in kind and magnitude — the audit
records +37.0% (97.8 → 134.0 SF) at "slit 0.60–0.63 ft"; the reproduction here is −32.8% at slot
0.62–0.63 ft. (The sign differs because in my scene it is the low-resolution raster that leaks
through the slot; the audit's scene leaks at high resolution. The flip band is the same width.)
Note that outside the flip band the drift is 0.65–0.85%, not zero: the toggle moved every answer.
The AFTER mask is bit-identical (0 differing cells) at every render scale tested.

**⚠ Contradiction #1 — the cap-bound half of A1 is not fixed.** `oneclick.ts:750-762` on AFTER states
that above the cap "`Math.round(seg*ws)` still quantized in RENDER px, so cap-bound sheets shifted
too (VA plan: −3.96% on one probe at identical `mppf`)" and that the fix maps into the baseline
render "before quantizing". Measured, the entire `va-finish-plan` block of `a1.mts` output is
**byte-for-byte identical between BEFORE and AFTER**:

| probe | rs 2.000 | rs 2.070 | Δ | rs 2.0704 | Δ |
|---|---|---|---|---|---|
| patient-toilet-137a (cell SF) | 36.340 | 33.784 | **−7.03%** | 36.039 | −0.83% |
| ward-vestibule (ring SF) | 65.812 | 67.682 | **+2.84%** | 67.148 | +2.03% |
| patient-room-137 (cell SF) | 159.572 | 158.610 | −0.60% | 159.347 | −0.14% |

and these three rows are the same on both states. The reason is algebraic: for a cap-bound sheet
AFTER computes `ws = k·wsB = (basePxPerFt/pxPerFt)·maxDim/(imgW·k) = maxDim/imgW`, which is exactly
BEFORE's `ws`, and `mw = ceil(bW·wsB) = ceil(imgW·ws)`, exactly BEFORE's `mw`. The AFTER code comment
saying item 1.1i "is subsumed by pinning `ws`" is correct that the two quantizations agree — and
that is *why* nothing changed. The VA sheet's `autoRenderScale` is 2.0704, i.e. Hi-Res **is**
reachable on it, so a user can still get −7% on `patient-toilet-137a` from the toggle alone.

Two smaller notes against the record: the audit quotes `rs 2.070` and mask dims `3000×2143`; the
product's actual `autoRenderScale` is `2.0704`, which gives `3000×2144` and a −0.83% drift on that
probe rather than −3.96%. At `rs 2.070` exactly the drift measures **−7.03%**, worse than the −3.96%
on record. The published figure is sensitive to a fourth-decimal rounding of the render scale.

---

## A3 — the seal path bypassed its own guards

**Probe** (`docs/evidence/probes/a3.mts`). `sealAttempt()` guards its seal *ladder* with two gates —
the grown region must stay under 30% of the sheet, and ≥75% of its boundary must hug real linework.
On BEFORE (`oneclick.ts:1037-1047`) the `minPassPx` *primary* path returns its grown region before
either gate and sets neither `sealedPx` nor `virtualFrac`. Three scenes, all 1000×800 px at 18 px/ft
(so `minPassRadiusFor` = 5, closing axis-aligned gaps ≤ 10 px = 0.556 ft):

* **S1** a 700×350 px room (38.9 × 19.4 ft) whose only opening is a **0.40 ft slot**. The dilated
  flood lands just under the 30% cap; `growRegionBack` pushes the final count over it.
* **S2** no walls at all — a **dashed** graphic line (6 px on, 6 px off) closing a corner of the sheet.
* **S3** the repo's own `two-doorways` corpus fixture: a room with two undrawn cased openings, i.e.
  the legitimate use of the rule.

```bash
cd $S/wt-before/web && node --import tsx evprobe/a3.mts
cd $S/wt-after/web  && node --import tsx evprobe/a3.mts
```

| scene | state | plain flood | sealed status | count (frac of sheet) | `sealedPx` | `virtualFrac` | min-pass provenance | SF | conf | factors |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 oversize | BEFORE | leak | **ok** | 243 958 (**0.3049**, over the 0.30 cap) | null | null | none | **749.70** | **1.00** | *(none)* |
| S1 oversize | AFTER | leak | **leak** | — | — | — | — | — | — | — |
| S2 dashed line | BEFORE | leak | ok | 157 939 (0.1974) | null | null | none | 484.00 | **1.00** | *(none)* |
| S2 dashed line | AFTER | leak | ok | 157 939 (0.1974) | 5 | 0.000 | `minPassPx 5, minPassDelta 1` | 484.00 | **0.85** | `sealed-opening(0% synthetic boundary)`, `undecidable-passage(the drawn linework does not enclose this space)` |
| S3 two-doorways | BEFORE | leak | ok | 6 253 | null | null | none | 18.90 | **1.00** | *(none)* |
| S3 two-doorways | AFTER | leak | ok | 6 253 | 5 | 0.000 | `minPassPx 5, minPassDelta 1` | 18.90 | **0.85** | same as above |

*Reading:* BEFORE returned a 749.7 SF "room" occupying 30.5% of the sheet at full confidence with no
provenance at all — precisely the result the ladder's own room-size gate exists to refuse. AFTER
refuses it. For the two scenes that stay inside the cap the **measured area is unchanged**; what
changed is that the result now carries `minPassPx`/`minPassDelta` and drops to 0.85.

Worth flagging honestly: **the second guard did not fire on either state.** The dashed-line scene
(S2) has `virtualFrac = 0.000` after growback — the boundary hugs the dash cells to within `dt ≤ 3`,
so the virtual-boundary test sees nothing wrong. AFTER catches it only through the new
`minPassDelta = 1` confidence signal, not through a refusal. A dashed property line is still measured
as a room on both states; it is now measured *and flagged*.

---

## A4 — curved walls annexed the space behind them

**Probe** (`docs/evidence/probes/a4.mts`). A 1000×800 px sheet at 18 px/ft with **no door anywhere**:
a room (100,100)–(400,640) with a straight east wall at x = 400 and, inside it, a curved wall from
(400,100) to (400,640) — a 30.0 ft chord bulging 2.5 ft (45 px) west, tessellated into 16 chords
carrying `SEG_CURVE`. The crescent between arc and wall is exactly ⅔ × 45 × 540 = 16 200 px = **50.0
SF**, just under the old constant ceiling of 2 × `doorWedgeCapPx(18)` = 16 540 cells = 51.05 SF.
Control scene: the same room with a real 3′-0″ door swing.
(The AFTER branch's own `doorArcs.test.ts` uses a 30°-diagonal variant of this fixture; this is an
independent, axis-aligned construction of the same shape.)

```bash
cd $S/wt-before/web && node --import tsx evprobe/a4.mts
cd $S/wt-after/web  && node --import tsx evprobe/a4.mts
```

| scene | state | retry OFF (`wedgeCapPx = 0`) | retry ON | annexed | `wedges` | `wedgeGrowth` | conf ON | factors ON |
|---|---|---|---|---|---|---|---|---|
| curved wall, no door | BEFORE | 145 739 cells, 447.39 SF | 161 165 cells, **497.41 SF** | **+15 426 cells = +47.61 SF (+11.2%)** | **1** | 1.106 | 0.97 | `door-swing-crossed` |
| curved wall, no door | AFTER | 145 739 cells, 447.39 SF | 145 739 cells, 447.39 SF | **0** | — | — | 0.84 | `curve-bounded(32% of the boundary)` |
| control: real 3′-0″ door | BEFORE | 158 841, 487.68 SF | 161 215, 494.83 SF | +2 374 = +7.33 SF | 1 | 1.015 | 0.94 | `sealed-opening(3%)`, `door-swing-crossed` |
| control: real 3′-0″ door | AFTER | 158 841, 487.68 SF | 161 215, **494.83 SF** | +2 374 = +7.33 SF | 1 | 1.015 | 0.97 | `sealed-opening(3%)`, `door-swing-crossed(1.5% annexed swing)` |

*Reading:* BEFORE handed a room 47.6 SF of floor that no door connects to it, labelled it a door
swing, and scored it 0.97. AFTER annexes nothing and instead deducts for a curve-bounded boundary.
The real door is admitted with identical geometry on both states, so the fix is not a blanket refusal.
(AFTER's confidence on the *unretried* curved-wall flood drops 1.00 → 0.84 from the new `curveFrac`
signal — a change to every curve-bounded trace, not only to false wedges.)

---

## A5 — non-doors detected as door arcs

**Probe** (`docs/evidence/probes/a5.mts`). Eight fixtures, each in **both** forms CAD emits: straight
`lineTo` chords through `markPolylineArcs()`, and a real cubic op list through
`extractVectorGeometry()`. Two tables. First, chord classification — `curveChords` = chords carrying
`SEG_CURVE`; `doorChords` = chords the engine will treat as a door swing (`SEG_CURVE` minus
`flagNonDoorArcs()`, which does not exist on BEFORE, so there every curve chord is a door chord).

```bash
cd $S/wt-before/web && node --import tsx evprobe/a5.mts
cd $S/wt-after/web  && node --import tsx evprobe/a5.mts
```

`flagNonDoorArcs` exists: BEFORE **false**, AFTER **true**.

| fixture | form | chords | curveChords B→A | **doorChords B→A** | `MASK_NODOOR_BIT` cells B→A |
|---|---|---|---|---|---|
| revision cloud | polyline | 180 | 180 → 180 | **180 → 0** | 0 → 864 |
| revision cloud | bezier | 224 | 224 → 224 | **224 → 6** | 0 → 889 |
| round column (r = 1 ft) | polyline | 24 | 24 → 24 | **24 → 0** | 0 → 104 |
| round column | bezier | 33 | 32 → 32 | **32 → 0** | 0 → 104 |
| callout bubble (r = 2 ft) | polyline | 32 | 32 → 32 | **32 → 0** | 0 → 200 |
| callout bubble | bezier | 33 | 32 → 32 | **32 → 0** | 0 → 200 |
| duct elbow (two concentric 90°) | polyline | 16 | 16 → 16 | **16 → 16** | 0 → 0 |
| duct elbow | bezier | 16 | 16 → 16 | **16 → 16** | 0 → 0 |
| curved millwork (12 ft, R≈18.5 ft) | polyline | 12 | 12 → 12 | **12 → 12** | 0 → 0 |
| curved millwork | bezier | 8 | 8 → 8 | **8 → 8** | 0 → 0 |
| **ellipse 3:1 (control)** | polyline | 32 | **0 → 0** | **0 → 0** | 0 → 0 |
| **ellipse 3:1 (control)** | bezier | 32 | **32 → 32** | **32 → 32** | 0 → 0 |
| single door (r = 3 ft) | polyline | 8 | 8 → 8 | 8 → 8 | 0 → 0 |
| single door | bezier | 8 | 8 → 8 | 8 → 8 | 0 → 0 |
| double door (2 × r = 3 ft) | polyline | 16 | 16 → 16 | 16 → 16 | 0 → 0 |
| double door | bezier | 16 | 16 → 16 | 16 → 16 | 0 → 0 |

Chord flags are only an input. What decides whether a shape can hand over floor is the per-cluster
growth allowance inside `floodRegionSealed`. `legacyAllowance` re-implements BEFORE's rule verbatim
(`oneclick.ts@21e57a0:1105-1112` — axis-aligned bbox + 3-cell rim, × `WEDGE_SLACK`, capped at
2 × `doorWedgeCapPx`) and is computed on **both** states from each state's own mask cells, so it
isolates the guard from the mask. `engineAllowance` is AFTER's `wedgeAllowance(arcClusterFit(...))`.
Ceiling: 51.05 SF.

| shape | form | curve cells | legacy allowance (B / A) | **AFTER engine allowance** | AFTER fit |
|---|---|---|---|---|---|
| revision cloud | polyline | 864 | 51.0 / 51.0 SF | **0 SF** | fit poor, r 6.7 ft, sweep 359°, noDoor 1.00 |
| revision cloud | bezier | 904 | 51.0 / 51.0 | **0** | fit poor, r 7.2 ft, sweep 359°, noDoor 0.98 |
| round column | polyline | 104 | 7.3 / 7.3 | **5.9** | fit good, r 1.00 ft, sweep 356°, noDoor 1.00 |
| round column | bezier | 104 | 7.3 / 7.3 | **6.0** | fit good, r 1.01 ft |
| callout bubble | polyline | 200 | 24.9 / 24.9 | **19.6** | fit good, r 1.98 ft, sweep 358°, noDoor 1.00 |
| callout bubble | bezier | 200 | 24.9 / 24.9 | **19.6** | same |
| duct elbow | polyline | 84 | 8.7 / 8.7 | **8.6** | fit poor, r 0.96 ft, noDoor 0.00 |
| duct elbow | bezier | 84 | 8.7 / 8.7 | **8.6** | same |
| curved millwork | polyline | 217 | 22.2 / 22.2 | **0** | fit good, r 18.4 ft > `DOOR_R_MAX_FT` |
| curved millwork | bezier | 471 | 51.0 / 51.0 | **0** | fit good, r 18.4 ft |
| **ellipse (control)** | bezier | 228 | 19.7 / 19.7 | **19.9** | fit poor, r 1.88 ft, noDoor 0.00 |
| single door | either | 77 | 14.8 / 14.8 | **12.5** | fit good, r 3.00 ft, sweep 90° |
| double door | polyline | 148 | 28.0 / 28.0 | **28.2** | fit poor, r 1.92 ft, sweep 184° |
| double door | bezier | 153 | 51.0 / 51.0 | **22.2** | fit poor, r 2.25 ft, sweep 225° |

*Reading:* the fix is real for **closed** non-doors and for **long-radius** arcs. Clouds, columns and
callout bubbles are now flagged (`MASK_NODOOR_BIT`), and clouds and curved millwork get an allowance
of exactly zero. Doors, single and double, in both forms, keep an allowance — the negative side of
the control holds.

**⚠ Contradiction #2 — A5 is only partly fixed, and two rows go the wrong way.**
* The **duct elbow** and **curved millwork** are *not* flagged as non-doors at the chord level on
  either state (16→16 and 12→12 door chords). Millwork is nonetheless refused at the cluster level
  by the new radius test; the **duct elbow is not** — 8.7 SF of allowance on BEFORE, 8.6 SF on AFTER.
  A 2.2 ft-radius elbow is indistinguishable from a closet leaf by every criterion the engine applies.
* The **ellipse negative control fails in bezier form on both states** — `extractVectorGeometry`
  stamps `SEG_CURVE` on every bezier chord unconditionally, so all 32 chords are door chords on
  BEFORE *and* AFTER. Its allowance goes **19.7 → 19.9 SF, i.e. very slightly worse on AFTER.**
  Only the polyline form of the ellipse is correctly rejected (by `markPolylineArcs`'s circle fit).
* The polyline **double door**'s allowance also rises marginally, 28.0 → 28.2 SF. That direction is
  desirable here (it must keep annexing) but it is a rise, and it is recorded.

---

## A2 — confidence vs error

**Probe:** `npm run bench` on both states, tabulating every golden probe's SF error against its
reported confidence.

```bash
cd $S/wt-before/web && npm run bench
cd $S/wt-after/web  && npm run bench
```

| probe | BEFORE SF err | BEFORE conf | AFTER SF err | AFTER conf |
|---|---|---|---|---|
| partition-bank-15in / mid-bay *(known-fail)* | 384.2% | **0.95** | 400.0% | **0.85** |
| tile-demising-same-pen / room-a *(known-fail)* | 97.4% | **0.95** | 100.0% | **0.85** |
| annotation-ring-room / center *(known-fail)* | 35.0% | **1.00** | 33.3% | **1.00** |
| two-doorways / center | 4.3% | **1.00** | 0.0% | 0.85 |
| curved-partition / left-half | 3.2% | **1.00** | 1.0% | 0.84 |
| enclosed-room / center | 2.0% | 1.00 | 0.0% | 1.00 |
| enclosed-room / near-wall | 2.0% | 1.00 | 0.0% | 1.00 |
| cased-opening-3ft / center | 2.0% | 0.94 | 0.0% | 0.94 |
| door-swing-3ft / center | 2.0% | 0.92 | 0.0% | 0.93 |
| two-door-room / center | 2.0% | 0.92 | 0.0% | 0.92 |
| hatched-room / center | 0.8% | 0.95 | 0.0% | 0.93 |
| tile-grid-room / in-cell | 0.8% | 0.95 | 0.0% | 0.85 |
| sample-plan × 4 | 0.0% | 1.00 | 0.0% | 1.00 |
| va-finish-plan / patient-room-137 | 0.0% | 0.92 | 0.0% | 0.93 |
| va-finish-plan / patient-room-137-band | 0.0% | 1.00 | 0.1% | 1.00 |
| va-finish-plan / patient-toilet-137a | 0.0% | 0.92 | 0.0% | 0.90 |
| va-finish-plan / elevator-e01 | 0.0% | 0.97 | 0.0% | 0.97 |
| va-finish-plan / ward-room | 0.0% | 0.97 | 0.0% | 0.94 |
| va-finish-plan / ward-vestibule | 0.0% | 0.97 | 0.0% | 0.89 |
| va-finish-plan / cloud-corridor | 0.0% | 0.97 | 0.0% | 0.98 |
| va-finish-plan / shaded-wing-office | 0.0% | 0.97 | 0.0% | 0.97 |
| va-finish-plan / open-margin *(known-fail)* | traced where the key says refuse | **not scored** | same | **0.65** |

Aggregate pairing:

| | BEFORE | AFTER |
|---|---|---|
| probes with > 2.5% SF error | 5 | 3 |
| their confidences | **1.00, 1.00, 1.00, 0.95, 0.95** | **1.00, 0.85, 0.85** |
| best conf among > 2.5%-error probes | 1.00 | 1.00 |
| worst conf among ≤ 0.5%-error probes | 0.92 | 0.85 |
| a confidence-vs-error gate in the bench | **absent** | present, with three documented xfail exemptions |

*Reading:* the claim — "before, the worst probes scored 0.95–1.00" — **is exactly what the numbers
show**: every one of the five worst probes on BEFORE scored 0.95 or higher, three of them a perfect
1.00. On AFTER the two worst drop to 0.85 and a gate is enforced.

Two caveats that must travel with this table. **(a)** Two of the BEFORE "worst" rows —
`two-doorways` 4.3% and `curved-partition` 3.2% — read better on AFTER largely because the goldens
were re-pinned to the production ring (A5b), not because the trace changed; `curved-partition` is
the only genuine accuracy gain (raw ring 3.20% → snapped 0.96%). **(b)** `annotation-ring-room`
still measures 33.3% wrong at confidence **1.00** on AFTER. The branch carries it as an explicit,
argued xfail rather than tuning it away, but the top row of the "worst" list is unchanged: the single
most confident probe in the corpus is still a third wrong.

---

## A6 — MCP and batch measured with a different engine

**Probe** (`docs/evidence/probes/a6.mts`). One sheet, one scale, one seed set, three paths:
the canvas's inline `buildMask(..., pxPerFt)` + `floodRegionSealed(..., sealRadiiFor, doorWedgeCapPx,
minPassRadiusFor)` + `snapVertices(..., 7)`; `detectRegions()` from `web/src/lib/detectRooms.ts`; and
the **real** `mcp/src/session.ts` `Session` (`loadPlan` → `set_scale` → `one_click` / `detect_rooms`).
Rows are keyed on the seed's coordinates, not its label, so duplicate room numbers cannot be paired
wrongly. Seeds = every room-number label the text layer yields, plus the bench corpus's own probe
seeds.

```bash
cd $S/wt-before/web && node --import tsx evprobe/a6.mts sample-finish-plan
cd $S/wt-after/web  && node --import tsx evprobe/a6.mts sample-finish-plan
# also: ... evprobe/a6.mts sample-plan
```

| | BEFORE | AFTER |
|---|---|---|
| canvas mask `mppf` | 8.9286 | 8.9286 |
| **MCP session mask `mppf`** | **0 (scale-blind)** | **8.9286** |
| seeds | 64 | 64 |
| **divergent seeds (VA plan)** | **25** | **0** |
| divergent seeds (sample-plan, 4 seeds) | 0 | 0 |
| MCP `one_click` confidence receipt | absent | present (e.g. 1.00) |

Every divergence on BEFORE, canvas / detectRegions / MCP one_click (SF):

| seed | BEFORE | AFTER |
|---|---|---|
| ward-vestibule @4045,1230 | **68.92 / 285.64 / 285.64** | 68.92 / 68.92 / 68.92 |
| ward-room @4050,486 | 235.31 / **285.64 / 285.64** | 235.31 / 235.31 / 235.31 |
| 706 @3396,1751 | **24.59 / 589.18 / 598.02** | 24.59 / 24.59 / 24.59 |
| 640 @2420,1478 | 406.74 / **504.50 / 504.50** | 406.74 / 406.74 / 406.74 |
| 557 @4064,2437 | 638.01 / 589.18 / **598.02** | 624.23 / 624.23 / 624.23 |
| patient-room-137 @2592,756 | 167.99 / 176.63 / **207.91** | 167.99 / 167.99 / 167.99 |
| 250 @4030,858 | 235.31 / 285.64 / 285.64 | 235.31 / 235.31 / 235.31 |
| 270 @2023,1078 | 158.05 / 183.89 / 183.89 | 158.05 / 158.05 / 158.05 |
| 189 @2013,484 | 145.72 / 153.32 / 153.32 | 145.72 / 145.72 / 145.72 |
| elevator-e01 @2538,1566 | 142.67 / 117.38 / 117.38 | 142.67 / 142.67 / 142.67 |
| cloud-corridor @1814,1814 | 1743.06 / 1717.97 / 1717.97 | 1743.06 / 1743.06 / 1743.06 |
| shaded-wing-office @659,1551 | 160.55 / 152.43 / 152.43 | 160.55 / 160.55 / 160.55 |
| patient-toilet-137a @2668,1112 | 41.20 / 40.63 / 40.63 | 41.20 / 41.20 / 41.20 |
| 144A @3873,977 | 54.84 / 54.07 / 54.26 | 54.84 / 54.84 / 54.84 |
| 411 @3371,1243 | 13.08 / 12.53 / 12.53 | 13.08 / 13.08 / 13.08 |
| 160 @3948,1923 | 3.25 / **0.26** / 3.25 | 3.25 / 3.25 / 3.25 |
| 159 @3854,2123 | **0.58** / 4.71 / 4.71 | 4.71 / 4.71 / 4.71 |
| 150 @4220,1686 | 1.81 / 0.61 / 0.61 | 1.81 / 1.81 / 1.81 |
| 133 @2663,1467 | 4.62 / 2.60 / 2.60 | 4.62 / 4.62 / 4.62 |
| 142 @3889,1133 | 0.61 / 0.79 / 0.79 | 0.61 / 0.61 / 0.61 |
| 151A, 157, 164, 170, 16 @2470,998 | measured by canvas + batch, **refused by MCP** | all three agree |

The one row flagged on AFTER (`16@102,3931`) is a probe artifact: two seeds share the label "16" and
MCP's `detect_rooms` found only one of them, so the pairing is ambiguous. The three seed-keyed paths
agree (leak / refused / refused).

*Reading:* the defect is real and the worst case is severe — 68.92 SF on the canvas versus 285.64 SF
from batch and MCP for the same click, a factor of 4.1, with all three stamping
`origin.method: "one_click_v1"`. On `sample-plan.pdf` (four plain rooms, no doors, no hatch, no gaps)
there is no divergence on either state, so a probe on that sheet alone would have concluded the
defect did not exist. AFTER, all three surfaces agree on every seed.

Two engine-behaviour changes on the VA sheet that A6 also exposes, on the **canvas** path itself:
`159@3854,2123` moves 0.58 → 4.71 SF and `557@4064,2437` moves 638.01 → 624.23 SF between BEFORE and
AFTER. Neither seed is in the bench corpus, so neither is gated by anything.

---

## A5b — the bench scored a ring the product never returned

**Probe** (`docs/evidence/probes/a5b.mts`). For every real-PDF corpus probe, computes both rings from
the *same* flood: the bench's `traceRegion(f)` and the product's
`snapVertices(traceRegion(f), nearestSnap(buildSnapGrid(points, 24)), 7)` — the identical expression
at three sites in `TakeoffCanvas.jsx` and one in `mcp/src/session.ts`, on both states.

```bash
cd $S/wt-before/web && node --import tsx evprobe/a5b.mts
cd $S/wt-after/web  && node --import tsx evprobe/a5b.mts
```

| probe | bench ring SF | production ring SF | Δ | BEFORE: err vs its golden (bench / prod) | AFTER: err vs its golden (bench / prod) |
|---|---|---|---|---|---|
| sample-plan × 4 | 436.18 | 437.98 | **+0.41%** | 0.00% / **+0.41%** | −0.41% / **0.00%** |
| va / patient-room-137 | 161.33 | 167.99 | **+4.13%** | −0.03% / **+4.10%** | −3.95% / **+0.02%** |
| va / patient-room-137-band | 19.04 | 20.67 | **+8.57%** | −0.05% / **+8.52%** | −7.83% / **+0.06%** |
| va / patient-toilet-137a | 39.26 | 41.20 | +4.96% | +0.04% / +5.01% | −4.73% / 0.00% |
| va / elevator-e01 | 136.75 | 142.67 | +4.32% | −0.02% / +4.30% | −4.12% / +0.03% |
| va / ward-room | 229.29 | 235.31 | +2.62% | −0.01% / +2.61% | −2.54% / +0.02% |
| va / ward-vestibule | 65.81 | 68.92 | +4.73% | −0.02% / +4.70% | −4.51% / +0.01% |
| va / cloud-corridor | 1706.33 | 1743.06 | +2.15% | +0.01% / +2.16% | −2.11% / 0.00% |
| va / shaded-wing-office | 153.69 | 160.55 | +4.46% | −0.02% / +4.45% | −4.26% / +0.02% |

The bench-ring and production-ring columns are **identical between BEFORE and AFTER** — the engine's
output did not change here at all. What changed is which of the two the goldens are pinned against.

*Reading:* on BEFORE the bench printed `SF±0.0%` for all eight VA rooms while the number a user reads
was 2.1–8.6% different, and that difference was gated by nothing. On AFTER the goldens are re-pinned
to the production ring (so the product is now within 0.06% everywhere) and the un-snapped raster
error is printed as an explicitly ungated "mask fidelity" table. This is a change to the *measuring
instrument*, not to the engine — and the AFTER bench header says so.

One consequence worth stating plainly: because the goldens moved, BEFORE's and AFTER's headline
`mean IoU` / `SF±` figures are **not comparable across states**. Any IoU improvement in the headline
block below is partly a re-pin, not an accuracy gain.

---

## A8 — hover cost

**Probe** (`docs/evidence/probes/a8.mts`, `a8b.mts`). The fixture is a 3000×3000 working mask
(== `MASK_MAX_DIM`, so `ws = 1` and this is the production cap) holding one 30 ft room ringed by 0, 1
or 6 drawn door swings — the shape the per-arc-cluster retry is slowest on. 5 trials; each trial
builds a fresh mask (empty `sealCache`), times one COLD `floodRegionSealed` and three WARM ones, and
tracks `process.memoryUsage().external`. `--expose-gc`, gc forced at the top of each trial.

```bash
cd $S/wt-before/web && node --expose-gc --import tsx evprobe/a8.mts   # and a8b.mts
cd $S/wt-after/web  && node --expose-gc --import tsx evprobe/a8.mts   # and a8b.mts
cd $S/wt-<state>/web && node --expose-gc --trace-gc --import tsx evprobe/a8b.mts   # GC-event count
```

| doors | state | cold ms min/median/max (n=5) | warm ms min/median/max (n=15) | peak external MB min/median/max |
|---|---|---|---|---|
| 0 | BEFORE | 95.0 / 105.4 / 156.6 | 26.6 / 33.6 / 76.8 | 42.9 / 42.9 / 68.6 |
| 0 | AFTER | 70.0 / 76.2 / 141.1 | 12.6 / **15.9** / 69.1 | 17.2 / 25.8 / 60.0 |
| 1 | BEFORE | 357.0 / 392.7 / 442.3 | 298.7 / 313.9 / 362.6 | 0 / 51.5 / 60.1 |
| 1 | AFTER | 96.4 / 113.6 / 166.4 | 51.3 / **62.9** / 105.0 | 0 / 25.7 / 34.3 |
| **6** | **BEFORE** | 1531.7 / **1605.4** / 1641.1 | 1417.4 / **1483.1** / 1640.5 | 0 / 8.6 / 60.1 |
| **6** | **AFTER** | 209.6 / **230.3** / 278.4 | 150.0 / **161.4** / 201.8 | 0 / 34.3 / 42.9 |

Speedups at the median: cold **7.0×**, warm **9.2×** at 6 doors; 6.2× / 5.0× at 1 door; 1.4× / 2.1×
at 0 doors (i.e. the gain is concentrated exactly on the door-retry path, as claimed).

Output fingerprint — status, `count`, `hardHits`, `softHits`, `sealedPx`, `virtualFrac`, `wedges`,
`wedgeGrowth`, an FNV-1a digest of the region bitmap, ring length and ring area:

| doors | BEFORE ≡ AFTER? | fingerprint (both) |
|---|---|---|
| 0 | **identical** | count 290521, hardHits 2116, wedges null, ring 4 verts, area 289444 |
| 1 | **identical** | count 290575, sealedPx 32, virtualFrac 0.021, wedges 1, growth 1.008, ring 5, area 289713 |
| 6 | **identical** | count 290845, hardHits 2764, sealedPx 32, virtualFrac 0.018, wedges 6, growth 1.052, digest `ba8591ed:290845`, ring 5, area 289713 |

**⚠ The memory claim could not be confirmed with the instrumentation available.** Both memory
metrics I could build are dominated by when V8 happens to collect, and both read *worse* on AFTER at
6 doors: sampled peak external median 8.6 MB (BEFORE) vs 34.3 MB (AFTER), and summed positive
`external` deltas over 20 frames 7.7 MB/frame (BEFORE) vs 10.3 MB/frame (AFTER). Neither is evidence
that AFTER allocates more — a 1483 ms frame gives the collector far more opportunity to run than a
161 ms one, so the faster engine's transient buffers are simply likelier to still be alive at the
sample point. The one memory-adjacent quantity that is not confounded this way is the **GC-event
count for the identical workload** (cold + 20 frames at 0, 1 and 6 doors, `--trace-gc`):

| | BEFORE | AFTER |
|---|---|---|
| total GC events | **671** | **210** (3.2× fewer) |
| Mark-Compact | **145** | **35** (4.1× fewer) |
| Scavenge | 526 | 175 |

Mark-Compacts are what large off-heap buffer allocation forces, so this is consistent with the
claimed churn reduction — but it is a proxy, not the 585 MB → 81 MB figure on record, which I could
not reproduce or refute.

---

## Also captured, both states

### Test count

| suite | BEFORE | AFTER |
|---|---|---|
| `web`: `node --import tsx --test test/*.test.ts` | **843 pass / 0 fail** | **934 pass / 0 fail** |
| `mcp`: `npm test` | **36 pass / 0 fail** | **36 pass / 0 fail** |

New AFTER test files: `benchProductionRing.test.ts` (193), `doorArcs.test.ts` (539),
`engineParity.test.ts` (205), `oneclickHoverCost.test.ts` (184), `rasterResolution.test.ts` (334),
`repinProtocol.test.ts` (368). Existing files grew: `geometry.test.ts` 944 → 974 lines,
`confidence.test.ts` 27 → 126, `resolutionInvariance.test.ts` 127 → 292, `benchScore.test.ts` 126 → 265.

### What `.github/workflows/ci.yml` actually runs

| job | BEFORE | AFTER |
|---|---|---|
| `web` | `npm ci`, `npm run typecheck`, `npm test`, `npm run build` | `npm ci`, `npm run typecheck`, **`npm run lint`**, `npm test`, **`npm run bench`**, `npm run build` |
| `web-e2e` | *(does not exist — `npm run e2e` existed in package.json but nothing ran it)* | new job: `npx playwright install --with-deps chromium`, **`npm run e2e`**, artifact upload on failure, 15-min timeout |
| `mcp` | ubuntu + windows: typecheck, test, build, smoke:dist | unchanged |
| `capture` | `python3 capture/capture_server.py selftest` | unchanged |

So on BEFORE, `npm run bench` and `npm run e2e` both existed and neither was ever executed by CI —
"bench gate green" was a manual claim. On AFTER both run.

### Bench headline block, verbatim

**BEFORE:**

```
── case coverage (Σ engine vs Σ golden, double-counted floor) ──
sample-plan                   4 probes | golden 1744.7 SF | engine 1744.7 SF (×1.000) | overlap 0.00 SF | worst room SF±0.0%
va-finish-plan                8 probes | golden 2511.5 SF | engine 2511.5 SF (×1.000) | overlap 0.02 SF | worst room SF±0.0%

golden probes: 21 | mean IoU 0.991 | floor IoU 0.957 | refusal 0.0% | leak 0.0%
refusal probes: 3 | correct 100.0% | known-fail tracked: 4
```

**AFTER:**

```
── case coverage (Σ engine vs Σ golden, double-counted floor) ──
sample-plan                   4 probes | golden 1751.9 SF | engine 1751.9 SF (×1.000) | overlap 0.00 SF (0.000%, gate 0.5%) | worst room SF±0.0%
va-finish-plan                8 probes | golden 2580.2 SF | engine 2580.4 SF (×1.000) | overlap 0.00 SF (0.000%, gate 0.5%) | worst room SF±0.1%
  (whole-case figures — a per-ROOM regression can hide inside them; see bench/pin-goldens.mts)

[…re-pin adjudications, mask-fidelity table…]

synthetic — PRODUCTION RINGS (trace+snap) vs goldens authored from the same numbers.
  Independent of the engine's own past output, but NOT a raw accuracy figure: the snap
  lands corners on the authored vertices, so this says "the flood found the right drawn
  boundary", not "the raster is this good" — for that, read mask fidelity above.
  n=9 | mean IoU 0.999 | floor IoU 0.990  [wall semantics: centerline]
engine-pinned (REGRESSION SAFETY ONLY — not accuracy; these are the engine's own past output):
  n=12 | mean IoU 0.999 | floor IoU 0.996

golden probes: 21 | mean IoU 0.999 | floor IoU 0.990 | refusal 0.0% | leak 0.0% (gating aggregate — see the split above before quoting the mean)
refusal probes: 3 (all synthetic) | correct 100.0% | known-fail tracked: 4
```

Both runs exit 0 and print `bench passed`. **The IoU improvement 0.991 → 0.999 is not an accuracy
gain**: the AFTER goldens were re-pinned to the production ring (A5b), so the two means measure
different things. The AFTER block says this itself, and splits the aggregate into an independent
synthetic half and an engine-pinned half — which BEFORE did not do.

### Does the bench fail when a corpus fixture is deleted?

Deleted `web/bench/corpus/va-finish-plan.json`, ran `npm run bench`, restored the file (`git status`
clean afterwards on both worktrees).

| state | exit code | last line |
|---|---|---|
| **BEFORE** | **0** | `bench passed` — it silently ran 13 probes instead of 21 and reported success |
| **AFTER** | **1** | `BENCH FAILED: expected 2 corpus case files, found 1; expected 21 golden probes, found 13 — a fixture was added or lost; expected 4 known-fails, found 3 — re-pin EXPECT deliberately` |

---

## What did NOT change

These are as much a part of the evidence as the movements. All measured, not assumed.

1. **A8 is bit-identical.** The region bitmap digest, cell count, `hardHits`, `softHits`, `sealedPx`,
   `virtualFrac`, `wedges`, `wedgeGrowth`, ring vertex count and ring area all match exactly at 0, 1
   and 6 doors on a 3000×3000 mask. The performance change moved no measured cell.
2. **The whole cap-bound VA A1 block is byte-for-byte identical** between BEFORE and AFTER —
   `ws`, mask dims, `mppf`, cell SF, ring SF, vertex counts, at rs 2.000, 2.070 and 2.0704. This is
   the *negative* result of A1's second half (see contradiction #1).
3. **A5b changed no engine output.** Bench-ring SF and production-ring SF are identical on both
   states for all 13 real-PDF probes; only the goldens moved.
4. **The real-door control in A4 is unchanged**: 2 374 cells / 7.33 SF annexed, final 494.83 SF, on
   both states. The curved-wall fix did not cost a genuine door swing.
5. **Doors keep their arc marking in A5**: single and double doors, polyline and bezier, 8/8 and
   16/16 door chords on both states, and both keep a non-zero wedge allowance.
6. **`sample-plan.pdf` is invariant across every probe**: A1 (437.377 cell SF, 436.176 ring SF at
   both render scales on AFTER), A6 (0 divergences on either state), A5b (bench/prod ring the same
   on both). A simple sheet exercises none of these defects — which is exactly why probing on it
   alone would have concluded there was nothing to fix.
7. **MCP test count is unchanged** (36 pass), and both suites are fully green on both states.
8. **The bench still exits 0 and prints `bench passed`** on both states in the normal run; the
   `sample-plan` case coverage is unchanged in structure (4 probes, ×1.000, 0.00 SF overlap).
9. **`markPolylineArcs`'s decisions are unchanged** for every fixture tested: the same chords carry
   `SEG_CURVE` on both states in all 16 fixture/form combinations. AFTER adds a *separate* plane
   (`MASK_NODOOR_BIT`), it does not un-mark curves — which is deliberate, since `SEG_CURVE` is also
   what exempts a chord from hatch classification.

---

## Limitations — what I could not measure, and why

1. **Memory churn (A8).** The 585 MB → 81 MB figure on record is a *cumulative allocation* number.
   Node exposes no allocator high-water mark; `process.memoryUsage().external` is a sampled level,
   and both of my derived metrics (sampled peak per trial, summed positive deltas over 20 frames)
   are dominated by GC scheduling and read *worse* on AFTER at 6 doors. I substituted a GC-event
   count under `--trace-gc` (671 → 210 events, 145 → 35 Mark-Compacts for an identical workload),
   which is consistent with the claim but does not verify the specific numbers.
2. **The "+37% / 97.8 → 134.0 SF" A1 figure could not be reproduced from the repo's own scene.**
   The `a1Scene()` preserved in `web/test/resolutionInvariance.test.ts` has a 1.78 ft gap, not the
   "0.60–0.63 ft slit" the audit describes, and produces 882.23 → 884.89 SF (+0.30%) across render
   scales. I rebuilt a scene of the described shape and measured −32.8% at slot 0.62–0.63 ft, which
   confirms the phenomenon at a comparable magnitude — but it is *my* scene, not the original.
3. **The synthetic half of the A5b comparison cannot run on BEFORE.** `SyntheticCase` on BEFORE has
   no `points` field (AFTER adds `snapPointsFor`), so there is no production snap grid for the
   synthetic fixtures on BEFORE and therefore no production ring to compare against. That absence is
   itself part of the finding, but it means A5b is measured on the two real-PDF cases only.
4. **`npm run e2e` was not run on either state.** It needs a Chromium download plus apt system libs
   (`npx playwright install --with-deps`), which this sandbox cannot install. The CI *definition* is
   compared above; the e2e suite's actual behaviour on either state is unmeasured.
5. **No raster (scanned-sheet) path was probed.** `buildRasterMask` requires rendered pixels; all
   probes here are vector. AFTER adds `rasterMaskScale`, `scanNativeScale` and DPI clamping which are
   entirely unexercised by this pack.
6. **A5's outcome-level effect is measured through the allowance, not through a flood.** I compared
   `wedgeAllowance` (AFTER) against a faithful re-implementation of BEFORE's bbox formula computed on
   each state's own mask. That isolates the guard correctly, but only A4 puts a shape on an actual
   room boundary and measures annexed floor end-to-end; the other seven shapes are never flooded
   against, so "8.6 SF of allowance" for the duct elbow is an upper bound on what it could hand
   over, not a demonstration that it does.
7. **Timing is from a 4-core sandbox at load average ≈1.3.** The A8 spread (min/median/max over 5
   cold and 15 warm samples) is reported precisely so the reader can judge the noise; the ratios
   (7–9× at 6 doors) are far outside it, but absolute milliseconds are machine-specific.
8. **`web/bench/results.json` and `pin-goldens.mts` were not re-derived.** I ran the bench and read
   its output; I did not independently re-measure the human-measured VA answer key, so "the goldens
   are correct" is not something this pack establishes — only that AFTER's goldens match what the
   product returns and BEFORE's matched what the bench returned.

---

## Probe inventory

| file | what it constructs | runs on BEFORE? |
|---|---|---|
| `a1.mts` | real corpus PDFs at baseline vs Hi-Res render scale + the repo's own slit scene | yes (7th `buildMask` arg dropped) |
| `a1b.mts` | 11×17 @ 1/8″, two rooms, one slot, 61 slot widths × 2 render scales | yes |
| `a3.mts` | oversize-through-a-0.40 ft-slot; dashed-line-as-wall; `two-doorways` | yes |
| `a4.mts` | 30 ft / 2.5 ft curved wall with no door; real 3′-0″ door control | yes |
| `a5.mts` | 8 shapes × polyline and bezier; chord flags + wedge allowance | yes (reads AFTER-only symbols off the namespace) |
| `a5b.mts` | bench ring vs production ring for every real-PDF corpus probe | yes |
| `a6.mts` | canvas vs `detectRegions` vs real MCP `Session`, seed-keyed | yes (needs `mcp/node_modules`) |
| `a8.mts` | 3000×3000, 0/1/6 doors, cold+warm timing, external sampling, output fingerprint | yes |
| `a8b.mts` | 20-frame churn proxy + GC-event count under `--trace-gc` | yes |

Probe sources are written (untracked) to `docs/evidence/probes/` in this worktree.
