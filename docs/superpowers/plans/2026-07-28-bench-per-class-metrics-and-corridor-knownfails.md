# Bench Per-Class Metrics + Synthetic Corridor Cases — Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Rev 2** after a 4-reviewer adversarial pass (metrology, flood-engine, repo-audit, upstream-maintainer personas). Blocking fixes: per-class aggregation now splits provenance (B1 — rev 1 would have printed corridor ≈ 1.0 off the engine-pinned `cloud-corridor`); EXPECT arithmetic corrected (aggregate() excludes known-fails — 21+passing, never 24); CONF_GATE handling added (it deliberately reads known-fails; the leak case's computed confidence is 1.00 > ceiling 0.90 → needs an exemption + the bound test update); Task 4 re-goldened to the engine's *policy-correct* segment (rev 1 pinned a known-fail that could never legitimately xpass — a measurement-policy dispute, not a bug); Task 5 reshaped (rev 1's lobby prevented the seal ladder from ever running — the documented mechanism was wrong).

**Goal:** Report bench accuracy per shape class with provenance kept separate, and add synthetic corridor cases — one tracked leak failure, two policy-grounded passing goldens — so the corridor failure measured on the VA plan (median −37.5% vs hand truth, `docs/evidence/one-click/va-corridor-handmeasure.json`) is visible, xpass/xfail-tracked, and item A has a target. ("Visibility + tracked target", not a hard gate: known-fails never gate by design.)

**Architecture:** (1) A required `shapeClass` on golden probes, aggregated per class × provenance (synthetic = accuracy; engine-pinned = regression-only, printed separately — mirroring the existing run.mts:253-255 split). (2) Three new truth-by-construction cases in `corpus.ts`: `corridor-open-ends` (leak through >5 ft openings, knownFail + CONF_GATE_EXEMPT), `corridor-min-pass-segment` (golden = the policy-correct segment, passing), `corridor-dashed-boundary` (seal-bridged dashes, passing). The RFC's own failure mode #2 names "corridors open to lobbies" — "corridor" is RFC vocabulary, not bespoke.

**Tech Stack:** TypeScript (node:test via tsx), Node 24, no new dependencies.

## Global Constraints

- Branch `docs/corpus-vet`, worktree `/tmp/ot-corpus-doc` — never `main`.
- **Every command below runs from `/tmp/ot-corpus-doc/web` with** `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"` **first.** Steps state only the command.
- `npm run check` green before done. The bench MUST exit 0 **including `confidenceGate.failures` empty** — known-fails are excluded from the metric aggregates but NOT from the confidence gate (score.ts:212-215, by design).
- Empirical-pin rule: every predicted verdict below (leak/pass, IoU, confidence) is verified by running; if a case behaves differently, pin the observed verdict and record it in the case comment — never ship a knownFail that passes (xpass gate) or a "passing" case that fails.
- `web/src/lib/oneclick.ts` untouched. Bench/corpus/docs only — this work is **item-E slice material** (Task 6 records that in the slice doc).
- Engine constants (verified, oneclick.ts): `DOOR_SEAL_MAX_FT = 5`, `MIN_PASS_FT = 0.5`, `minPassRadiusFor(18) = 5` (closes axis-aligned gaps ≤ 10 px at 18 px/ft), seal radii at mppf 18 bridge up to ~90 px; corpus convention 18 px/ft, 1000×800 sheet.

---

### Task 1: `shapeClass` on every golden probe, loudly required

**Files:**
- Modify: `web/bench/corpus.ts` (Probe interface + every golden probe literal)
- Modify: `web/bench/corpus/sample-plan.json`, `web/bench/corpus/va-finish-plan.json`
- Modify: `web/bench/score.ts:37-50` (ProbeScore)
- Modify: `web/bench/run.mts` (CaseProbe, runCase pushes, loud validation)
- Test: `web/test/benchScore.test.ts`

**Interfaces:**
- Produces: `Probe.shapeClass?: "room" | "corridor" | "band"` (required on golden probes, enforced at runtime); `ProbeScore.shapeClass?: string`.

- [ ] **Step 1: Write the failing test** (append to `web/test/benchScore.test.ts`):

