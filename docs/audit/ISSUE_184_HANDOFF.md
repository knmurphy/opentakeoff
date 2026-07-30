# Issue #184 — subagent-driven handoff

**Written 2026-07-28** for whoever (human or session) picks this up. Everything below is
dispatch-ready: state snapshot, non-negotiable working rules earned the hard way, then one
brief per subagent with file ownership, evidence requirements and exit criteria. The briefs
are written to be pasted to an agent nearly verbatim.

---

## 1. State snapshot

| artifact | where | state |
|---|---|---|
| Audit + remediation plan | `docs/audit/` — **merged to `main` via PR #191** (`2d89826`) | ⚠️ The plan's status table is now **known-wrong** in `main`: it claims all seven engine defects fixed; post-merge review falsified parts of that (see §3). |
| Engine fixes (all of them) | branch `claude/issue-184-hatch-periodicity-fduafy` @ `94a5d46` | **Unmerged, no PR.** 934 web tests, MCP 36/36, bench green. Three of four PR-style reviewers returned REQUEST CHANGES (findings in §3). |
| Corpus | re-pinned at `67df53b` through the 0.9 protocol | Verified honest by an independent reviewer: 100% of the +2.74% is the change of measurand (un-snapped traces at HEAD match old goldens to ≤0.068 px); 0% engine drift. |
| Issue #184 body | github.com/knmurphy/opentakeoff/issues/184 | ⚠️ **Overwritten at 17:35Z** by an unknown editor. My 09:59Z Phase 6 corrections were verified present, then lost — the body now again asserts the disproven "can never admit the closet behind it" claim, and correction comment `5102667000` points readers at body content that no longer exists. |
| CI | `.github/workflows/ci.yml` on the engine branch | `web` job runs typecheck/lint/test/**bench**/build; separate `web-e2e` job with pinned Playwright. On `main`, CI is the old set until the engine branch merges. |
| Review transcripts | four reviews complete | Correctness, re-pin and claims-vs-delivery: REQUEST CHANGES (findings in §3). Test quality: **APPROVE WITH COMMENTS — 34 of 35 revert checks independently reproduced**; the 35th (MCP strip-mode conformance) is now fixed and guarded (`71c53aa`, proven both directions). Residual weaknesses W1–W6 folded into §3/§4. |
| Evidence pack | **committed at `23e87f7`** on the engine branch: `docs/evidence/ONE_CLICK_BEFORE_AFTER.md` + `probes/*.mts` | Measured before/after for every defect, reproduction commands included. **Its headline finding upgrades F3 — read §3 before trusting any prior "A1 fixed" claim.** |

Key commits on the engine branch, in order: `5e92a11` Phase-0 gates · `1a02b15` A1 vector ·
`341def8` re-pin protocol · `57c9cc7` A6 · `39f8f47` A1 raster · `ec945dc` e2e CI ·
`974cf43` A4+A5 · `086843b` A2+A3 · `f81e41f` A6 re-close · `67df53b` A5b re-pin ·
`7305caf` A8 · `94a5d46` merge.

---

## 2. Working rules — non-negotiable, each one paid for

