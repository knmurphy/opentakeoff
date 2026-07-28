# Issue #184 — remediation plan

Companion to [`ISSUE_184_AUDIT.md`](./ISSUE_184_AUDIT.md). Finding IDs (A1, B3, …) refer to
that document.

**Revision 2.** Revision 1 was reviewed by two adversarial reviewers and failed. Three of its
central proposals were refuted *by execution*, not argument, and are corrected here:

- **The confidence gate it called its "highest-value line" was unsatisfiable.** Instrumenting
  `annotation-ring-room` showed every signal it proposed to scale is null on that probe
  (min-passage delta **0.00%**, no hatch/seal/wedge, `mppf` above floor). Since rev 1 wrote
  "only then is item F unblocked", it permanently blocked its own next work item.
- **Its hatch magnitude signal was inverted on the repo's own corpus** — the *correct* probe
  grows 451.8×, the *wrong* one 5.09×.
- **Its claim that "upsampling vector segments loses nothing" was false** — raising the
  resolution lever collapsed `patient-toilet-137a` from IoU 0.999 to **0.026**.

Effort labels (S/M/L) **order the work and are estimates.** Rev 1 disclaimed them as "rough"
while using them to justify sequencing; that was having it both ways. Where a label proved
wrong under review it has been corrected.

---

## Scope

The audit covers rounds 1–8 plus `7605315`, at `21e57a0`.

**Round 9 (`5100108769`, branch `claude/research-prioritization-gm6w75`) postdates the audit
and was missed by it.** Its findings are adopted here and its numbers are cited as *its*
measurements, not re-verified by the audit:

- **The VA plan carries a partial answer key the engine didn't author** — 9 designer-printed
  `NNN SF` callouts. Engine vs callout: **+11.1%, −8.3%, −24.2%, −38.7%, −43.8%**. Mixed
  signs, so not a scale error. It may be a finish-zone convention rather than engine error —
  and round 9's point stands: *nothing in the repo can currently tell the difference.* This is
  the cheapest independent truth available and it is adopted as task **0.10**.
- **A6 quantified**: `detectRegions`/MCP raw path gives raw 0.817 vs sealed 0.999 mean IoU on
  the 8 VA seeds, and **560 SF double-counted (16.6%)** across 56 label seeds — against the
  repo's own 0.5% gate. Rev 1's A6 bullet carried no magnitude at all.
- **Round 8's "not fixable by caps" is too strong**: `partition-bank-15in` recovers IoU
  **0.197 → 0.937** at a 1.0–1.1 ft pitch cap, while `tile-grid-room` collapses 0.992 → 0.002
  below 1.333 ft. A third-of-a-foot window with cliffs either side — which makes it a real
  knob, not a non-knob, and makes never-auto-apply guard rails load-bearing.
- `annotation-ring-room` is **cap-invariant at 0.650** across the whole sweep — independent
  confirmation it needs semantics, not a knob.

Round 9 proposes its own ordering (callout harness → measured plans → `detectRegions` parity →
item-F metrics → F). This plan adopts the callout harness and the `detectRegions` parity, and
differs on ordering only by putting the re-pin protocol and the live A1 bug first.

**Not a goal: notice or disclosure.** Rev 1 argued for correcting the public record partly as
notification. That is out of scope. Record corrections are retained on a different ground —
**the issue is this project's working state**: each round starts by reading it, so a wrong
figure or a stale "next session starts at item F" is re-inherited by whoever picks the work up
next.

---

## Hold

**No upstream PR is assembled until Phases 0–3 exit green and 6.14's slice reclassification
lands.** This is an engineering-readiness hold, not a disclosure one: A1 ships a wrong-SF bug,
A2 means RFC item D does not do its job, and D14 found the slice may not compile as classified
(`geometry.js`, source of `pointInPoly` for `bench/score.ts:8`, is classified nowhere).

---

## Sequencing rationale

Rev 1's stated rationale — *"every fix below is guarded by bench or e2e, and CI runs neither"*
— **was false** and is withdrawn. A1's own guard (1.2) is a unit test, and CI already runs
`npm test`. The real reasons Phase 0 precedes the rest:

