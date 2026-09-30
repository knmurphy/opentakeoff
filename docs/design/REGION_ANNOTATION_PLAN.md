# Region annotation — implementation plan, piece 2a: title block vs drawing area (vector)

Design: [REGION_ANNOTATION.md](REGION_ANNOTATION.md). Piece 1 (the region map
module, `web/src/lib/regions.ts`) is done.

Status: **passed review** (revision 7; 7 rounds, 4 reviewers: algorithm on
real drawings, codebase feasibility, tests and measurement, design). Fork
only. A reviewer's re-implementation of rule A alone on the in-sample real
sheets placed every title block on the correct edge (Shreveport 24/24,
Dublin parts 1 and 4 24/24, committed sheets 5/5); that is in-sample and not
a result of this plan's code.

## Scope

Piece 2 is split:

- **2a (this plan):** detect the title block and drawing area on vector sheets
  (text layer + vector lines), group sheets by title block, corrections tied
  to a title-block signature, a real-set evaluation, and one end-to-end use:
  MCP `find_text` hits carry a `sheet_region`.
- **2b (next plan):** raster long-line extraction, the raster line-path test,
  and OCR tokens once the OCR branch is merged. Until 2b, nothing claims
  vector/raster parity.

Also moved out of 2a, to the pieces that need them: moving the existing
lower-right and 6% guesses onto the map (after 2a is measured on real sets),
the correction UI, title-block parts, detail viewports, cover-sheet handling.
The design doc's piece list is updated to match.

## Changes to piece 1 first (task 0)

Found in review:

1. **Group signature; ids derived from it.** `SheetRegions` gets `border`
   (the border box) and `group_sig`: edge, d (from the border), aspect
   bucket, page size in inches when known, and the group's static strings.
   The group id is `g:` + a short hash of the signature + a disambiguator:
   clusters with equal signatures (e.g. two statics-free singletons with the
   same geometry) are ordered by their smallest member sheet key and get
   `-1`, `-2`, …. Ids are unique within a map (tested). Ids are handles
   only: they may change whenever the signature or membership does, and
   nothing relies on them staying the same. Clusters with equal signatures
   are exactly the ambiguous case `matchGroup` refuses, so a template never
   picks between them.
   Stored static strings are capped: at most 20 distinctive strings (longest
   first, then lexicographic, so the choice is deterministic), each at most
   80 characters; the sanitizers enforce it. The bench records how the cap
   changes Jaccard on the tune set. (No "sticky" ids: the previous map is dropped in
   exactly the cases where ids change, so stickiness can't be built.)
2. **Templates are matched by signature on every apply.** A template in
   `RegionOverrides.groups[g]` gains `group_sig` (the signature it was made
   for). `sanitizeRegionOverrides` sanitizes it; a template without one
   (none exist yet) is kept but never applied. On every apply, a template
   is resolved to a group by `matchGroup(template.group_sig, groups)`:
   - same edge and aspect bucket, |Δd| ≤ 1.5%, same page size when both
     know it;
   - when both have static strings: the best static-string Jaccard ≥ 0.5,
     and it beats the second-best group by ≥ 0.2;
   - a template **with** static strings never matches a statics-free
     group; a template **without** static strings (made on a cover or
     sketch) matches only a statics-free group, and only with a second
     anchor: its `source_sheet` is a member (at most one group can
     contain it), or the page size in inches is known on both and equal
     **and exactly one** statics-free group passes the geometric and
     page-size test; more than one → `ambiguous`, not applied. Page size
     unknown on either side → not applied. (Otherwise removing a cover could send its correction to the
     main architect group, which shares its geometry.) Tests: cover
     removed; cover replaced by an architect group; two statics-free
     same-size singletons (e.g. two letter-size sketches) with a
     page-size-anchored template → `ambiguous`;
   - otherwise: not applied, reported as unattached.
   The id `g` is only a hint: a template whose id exists but whose
   signature no longer matches that group is **not** applied to it.
   The match score is the static-string Jaccard. Within `matchGroup` the
   0.2 margin already refuses near-ties. The |Δd| tie-break applies only
   when two **templates** compete for one group. Two templates resolving to
   the same group: the higher score wins; an ambiguous tie applies neither
   and reports both.
   `sheet_group` changes shape from `Record<key, string>` to
   `Record<key, { group: string; sig: GroupSig }>`, where `sig` is the
   **target** group's signature at the time of the move, resolved with
   `matchGroup` unchanged; a move that fails to resolve leaves the sheet in
   its detected group and is listed in `unattached` (piece 3's UI must show
   it); `groupOf` calls the resolver instead of reading the string. The old
   string form is dropped by the sanitizer (no documents use it yet).
   Resolution is pure. Its output type is fixed in task 0, since the web app
   and the MCP both consume it:
   ```ts
   interface ResolvedOverrides {
     templates: Record<string /*template key*/, { group: string; score: number }>;
     moves: Record<string /*sheet key*/, string /*group id*/>;
     unattached: { kind: "template" | "move"; key: string; reason: "no-match" | "ambiguous" | "no-sig" | "no-anchor" | "conflict" }[];
   }
   resolveOverrides(map: Map<string, SheetRegions>, ov: RegionOverrides): ResolvedOverrides
   ```
   `applyOverrides` uses it and never writes. The web app may save the
   refreshed ids to the takeoff document; the MCP uses them in memory only.
   Tests: one-string reissue (still matches), added sheets changing the
   statics (still matches), two groups sharing boilerplate (tie → not
   applied), id present but signature changed (not applied), statics-free
   template with one vs two same-size statics-free groups, two templates on
   one group, ids in a map are unique, and each `unattached` reason
   (`no-match`, `ambiguous`, `no-sig`, `no-anchor`, `conflict`) produced by
   at least one test.
   Intentional: a statics-free template whose `source_sheet` now belongs to
   a group with statics (the cover gained a shared title block) is not
   applied and is reported. Do not relax this.
3. **Drawing area after a template.** `applyOverrides` rebuilds
   `drawing_area` as the sheet's `border` box minus the template's strip
   (the strip's edge is the border side it touches), replacing the detected
   one; children are then clipped by `cleanRegions`. A map without `border`
   (none exist yet) uses the full sheet. Tests: template on the same edge
   with a different d; template on a different edge (the old strip's area
   returns to the drawing area).
4. **Clamping.** `cleanRegions(raw, dims?)` gains an optional `{w, h}`;
   top-level regions are clamped to `[0,w]×[0,h]`. Every caller that has a
   `SheetRegions` passes it; a test covers the no-dims case.
   `group_sig` and `border` get their own sanitizers in `sanitizeRegionMap`.

Detector-version policy: a bump drops the cached map and may change ids.
Corrections still resolve by signature (rule 2), and any that no longer
resolve are reported, never silently applied elsewhere.

## Inputs (source-neutral)

New pure module `web/src/lib/regionDetect.ts`:

```ts
interface DetectToken { str: string; x: number; y: number; w?: number; h: number; rot?: number }
interface DetectLine  { x0: number; y0: number; x1: number; y1: number } // axis-aligned
interface DetectSheet {
  key: string;                 // sheetKey.ts convention
  w: number; h: number;        // image px at RENDER_SCALE, displayed orientation
  pageIn?: [number, number];   // page size in inches, when known
  tokens: DetectToken[];
  lines: DetectLine[];
  source: "vector" | "ocr";    // copied onto regions, never used for decisions
}
interface DetectDiag {         // per sheet; recomputed, not persisted
  border: Bbox | null; edge: Edge | null; d: number | null;
  candidates: { edge: Edge; d: number; frame: boolean; chainCover: number; tokens: number; density: number; sheetno: boolean; sheetnoPos: [number, number] | null; repeat: boolean; accepted: boolean; reason: string }[];
  staticIdx: number[]; fieldIdx: number[];   // token indices, for piece 4 (title-block parts)
}

detectSetRegions(sheets: DetectSheet[]): { regions: Map<string, SheetRegions>; diag: Map<string, DetectDiag> }
```

`diag` is returned so later pieces (title-block parts need static vs field
tokens; detail viewports need lines) don't redo the work. It is not
persisted; recomputing needs the set's tokens and lines again, which the MCP
already loads per sheet.

The detector has its own sheet-number pattern,
`TB_SHEETNO_RE = /^[A-Z]{1,3}\d?[-. ]?\d{1,3}(\.\d{1,2})?[A-Z]?$/`
(a digit may follow the letters: `A1-101`). `sheets.ts` `SHEET_NO_RE` and `extractSheetNumber` are not
touched in 2a.

## Algorithm

All distances are fractions of the sheet dimension perpendicular to the edge
in question, measured **from the border**, not the page edge.

### Step 1 — border

Rules are first de-duplicated: parallel rules within 1% of each other merge
(Dublin draws a cell line 3 px inside its border). Rules within 1% of the
page edge are ignored (Dublin and the sample plan have page-edge rules
outside the real border). The border is then the outermost rule per side
with span ≥ 75% of that side, within 8% of the page edge. (90% missed
Porterville, whose top and bottom border rules span 83%: they stop at the
title strip.) Measured: 1.5–5.6%
(Porterville's left border 5.6%, Dublin 3.5%). A side with no such rule uses
the page edge. Border rules never count as strip boundaries.

### Step 2 — strip candidates per edge

A boundary candidate is a **chain**: collinear rule segments parallel to the
edge, joined when the gap between them is ≤ 0.5% of the border length.
(Title blocks draw their inner edge as a row of cell tops: Dublin's is a
chain from x=0.25 to the border, 77% of the width, with no rule over the
left revision cell.) A chain is a candidate when:

- its depth d from the border is between 6% and 30% (measured real strips,
  from the border: 9.0–18.5%; Porterville has a notes-column rule at 29.4%,
  so candidates near the cap are logged);
- it covers ≥ 70% of the border length and touches the border at one end
  or both. "Touches" means it ends within 1% of a border rule or of the
  page edge where no border rule was found (Porterville's 0.889 rule ends
  on the top and bottom border rules, not the page edge);
- its free end (if any) does not end at a rule that fails to reach the
  border. Dublin's chain ends on a cell divider that runs down to the
  border, and is kept. (An earlier "within 4% of another candidate chain"
  rule was dropped: on Dublin part 4 p9/p10 it threw out the real bottom
  title block, whose free end sits 2.5% from a grid column rule. The
  extent-bounded strip below already rejects side legend columns.)

The candidate **strip** for acceptance is bounded along the edge by the
chain's own extent (border end to free end), not by the full border.
Shreveport's right legend column (depth 10%, 87% of the height) ends at
y=0.848; the sheet number at y=0.94 lies outside its extent, so it has no
`sheetno` (see step 4). The accepted title-block region is still output
border to border along its edge (step 6), matching the label definition.

Per edge, candidates are tried from the **smallest d outward**; the first one
that passes the acceptance rule wins. (Porterville: 0.889 is the title strip,
0.722 a notes column; the narrower is tried first.)

Without any chain on an edge (borderless title block), a candidate comes
from repetition (step 3) only.

### Step 3 — repetition across the set

Token **centers** normalized to the border box. A token is static if the same
normalized text is within 2% (per axis) of the same position on ≥ 50% of the
sheets considered (minimum 3). A fixed position whose text changes on ≥ 50%
of sheets is a field. A **candidate group** is a cluster of sheets with the
same aspect bucket and edge and d within 1.5% (geometry only, computed
before static strings). When there are **two or more** candidate groups,
strings static in every one of them (e.g. an agency form number such as
"VA FORM 08-6231") are not distinctive and are left out of grouping. With
one candidate group (a uniform set, like Shreveport's 24 sheets), all static
strings are kept; otherwise every sheet would end up alone.

The repetition band for an edge: the box of static + field tokens within 32%
of that edge. A candidate is `repeat: true` when the band lies inside the
candidate strip and covers ≥ 50% of its length.

### Step 4 — acceptance rule (decides title block vs abstain)

Text density does **not** decide acceptance. Measured on real strips it
ranges 0.34–8.5 (strip ÷ rest of sheet), and a false strip on a detail-grid
sheet (Dublin part 4 p10, S501: 0.82) sits above real sample-plan strips
(0.34–0.49), so no threshold separates them. Density is kept as evidence
and as a tie-break only.

Every candidate strip must hold at least 15 tokens (`MIN_STRIP_TOKENS`;
every real strip measured has ≥ 58). Then it is accepted if **any** of:

- A: `frame` and `sheetno`;
- B: `frame` and `repeat`;
- C: `repeat` and `sheetno`.

`sheetno`: the largest (by glyph height) `TB_SHEETNO_RE` token in the strip
(within the chain's extent) has its center in the strip's **far-end half**
along the edge (table below)
**and** in the **outer 60%** of the strip's depth (nearest the border).
Real sheet numbers sit in the outer corner (Shreveport C-100 at 31% of the
depth from the outer edge; Dublin and Shreveport at y≈0.94). The S501 detail
tag "B10" sits at 92% of the depth, next to the inner rule, and fails.
Per-page unit tests assert which token is picked on Shreveport, the sample
plan, Porterville (vertical "A1-101", via `rot`) and the rotated Dublin
pages in displayed orientation.

Far end (`farEnd()`, defined once in code, tested per edge):

| Strip | Far end along the edge | Outer part of the depth |
|---|---|---|
| right | lower half | right 60% |
| bottom | right half | lower 60% |
| left | lower half | left 60% |
| top | right half | upper 60% |

One signal alone never accepts. If no edge has an accepted candidate: no
title block; the drawing area is the border box, confidence 0.3.

Between edges with accepted candidates: the one satisfying more of A/B/C
wins; then the **smaller strip area** (chain extent along the edge × d,
both as fractions of the border box); then higher density. (Dublin part 1
p5 has a full-height rule at x=0.837 crossing the title block; its right
strip passes rule A with the same sheet number as the real bottom strip,
and loses on area: about 0.15 against 0.07, measured by a reviewer's
re-implementation; the code's `diag` output replaces these figures.) (No fixed edge order, no
weighted priors.)
Single sheets and 2-sheet sets have no `repeat`, so they are accepted only
through rule A; that is expected and measured.

Confidence is by rule, not a weighted score: A+B+C 0.95, two rules 0.85,
one rule 0.7. These are rule labels, not calibrated probabilities.
`evidence` lists the rules and signals that fired (`rule:A`, `frame-line`,
`sheet-number`, `repetition`, `text-density`). `diag` logs each
candidate's chain coverage, token count, density, strip area, the
sheet-number token's position (along and across the strip, as fractions),
and the free end's distance to the nearest other chain, so margins (Dublin's chain is
77% against a 70% floor) show up on held-out sets.

### Step 5 — grouping

Sheets with static strings: same aspect bucket (w/h to 0.02) and edge,
|Δd| ≤ 1.5%, Jaccard(statics, distinctive-only when ≥ 2 candidate groups)
≥ 0.5 → same group. Group ids come from the signature (task 0, rule 1).
A sheet **without** distinctive statics does not join a group by geometry
alone; it is its own group, unless the whole set has fewer than 3 sheets,
in which case sheets with the same page size in inches, edge and |Δd| ≤ 1.5%
share a group. Steps 3 and 5 iterate once (statics per aspect bucket →
cluster → statics per group).

### Step 6 — output

Regions via `regions.ts` types, validated by `cleanRegions`:

- `title_block`: the accepted strip, border to border along its edge.
- `drawing_area`: the border box minus the strip.
- `border` and `group_sig` are set on the `SheetRegions`.
- Tokens in the border margin fall in no region (`hitRegion` → null). That
  is correct: margin text is border numerals and grid labels.

Named constants at the top of the module; each comment names the data it was
calibrated on (task 6).

## Evaluation data

### Sets and what they may be used for

Public VA solicitations on SAM.gov (same source class as the committed
sheets, `evals/four-asks-2026-09-02/sheets/SOURCE.md`). All sets are from one
owner (VA); results say so.

| Data | Sheets | Status |
|---|---|---|
| Committed single sheets (Dublin A601, Shreveport C300, sample plan, Porterville, Roseburg) | 6 | **in-sample** — the rules above were designed by looking at them |
| Shreveport Fisher House, "Combined Drawings" (36C25625R0108) | 24 | **in-sample (tune)** — inspected by reviewers; constants fitted here |
| Dublin Bldg 9A, Drawings Parts 1 and 4 (36C77626R0031) | 24 | **in-sample** — inspected by reviewers in round 2 |
| Dublin Bldg 9A, Drawings Parts 2, 5, 7, 10, 11, 13 | 34 (7+10+7+4+5+1) | **held out** — downloaded and hashed 2026-09-30, not opened; parts 2, 5, 11 added before any labeling because 7, 10, 13 hold only 12 pages |

Held-out rules:

- Nobody (agent or human) opens held-out pages before the constants are
  frozen, except the labelers, who see renders only.
- The held-out evaluation runs **once** after the constants are frozen.
  Any re-run after a code change is logged in the bench output with the
  reason, and all runs are reported.
- Headline numbers come only from the held-out rows. In-sample rows are
  reported, labeled in-sample.
- A second owner's set (not VA) is wanted; until one is added, results
  claim VA sets only.
- Held-out Dublin parts 2, 5, 7, 10, 11, 13 are the same project, architect and
  title-block design as in-sample parts 1 and 4. If their labels show fewer
  than 2 families or fewer than 15 labeled drawing sheets, the docs call the
  held-out result a same-firm replication; generalization across firms is
  untested either way until a second firm's set is added. Pages without a
  text layer, or that are not drawings, are counted and excluded, and the
  counts are reported.
- `evals/regions/SOURCE.md` logs who opened which held-out pages and when
  (labelers only, before the run).

`evals/regions/fetch.mjs` downloads the sets by SAM.gov resource id and
checks sha256; a mismatch fails loudly (tested). `evals/regions/SOURCE.md`
records ids, hashes and dates. The PDFs are not committed; the evaluation
skips with a message when they are absent. **CI never runs it**: the
held-out numbers are reproducible by hand with the fetch script, not
CI-verified; the docs say so.

### Labels (answer keys)

- Definition: the title block is the strip between the border and the
  inner rule (or chain of cell rules) separating it from the drawing,
  including everything in that strip (vertical text included); the border
  margin is excluded. Stored per sheet as edge + d (normalized, from the
  border) + border box, or "none". Rotated pages are labeled in displayed
  orientation.
- Labeled for every sheet: title-block family (which firm's block), and
  "none" for sheets without a standard title block (cover, index).
- **Two agent labelers** in separate sessions, same renders, given only the
  renders and the definition, never detector output, measuring rules from
  pixel rows/columns.
- **Maintainer labels** a random subset of ≥ 8 sheets, including held-out
  ones, without seeing the agent labels or detector output. Agent-vs-
  maintainer spread is the noise floor. If the maintainer can't label, the
  results say "agent labels only; no human noise floor".
- Disagreements > 1% are resolved by the maintainer from the render, without
  detector output.
- **Labels are committed before any detector code** (task 2 before task 4).
  The evaluation checks that the label commit is an ancestor of the detector
  commit (`git merge-base --is-ancestor`). If not, or if it can't tell
  (shallow clone), the headline table prints "UNVERIFIED ORDER" instead of
  a pass rate (tested). `fetch.mjs` exports `verify(buffer, sha256)`, so the
  hash test needs no network.

### Synthetic sets (unit tests)

Built as `DetectSheet` objects in code by a seeded generator
(`web/test/fixtures/regionSynth.ts`), frozen in a commit before detector code:

- varied layout independent of the detector's features: random d in 8–25%,
  border 1–7%, page-edge rules outside the border, random edge, random
  token counts, text noise;
- decoys: legend/notes columns ending on the title-block chain, wide
  schedule tables, viewport frames, a top-edge full-width rule at 26% (Dublin
  part 4 style), sheet-number-like text inside the drawing, agency-form
  boilerplate shared across firms, double rules 3 px apart;
- partial frames: inner edge as a chain of cell tops covering 70–80%;
- sets: uniform one-firm set of 24 (must be 1 group); one firm bottom strip
  (5); mixed (3 + 2 different firms + 1 letter sketch → 3 groups); 2+2 small
  consultants with different bottom blocks (must not merge); single sheet;
  2-sheet set; no title block; borderless.

Results on synthetic sets are **self-consistency**, never accuracy.
Left/top edges are covered only here; the docs say so.

## Metrics (`web/bench/regions.mts`, script `bench:regions`, not in `check`)

Output file `web/bench/regions-results.json` (not `results.json`). Per set,
split into in-sample and held-out, with `n` on every row, commit, label
commit, fixture hashes, run log:

- edge correct (incl. "none" correct);
- |d error| median and max, in % of dimension;
- pass = edge correct and |d error| ≤ tolerance, where tolerance =
  max(2 × max(inter-agent spread, agent-vs-maintainer spread), 0.5%); the
  numeric value is printed. The 0.5% floor is one rule weight at typical
  render scale;
- abstain rate;
- false positives on labeled negatives; with n < 5 real negatives it is
  reported as 0/n with its 95% upper bound, not as a rate;
- grouping: n title-block families and n cross-family pairs in the labels;
  split rate (one family, several ids) and merge rate (two families, one
  id). With fewer than 3 real families the bench says "not statistically
  meaningful" and the docs make no grouping-accuracy claim;
- per acceptance rule / confidence tier: n and share correct. The tiers are
  rule labels, not calibrated probabilities; the docs say so;
- calibration (tune set only): for each constant, the swept range, the
  chosen value, and the range over which the tune result is unchanged; the
  held-out result is reported at the chosen value and at both ends of that
  range, in the one held-out run. The chosen values are committed before
  that run; range-end numbers are sensitivity only and never used to pick
  new values. A constant whose held-out result flips inside the range is
  documented in the design doc; it does not block the piece.
- the pass-bar tolerance is printed as a percentage and in pixels at the
  render scale used; bench header prints the sha256 of every PDF used.

## Tests (TDD)

Unit tests in `web/test/regionDetect.test.ts` over in-code `DetectSheet`s,
each with hand-computed expected values:

- border: outermost pair, 5.6% case, missing side;
- candidates: border-to-border rule, T-junction rejection, smallest-d-first,
  6–30% bounds;
- signals: density, sheetno position, repeat band, each independently;
- acceptance: each of A/B/C accepts; each single signal alone rejects;
- confidence tiers and evidence strings;
- statics/fields: centers, 2% tolerance, min 3 sheets, shared boilerplate
  excluded;
- grouping: all synthetic sets above, 2+2 not merged, ids unique within a
  map and deterministic from `group_sig` (same set in any order → same ids);
- acceptance negatives: a detail-grid sheet (frame rules on several edges,
  sheet-number-like detail tags next to the inner rule) → no false strip;
  a side legend column that stops short of the bottom title block → no
  `sheetno`; a full-height rule crossing the title block → the real strip
  wins on area;
  each rule A/B/C accepts; each single signal alone rejects; density alone
  never accepts; the real
  bottom title block wins over a false right strip on a single sheet;
- output passes `cleanRegions` unchanged; margin text → no region.

Adapter tests:

- web: new `extractPageTokens(textContent, viewport)` in `sheets.ts`
  returning `{str,x,y,w,h,rot}` (existing functions unchanged); tested on
  hand-built text items incl. 90° text.
- web: `longAxisLines(segs, w, h)` in `regionDetect.ts`: axis tolerance,
  collinear merge, 1-px duplicate dedupe.
- End-to-end on the committed sheets (MCP tests, which load PDFs):
  Porterville (border 75%, chain touching border rules, vertical sheet
  number) → right strip; Shreveport C300 → bottom strip, not the right
  legend column; Dublin A601 (/Rotate 90) → bottom strip.
- MCP (`mcp/test/`, which already loads PDFs): builds `DetectSheet`s from
  `textSpans` + `extractVectorGeometry` (as `ensureGeometry` does,
  `mcp/src/session.ts:1120`); checks displayed orientation on a /Rotate page
  (w/h swapped, Dublin A601) and that MCP sheet keys (`session.ts:795`)
  round-trip through `parseSheetKey` (`sheetKey.ts`).

## MCP use (task 9)

- Output field name: `sheet_region` (the input `region` already exists on
  `find_text`, `mcp/src/tools.ts:622`). Added to `findTextOutput`
  (`mcp/src/outputs.ts:657`), the tool description, `mcp/README.md`;
  `check:tool-count` and `check:wiki` run with `--write` if needed.
- Cache: a Session field holding one in-flight promise for the loaded set,
  keyed by the loaded files' paths, sizes and modification times (the MCP
  has no `builtAt`, so `setSignature` gets `builtAt` = mtime); cleared on
  `load_plan`. Concurrent first calls
  share the promise.
- Cost: measured on the 24-sheet sets (time and peak memory) and recorded.
  Default cap until measured: 60 sheets or 20 s; the measured values
  replace it. Past the cap, hits carry no
  `sheet_region` and the result says regions are unavailable. Sheets with
  no text layer yield no tokens and abstain.
- Corrections: when the loaded takeoff document carries region overrides,
  they are applied; in 2a nothing writes them yet.
- Check against ground truth (not only the sheet number, which rule A
  itself uses): on Dublin A601, a room-name hit returns
  `sheet_region.kind === "drawing_area"`; on a synthetic no-title-block
  sheet, hits carry `drawing_area` only. And: a `find_text` for a sheet's
  own number returns a hit with `sheet_region.kind === "title_block"`, on
  the committed Dublin A601 and Porterville sheets.

## Tasks (each: failing test → code → pass → commit)

0. Piece 1 changes, one commit per numbered item in "Changes to piece 1":
   signature and ids; resolveOverrides and the sheet_group shape;
   drawing-area rebuild; clamp and sanitizers.
1. `evals/regions/fetch.mjs` + SOURCE.md + sha test; synthetic generator
   frozen.
2. Labels: two blind agent labelers, maintainer subset, reconciliation,
   families and negatives; committed. **Needs the maintainer** for the
   subset and reconciliation.
3. `extractPageTokens`, `longAxisLines` (incl. dedupe and chain joining).
4. Border + candidates.
5. Signals + acceptance rule + confidence.
6. Statics/fields + grouping + signature ids; calibration sweep on the tune
   set only; constants frozen.
7. Output + `bench:regions`; the one held-out run.
8. MCP adapter + key round-trip test.
9. MCP `find_text` `sheet_region` (above).
10. Design doc status + measured numbers.

`npm run typecheck`, `npm run lint`, `npm test` (web) and the MCP test suite
pass after every task.