1. **A test is not a guard until the revert has been tried.** This project shipped a
   passing-against-reverted-code guard FIVE times, twice inside this remediation itself
   (the 400×100 perf fixture; the A1 `a1Scene` fixture that feeds unrounded reals where
   production passes `Math.ceil`'d dims). Every fix brief below requires the revert
   recorded in the report, and the integrator re-runs at least one revert per agent.
2. **Line numbers in briefs go stale.** Three agents in a row found the brief's line
   numbers wrong. Cite them as "~" and instruct: verify against source before trusting.
3. **No golden moves without the 0.9 protocol.** `bench/pin-goldens.mts` refuses >±2.5%
   moves without `--adjudicate <probe>="<reason>"`; reasons persist in the corpus JSON.
   The historical failure it guards against: `2730050→92c1242` moved a probe −32.75%
   while the case total moved +0.5% (a new probe landed in the same commit; the one
   in-band probe was 68% of the total). Whole-case checks are structurally blind.
4. **Disjoint file ownership per concurrent agent.** `oneclick.ts` is the contention
   hotspot — agents that touch it run sequentially, never in parallel.
5. **Verify agent claims by execution before reporting them upward.** Reviewer figures
   have been wrong (4.43% vs 4.33%); my own briefs have been wrong (double-door turn
   signs, "fix the cache keying", the raster-scale instruction). The integrator runs the
   full matrix — `npm test`, `npm run bench` (goldens byte-identical unless adjudicated),
   `npx tsc --noEmit`, `npm run lint`, `npm run build`, `cd mcp && npm test` — on the
   *integrated* tree, and commits that verification statement in the merge commit
   (the `94a5d46` merge has an empty message; don't repeat that).
6. **Calibration decays with distance from source.** The reviewed pattern: code comments
   honest, commit messages mostly honest, plan status table loose, issue record wrong.
   When updating any layer, update the layers above it in the same change.

---

## 3. The defect queue

> **Update 2026-07-30: the independent POST-FIX evidence re-measure is in** — merged at
> `62b4688` (`docs/evidence/ONE_CLICK_BEFORE_AFTER.md` Part 2, probes `a1c/a5c/f1/f8.mts`,
> perturbation harness `gates.py`). Confirmations, measured not narrated: the F1 cliff is
> gone (spread 0.35 SF across the pixel that used to jump 64.35→126.48; 8/8 slot widths
> carry `min_pass_px`/`min_pass_delta`); A1 on the sub-cap sheet is exact (0 differing
> cells, 0.00% on all rooms, four render scales); the new A2 gates catch 3/3 injected
> perturbations that `94a5d46`'s bench passed. It also found **six contradictions of this
> wave's claims (#3–#8 in the pack)**, three of which are new queue items:
>
> **F9 — provenance self-contradiction (introduced at `7650f68`, F7(g)).** The wedge
> reclassification corrected the hover badge and the MCP receipt but `floodSignals` never
> receives `ringWedges`: one shape's provenance now carries `ring_interiors: 1` **and** a
> `door-swing-crossed(…)` confidence factor — the user-visible receipt contradicts itself.
> Fix site: forward `ringWedges` into `confidence.ts` and split the factor.
>
> **F10 — a signal was lost (introduced at `7650f68`).** The free-standing column that
> annexes 7.13 SF of its own interior as floor scored **0.97 BEFORE and 1.00 POST-FIX**:
> the proportional wedge deduction rounds a 1.5% effect to 1.00. Tied to the pending
> column-policy decision below — but whatever the policy, confidence must not *rise* on
> the annexing case.
>
> **F11 — the F3 pin is opt-in and the MCP/batch surfaces cannot take it.** `buildMask`'s
> `page` arg defaults to null (old reconstruction runs unchanged); `TakeoffCanvas.ensureMask`
> passes it, but `detectRooms.ts` has no `page` parameter, so `mcp/src/session.ts` cannot.
> Canvas and MCP now pin *differently* off the same RENDER_SCALE — an **unmeasured risk to
> A6's "one engine" result**, and `a6.mts` structurally cannot see it (single-scale probe).
> Needs a probe that renders both surfaces at different scales, then the plumbing.
>
> Corrections to THIS document's claims (rule 6): the update below says "vector and raster
> grids byte-identical" — on the VA plan that is **false for mask contents** (65–4,346 of
> 6,429,000 cells differ across scales, ≤0.09% cell / 0.03% ring on any probe; what is
> byte-identical is the *grid*: dims 3000×2143, mppf, mask-px-per-point, at every scale).
> F8's emphasis: the 9.27% top of the band is ~99% device-line-width nibble at an
> unreachable render scale (5.374); at the only reachable Hi-Res step the arc-marking
> share is ~100% and production exposure is ~2% — F8 is real but its headline belongs at
> ~2–4%, not 9.3%. And the A1 cap-bound "gain" stated honestly: probes exactly invariant
> went 1→4 of 8, but the **worst** probe (`ward-vestibule`, +2.03% ring) is byte-identical
> before/after at the only reachable toggle step — the fix did not reach the worst case.
>
> **Update 2026-07-29 (second): F3 and F7(b,d,g) are FIXED at `7650f68`** (fast-forward,
> so the integration verification lives here: 968/968 tests, bench byte-identical to the
> pre-E baseline — no golden moved — tsc/lint/build clean, MCP 36/36, integrator revert
> re-run confirmed). The A1 mask pin is now essentially exact on sub-cap AND cap-bound
> sheets, vector and raster grids byte-identical, via a shared page-points source of truth.
>
> **F8 — NEW ENGINE DEFECT, the wave's most important finding.** The VA plan's −7.03%
> Hi-Res drift was never mostly a mask artefact: with the mask pinned and meta held at
> baseline, worst probe drift is 0.000–0.24%; with production meta it is 3.96–9.27%.
> Every differing meta byte at rs 2.07 is `markPolylineArcs`' arc marking (absolute
> image-px thresholds; ceil'd width nibbles at high rs). **`extractVectorGeometry` is
> render-dependent by up to 9.3% on the VA plan, independent of A1.** Fixing it changes
> arc marking → wedges → goldens, so it needs its own reviewed change through 0.9.
> Also filed: MCP's unrounded `viewport.width` vs the canvas's `ceil` (declined as
> unverifiable — both corpus PDFs have integral point sizes; needs a non-integral
> fixture first). And a guard honesty note: `.strict()` schemas would NOT have caught
> the F7(d) omission (the conformance fixture never exercises min-passage); the real
> guard is the web-side key-scan in `engineParity.test.ts`.
>
> **OPERATOR DECISION PENDING:** round column interiors currently count as floor
> (corpus-pinned). The false "incl. door swing" messaging is fixed ("incl. ring
> interior", `ring_interiors` in provenance — fires on real probes patient-toilet-137a
> and ward-room). Whether a structural column should be a DEDUCT instead is a
> measurement-policy call; the change site, the goldens it would move, and the test
> that would need rewriting are all named in `7650f68`.
>
> **Update 2026-07-29 (first): F1, F2, F4, F5, F6 are FIXED and integrated at `b277662`** —
> 960/960 tests, bench green with the new gates live, goldens byte-identical, one revert
> per agent re-run by the integrator. F3 + F7(b,d,g) are with agent E (in flight).
> Corrections the fix wave made to THIS document's claims: F1's root cause was NOT
> `dt > 3` (both suggested repairs made things worse — the gates were simply applied
> where they answer no question; they are now scoped to the creating path and the bare
> fall-through is structurally unreachable); F2 did NOT reproduce on either real sheet
> in 47,732 clicks (the ~0.2% figure came from randomized synthetic scenes; residual
> pinned as known-limit F2b); the wall-semantics tautology's source was the two corpus
> WRITERS (`from-takeoff.mts`, `pin-goldens.mts`), not `corpus.ts`; and 5.88 in
> re-measures as 5.86 in.
>
> **New queue items from the wave:** (i) `diffRepin` lets a REFUSAL probe be deleted
> unadjudicated and silently (`verdict:"refusal", flagged:false` — the removal manoeuvre
> against a known-limit probe; semantics change, needs a decision); (ii) the absolute-SF
> trigger belongs INSIDE `pin-goldens.mts` — `run.mts`'s new 1.0 SF gate catches
> hand-edited goldens but is structurally blind to a re-pin where the engine agrees with
> the moved golden; (iii) W1–W3 on the perf guard remain open; (iv) F2b: the creating-path
> refusal moves with the working raster (identified fix: count a cell synthetic when its
> barrier neighbour is dilated rather than drawn — needs its own review).

### Original queue (historical record — see the update above)

**F1 — BLOCKING, a regression the remediation itself introduced.** A3's new gate on the
min-passage path falls through on refusal and returns the **raw untrimmed flood** with no
provenance and **confidence 1.00**. Reproduced: min-pass flood ok at 34,000 cells,
vf 0.57 → refused → raw flood 64,207 cells returned. `21e57a0` answered 64.0 SF; HEAD
answers **120.8 SF (+88.8%)**, silently. Root cause: `virtualBoundaryFrac` hard-codes
`dt > 3`, sound for the seal ladder (growback returns boundary to linework) but wrong at
min-pass radius (5–8 cells on real sheets) — the gate is systematically biased against
the primary path.

**F2 — BLOCKING, same gate.** Flips previously-returned rooms `ok → leak` (~0.2% of 1044
probes). A user's existing measurement becomes "that space isn't enclosed".

**F3 — A1 is NOT fixed on cap-bound sheets — a no-op, not a residual.** The evidence
pack proved (and it was independently re-confirmed against `buildMask` before committing)
that for a cap-bound sheet the new formula collapses algebraically to the old one
(`ws = k·wsB = maxDim/imgW`): **zero differing mask cells fix-vs-nofix at both render
scales**, and the VA plan's entire A1 probe block is byte-identical BEFORE/AFTER, still
drifting up to **−7.03%** across the Hi-Res toggle (drift is scale-rounding-sensitive:
−0.83% at the true `autoRenderScale` 2.0704 vs −7.03% at 2.070). The `1a02b15` commit
claimed cap-bound coverage; its verification scene was sub-cap — the guard never tested
the case it claimed (rule 1, again). Separately, the sub-cap residual: `ensureMask`
passes `Math.ceil`'d viewport dims, so vector vs raster masks of one sheet land on
different grids (1225×1585 vs 1224×1584) and one click yields three SFs across render
scales at the ~0.02% level. The fix direction for both: derive the baseline from **page
points** (as `rasterMaskScale` already does, with the reason documented) — and the
`a1Scene` guard must feed `ceil`'d dims and a cap-bound variant.

**F4 — re-pin protocol drops a removed probe's adjudication.** `pin-goldens.mts` write
path: a `removed` row has no new probe to attach to → reason silently discarded. This is
the exact case the protocol calls most dangerous. Write path is untested.

**F5 — `wallSemantics: "centerline"` is false on the VA plan** (60% of corpus SF). VA
walls are double-line ~5–6 in apart; snap lands on *faces*. Measured: toilet↔room gap
5.88 in where centreline neighbours measure 0.00. The gate compares the constant to
itself, and `from-takeoff.mts` auto-stamps it onto human answer keys — the one place the
field could carry information.

**F6 — the bench now detects less.** Snapping made cross-resolution IoU exactly 1.000 on
8 of 9 synthetic probes; the raw fidelity metric (0.969/0.860, raw cross 0.962) is
reported but **ungated**, and `THRESHOLDS` never moved (floor 0.990 actual vs 0.90 gate).
A rasterisation regression to 0.60 raw ships green today.

**F7 — record corrections.** (a) Plan status table in `main`: A2 must read "partly
fixed" — the confidence gate is red without its two new exemptions; `annotation-ring-room`
still 1.00 at 33% short; `cf < 1` readout rule untouched; exempt pair is
`tile-grid-room` + `two-doorways`, not `partition-bank`. (b) `oneClickRing`'s comment
claims every surface calls it; **zero production call sites** — bench-only with a
source-scan guard. (c) ~~MCP strip-mode conformance~~ **FIXED at `71c53aa`** — `.strict()` on all SCHEMAS
entries + nested `detectedRoom`, proven to fail on an injected undeclared key.
(d) MCP `receipts()` lacks `min_pass_px`/`min_pass_delta` — A6's class again. (e) Issue
#184 body (see §1 — **coordinate with the repo owner before rewriting; it was
overwritten once already and the editor is unknown**). (f) Test-review residuals W1–W6, owned by agents D/E: the perf guard's churn counter
misses `.slice()` allocations (stub `Uint8Array.prototype.slice` or measure `external`);
its raster-unit ruler recomputes a full `hardDT` per call while the warm hover no longer
does (pass the cached `dt`, or denominate in a cold `floodRegion`) — and `dilateHardMask`
is now production-dead code kept alive by two tests; the "8 raster units" budget is
fixture-specific (8 doors = 12.0 units, 1500px mask = 35.8 — budget per pinned scene and
narrow the prose); `score.ts`'s populated-case absolute floor has no test (fixture:
inaccurate median 0.60, accurate probe 0.70 — must fail the absolute floor); the gate's
floor has 0.01 headroom and its relative term is currently inert; `xfailAtMost` on
`two-doorways` tolerates collapse — pair it with an `xfailAtLeast` (~0.80). Also from the
evidence pack: A5's **bezier-ellipse** negative control fails on both states (32/32
chords marked, allowance 19.7→19.9 SF) and the duct elbow is unflagged on both; A3's
virtual-boundary guard never fires on a dashed-line-as-wall scene (vf 0.000 — a dashed
property line still measures as a 484 SF room, caught only by a confidence deduction);
A6's fix surfaced two uncontrolled canvas-side changes on the VA sheet (seeds 159:
0.58→4.71 SF and 557: 638.01→624.23 SF — neither in the corpus, so neither gated).
(g) Smaller: round column still
gets a full door wedge (`wedgeAllowance` admits clean circle fits — a column is a deduct,
not floor, for flooring); adjudication texts F1/F2 from the re-pin review (spread cause,
band arithmetic); A8's two disagreeing measurement sets; `bench/corpus.ts` comment says
438.58 where the pin is 437.978.

