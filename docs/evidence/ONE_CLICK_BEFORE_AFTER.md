# One-Click engine: measured before/after evidence pack

**BEFORE** = `21e57a0` (tip before any of this work) · **AFTER** = `94a5d46` on
`claude/issue-184-hatch-periodicity-fduafy` · **POST-FIX** = `7650f68`, the same branch after the
defect wave (`b277662` fixed F1/F2/F4/F5/F6; `7650f68` fixed F3 and F7(b,d,g))

Every number below was produced by running the same probe script against both states. Nothing is
copied from a commit message, a code comment, or `docs/audit/`. Where a claim on record did **not**
reproduce, or reproduced with a different magnitude, that is said so in the section.

> **POST-FIX RE-MEASURE (2026-07-30).** Everything above the line "Part 2 — POST-FIX re-measure"
> is the pack **as written at `94a5d46`, unaltered**: the BEFORE and AFTER columns are left exactly
> as they were measured, so the two rounds can be compared. Part 2 re-runs every probe against
> `7650f68`, adds four new probe sources plus a gate-perturbation harness, and states where the fix
> commits' own claims do and do not hold. Sections whose numbers moved carry a one-line
> `↳ POST-FIX:` pointer at the end. The short version:
>
> * **A1's headline row changes, but not the way the fix commits' summaries imply.** The F3 pin is
>   **opt-in through `buildMask`'s new 8th argument `page`**. `a1.mts` does not pass it, so `a1.mts`
>   output is **byte-for-byte identical on `94a5d46` and `7650f68`** and the −7.03% VA drift is still
>   there for any caller that omits `page`. Passing `page` as `TakeoffCanvas.ensureMask` now does
>   (probe `a1c.mts`) fixes the sub-cap sheet **completely** (byte-identical mask, 0.00% on all four
>   rooms, at rs 2.000 / 2.070 / 2.0704 / 5.374) and fixes the cap-bound VA sheet's **grid** — but
>   **not** its mask contents. **"Byte-identical on BOTH corpus sheets" is false** (contradiction #3).
> * **F8 is real, and its published band reproduces exactly** — 3.96% and 9.27% both land on the
>   nose. But the 9.27% is at a render scale the product cannot choose on that sheet, and at the
>   scales where it can, F8 costs **+2.03%**, not 9%. And the byte attribution that carries the
>   headline is only true at rs 2.07 (contradiction #5).
> * **The worst thing a VA-plan user can do with the Hi-Res toggle is unchanged**: +2.03% on
>   `ward-vestibule` before the fix and +2.03% after, because that probe's drift is entirely F8
>   (contradiction #8). Four more probes became exactly invariant, which is the real gain.
> * **F1's cliff is gone and the trimming path now carries provenance on 8 of 8 slot widths.** The
>   regressed state reproduces at 64.35 → 126.48 SF across one image pixel, at confidence 1.00.
> * **Two new contradictions, both about signals rather than measurements**: F7(g) corrected the
>   hover badge and the MCP receipt but **not** `confidence.ts`, so a round column's persisted
>   provenance now says `ring_interiors: 1` and `confidence_factors: ["door-swing-crossed(…)"]` on
>   the same shape (contradiction #6); and the free-standing column that annexes its own interior as
>   floor scores **0.97 on BEFORE and 1.00 on POST-FIX** — the deduction that used to mark it is
>   gone (contradiction #7).

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

> `↳ POST-FIX (7650f68):` **this section's numbers are byte-identical on `7650f68`** — `a1.mts` does
> not pass `buildMask`'s new `page` argument, so the F3 fix is a no-op for it and contradiction #1
> above still measures exactly true *for any caller that omits `page`*. Asked the way the canvas now
> asks it, the sub-cap sheet becomes byte-identical and the cap-bound sheet's grid is pinned; the
> −7.03% shrinks to −5.63% and the remainder is F8. See **§A1-POST** and **§F8** in Part 2, and
> contradictions **#3**, **#4** and **#5**.

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

> `↳ POST-FIX (7650f68):` **unchanged, and checked exactly** — `diff` of `a3.mts`'s whole output
> between `94a5d46` and `7650f68` is empty. The F1 fix scoped the min-passage gates and disturbed
> nothing here: the dashed property line is *still* a 484.00 SF room at 0.85 with `virtualFrac 0.000`.
> See **§A3-POST**.

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

> `↳ POST-FIX (7650f68):` **both blocks byte-identical** — the ellipse's 19.7 → 19.9 SF regression and
> the duct elbow's 8.6 SF are still there. What `7650f68` added is a *separate* counter, `ringWedges`,
> which corrects the CLAIM about closed rings without changing what they annex. Measured end-to-end
> (not through the allowance) in **§A5-POST**, with two new contradictions: **#6** the confidence
> factor still says `door-swing-crossed` on a scene with no door, and **#7** the free-standing column
> that annexes its own interior scores 0.97 on BEFORE and **1.00** on POST-FIX.

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

> `↳ POST-FIX (7650f68):` **every one of the 21 probe rows above is byte-identical on `7650f68`** —
> the fix wave moved the *instrument*, not the table. Three gates were added (absolute per-room SF,
> raw mask-fidelity floors, `xfailAtLeast`); **§A2-POST** shows by perturbation which defects each one
> now catches that the state this table was measured on called green.

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

> `↳ POST-FIX (7650f68):` **not re-run, and that is a gap rather than a pass.** `7650f68` pins the
> canvas mask to the page through `buildMask`'s new `page` argument; `detectRooms.ts` has no `page`
> parameter, so the batch and MCP surfaces cannot be pinned the same way. `a6.mts` renders every
> surface at one render scale, so it cannot see a difference that only appears across the Hi-Res
> toggle — it would report 0 divergent seeds either way. See contradiction **#4** and Part 2
> limitation **12**; this is the largest thing Part 2 could not measure.

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
---

# Part 2 — POST-FIX re-measure (`7650f68`)

Everything above this line is the pack as written at `94a5d46` and is unchanged. This part re-runs it
against `7650f68`. Same discipline: no number without a runnable source, contradictions first.

## How to reproduce Part 2

```bash
S=/tmp/claude-0/-home-user-opentakeoff/dbe6d1ab-0f3a-55b4-8dbe-8256f09f5b5d/scratchpad
git worktree add -b ev/before2 $S/wt-evb 21e57a0                                     # BEFORE
git worktree add -b ev/mid2    $S/wt-evm 71c53aa                                     # MID (F1 regressed)
git worktree add -b ev/packafter $S/wt-evp 94a5d46                                   # the pack's own AFTER
git worktree add -b ev/after2  $S/wt-eva origin/claude/issue-184-hatch-periodicity-fduafy   # POST-FIX
for w in evb evm evp eva; do ln -sfn $S/wt-184/web/node_modules $S/wt-$w/web/node_modules; done
ln -sfn $S/wt-184/mcp/node_modules $S/wt-eva/mcp/node_modules                        # A6 / a5c only
for w in evb evm eva; do mkdir -p $S/wt-$w/web/evprobe; \
  cp docs/evidence/probes/*.mts $S/wt-$w/web/evprobe/; done
```

Environment: node v22.22.2, 4 cores. Branch tip verified `7650f68` before any measurement
(`git rev-parse origin/claude/issue-184-hatch-periodicity-fduafy` →
`7650f689789451441b49b7a1ecc779402f4a9616`).

**The API change Part 2 had to adapt to.** `buildMask` gained an optional **8th** argument,
`page: MaskPage | null` = `{pageW, pageH, renderScale, baseScale}` — the sheet in PDF **points**
(`oneclick.ts:771`). It is the whole of the F3 fix. Two consequences for this pack:

1. `a1.mts` is preserved **unchanged** and still calls `buildMask` with 7 arguments. That is not
   laziness: `buildMask`'s own comment says "Without `page` the legacy px/ft reconstruction stands,
   so this is a no-op for every existing caller", and the re-run confirms it — `a1.mts`'s output is
   **byte-for-byte identical** on `94a5d46` and `7650f68` (`diff ev-a1-after.json e3-a1-post.json`
   → empty). So the pack's A1 rows are still exactly true *of a caller that omits `page`*.
2. A new probe, **`a1c.mts`**, asks the same question the way `TakeoffCanvas.ensureMask` now asks it
   (`TakeoffCanvas.jsx:2855-2857`), passing `page` from the sheet's scale-1 viewport. Everything in
   §A1-POST comes from it. `a1c.mts` also runs on BEFORE — JS drops the 8th argument there — and
   reports which state *honours* it behaviourally rather than by `Function.length` (default
   parameters are excluded from `.length`, so `buildMask.length` is 3 on both states; the naive check
   reads `false` on POST-FIX and would have been wrong). Measured: `honoursPageArg` **BEFORE false,
   POST-FIX true**.

---

## Revised headline table

`Δ` columns are versus the rs-2.000 render of the same sheet — the Hi-Res toggle OFF→ON question.

| # | Defect | Quantity measured | BEFORE | AFTER (`94a5d46`) | **POST-FIX (`7650f68`)** | Verdict |
|---|---|---|---|---|---|---|
| A1 | Hi-Res changed measured SF, **below** the cap | render scales (of 61 slot widths) where the toggle changes the answer | 61 / 61, worst −32.8% | 0 / 61 | 0 / 61 (`a1b.mts`, unchanged) | fixed, holds |
| A1 | …**cap-bound** sheet, caller that omits `page` | VA `patient-toilet-137a`, rs 2.000 → 2.070 | −7.03% | −7.03% | **−7.03%, byte-identical to AFTER** | **NOT fixed for such callers** |
| A1 | …**sub-cap** sheet, canvas-faithful (`page` passed) | `sample-plan`, mask cells differing / worst room drift, rs 2.000 / 2.070 / 2.0704 / 5.3743 | dims move at all three Hi-Res scales; worst room +0.20% | (probe did not exist) | **0 cells differing, 0.00% on all 4 rooms, at all four scales** | **fixed, byte-identical** |
| A1 | …**cap-bound** sheet, canvas-faithful | VA: mask dims · mask px per POINT · `mppf`, at rs 2.000 / 2.070 / 2.0704 / 2.070433 | 3000×2143 → **3000×2144**; 0.992063492 (already constant); `mppf` 8.928571 → **8.928115 / 8.928414 / 8.928558** | — | **3000×2143 · 0.992063492 · 8.928571 — identical at every scale** | **grid fixed** |
| A1 | …same, mask **contents** | VA, cells differing from rs 2.000 with `meta = null` | n/a (dims differ, so not comparable) | — | **65 @ 2.070, 1 994 @ autoRS 2.070433, 4 346 @ 2.0704** of 6 429 000 | **NOT byte-identical (contradiction #3)** |
| A1 | …**what a VA user can actually see**, canvas-faithful | VA, WORST probe drift across the only reachable toggle step (rs 2.000 → autoRenderScale 2.070433) | **`ward-vestibule` +1.58% cell / +2.03% ring**; 1 of 8 probes at exactly 0.00 | — | **`ward-vestibule` +1.58% / +2.03% — IDENTICAL**; 4 of 8 probes at exactly 0.00 | **worst case UNIMPROVED (contradiction #8)** |
| A1 | vector mask grid vs `rasterMaskScale` grid | both sheets, all four scales | `rasterMaskScale` does not exist | vector mask of `sample-plan` was **2449×1585** at Hi-Res (`a1.mts`); the raster grid at `94a5d46` was **not measured by this pack** | **equal at every scale on both sheets** (`a1c.mts` `rasterGridMatchesVector`) | fixed |
| **F8** | `extractVectorGeometry` is render-dependent | VA, worst probe drift with production meta, **production-reachable** scales only (rs 2.000 → autoRenderScale 2.070433) | — | — | **`ward-vestibule` +1.58% cell / +2.03% ring** | **unfixed by design — baseline set here** |
| **F8** | …same, any render scale tested | VA, worst probe drift | — | — | **`patient-room-137` −10.28% cell / −9.27% ring @ rs 5.374** | unfixed by design |
| **F8** | …the pin's own residual, isolated | VA, worst drift with `meta` **held at the baseline render's** | — | — | **0.00% @ rs 2.070; ≤ 0.09% cell / 0.00% ring @ autoRS** | the pin is not the cause |
| **F1** | Refused min-passage fell through to the raw flood | picket wall in a suite, 8 slot widths 0.267–0.533 ft | no cliff (spread **0.35 SF**) but **0/8 rows carry provenance** and **8/8 score 1.00** | (defect introduced by A3's fix, after the pack) | **spread 0.35 SF · 8/8 carry `min_pass_px` 6 + `min_pass_delta` ≈ 0.491 · 0/8 score 1.00 (all 0.99)** | fixed |
| **F1** | …the regressed state, for the record | same, MID = `71c53aa` | — | — | **64.35 SF @ 0.99 → 126.48 SF @ 1.00 across ONE image px (0.400 → 0.433 ft)**; 4/8 rows answer the suite bare | reproduced |
| A3 | Seal path bypassed its own guards | oversize-through-a-slot | `ok`, 749.7 SF, conf 1.00 | `leak` | `leak` — **probe output byte-identical to AFTER** | unchanged (good) |
| A3 | …dashed property line | 484 SF "room" | 484.00 SF, conf **1.00**, no provenance | 484.00 SF, conf **0.85**, `minPassPx 5` | **484.00 SF, conf 0.85 — byte-identical to AFTER** | **unchanged, as expected** |
| A4 | Curved wall annexed space behind it | annexed SF, no door in scene | +47.6 SF, conf 0.97 | 0 SF, conf 0.84 | **byte-identical to AFTER** | unchanged (good) |
| A5 | Non-doors as door arcs | wedge allowance, 8 shapes × 2 forms | cloud 51.0, column 7.3, elbow 8.7 | 0, 5.9, **8.6** | **byte-identical to AFTER** | unchanged |
| A5 | negative control: bezier ellipse | door-allowance SF | 19.7 | **19.9 (worse)** | **19.9 — regression persists** | **still regressed** |
| A5 | negative control: duct elbow | door chords · allowance | 16/16 · 8.7 SF | 16/16 · 8.6 SF | **16/16 · 8.6 SF** | still unflagged |
| **A5c** | A ring's interior claimed as a **door swing** | round column / callout bubble on a room boundary | `wedges 1`, badge `· incl. door swing`, no ring receipt | — | **`ringWedges 1`, badge `· incl. ring interior`, MCP `ring_interiors: 1`** | messaging fixed |
| **A5c** | …the measurement under it | free-standing 3 ft column, annexed floor | 476.52 → 483.65 SF, **+7.13 SF** (πr² = 7.07) | — | **476.52 → 483.65 SF, +7.13 SF — identical** | pinned, unchanged |
| **A5c** | …and its confidence | same scene | **0.97** | — | **1.00** | **regressed (contradiction #7)** |
| A2 | Confidence vs error | every golden probe's IoU / SF± / conf | 5 probes > 2.5% err at 0.95–1.00 | 3 at 1.00, 0.85, 0.85 | **all 21 rows byte-identical to AFTER** | unchanged |
| A2 | …what the bench now **catches** | 3 isolating perturbations, `gates.py` | — | **0 / 3 caught** (`bench passed` on a 24.41 SF golden divergence, on a raw-IoU fall to 0.750, and on a confidence collapse to 0.75 inside an exemption) | **3 / 3 caught** | gates real |
| A8 | Hover cost guard | `test/oneclickHoverCost.test.ts` | (guard did not exist) | 3 pass | **3 pass** | holds |
| — | test count (`web`) | | 843 | 934 | **968** | +34 since AFTER |
| — | test count (`mcp`) | | 36 | 36 | **36** | unchanged |
| — | corpus goldens | every non-prose leaf value, `23e87f7..HEAD` | — | — | **51 + 639 values, 0 changed, 0 added, 0 removed** | byte-identical |

---

## ⚠ Contradictions found by the POST-FIX re-measure

Numbered continuing from the two in Part 1. **#3–#7 are here; #8 sits inside §A1-POST**, where the
table it depends on already is.

| # | in short | severity |
|---|---|---|
| **#3** | the pinned mask is byte-identical on `sample-plan` but not on the VA plan (65–4 346 cells of 6 429 000) | cosmetic in effect (≤ 0.09% SF), but it is the claim a regression would be checked against |
| **#4** | the F3 pin is **opt-in** through `buildMask`'s `page`; `detectRooms.ts` has no such parameter, so the MCP/batch surfaces cannot take it | **unmeasured risk to A6's "one engine" result** |
| **#5** | F8's 3.96–9.27% band reproduces exactly, but 9.27% is ~99% device-line-width, not `markPolylineArcs`, and is at an unreachable render scale | corrects the emphasis of a filed defect |
| **#6** | F7(g) corrected the hover badge and the MCP receipt but not `confidence.ts`; one shape's provenance now carries `ring_interiors: 1` **and** `door-swing-crossed(…)` | user-visible receipt contradicts itself |
| **#7** | the free-standing column that annexes 7.13 SF of its own interior as floor scored 0.97 on BEFORE and **1.00** on POST-FIX | **a signal was lost by the fix wave** |
| **#8** | on the only reachable Hi-Res step of the only cap-bound corpus sheet, the worst probe drift is +2.03% before **and** after | the headline gain does not reach the worst case |

### ⚠ Contradiction #3 — "byte-identical across render scales on both corpus sheets" is false

The re-measure brief and the handoff (`docs/audit/ISSUE_184_HANDOFF.md`: "The A1 mask pin is now
essentially exact on sub-cap AND cap-bound sheets, vector and raster grids byte-identical") invite the
reading that the **mask** is byte-identical. On `sample-plan` (sub-cap) it is, at all four render
scales, with and without production meta. On the **VA finish plan** (cap-bound) it is not:

| rs | reachable on this sheet? | mask dims | mask px / POINT | `mppf` | cells differing vs rs 2.000, `meta = null` |
|---|---|---|---|---|---|
| 2.0000 | yes (Hi-Res OFF) | 3000×2143 | 0.992063492 | 8.928571 | 0 |
| 2.0700 | no | 3000×2143 | 0.992063492 | 8.928571 | **65** |
| 2.0704 | no | 3000×2143 | 0.992063492 | 8.928571 | **4 346** |
| 2.070433 | yes (autoRenderScale) | 3000×2143 | 0.992063492 | 8.928571 | **1 994** |
| 3.0000 | no | 3000×2143 | 0.992063492 | 8.928571 | **980** |
| 5.3740 | no | 3000×2143 | 0.992063492 | 8.928571 | **1 896** |

`gridDiffVsBaseline_noMeta` in `a1c.mts`; `variants.C.maskCellsDiffering` in `f8.mts`. What **is**
render-free is every *derived* quantity: dims, `ws`·`renderScale`, `mppf`, mask px per point, and the
identity with `rasterMaskScale`'s grid. What still moves is which cell a segment endpoint rounds into:
`segs` come out of pdf.js at the render scale, so `seg × ws` is render-independent only in exact
arithmetic, and 1 994 of 6 429 000 cells (0.031%) land on the other side of a `Math.round`.

**This is a small effect, and the fix commit does not claim otherwise** — `7650f68`'s message says
"Real VA plan, grid + ws + mppf now identical at every scale", which is precisely and only what
measures true. The correction is to the *summary*, not to the commit. Consequence for a user: on the
VA sheet the residual grid drift alone costs **≤ 0.09% cell / 0.03% ring** on any of the eight probes
(`f8.mts` variant C), i.e. nothing. It is recorded because "byte-identical" is the claim a future
regression would be checked against, and on this sheet it is not the true one.

### ⚠ Contradiction #4 — the F3 fix is opt-in, and one shipped caller still does not take it

`buildMask`'s `page` argument defaults to `null`, and with `page` absent the old render-dependent
reconstruction runs unchanged. That is deliberate and documented ("this is a no-op for every existing
caller (the bench and its goldens included)"), and it is why no golden moved. But it means the A1 fix
is a property of the **call site**, not of the engine, and the pack's own probe demonstrates the
failure mode: `a1.mts` omits `page` and still measures **−7.03%** on `patient-toilet-137a`, on
`7650f68`, byte-identical to `94a5d46`.

Audited call sites of `buildMask` on `7650f68`:

| call site | passes `page`? | measured consequence |
|---|---|---|
| `TakeoffCanvas.jsx:2855` `ensureMask` (canvas one-click, live preview, agent tool) | **yes** | pinned; §A1-POST |
| `web/bench/run.mts:143` | **no** | by design — pinning it would move goldens; the bench renders at one scale only, so it has no drift to expose |
| `web/test/*` | mixed | the F3 guard passes it; older tests do not |
| `mcp/src/session.ts` (via `detectRegions`) | **no** — `detectRooms.ts` has no `page` parameter to pass | **unmeasured; see Limitation 12** |

The MCP row is the one that matters: A6's whole finding was that the canvas and the MCP/batch surfaces
must measure with one engine, and at `94a5d46` they did (0 divergent seeds of 64). On `7650f68` the
canvas is pinned to the page and `detectRegions` is not, so **the two surfaces are pinned differently
whenever the canvas is not at `RENDER_SCALE`.** That cannot be shown to diverge with `a6.mts`, which
renders both at one scale — see Limitation 12. It is flagged, not measured.

### ⚠ Contradiction #5 — F8's headline attribution holds only at the render scale it was measured at

`docs/audit/ISSUE_184_HANDOFF.md` files F8 as: "with production meta it is 3.96–9.27%. Every differing
meta byte at rs 2.07 is `markPolylineArcs`' arc marking… `extractVectorGeometry` is render-dependent
by up to 9.3% on the VA plan."

Both numbers reproduce **exactly** (see §F8, the whole point of an independent probe). The attribution
does not travel with them:

| rs | meta bytes differing / 71 819 | `SEG_CURVE\|SEG_POLYARC` (`markPolylineArcs`) | device-line-width nibble | worst ring drift |
|---|---|---|---|---|
| 2.070 | 65 | **65 = 100%** | 0 | **−3.96%** |
| 2.0704 | 71 | 71 = 100% | 0 | −8.89% |
| 2.070433 (autoRS) | 40 | 40 = 100% | 0 | +2.03% |
| 3.000 | 42 898 | 278 = **0.65%** | 42 620 = 99.3% | −9.51% |
| 5.374 | 69 185 | 662 = **0.96%** | 68 523 = 99.0% | **−9.27%** |

So the 3.96% end of the band is 100% `markPolylineArcs`, and the 9.27% end is ~99% the **ceil'd
device line width**, a different mechanism. The handoff does mention "ceil'd width nibbles at high
rs" in a subordinate clause, so this is a correction to emphasis, not a falsification — but a reader
who fixes `markPolylineArcs` and expects the 9.3% to go away will be surprised.

**And the more important qualification:** rs 3.000 and 5.374 are **not reachable** on the VA sheet.
`autoRenderScale(3024, 2160)` = 2.070433 (verified against `canvasUtil.js:24-30` and
`canvasConstants.js:21-24`), so the only two states a user can put this sheet in are rs 2.000 and
rs 2.070433. Between those two, F8 costs **+1.58% cell / +2.03% ring** on `ward-vestibule`, and four of
the eight probes read exactly 0.00% / 0.00%. **The user-facing size of F8 on this sheet is ~2%, not
9.3%** — and it is also the whole of what contradiction #8 says did not improve.
The 9.27% is a real property of `extractVectorGeometry` and a fair upper bound for sheets small
enough to reach rs 5.374 — it is not what this sheet does.

### ⚠ Contradiction #6 — F7(g) fixed three receipts and left the fourth asserting a door swing

`7650f68` claims: "the canvas readout no longer says 'incl. door swing' for a full circle with no door
in the scene… `mcp` reports it as `ring_interiors`." True, measured, three surfaces (`a5c.mts`):
the hover badge, the commit message, and MCP's `ring_interiors`. The fourth receipt was missed.
`floodSignals` (`confidence.ts:128-146`) forwards eleven `FloodResult` fields into `ConfidenceInput`
and **`ringWedges` is not among them**; `confidence.ts` contains no occurrence of `ringWedges` at all.
So `traceConfidence` still emits:

```
factors: ["door-swing-crossed(1.5% annexed swing)"]
```

on a scene with **no door in it**. Those factors are not internal — they are persisted as
`origin.confidence_factors` on every created shape (`TakeoffCanvas.jsx:3122`) and returned by MCP
`one_click` (`mcp/src/session.ts:316`, declared in `mcp/src/outputs.ts:64`). Measured on POST-FIX,
`a5c.mts` field `factorContradictsRingInteriors`: **true on all four ring scenes, false on the real
door**. So one shape's provenance carries `ring_interiors: 1` and
`confidence_factors: ["door-swing-crossed(…)"]` side by side, and the estimator reading the receipt is
told a door swing was crossed on a plan with no door.

### ⚠ Contradiction #7 — the column that annexes its own interior as floor now scores 1.00

The same probe, scene 5: a free-standing 3 ft round column inside a room. The retry annexes
**+7.13 SF** (πr² = 7.07 SF, so it is the column's own interior, not the space beyond it) and the
centre cell flips from 0 to 1. The measurement is **identical on BEFORE and POST-FIX** — 476.52 →
483.65 SF both states — and is deliberately corpus-pinned pending an operator policy decision.
The **confidence moved the wrong way**:

| state | annexed | `wedges` | `ringWedges` | `wedgeGrowth` | conf | factors |
|---|---|---|---|---|---|---|
| BEFORE | +7.13 SF | 1 | absent | 1.015 | **0.97** | `door-swing-crossed` |
| POST-FIX | +7.13 SF | 1 | 1 | 1.015 | **1.00** | `door-swing-crossed(1.5% annexed swing)` |

Cause: A2's improvement made the wedge deduction proportional to the annexed share
(`WEDGE_ANNEX_REF = 0.10`, `confidence.ts:172-176`), and 1.5% of 0.10 rounds the score back to 1.00.
The factor **string** survives, so a consumer reading `factors` still sees something; a consumer
gating on `score < 1` — which is what `minPassGate.test.ts` itself uses as the marker that "the engine
did something" — now sees nothing at all on the one scene in this pack where the engine hands a
structural column to the floor. This is the same class of signal loss F1 was about, in a different
place, and it arrived with the fix wave.

---

## §A1-POST — the Hi-Res toggle, asked the way the canvas asks it

**Probe** `docs/evidence/probes/a1c.mts`. Identical file on both worktrees. Calls `buildMask` with
all eight arguments exactly as `TakeoffCanvas.jsx:2855-2857` does — `pxPerFt`,
`pxPerFt · RENDER_SCALE / rsNow`, and `{pageW, pageH, renderScale: rsNow, baseScale: RENDER_SCALE}`
from the scale-1 viewport. For each sheet it builds the mask **twice** at every render scale: once with
`meta = null` (the pure geometry grid) and once with the production `meta`, so grid drift and meta
drift are separable. It also calls `rasterMaskScale` for the same sheet, so the vector/raster grid
identity is measured rather than assumed.

```bash
cd $S/wt-evb/web && node --import tsx evprobe/a1c.mts    # BEFORE (8th arg dropped by JS)
cd $S/wt-eva/web && node --import tsx evprobe/a1c.mts    # POST-FIX
```

### `sample-plan.pdf` — sub-cap, and now exactly invariant

| state | rs | image | `ws` | mask | `mppf` | mask px/pt | cells differing vs rs 2.0 (`meta=null` / with meta) | worst room Δ |
|---|---|---|---|---|---|---|---|---|
| BEFORE | 2.0000 | 2448×1584 | 1.000000 | 2448×1584 | 36.0000 | 2.000000 | 0 / 0 | — |
| BEFORE | 2.0700 | 2534×1640 | 1.000000 | **2534×1640** | **37.2600** | **2.070261** | dims differ | +0.20% |
| BEFORE | 2.0704 | 2535×1640 | 1.000000 | **2535×1640** | **37.2672** | **2.071078** | dims differ | +0.17% |
| BEFORE | 5.3743 | 6579×4257 | 0.455996 | **3000×1942** | **44.1123** | **2.450980** | dims differ | +0.16% |
| **POST-FIX** | 2.0000 | 2448×1584 | 1.00000000 | 2448×1584 | 36.000000 | 2.000000 | 0 / 0 | — |
| **POST-FIX** | 2.0700 | 2534×1640 | 0.96618357 | **2448×1584** | **36.000000** | **2.000000** | **0 / 0** | **0.00%** |
| **POST-FIX** | 2.0704 | 2535×1640 | 0.96599691 | **2448×1584** | **36.000000** | **2.000000** | **0 / 0** | **0.00%** |
| **POST-FIX** | 5.3743 | 6579×4257 | 0.37213822 | **2448×1584** | **36.000000** | **2.000000** | **0 / 0** | **0.00%** |

All four rooms, both `cellSF` and `ringSF`, 0.00% at every scale. `rasterGridMatchesVector` **true**
at all four scales — and note this is the ±1-cell split `7650f68` was written to close: at `94a5d46`
the vector mask of this sheet was 2449×1585 at Hi-Res while `rasterMaskScale` said 2448×1584
(`a1.mts`'s AFTER column shows the 2449×1585). Closed.

### `sample-finish-plan.pdf` (VA) — cap-bound: the grid is pinned, the contents are not

| state | rs | `ws` | mask | `mppf` | mask px/pt | raster grid | cells differing, `meta=null` | cells differing, production meta |
|---|---|---|---|---|---|---|---|---|
| BEFORE | 2.0000 | 0.49603175 | 3000×2143 | 8.928571 | 0.992063 | n/a | 0 | 0 |
| BEFORE | 2.0700 | 0.47923323 | **3000×2144** | **8.928115** | 0.992063 | n/a | dims differ | dims differ |
| BEFORE | 2.0704 | 0.47915668 | **3000×2144** | **8.928414** | 0.992063 | n/a | dims differ | dims differ |
| BEFORE | 2.070433 | 0.47915668 | **3000×2144** | **8.928558** | 0.992063 | n/a | dims differ | dims differ |
| **POST-FIX** | 2.0000 | 0.49603175 | 3000×2143 | **8.928571** | 0.992063492 | **3000×2143 ✔** | 0 | 0 |
| **POST-FIX** | 2.0700 | 0.47925773 | **3000×2143** | **8.928571** | 0.992063492 | **3000×2143 ✔** | **65** | 13 472 |
| **POST-FIX** | 2.0704 | 0.47916513 | **3000×2143** | **8.928571** | 0.992063492 | **3000×2143 ✔** | **4 346** | 19 722 |
| **POST-FIX** | 2.070433 | 0.47915742 | **3000×2143** | **8.928571** | 0.992063492 | **3000×2143 ✔** | **1 994** | 16 238 |

Per-probe drift with production meta, rs 2.000 → the two Hi-Res values, POST-FIX vs BEFORE
(cell % / ring %):

| probe | BEFORE @ 2.070 | POST @ 2.070 | BEFORE @ autoRS 2.070433 | POST @ autoRS |
|---|---|---|---|---|
| `patient-room-137` | −0.60 / −0.31 | **0.00 / 0.00** | −0.14 / +0.24 | **0.00 / 0.00** |
| `patient-room-137-band` | −0.23 / −0.19 | **0.00 / 0.00** | −0.24 / −0.20 | **0.00 / 0.00** |
| `patient-toilet-137a` | **−7.03 / −5.64** | **−5.63 / −3.96** | −0.83 / −0.48 | **+0.07 / +0.48** |
| `elevator-e01` | +0.02 / +0.01 | **0.00 / 0.00** | 0.00 / 0.00 | **0.00 / 0.00** |
| `ward-room` | +0.30 / +0.25 | **0.00 / 0.00** | +0.33 / +0.43 | **0.00 / 0.00** |
| `ward-vestibule` | +1.57 / +2.84 | +1.61 / **+2.88** | +1.58 / +2.03 | +1.58 / **+2.03** |
| `cloud-corridor` | +0.01 / −0.03 | 0.00 / −0.04 | 0.00 / −0.04 | 0.00 / −0.04 |
| `shaded-wing-office` | +0.11 / +0.01 | **0.00 / 0.00** | +0.09 / 0.00 | +0.09 / 0.00 |

*Reading:* the pack's headline row **does** change, and mostly in the right direction. At rs 2.070 the
worst cap-bound drift falls from −7.03% / −5.64% to −5.63% / −3.96%; four of the eight probes go from
non-zero to exactly 0.00% / 0.00% at the production Hi-Res scale, and `patient-room-137` and
`patient-room-137-band` become exactly invariant. What survives is not the pin — it is F8, isolated
next.

But the sentence a user cares about is worse than that, and it is contradiction #8 below.

### ⚠ Contradiction #8 — on the one corpus sheet where Hi-Res is reachable, the WORST drift did not move

`autoRenderScale(3024, 2160) = 2.070433`, so rs 2.000 → 2.070433 is the *only* toggle step available
on the VA plan. Across that step, **the worst probe drift is bit-for-bit the same on BEFORE and
POST-FIX**:

| probe | BEFORE, rs 2.000 → 2.070433 (cell / ring) | POST-FIX, same step |
|---|---|---|
| `patient-room-137` | −0.14 / +0.24 | **0.00 / 0.00** |
| `patient-room-137-band` | −0.24 / −0.20 | **0.00 / 0.00** |
| `patient-toilet-137a` | −0.83 / −0.48 | +0.07 / +0.48 |
| `elevator-e01` | 0.00 / 0.00 | 0.00 / 0.00 |
| `ward-room` | +0.33 / +0.43 | **0.00 / 0.00** |
| **`ward-vestibule`** | **+1.58 / +2.03** | **+1.58 / +2.03 ← unchanged** |
| `cloud-corridor` | 0.00 / −0.04 | 0.00 / −0.04 |
| `shaded-wing-office` | +0.09 / 0.00 | +0.09 / 0.00 |
| probes at exactly 0.00 / 0.00 | **1 of 8** | **4 of 8** |
| worst | `ward-vestibule` **+2.03% ring** | `ward-vestibule` **+2.03% ring** |

So: A1's cap-bound half is genuinely fixed *as a pin* — the grid stops moving, and three more probes
become exactly invariant. But **the largest square-footage change a user of this sheet can produce by
touching the Hi-Res toggle is +2.03% before the fix and +2.03% after it**, on `ward-vestibule`, because
that probe's drift is entirely F8 and F8 is untouched by design. Any summary that reads "A1 is fixed on
cap-bound sheets" without the F8 caveat overstates what a VA-plan user gets. The −7.03% figure that
headed Part 1 is real but is measured at rs 2.070, a scale this sheet cannot be rendered at in the
product; at the scale it *can* reach, the number was −0.83% before and is +0.07% now, and the worst
number on the sheet was and remains +2.03%.

---

## §F8 — the residual, and its baseline (BEFORE == AFTER == POST-FIX; unfixed by design)

**Probe** `docs/evidence/probes/f8.mts`. On the VA plan, at six render scales, it builds three masks
on the **same pinned grid** and floods the same eight seeds through each:

* **A** — `meta` as **this** render produced it. Production behaviour.
* **B** — `meta` held at the **baseline** render's array. Possible because the chord count is
  render-invariant on this sheet (71 819 at every scale, asserted in the output). Isolates the grid.
* **C** — `meta = null`. Pure geometry raster.

`A − B` is what F8 owns. It also XORs each differing meta byte against the baseline's and attributes
it to the bits that moved.

```bash
cd $S/wt-eva/web && node --import tsx evprobe/f8.mts
```

| rs | reachable? | meta bytes ≠ / 71 819 | attribution | **A** cells ≠ / 6 429 000 | **B** cells ≠ | **C** cells ≠ | **A** worst drift (cell / ring) | **B** worst drift |
|---|---|---|---|---|---|---|---|---|
| 2.000 | **yes** (OFF) | 0 | — | 0 | 0 | 0 | 0.00 / 0.00 | 0.00 / 0.00 |
| 2.070 | no | 65 | 100% `SEG_CURVE\|SEG_POLYARC` | 13 472 | **98** | 65 | `patient-toilet-137a` **−5.63 / −3.96** | **0.00 / 0.00** |
| 2.0704 | no | 71 | 100% `SEG_CURVE\|SEG_POLYARC` | 19 722 | 5 021 | 4 346 | `patient-room-137` **−9.82 / −8.89** | −0.14 / +0.24 |
| 2.070433 | **yes** (ON) | 40 | 100% `SEG_CURVE\|SEG_POLYARC` | 16 238 | 2 275 | 1 994 | `ward-vestibule` **+1.58 / +2.03** | +0.09 / 0.00 |
| 3.000 | no | 42 898 | 42 620 nibble · 278 arc | 20 169 | 1 046 | 980 | `patient-room-137` **−10.14 / −9.51** | +0.01 / +0.01 |
| 5.374 | no | 69 185 | 68 523 nibble · 662 arc | 21 979 | 2 219 | 1 896 | `patient-room-137` **−10.28 / −9.27** | −0.14 / +0.24 |

Absolute SF for the two probes that move most (variant A, ring SF):

| probe | rs 2.000 | rs 2.070 | rs 2.070433 (reachable) | rs 5.374 |
|---|---|---|---|---|
| `patient-room-137` | 161.328 | 161.328 | 161.328 | **146.370** |
| `patient-toilet-137a` | 39.256 | **37.701** | 39.445 | 38.272 |
| `ward-vestibule` | 65.812 | 67.706 | **67.148** | 65.812 |
| `ward-room` | 229.292 | 229.292 | 229.292 | 234.673 |

**The F8 baseline, stated for the next change to be measured against:**

1. With the mask grid pinned and `meta` held at baseline, worst probe drift over all six scales is
   **−0.14% cell / +0.24% ring**, and **0.00% on every probe at rs 2.070**. The pin is not the cause.
2. With production meta, worst drift is **−10.28% cell / −9.27% ring** (`patient-room-137`, rs 5.374)
   and **−5.63% / −3.96%** (`patient-toilet-137a`, rs 2.070). The handoff's "3.96–9.27%" band
   reproduces to the digit, independently.
3. F8's share of the residual: at rs 2.070, B drift is 0.00% and A drift is −3.96% ⇒ **100%**. At the
   production Hi-Res scale, B ≤ 0.09% against A up to 2.03% ⇒ **≥ 94%**. At rs 2.0704, B +0.24%
   against A −8.89% ⇒ **≈ 97%**. Agent E's "94–97%" is confirmed; my range is **94–100%**.
4. **Production exposure on this sheet is ~2%, not ~9%** — see contradiction #5.
5. Mechanism, measured not inferred: at every reachable and near-reachable scale, **100%** of differing
   meta bytes are `SEG_CURVE|SEG_POLYARC`, i.e. `markPolylineArcs`. At rs ≥ 3 the ceil'd device
   line-width nibble takes over (99%+).

BEFORE cannot be given an F8 column: without the pin the grid moves too, so A/B/C there measure the
old compound defect, not this one. That is the finding, not a gap — F8 is only *separable* on a state
where the grid is pinned. Nothing in `b277662` or `7650f68` touches `extractVectorGeometry`, so
**BEFORE == AFTER == POST-FIX for F8** in the only sense available: **both implicated functions are
byte-identical across all three commits.** Verified by extracting each function body from
`21e57a0:web/src/lib/oneclick.ts` and `7650f68:web/src/lib/oneclick.ts` and comparing:
`markPolylineArcs` **identical**, `extractVectorGeometry` **identical** — while the file as a whole has
1 063 changed lines. So no F8 before/after column can exist, and none is claimed.

---

## §F1-POST — the min-passage fall-through (new section; the defect postdates Part 1)

**Probe** `docs/evidence/probes/f1.mts`. The scene is `web/test/minPassGate.test.ts`'s, verbatim:
a room whose wall is drawn as a picket run — 2 px dashes separated by `slotPx` gaps — inside a
solidly walled suite. 911×756 image px at 30 px/ft, mask at `maxDim 700` so the working raster lands
at **23.0516 px/ft** and `minPassRadiusFor` = **6**. Room footprint 63.56 SF; the suite the raw flood
reaches is 128.00 SF. **Seven** of the eight slots swept (0.267–0.500 ft) are at or below
`MIN_PASS_FT` = 0.5, so "these dashes do not connect two spaces" is the correct verdict on them; the
eighth (16 px = 0.533 ft) sits just *above* the threshold and is swept anyway, to show the answer does
not cliff at the boundary either. The probe reports `subMinPass` per row so this is checkable rather
than asserted. `suite: false` repeats the sweep with
the room alone on the sheet, where the verbatim flood is unbounded and the rule is *creating*
boundedness rather than *trimming* — the case the gates were written for.

```bash
for w in evb evm eva; do (cd $S/wt-$w/web && node --import tsx evprobe/f1.mts); done
```

Trimming path (`suite: true`), cell SF @ confidence:

| slot | ft | raw flood | **BEFORE `21e57a0`** | **MID `71c53aa`** | **POST-FIX `7650f68`** |
|---|---|---|---|---|---|
| 8 px | 0.267 | ok, 126.34 | 64.06 @ **1.00**, no provenance | 64.06 @ 0.99, `mp 6 δ0.493` | 64.06 @ 0.99, `mp 6 δ0.493` |
| 10 px | 0.333 | ok, 126.40 | 64.24 @ **1.00**, none | 64.24 @ 0.99, `δ0.492` | 64.24 @ 0.99, `δ0.492` |
| 11 px | 0.367 | ok, 126.41 | 64.30 @ **1.00**, none | 64.30 @ 0.99, `δ0.491` | 64.30 @ 0.99, `δ0.491` |
| 12 px | 0.400 | ok, 126.46 | 64.35 @ **1.00**, none | 64.35 @ 0.99, `δ0.491` | 64.35 @ 0.99, `δ0.491` |
| **13 px** | **0.433** | ok, 126.48 | 64.37 @ **1.00**, none | **126.48 @ 1.00, none** ← the cliff | **64.37 @ 0.99, `δ0.491`** |
| 14 px | 0.467 | ok, 126.50 | 64.39 @ **1.00**, none | **126.50 @ 1.00, none** | 64.39 @ 0.99, `δ0.491` |
| 15 px | 0.500 | ok, 126.52 | 64.41 @ **1.00**, none | **126.52 @ 1.00, none** | 64.41 @ 0.99, `δ0.491` |
| 16 px | 0.533 | ok, 126.52 | 64.41 @ **1.00**, none | **126.52 @ 1.00, none** | 64.41 @ 0.99, `δ0.491` |

| | BEFORE | MID | POST-FIX |
|---|---|---|---|
| worst adjacent-slot jump | 0.18 SF (8→10 px) | **62.13 SF (12→13 px): 64.35 → 126.48** | **0.18 SF (8→10 px)** |
| spread across the sweep | 0.35 SF | **62.46 SF** | **0.35 SF** |
| rows answering the **suite** | 0 | **4 of 8** | **0** |
| rows with **no** min-pass provenance | **8 of 8** | 4 of 8 | **0 of 8** |
| rows scoring exactly **1.00** | **8 of 8** | 4 of 8 | **0 of 8** |
| creating path (`suite:false`), 8→16 px | `ok` ×8 — **no gate at all** | `ok,ok,ok,ok,leak,leak,leak,leak` | `ok,ok,ok,ok,leak,leak,leak,leak` |
| factor string, trimming path | *(none)* | `min-passage-rule(49.1% of the verbatim flood removed)` | same |

*Reading, three states:*

* **BEFORE** had no cliff — because it had no min-passage gate at all. It answered the room, at
  **confidence 1.00, with zero provenance on every one of the eight widths**. The brief's phrase
  "no cliff but no min-passage at all" measures exactly true: `minPassPx`, `minPassDelta`,
  `sealedPx` and `virtualFrac` are all null on all eight rows, and the creating path returns `ok` on
  all eight too, i.e. it will mint a dilation-invented room and say nothing.
* **MID** (`71c53aa`, after A3 put the ladder's gates on the min-passage path unconditionally) has
  the cliff the brief describes: **64.35 SF → 126.48 SF when the slots widen by one image pixel**,
  0.400 → 0.433 ft, and the doubled answer arrives **bare, at 1.00** — the refused region fell
  through to the raw flood and nothing downstream could tell. The brief's "64.4 → 126.6" is this row;
  measured, it is 64.35 → 126.48 (cell SF), or 63.45 → 125.82 (ring SF).
* **POST-FIX** answers the room at every width, spread 0.35 SF, and **8 of 8 rows carry
  `min_pass_px 6` and `min_pass_delta ≈ 0.491`** with confidence 0.99 and the factor
  `min-passage-rule(49.1% of the verbatim flood removed)`. Trimming-path provenance is present, as
  claimed. The four creating-path refusals `b277662` introduced are **kept**, so the fix is a scoping
  and not a removal.

Note the honest half: BEFORE's *measurements* on this scene were already right (64.06–64.41 SF).
What `b277662` bought is not accuracy here but the receipt — and on the creating path, four refusals
where BEFORE would have minted a room with no signal.

---

## §A3-POST — the dashed property line: verified unchanged

The brief asked whether scoping the F1 gates disturbed A3. It did not, and the check is exact rather
than eyeballed: `diff ev-a3-after.json e3-a3-post.json` is **empty** — `a3.mts`'s entire output is
byte-identical on `94a5d46` and `7650f68`, all three scenes.

So, restated for POST-FIX: **a dashed graphic line closing a corner of a sheet is still measured as a
484.00 SF room.** It is caught only by the confidence deduction to 0.85 and the
`minPassPx 5 / minPassDelta 1` provenance; `virtualFrac` is still 0.000, so the ≥75%-real-boundary
guard still does not fire on it, on any of the three states. Part 1's flagging of this stands
verbatim. `a4.mts` and `a5b.mts` are byte-identical between `94a5d46` and `7650f68` too.

---

## §A5-POST — negative controls, and the ring-interior path

### The allowance table has not moved

`a5.mts`'s output on `7650f68` is byte-identical to `94a5d46` in both of its blocks (chord
classification and wedge allowance). Both negative controls therefore read exactly as Part 1 recorded
them, and both findings survive the fix wave untouched:

* **Bezier ellipse (3:1)** — 32 of 32 chords are door chords on **both** states, allowance
  **19.7 → 19.9 SF**. The small regression Part 1 flagged is **still present on POST-FIX**. Only the
  polyline form is correctly rejected (0/32 curve chords, by `markPolylineArcs`' circle fit).
* **Duct elbow** — 16 of 16 door chords and **8.6 SF** of allowance on POST-FIX (8.7 on BEFORE); `fit`
  reports `noDoorFrac 0.00`, so nothing refuses it.

### `ringWedges` — the new path, measured end to end

**Probe** `docs/evidence/probes/a5c.mts` (new). Five scenes at 18 px/ft on a 1000×800 sheet, room
150–600 × 150–500 (19.7% of the sheet, inside the 30% leak cap). It floods with and without the
door-wedge retry, so what the ring hands over is a difference of two measurements, and it reads the
readout strings off `TakeoffCanvas.jsx` and `mcp/src/session.ts` rather than restating them.

```bash
cd $S/wt-evb/web && node --import tsx evprobe/a5c.mts
cd $S/wt-eva/web && node --import tsx evprobe/a5c.mts
```

| scene | state | bare SF | final SF | annexed | `wedges` | `ringWedges` | hover badge | MCP provenance | conf |
|---|---|---|---|---|---|---|---|---|---|
| round column 3 ft dia on the wall, **no door in the scene** | BEFORE | 480.17 | 483.65 | +3.48 SF | 1 | *field absent* | `· incl. door swing` | `door_wedges: 1` | 0.97 |
| " | **POST-FIX** | 480.17 | 483.65 | +3.48 SF | 1 | **1** | **`· incl. ring interior`** | **`door_wedges: 1, ring_interiors: 1`** | 0.85 |
| callout bubble 4 ft dia, no door | BEFORE | 477.42 | 483.65 | +6.23 SF | 1 | *absent* | `· incl. door swing` | `door_wedges: 1` | 0.97 |
| " | **POST-FIX** | 477.42 | 483.65 | +6.23 SF | 1 | **1** | **`· incl. ring interior`** | **`+ ring_interiors: 1`** | 0.85 |
| **real 3′-0″ door, no ring (control)** | BEFORE | 490.57 | 490.57 | 0 | — | *absent* | *(none)* | `{}` | 1.00 |
| " | **POST-FIX** | 490.57 | 490.57 | 0 | — | **absent ✔** | *(none)* | `{}` | 0.98 |
| door **and** column | BEFORE | 487.09 | 490.58 | +3.48 SF | 1 | *absent* | `· incl. door swing` | `door_wedges: 1` | 0.97 |
| " | **POST-FIX** | 487.09 | 490.58 | +3.48 SF | 1 | **1** | `· incl. ring interior` | `+ ring_interiors: 1` | 0.83 |
| **free-standing** 3 ft column (interior-as-floor) | BEFORE | 476.52 | 483.65 | **+7.13 SF** (πr² = 7.07) | 1 | *absent* | `· incl. door swing` | `door_wedges: 1` | **0.97** |
| " | **POST-FIX** | 476.52 | 483.65 | **+7.13 SF** | 1 | **1** | **`· incl. ring interior`** | **`+ ring_interiors: 1`** | **1.00** |

Source scan, POST-FIX (all **true**; all **false** on BEFORE): `TakeoffCanvas.jsx` contains
`" · incl. ring interior"` and `" · incl. door swing + ring interior"` and `ring_interiors`;
`mcp/src/session.ts` contains `ring_interiors`.

*Reading:* **the brief's expectation holds — a round column reports `ring_interiors`, not a door
swing.** Three things qualify it:

1. The **measurement is unchanged**, exactly as `7650f68` says. In the free-standing scene the
   annexed 7.13 SF is the column's own interior (πr² = 7.07 SF, 0.8% agreement) and the centre cell
   flips 0 → 1 with the retry on both states. The column still counts as floor; only the claim about
   why changed. That is the pending operator decision, and this pack does not take a side on it.
2. The **confidence factor still says "door-swing-crossed"** — contradiction #6.
3. The free-standing column's score went **0.97 → 1.00** — contradiction #7.

Not measured: the `· incl. door swing + ring interior` branch. In scene 4 the door contributes no
wedge of its own (annexed is 3.48 SF, identical to the column-only scene), so `ringWedges >= wedges`
and the mixed string never renders. I could not build a scene where a door wedge and a ring wedge both
fire; that branch is source-scanned only. See Limitation 13.

---

## §A2-POST — the confidence table, and what the gates now catch

**The table itself did not move.** `diff ev-bench-after.txt e3-bench-post.txt` shows changes in
exactly four places, and none of them is a probe row: the new absolute-SF and raw-fidelity gate
annotations, a new wall-semantics verification block, the `wallSemantics` label
`centerline → drawn-path-vertex`, and five corrected adjudication paragraphs. **All 21 golden probe
rows — IoU, SF±, confidence — are byte-identical to `94a5d46`**, so Part 1's A2 table stands as
printed and is not reproduced here. `npm run bench` exits 0 and prints `bench passed` on POST-FIX.

What changed is the instrument. Three gates were added after Part 1 was written, and the brief asks
which defects they now catch. Asked by perturbation, not by reading the code:

**Harness** `docs/evidence/probes/gates.py`. Each perturbation is applied to a pristine worktree,
`npm run bench` is run, the exit code recorded, `git checkout -- .` restores it, and the worktree is
asserted free of modified tracked files before and after every case. Run against `94a5d46` (the state
Part 1's A2 table was measured on) and `7650f68`. The interesting cell is **PACK 0 / POST 1**.

```bash
python3 docs/evidence/probes/gates.py $S/wt-evp/web PACK     # 94a5d46
python3 docs/evidence/probes/gates.py $S/wt-eva/web POST     # 7650f68
```

| # | perturbation | what it simulates | gate it should trip | **PACK `94a5d46`** | **POST `7650f68`** |
|---|---|---|---|---|---|
| p0 | *(none)* | — | — | **exit 0**, `bench passed` | **exit 0**, `bench passed` |
| **p1** | `cloud-corridor`'s golden ring grown 1.4% in area | a golden re-pinned, or an engine drift, of ~24 SF on a big room — **inside** the 2.5% relative band | `THRESHOLDS.maxRoomSfAbs = 1.0` | **exit 0** — printed `worst room SF±1.4%` and `bench passed` | **exit 1** — `va-finish-plan/cloud-corridor: engine diverges from its answer key by 24.41 SF > 1 SF (absolute per-room trigger…)` |
| **p2** | the **un-snapped** ring the fidelity pass measures shrunk 8% toward its centroid; the snapped ring untouched | a rasterisation regression the snap hides | `rawFloorIoU = 0.80` | **exit 0** — printed `raw … floor IoU 0.750 … worst SF 21.99%` and `bench passed` | **exit 1** — `raw (un-snapped) IoU floor 0.750 < 0.8 — the snap is covering for a rasterisation regression` |
| p2x | working raster coarsened to `maxDim 900` | *(the blunt version — degrades the snapped ring too)* | — | **exit 1** — `floor IoU 0.082 < 0.9; mean IoU 0.832 < 0.95` (gates both states had) | **exit 1** — same two gates at their ratcheted values, plus the new raw floor |
| **p3** | `CONF_MINPASS_SOLE` 0.85 → 0.75 — the one deduction the `two-doorways` exemption excuses, deepened | a confidence **collapse** inside an xfail exemption | `xfailAtLeast = 0.80` | **exit 0** — printed `EXEMPT two-doorways/center conf 0.75 (xfail: must stay ≤ 0.87)` and `bench passed` | **exit 1** — `exempt two-doorways/center: XFAIL FLIPPED DOWNWARD — confidence 0.75 < 0.8. The exemption excuses ONE known deduction, not a collapse` |
| p3x | extra ×0.90 on **every** trace | *(the blunt version — collapses non-exempt probes too)* | — | **exit 1** — `annotation-ring-room: XFAIL FLIPPED — confidence 0.90 ≤ 0.9` **and** `worst accurate probe 0.80 < calibrated absolute floor 0.88` (both pre-existing) | **exit 1** — the same two, plus `xfailAtLeast` |

Where a perturbation fails on **both** states it proves nothing about the new gate, and both blunt
attempts do exactly that — which is why the harness keeps them and labels them. `p2x` (coarsening the
working raster to `maxDim 900`) degrades the **snapped** ring too, so it trips `floorIoU`/`meanIoU`
gates both states already had; `p3x` (an extra ×0.90 on every trace) collapses the non-exempt probes,
so `CONF_GATE.floorAbs` — present on both — fires first. The isolating versions move only the quantity
the new gate reads.

*Reading:* **all three new gates catch a real defect that the state Part 1's A2 table was measured on
called green — 3 for 3, PACK exit 0 / POST exit 1.** Two of the three are worth naming as user-facing:

* **p1.** At `94a5d46` a room could diverge from its answer key by **24.41 square feet** and the bench
  printed `bench passed`. `cloud-corridor` is 1743 SF, so 2.5% of it is 43.6 SF — the relative band was
  the only trigger and on the corpus's biggest room it was worth most of a small apartment. The bench's
  own header says the same thing about its own history ("2.5% of cloud-corridor is 43.6 SF, which is
  how 36.7 SF moved without an adjudication"), and this is that claim reproduced against the
  pack-era binary rather than read off it.
* **p2.** At `94a5d46` the un-snapped raster IoU floor could fall from 0.860 to **0.750**, with the
  worst raw SF error rising to **21.99%**, and the bench passed — because that reading shipped
  explicitly ungated ("deliberately UNGATED: the product ships the snapped ring, so gating the raw one
  would gate a quantity nobody buys"). Part 1's A5b section printed that reasoning without
  contradicting it. It was wrong in one specific way: the snap also made the *cross-resolution*
  pair-IoU exactly 1.000 on 8 of 9 synthetic probes, so after the A5b re-pin the raw reading was the
  corpus's last rasterisation signal and nothing at all was holding it. F6 gates it, and p2 shows the
  gate binding on a regression the pack-era bench waved through.
* **p3** is narrower — it protects one exemption from silently absorbing new deductions — but it is the
  same failure mode as F1 (a signal that stops being able to say anything) and it now fails loudly.

---

## §A8-POST — the perf guard still holds

Spot-confirmed as the brief asked; no re-measure.

```bash
cd $S/wt-eva/web && node --import tsx --test test/oneclickHoverCost.test.ts
```

`# tests 3 · # pass 3 · # fail 0` (`duration_ms 5088`). The guard's three assertions — bounded raster
sweeps, bounded allocations, and the multi-door hover budget — all pass on `7650f68`.

Part 1's timing table (1483 ms → 161 ms warm at 6 doors, bit-identical output) is **not** re-measured,
and the reason is stated rather than assumed. `floodRegionSealed` **did** change between `94a5d46` and
`7650f68`: the min-passage primary path was restructured to return the trimmed region early when the
verbatim flood is already bounded (the F1 fix), and the per-cluster wedge loop gained one counter
(`if (fit.noDoorFrac > 0.5 && fit.good) ringWedges++`). Neither adds a raster pass or an allocation —
the early return removes work, and the counter is O(1) per cluster — and *bounded sweeps and bounded
allocations are exactly what the guard asserts*, so it is the right instrument for this and it is
green. What is **not** established by three passing assertions is that the median warm millisecond
count is still 161 ms on this machine; that would need `a8.mts` re-run, which the brief did not ask
for and I did not do.

---

## What did NOT change — regenerated for POST-FIX

Each item is a measurement, and each names the command that produced it.

1. **The corpus goldens are byte-identical through the entire fix wave.**
   `git diff --stat 23e87f7..HEAD -- web/bench/corpus/` → **2 files, 7 insertions, 7 deletions**, and
   every one of the 14 lines is either `wallSemantics` or a `reason` string. Verified structurally
   rather than by eye: extracting every non-prose leaf value from both revisions of both files gives
   **51 values for `sample-plan` and 639 for `va-finish-plan`, of which 0 changed, 0 were added and 0
   were removed.** So `b277662` and `7650f68` moved no golden, no seed, no expectation and no
   adjudication *number* — only the wall-semantics **declaration** (`centerline` →
   `drawn-path-vertex`, which audit F5 showed was the label that was wrong, not the geometry) and five
   corrected explanatory paragraphs.
2. **The F8 residual: BEFORE == AFTER == POST-FIX.** `markPolylineArcs` and its image-px tolerances
   are untouched across all three commits. F8 is only *separable* on POST-FIX (the grid must be pinned
   first), which is why §F8 is a baseline rather than a before/after — it needs its own reviewed
   change, and `7650f68` says so.
3. **The column-interior measurement is pinned; only the messaging moved.** Free-standing 3 ft round
   column: 476.52 → 483.65 SF, **+7.13 SF annexed on both BEFORE and POST-FIX**, centre cell 0 → 1
   on both (`a5c.mts` scene 5). What changed is `ringWedges`, the hover badge and the MCP receipt.
   The confidence went the wrong way (contradiction #7).
4. **Known limit F2b is present and unchanged by the wave.** The same drawing with a decisively
   sub-`MIN_PASS_FT` 0.333 ft slot, on the **creating** path, flips with the working raster
   (`f1.mts`, section `f2b`):

   | `maxDim` | `mppf` | `minPassPx` | BEFORE | MID `71c53aa` | POST-FIX |
   |---|---|---|---|---|---|
   | 700 | 23.0516 | 6 | `ok` @ **1.00** | `ok` @ 0.78 | `ok` @ **0.78** |
   | 800 | 26.3447 | 7 | `ok` @ **1.00** | `ok` @ 0.70 | `ok` @ **0.70** |
   | 911 | 30.0000 | 8 | `ok` @ **1.00** | `leak` | **`leak`** |

   MID and POST-FIX are identical: the F1 fix scoped the gates to the creating path and left this
   flip exactly where `minPassGate.test.ts` pins it. BEFORE has no flip because it has no gate — it
   answers `ok` at 1.00 at every raster, which is worse, not better.
5. **A3, A4, A5, A5b probe outputs are byte-identical between `94a5d46` and `7650f68`** — verified by
   `diff` on the saved JSON, all four files. The dashed-line 484 SF room, the curved-wall 0 SF annex,
   the real-door 7.33 SF control, the ellipse 19.9 SF regression, the duct elbow's 8.6 SF, and the
   bench-ring-vs-production-ring gap table are all exactly as Part 1 printed them.
6. **A1's below-cap fix and A6's engine unification are untouched.** `a1b.mts`: 0 of 61 slot widths
   change with the toggle. `a1.mts`'s `sample-plan` block, `a3`/`a4`/`a5b` — all byte-identical.
7. **`mcp` test count is unchanged at 36 pass / 0 fail**; `web` is **968 pass / 0 fail** (843 BEFORE,
   934 AFTER, +34 from the fix wave). Both suites green on POST-FIX.
8. **The bench still exits 0 and prints `bench passed`** unperturbed on both `94a5d46` and `7650f68`
   (`gates.py` case `p0`, exit 0 on both).

---

## Limitations — Part 2's additions

Continuing Part 1's numbering.

9. **The 9.27% F8 figure is at a render scale the product cannot reach on that sheet.** Only rs 2.000
   and rs 2.070433 are reachable on the VA plan (`autoRenderScale(3024, 2160)`, verified against
   `canvasUtil.js` and `canvasConstants.js`). rs 2.070, 2.0704, 3.000 and 5.374 are probe-imposed.
   I report the reachable pair as the user-facing number (**+2.03%**) and the wider sweep as a bound.
   Whether some *other* sheet size reaches rs 3–5.374 **and** carries VA-like polyline arcs is not
   measured — no such sheet is in the corpus.
10. **F8's variant-B isolation depends on the chord count being render-invariant.** It is on this
    sheet (71 819 at all six scales, asserted in the probe output), so the baseline `meta` array can
    be substituted index-for-index. On a sheet where `extractVectorGeometry` emits a different number
    of chords at a different render scale, variant B is unavailable and the decomposition cannot be
    done this way. The probe reports `chordCountMatchesBaseline` rather than assuming it.
11. **The residual grid drift (65–4 346 cells with `meta = null`) is characterised but not
    root-caused.** It is consistent with floating-point rounding in `Math.round(seg × ws)` where
    `segs` come from pdf.js at the render scale, and its magnitude (≤ 0.07% of cells, ≤ 0.09% of any
    probe's SF) matches that; I did not instrument individual segment endpoints to prove it.
12. **`detectRegions` / MCP were not re-probed for the `page` pin.** `detectRooms.ts` has no `page`
    parameter, so the MCP and batch surfaces cannot be pinned to the page even in principle at
    `7650f68`, while `ensureMask` is. `a6.mts` renders every surface at one render scale, so it
    cannot see this — it correctly reports 0 divergent seeds of 64 on POST-FIX, and would do so even
    if the surfaces were pinned differently. **A6's "one engine" property is therefore verified only
    at `RENDER_SCALE`, not across the Hi-Res toggle.** This is contradiction #4's unmeasured half and
    the single largest gap in Part 2.
13. **The `· incl. door swing + ring interior` branch is unexercised.** In every mixed scene I could
    build, the door contributed no wedge of its own, so `ringWedges >= wedges` and the all-rings
    string rendered instead. That branch is confirmed only by source scan.
14. **The gate perturbations demonstrate that each gate *fires*, not that its threshold is right.**
    `p1`/`p2`/`p3` each move one quantity far enough to cross one gate; none of them establishes that
    1.0 SF, raw-IoU 0.80 or 0.80 are the correct places for those lines.
15. **`npm run e2e` still not run** (Part 1 limitation 4 stands — Chromium download plus apt libs),
    and **no raster/scanned path was probed** (limitation 5 stands; `rasterMaskScale` is exercised
    here only for its *grid arithmetic*, via `a1c.mts`, never against real scan pixels).
16. **MID (`71c53aa`) was measured for F1 only.** It is a point on the branch chosen because it
    predates the F1 fix; I did not re-run the rest of the pack against it.

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

Added by the POST-FIX re-measure (Part 2):

| file | what it constructs | runs on BEFORE? |
|---|---|---|
| `a1c.mts` | the two corpus PDFs at rs 2.000 / 2.070 / 2.0704 / autoRenderScale, mask built **twice** per scale (`meta = null` and production `meta`) with `buildMask`'s 8th argument `page` as `TakeoffCanvas.ensureMask` passes it; plus `rasterMaskScale`'s grid for the same sheet | yes (8th arg dropped by JS; `honoursPageArg` reports **false** there) |
| `f8.mts` | the VA plan at six render scales × three `meta` variants (this render's / the baseline render's / none) on one pinned grid, plus a per-bit XOR attribution of every differing `meta` byte | yes, but the decomposition is meaningless without the pin — see limitation 10 |
| `f1.mts` | `minPassGate.test.ts`'s picket-wall scene verbatim, 8 slot widths × {inside a suite, alone on the sheet}, at `maxDim 700`; plus the F2b resolution flip at `maxDim` 700 / 800 / 911 | yes (composes `ConfidenceInput` by hand — `floodSignals` postdates BEFORE) |
| `a5c.mts` | 5 scenes at 18 px/ft: round column and callout bubble on a room wall with **no door in the scene**, a real 3′-0″ door as control, a mixed scene, and a free-standing column; flood with and without the wedge retry; reads the hover-badge and MCP receipt strings off the sources | yes (`ringWedges` reported as absent) |
| `gates.py` | 3 isolating + 2 deliberately non-isolating bench perturbations, applied to a pristine worktree, `npm run bench`, exit code, restore, clean-tree assertion | n/a — run against `94a5d46` and `7650f68` |

Every probe source in this table is **committed** under `docs/evidence/probes/`. `web/evprobe/` is the
untracked copy each worktree runs from (`cp docs/evidence/probes/*.mts $S/wt-<state>/web/evprobe/`).
