# Issue #184 — remediation plan

Companion to [`ISSUE_184_AUDIT.md`](./ISSUE_184_AUDIT.md). Finding IDs (A1, B3, …) refer to
that document.

**Status: passed adversarial review at rev 7** (cycle 6, a narrow confirmation pass, verified
the last fix and found nothing new). Blocking findings per cycle: **10 → 10 → 7 → 6 → 1 → 0**.
Two cycles found defects in the *product* rather than in this document, and both are now audit
findings: **A5b** (the bench scores a quantity production never returns) and the **A1
correction** (pinning `mppf` does not fix it; `Math.round(segs·ws)` still follows render scale,
so cap-bound sheets shift too).

**Revision 7 (final).** Cycle 5 returned a single blocking item and judged Phases 0 and 1
otherwise executable. Blocking findings per cycle ran 10 → 10 → 7 → 6 → 1, and the character
shifted from "this claim is false" to "this task is half-specified" — the substance has
converged. The last item: 0.11's exit criterion existed in two divergent versions, the operative
one naming an unreachable command and the replacement going vacuous once 0.11d lands
(`oneClickRing == oneClickRing`). Both are replaced with two runnable checks. The remaining
cycle-5 items were non-blocking and are applied.

**Revision 6.** Cycle 4 found six blocking defects, four of them inside the 0.11 that rev 5 had
just rewritten. The two that change the audit: **(a) pinning `mppf` does not fix A1** — the mask
quantizes with `Math.round(segs[i]·ws)`, so identical `mppf` still yields different cells at
different render scales, measured on the *cap-bound* VA sheet at −3.96% / +2.88% / +5.21%, the
case both documents treated as immune (new task 1.1i; audit A1 corrected); and **(b) round 1's
"1,751.9 SF", which 6.6 was scheduled to retract, is correct** — it is 4 × 437.978, the snapped
production reading against the un-snapped bench's 1,744.7, i.e. A5b visible in the project's own
history since round 1 and mistaken for sloppiness ever since.

Also: 0.11 alone would have made 8 of 9 synthetic probes byte-identical across resolutions,
turning the "independent truth" bucket into a tautology and voiding the failure-mode-#3 gate — it
now ships with 0.11a–0.11d; snapping *is* the wall-line-semantics decision, so D-8 and D-9 merge
and become blocking task 0.12; 0.11's exit criterion had no reachable command (`proposeRegion` is
an unexported closure), hence the shared-helper extraction; `SyntheticCase` has no `points` field
so the synthetic corpus cannot be snapped as written; and D-10's relative floor was non-strict, so
a constant-score stub passed it.

**Revision 5.** Cycle 3 found that rev 4's highest-priority task measured the harness instead
of the product. **`snapVertices` is applied at all three canvas call sites and both MCP sites,
and is absent from `bench/` entirely** — so the −2.03% "structural bias" rev 4 promoted to
Phase 0 is a bench artifact; production reads exactly 120.000 SF, as the e2e asserts through
real Chromium. Rev 4's outset remedy would have pushed the shipped answer *above* truth. The
defect underneath is larger and is now audit finding **A5b**: every engine-pinned golden pins a
quantity the product never returns, off +2.2% to +8.5% on the VA plan, and the answer-key
pipeline compares snapped human geometry to un-snapped engine rings against a 2.5% gate. 0.11 is
rewritten as bench↔production parity; D-6's **premise** and Phase 3's exit note are retracted
with it (D-6 itself remains a live decision).

Also fixed: Phase 2's exit criterion could not fire under its own likely branch (ceiling
population empties, floor calibrates below the anti-gaming stub) — now D-10; rev 4's "14 probes"
correction reverted a right statement by silently switching back to IoU keying (it is 12); D-8
was promoted in prose with no owning task; and several rev-2-era leftovers in §1.1 that the
retained `ws ≤ 1` clamp makes no-ops.

**Revision 4.** A second cycle-2 reviewer ran against rev 2 in parallel. Its findings against
rev 2's Phase 1 (`TARGET_MPPF = 36` changes resolution on every under-cap sheet in both
directions; the bench cannot see it) are **already dissolved by rev 3's formula**, which
reduces to `min(cap/imgmax, 1)` at the default render — today's rule exactly, on every sheet
rather than two. Its remaining findings are new and are applied here: the min-passage factor
conflicts with 2.4's floor (B5), both named bias remedies miss their own exit criterion (B6),
Phase 3 cannot exit before the bias fix lands (B8), the raster proposal introduces a
stale-cache bug (H1), and 1.1e reds the bench today (H2). Plus four citation corrections and
an over-correction of my own in 2.1b.

**Revision 3.** Rev 2 was reviewed and failed. Three of its criteria were falsifiable in
minutes with commands already in the repo, and all three were wrong — the fairest summary
being that rev 2 asked for a verification ledger it had not run against itself. Corrected
here, each verified by execution:

- **Rev 2's Phase 1 formula raised resolution on every sub-cap sheet, under a heading saying
  "Do not raise resolution."** `TARGET_MPPF = 36` was also just `sample-plan`'s own
  `pxPerFt` read off the corpus, making its "the corpus does not move" exit criterion a
  tautology. Replaced with a formula that provably preserves today's default answer
  everywhere (1.1).
- **Rev 2's re-pin acceptance test named the wrong commit pair.** Shoelaced: the −33%
  regression is `2730050 → 92c1242` (240.77 → 161.91 SF, **−32.75%**); the pair rev 2 named,
  `92c1242 → 2ea5487`, moves the probe **−0.33%** — inside its own ±2.5% threshold, so
  replaying it would have demonstrated the protocol failing to fire.
- **Rev 2's two SF-error figures were wrong.** Measured from `bench/results.json`:
  `two-doorways/center` is **4.33%** (not 4.43%) and `curved-partition/left-half` is **3.20%**
  (not 2.81%).

**On exit criteria coverage.** 0.8 states the rule *"a criterion with no command is not one"*.
Review found the converse unpoliced: a number of tasks carry no exit criterion at all.
*(Rev 4 listed 0.8 and 4.5 among them; both do have one — Phase 0 bullet 3 and Phase 4 bullet 4
respectively. The list was itself unchecked, which is the sin it was describing.)* Rather than manufacture one
per task, the rule is narrowed and stated honestly: **every task that changes measured output
or a gate must have an exit criterion; small mechanical tasks are verified by the ledger row
alone.** 0.8's `check-ledger.mjs` enforces the first class. Tasks in the second class are marked
`ledger-only` when the ledger is written.

