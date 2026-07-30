# Improve-with-use foundations — investigation & design

Status: **design document, nothing implemented.** Written on
`claude/issue-184-hatch-periodicity-fduafy` (2026-07-28), after the round-8
adversarial review and the answer-key pipeline (`7605315`). Working log:
issue #184. Every feasibility claim below was verified against the code at
these revisions; citations are `file:line` at this commit.

The four foundations turn daily estimator use into engine improvement:

```
                       ┌─────────────────────────────────────────────┐
                       │  daily use: click → review → correct/accept  │
                       └──────┬───────────────────────┬──────────────┘
                              │ shapes + origin.*     │ outcomes (accept/edit/delete/re-click)
                              ▼                       ▼
   ①  correction-pair harvest                ②  confidence outcome log
        │        │                                    │
        │        └──────────► calibration (ECE, reliability curves) ◄──┘
        │                       "is 0.94 actually 94%?"
        ▼
   candidate bench fixtures ──── carried by ──► ③ segments-only cases
        │                                            (confidential plans become
        │                                             shareable corpus material)
        ▼
   correction rate per style cluster ◄── ④ sheet fingerprint
                                              │
                                              ▼
                                        per-project engine profile
                                        (fingerprint suggests, estimator
                                         confirms, corrections validate)
```

①'s pairs are ②'s ground-truth outcomes for created shapes; ② adds the
outcomes ① cannot see (deletions, discards, re-clicks). ③ is the privacy
substrate that lets ①'s pairs from confidential plans become corpus cases.
④ conditions everything on drawing style: correction rates and calibration
sliced by fingerprint cluster tell us which styles need which profile.

A fifth, pre-existing piece matters more than the handoff knew: **the
opt-in contribution pipeline already defines the correction-pair wire
format** (`web/src/lib/contribute.js`, `docs/CONTRIBUTION_SPEC.md`,
`capture/capture_server.py`). §1 below slots into it rather than inventing
a parallel format, and §2 must respect the boundary its spec draws.

---

## 1. Correction-pair harvest

### (a) Feasibility — verified, and further along than assumed

The data already exists end to end:

- **The freeze works as described.** `stampEdit` (`web/src/lib/provenance.js:32-45`)
  freezes `origin.proposed_verts_norm` from the pre-edit `verts_norm` on a
  machine-origin shape's FIRST real edit, and bumps `origin.edits[kind]`
  per gesture. The command layer guarantees the freeze reads the true
  pre-gesture ring even under live preview (`web/src/lib/shapeCommands.js:173-183`,
  `geom` reconstructs from `prev` before stamping) and that undo restores
  provenance verbatim (`restampFrom`, lines 164-171) — no phantom pairs.
- **Pre-Create corrections are captured too.** A grip-dragged proposal
  records `edited_before_create: true` plus `proposed_verts_norm` from the
  frozen `poly0` at Create (`web/src/pages/TakeoffCanvas.jsx:3034`; `poly0`
  frozen at propose time, line 2938).
- **The seed survives.** `origin.seed_norm` is stamped on every one-click
  shape (`TakeoffCanvas.jsx:3034`) — the harvester can replay the *actual
  click*, unlike `from-takeoff.mts` which synthesizes `interiorSeed`
  (`web/bench/from-takeoff.mts:86-103`) because manual shapes have no seed.
- **Engine metadata rides.** `origin` carries `confidence`,
  `confidence_factors`, `hatch_filtered`, `gap_sealed_px`, `door_wedges`,
  `raster_traced`, `fill_sensitivity` (only when non-default, line 2938),
  `auto_named` (`TakeoffCanvas.jsx:3034`).
- **The payload is exportable today.** `exportTakeoffJson`
  (`TakeoffCanvas.jsx:3638-3642`) downloads exactly the autosave payload
  (`buildPayload`, line 1412-1421), which is what `bench/from-takeoff.mts`
  already consumes.
- **Deletion tallies exist per method.** `applyShapeCommand`'s `delete`
  returns `counted` per `origin.method` (`shapeCommands.js:260-264`);
  the canvas accumulates `provCounters.shapes_deleted`
  (`TakeoffCanvas.jsx:348-358`), persists it (`buildPayload`, line 1420,
  `provenance_counters` key) and restores it on hydrate (lines 898-901).
- **The wire format for pairs is already normative.**
  `docs/CONTRIBUTION_SPEC.md` §5 defines `proposed_verts_norm` / `edits` /
  `edited` / `edited_before_create` on the contribution wire, §5's closing
  note even specifies the standard correction magnitude (IoU between
  proposed and final polygons), and `capture/capture_server.py` banks it.

**Fields that do NOT survive every path (findings):**

1. **A deleted machine shape loses its geometry, seed and confidence** —
   only the per-method count survives (`shapeCommands.js:254-266`). A
   deletion is the strongest correction signal ("so wrong I redrew it")
   and the harvester cannot reconstruct it from a payload. §2's event log
   is the only capture point for delete outcomes with full context.
2. **`origin.confidence`, `confidence_factors`, `gap_sealed_px`,
   `door_wedges`, `auto_named` are absent from the contribution whitelist**
   (`ORIGIN_FIELDS`, `web/src/lib/contribute.js:52-66`). Locally-harvested
   pairs have them; contributed pairs don't. Additive whitelist + spec §5
   registration is required before style/confidence-conditioned analysis
   of the open corpus is possible (spec §6 allows additive changes within
   v2).