---

## 4. Dispatch plan

Run **A alone first** (it owns `oneclick.ts`), then **B–D in parallel** (disjoint), then
**E** after A lands (it also touches `oneclick.ts`), then **F/G** anytime, then
**integrate**. Every agent: own worktree branched from
`origin/claude/issue-184-hatch-periodicity-fduafy`, symlinked `node_modules`, commit on a
`wip/*` branch, never push, report revert evidence.

### Agent A — fix F1 + F2 (owns `web/src/lib/oneclick.ts` + tests)
The min-passage gate must not fall through to an unguarded answer. Requirements:
- On gate refusal, do NOT return the raw flood bare. Options to evaluate (pick with
  evidence, report the rejected ones): re-derive the virtual-boundary threshold from the
  radius actually used (`dt > minPassPx` analogue, feet-true) instead of the hard-coded 3;
  or mint provenance + a confidence deduction on the fallback ("min-passage overruled");
  or let the ladder run its sub-`minPassPx` rungs on this path (the `r <= minPassPx` skip
  was justified by a control flow that no longer exists — reviewer F5).
- Fix must make the reproduced scene (0.44-ft-class slot, vf 0.57) return either the
  trimmed region, or the raw region *with* provenance and a visible deduction — never
  64→121 SF at 1.00.