**Attribution convention** (absent from rev 2, and the omission is the audit's own core sin):
figures carry a named source — `round 9`, `review`, or `audit`. Figures with no named source
are this document's own measurement at `21e57a0`, reproducible with
`npm run bench && node -e "require('./bench/results.json').scores.forEach(p=>console.log(p.caseName+'/'+p.probeName,p.iou,p.sfErr))"`.

**Revision 2 (retained for the record).** Revision 1 was reviewed by two adversarial reviewers
and failed. Three of its central proposals were refuted *by execution*, not argument:

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
  `NNN SF` callouts. Round 9 resolved **5** of them to a modal region, with seed agreement of
  14/25, 8/25, 13/25, 17/25 and 18/25; engine vs callout: **+11.1%, −8.3%, −24.2%, −38.7%,
  −43.8%**. The −8.3% row is a minority vote (8/25), and the other 4 callouts are unreported —
  the agreement fraction is the part that matters and rev 2 dropped it. Mixed signs, so not a
  scale error. It may be a finish-zone convention rather than engine error —
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
item-F detection metrics → F). This plan adopts the callout harness (0.10), the `detectRegions`
parity (2.7) and the item-F detection metrics (2.8), and reorders by putting the re-pin
protocol and the live A1 bug first. *(Rev 2 said it "differs on ordering only" while silently
dropping the detection-metrics step — the very thing that makes F safe.)*

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
| 0.1a | Add `lint` and `bench` to CI. Extend `check` to `typecheck && lint && test && bench && build` and have CI call it, so the definition lives in one place. Rev 1's "prefer `npm run check`" was wrong — `check` contains neither `bench` nor `e2e`, so it would have added lint only. Also extend `lint` (`eslint src netlify/functions`) to cover `bench test e2e`. Note this is a **policy reversal**, not an oversight: `eslint.config.mjs:5` documents the `.ts` exclusion as deliberate ("tsc --noEmit already checks them strictly"). | B2 | S |
| 0.1b | Add `e2e` to CI. **Not S.** `playwright` is in neither `dependencies` nor `devDependencies` and is not in `node_modules`; `e2e/one-click.e2e.cjs:14-20` falls back to a *global* install. Needs a devDependency, `npx playwright install --with-deps chromium`, a vite dev server on 5199, and a flake budget. | B2 | M |
| 0.2 | Assert an expected probe count in `bench/run.mts`; fail on mismatch. | B4 | S |
| 0.3 | **Xpass detection**: a `knownFail` probe that now passes fails the run. | B3 | S |
| 0.4 | Always-printed known-fail block with IoU and SF error, so `open-margin`'s live `NOT refused` and the two `LEAK` rows appear in the summary. | B3 | S |
| 0.5 | Drop `maxLeakRate` or redefine it — leak implies IoU < 0.5, which the 0.90 floor already catches, so it is unreachable and cannot be evidence. | B5 | S |
| 0.6 | Label the refusal denominator (`3 synthetic probes`); `correctRefusalRate` returns `n/a` on an empty set, not `1`. | B5 | S |
| 0.7 | Split the headline: `synthetic (independent truth): n=9 …` and `engine-pinned (regression-only): n=12 …`. Never print a blended accuracy figure. | B1 | S |
| 0.8 | **Verification ledger** — `ISSUE_184_REMEDIATION_LEDGER.md`. Every exit criterion gets: criterion, the exact command that checks it, the commit checked at, and who checked it. A criterion with no command is not one — delete it or make it one. Self-checked rows marked `self`, so the record shows what carries independent weight. Rev 1 specified no reviewer for any of its own work, which is finding D6 one level up. | D6 | S |
| 0.9 | **Re-pin protocol. Blocks 0.11 and Phases 1, 2, 3, 4 and 5.** `pin-goldens.mts` emits a per-probe diff on every re-pin: old SF, new SF, Δ%, old-vs-new set-difference render, IoU(old,new). Any probe moving >±2.5% fails unless the commit body carries a per-probe adjudication. Add the adjacency-tiling invariant: for `wholePlan` cases, pairwise overlap ≤0.5% **and** the case total must not move >2.5% without adjudication. | B1, bug #17 | M |
| 0.10 | **Callout cross-check harness** (round 9). Report engine SF vs the plan's own printed `NNN SF` callouts. **Reported, never gated** — the convention is unknown. Reproduce round 9's method: 25-seed jitter per anchor (callout text often sits inside stroke glyphs), modal region, and **report the agreement fraction beside each error**. Done = with a **specified deterministic seed sequence**, the harness reproduces round 9's four *majority* rows within 1 percentage point at `21e57a0`; the 8/25-plurality row is reported with its fraction, ungated. (Gating a plurality result on an unspecified RNG would be unsatisfiable through no fault of the harness.) | round 9 | M |
| 0.12 | **Decide wall-line semantics (centreline vs face) and whether snapping is correct. Blocks 0.11.** Merged D-8 + D-9, promoted from Phase 4. Method: the interior-clear-vs-centreline arithmetic in 0.11's note (plus the human-authored 120 SF e2e golden) is **decisive**; 0.10's callout harness is **corroborative only** — centreline-vs-face is a ~1.6% question and the callout residuals run +11.1% to −43.8% with mixed signs, so it cannot resolve it. Record the answer in the corpus files. | C7, D-8/D-9 | M |
| 0.11 | **Bench↔production parity: the bench scores a quantity the product never returns.** Blocks Phase 3's exit, Phase 4's human gates, and D-6. *(Rev 2 called this a rasterisation bias and numbered it 4.7; rev 3 moved it to 4.0; rev 4 to 0.11; rev 5 rewrote it after review showed production snaps and reads exactly 120.000 SF.)* Detail below. | **A5b** | M |

**0.11 in detail — rewritten in rev 5; the previous version fixed the wrong layer.**

Rev 4 proposed correcting a −2.03% rasterisation bias inside `traceRegion`. **Production does
not have that bias.** It applies vertex snapping to every traced ring —
`TakeoffCanvas.jsx:2882` (commit), `:3144` (hover), `:3986` (agent), `mcp/src/session.ts:344`,
`:398` — and computes `area_sf` from the snapped ring. `bench/run.mts:53` and
`pin-goldens.mts:86` call bare `traceRegion(f)` and **neither imports `snapVertices` at all**:

| probe | golden | bench (raw) | production (snapped) |
|---|---|---|---|
| `enclosed-room` ×1/×0.75/×0.5 | 120.000 | 117.568 / 116.763 / 115.160 | **120.000 / 120.000 / 120.000** |
| `two-doorways/center` | 19.753 | 18.898 (−4.33%) | **19.753 (0.00%)** |
| `curved-partition/left-half` | 68.379 | 66.191 (−3.20%) | 67.931 (−0.65%) |
| `patient-room-137` | 161.37 | 161.33 | 167.99 (**+4.10%**) |
| `patient-room-137-band` | 19.04 | 19.04 | 20.67 (**+8.52%**) |
| `elevator-e01` | 136.79 | 136.76 | 142.67 (**+4.30%**) |

`e2e/one-click.e2e.cjs:84` asserts 120 SF through real Chromium and passes — independent proof
that production is exact where the bench reads −2.03%. Had rev 4's outset landed, it would have
pushed the shipped answer *above* truth: a silent over-measurement introduced by a Phase-0 task,
the audit's own dangerous class.

**The real defect is larger and is now audit finding A5b: the bench scores a quantity the
product never returns**, off +2.2% to +8.5% on the flagship plan. That is A6's failure class on
the bench surface, and it silently corrupts the answer-key pipeline — `from-takeoff.mts` builds
the human golden from *exported, snapped* shapes while `run.mts` scores *un-snapped* engine
rings, a systematic ~4% offset against a 2.5% gate.

**The task, therefore:** make the bench call the same pipeline as the canvas — add
`buildSnapGrid`/`snapVertices` to `run.mts` and `pin-goldens.mts` — then re-pin all 12 pinned
goldens under 0.9 and **re-measure the residual before deciding anything downstream.** It is
still the largest re-pin in the plan.

**0.11 IS the wall-line-semantics decision — it does not merely depend on one.** Rev 5 demoted
D-8 back to Phase 4 on the grounds that withdrawing the outset removed the dependency. Review
showed the dependency moved rather than vanished: `snapVertices` pulls corners onto
`extractVectorGeometry`'s `points`, which are **PDF path vertices — wall centrelines**, not
faces. Confirmed from the fixture generators: `demo/make_sample_plan.py:16-20` draws
`"3 w"` / `"120 110 980 580 re"`, so per room interior-clear is 431.39 SF against centreline
438.58 SF (measured: raw 436.176, snapped 437.978); and `e2e/make-fixture.cjs:23,37` draws the
216×180 pt rectangle at 1.6 pt thickness, so **the 120 SF golden is the centreline rectangle** —
interior-clear would be 118.05 SF. That is precisely why snapping reads exactly 120.000 and the
e2e passes.

So 0.11 re-pins the whole corpus to centreline semantics **in Phase 0**. The VA case total moves
**2511.5 → 2580.4 SF (+2.74%)**, which trips 0.9's own ±2.5% case-total invariant.