1. **Phases 1, 2, 3 and 5 each force a golden re-pin.** Changing mask resolution, seal gates,
   or arc detection changes every measured ring. Re-pinning is the operation that concealed
   the −33% regression (the issue's own bug #17). The re-pin protocol (0.9) and the corpus
   assertions (0.2, 0.3) must exist **before the first re-pin**, not after.
2. **Item F is blocked on A6, not on confidence.** Rev 1 claimed batch fill consumes
   confidence thresholds. It does not: `detectRegions` (`detectRooms.ts:76-89`) gates on
   `f.status !== "ok"` only, with an explicit design comment that *"hatchFiltered rides
   through as provenance, never a rejection reason"* — and it calls raw `floodRegion`. The
   genuine prerequisite is making the batch and MCP surfaces call the same engine as the
   canvas (A6, now **2.7**), which round 9 measured at 16.6% double-counted floor.
3. **Fix the human-truth guards before the first real answer key exists.** Once a human
   measures a plan and it is pinned through a leaky guard (C3, C4), the corruption is
   invisible and permanent.

---

## Phase 0 — make the gates real

| # | Task | Finding | Size |
|---|---|---|---|
| 0.1a | Add `lint` and `bench` to CI. Extend `check` to `typecheck && lint && test && bench && build` and have CI call it, so the definition lives in one place. Rev 1's "prefer `npm run check`" was wrong — `check` contains neither `bench` nor `e2e`, so it would have added lint only. Also extend `lint` (`eslint src netlify/functions`) to cover `bench test e2e`, which are currently unlinted. | B2 | S |
| 0.1b | Add `e2e` to CI. **Not S.** `playwright` is in neither `dependencies` nor `devDependencies` and is not in `node_modules`; `e2e/one-click.e2e.cjs:14-20` falls back to a *global* install. Needs a devDependency, `npx playwright install --with-deps chromium`, a vite dev server on 5199, and a flake budget. | B2 | M |
| 0.2 | Assert an expected probe count in `bench/run.mts`; fail on mismatch. | B4 | S |
| 0.3 | **Xpass detection**: a `knownFail` probe that now passes fails the run. | B3 | S |
| 0.4 | Always-printed known-fail block with IoU and SF error, so `open-margin`'s live `NOT refused` and the two `LEAK` rows appear in the summary. | B3 | S |
| 0.5 | Drop `maxLeakRate` or redefine it — leak implies IoU < 0.5, which the 0.90 floor already catches, so it is unreachable and cannot be evidence. | B5 | S |
| 0.6 | Label the refusal denominator (`3 synthetic probes`); `correctRefusalRate` returns `n/a` on an empty set, not `1`. | B5 | S |
| 0.7 | Split the headline: `synthetic (independent truth): n=9 …` and `engine-pinned (regression-only): n=12 …`. Never print a blended accuracy figure. | B1 | S |
| 0.8 | **Verification ledger** — `ISSUE_184_REMEDIATION_LEDGER.md`. Every exit criterion gets: criterion, the exact command that checks it, the commit checked at, and who checked it. A criterion with no command is not one — delete it or make it one. Self-checked rows marked `self`, so the record shows what carries independent weight. Rev 1 specified no reviewer for any of its own work, which is finding D6 one level up. | D6 | S |
| 0.9 | **Re-pin protocol. Blocks Phases 1, 2, 3, 5.** `pin-goldens.mts` emits a per-probe diff on every re-pin: old SF, new SF, Δ%, old-vs-new set-difference render, IoU(old,new). Any probe moving >±2.5% fails unless the commit body carries a per-probe adjudication. Add the adjacency-tiling invariant: for `wholePlan` cases, pairwise overlap ≤0.5% **and** the case total must not move >2.5% without adjudication. | B1, bug #17 | M |
| 0.10 | **Callout cross-check harness** (round 9). Report engine SF vs the plan's own printed `NNN SF` callouts. **Reported, never gated** — the convention is unknown. Free partial truth on every plan that prints its areas, and it tells us *before* the measuring campaign whether the disagreement is convention or accuracy. | round 9 | M |

**Exit criteria**
- CI goes red on each of: a deleted corpus file; a known-fail that starts passing; an e2e
  regression; a lint error **in `bench/`** (currently green and shouldn't be).
- Replaying the `92c1242` → `2ea5487` re-pin under 0.9 flags `patient-room-137` at −33.0%.
  *(Checkable today; this is 0.9's acceptance test.)*
- `npm run bench` prints the synthetic/pinned split and the callout table.

---

## Phase 1 — the live product bug

### 1.0 Mitigate A1 today (S)

Before the refactor lands, make the Hi-Res toggle not change measurement: hide it behind a
flag, or force the mask path to a render-independent resolution regardless of `hiResKeys`. A
one-line mitigation today beats an exact fix after Phase 0. Revert when 1.1 lands.

### 1.1 Decouple mask resolution from render scale (M)

**The algebra holds** — verified: `uppFor` (`panelGeometry.js:41-45`) returns
`scales[key]/(rs/RENDER_SCALE)` and `scales[key]` is feet-per-px at `RENDER_SCALE=2`, so
`1/upp = rs·ptPerFt`. Calibration is stored in baseline-render-px space, which is point space
times a constant, so `rs` genuinely cancels.

**Rev 1's formula is withdrawn.** It routed through page point size, which `buildMask` cannot
see — requiring a signature change across ~15 call sites that rev 1 never mentioned. Use
instead, with no new parameter:

```
ws = min( maxDim / max(imgW, imgH),  TARGET_MPPF / pxPerFt )     when pxPerFt > 0
ws = min( 1, maxDim / max(imgW, imgH) )                          when pxPerFt = 0  (unchanged)
```

Both terms are ∝ 1/rs, so their min is too, and `mppf = pxPerFt·ws` is render-invariant.

**`TARGET_MPPF = 36` — chosen to hold today's behaviour, not derived.** It leaves VA
cap-bound at `ws` 0.496 / `mppf` 8.93 (unchanged) and `sample-plan` target-bound at `ws` 1.0 /
`mppf` 36 (unchanged), so the corpus does not move. Saying this plainly is the lesson of
`DETERMINISM_MIN_MPPF`.

**Do not raise resolution.** Rev 1 treated mask resolution as free. Review measured the
opposite on the VA plan:

| cap | prod mppf | patient-toilet-137a | patient-room-137 | min gated pair-IoU |
|---|---|---|---|---|
| 3000 (today) | 8.93 | 0.999 | 1.000 | n/a |
| 4000 | 11.90 | 0.894 | 0.829 | 0.895 |
| 5000 | 14.88 | **0.161** | 0.857 | 0.137 |
| 6048 | 18.00 | **0.026** | 0.868 | 0.026 |

`softCount` barely moves, so this is the flood/seal/min-passage stack behaving differently at
higher `mppf` — not a classifier flip. **This also refutes rev 1's 5.3 "raise resolution"
option and makes decision D-2 a false choice** (see 5.3).

**Sub-tasks rev 1 omitted:**

- **1.1b** — update `bench/run.mts:45-47`, whose comment says *"factor 1 reproduces the
  production mask exactly"*. It pins `baseDim = min(MASK_MAX_DIM, max(imgW,imgH))`, so after
  1.1 the bench would keep testing the old rule and **Phase 1 would be invisible to it.** (S)
- **1.1c** — rewrite `resolutionInvariance.test.ts:123-127` ("MASK_MAX_DIM export still caps
  ws at 1"), which asserts `mo.ws === 1` and fails once `ws > 1` is allowed. (S)
- **1.1d** — `TakeoffCanvas.jsx:2831` **duplicates the `ws` formula inline** for the raster
  path; update in lockstep or vector and raster masks silently diverge. (S)
- **1.1e** — add an **upward** factor (e.g. 1.25) to `RES_FACTORS` (`run.mts:35`). The cross
  gate currently tests only downward, so the direction 1.1 introduces is ungated. (S)

**The raster carve-out is withdrawn.** Rev 1 claimed `buildRasterMask` is tied to render scale
and cannot be decoupled. It is not: `ensureRasterMask` does an **independent pdf.js render** at
`scale: rs*ws` (`TakeoffCanvas.jsx:2843`), never a resample of the panel bitmap. Set its
viewport scale from `pxPerFt` and `TARGET_MPPF` exactly as the vector path does; the only real
limit is the source scan's DPI. Rev 1's "mark raster takeoffs for re-verification" workaround
would have left A1 live on scans.

### 1.2 Regression test (S)

Build masks at two render scales, **one non-dyadic** (e.g. `rs = 5.374`); assert identical
`mppf` and measured SF to 0.01 SF. Rev 1's "byte-identical masks" is withdrawn — cells come
from `Math.round(segs[i]*ws)` where `segs ∝ rs` and `ws ∝ 1/rs`, which is not bitwise
equivalent in IEEE754, and `mw = ceil(imgW·ws)` can differ by 1.

### 1.3 Provenance (S)

Record `mppf` in `origin` for every trace.

**Risk / rollback.** Removing the `ws ≤ 1` clamp raises cell counts on sub-cap sheets, which
makes **A8 worse** (measured 1014 ms / 119 MB on a 3000×3000 mask, on the hover path). Measure
the hover path before and after; if it regresses, bound `TARGET_MPPF` lower or fix A8 first.

**Exit criteria**
- 1.2 passes and fails if 1.1 is reverted.
- `npm run bench` shows **no** golden moving more than 0.1% (the corpus should not move at
  `TARGET_MPPF = 36`); any movement is adjudicated under 0.9.
- Hover-path timing on the VA sheet is within 10% of its pre-Phase-1 measurement.

---

## Phase 2 — confidence (RFC item D)

### 2.1 Magnitude-scaled deductions (M)

| signal | today | proposed |
|---|---|---|
| raster | flat ×0.90 | keep flat — genuinely binary |
| sealed | ×(1−virtualFrac) | **keep** — already magnitude-aware; the model for the rest |
| door wedges | flat ×0.97 | scale by `wedgeGrowth` **and plumb it** (2.1b) |
| hatch-filtered | flat ×0.95 | **signal TBD — see 2.1c. Do not use escalation growth.** |
| min-passage | absent | new factor (2.2) |
| coarse mask | never fires on scans | fix via 2.3 |

- **2.1b** — rev 1 said `wedgeGrowth` was "already plumbed and simply never read". **False**:
  it is declared at `confidence.ts:30` but **no caller supplies it** — all four call sites omit
  it (`TakeoffCanvas.jsx:2887`, `:3147`, `:3994`, `bench/run.mts:63`). This is plumbing at four
  sites, not a one-line read. (S)
- **2.1c** — **escalation growth is anti-correlated with correctness and must not be used.**
  Measured:

  | probe | growth× | IoU | verdict |
  |---|---|---|---|
  | `tile-grid-room/in-cell` | **451.8×** | 0.992 | correct |
  | `tile-demising-same-pen` | 376.5× | 0.497 | wrong |
  | `partition-bank-15in` | **5.09×** | 0.197 | wrong |
  | `hatched-room/center` | no ratio (strict = `tiny`) | 0.992 | correct |

  Any threshold pushing `tile-demising` below 0.90 pushes `tile-grid-room` below it harder.
  Also, rev 1's "scale against the 2.5× cap" is wrong: `HATCH_GROWTH_MAX` applies only in the
  *moderate* band (`oneclick.ts:747`) and all four probes are in the unbounded tier. **Task:
  find a signal that separates these four, validate it against all four before landing, and if
  none exists, say so and leave the flat deduction.** (M — this is research, and is labelled as
  such.)
- **2.1d** — the escalation growth ratio is **not on `FloodResult`** at all
  (`oneclick.ts:42`); `floodRegion:749-753` discards `r2.count/r1.count`. Plumbing it through
  `sealAttempt` → `floodRegionSealed` is real work, costed here rather than assumed. (M)

### 2.2 Disclose the primary seal path (M) — A3

`sealAttempt` returns at `oneclick.ts:1045` before the room-size cap (`:1067`), before the
≥75% rule (`:1068-1069`), and without setting `sealedPx`/`virtualFrac` (`:1070-1071`).

- Set a `min_pass_px` provenance field.
- Emit a factor scaled by the min-passage vs raw flood difference — **but note this signal is
  0.00% on `annotation-ring-room`**, so it does not rescue that case (2.4).
- Surface it in the readout.
- Correct `confidence.ts:5-6`, which defines 1.00 as "the plan's own vector linework,
  verbatim" — violated on every scaled sheet.
- **Decision D-1**: should the two gates apply to this path? Recommend yes.
  **Risk/rollback:** rooms that measure today may start refusing. Accept only if the corpus
  refusal rate stays 0; otherwise revert and re-open D-1.

### 2.3 Plumb `mppf` into the raster path (S)

`buildRasterMask` returns no `mppf` (`rastermask.ts:159`), so `confidence.ts:52` can never fire
on scans — the least trustworthy input takes the smallest deduction.

### 2.4 The anti-correlation gate — **with an explicit, written exemption** (S)

Rev 1's one-directional gate was **unsatisfiable and gameable**. Corrected on both counts.

Evaluated over **all probes including known-fails** (explicitly bypassing the `!s.knownFail`
filter at `score.ts:200` — otherwise it cannot fire at all):

- **Ceiling:** no probe with `iou < 0.90` may report `confidence > 0.90`.
- **Floor:** no probe with `iou ≥ 0.98` may report `confidence < 0.90`. *This is what stops the
  ceiling being satisfied by deflating every score; it binds today on the 4 `sample-plan`
  probes and the 8 gated VA probes.*
- **Exemption, with reason:** `annotation-ring-room` is exempt. Instrumentation shows a clean
  verbatim vector trace that stopped at the wrong boundary — `raster` false, `hatchFiltered`
  false, `sealedPx` undefined, `wedges` undefined, `mppf` above floor, **min-passage delta
  0.00%**. No engine-internal signal distinguishes it from a trace that stopped at a wall.
  **This is the RFC-item-A gap, and no amount of confidence tuning closes it.** The exemption
  is recorded in the corpus with this reason attached.

Rev 1's exit criterion "every known-fail scores below 0.90" is **withdrawn as unreachable**.

### 2.5 Show the score unconditionally (S)

`TakeoffCanvas.jsx:3168` (*not* `:3178` — corrected) appends the percentage only when
`res.cf < 1`, in the **hover readout**. Note `origin.confidence` *is* always persisted
(`:3034`), so the audit's "the estimator sees no flag at all" applies to the live preview, not
to provenance — corrected in the audit too.

### 2.6 Guard the exported API (S)

`traceConfidence({sealedPx: 4, virtualFrac: NaN})` → `score: NaN` (serialising as `null`). Rev
1's repro omitted `sealedPx` and would not have reproduced it — the branch is guarded at
`confidence.ts:44`.

### 2.7 A6 — make the batch and MCP surfaces call the same engine (M) — **promoted from "unscheduled"; this is what actually blocks item F**

`mcp/src/session.ts:246` calls `buildMask` with no `pxPerFt`; `:341`/`:394-395` call raw
`floodRegion`; `detectRegions` (`detectRooms.ts:83`) likewise. Round 9 measured the cost: raw
0.817 vs sealed 0.999 mean IoU on the 8 VA seeds, and **560 SF double-counted (16.6%)** across
56 label seeds, against a 0.5% gate. An MCP `one_click` and a canvas One-Click on the same seed
return different SF under the same `origin.method: "one_click_v1"`.

**Note this also completes Phase 1**: the MCP path passes no `pxPerFt`, so A1's fix does not
reach it until 2.7 lands.

**Exit criteria**
- 2.4 (both directions) in CI and green. Reverting any magnitude scaling fails the ceiling;
  replacing `traceConfidence` with `() => ({score: 0.5, factors: []})` fails the floor.
- 2.7: MCP and canvas return SF within 0.1% on all 8 VA probe seeds; double-counted floor
  across the 56 label seeds drops from 16.6% to ≤0.5%.
- **Item F unblocks on 2.7 + a 2.1c signal that fires on the two hatch known-fails** — not on
  the annotation case, which is exempt.

---

## Phase 3 — the two false "can never" claims

### 3.1 Curved-wall annexation (M) — A4

- The bounding box at `oneclick.ts:1111` is **axis-aligned**; compute it in the arc's **chord
  frame**.
- **Rev 1's "make the ceiling feet-true" was a category error.** `2·wedgeCapPx/mppf² =
  2·(π/4)·25·1.3 = 51.05 SF` at *every* `mppf` — it is already feet-true, which is exactly why
  it is a constant. The real defect is that it **ignores the arc's own radius**. Bound the
  allowance by the cluster's fitted radius — and specify how the radius reaches `:1111`, since
  a cluster is mask cells with no radius today (see 3.3).
- Re-derive the `3·2·(bw+bh)` rim as a feet-true growback margin. **Merged with rev 1's 5.4**,
  which edited the same constant in a different phase.

### 3.2 Arc semantics (L) — A5

**Rev 1 scoped all four discriminators to `markPolylineArcs`, which never sees bezier curves.**
`extractVectorGeometry` stamps `SEG_CURVE` on **every** bezier chord unconditionally
(`oneclick.ts:270`) and `markPolylineArcs` flushes on it (`:317`). CAD circles and callout
bubbles are overwhelmingly `curveTo` beziers. So the discriminators must **also** apply at
`extractVectorGeometry` or at `MASK_CURVE_BIT` assignment, and every fixture must exist in
**both** bezier and polyline form.

1. **Reject closed circles** (sweep ≳300°) — columns, callouts, north arrows.
2. **Radius band 1.5–4.5 ft** (not rev 1's 2–6). Lower: 1'-6" closet leaves are real. Upper: at
   1/16"=1'-0" a ¼" paper scallop is 4 ft model, inside a 6 ft band. Pair with sweep and hinge
   tests; never standalone. **Where it computes:** `markPolylineArcs` runs inside
   `extractVectorGeometry` at render time (`TakeoffCanvas.jsx:1197`) with no scale and often
   before calibration, and `rescaleSheet` evicts only `maskCacheRef` (`:2663`) — `segMetaRef`
   survives, so arc marks are never recomputed after calibration. Either thread `pxPerFt` in
   **and** re-run arc marking on `rescaleSheet`, or move the radius test to cluster time.
   Decide and state which. (Note it needs `pxPerFt`, not `mppf` — segments are image px there.)
3. **Cusp-chain rejection — needs tightening or it kills double doors.** Rev 1 asserted the
   cloud signature is one "nothing else has". A mirrored double-door pair — two 90° arcs, equal
   radius, opposite sign, shared meeting point — measured **16/16 chords marked**: identical
   signature, on the hospital plan that *is* the corpus. Require **similar radius AND small
   radius AND ≥3 consecutive reversals**, and add a double-door fixture as a must-not-regress
   case.
4. **Hinge attachment — described backwards in rev 1.** A swing arc does *not* terminate at the
   hinge; its endpoints are the leaf tip and strike point. **The hinge is the fitted circle's
   centre.** The discriminative fact is "the fit centre coincides with a wall corner or leaf
   endpoint", which cleanly separates a column (centre in open space) from a swing. Also note
   hard/soft classification has not run at `markPolylineArcs` time, so "terminates at hard
   linework" is not yet knowable. **Deferred — not scoped** (see deferral list).

**Side effect rev 1 missed:** `classifyHatchSegs` skips `SEG_CURVE` outright
(`oneclick.ts:477`), and the comment at `:458-459` says the exemption is load-bearing.
Un-marking chords returns them to hatch eligibility, and a large tessellated circle has many
near-parallel chord pairs. Add a fixture asserting a rejected column stays a hard barrier.

### 3.3 Wedge budget starvation (S) — A5

`clusters.slice(0, WEDGE_MAX_DOORS)` (`:1097`) takes clusters in **scanline order**. Rev 1 said
"rank by 3.2's score" — **there is no such score and no channel to carry one**: 3.2 produces a
boolean at the *segment* level; clusters are sets of mask cells with no back-link. Specify the
mechanism — `MASK_DOORLIKE_BIT` (bit 8 is free) or re-fit a circle per cluster — or rank by an
intrinsic cluster property.

### 3.4 Honest thresholds (S)

`oneclick.ts:117-118` claims "DIMENSIONLESS … resolution- and scale-free"; `:318` and `:425`
are absolute image px. Fix or correct the comment.

**Risk / rollback.** An over-tight radius band drops real doors → silent under-measurement
(~5–10 SF per lost wedge, the audit's own class). Gate on: no currently-passing probe loses a
wedge.

**Exit criteria**
- Fixtures, in **both** bezier and polyline form, for: curved wall with no door; revision cloud;
  round column; callout bubble; **double door**; small-scale cloud; room with curved fixtures +
  one real door.
- Each asserts `IoU ≥ 0.95` **and** `|ΔSF|/SF ≤ 0.025` against its by-construction golden, at
  all `RES_FACTORS`.
- Independence from the growth allowance is proven by a run with the per-arc allowance set to
  0, asserting the same fixtures still measure within tolerance. Without that second run the
  claim is untested.

---

## Phase 4 — truth

### 4.1 Fix the human guards before any real measurement (S) — C3, C4

- `from-takeoff.mts:183` sets `humanMeasured: true` unconditionally → set it only when no probe
  carries `machine-origin`.
- `:117` treats missing `origin` as human → **reject** shapes with absent provenance
  (`CHANGELOG.md:36` already says so).
- Schema-validate the payload rather than bare `JSON.parse`.

### 4.2 Correct the coverage claim (S) — C2

`score.ts:88-103` sums golden and engine over the **same rows**, so floor in no probe is absent
from both. **Do (b) now:** correct `score.ts:84-86`, `run.mts:83-84` and the issue comment to
say the ±2% check is a tighter aggregate band, not structural coverage. **(a) — independent
case-level truth — is deferred**, not attempted: it needs an export-schema field, a UI
affordance, an operator-protocol change and a `caseCoverage` signature change. Rev 1's "(a)
eventually, (b) immediately" already conceded this; the deferral list now says so.

### 4.3 Sealed protocol (S) — C6

`run.mts:104` truthiness → `=== "1"`. Gitignore `bench/corpus/sealed/`. Stop writing sealed
goldens into `results.json` (`:155`). **Run-once is discipline, not tooling** — state that
plainly rather than implying enforcement.

### 4.4 Seed independence (M) — C5

`interiorSeed` picks maximum boundary clearance — the engine's easiest case, erasing the
near-wall / in-hatch / doorway-adjacent classes the hand-built corpus probes. Use the human's
actual click where the export carries it; otherwise sample several seeds and require agreement.
Fix the latent outside-the-polygon return.

### 4.5 Deducts, outer contour, and wall semantics (M) — C7 + new

`from-takeoff.mts:115` subtracts deducts from the golden while `traceRegion` returns the outer
contour only. **State the answer key's wall-line semantics (centreline vs face) here** — it
interacts directly with 4.7.

### 4.6 Get real plans measured (L — needs you) — C1

Every gate in 4.1–4.5 is dead code until this happens. 2–3 measured plans in different drafting
styles plus one sealed; **different firms matter more than more sheets from one firm.**

**Anti-anchoring protocol (required, not optional).** C4: a human re-tracing the engine's
on-screen outline is undetectable in principle, and 4.1's provenance guards do not catch it.
Measure with One-Click disabled or its layer hidden for the whole session. If impossible,
measure the sealed plan **first**, before any engine run against it, and record the order in
the case note. Without this the key is anchored and `humanMeasured: true` overstates it — which
is C3/C4 one level up.

**Interim exit criterion, since 4.6 has an unbounded external dependency:** commit
`bench/fixtures/fake-human-takeoff.json` and prove each gate fires on it. That is what 4.1–4.5
are verified by until a real key exists.

### 4.7 Characterise the structural measurement bias (M) — **new, found in review**

`enclosed-room`'s golden is exactly 120.0 SF (216×180 px @ 18 px/ft); the engine reads **117.6
SF (−2.0%)**. The cause is structural: the flood excludes the 1-cell wall raster and Moore
traces cell centres, giving (216−2)×(180−2)/324 = 117.55 — matching to 0.05 SF. The bias is
resolution- and scale-dependent (at the VA's 8.929 px/ft one mask px = 1.34").

**This consumes ~80–100% of the `humanMaxSfErr` 2.5% and `humanCoverageBand` 2% gates before
any real engine error.** Correct it (trace on cell edges, or a documented half-cell outset)
**before** any human key is measured, or the first real answer key fails for a reason that is
not an engine error.

**Exit criteria**
- ≥1 case with `humanMeasured: true` produced from a payload with zero machine-origin shapes,
  and `npm run bench` evaluating all three human gates on it — proved by a deliberate 3%
  perturbation exiting non-zero, committed as a test.
- `from-takeoff.mts` exits non-zero on a payload whose shapes carry no `origin`.
- `git check-ignore bench/corpus/sealed/` succeeds.
- `enclosed-room` measures within 0.5% of its 120.0 SF by-construction golden (4.7).

---

## Phase 5 — determinism, honestly

### 5.1 SF-error cross gate (M — **not S**) — B7

IoU ≥0.90 admits −10.0%/+11.1% area, 4× looser than the repo's own 2.5% SF gate. Gate
`|ΔSF|/SF ≤ 0.025` directly.

**Rev 1 said this "costs nothing". It turns the bench red today** — measured on the synthetic
corpus: `two-doorways/center` **4.43%**, `curved-partition/left-half` **2.81%**, both
non-known-fail. Carry the decision explicitly: fix, raise threshold, or known-fail. Note 4.7's
bias is a likely contributor.

### 5.2 State that no real plan is cross-checked (S) — B6

All 9 VA probes excluded; the headline `pair-IoU floor 0.962` describes synthetic rectangles
and an 891-byte generated PDF.

### 5.3 Close D-2 (S — **merged into Phase 1**)

**Rev 1 offered "raise resolution" as an option. Review refuted it** (see the 1.1 table: IoU
collapses to 0.026). D-2 is therefore not a choice: **accept the instability and gate it
explicitly.** Add `ward-room-294sf` cross-check as a tracked known-fail carrying `−52.6% at
×0.75` in its tag, in 0.4's always-printed block. The real fix is RFC item A.

### 5.4 Feet-true the remaining hardcoded px (M) — D13

`dt > 3` (`:1183`) and the cluster bridge radius (`:956`). **The `:1111` rim is merged into
3.1** to avoid two phases editing one constant. Note also that px **floors** dominate at the
VA's 8.929 px/ft — `nudge` is 3 px = 4", **3× the feet-true 2"**. *This changes measured SF and
re-pins what Phase 1 pinned; sequence it with 0.9.*

### 5.5 Fix or retract "bit-identical … regression-tested" (S) — *audit "What holds up" + D16*

The arithmetic is right; the test compares one `floodRegion` count on a hatch-free scene and
cannot observe `HATCH_MAX_PITCH_FT` bit-identity at all. *(Rev 1 mislabelled this D14, which is
the entanglement audit.)*

**Exit criteria**
- The cross gate reports `|ΔSF|/SF` per pair and fails above 2.5%; the ring-IoU number is
  **removed** from the summary, not merely supplemented.
- Every probe prints either a pair count ≥2 or `NOT cross-checked`; the summary states the
  real-plan count on the same line as the floor.
- D-2 closed in writing here, with the cost stated.

---

## Phase 6 — the working record

**Moved earlier in priority than rev 1 had it** — not for disclosure, but because the issue is
the project's working state and the next session reads it. 6.0 first.

| # | Task | Where | Finding |
|---|---|---|---|
| 6.0 | **Un-block item F.** Change "(next session starts at item 1)" and annotate item F: blocked on A6 (2.7), with round 9's 16.6% double-counted-floor measurement. Rev 1's stated reason (confidence) was wrong; the reason is the raw-engine divergence. | body §Remaining work | A6, round 9 |
| 6.1 | Correct "3 probes cover the full floor". Round 8 identified 79.4 SF outside any probe (240.8 − 161.4); the remediation pinned 19.0 (band) + 39.2 (toilet) = 58.3. **21.1 SF is still in no probe.** This also reconciles "~78 SF" with "20.8 SF completes the coverage" — they were never consistent. | body, comment `5099217709` | D1 |
| 6.2 | Band is **19.0 SF**, not 20.8. | body, comment; `2ea5487` msg is immutable — record here | D2 |
| 6.3 | **Retract** round 4's "toilet correctly excluded / 249.3 SF". | comment `5095757169` | D3 |
| 6.4 | Body: set the count to **843 at `21e57a0`** and date it ("as of `<sha>`") rather than writing 835, which would replace a stale wrong number with a fresh one. Annotate 837→835 in the round-8 review comment. Commit messages are immutable — record, don't rewrite. | body, comment | D4 |
| 6.5 | Repoint the evidence index and slice-doc links at the branch holding rounds 7–8 evidence; fix the two malformed image links. | body, comments | D5 |
| 6.6 | Retract/annotate: corridor 1,718 SF (never pinned; also in the evidence *filename*), 0.04→0.02 SF overlap, the vestibule "recovery" that overshoots its baseline by 30.8%, the sample-plan total, round 3's "~3–4%" (actually 4.4%, both superseded by 136.8). | rounds 1,2,3; body; filename | D9 |
| 6.7 | Rename `ward-room-294sf` — measures 229.3. | corpus | D9 |
| 6.8 | Downgrade "four independent reviewers" to what the artifacts support; note 2 of 5 repros became regression tests. | comment `5099217709` | D6, D7 |
| 6.9 | **Mark as unrepeated one-off measurements**: "23 s → 0.39 s", "~285 ms", "37,048 of 71,819", the 75/80-seed sweep, 0.56 ft / 0.42 ft, and the design doc's uncommitted round-trip table. A perf harness is deferred. | comments, `oneclick.ts:83,85,97`, design doc | D8 |
| 6.10 | Replace the quoted RFC paraphrase with the actual sentence; stop attributing claims to a text not in the repo. | comment `5095944377` | D10 |
| 6.11 | Update the body for `7605315`, `21e57a0` and round 9; add the engine-pinned caveat wherever 0.991/0.957 appears. | body | D12, B1 |
| 6.12 | Add the missing regression test for the O(N²) lattice fix, or state it is unguarded. | `web/test/` | D7 |
| 6.13 | Fix the e2e header comments, which document the opposite contract. | `e2e/one-click.e2e.cjs:6`, `make-fixture.cjs:7` | D16 |
| 6.14 | Correct the entanglement audit: `confidence.ts:22` **does** import from `./oneclick`; add `geometry.js`; classify `7605315`'s files **and this plan's own new work** (CI, 2.5 badge, 4.x pipeline, new fixtures); write the check line 80 promises or drop it. | slice doc | D14, E-7 |
| 6.15 | "Operator request" (round-8 casework item) has no artifact — attribute it or mark it unsourced. | comment `5099217709` | D11 |
| 6.16 | Annotate the contradicted checkboxes: item C `[x]` ships with `annotation-ring-room` at IoU 0.650; failure mode #3 `[x]` concedes its own floor is "pragmatic"; item D `[x]` while A2 shows it doesn't do its job; round 6's "E ✅ … + CI gate" while there is no CI gate. | body, comment `5096087775` | D15, B2 |
| 6.17 | Correct the "Negative-tested: a deliberately mismeasured room fails the bench" claim — `benchScore.test.ts` shrinks by 2%, *under* the 2.5% gate, and no test imports `run.mts`. Pair with 4.8. | comment `5099531899` | C6 |
| 6.18 | Correct "retires seven knobs": the seven are gone, but module-wide named constants went 42→41 and the replacements moved into unexported literals. Knob *relocation*. | comment `5098666393` | D13 |

**Also: 4.8** — export `THRESHOLDS` (`run.mts:25`) and add a test that a human case at 3% room
error exits 1. (S) — C6's other half.

**Exit criteria**
- A grep of the issue body and all comments for each retired number (`249.3`, `20.8`, `1,718`,
  `837`, `847`, `0.04 SF`, `294`, `1,751.9`, `133.7`) returns either zero hits or a hit
  adjacent to an explicit retraction.
- The body no longer directs the next session to start at item F.

---

## Deferred — accepted risk, not scheduled

Rev 1's deferral section named two items and implied everything else was scheduled. The honest
list:

| ID | Deferred | Risk if not done |
|---|---|---|
| A7 | Escalation floor 0.02; only bound is a 2.5× cap that passes a clean 2.0× two-room merge at conf 0.95. `softFrac` counts duplicate encounters, so the verdict is resolution-sensitive. | Silent two-room merges |
| A8 | Hover perf: ~1 s blocked, ~119 MB churn per room. **Phase 1 makes it worse** — see 1.3 risk note. | User-visible stall; may block Phase 1 |
| C4 | Anchoring bias is mitigated by protocol (4.6) but not detectable by tooling. | A human key that agrees with the engine for the wrong reason |
| 3.2(4) | Hinge attachment — the highest-value discriminator and the only one that generalizes off scaled sheets. | Arc discrimination stays weaker than it could be |
| 4.2(a) | Independent case-level truth. Needs export schema + UI + protocol + `caseCoverage` signature. | ±2% remains an aggregate band, not structural coverage |
| D16 | `confidence.test.ts:11-13` asserts the implementation's own constants back at itself (`CONF_RASTER` could become 0.05 and it passes). | Confidence constants untested |
| D16 | `roomName.ts:79` returns a bare number line as a room name — keynote "213" becomes a label. | Mislabelled takeoffs |
| — | The `fflate` dynamic-import build failure, seen once, unreproduced. | Unknown; may surface in CI once 0.1 lands |
| — | Perf harness for D8's numbers. | Perf claims stay unrepeatable |

**Not fixed by this plan, and needing RFC item A (vector-native face extraction):** annotation
semantics (`annotation-ring-room`, cap-invariant at 0.650 per round 9), and the
partition-bank / tile-demising pitch ambiguities — though round 9 shows these two *are*
cap-sensitive (0.197 → 0.937 at 1.0–1.1 ft), so "not fixable by caps" holds only for a
**global** cap. A per-project cap with the design doc's never-auto-apply guard rails is a real
option and is not evaluated here.

**Also not fixed:** any claim resting on visual verification. No auditor could check a browser
measurement, and D3 shows at least one "verified visually" claim was wrong.

---

## Decisions needed

- **D-1.** Apply the room-size cap and ≥75% rule to the min-passage primary path? Recommend
  yes, with the refusal-rate rollback in 2.2.
- **D-2.** ~~Raise resolution or accept instability?~~ **Closed by review** — raising resolution
  collapses the flagship plan (IoU 0.999 → 0.026). Accept and gate explicitly (5.3).
- **D-3.** ~~Public disclosure of the audit?~~ **Withdrawn** — out of scope.
- **D-4.** Phase 4.2: (a) independent case-level truth or (b) correct the claim? **(b) now, (a)
  deferred** — recorded above rather than left open.
- **D-5 (new).** 3.2's radius test: thread `pxPerFt` into `extractVectorGeometry` and re-run arc
  marking on `rescaleSheet`, or move the test to cluster time where `mppf` exists?
- **D-6 (new).** 5.1 turns the bench red on two synthetic probes today. Fix the probes, raise
  the threshold, or track as known-fail?