- The `ok → leak` flips must become deliberate: either eliminated by the threshold fix or
  pinned as tests asserting the refusal is correct behaviour, with the reasoning.
- Corpus must stay byte-identical (these paths are corpus-silent; that's exactly why they
  regressed — add the missing fixtures as unit tests, not corpus probes).
- Revert check on every new test. Bench goldens unmoved.

### Agent B — fix F4 (owns `web/bench/pin-goldens.mts` + tests)
Park orphan (removed-probe) adjudications in a case-level `adjudications` array; test the
**write path** end-to-end against a perturbed corpus copy (the unit-only trap already bit
this file once: the per-case pooling bug was found only by a real run). Include a
rename (removal+addition) case. Restore corpus afterwards; byte-identical.

### Agent C — fix F5 (owns `web/bench/corpus.ts`, corpus JSONs' metadata, `web/bench/from-takeoff.mts`, `web/bench/run.mts` gate)
Rename the declared semantics to what is true — `"drawn-path-vertex"` — with a comment
stating it equals centreline only for single-stroke walls (the two fixture generators)
and lands on faces for double-line walls (the VA plan; cite the 5.88 in measurement).
Remove the unconditional stamp in `from-takeoff.mts` — a human answer key must declare
what the human measured (make it a required CLI arg). Correct the false
"centreline-to-centreline… still tiles" adjudication text and the two arithmetic errors
the re-pin review documented (F1/F2 in its report). Correct `corpus.ts`'s 438.58 comment
(pin is 437.978; the interior cross at (1220,784) is not a path vertex). **No golden
values move** — this is metadata and prose; if anything numeric moves, stop.