**Therefore D-8 and D-9 are the same decision, merged and promoted to Phase 0 as task 0.12,
blocking 0.11** — with an owning task, a method (0.10's callout harness plus the interior-clear
arithmetic above), and the semantics recorded in the corpus files. Deferring it while 0.11
re-pins is the ordering error §Sequencing-3 forbids.

**0.11 still does not settle:**
- **Is snapping correct as a measurement policy?** It inflated the 19 SF annotation band by
  8.5%. Folded into **D-8** above.
- **The raster path genuinely skips snapping** (`TakeoffCanvas.jsx:2870-2871`, `:2879`), so it
  *does* carry the rasterisation bias rev 4 described. A narrowed version of the old 0.11
  survives for scans only — where `mppf` is also absent (2.3), so it compounds.

**What this retracts elsewhere in this plan:** D-6's premise (both probes are bench artifacts —
0.00% and −0.65% in production), and Phase 3's "a 120 SF rectangle burns 82% of the 2.5% budget
on rasterisation alone" (in production it burns 0%). Both corrected below.

**0.11 must not ship alone — it destroys the corpus's only independent accuracy signal.**
Review measured that after snapping, **8 of the 9 non-known-fail synthetic probes produce a
byte-identical ring at every mask resolution** (all four corners land on the same PDF endpoints
whatever the mask did), scoring IoU **1.0000** against their by-construction goldens and
pairIoU 1.0000 across resolutions. Today those same probes read −2.03% at ×1 and −4.03% at ×0.5.
Two consequences:
- The "9 synthetic, truth-by-construction" bucket becomes ~1.000 **by construction of the
  snap**, not by engine accuracy — a fresh tautology of exactly the class audit B1 exists to
  name, introduced by a Phase-0 task. Task **0.7** would then print
  `synthetic (independent truth): n=9 … 1.000`, which is worse than the blended figure 0.7 was
  written to abolish.