3. **`from-takeoff.mts`'s independence guard excludes corrected machine
   shapes entirely** (`web/bench/from-takeoff.mts:117-121`: any
   `origin.method !== "manual"` is skipped). A human-corrected machine
   trace IS a human answer for the final ring — but a weaker one than a
   blind hand trace (anchoring bias, see risks). Turning pairs into
   fixtures needs a deliberate policy extension, not just reuse.
4. **`origin.copied` shapes alias their source's pair** (clipboard copies
   share `origin`; `TakeoffCanvas.jsx:3342` marks `copied: true`). The
   spec already says copied shapes are "excluded from correction stats"
   (§5) — the harvester must honor that.

### (b) Design

**Harvester: `bench/harvest-corrections.mts`** (new file, sibling of
`from-takeoff.mts`, imports only engine modules + `score.ts` per the
entanglement rule). Pure core + CLI, mirroring `extractCase`'s shape:

```
node --import tsx bench/harvest-corrections.mts <takeoff.json> [--pdf <plan.pdf>] [--out pairs.json]
```

Pure transform `harvestPairs(payload, vpW?, vpH?)` — per sheet, per shape:

```ts
interface CorrectionPair {
  shape_id: string;                 // opaque UUID
  sheet_id: string;
  kind: "post_create" | "pre_create" | "accepted";
  method: string;                   // origin.method ("one_click_v1", "agent_v1")
  seed_norm: [number, number];      // origin.seed_norm — replayable
  machine_verts_norm: Pt[];         // origin.proposed_verts_norm (kind!=="accepted")
                                    // or verts_norm (accepted verbatim)
  human_verts_norm: Pt[];           // verts_norm — the estimator's final answer
  iou: number;                      // polyIoU of the two, normalized space
                                    // (× aspect if vpW/vpH known — see note)
  edits?: Record<string, number>;   // origin.edits gesture tally
  engine: {                         // everything the engine said about its trace
    confidence?: number; confidence_factors?: string[];
    hatch_filtered?: boolean; gap_sealed_px?: number; door_wedges?: number;
    raster_traced?: boolean; fill_sensitivity?: number; auto_named?: boolean;
  };
  created_at?: string;
}
```

Selection: `measure_role === "floor_area"`, machine `origin.method`, NOT
`origin.copied`. `kind` classification: `proposed_verts_norm` present +
`edited` → `post_create`; `edited_before_create` without post-Create
`edited` → `pre_create`; machine shape with neither → `accepted`
(iou = 1.0 rows are the *negatives* calibration needs — do not drop them).
IoU computed via `score.ts`'s `polyIoU` after scaling normalized verts by
(vpW, vpH) when a PDF is given (normalized-space IoU is aspect-distorted;
with `--pdf` the tool uses the real viewport like `from-takeoff.mts:167-169`).

**Pairs → candidate bench fixtures.** Extend `from-takeoff.mts` with
`--include-corrected`: machine shapes with `origin.edited ||
origin.edited_before_create` (still excluding untouched machine shapes and
`copied`) become probes with:

- `golden`: the human's final ring (same px mapping as
  `from-takeoff.mts:123`),
- `seed`: `origin.seed_norm` mapped to image px — the estimator's actual
  click, not `interiorSeed` (replays the exact failure),
- `tags`: `["human-corrected"]` (vs `["human-measured"]`) plus
  `machine-iou-<bucket>` for triage,
- per-probe `sens`: `origin.fill_sensitivity` when present — **loader
  change required**: `bench/run.mts:52` hardcodes sensitivity `0.5`; a
  correction-pair probe must replay the recorded knob. Additive per-probe
  field, default 0.5.

Cases built this way carry `humanMeasured: true` **only if** every probe
is `human-measured`; a mixed or corrected-only case gets a new
`humanCorrected: true` marker that the bench gates with the same SF-error
thresholds (`run.mts:25-34`) but reports separately — a corrected ring is
review-anchored truth, one grade below blind-measured truth. Low-IoU pairs
(machine badly wrong) are the valuable fixtures; near-1.0 pairs add noise
and should be filtered (suggest: fixture-candidate iff `iou < 0.98` or
refused-then-redrawn once §2 exists).

**Correction-rate-per-method metric.** Computable today from any payload:

```
created(m)  = surviving(m) + provenance_counters.shapes_deleted[m]
touched(m)  = |{s : method=m, edited || edited_before_create, !copied}|
rate(m)     = (touched(m) + deleted(m)) / created(m)
magnitude   = histogram of (1 − iou) over pairs      // spec §5's measure
```

Surface it in the harvester's report (and `results.json`-style output),
sliced by `confidence_factors` and, once §4 exists, by fingerprint
cluster. Caveat to print with the number: `created(m)` undercounts shapes
created-and-deleted before any autosave persisted them only if the tab
died mid-debounce (700 ms window, `TakeoffCanvas.jsx:1464-1473`) —
negligible, but the metric is "per persisted lifecycle", not per click
(clicks that never got Created are invisible until §2).

### (c) Privacy / consent

- The harvester consumes a **local file the estimator explicitly
  exported**; nothing ambient. Normalized geometry, no PDF.
- Pairs contain the plan's room geometry — same sensitivity class as the
  takeoff itself. The candidate-fixture path re-references the PDF, so
  a fixture from a confidential plan is only shareable via §3
  (segments-only carrier) or under the sealed protocol
  (`bench/corpus/sealed/`, `BENCH_SEALED=1`, `run.mts:104-108`).
- Contribution of pairs is already covered by the existing opt-in gate and
  spec §2's MUST-NOTs; the whitelist gap (finding 2) is the only change,
  and it is additive. Keep `pickOrigin`'s never-spread discipline.