### Agent D — fix F6 (owns `web/bench/run.mts` thresholds + `web/bench/score.ts` if needed)
Put a floor under the raw fidelity metric (reviewer suggested 0.80 IoU floor / 0.90 raw
cross pair-IoU — current actuals 0.860/0.962, so these bind against regression without
binding today) and ratchet the gated thresholds toward the new baseline (actuals
0.990/0.994 vs gates at 0.90 — decide the margin, state it). Also consider the re-pin
review's absolute-SF trigger for the ±2.5% band's blindness on rooms that dominate a case
(cloud-corridor moved 37 SF, 54% of the case delta, adjudication-free). Prove each new
gate fires: perturb, run, restore.

### Agent E — fix F3 + F7(b,d,f) (owns `oneclick.ts`, `TakeoffCanvas.jsx`, `mcp/src/session.ts`, `mcp/src/outputs.ts`) — AFTER A lands
- F3: route the vector mask's baseline through page points (the raster helper
  `rasterMaskScale` already does this and documents why) or amend the A1 claim; either
  way fix `a1Scene` to feed `Math.ceil`'d dims so the guard tests production's shape.
  Target: vector and raster masks of one sheet on one grid; one SF per click across
  render scales.
- F7(b): either convert the five production call sites to `oneClickRing` and earn the
  comment, or rewrite the comment to the truth (bench-only + source guard).