- The cross-resolution gate (RFC failure mode #3) **goes vacuous on those 8 probes** — a 4%
  mask-resolution regression becomes undetectable there.

So 0.11 ships with four companions:
- **0.11a** — keep an **un-snapped mask-fidelity metric**, reported alongside and ungated, so
  rasterisation error stays visible. (S)
- **0.11b** — add at least one by-construction fixture whose corners are **not** PDF endpoints.
  The repo already has the pattern: `sample-plan`'s rooms have three snappable corners and one
  un-snappable cross-intersection, reading **+0.41%** snapped where raw is exactly 0.00%. (S)
- **0.11c** — restate 0.7 so the synthetic headline cannot be read as accuracy post-0.11. (S)

**Implementability — two source-level gaps rev 5 assumed away:**
- **`bench/corpus.ts:21-28` `SyntheticCase` has no `points` field**, so the 9 synthetic probes
  cannot be snapped at all without extending the interface. (`pin-goldens.mts:78` and
  `run.mts:115` already have `g.points` — one line each.)
- **The point set is a real choice, not a detail.** `extractVectorGeometry`'s `visit()`
  (`oneclick.ts:251-283`) records moveTo/lineTo/bezier **endpoint only**/rect corners — it skips
  bezier chord vertices and the `closePath` vertex. Deriving points from all segment endpoints
  is faithful for `corpus.ts`'s lineTo geometry but **not** for bezier-tessellated arcs, which
  is exactly `curved-partition` and `door-swing-3ft`. State the point set explicitly, author it
  per case to mirror a real PDF op-list, and **do not re-pin the synthetic goldens** — they are
  truth by construction and must stay fixed while the engine moves toward them.

**Exit criteria for 0.11 — two runnable checks.** *(Rev 6 had "a test that runs both paths
through the shared helper", which is vacuous post-0.11d: both call sites **are** the helper, so
the test asserts `oneClickRing == oneClickRing`. A fresh tautology inside the task whose whole
subject is a tautological gate.)*
- **(a) Single-pipeline assertion:** no site in `src/`, `bench/` or `mcp/` calls `traceRegion`
  outside `oneClickRing` — grep-able, and it is what "the same pipeline" actually means.
- **(b) Cross-surface agreement:** `npm run bench` reads `enclosed-room` = 120.000 SF while
  `e2e/one-click.e2e.cjs:84` asserts 120 SF in Chromium. Two independent surfaces, both
  runnable today.
- All 12 pinned goldens re-pinned under 0.9 with per-probe adjudication; the un-snapped
  mask-fidelity metric reported (0.11a); residual re-measured.
- **0.11b:** the non-endpoint fixture is in the corpus and reads its by-construction golden to
  the stated tolerance. **0.11c:** `npm run bench` no longer prints a synthetic headline that
  can be read as accuracy.

- **0.11d** — **extract trace+snap into an exported helper** (e.g. `oneClickRing(mo, seed,
  snapGrid, raster)` in `oneclick.ts`) called by `TakeoffCanvas.jsx:2882/:3144/:3986`,
  `mcp/src/session.ts:344/:398`, `run.mts:53` and `pin-goldens.mts:86`. **Without this 0.11's
  exit criterion has no command and cannot be given one**: `proposeRegion` is an unexported
  closure inside the default-exported React component (`TakeoffCanvas.jsx:2875`; `:162` is the
  file's only `export`), and nothing in `web/test/` can reach line 2882. It also makes 2.7
  cheaper. (M)

**Exit criteria**
- CI goes red on each of four committed mutation tests: a deleted corpus file; a known-fail
  flipped to passing; a broken e2e assertion; a lint error introduced **in `bench/`**
  (currently unlinted, so green today and shouldn't be). "CI goes red" is not checkable
  without them.
- **0.9's acceptance test:** replaying the **`2730050` → `92c1242`** re-pin under 0.9 flags
  `patient-room-137` at **−32.75%** (240.77 → 161.91 SF, shoelace on the pinned goldens at
  `ptPerFt` 18). The negative control: `92c1242` → `2ea5487` moves the same probe −0.33% and
  must **not** flag.
  **Critically — the whole-case invariant does not fire on this event.** The case total moves
  only 2476.7 → 2489.5 SF (**+0.5%**), because the toilet probe was added in the same commit
  that lost 79 SF from the room. So the per-probe rule is what must carry 0.9; the adjacency
  and case-total checks would have missed the repo's worst re-pin. *(Rev 2 named the wrong
  pair — `92c1242` → `2ea5487`, at −0.33%, inside its own threshold — so its acceptance test
  would have demonstrated the protocol failing to fire.)*
- `ISSUE_184_REMEDIATION_LEDGER.md` has one row per exit criterion in this plan, each with a
  runnable command; a `scripts/check-ledger.mjs` exits non-zero if any criterion lacks a row
  or any row lacks a command. **At least the Phase 0 and Phase 2 rows carry a named non-`self`
  checker** — otherwise 0.8 re-commits D6 in the task that diagnoses it, which is what rev 2
  did.
- 0.11: see 0.11's own two runnable checks (single-pipeline assertion; bench 120.000 SF vs the
  e2e's 120 SF in Chromium). *(Rev 6 left an older version here naming `TakeoffCanvas.jsx:2882`
  — the criterion 0.11d proves has no reachable command, sitting in the very gate list 0.8
  enumerates.)*
- `npm run bench` prints the synthetic/pinned split and the callout table.

---

## Phase 1 — the live product bug

### 1.0 Mitigate A1 today (S)

Before the refactor lands, make the Hi-Res toggle not change measurement: hide it behind a
flag, or force the mask path to a render-independent resolution regardless of `hiResKeys`. A
one-line mitigation today beats an exact fix after Phase 0. Revert when 1.1 **and 1.1i** land — 1.1 alone does not fix A1 on cap-bound sheets, so reverting in between re-exposes it.

### 1.1 Decouple mask resolution from render scale (M)

**The algebra holds** — verified: `uppFor` (`panelGeometry.js:41-45`) returns
`scales[key]/(rs/RENDER_SCALE)` and `scales[key]` is feet-per-px at `RENDER_SCALE=2`, so
`1/upp = rs·ptPerFt`. Calibration is stored in baseline-render-px space, which is point space
times a constant, so `rs` genuinely cancels.

**Both rev 1's and rev 2's formulas are withdrawn.** Rev 1 routed through page point size,
which `buildMask` cannot see. Rev 2 used `ws = min(cap/imgmax, TARGET_MPPF/pxPerFt)` with
`TARGET_MPPF = 36` — which **removes the `ws ≤ 1` clamp and therefore raises `mppf` on every
sub-cap sheet.** Worked on the audit's own A1 scene (11×17 at 1/8", `rs` 2, `pxPerFt` 18):
`ws` 1.000 → 1.2255, `mppf` 18.00 → 22.06 — precisely the resolution the audit measured at
**134.0 SF vs 97.8 SF, +37%**. Rev 2 would have converged the toggle on the Hi-Res answer and
changed the default reading on that entire sheet class, while its own table showed higher
`mppf` collapsing VA probes to IoU 0.026. And `TARGET_MPPF = 36` was `sample-plan`'s
`pxPerFt`, so "the corpus does not move" was true by construction.

**The requirement, stated properly.** `mppf` must be a function of the sheet's calibration and
constants only — never of `rs`. Since `mppf = pxPerFt·ws` and `pxPerFt = rs·ptPerFt`,
invariance requires `ws ∝ 1/rs`. Among all such choices, exactly one preserves today's default
answer: **target `mppf` = the baseline-render px/ft**, i.e. `1/scales[key]`, the value a sheet
already gets at `rs = RENDER_SCALE` with `ws = 1`.

```
basePxPerFt = 1 / scales[key]                          // px/ft at RENDER_SCALE, rs-independent
ws = min( maxDim / max(imgW, imgH),  basePxPerFt / pxPerFt )     when pxPerFt > 0
ws = min( 1, maxDim / max(imgW, imgH) )                          when pxPerFt = 0  (unchanged)
```

`basePxPerFt / pxPerFt = RENDER_SCALE / rs`, so at the default `rs = RENDER_SCALE` this is
exactly 1 and **every sheet keeps today's mask, sub-cap and cap-bound alike**; at Hi-Res it
scales down by exactly the render increase, giving the same `mppf`. VA stays cap-bound
(0.496). No sheet's resolution changes in either direction.

**This does require passing `basePxPerFt` into `buildMask`** — one added argument, at
`TakeoffCanvas.jsx:2816`, `bench/run.mts:47`, `pin-goldens.mts`, `mcp/src/session.ts:246` and
the test call sites. Rev 2 contorted the formula specifically to avoid a signature change and
got a wrong formula for it. The signature change is the cheaper price; it is stated here
rather than dodged.

- **1.1g** — **`rescaleSheet` must also evict `rasterMaskCacheRef`/`rasterMaskReadyRef`.**
  Today the raster mask's `ws` (`TakeoffCanvas.jsx:2831`) depends only on `dims`, so nothing
  needs invalidating on recalibration — `rescaleSheet` evicts only `maskCacheRef` (`:2663`).
  Making raster `ws` a function of `pxPerFt` without adding eviction leaves a recalibrated
  scanned sheet holding a mask built at the old scale, and that stale `ws` is what converts
  mask px back to image px — so the SF is silently wrong. **That would be a new instance of
  A1's own failure class, introduced by A1's fix.** Regression test required. (S)
- **1.1h** — *(applies only if the `ws ≤ 1` clamp is ever lifted)* raster `ws > 1` renders above the source scan's DPI for no information gain and 4×
  the memory. Detect and clamp; the limit was named in rev 2 and left unaddressed. (S)

*(Edge case: if `rs < RENDER_SCALE` — a very large page where `auto < 2` — the ratio exceeds 1.
Clamp `ws ≤ 1`; the cap term binds on such pages anyway.)*

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

- **1.1b** — ~~update `bench/run.mts:45-47`~~ **not needed under the corrected formula.** The
  bench pins `baseDim = min(MASK_MAX_DIM, max(imgW,imgH))`, which is exactly what 1.1 computes
  at the default render, so factor 1 continues to reproduce production. *(This task existed
  only because rev 2's formula diverged from the bench; review confirmed that divergence would
  have moved every synthetic reading 1–2 percentage points while Phase 1's exit criterion
  claimed 0.1%. Both problems vanish with the target set to baseline-render px/ft.)* Verify the comment still holds after 1.1 and leave it. **Note this strike concerns the
  `baseDim` rule only** — `run.mts:47`'s `buildMask` call still needs 1.1's new argument. (S)
- **1.1c** — ~~rewrite `resolutionInvariance.test.ts:123-127`~~ **no-op under the corrected
  formula**, which retains the `ws ≤ 1` clamp, so the test still passes. Carried from rev 2,
  where `ws > 1` was allowed. Verify and drop. (S)
- **1.1d** — `TakeoffCanvas.jsx:2831` **duplicates the `ws` formula inline** for the raster
  path; update in lockstep or vector and raster masks silently diverge. (S)
- **1.1e** — add an **upward** factor (e.g. 1.25) to `RES_FACTORS` (`run.mts:35`). The cross
  gate currently tests only downward. Under the corrected formula Phase 1 introduces no upward
  direction, but 0.11 and 5.4 change measured SF and the gate should be two-sided regardless.
  **Not (S): it reds the bench today.** Because ×1.25 lands *above* `DETERMINISM_MIN_MPPF`
  while ×0.75/×0.5 sit below, adding it is what finally makes the VA plan cross-gated — and it
  immediately fails: `patient-room-137` pairIoU **0.844**, `patient-toilet-137a` **0.835**,
  against a 0.90 floor. **Testable today, before 1.1** — rev 4 claimed otherwise in the same
  bullet as the measurement that disproved it. On the synthetic probes ×1.25 is a no-op both
  before *and* after 1.1, because the corrected formula keeps the `ws ≤ 1` clamp — so the
  two-sidedness this promises for 0.11 and 5.4 never reaches the synthetic corpus at all, and
  that limit should be stated rather than assumed away. **5.2 also becomes false the moment
  1.1e lands** — a real plan would then be cross-checked, and failing. Fold into D-6. (M)
- **1.1f** — **add a sub-cap probe to the corpus.** *(Rev 4's justification was wrong:
  `ptPerFt` is irrelevant under the corrected formula, and `sample-plan`'s viewport is
  2448×1584 — already sub-cap at `ws` 1.0000, so it does exercise the clamp.)* The probe is
  still worth adding for A1 coverage specifically — a sheet where Hi-Res ON/OFF is exercised
  end-to-end — but it is not what makes Phase 1 observable. (S)

**The raster carve-out is withdrawn.** Rev 1 claimed `buildRasterMask` is tied to render scale
and cannot be decoupled. It is not: `ensureRasterMask` does an **independent pdf.js render** at
`scale: rs*ws` (`TakeoffCanvas.jsx:2842`), never a resample of the panel bitmap. Set its
viewport scale from the same baseline-render target the vector path uses; the only real limit is
the source scan's DPI. Rev 1's "mark raster takeoffs for re-verification" workaround would have
left A1 live on scans. *(Rev 4 still said "`pxPerFt` and `TARGET_MPPF`" here — a constant
withdrawn 90 lines earlier in the same revision.)*

### 1.1i Make the mask quantization render-independent (M) — **1.1 alone does not fix A1**

Review measured that pinning `mppf` is not sufficient. `buildMask` quantizes with
`Math.round(segs[i]·ws)` (`oneclick.ts:633`), so the same wall lands on a different cell at a
different render scale **even when `ws·pxPerFt` is bit-identical**. On the VA sheet
(`autoRenderScale` 2.070, so Hi-Res is reachable), at identical `mppf` 8.9286 and identical
3000×2143 mask dims:

```
probe                    rs 2.000   rs 2.070      Δ
patient-toilet-137a       39.256     37.701    −3.96%
ward-vestibule            65.812     67.706    +2.88%
patient-room-137-band     20.667     21.743    +5.21%  (snapped)
```

That is A1's exact symptom on a **cap-bound** sheet — the case both the audit and every prior
revision of this plan treated as immune. **Round in baseline-render px, not render px** — and the mask *dimensions* must become
baseline-derived too (`mw = ceil(imgW_base·ws_base)`), or the two renders still land on
different grids. The audit's A1 has been corrected accordingly.

### 1.2 Regression test (S)

Build masks at two render scales, **one non-dyadic** (e.g. `rs = 5.374`); assert identical
`mppf` and measured SF to 0.01 SF. *(Rev 1 withdrew "byte-identical masks" because `Math.round(segs[i]*ws)` is not bitwise
equivalent across `rs`. **1.1i restores bit-identity by construction** — that is precisely its
job — so the reasoning is now inverted; 0.01 SF remains the acceptance because float summation
order can still differ.)*

### 1.3 Provenance (S)

Record `mppf` in `origin` for every trace.

### 1.4 A8 — bound the per-cluster allocation (M) — **promoted from deferral**

`floodRegionSealed` allocates `mo.mask.slice()` per cluster (`oneclick.ts:1114`), defeating the
`sealCache` WeakMap: 1014 ms / 119 MB on a 3000×3000 mask, on the **hover** path
(`TakeoffCanvas.jsx:3130`). Rev 2 listed A8 as "deferred, not scheduled" while Phase 1's own
risk note said "fix A8 first" — incoherent. It is scheduled here.

Requires a committed `bench/perf.mts`; rev 2's hover-timing criterion depended on a harness it
deferred in the same document.

**Exit criteria**
- 1.2 passes and fails if 1.1 is reverted.
- Hi-Res ON and OFF produce identical SF **on a real-plan probe**, to a stated tolerance —
  checked by 1.2 and an e2e assertion. **Not on a clean rectangle**: `sample-plan` snapped reads
  437.978 at `rs` ×1, ×2 and ×2.687 — 0.00% throughout — so a rectangle-only criterion is
  satisfiable by choosing an easy fixture, the failure this plan diagnoses in three earlier
  revisions.
- `npm run bench` shows **no golden moving at all** — under the corrected formula the mask is
  bit-identical at the default render, so any movement is a bug, not a tolerance.
- Hover-path timing on a **sub-cap** sheet (the 1.1f fixture), measured by `bench/perf.mts`,
  improves or holds versus its pre-Phase-1 measurement (1.4).

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

- **2.1b** — `wedgeGrowth` is declared at `confidence.ts:30` and **no caller supplies it** —
  all four call sites omit it (`TakeoffCanvas.jsx:2887`, `:3147`, `:3994`, `bench/run.mts:63`).
  *But rev 2 over-corrected in calling rev 1's "already plumbed" flatly false: the **producer**
  side is fully plumbed — `oneclick.ts:1166` sets `out.wedgeGrowth` with the comment "confidence
  signal", and it is on the public `FloodResult` union at `:42`. The fix is four identical
  `wedgeGrowth: f.wedgeGrowth,` additions plus a read — no signature change, no new data path.
  Costing it as real work was the mirror of the error this plan criticises.* Contrast 2.1d,
  where the plumbing genuinely does not exist and the (M) label is right. (S)
- **2.1c** — **escalation growth is anti-correlated with correctness and must not be used.**
  Measured:

  | probe | growth× | IoU | verdict |
  |---|---|---|---|
  | `tile-grid-room/in-cell` | **451.8×** | 0.992 | correct |
  | `tile-demising-same-pen` | 376.5× | 0.497 | wrong |
  | `partition-bank-15in` | **5.09×** | 0.197 | wrong |
  | `hatched-room/center` | no ratio (strict = `tiny`) | 0.992 | correct |

  *(Growth figures: review's instrumentation.)* Any threshold pushing `tile-demising` below 0.90 pushes `tile-grid-room` below it harder.
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

**Keyed on SF error, not IoU.** Rev 2 keyed both directions on IoU while simultaneously
adopting B7's argument (5.1) that IoU is the wrong measure and SF is what the product sells.
The contradiction is live: `two-doorways/center` reports **4.33% SF error at confidence 1.00**
with IoU 0.957 — it sits in the dead zone between rev 2's ceiling and floor and would clear
the gate forever while failing 5.1 in the same run.

Evaluated over **all probes including known-fails** (explicitly bypassing the `!s.knownFail`
filter at `score.ts:201` — **and the second one at `:188`** in `aggregateCross`
(`!s.knownFail && !s.ungated`), plus the exclusion at `run.mts:65`; bypassing only one leaves
the cross metrics still filtered):

- **Ceiling:** no probe with `|ΔSF|/SF > 0.025` may report `confidence > 0.90`.
- **Floor:** no probe with `|ΔSF|/SF ≤ 0.005` may report `confidence` below a threshold that
  is **calibrated after 2.1b, 2.2 and 2.3 land, not before.** *This is what stops the ceiling
  being satisfied by deflating every score — but a flat 0.90 floor is in direct, measured
  conflict with 2.2.*

  Review measured the min-passage delta per probe: **0.00% on all 12 synthetic and all 4
  `sample-plan` probes**, and non-zero only on six VA probes — `shaded-wing-office` −0.78%,
  `cloud-corridor` −2.12%, `patient-toilet-137a` −2.69%, `patient-room-137` −8.41%,
  `ward-room-294sf` −29.01%, `ward-vestibule` **−78.93%**. Every probe with a non-zero signal
  has IoU ≥ 0.997 — i.e. every one sits inside the floor. A factor honest about −78.9% cannot
  leave `ward-vestibule` above 0.90; one honest about −8.41% cannot leave `patient-room-137`
  (headroom 0.02) above it either. **Phase 2's whole purpose is to add magnitude-scaled
  deductions, so a fixed floor set beforehand guarantees a collision with its own tasks.**
  Set the floor from what 2.1b/2.2/2.3 actually produce, or express it relatively (no probe in
  the accurate population may score below the median of the inaccurate one).
- **Refusal probes:** a refusal probe that returns `ok` fails the ceiling regardless of
  confidence. `run.mts` computes `traceConfidence` only in the golden branch, so all four
  refusal probes report `conf = None` — meaning the one live real-plan failure
  (`open-margin`, which prints `NOT refused` today, and is round 9's 847 SF margin proposal)
  is currently outside the gate entirely.
- **Exemption, with reason:** `annotation-ring-room` is exempt. Instrumentation shows a clean
  verbatim vector trace that stopped at the wrong boundary — `raster` false, `hatchFiltered`
  false, `sealedPx` undefined, `wedges` undefined, `mppf` above floor, **min-passage delta
  0.00%**. No engine-internal signal distinguishes it from a trace that stopped at a wall.
  **This is the RFC-item-A gap, and no amount of confidence tuning closes it.**

  **The exemption must not recreate B3** (`knownFail` as unbounded exclusion with no xpass
  detection). Three requirements, absent from rev 3:
  - **xfail with a direction** — assert `annotation-ring-room` reports conf > 0.90 and **fail
    the run when that stops being true**, so a future signal that does fire is detected rather
    than silently absorbed. 0.3's xpass detection is scoped to `knownFail`, a different flag on
    a different gate, and does not cover this.
  - **A bound** — a test asserting the exemption list has exactly the expected number of
    entries. Otherwise "one `exempt: true`" neutralises any inconvenient probe, which is B3
    verbatim.
  - **An expiry** — the reason must name the signal set it was evaluated against, since
    2.1c/2.2/2.3 are all attempts to change that set.

Rev 1's exit criterion "every known-fail scores below 0.90" is **withdrawn as unreachable**.

### 2.5 Show the score unconditionally (S)

`TakeoffCanvas.jsx:3168` (*not* `:3178` — corrected) appends the percentage only when
`res.cf < 1`, in the **hover readout**. Note `origin.confidence` *is* always persisted
(`:3034`), so the audit's "the estimator sees no flag at all" applies to the live preview, not
to provenance — corrected in the audit too.

### 2.6 Guard the exported API (S)

`traceConfidence({sealedPx: 4, virtualFrac: NaN})` → `score: NaN` (serialising as `null`). Rev
1's repro omitted `sealedPx` and would not have reproduced it — the branch is guarded at
`confidence.ts:46`.

### 2.7 A6 — make the batch and MCP surfaces call the same engine (M) — **promoted from "unscheduled"; this is what actually blocks item F**

`mcp/src/session.ts:246` calls `buildMask` with no `pxPerFt`; `:341` calls raw `floodRegion`, and `:395` calls `detectRegions`
(`detectRooms.ts:76-89`), which reaches `floodRegion` at `:83`. Those are the only two sites;
`detectRegions` has exactly one caller in the repo. Round 9 measured the cost: raw
0.817 vs sealed 0.999 mean IoU on the 8 VA seeds, and **560 SF double-counted (16.6%)** across
56 label seeds, against a 0.5% gate. An MCP `one_click` and a canvas One-Click on the same seed
return different SF under the same `origin.method: "one_click_v1"`.

**Note this also completes Phase 1**: the MCP path passes no `pxPerFt`, so A1's fix does not
reach it until 2.7 lands.

*The audit ranked A6 MEDIUM, at #12 under "Structural". Round 9's 16.6% magnitude re-ranks it
onto the critical path; this plan says so rather than moving it silently.*

### 2.8 Item-F detection metrics (M) — round 9, **and this is what actually gates F**

Rev 2 adopted round 9's `detectRegions` finding and **dropped its other half**: item F's real
hazard is *seeding*, and most of it needs no answer key. Round 9 measured on the VA sheet:
`ROOM_LABEL_RE` (`detectRooms.ts:23`, `/^\d{2,3}[A-Z]?$/` — a bare 2–3 digit token) matched 56
items, **~16 (29%) not rooms** — including the plan's own `557 SF` callouts and title-block
numerals. The margin numeral `33` produced **the largest proposal on the sheet, 847 SF**,
offered to the estimator as a room — the `open-margin` known-fail. Only 3 of the 8 pinned
goldens contain a room-number anchor at all, and near the 189 SF corridor 5 of 25 seeds annex
**1222 SF** instead of 143 SF.

Report label precision, duplicate coverage across proposals, and seed stability (modal-region
agreement over an N-seed jitter). Gate: no proposal may originate from a seed outside the
drawing frame; the 847 SF class must not be proposable. **All three are computable today with
no answer key.**

**Exit criteria**
- 2.4 in CI and green — **with both mutation tests restated relatively, because under branch
  (ii) the absolute form cannot fire.** Review traced it: branch (ii) exempts the three
  known-fails, 2.8 makes `open-margin` refuse, and 0.11 drops `two-doorways`/`curved-partition`
  under 2.5% — so **the ceiling's population empties**, and "reverting any magnitude scaling
  fails the ceiling" becomes untestable. Meanwhile a floor calibrated to admit
  `ward-vestibule` (−78.93% min-passage signal at 0.021% SF error) sits near 0.2, which a
  `() => 0.5` stub clears — so the anti-gaming test cannot fire either.
  **Resolve as D-10**, and specify it properly — rev 5's one-line version was under-defined and
  its anti-gaming argument was **false**. "May not score below the median" is non-strict, so a
  `() => 0.5` stub puts every probe at 0.5, makes the inaccurate median 0.5, and **passes**. It
  does not collapse the separation into a failure; it collapses it into a pass. Required:
  - **Both populations defined explicitly**, including how exempt probes and the dead zone
    between `≤0.005` and `>0.025` are treated.
  - **A strict margin**: `min(accurate population) ≥ median(inaccurate population) + δ`, with δ
    named. Without δ the stub passes.
  - **An explicit empty-population rule.** Post-0.11 every non-exempt probe sits at 0.00% except
    `curved-partition` (0.65%), so under branch (ii) the inaccurate population is **empty and
    the median undefined** — Phase 2 unexitable again, one level up. If exempt probes are
    instead counted, the median is 0.95 and the floor immediately fails `cased-opening` (0.94),
    `door-swing-3ft`, `two-door-room`, `patient-room-137`, `patient-toilet-137a` (all 0.92),
    which 2.2's −8.41% deduction makes strictly worse. The rule must say what it *does*, not
    merely report.
- 2.7: MCP and canvas return SF within 0.1% on all 8 VA probe seeds; double-counted floor
  across the 56 label seeds drops from 16.6% to ≤0.5%.
- 2.8: label precision, duplicate coverage and seed stability reported; no proposal from
  outside the drawing frame.
- **Phase 2 exits on one of two branches** — rev 2 admitted only the first, which reproduced
  rev 1's self-block, because 2.1c is research the plan explicitly permits to fail:
  - **(i)** 2.1c finds a signal satisfying both directions of 2.4 on the full population 2.4 names — 24 golden rows (21 gating + 3 of the 4 known-fails are golden) plus the 4 refusal rows its third bullet brings into scope, **not** the 21 gating probes; **or**
  - **(ii)** 2.1c reports that none exists, the flat deduction stays, and
    `partition-bank-15in` and `tile-demising-same-pen` join `annotation-ring-room` in the
    written exemption list — with their exemption reasons recorded the same way.
  *(Rev 4 "corrected" the floor's binding population to 14 by counting `hatched-room/center`
  and `tile-grid-room/in-cell` — but those sit at **0.832% SF error**, outside the ≤0.5% floor.
  Rev 4 reverted to IoU keying to correct a statement that was right on SF keying. The
  population is **12**, as rev 2/3 had it. "Gated" was the only wrong word: all 9 VA probes
  print `NO GATED PAIR`. The algebra below is unaffected. Post-0.11 the floor
  population goes **12 → 20**, not "five further probes": the five at 2.03%, plus
  `hatched-room` and `tile-grid-room` at 0.832%, plus `two-doorways` at 4.33% — all become
  0.00%. Only `curved-partition` (0.65%) stays out. **Phase 0 therefore tightens a Phase 2 gate
  already in CI**, and 0.9 covers goldens, not confidence, so this hazard needs its own note.
  State the mechanism in **SF**, not IoU — rev 4 explained entry by "their IoU goes to ~1.000"
  two sentences after insisting the gate is SF-keyed, the same slip it was correcting.)*

  The algebra makes (ii) the likely branch, and rev 2 did not state it: the ceiling needs
  `hatch_factor ≤ 0.90` on the two known-fails, while the floor needs
  `hatch_factor × 0.97 ≥ 0.90` → `≥ 0.928` on `patient-room-137` (today conf 0.92). **Those
  are jointly unsatisfiable unless 2.1c separates hatch-on-a-wrong-trace from
  hatch-on-a-correct-trace** — and its own table (451.8× correct vs 5.09× wrong) is the
  evidence that the one measured candidate is anti-correlated. Headroom is 0.02, and 2.1b and
  2.2 both land on those same probes.
- **Item F unblocks on 2.7 + 2.8, under either branch.** Not on confidence — rev 1 got that
  wrong for the wrong reason and rev 2 got it wrong for a subtler one.

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

### 3.2 Arc semantics (L) — A5 — **blocked on D-5**

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
   radius, opposite sign, shared meeting point — measured by review at **16/16 chords marked**: identical
   signature, on the hospital plan that *is* the corpus. Require **similar radius AND small
   radius AND ≥3 consecutive reversals**, and add a double-door fixture as a must-not-regress
   case.
4. **Hinge attachment — described backwards in rev 1.** A swing arc does *not* terminate at the
   hinge; its endpoints are the leaf tip and strike point. **The hinge is the fitted circle's
   centre.** The discriminative fact is "the fit centre coincides with a wall corner or leaf
   endpoint", which cleanly separates a column (centre in open space) from a swing. Also note
   hard/soft classification has not run at `markPolylineArcs` time, so "terminates at hard
   linework" is not yet knowable. **Deferred — not scoped** (see deferral list).

**Mechanism — decided, because rev 3 assumed two contradictory ones.** Rev 3's side-effect note
described rejection as *un-marking* `SEG_CURVE`, while 3.3 assumed rejected arcs still form
clusters that need ranking. Both cannot hold: `boundaryCurveClusters` (`oneclick.ts:954, :990`)
builds clusters **only** from `MASK_CURVE_BIT` cells, so un-marking means no cluster, which
would make 3.3 dead code.

**Decision: keep the `SEG_CURVE` mark, carry door-likelihood separately.** Then the
hatch-eligibility side effect never arises — but note that also removes the justification for
rev 3's "rejected column stays a hard barrier" fixture, which is dropped.

*(If instead un-marking is chosen, `classifyHatchSegs` skips `SEG_CURVE` outright at
`oneclick.ts:477` with a load-bearing comment at `:458-459`, and a large tessellated circle has
many near-parallel chord pairs — so the fixture becomes necessary again. Pick one and state the
consequence for the other task; rev 3 asserted both.)*

### 3.3 Wedge budget starvation (S) — A5 — **blocked on D-7**

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
  all `RES_FACTORS`. **Blocked on 0.11, but not for rev 4's reason.** Rev 4 claimed a 120 SF
  rectangle burns 82% of the 2.5% budget on rasterisation alone; in production it burns **0%**
  (the bench's 117.6/116.8/115.2 is un-snapped — A5b). The real blocker is that until the bench
  measures what the product returns, **no fixture tolerance in this phase means anything.**
  Re-derive these tolerances from post-0.11 numbers.
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
contour only, so any plan deducting >2% of floor fails the ±2% gate for a non-engine reason.
Rev 2's whole remedy was "state the wall-line semantics", which is not a remedy. **Do one of:**
subtract deduct polygons from the engine ring as well as the golden (island subtraction in
`caseCoverage`), or exclude deduct-bearing cases from `humanCoverageBand`. Also state the
answer key's wall-line semantics (centreline vs face) — it interacts directly with 0.11 and 0.12.

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

**Exit criteria**
- ≥1 case with `humanMeasured: true` produced from a payload with zero machine-origin shapes,
  and `npm run bench` evaluating all three human gates on it — proved by a deliberate 3%
  perturbation exiting non-zero, committed as a test.
- `from-takeoff.mts` exits non-zero on a payload whose shapes carry no `origin`.
- `git check-ignore bench/corpus/sealed/` succeeds.
- A fixture whose deducts are 5% of floor passes the ±2% coverage gate (4.5).

---

## Phase 5 — determinism, honestly

### 4.8 Make the human gates negative-testable (S) — C6

Export `THRESHOLDS` (`run.mts:25`, currently a non-exported local no test imports) and add a
test that a human case at 3% room error exits 1. Pairs with 6.17.

### 5.1 SF-error cross gate (M — **not S**) — B7

IoU ≥0.90 admits −10.0%/+11.1% area, 4× looser than the repo's own 2.5% SF gate. Gate
`|ΔSF|/SF ≤ 0.025` directly.

**Rev 1 said this "costs nothing". It turns the bench red today** — measured on the synthetic
corpus: `two-doorways/center` **4.33%**, `curved-partition/left-half` **3.20%**, both
non-known-fail. *(Rev 2 published 4.43% and 2.81%; both were wrong, and a single
`npm run bench` refutes them — see the attribution convention.)* **But both are harness
artifacts** — 0.00% and −0.65% in production (A5b). Carry the decision as **D-6: land 0.11,
re-measure, then decide.**

### 5.1b Remove the hardcoded `statusAgree: true` (S) — B7, second half

`run.mts:78` hardcodes `statusAgree: true` for ungated rows, so a genuine verdict flip on a VA
probe would render as unremarkable. Rev 2 covered only B7's threshold half; the label
`NOT cross-checked` it required as an exit criterion is already printed today. Ungated rows
must report `statusAgree: undefined` and be counted separately.

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
- ~~Every probe prints either a pair count ≥2 or `NOT cross-checked`~~ — **already true at
  `21e57a0`**; the bench prints `[NO GATED PAIR — not cross-checked]` on all 9 VA rows today, so
  this was not a criterion for new work. Replaced by: `run.mts:78`'s hardcoded `statusAgree:
  true` is gone (5.1b), and the summary states the real-plan count on the same line as the
  floor.
- D-2 closed in writing here, with the cost stated.

---

## Phase 6 — the working record

> **✅ APPLIED 2026-07-28.** The issue-record items landed: the body was rewritten with
> inline `[corrected]` annotations (6.0, 6.1, 6.2, 6.4, 6.5, 6.11, 6.16, 6.18, plus the
> engine-pinned caveat and the A1/A5b defects), and a consolidated corrections comment
> ([`5102667000`](https://github.com/knmurphy/opentakeoff/issues/184#issuecomment-5102667000))
> records the retractions belonging to specific earlier comments (6.3, 6.6, 6.8, 6.9, 6.10,
> 6.15, 6.17). **The historical comments were deliberately left unedited** — the original
> claims should stay visible next to their retractions.
>
> **Not applied, and why:** 6.14 (slice doc) and 6.19 (`IMPROVE_WITH_USE.md`) target files that
> exist only on the feature branches, not on the audit branch, and pushing there is outside
> this branch's authorisation. 6.7 (rename `ward-room-294sf`), 6.12 (the missing O(N²)
> regression test) and 6.13 (e2e header comments) are code/corpus changes that belong with the
> engineering phases — 6.7 in particular moves a corpus key and must go through 0.9.
>
> One self-inflicted note: the first two body writes reproduced the exact malformed-link defect
> 6.5 exists to fix (GitHub mangled `[`code`](url)` constructs into double-backticked text).
> Caught by re-reading the stored body via the API rather than trusting the write. Verified
> clean on the third write — `body.count("](``") == 0`.

**Moved earlier in priority than rev 1 had it** — not for disclosure, but because the issue is
the project's working state and the next session reads it. 6.0 first.

| # | Task | Where | Finding |
|---|---|---|---|
| 6.0 | **Un-block item F.** Change "(next session starts at item 1)" and annotate item F: blocked on A6 (2.7), with round 9's 16.6% double-counted-floor measurement. Rev 1's stated reason (confidence) was wrong; the reason is the raw-engine divergence. | body §Remaining work | A6, round 9 |
| 6.1 | Correct "3 probes cover the full floor". Round 8 identified 79.4 SF outside any probe (240.8 − 161.4); the remediation pinned 19.04 (band) + 39.24 (toilet) = 58.28. **21.1 SF is still in no probe.** *(Show the unrounded addends — rev 2 wrote "19.0 + 39.2 = 58.3", whose addends sum to 58.2, in the row whose job is fixing arithmetic.)* This also reconciles "~78 SF" with "20.8 SF completes the coverage" — they were never consistent. | body, comment `5099217709` | D1 |
| 6.2 | Band is **19.0 SF**, not 20.8. | body, comment; `2ea5487` msg is immutable — record here | D2 |
| 6.3 | **Retract** round 4's "toilet correctly excluded / 249.3 SF". | comment `5095757169` | D3 |
| 6.4 | Body: set the count to **843 at `21e57a0`** and date it ("as of `<sha>`") rather than writing 835, which would replace a stale wrong number with a fresh one. Annotate 837→835 in the round-8 review comment. Commit messages are immutable — record, don't rewrite. | body, comment | D4 |
| 6.5 | Repoint the evidence index and slice-doc links at the branch holding rounds 7–8 evidence; fix the two malformed image links. | body, comments | D5 |
| 6.6 | Retract/annotate — **but NOT the sample-plan total**: round 1's 1,751.9 SF is *correct*, being 4 × 437.978, the production (snapped) reading, against the un-snapped bench's 1,744.7. It is A5b visible in the project's own history since round 1 and mistaken for sloppiness ever since; cite it as corroboration rather than retracting it. Retracting a right statement is the sin rev 5 charged rev 4 with. Retract/annotate: corridor 1,718 SF (never pinned; also in the evidence *filename*), 0.04→0.02 SF overlap, the vestibule "recovery" that overshoots its baseline by 30.8%, round 3's "~3–4%" (actually 4.4%, both superseded by 136.8); and `partition-bank-15in` IoU, which the round-8 review records as 0.199 while the bench and round 9 both read 0.197. | rounds 1,2,3; body; filename | D9 |
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

| # | Task | Finding |
|---|---|---|
| 6.19 | **`docs/design/IMPROVE_WITH_USE.md` — round 9's two corrections, which rev 2 dropped.** §3's storage figures are backwards: the doc says "≈ 2.3 MB base64 vs 3.8 MB decimal… **Optionally** gzip at rest… spec'd, not required" (verified at `:481-485`), while round 9 measured **3.53 MB decimal / 2.92 MB base64 / 0.48 MB gzip** — the doc's own numbers are wrong and its "optional" is the 86% win. Make gzip the recommendation. §4: annotate that a per-project pitch cap **is** a measured knob (IoU 0.197 → 0.937 in a 1.0–1.1 ft window, cliffs either side), so the never-auto-apply guard rails are load-bearing. §5: annotate the build order with round 9's. | round 9 |

This file matters for the same reason the issue does: §5 is a "Recommended build order" the next
session reads. A measured-backwards storage decision left in it is re-inherited exactly like a
wrong figure in the issue — and unlike the issue, it is a file this plan can edit directly.

*(**4.8** — export `THRESHOLDS` (`run.mts:25`) and add a test that a human case at 3% room
error exits 1 — is a **Phase 4** task and lives there, not here. Rev 3 left it orphaned at the
bottom of the Phase 6 table, Phase-4-numbered, with no exit criterion in either phase, while
6.17 pointed at it.)*

**Exit criteria**
- For each retired number (`249.3`, `20.8`, `1,718`, `837`, `847`, `0.04 SF`, `294`,
  `133.7` — **not** `1,751.9`, which 6.6 establishes is correct): zero hits, or a hit adjacent to an explicit retraction. Runnable —
  `gh api repos/knmurphy/opentakeoff/issues/184/comments --paginate | jq -r '.[].body'`
  plus the body, piped to grep. *(Rev 2 wrote "a grep of…" with no command, violating 0.8's
  own rule.)*
- The body no longer directs the next session to start at item F.

---

## Deferred — accepted risk, not scheduled

Rev 1's deferral section named two items and implied everything else was scheduled. The honest
list:

| ID | Deferred | Risk if not done |
|---|---|---|
| A7 | Escalation floor 0.02; only bound is a 2.5× cap that passes a clean 2.0× two-room merge at conf 0.95. `softFrac` counts duplicate encounters, so the verdict is resolution-sensitive. | Silent two-room merges |
| ~~A8~~ | **Withdrawn — promoted to task 1.4.** Rev 2 listed it "not scheduled" while Phase 1's risk note said "fix A8 first", and gated Phase 1 on a hover-timing criterion needing a harness the same table deferred. | — |
| C4 | Anchoring bias is mitigated by protocol (4.6) but not detectable by tooling. | A human key that agrees with the engine for the wrong reason |
| 3.2(4) | Hinge attachment — the highest-value discriminator and the only one that generalizes off scaled sheets. | Arc discrimination stays weaker than it could be |
| 4.2(a) | Independent case-level truth. Needs export schema + UI + protocol + `caseCoverage` signature. | ±2% remains an aggregate band, not structural coverage |
| D16 | `confidence.test.ts:11-13` asserts the implementation's own constants back at itself (`CONF_RASTER` could become 0.05 and it passes). | Confidence constants untested |
| D16 | `roomName.ts:79` returns a bare number line as a room name — keynote "213" becomes a label. | Mislabelled takeoffs |
| — | The `fflate` dynamic-import build failure, seen once, unreproduced. | Unknown; may surface in CI once 0.1 lands |
| — | Perf harness for D8's *historical* numbers (23 s → 0.39 s, ~285 ms). `bench/perf.mts` is scheduled under 1.4 for the hover path only; it does not re-measure D8's claims. | D8's figures stay unrepeatable; 6.9 marks them as such |
| A2 / 2.1c | **2.1c's failure branch is itself a deferral** — "if none exists, say so and leave the flat deduction" means the plan's #2 priority may end up unfixed. Rev 3 stated the branch but did not list it here, which is the most consequential omission the table could have. | The two hatch known-fails keep reporting 0.95 while measuring +384% and +97% |
| — | The raster path's **source-DPI limit**. *(Rev 4 cited 1.1h as the mitigation, but 1.1h only applies if the `ws ≤ 1` clamp is lifted, which the corrected formula does not do — so the mitigation does not exist.)* Nothing tells the user a scan is too coarse to measure at the requested precision. | Silent over-confidence on low-DPI scans |
| C6 | Run-once enforcement for sealed cases — no counter, ledger or marker. 4.3 documents it as discipline rather than building it. | The one sealed holdout gets rerun and overfit, making the accuracy number it produces worthless |
| A2 | **The annotation-ring class ships at conf 1.00.** 2.4 exempts it because review proved no engine-internal signal exists (min-passage delta 0.00%). Correct engineering, but it is an accepted risk, not merely an exit-criterion adjustment — rev 2 booked it as the latter. | An estimator sees a verbatim-confidence trace that is 35% short. Consider recording the exemption class in `origin` even where the score cannot move |
| — | **Four escape-hatch tasks permit the null action**: 3.4 ("fix *or* correct the comment"), 5.5 ("fix *or* retract"), 6.12 ("add the test *or state it is unguarded*"), 6.14 ("write the check *or drop it*"). | Taking the null branch each time leaves: px thresholds still mislabelled dimensionless, bit-identity still overclaimed, **the O(N²) lattice fix still unguarded** (D7: a revert passes 843/843 + bench), and the slice check still unwritten |

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
- **D-6.** 5.1's SF-error cross gate reds two synthetic probes *in the bench* —
  `two-doorways/center` 4.33%, `curved-partition/left-half` 3.20%. **Both are harness
  artifacts**: in production they are **0.00%** and **−0.65%** (A5b). Rev 3 posed a trilemma
  ("fix the probes, raise the threshold, or known-fail") and rev 4 answered "land the bias fix
  first" — both were reasoning about a bias the product does not have. **The decision is:
  land 0.11, re-measure every cross-resolution number, then decide** — and fold in 1.1e's
  measured failures (`patient-room-137` pairIoU 0.844, `patient-toilet-137a` 0.835) at the same
  time, since those are on the VA plan and will move under 0.11's re-pin.
- **D-7 (new).** 3.3's door-likelihood channel: `MASK_DOORLIKE_BIT` (bit 8 free), per-cluster
  circle re-fit, or an intrinsic cluster property? Recommend bit 8. **3.2 and 3.3 cannot start
  until D-5 and D-7 are answered** — marked in the tasks themselves.

- **D-8 / D-9 (merged, and now task 0.12).** Wall-line semantics — centreline or face — and
  whether vertex snapping is correct as a measurement policy. **They are one question**:
  snapping pulls corners onto PDF path vertices, which are centrelines, so 0.11 decides the
  semantics by acting. Promoted to Phase 0 as 0.12, blocking 0.11. *(Rev 4 promoted D-8 in prose
  with no owning task; rev 5 demoted it on the grounds the outset withdrawal removed the
  dependency — the dependency had moved, not vanished.)*
- **D-10 (new).** 2.4's floor: absolute threshold or relative separation? The absolute form
  makes Phase 2 unexitable under branch (ii) (see Phase 2 exit criteria). Recommend relative.