```ts
test("aggregate: per-class filtering isolates a failing class from a passing one", () => {
  const mk = (shapeClass: string, iou: number, knownFail = false): ProbeScore =>
    ({ caseName: "c", probeName: shapeClass + iou, expect: "golden", status: "ok", iou, sfErr: 0, shapeClass, knownFail } as ProbeScore);
  const scores = [mk("room", 1.0), mk("room", 0.98), mk("corridor", 0.33, true)];
  const room = aggregate(scores.filter((s) => s.shapeClass === "room"));
  const corridor = aggregate(scores.filter((s) => s.shapeClass === "corridor"));
  assert.equal(room.goldenProbes, 2);
  assert.ok(room.floorIoU > 0.9);
  // known-fail-only class: no gating probes, no fabricated accuracy claim
  assert.equal(corridor.goldenProbes, 0);
  assert.equal(corridor.knownFails, 1);
});
```

- [ ] **Step 2: Run it — expect FAIL** (TS2353, shapeClass not a field):
`node --import tsx --test test/benchScore.test.ts`

- [ ] **Step 3: `score.ts` ProbeScore** (after `tags?: string[];`):

```ts
  /** metric shape class ("room" | "corridor" | "band") — required on golden probes */
  shapeClass?: string;
```

- [ ] **Step 4: `corpus.ts` Probe** (after `knownFail?: boolean;`):

```ts
  /** metric class — REQUIRED on golden probes (the bench fails loudly without it).
   *  "corridor" is the RFC's own failure-mode-#2 vocabulary ("corridors open to lobbies"). */
  shapeClass?: "room" | "corridor" | "band";
```

Add `shapeClass: "room"` to every existing golden probe literal in `syntheticCorpus()` (all 12, incl. the 3 known-fails — all enclosed-room/bay geometry). Refusal probes: nothing.

- [ ] **Step 5: Classify pinned JSON probes.** `sample-plan.json`: all 4 → `"shapeClass": "room"`. `va-finish-plan.json`: `patient-room-137`→room, `patient-room-137-band`→**band**, `patient-toilet-137a`→room, `elevator-e01`→room, `ward-room`→room, `ward-vestibule`→room, `cloud-corridor`→**corridor**, `shaded-wing-office`→room; `open-margin` (refusal) unchanged.

- [ ] **Step 6: Plumb through `run.mts`.** `CaseProbe` gets `shapeClass?: string`. Both `scores.push(...)` sites in `runCase` add `shapeClass: p.shapeClass`. Validation — presence AND a tags cross-check (a probe tagged `corridor` must not claim another class):

```ts
const classFailures: string[] = [];
// inside runCase, per golden probe:
if (p.expect === "golden" && !p.shapeClass) classFailures.push(`${caseName}/${p.name}: golden probe missing shapeClass`);
if (p.expect === "golden" && p.tags?.includes("corridor") && p.shapeClass !== "corridor") classFailures.push(`${caseName}/${p.name}: tagged corridor but shapeClass=${p.shapeClass}`);
// in the gate block, with the other failures.push lines:
failures.push(...classFailures);
```

- [ ] **Step 7: Verify:** `node --import tsx --test test/benchScore.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 8: Commit:** `git add -A && git commit -m "bench: require shapeClass on every golden probe"`

---

### Task 2: Per-class × provenance aggregation, print, results.json

**Files:**
- Modify: `web/bench/run.mts` (report section after run.mts:286; results.json write at run.mts:336)

**Interfaces:**
- Consumes: `ProbeScore.shapeClass`, existing `aggregate()`, existing `PINNED_CASES` (run.mts:253).
- Produces: `results.json.split = { synthetic, enginePinned, byClass }` where `byClass[cls] = { synthetic, enginePinned, knownFails }`.

- [ ] **Step 1: Print per-class block** after run.mts:286, before the blended line. **Accuracy rows are synthetic-only** — engine-pinned rows print separately as regression rows (this is the rev-1 blocker: `aggregate()` is provenance-blind, and `cloud-corridor` is engine-pinned, so a blended corridor row would read ≈1.000):

```ts
console.log(`\nby shape class × provenance (accuracy = synthetic only; engine-pinned = regression-only):`);
const classes = [...new Set(scores.filter((s) => s.expect === "golden").map((s) => s.shapeClass!))].sort();
const byClass: Record<string, { synthetic: ReturnType<typeof aggregate>; enginePinned: ReturnType<typeof aggregate>; knownFails: string[] }> = {};
const fmt = (a: ReturnType<typeof aggregate>): string =>
  a.goldenProbes === 0 ? "n=0 gating — NO accuracy claim"
  : a.goldenProbes === 1 ? `n=1 (single observation) IoU ${a.meanIoU.toFixed(3)}`
  : `n=${a.goldenProbes} | mean IoU ${a.meanIoU.toFixed(3)} | floor ${a.floorIoU.toFixed(3)}`;