- F7(d): add `min_pass_px`/`min_pass_delta` to MCP `receipts()` and declare them in
  `outputs.ts`; add `.strict()` (or a key-set assertion) so the conformance suite can
  actually fail on an undeclared key — then prove it fails on one.
- F7(f): decide the round-column wedge question (a cleanly-fitting closed ring annexes
  its interior — corpus-pinned behaviour, but "non-doors no longer read as door arcs"
  over-claims). Minimum: pin the current behaviour in a test + honest comment; flag the
  deduct-vs-floor policy question to the operator rather than deciding it.

### Agent F — DONE (test-quality review delivered; APPROVE WITH COMMENTS)
34/35 revert checks reproduced; the 35th fixed at `71c53aa`. Its residuals W1–W6 are
distributed into §3 F7(f) and owned by agents D/E. Do not re-run; do re-run **one revert
per agent at integration** (rule 5 stands).

### Agent G — evidence pack DELIVERED (`23e87f7`); re-run required post-fix
The pack exists with committed probe sources. After agents A–E land, re-run the affected
probes against the new head and update the pack: F1/F2 (the A3 fall-through scene must
stop answering +89% at 1.00), F3 (cap-bound A1 — currently **NOT fixed**, the pack's
headline), A5's ellipse/elbow gaps if agent E addresses them. Keep the pack's discipline:
probe sources committed, limitations stated, contradictions reported prominently.

### Integration (the coordinating session, not an agent)
Merge A→E in dependency order, re-run the full matrix (rule 5), re-run one revert per
agent, then update **in the same change**: the plan's status table in `main`
(A2 → "partly fixed" with the gate-red-without-exemptions fact; A3 → note F1/F2 and
their fix; A1 → note F3 and its fix), and — **only with the repo owner's go-ahead,
because of the 17:35Z overwrite** — the issue #184 body per the still-valid Phase 6 list
plus comment `5102667000`'s dangling references. Then, if the operator wants it, a PR
from the engine branch; PR #191 is merged and must not be reused.

---

## 5. What NOT to do

- Don't re-pin any golden outside agent C's metadata scope. Nothing in this queue
  legitimately moves a measured value except possibly F3's ±0.02%, which if it moves a
  golden must go through 0.9 with adjudication.
- Don't trust this document's line numbers (rule 2) or its prose over the reviews it
  summarizes; the three review reports live in the session transcript and their factual
  content is reproduced in §3 — but re-verify by execution what you build on.
- Don't edit the issue body without owner sign-off (§1).
- Don't start RFC item F (batch fill), the answer-key measuring campaign, or item A —
  out of scope for this handoff and gated on decisions the operator owns.