### (d) Classification

- `harvestPairs` core + `from-takeoff.mts` extension + per-probe `sens`
  loader change: **upstream-slice compatible** (bench tooling, imports
  only engine modules — extends RFC item E). The `--include-corrected`
  policy and `humanCorrected` gate tier should be flagged as a
  measurement-policy review point like the four existing ones.
- Contribution whitelist additions + spec §5 rows: **fork extension**
  (the contribution pipeline is not RFC material).
- An in-app "correction rate" readout (if ever): fork extension.

### (e) Effort & sequencing

Small. ~1 session: harvester (pure core + tests over synthetic payloads,
including copied/undo/reassign edge cases) + `--include-corrected` +
per-probe `sens` in the loader (one-line default, covered by a fixture
test). No engine changes. **Build first** — it is the data source for ②'s
calibration and ④'s validation, and it makes every future estimator-day
retroactively harvestable (the provenance is already being written).

### (f) Risks / open questions

- **Anchoring bias**: a corrected ring starts from the machine's trace;
  systematic machine bias (e.g. the arc-line-vs-threshold-plane ~2-3 SF
  bias, issue #184 open items) survives correction. Hence the separate
  `human-corrected` tier, never silently merged with blind answer keys.
- **Selection bias**: estimators fix what's cheap to fix and redraw what
  isn't; pairs over-represent small corrections. Deletion capture (§2)
  is the complement — track both before drawing conclusions.
- **Stale pairs after recalibration**: rescale re-prices `computed` but
  `verts_norm`/`proposed_verts_norm` are normalized and scale-free — pairs
  survive. Sheet re-key (`resheet`) keeps origin (`shapeCommands.js:212-227`)
  but the new sheet's PDF may differ (reissued sheet) — the harvester
  should warn when `sheet_id` has no scale record, same as
  `from-takeoff.mts:156-159`.
- Open: should a `reassign`-only edit (condition change, geometry
  untouched — it still freezes `proposed_verts_norm`, `provenance.js:39-43`)
  count as a correction? Recommend: excluded from geometric pairs
  (iou = 1), included in a separate relabel tally.

---

## 2. Confidence outcome logging + calibration

### (a) Feasibility — verified; the canvas knows every outcome

- The score + factors exist per trace (`traceConfidence`,
  `web/src/lib/confidence.ts:41-54`) and are computed at propose time
  (`TakeoffCanvas.jsx:2887`), carried on the proposal region (`cf`/`cff`,
  line 2938), stamped into `origin` at Create (line 3034), and shown in
  the readout. The bench already reports per-probe confidence
  (`run.mts:63`).
- Every outcome has an identifiable code point:
  - **proposed**: `proposeRegion` outcome `"added"` (line 2933);
  - **accepted**: `createProposal` (line 3017-3041);
  - **discarded (region)**: Backspace pops the last region (line 1770);
  - **discarded (proposal)**: Esc / tool change (line 1050) / sheet-group
    change (line 1135) / restore (line 1435) — `setProposal(null)` sites;
  - **edited pre-Create**: the grip-drag path that sets `r.touched`;
  - **edited post-Create**: `dispatchShape({type:"geom"...})` on a
    machine shape (the reducer wrapper at lines 353-361 already inspects
    command results — one seam for all of add/geom/delete);
  - **deleted**: same wrapper, `counted` non-empty;
  - **re-clicked**: a new one-click proposal whose seed falls inside a
    machine shape deleted in the same session — detectable in the logger
    with a small in-memory list of recently-deleted machine rings (the
    payload alone can never see this; finding 1 of §1).
- Storage primitives exist: `metaGet`/`metaPut`/`metaDelete` on the
  keyPath-less IndexedDB meta store (`web/src/lib/store.js:348-358`),
  documented as the cloud-free bookkeeping seam with caller-owned key
  namespacing (the sync layer's `sync:<folderId>:*` pattern is the
  precedent for avoiding lost updates: one writer per key).

**Finding — the spec boundary.** `docs/CONTRIBUTION_SPEC.md` §7 draws a
deliberate line: the explicit Contribute gate ships final-state
demonstrations; "the ambient event-stream edition — … deletion records
with geometry, decision trails, rejected proposals and their dismissal
context, per-edit timing — is the commercial capture layer inside Spline."
An outcome log with timestamps and rejected proposals is squarely the
event stream. Design consequence: **the log is local-only with an
explicit file export; it must never ride the Contribute payload**, and
its exporter must not be wired to `sendContribution`. (Whether the fork
later revisits that product boundary is an operator decision; this design
respects the spec as written.)

### (b) Design

**Event schema** (one JSON object per event, append-only):

```ts
interface OneClickEvent {
  v: 1;                              // event-schema version
  ts: string;                        // ISO-8601 — local log only, stripped on any share
  session: string;                   // mintUuid() per canvas mount
  sheet: string;                     // sheet_id verbatim locally (tokenized on export)
  event: "propose" | "create" | "region_discard" | "proposal_discard"
       | "edit_pre_create" | "edit_post_create" | "delete" | "reclick"
       | "refuse";                   // refuse = flood returned non-ok (leak/tiny/boundary)
  shape_id?: string;                 // create onward — joins to the payload/pairs
  seed_norm?: [number, number];
  confidence?: number;               // cf at propose time
  factors?: string[];                // cff
  engine?: { sealedPx?: number; virtualFrac?: number; wedges?: number;
             hatchFiltered?: boolean; raster?: boolean; mppf?: number;
             sens?: number; status?: string };   // refuse events carry status
  area_sf?: number;
  reclick_of?: string;               // reclick: the deleted shape_id it re-covers
  edit?: { kind: string; iou?: number };  // post-create edits: gesture + magnitude
}
```

`refuse` events matter: refusals have no shape, no provenance, and are
invisible to §1, yet "the engine refused and the estimator hand-traced"
is a confidence-adjacent outcome (score would have been N/A — track
refusal contexts for the fingerprint, §4).

**Hook**: one function `logOneClick(evt)` in a new
`web/src/lib/oneclickLog.js`, called from the sites listed in (a). The
canvas's `dispatchShape` wrapper is the single seam for
create/edit/delete/undo (undo of a delete should log a compensating
`undelete` or simply be ignored — recommend: log undo as
`{event:"delete", undone:true}` correction rows are cheaper than
re-deriving; open question below).

**Storage**: in-memory buffer, flushed debounced (reuse the 700 ms
autosave cadence) to `metaPut("oclog:<projectScope>:<session>", events[])`
— one writer per key (the session), no read-modify-write race, crash
loses at most the debounce tail. Retention: on mount, list `oclog:*` keys
for the scope and drop entries older than 90 days / keep the newest N
sessions (constant, ~50). Size: ~250 B/event, a heavy tracing day ≈ 500
events ≈ 125 KB — IndexedDB-trivial. NOT in the annotations payload
(events are not takeoff state; they must not ride autosave, snapshots,
sync, or `exportTakeoffJson`).

**Export**: menu item next to "Export takeoff data (JSON)"
(`TakeoffCanvas.jsx:3630-3642` pattern) → `opentakeoff.oneclick_log.v1`
file: `{ schema, sessions: [...] }` with sheet ids tokenized
(`sheet_1`, … — `contribute.js:118-119`'s minting pattern) and — if the
export is intended to leave the machine — timestamps coarsened to date
only. Local analysis can use the raw log.

**Calibration analysis — `bench/calibration.mts`** (runs on demand once
data exists; not part of the gate until volumes justify it):

- Input: one or more exported logs, optionally joined with the payload
  (for post-export edits) via `shape_id`.
- Outcome definition (primary): a `propose` is a **success** iff its
  shape was Created and never geometrically corrected (no
  `edit_pre_create`/`edit_post_create`/`delete`/`reclick` within the
  observation window); IoU-weighted variant: success degree =
  IoU(machine, final) from §1 pairs.
- The score is a product of named constants (`confidence.ts:35-38`), so
  observed scores concentrate on a small lattice (1.0, 0.97, 0.95, 0.90,
  0.75–0.9 seal band, products thereof) — bin by **factor set**, not by
  numeric bucket, plus a coarse 5-bin numeric view for the reliability
  curve. Report: reliability table (predicted vs empirical acceptance per
  bin, with n), ECE = Σ nᵢ/N · |accᵢ − confᵢ|, and per-factor lift ("traces
  with `sealed-opening` were corrected 3× more often than same-score
  traces without it").
- Output honesty: `confidence.ts:20-21` says the score is "a REVIEW
  PRIORITIZER, not a probability". Calibration analysis is exactly how it
  earns probability semantics — or how the constants get re-fit
  (re-fitting the CONF_* constants from data is the eventual payoff, and
  is an engine change gated by the bench like any other).

### (c) Privacy / consent

- Local by default; per-project scoped keys; wiped with the browser
  profile. No network. Export is an explicit user action producing a file
  the user handles.
- Timing metadata is the sensitive novelty (spec §2 bans edit timing from
  the wire for good reason — productivity surveillance). The exporter's
  tokenize+coarsen step is the floor; a `--strip-timing` default-on flag
  for any file intended to be shared.
- Never wire into Contribute (§7 boundary, see (a)).
- Consent surface: the log should be visible (a "One-Click activity"
  count in the panel or docs) rather than silent — estimators should know
  the tool keeps a local diary, even one that never leaves the machine.

### (d) Classification

**Fork extension, wholesale** — canvas wiring, store usage, export UX.
The RFC's item D asked for the score and metadata (shipped); outcome
logging is our product loop. Two carve-outs:
- `bench/calibration.mts` operating on *bench corpus results* (per-probe
  confidence vs IoU already in `results.json`) is upstream-slice-adjacent
  and could ship with item E follow-ups.
- Any future re-fit of `CONF_*` constants from calibration data lands in
  `confidence.ts` → upstream slice, evidence attached.

### (e) Effort & sequencing

~2 sessions: logger module + canvas call sites + retention + export
(+ unit tests for the pure event builder and the tokenizer; one e2e
assertion that a click writes a propose/create pair). `calibration.mts`
~½ session but **only meaningful after weeks of use** — build the logger
early precisely so data accrues. Sequencing: second, right after §1
(shares the outcome vocabulary; the `reclick` detector wants §1's
deleted-ring bookkeeping).

### (f) Risks / open questions

- **Observation window**: "never corrected" is right-censored — a shape
  edited next month was a false accept today. Mitigation: calibration
  joins the CURRENT payload (origin.edited is cumulative), so
  post-session corrections retro-label old propose events via `shape_id`.
- **Undo noise**: undo/redo cycles can double-log. Decide: log undo as a
  marked event (recommended) vs suppress via the command wrapper's
  inverse-detection (`dispatchShape` already distinguishes direction,
  line 391).
- **Multi-tab**: two tabs on one project write distinct session keys —
  safe by construction, but the retention sweep must not delete a live
  sibling's key (list-and-filter by age only).
- Open: does a `proposal_discard` caused by tool-switch mean "rejected"
  or "interrupted"? Recommend logging the discard reason (esc / tool /
  sheet-change) and letting analysis decide.

---

## 3. Segments-only (PDF-free) fixtures

### (a) Feasibility — verified empirically, bit-for-bit *(by a scratchpad script that was **not committed**, so the table below is not reproducible from this repo — audit finding D8)*

The bench's only use of the PDF is `getDocument → getPage → getViewport →
getOperatorList → extractVectorGeometry` (`bench/run.mts:109-118`);
everything downstream consumes `{segs, meta, imgW, imgH, ptPerFt}`
(`runCase`, `run.mts:44-91`). The synthetic corpus already stores raw
`segs` + `meta` inline (`bench/corpus.ts:21-28`) — the case type exists;
only the *pinned real-plan* format lacks it.

**Prototype run (throwaway, scratchpad `segs-roundtrip.mts`, not committed):**
extracted both demo plans, serialized `segs` as a plain JSON number array
(JS shortest-round-trip float serialization is exact) + `meta` as base64,
reloaded, and compared `floodRegionSealed → traceRegion` rings against the
PDF-extracted pipeline at all three bench resolutions (ws × 1/0.75/0.5)
for all 11 pinned seeds:

| plan | segments | numeric round-trip | pipeline rings | JSON size |
|---|---|---|---|---|
| sample-plan.pdf | 6 | exact | identical ×1/×0.75/×0.5 | ~1 KB |
| sample-finish-plan.pdf (VA) | 71,819 | exact | identical ×1/×0.75/×0.5 | 3.79 MB |

Determinism is structural: `markPolylineArcs` runs inside
`extractVectorGeometry` (`oneclick.ts:286`), so exported `meta` already
carries `SEG_CURVE|SEG_POLYARC`; `classifyHatchSegs` runs inside
`buildMask` (`oneclick.ts:627`) from `segs`+`meta` alone. Given identical
inputs the pipeline is a pure function.

### (b) Design

**Case format** (`bench/corpus/*.json`, discriminated by field presence —
`pdf` cases unchanged):

```jsonc
{
  "geometry": {                       // presence ⇒ segments-only case
    "schema": "opentakeoff.bench_geometry.v1",
    "imgW": 5832, "imgH": 4118,       // viewport px at the pinned scale
    "segs_b64": "<base64 Float64Array LE>",   // 4 floats/segment
    "meta_b64": "<base64 Uint8Array>",
    "source": "extractVectorGeometry@<app_version>",  // provenance, not identity
    "crop": [x0, y0, x1, y1]          // optional — title block removed (see (c))
  },
  "ptPerFt": 18,
  "humanMeasured": true,
  "note": "...", "pinnedAt": "...",
  "probes": [ ... ]                    // unchanged (seed/golden/tags/sens)
}
```

Float64 base64 (not a JSON number array) is chosen for size. (`Float32` is
NOT acceptable: coordinates feed `Math.round(seg × ws)` at cell boundaries —
`buildMask`, `oneclick.ts:633-634` — and a 1-ulp float32 perturbation can
flip a cell. That rejection stands.)

> **Corrected 2026-07-28 (round 9 measurement, confirmed by audit).** The
> figures above were wrong and the recommendation was backwards. Measured on
> the 71,819-segment VA sheet: **3.53 MB decimal / 2.92 MB Float64-base64 /
> 0.48 MB gzip.** Base64 saves 17%; **gzip saves 86%**. So gzip is the
> recommendation, not an option — `.json.gz` with the loader sniffing, not
> "spec'd, not required". A pooled-`Buffer` decode trap is noted for the
> codec test.

**Loader change** (`run.mts`, case loop at 109-118): branch on
`c.geometry` — decode instead of `getDocument`; ~8 lines:

```ts
const g = c.geometry
  ? { segs: f64FromB64(c.geometry.segs_b64), meta: u8FromB64(c.geometry.meta_b64) }
  : /* existing pdf path */;
runCase(name, g.segs, c.geometry?.imgW ?? vp.width, ..., c.ptPerFt, c.probes, ...);
```

Per the handoff's bar ("prototype only if low-risk AND fully
test-covered"): the round-trip is proven above, but the loader touch is
bench code and this task forbids modifying it — **spec'd, not landed**.
When landed it needs: a unit test for the b64 codecs, one committed
segments-only twin of `sample-plan.json`, and the fidelity check below in
the suite.

**Exporter flag**: `from-takeoff.mts --segments-only` (and the same on
`pin-goldens.mts`) — after extraction, embed `geometry` and omit `pdf`.
Optional `--crop x0,y0,x1,y1` drops segments outside the rect (segments
straddling the boundary are kept whole — clipping them would change
geometry; the crop is a privacy shear, not a viewport) and records the
rect. Cropping the *title block* specifically is safe for probes (probes
live in plan interior) but shifts nothing (coordinates stay absolute), so
goldens remain valid.

**Fidelity check**: `from-takeoff.mts --segments-only` immediately
re-loads its own output through the segments path and replays every probe
at the three RES_FACTORS, asserting ring-for-ring equality with the PDF
path (exactly the prototype's comparison). A standing
`test/benchGeometryCase.test.ts` does the same for the committed twin
case. This is the "bit-for-bit" gate — any drift (e.g. someone rounds
coordinates for size) fails loudly instead of silently re-pinning truth.

### (c) Privacy / consent — the honest statement

"Anonymized by construction" **overclaims**, and the design must say so:

- What removal of the PDF genuinely strips: the text layer (searchable
  strings — room names, client names, addresses via `getTextContent`,
  which the bench never calls), all raster content (logos, stamps,
  scanned underlays — image ops contribute only `imageArea`,
  `oneclick.ts:202-245`, which isn't exported), fonts, metadata
  (author/title/producer), layers, and anything outside `constructPath`.
- **What survives: stroke text.** CAD plans using SHX/stick fonts emit
  text as `lineTo` linework — those glyphs ARE segments and will render
  legibly in any segs plot. Room tags, dimensions, sometimes title-block
  text on such plans are reconstructable. The `--crop` flag removes the
  title block; interior stroke text remains.
- And fundamentally: the segments are the floor plan's geometry. A
  rendered plot is visually the plan. For a confidential project the
  artifact is *pseudonymized and de-identified in metadata*, not
  anonymous.

Policy consequence: segments-only cases from client plans still require
the client-confidentiality call, made by a human, case by case. The
format's real wins: (1) it makes that call *possible* (a full PDF is
almost never shareable; de-identified geometry sometimes is), (2) sealed
cases (`corpus/sealed/`) no longer need the PDF file at all, (3) corpus
cases stop depending on demo-PDF availability (slice doc assembly plan
step 3, `docs/UPSTREAM_CONTRIBUTION_SLICE.md:88-90`). The exporter should
print exactly this warning ("stroke text may remain; review a render
before sharing") and, ideally, offer `--render preview.png` so the human
reviews what would ship.

### (d) Classification

**Upstream-slice compatible** — pure bench tooling extending item E, no
fork imports, and it directly serves the upstream PR (fixtures can be
bundled without demo PDFs). The privacy-review workflow around it is
process, not code.

### (e) Effort & sequencing

~1 session including tests (codecs, loader branch, fidelity test, twin
case). No engine changes; bench-only. Sequence third — it unblocks
sharing §1's correction fixtures and the answer-key plans the round-8
comment asked for ("what's needed now is plans"), so build it before the
external-plans campaign starts in earnest.

### (f) Risks / open questions

- **Engine-version coupling**: `segs`/`meta` bake in the CURRENT
  extractor+arc-marker. If `markPolylineArcs` improves, a segments-only
  case keeps OLD meta — regression tests keep passing against stale
  classification while the PDF path diverges. Mitigations: store raw
  `SEG_POLYARC`-stripped meta and re-run `markPolylineArcs` at load
  (recomputable — it's pure on segs+meta), OR record
  `geometry.source` version and have the bench warn on mismatch.
  **Recommend the first**: strip `SEG_CURVE|SEG_POLYARC` bits that
  `markPolylineArcs` added (identifiable via `SEG_POLYARC`), keep bezier
  `SEG_CURVE`, re-mark at load. Costs ~0.3 s/case, keeps fixtures live
  against classifier evolution. (`CURVE_STEPS` bezier tessellation is
  upstream of segs and NOT recomputable — a bezier-sampling change will
  genuinely orphan pinned cases, same as today with pinned goldens;
  acceptable, note it in the case's `note`.)
- Repo weight: MB-scale corpus files; fine for a handful, revisit
  (`.json.gz` / LFS / out-of-repo sealed storage) beyond ~10 real plans.
- Open: should sealed cases be segments-only BY DEFAULT? Recommend yes —
  the sealed protocol's whole point is that nobody looks at the plan.

---

## 4. Style fingerprint + per-project engine profile

> **Annotated 2026-07-28 (round 9 measurement).** The per-project pitch cap is
> a **real, measured knob**, not a speculative one — and its window is narrow
> enough that this section's never-auto-apply guard rails are load-bearing.
> `partition-bank-15in` recovers **IoU 0.197 → 0.937** at a cap of 1.0–1.1 ft,
> while `tile-grid-room` (16" module) collapses **0.992 → 0.002** below
> 1.333 ft and the 12" module dies below 1.0 ft. A third-of-a-foot window with
> a vertical cliff either side. Round 8's "not fixable by caps" therefore holds
> for a **global** cap only. `annotation-ring-room` is cap-invariant at 0.650
> across the whole sweep — independent confirmation it needs semantics, not a
> knob.

### (a) Feasibility — verified; most signals are already computed

Every round-8 style failure maps to a computable per-sheet statistic:

| round-8 failure (issue #184 known-fails) | fingerprint signal | where it's computable today |
|---|---|---|
| `partition-bank-15in` — real partitions at sub-cap pitch classify as lattice | count/extent of periodic families with pitch in the 0.8–1.33 ft band | `classifyHatchSegs` builds exactly these families: angle clusters (`oneclick.ts:489-505`), rows+pitches (519-543); today it returns only the per-seg `soft` bitmap |
| `tile-demising-same-pen` — same-pen exports lose the pen-membership guard | pen-width histogram entropy (meta high nibble, `oneclick.ts:115`, populated at 247-248) — "everything hairline" = degenerate histogram | trivial pass over `meta` |
| annotation rings bound the flood | hairline-ring statistic (closed rectangles of hairline pen inset from heavier linework) — expensive, see risks | NOT computed anywhere; new geometry pass |
| polyline-arc doors (round 7: "arcs even classify as hatch") | arc counts + radii distribution; dashed-arc fraction | `markPolylineArcs` marks (returns only a count, `oneclick.ts:303-331`); radii live inside `circleFitOk` (419-424), not surfaced |
| scan wrappers / mixed sheets | `imageFrac`, `segCount` | already per-sheet: `sheetStatsRef` (`TakeoffCanvas.jsx:1203`) |
| scale-unknown coarse-cap exposure (3-ft stalls at 24 mask px) | `mppf` known/unknown, `scale_source` | `MaskObj.mppf` (`oneclick.ts:36`), `scaleSources` in payload |

The sensitivity knob generalizes cleanly: `escalationParams(sensitivity)`
(`oneclick.ts:155-161`) is already the interpolation seam, and
`floodRegionSealed`'s full parameterization is
`(sensitivity, radii, wedgeCapPx, minPassPx)` (`oneclick.ts:1082`) with
the scale-derived helpers `sealRadiiFor` / `doorWedgeCapPx` /
`minPassRadiusFor` and the pitch cap entering via `buildMask`'s
`pitchCapPx` (`oneclick.ts:627`).

**Finding**: today's knob is per-BROWSER, not per-project —
`localStorage.opentakeoff_fill_sens` (`TakeoffCanvas.jsx:423-426`). An
estimator working two stylistically different plans shares one setting;
the payload carries `fill_sensitivity` per shape only as an audit record.

### (b) Design

**Part 1 — `sheetFingerprint` (engine module, pure).** Refactor
`classifyHatchSegs` to optionally emit family statistics (additive return
or a sibling entry point sharing the internals — the angle-cluster/row
machinery is the expensive part and already exists; issue #184 measured
classify+arcs at ~285 ms once per VA-sized sheet, cached):

```ts
interface SheetFingerprint {
  schema: "opentakeoff.sheet_fingerprint.v1";
  seg_count: number;
  image_frac: number;                    // from sheetStats
  pen_hist: number[16];                  // meta high-nibble counts
  pen_entropy: number;                   // degenerate ⇒ same-pen export style
  curve_frac: number;                    // bezier SEG_CURVE fraction
  arcs: { count: number; dashed_count: number;
          radii_ft: { p25: number; p50: number; p75: number } };  // door-swing prior
  hatch: {
    soft_frac: number;                   // softCount / segCount
    families: Array<{ angle_deg: number; pitch_ft: number;
                      members: number; extent_ft: number }>;  // top N by members
    subcap_room_scale: number;           // members in pitch ∈ [0.8, HATCH_MAX_PITCH_FT] ft
  };                                     //   — the partition-bank hazard band
  scale_known: boolean;
}
```

Computed where the canvas already extracts geometry
(`TakeoffCanvas.jsx:1195-1203`), cached beside `sheetStatsRef`;
recomputable, so **not persisted** in the payload (a cache, like masks).
The bench computes the same fingerprint per corpus case, so corpus
results become style-conditioned: correction/failure rates per
fingerprint cluster (§1's metric sliced by ④) tell us empirically which
statistics predict which failures — that, not hand-tuning, is how the
suggestion table below earns its rules.

**Part 2 — `EngineProfile` (serializable, per project).**

```ts
interface EngineProfile {
  schema: "opentakeoff.engine_profile.v1";
  fill_sensitivity?: number;             // 0..1 — the existing knob
  hatch_max_pitch_ft?: number;           // default HATCH_MAX_PITCH_FT (4/3)
  min_pass_ft?: number;                  // default MIN_PASS_FT (0.5)
  door_seal_max_ft?: number;             // default DOOR_SEAL_MAX_FT (5)
  provenance?: { set_by: "estimator" | "suggested";
                 basis?: string };       // fingerprint rule that suggested it
}
```

Deliberately *small*: only knobs that are (i) already scale-true
constants with documented semantics and (ii) style-dependent per the
evidence. Everything else (wedge slack, arc thresholds, TINY_SF…) stays a
constant until a failure mode demands otherwise — the round-8 lesson is
that every knob must be earned. Threading: an optional `profile` argument
resolving through a single `profileParams(profile?)` helper in
`oneclick.ts` that yields `{sensitivity, pitchCapFt, minPassFt,
doorSealMaxFt}` with today's constants as defaults; the canvas passes it
at the six flood sites + `buildMask` (mask cache keyed by the
pitch-relevant fields, same eviction discipline as recalibration —
round-7 comment). Persistence: additive, diff-only payload key
`engine_profile` (omit when all-default — the `sheet_levels` convention,
`TakeoffCanvas.jsx:1417-1420`), so old payloads round-trip byte-identical.
`localStorage.opentakeoff_fill_sens` remains the anonymous-project
fallback seed.

**Fingerprint → profile suggestions** (fork UX, conservative):

| fingerprint | suggestion (never auto-applied) |
|---|---|
| `subcap_room_scale` high (many room-scale periodic members) | lower `hatch_max_pitch_ft` toward 0.8–1.0 ft ("this plan has partition banks / wide tile — keep room-scale rhythm hard") |
| `pen_entropy` ≈ 0 (same-pen export) | `fill_sensitivity` → Strict ("pen widths carry no information here") |
| `arcs.count` = 0 on a plan with doors | warn: doors won't unify; sealing still applies |
| `image_frac` high | scan path notice (raster; sensitivity inert — `TakeoffCanvas.jsx:3004-3007`) |
| `scale_known` false | calibrate-first nudge (existing open item: the 24-mask-px cap exposure) |

Suggestions surface once per sheet-group in the existing readout/commit
message channel; applying = writing the profile with
`provenance.set_by = "suggested"`. §1's correction rate per profile state
then validates whether suggestions actually reduce corrections — the
closed loop.

### (c) Privacy / consent

- Fingerprints are aggregate statistics — no geometry, no text, no
  coordinates. Safe in exports; safe (and valuable) as an *additive*
  contribution envelope field (spec §6) so the open corpus can be
  style-stratified without any plan content. Register it in the spec
  before shipping on the wire.
- One nuance: a distinctive fingerprint (exact pitch set + pen histogram)
  is a weak *firm* identifier — the drafting standard's signature. Fine
  locally; on the contribution wire, quantize (pitch to 0.05 ft, extents
  to bands) and say so in the spec row.
- The profile is user preference data, stays in the project payload.

### (d) Classification

- `sheetFingerprint` + `classifyHatchSegs` stats refactor +
  `markPolylineArcs` radius surfacing + `EngineProfile`/`profileParams`
  threading in `oneclick.ts`: **upstream-slice material** (engine +
  engine-adjacent, no fork imports; profile-as-argument is exactly the
  "single knob" generalization the sensitivity slider already
  established). Flag `hatch_max_pitch_ft` overrides as measurement-policy
  review point #5 (a profile changes what "hatch" means per project).
- Suggestion UX, persistence in the payload, per-project storage: **fork
  extension** (like the sensitivity slider UI already is).
- Bench fingerprinting of corpus cases: upstream-slice (item E).

### (e) Effort & sequencing

Largest of the four. Fingerprint function + stats refactor ≈ 1-2 sessions
(the classifier refactor must keep the bench bit-identical — the stats
emission must be observationally pure; regression-test by re-running the
full bench). Profile type + threading + cache eviction ≈ 1 session.
Suggestion UX ≈ 1 session. **Build last** — its payoff (which styles need
which profile) is only measurable once §1's correction metric and a
multi-style corpus (§3-enabled) exist. Exception worth pulling forward:
the *fingerprint alone* on bench cases is cheap and immediately useful
for organizing incoming answer-key plans ("different firms > more
sheets" — round-8 answer-key comment).

### (f) Risks / open questions

- **Profile vs determinism**: a per-project pitch cap means the same
  linework classifies differently in two projects — by design, but it
  breaks "a property of the DRAWING" (`oneclick.ts:624-626`). Provenance
  must ride every trace made under a non-default profile (extend
  `origin.fill_sensitivity` precedent: `origin.engine_profile` hash or
  the diff), or corrections/goldens become non-replayable. §1's loader
  `sens` field generalizes to a per-probe `profile`.
- **Suggestion feedback loops**: a bad suggestion accepted once persists
  in the payload and silently degrades every later click. Mitigations:
  `provenance.set_by`, easy reset-to-default in the UI, and §1's metric
  as the watchdog.
- **Annotation-ring detection** is the one round-8 failure without a
  cheap statistic; a ring detector is real geometry work adjacent to
  "annotation semantics" (open item) — leave it OUT of fingerprint v1,
  note it as the known gap.
- Open: is the profile per-project or per-sheet-group? Plans mixing
  disciplines (arch + demo sheets) argue per-group; start per-project
  (matches payload scoping), revisit with evidence.

---

## 5. Recommended build order & effort summary

> **Superseded 2026-07-28.** Round 9 measured the prerequisites and reordered:
> callout cross-check harness → operator's measured plans → `detectRegions`
> sealed parity → item-F detection metrics → item F. The audit then added a
> Phase 0 ahead of all of it (CI gates, the re-pin protocol, and bench↔production
> parity). See `docs/audit/ISSUE_184_REMEDIATION_PLAN.md` on
> `claude/opentakeoff-184-audit-g37o2u`. Note §1's premise is also weaker than
> written: the answer-key protocol has the operator measure with the normal
> drawing tools while `extractCase` refuses machine shapes, so the measuring
> campaign produces **no correction pairs** — §1 needs ordinary One-Click
> estimating days that have not happened yet.

| # | foundation | effort | depends on | why this order |
|---|---|---|---|---|
| 1 | correction-pair harvest (§1) | ~1 session | nothing — data already persisted | retroactively activates all past+future estimator work; feeds ②④ |
| 2 | confidence outcome log (§2) | ~2 sessions | vocabulary from ① | data only accrues after it ships — ship early, analyze later |
| 3 | segments-only fixtures (§3) | ~1 session | nothing (fidelity already proven) | unblocks the external answer-key plan campaign; carrier for ①'s fixtures |
| 4 | fingerprint + profile (§4) | ~3-4 sessions | ① for validation, ③ for a multi-style corpus | biggest engine surface; payoff needs the others' data |

Cross-cutting prerequisites to schedule alongside:
- contribution whitelist + spec §5 additions (confidence, seal/wedge
  fields; §1 finding 2) — ½ session, fork;
- `bench/run.mts` per-probe `sens`→`profile` replay field — folded into ①/④.

## 6. Cross-cutting risks

- **Gates**: every item above except §2's canvas wiring is bench/tooling;
  nothing touches flood/classify behavior until §4's threading, which
  must land behind all-default profiles (bit-identical bench) with the
  profile as pure parameterization.
- **Slice hygiene**: keep new bench files importing only
  `oneclick`/`confidence`/`geometry`/`score` (audit list,
  `docs/UPSTREAM_CONTRIBUTION_SLICE.md:71-80`); the logger and profile
  UX live canvas-side only.
- **The spec is load-bearing**: two of the four designs (①'s wire, ②'s
  boundary) lean on `CONTRIBUTION_SPEC.md` being kept true — any
  whitelist or envelope change lands in code and spec in the same commit,
  per the spec's own contract.
