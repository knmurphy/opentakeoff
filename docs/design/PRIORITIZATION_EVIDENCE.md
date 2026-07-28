# What to build next — the evidence

Status: **research only, nothing implemented.** Written on
`claude/research-prioritization-gm6w75` (branched off the
`claude/issue-184-hatch-periodicity-fduafy` tip, `21e57a0`), 2026-07-28.
Input: the session handoff's two open tracks — RFC **item F (batch fill)**
and `docs/design/IMPROVE_WITH_USE.md`'s four foundations with its reviewed
build order **①→②→③④**.

Every number below was measured on this checkout, not estimated. The probes
are committed under `docs/evidence/one-click/research/` and each finding
names the one that produced it. Baseline for all of them: `npm run bench`
green at `21e57a0` — 21 golden probes, mean IoU 0.991, floor 0.957,
0 refusals/leaks, 4 known-fails.

## The short answer

The handoff's build order is right about *what*, wrong about *when* on two
counts, and it misses a free source of ground truth that is already in the
repo.

| rank | work | why this rank | evidence |
|---|---|---|---|
| 1 | **Callout cross-check harness** (½ session, new) | The VA plan prints its own areas. Clicking them disagrees with the drawing by −44%…+11%. That is the only non-engine number we have, and we have never looked at it. | [A](#a) |
| 2 | **Operator: measure the plans** (unchanged, blocking, nobody else can) | 0 of 21 gating probes are human-measured; the three answer-key gates are inert code. | [B](#b) |
| 3 | **`detectRegions` sealed-flood parity** (small, fixes a live regression) | Batch fill's shipped flood scores mean IoU 0.817 vs 0.999, and double-counts 16.6% of proposed floor. The MCP server ships this today. | [C](#c) |
| 4 | **Item F detection metrics, then item F** (as the handoff says, with corrected scope) | 29% of the batch path's seeds are not rooms; 5 of 8 pinned rooms have no seed at all; the modal region wins only 8–18 of 25 nearby seeds. Two of the three metrics need no answer key. | [D](#d) |
| 5 | **§3 segments-only fixtures** (~1 session, one design change) | Right slot in the order, but store gzip, not base64: measured 0.48 MB vs 2.92 MB for the same exact bytes. | [F](#f) |
| 6 | **§4 fingerprint statistics only** (pull forward), profile threading last | A per-project pitch cap turns a tracked known-fail from IoU 0.197 into 0.937 — and the wrong cap turns a passing fixture into 0.002. Real payoff, real hazard, needs the fingerprint to choose. | [E](#e) |
| 7 | **§1 harvest / §2 outcome log** (unchanged design, later slot) | The well is ~10 days old and empty: provenance landed 2026-07-18, the export button *yesterday*, and the answer-key protocol produces manual shapes by design — so the measuring campaign generates no correction pairs. | [G](#g) |

---

## <a name="a"></a>A. The plan carries its own answer key, and it disagrees with us

`bench/from-takeoff.mts` and the sealed-plan protocol exist to import human
truth, and the round-8 answer-key comment says "what's needed now is plans."
Meanwhile the VA finish plan already in `demo/` prints **9 area callouts** in
its own text layer — designer-authored square footages the engine did not
write.

Probe: `research/callouts2.mts` — parse `NNN SF` text items, sweep 25 seeds
in a ±70 px grid around each anchor (the anchor itself often lands inside
stroke-text glyphs), take the modal region, compare.

| callout | nearby text | modal engine read | error | seeds agreeing |
|---|---|---|---|---|
| 557 SF | `PT` `CPT-1` `CG` | 619 SF | **+11.1%** | 14/25 |
| 250 SF | `AE213` `P-3` `CE-4` | 229 SF | **−8.3%** | 8/25 |
| 189 SF | `LINK CORRIDOR` | 143 SF | **−24.2%** | 13/25 |
| 640 SF | `ELEVATOR LOBBY` | 392 SF | **−38.7%** | 17/25 |
| 270 SF | `VENDING` `CONNECTING CORRIDOR` | 152 SF | **−43.8%** | 18/25 |
| 706 SF · 411 SF · 21 SF · 16 SF | `CPT-2` `CG` … | no stable region (0–86 SF) | — | — |

Read this carefully — it is **not** proof the engine is wrong:

- The signs are mixed (+11%, −8%, −24%, −39%, −44%), so it is **not** a wrong
  assumed scale. A scale error is a single multiplier on every room.
- The callouts sit beside finish tags (`CPT-1`, `CPT-2`, `PT`), so some are
  plausibly *finish-material quantities over a zone*, not one room's floor —
  a different boundary convention, not an error.
- Three of the five are corridor/lobby spaces, exactly where the tracked
  annotation-ring limitation (issue #184 open item) and the room-vs-network
  question bite.

That ambiguity **is** the finding. The corpus's headline mean IoU 0.991 is
computed against goldens the engine itself authored (see B), so it cannot
distinguish "the drawing and the engine measure different things" from
"the engine is 40% low on corridors". Today nothing in the repo can. A
half-session harness that reports callout-vs-engine per plan — **reported,
never gated**, because the convention is unknown — would:

1. give the upstream PR an honest "here is where we differ from the drawing,
   and why" section instead of a self-consistent scoreboard;
2. turn *every* plan that prints its own areas into a partial answer key, at
   zero human cost, on top of whatever the operator measures;
3. tell us before the measuring campaign whether the disagreement is
   convention (systematic, explainable) or accuracy (per-room, alarming) —
   which changes what the operator should measure first.

Do this first because it is cheap, it is not blocked on anyone, and it can
change the plan for everything below it.

## <a name="b"></a>B. Nothing in the corpus can currently detect real-plan error

From `bench/results.json` at `21e57a0`:

| | probes | truth source |
|---|---|---|
| synthetic | 9 gating goldens | truth by construction (`bench/corpus.ts`) |
| `sample-plan` | 4 | engine traces, reviewed as exact rectangles |
| `va-finish-plan` | 8 | engine traces, visually reviewed and pinned |
| **human-measured** | **0** | — |

So 12 of 21 gating goldens (57%) are the engine's own output. The coverage
table prints the tautology plainly: `×1.000` for both real plans, because Σ
engine and Σ golden are the same rings.

Direct consequence: the three answer-key gates added in `7605315` —
`humanMaxSfErr` 2.5%, `humanCoverageBand` ±2%, `humanOverlapFrac` 0.5%
(`bench/run.mts:25-34`) — are guarded by `if (!cv.humanMeasured) continue;`
(`run.mts:157`) and **gate nothing today**. They are correct, tested, and
inert. The round-8 lesson ("a re-pinned corpus proves self-consistency, not
correctness") applies to the whole real-plan half of the corpus.

This is why the operator to-do stays the highest-value blocking item, and
why it should be *measured against* the harness in A rather than in
isolation: two independent truth sources on the same sheet is how you find
out which one has the convention problem.

## <a name="c"></a>C. Batch fill's flood is the round-4 engine, and it ships today

`detectRegions` (`web/src/lib/detectRooms.ts:76-93`) calls **`floodRegion`** —
the raw flood. The click path calls `floodRegionSealed` with
`sealRadiiFor` / `doorWedgeCapPx` / `minPassRadiusFor`
(`TakeoffCanvas.jsx`, `bench/run.mts:53`). Everything rounds 5–8 added — gap
sealing, per-arc door wedges, the minimum-passage rule — is absent from the
batch path. The handoff frames this as "consider passing `minPassRadiusFor`
through `detectRegions` for parity"; it is the whole ladder, not one
argument.

Probe: `research/batchfill-parity.mts`, VA plan, the 8 pinned probe seeds:

```
                        raw floodRegion   floodRegionSealed
mean IoU (8 probes)         0.817              0.999
ward-vestibule              0.149              1.000
ward-room-294sf             0.825              1.000
elevator-e01                0.829              1.000
patient-room-137            0.859              1.000
```

Probe: `research/batchsheet.mts`, all 56 label seeds on the VA sheet:

```
                     proposals   Σ proposed   distinct floor   double-counted
raw floodRegion        52/56       3379 SF       2800 SF       560 SF (16.6%)
floodRegionSealed      52/56       2714 SF       2720 SF         0 SF (0.0%)
```

(Cell-quantized at 12 image px ≈ 0.67 ft; the ±0.2% slop between 2714 and
2720 is quantization, not overlap.)

The double-counting is the doorway-leak class: without the minimum-passage
rule, two rooms' labels flood the same conjoined space. **16.6% against a
0.5% gate.** Batch fill built on today's `detectRegions` would fail the
bench's own double-counted-floor gate by 33×, and the failure is invisible
until the sealed ladder is threaded through.

Not hypothetical: `mcp/src/session.ts:394-395` calls `roomLabelSeeds` +
`detectRegions` for the MCP server's room detection. That tool measures with
the pre-sealing engine right now, while the canvas measures with the sealed
one. This is a live parity bug worth fixing on its own, independent of
whether item F gets built this month.

## <a name="d"></a>D. Item F's real risk is seeding, and most of it is measurable without an answer key

The handoff is right that batch fill needs detection-grade metrics before
the feature. Three things the VA sheet already shows (`research/batchsheet.mts`,
`research/batchfill-parity.mts`):

**Label precision.** `ROOM_LABEL_RE = /^\d{2,3}[A-Z]?$/` matched 56 text
items. Roughly 16 of them (29%) are not rooms:

- the plan's own area callouts — `21 SF`, `16 SF`, `557 SF`, `706 SF`,
  `250 SF`, `411 SF`, `270 SF`, `189 SF`, `640 SF` (the numeric token
  matches);
- title-block and margin numerals — `10` (×2, sheet corners), `16`, `28`
  (from `RENOVATE BUILDING 28`), `33`, `08 - 6231`.

The margin numeral `33` produced the **single largest proposal on the sheet,
847 SF** — a paper-space region, the exact failure the `open-margin`
known-fail tracks. A batch pass would offer it to the estimator as a room.

**Recall ceiling.** Only 3 of the 8 pinned goldens contain a room-number
anchor at all (`patient-room-137`, `patient-toilet-137a`, and the ward room
via a callout). `elevator-e01`, `cloud-corridor`, `shaded-wing-office`,
`ward-vestibule` and the annotation band have none — corridors, elevators and
vestibules are not labeled with the number pattern, or their label sits
outside the space. Measured room recall of the shipped batch path against
the pinned goldens: **1/8 at IoU ≥ 0.5** (raw), **1/8** (sealed).

**Seed stability.** Sweeping 25 seeds around each area callout, the modal
region won only 8–18 of 25. Near the `189 SF` link corridor, 5 of 25 seeds
annexed a **1222 SF** region instead of the 143 SF one. And the tiny guard
is `TINY_SF ≈ 0.093 SF` (`oneclick.ts:61`), so seeds landing inside stroke
text return `ok` with sub-SF areas rather than refusing — fine for a
deliberate click (the sub-4-SF "fixture-sized?" hint covers it), a junk
proposal in a batch list.

Precision against a full room census still needs human truth. But
**duplicate coverage, seed stability and label precision do not** — they are
computable on any plan today, and they are where batch fill will actually
fail. Build those three into the bench first; they are also the metrics that
would catch a regression in the parity fix from C.

## <a name="e"></a>E. §4's pitch cap is a real knob with a razor-thin window

`IMPROVE_WITH_USE.md` §4 proposes a per-project `hatch_max_pitch_ft`, and
the round-8 review recorded the two pitch known-fails as "not fixable by
caps." Probe `research/pitchcap.mts` sweeps the cap across the synthetic
corpus (worst-probe IoU per case; the cap is moved by scaling the px/ft
handed to `buildMask`, with the flood's own radii/wedge/min-pass parameters
held at the true scale):

| fixture (module pitch) | ≤0.90 ft | 1.00 ft | 1.10 ft | 1.25 ft | **1.333 ft (shipped)** |
|---|---|---|---|---|---|
| `partition-bank-15in` (15″ = 1.25 ft) *known-fail* | **0.937** | **0.937** | **0.937** | 0.197 | 0.197 |
| `tile-demising-same-pen` (12″ = 1.0 ft) *known-fail* | 0.005 | 0.497 | 0.497 | 0.497 | 0.497 |
| `tile-grid-room` (16″ = 1.333 ft) *gating* | 0.002 | 0.002 | 0.002 | 0.002 | **0.992** |
| `hatched-room` (2.7″) *gating* | 0.992 | 0.992 | 0.992 | 0.992 | 0.992 |
| `annotation-ring-room` *known-fail* | 0.650 | 0.650 | 0.650 | 0.650 | 0.650 |

Every non-hatch fixture (enclosed-room, cased-opening, door-swing,
two-doorways, curved-partition, two-door-room) is bit-flat across the whole
sweep — the cap touches nothing else.

Three conclusions:

1. "Not fixable by caps" is right for a **global** cap and wrong for a
   **per-project** one. No single value satisfies both `partition-bank-15in`
   and `tile-grid-room`; a project profile at 1.0–1.1 ft converts a tracked
   known-fail from **IoU 0.197 to 0.937**, at the price of 16″-module hatch
   recognition on that project. That is §4's thesis, now with a number.
2. The window is one third of a foot wide and the cliff is vertical
   (0.992 → 0.002 for `tile-grid-room`; 0.497 → 0.005 for the 12″ module
   below 1.0 ft). A wrong suggestion is not a mild degradation — it is a
   room that floods to a single tile cell. §4's own guard rails (never
   auto-apply, `provenance.set_by`, §1's correction rate as watchdog) are
   load-bearing, not ceremony.
3. `annotation-ring-room` is cap-invariant at 0.650 — independent
   confirmation that the annotation-ring limitation needs semantics, not a
   knob, and belongs with item A as the issue already says.

Practical consequence for sequencing: the *fingerprint statistics* (pure,
bench-side, cheap — the classifier already builds the angle/pitch families,
`oneclick.ts:489-543`) are worth pulling forward from §4's "build last",
because they are what tells you which side of the cliff a plan is on. The
*profile threading* through the engine should still go last.

## <a name="f"></a>F. §3 is right about the slot, wrong about the storage

Probe `research/segsize.mts`, both demo plans extracted and re-serialized:

| VA finish plan (71,819 segments) | size | exact round-trip |
|---|---|---|
| decimal JSON array | 3.53 MB | yes |
| **Float64 base64** (the doc's choice) | **2.92 MB** | yes |
| Float64 raw binary | 2.19 MB | — |
| **Float64 gzip(binary)** | **0.48 MB** | yes |
| meta base64 | 0.09 MB | yes |

The design doc's "≈ 2.3 MB base64 vs 3.8 MB decimal" is comparing the *raw
binary* size against decimal JSON; base64 adds 33% on top, so the real saving
is **17%, not 40%**. Gzip saves **86%**. The doc lists gzip as "spec'd, not
required" and base64-vs-decimal as the decision — it is the other way round.
Recommend `.json` with a gzipped, base64'd `segs_gz_b64` (or a sidecar
`.bin.gz`), keeping the doc's Float64 requirement: **Float32 is confirmed
lossy on this plan's segments** (`f32Exact: false`), so the doc's rejection of
it stands.

One decoder trap found while measuring: Node pools small `Buffer`s, so
`new Float64Array(Buffer.from(b64, "base64").buffer)` reads from a nonzero
byte offset and silently returns garbage for small payloads — it reported a
false round-trip failure on the 6-segment plan until sliced by
`byteOffset`/`byteLength`. Whatever lands must have the codec unit test the
doc already calls for, with a *small* case in it.

## <a name="g"></a>G. §1 and §2 are cheap and correct — and currently harvest an empty well

The design doc's feasibility claims check out, and one is understated:
`from-takeoff.mts` **already has** `--allow-machine`
(`bench/from-takeoff.mts:106,118,151,169`), so the corrected-shape path is a
policy + tier question, not new plumbing. `stampEdit`
(`provenance.js:32-45`), the `ORIGIN_FIELDS` whitelist gap
(`contribute.js:52-66` — `confidence`, `confidence_factors`, `gap_sealed_px`,
`door_wedges`, `auto_named` all absent), the hardcoded bench sensitivity
(`run.mts:53` passes a literal `0.5`), `metaGet`/`metaPut`
(`store.js:348-358`) and the spec §7 boundary
(`CONTRIBUTION_SPEC.md:267-277`) are all exactly as described.

What the doc does not weigh is *how much data exists to harvest*:

- provenance primitives landed **2026-07-18** (`df9f477`) — ten days ago;
- `exportTakeoffJson`, §1's only input format, landed **2026-07-28**
  (`7605315`) — yesterday, on an unmerged branch;
- this fork's production deploy workflow was removed (`7175380`), so there is
  no fork deployment quietly accumulating estimator-days.

And the two campaigns do not compose: the answer-key protocol has the
operator measure **with the normal drawing tools**, and `extractCase` refuses
machine-origin shapes by design — so the measuring sessions produce *manual*
shapes and **no correction pairs**. §1 does not piggyback on the plan
campaign; it needs ordinary One-Click estimating days that have not happened
yet.

Nothing here argues against building §1 — it is ~1 session, the provenance is
already being written, and it makes future days harvestable. It argues
against building it *before* the four items above, all of which produce
evidence on data that exists today. §2 (explicitly "only meaningful after
weeks of use") follows §1 whenever §1 goes.

## Reproducing

```
cd web && npm ci
node --import tsx ../docs/evidence/one-click/research/callouts2.mts        # A
node --import tsx ../docs/evidence/one-click/research/batchfill-parity.mts # C  (ONLY=va-finish-plan to skip sample-plan)
node --import tsx ../docs/evidence/one-click/research/batchsheet.mts       # C, D
node --import tsx ../docs/evidence/one-click/research/pitchcap.mts         # E
node --import tsx ../docs/evidence/one-click/research/segsize.mts          # F
```

They are diagnostics, not gates: throwaway scripts kept for reproducibility,
outside `web/bench/` so the slice audit list
(`docs/UPSTREAM_CONTRIBUTION_SLICE.md:71-80`) is unchanged. The VA-plan
probes take several minutes each (72k segments, floods at production
resolution).

## What this does not settle

- **Whether the engine is actually 40% low on corridors.** A says we cannot
  tell yet, and names the two candidates (finish-zone convention vs real
  under-measurement). B is how you find out.
- **Item F's precision.** Duplicate coverage and seed stability are
  measurable now; "did it propose a room that isn't a room" needs a room
  census, i.e. human truth.
- **Whether a fingerprint can pick the right side of E's cliff.** The
  statistics are computable; that they *predict* the failure is a hypothesis
  the corpus cannot test with two plans from two firms.