for (const cls of classes) {
  const inCls = scores.filter((s) => s.shapeClass === cls);
  const synthCls = aggregate(inCls.filter((s) => !PINNED_CASES.has(s.caseName)));
  const pinnedCls = aggregate(inCls.filter((s) => PINNED_CASES.has(s.caseName)));
  const kf = inCls.filter((s) => s.knownFail).map((s) => `${s.caseName}/${s.probeName}`);
  byClass[cls] = { synthetic: synthCls, enginePinned: pinnedCls, knownFails: kf };
  console.log(`  ${cls.padEnd(9)} accuracy(synthetic): ${fmt(synthCls)}`);
  if (pinnedCls.goldenProbes) console.log(`  ${"".padEnd(9)} regression(pinned):  ${fmt(pinnedCls)} — self-graded, NOT accuracy`);
  if (kf.length) console.log(`  ${"".padEnd(9)} known-fail: ${kf.join(", ")}`);
}
```

- [ ] **Step 2: Strengthen the blended line's qualifier** (run.mts:287):

```ts
console.log(`\ngolden probes: ${agg.goldenProbes} | mean IoU ${agg.meanIoU.toFixed(3)} | floor IoU ${agg.floorIoU.toFixed(3)} | refusal ${(agg.refusalRate * 100).toFixed(1)}% | leak ${(agg.leakRate * 100).toFixed(1)}% (blended across provenance AND shape class — quote the splits above, never this line alone)`);
```

- [ ] **Step 3: Persist:** extend the run.mts:336 `writeFileSync` object with `split: { synthetic: synth, enginePinned: pinned, byClass }`.

- [ ] **Step 4: Verify:** `npm run bench` → green; stdout has the `by shape class × provenance` block; `node -e "const s=require('./bench/results.json').split; console.log(Object.keys(s.byClass), s.byClass.corridor)"` shows corridor with `synthetic`/`enginePinned` separated.

- [ ] **Step 5: Commit:** `git commit -am "bench: per-shape-class metrics, provenance-split, printed and persisted"`

---

### Task 3: `corridor-open-ends` — tracked leak failure (knownFail + CONF_GATE_EXEMPT)

**Files:**
- Modify: `web/bench/corpus.ts` (new case before the refusal cases)
- Modify: `web/bench/score.ts` (CONF_GATE_EXEMPT entry)
- Modify: `web/test/benchScore.test.ts` (exemption-keys bound, currently pinned to exactly 3)

**Interfaces:** consumes `mk()`, `rect()`, Task 1's `shapeClass`. Produces the case + exemption.

- [ ] **Step 1: Add the case:**

```ts
{
  // CORRIDOR OPEN AT BOTH ENDS — the failure measured on the VA plan
  // (docs/evidence/one-click/va-corridor-handmeasure.json: engine median −37.5%
  // vs hand truth on 7 corridors; region overlays show annexation through
  // openings). Ends open full-width (6 ft = 108 px) into bounded lobbies:
  // 6 ft > DOOR_SEAL_MAX_FT = 5, so the seal ladder must never bridge the
  // mouths; the flood annexes both lobbies and balloons past the golden (leak).
  // GOLDEN CONVENTION: the corridor alone (180 SF by arithmetic) — the
  // human/architect convention the VA callouts follow; recorded as a
  // convention, documented in docs/UPSTREAM_CONTRIBUTION_SLICE.md. KNOWN-FAIL
  // until vector-native faces (item A); xpass forces a re-pin on fix.
  // Verified 2026-07-28: leak, IoU ≈ 0.49 (region ≈ 370 SF), stable ws ×1/0.75/0.5.
  const segs = [
    // left lobby (right side open at the corridor mouth y 340..448)
    220, 240, 320, 240,  220, 240, 220, 548,  220, 548, 320, 548,
    320, 240, 320, 340,  320, 448, 320, 548,
    // corridor long walls (x 320..860 = 30 ft, y 340..448 = 6 ft)
    320, 340, 860, 340,  320, 448, 860, 448,
    // right lobby (left side open at the corridor mouth)
    860, 240, 960, 240,  960, 240, 960, 548,  860, 548, 960, 548,
    860, 240, 860, 340,  860, 448, 860, 548,
  ];
  cases.push(mk("corridor-open-ends", segs, [
    { name: "mid-corridor", seed: [590, 394], expect: "golden", golden: rect(320, 340, 860, 448), tags: ["corridor", "open-ends", "known-limit"], knownFail: true, shapeClass: "corridor" },
  ]));
}
```

- [ ] **Step 2: Add the CONF_GATE_EXEMPT entry.** The gate deliberately reads known-fails (score.ts:212-215) and this probe's computed confidence is 1.00 (no factor fires: no seal on the primary ok-path, no hatch/curve, minPassDelta ≈ 0) with sfErr ≈ 105% — it fails the ceiling (>0.90 at >2.5% error). Mirror the `annotation-ring-room/center` exemption's shape (score.ts:270-316), with the xfail direction that keeps it honest:

```ts
"corridor-open-ends/mid-corridor": {
  xfailAbove: 0.9,
  reason: "Annexation through >DOOR_SEAL_MAX_FT openings carries no engine-internal signal: " +
    "the flood exits through a genuinely open mouth (no seal, no hatch, no curve, minPassDelta 0), " +
    "so every confidence factor reads clean while the trace annexes two lobbies (sfErr ~105%). " +
    "Same class as annotation-ring: needs vector-native topology (item A), not tuning. " +
    "Asserted to stay > 0.9 — the day any signal separates it, this exemption fails and the case is re-pinned.",
},
```

- [ ] **Step 3: Update the bound test** — `benchScore.test.ts:209-211` pins `Object.keys(CONF_GATE_EXEMPT)` to exactly three keys; extend the expected set with `"corridor-open-ends/mid-corridor"`.

- [ ] **Step 4: Verify empirically:** `npm run bench 2>&1 | grep -A1 corridor-open-ends` → `[known-fail]`, leak, IoU ≈ 0.4–0.5, listed EXEMPT with the xfail direction; `node -e "const r=require('./bench/results.json'); console.log(r.confidenceGate.failures)"` → `[]`. If the verdict differs (e.g. REFUSED), pin the observed verdict in the comment — still a tracked failure; if it PASSES, the case is wrong: widen the lobbies until the mechanism manifests.

- [ ] **Step 5: Commit:** `git commit -am "bench: corridor leak known-fail with confidence-gate exemption"`

---

### Task 4: `corridor-min-pass-segment` — the policy-correct PASSING golden

Rev-1 pinned the whole 30-ft run as golden and the engine's one-segment trace as a known-fail. The maintainer review killed that: sub-half-foot slits dividing spaces is the slice's **codified measurement policy** (the `ward-room-294sf` re-pin; `resolutionInvariance.test.ts` asserts it), so that known-fail could never legitimately xpass. Rev 2 goldens the segment — the case now (a) proves corridors fragment at drafting slits *deterministically*, (b) gives the corridor class a passing synthetic accuracy probe, and (c) documents the convention divergence where it belongs (prose, Task 6).

**Files:** `web/bench/corpus.ts`.

- [ ] **Step 1: Add the case:**

```ts
{
  // CORRIDOR RUN DIVIDED AT DRAFTING SLITS — the minimum-passage POLICY case.
  // Partial partitions leave a 7 px = 0.39 ft central slit < MIN_PASS_FT = 0.5:
  // minPassRadiusFor(18) = 5 closes it on the primary path, dividing the run
  // into three segments — the SAME policy the ward-room-294sf re-pin codified
  // ("a space reachable only through a sub-half-foot drawn gap is measured as
  // its own room"). The golden is therefore the MIDDLE SEGMENT (10 ft × 6 ft =
  // 60 SF by arithmetic) — policy-correct, expected to PASS. NOTE the
  // convention divergence this encodes: a human measuring the whole run reads
  // 180 SF (the VA hand-measure convention,
  // docs/evidence/one-click/va-corridor-handmeasure.json); the engine's policy
  // reads 60. Documented as a measurement-policy note in
  // docs/UPSTREAM_CONTRIBUTION_SLICE.md, not tracked as a failure.
  const segs = [
    200, 340, 740, 340,  200, 448, 740, 448,   // long walls (x 200..740 = 30 ft)
    200, 340, 200, 448,  740, 340, 740, 448,   // end caps
    380, 340, 380, 390,  380, 397, 380, 448,   // partition 1, slit y 390..397
    560, 340, 560, 390,  560, 397, 560, 448,   // partition 2, slit y 390..397
  ];
  cases.push(mk("corridor-min-pass-segment", segs, [
    { name: "mid-segment", seed: [470, 394], expect: "golden", golden: rect(380, 340, 560, 448), tags: ["corridor", "min-passage"], shapeClass: "corridor" },
  ]));
}
```

- [ ] **Step 2: Verify:** `npm run bench 2>&1 | grep corridor-min-pass` → IoU ≥ 0.99, SF±~0%, no leak, NOT known-fail (its confidence ≈ 0.99 via the minPassDelta factor — fine for an accurate probe). If it fails, the geometry is wrong — fix the case, don't re-flag it.

- [ ] **Step 3: Commit:** `git commit -am "bench: corridor segment golden — the min-passage policy, passing"`

---

### Task 5: `corridor-dashed-boundary` — seal-bridged dashes, expected PASS

Rev-1's lobby meant the primary flood returned `ok` and the seal ladder never ran (the documented mechanism was wrong — flood-engine review). Rev 2 drops the lobby: the dashed side's 1-ft gaps are within seal range, the ladder bridges them, and the ≥75%-real-linework gate (`SEAL_VIRTUAL_MAX = 0.25`) sees virtual fraction ≈ 0.21 < 0.25 → accepted → corridor measures whole.

**Files:** `web/bench/corpus.ts`.

- [ ] **Step 1: Add the case:**

```ts
{
  // DASHED-BOUNDARY CORRIDOR (VA cloud-corridor mechanism, engine-independent):
  // the lobby side is dashed — 1 ft dashes / 1 ft gaps (18 px each). The
  // primary flood escapes through the gaps into open sheet, so the seal ladder
  // runs; its radii at mppf 18 bridge 1 ft gaps; virtual fraction ≈ 270 px of
  // a ~1296 px boundary ≈ 0.21 < SEAL_VIRTUAL_MAX 0.25 → seal accepted.
  // Expected to PASS: proof that a dashed corridor boundary within seal
  // tolerance measures whole. Golden 30 ft × 6 ft = 180 SF by arithmetic.
  // Verified 2026-07-28: <pin observed IoU/conf here>.
  const dash: number[] = [];
  for (let x = 320; x < 860; x += 36) dash.push(x, 448, Math.min(x + 18, 860), 448);
  const segs = [
    320, 340, 860, 340,                          // solid wall side
    320, 340, 320, 448,  860, 340, 860, 448,     // end caps
    ...dash,                                      // dashed lobby side
  ];
  cases.push(mk("corridor-dashed-boundary", segs, [
    { name: "mid-corridor", seed: [590, 394], expect: "golden", golden: rect(320, 340, 860, 448), tags: ["corridor", "dashed-boundary"], shapeClass: "corridor" },
  ]));
}
```

- [ ] **Step 2: Verify empirically — two checks:** `npm run bench 2>&1 | grep corridor-dashed` → IoU ≥ 0.90, no leak. **Confidence-gate check:** its sealed-boundary deduction gives conf ≈ 1 − 0.21 ≈ 0.79, an *accurate* probe below the exempted inaccurate rows — confirm `confidenceGate.failures` is still `[]` (the floor check is relative, score.ts:380-394). If the floor fires, reduce the dash gap duty (e.g. 12 px gaps → vf ≈ 0.14, conf ≈ 0.86) until green, and pin the final geometry in the comment. If the case leaks instead, pin it as a knownFail with a CONF_GATE_EXEMPT check per Task 3's pattern.

- [ ] **Step 3: Commit:** `git commit -am "bench: dashed-boundary corridor golden — seal-bridged, passing"`

---

### Task 6: Re-pin EXPECT, full verification, docs (incl. slice doc)

**Files:**
- Modify: `web/bench/run.mts:61` (EXPECT)
- Modify: `web/bench/README.md`, `CHANGELOG.md`, `docs/UPSTREAM_CONTRIBUTION_SLICE.md`

- [ ] **Step 1: Re-pin EXPECT deliberately.** `aggregate()` **excludes known-fails** from `goldenProbes` (score.ts:401-407) — today's 21 = the 21 *gating* goldens. Expected new values: `goldenProbes: 23` (21 + Task 4 + Task 5, both passing; Task 3 is knownFail and adds 0), `knownFails: 5` (4 + Task 3), `refusalProbes: 3`, `cases: 2` (synthetic cases are not corpus *files* — run.mts:183 reads `corpus/*.json`). **Copy the exact numbers from the bench output** — if Task 5 pinned differently, adjust both counts accordingly.

- [ ] **Step 2: Full verification, in order:**
1. `npm run bench` → exits 0; Task 3 in the known-fail block; corridor class shows `accuracy(synthetic): n=2` + 1 known-fail; `node -e "console.log(require('./bench/results.json').confidenceGate.failures)"` → `[]`. (Cross-resolution stability of the new cases is checked by the bench's own cross gate — `resolutionInvariance.test.ts` builds its own scenes and never touches corpus cases, so it is NOT evidence here.)
2. `npm test` → all suites green (benchScore exemption-bound test updated in Task 3).
3. `npm run check` → green end to end.
4. `grep -rn "0\.999" bench/README.md ../docs/` → every hit adjacent to a per-class or per-provenance qualifier.

- [ ] **Step 3: `web/bench/README.md`:** update the What-it-scores table counts (synthetic 9→12, known-fail 4→5) and add the shape-class dimension; extend the corridor honest-limits bullet: "Synthetic corridor cases now encode this: `corridor-open-ends` (tracked leak known-fail — the item-A target), `corridor-min-pass-segment` and `corridor-dashed-boundary` (passing, policy-grounded)."

- [ ] **Step 4: `docs/UPSTREAM_CONTRIBUTION_SLICE.md`:** add a **third measurement-policy note** alongside the wedge and min-passage notes: corridor/open-space measurement — the engine measures the enclosed segment per the min-passage policy; the VA hand-measure campaign (evidence file) shows the human/architect convention reads whole runs, and `corridor-open-ends` tracks the annexation failure for item A. Classify this plan's work as **item-E slice material** in the same doc.

- [ ] **Step 5: `CHANGELOG.md`** (Unreleased): `bench: per-shape-class metrics (provenance-split); synthetic corridor cases targeting the measured VA corridor failure`.

- [ ] **Step 6: Commit:** `git commit -am "bench: re-pin EXPECT for the corridor cases; docs incl. slice-doc policy note"`

---

## Review-response ledger (rev 1 → rev 2)

| Finding (reviewer) | Disposition |
|---|---|
| byClass blends provenance → corridor ≈1.0 laundering (Metrology B1, RepoAuditor B3, Maintainer B2) | **Accepted** — Task 2 splits per class × provenance |
| EXPECT goldenProbes 24 wrong (all four) | **Accepted** — 23 expected (21+2 passing), empirically copied |
| CONF_GATE reads known-fails; new cases red the bench (RepoAuditor B2, FloodEngine B1 w/ computed confs 1.00/0.99/1.00) | **Accepted** — Task 3 adds the exemption + bound-test update; Tasks 4–5 redesigned to pass so no exemption needed; explicit `confidenceGate.failures: []` checks |
| Task 4 known-fail encodes policy-correct behavior, can never xpass (Maintainer B1) | **Accepted** — re-goldened to the segment; convention divergence documented in the slice doc |
| Task 5 mechanism story wrong — seal ladder never runs with the lobby (FloodEngine N3) | **Accepted** — lobby dropped; now exercises the seal ladder + virtual-fraction gate, expected PASS |
| resolutionInvariance.test.ts is vacuous evidence for corpus cases (RepoAuditor N4) | **Accepted** — replaced by the bench's own cross gate |
| n=1 degenerate aggregates (Metrology N2) | **Accepted** — "(single observation)" formatting |
| results.json bare byClass (Metrology N3) | **Accepted** — persisted per-provenance |
| shapeClass presence-only validation (Metrology N4) | **Accepted** — tags cross-check added |
| "gating target" overclaims (Metrology N1) | **Accepted** — reworded to "visibility + tracked target" |
| shapeClass is un-RFC'd vocabulary (Maintainer B4) | **Partially accepted** — kept (fable-consult + metrology want per-class honesty; "corridor" IS RFC failure-mode-#2 vocabulary, grounded in comments/README); slice-doc classification added so upstream sees it as item-E material, tags cross-check keeps the two vocabularies consistent |
| Slice doc not updated / corridor note missing PR prominence (Maintainer N5, N7) | **Accepted** — Task 6 Step 4 |
| Evidence-file traceability (Maintainer N6) | **Accepted** — referenced in both corridor case comments |
| cd/PATH on every command (RepoAuditor N7) | **Accepted** — global constraint, stated once |
| `?? "unclassified"` dead fallback (RepoAuditor N6) | **Accepted** — dropped; validation hard-fails first |
