# Region annotation — implementation plan, piece 2a: title block vs drawing area (vector)

Design: [REGION_ANNOTATION.md](REGION_ANNOTATION.md). Piece 1 (the region map
module, `web/src/lib/regions.ts`) is done.

Status: revision 4, after review round 3 (feasibility and measurement PASS; algorithm and design FAIL). Fork only.

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
   The group id is `g:` + a short hash of the signature. Ids are handles
   only: they may change whenever the signature does, and nothing relies on
   them staying the same. (No "sticky" ids: the previous map is dropped in
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
   - when either has no static strings (a cover or sketch, a singleton): it
     matches only if exactly one group passes the geometric test;
   - otherwise: not applied, reported as unattached.
   The id `g` is only a hint: a template whose id exists but whose
   signature no longer matches that group is **not** applied to it.
   Two templates resolving to the same group: the one with the higher score
   wins; a tie applies neither and reports both.
   `sheet_group` (manual moves) holds a signature too and resolves the same
   way.
   Resolution is pure: `resolveOverrides(map, overrides)` returns the
   resolved mapping (template → group id, plus unattached list).
   `applyOverrides` uses it and never writes. The web app may save the
   refreshed ids to the takeoff document; the MCP uses them in memory only.
   Tests: one-string reissue (still matches), added sheets changing the
   statics (still matches), two groups sharing boilerplate (tie → not
   applied), id present but signature changed (not applied), singleton with
   one vs two geometric candidates, two templates on one group, ids in a
   map are unique.
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
  candidates: { edge: Edge; d: number; frame: boolean; chainCover: number; tokens: number; density: number; sheetno: boolean; repeat: boolean; accepted: boolean; reason: string }[];
  staticIdx: number[]; fieldIdx: number[];   // token indices, for piece 4 (title-block parts)
}

detectSetRegions(sheets: DetectSheet[]): { regions: Map<string, SheetRegions>; diag: Map<string, DetectDiag> }
```

`diag` is returned so later pieces (title-block parts need static vs field
tokens; detail viewports need lines) don't redo the work. It is not
persisted; recomputing needs the set's tokens and lines again, which the MCP
already loads per sheet.

The detector has its own sheet-number pattern, `TB_SHEETNO_RE` (accepts
`A1-101`). `sheets.ts` `SHEET_NO_RE` and `extractSheetNumber` are not
touched in 2a.

## Algorithm

All distances are fractions of the sheet dimension perpendicular to the edge
in question, measured **from the border**, not the page edge.

### Step 1 — border

Rules are first de-duplicated: parallel rules within 1% of each other merge
(Dublin draws a cell line 3 px inside its border). Rules within 1% of the
page edge are ignored (Dublin and the sample plan have page-edge rules
outside the real border). The border is then the outermost rule per side
with span ≥ 90% of that side, within 8% of the page edge. Measured: 1.5–5.6%
(Porterville's left border 5.6%, Dublin 3.5%). A side with no such rule uses
the page edge. Border rules never count as strip boundaries.

### Step 2 — strip candidates per edge

A boundary candidate is a **chain**: collinear rule segments parallel to the
edge, joined when the gap between them is ≤ 0.5% of the border length.
(Title blocks draw their inner edge as a row of cell tops: Dublin's is a
chain from x=0.25 to the border, 77% of the width, with no rule over the
left revision cell.) A chain is a candidate when:

- its depth d from the border is between 6% and 30% (measured real strips,
  from the border: 9.0–18.5%);
- it covers ≥ 70% of the border length and touches the border at one end
  or both;
- its free end (if any) does not stop on another edge's candidate chain.
  Shreveport's right legend column (88% of the height) stops on the bottom
  title-block chain and is rejected; Dublin's chain stops on a short cell
  divider, which is not a candidate, and is kept.

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

Every candidate strip must first hold at least 15 tokens (`MIN_STRIP_TOKENS`;
title blocks are text-dense, detail-grid cells are not). Then it is accepted
if **any** of:

- A: `frame`, `sheetno` and `density ≥ 1.5`. `sheetno`: the largest (by
  glyph height) `TB_SHEETNO_RE` token in the strip lies in its far end
  (table below). Detail tags on a detail-grid sheet (Dublin part 4 p10,
  S501: "B10" in a top strip, frame rules at 26%) are small, sparse and
  fail the density and token floors;
- B: `frame` and `repeat`;
- C: `repeat` and `density ≥ 2.0`.

`density` = tokens per unit area in the strip ÷ in the rest of the border box.

Far end (`farEnd()`, defined once in code, tested per edge):

| Strip | Far end |
|---|---|
| right | lower half of the strip |
| bottom | right half of the strip |
| left | lower half of the strip |
| top | right half of the strip |

One signal alone never accepts. If no edge has an accepted candidate: no
title block; the drawing area is the border box, confidence 0.3.

Between edges with accepted candidates: the one satisfying more of A/B/C
wins; then higher density; then smaller d. (No fixed edge order, no
weighted priors.)

Confidence is by rule, not a weighted score: A+B+C 0.95, two rules 0.85,
one rule 0.7. These are rule labels, not calibrated probabilities.
`evidence` lists the rules and signals that fired (`rule:A`, `frame-line`,
`sheet-number`, `repetition`, `text-density`). `diag` logs each
candidate's chain coverage and token count, so margins (Dublin's chain is
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
| Dublin Bldg 9A, Drawings Parts 7, 10, 13 | page count recorded at fetch | **held out** — not downloaded or opened until the evaluation run |

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
- Held-out Dublin parts 7, 10, 13 are the same project, architect and
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
  sheet-number-like detail tags, sparse strips) → no false strip; the real
  bottom title block wins over a false right strip on a single sheet;
- output passes `cleanRegions` unchanged; margin text → no region.

Adapter tests:

- web: new `extractPageTokens(textContent, viewport)` in `sheets.ts`
  returning `{str,x,y,w,h,rot}` (existing functions unchanged); tested on
  hand-built text items incl. 90° text.
- web: `longAxisLines(segs, w, h)` in `regionDetect.ts`: axis tolerance,
  collinear merge, 1-px duplicate dedupe.
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

0. Piece 1 changes (border, group_sig, sticky ids, re-attach, drawing-area
   rebuild, clamp).
1. `evals/regions/fetch.mjs` + SOURCE.md + sha test; synthetic generator
   frozen.
2. Labels: two blind agent labelers, maintainer subset, reconciliation,
   families and negatives; committed. **Needs the maintainer** for the
   subset and reconciliation.
3. `extractPageTokens`, `longAxisLines` (incl. dedupe and chain joining).
4. Border + candidates.
5. Signals + acceptance rule + confidence.
6. Statics/fields + grouping + sticky ids; calibration sweep on the tune
   set only; constants frozen.
7. Output + `bench:regions`; the one held-out run.
8. MCP adapter + key round-trip test.
9. MCP `find_text` `sheet_region` (above).
10. Design doc status + measured numbers.

`npm run typecheck`, `npm run lint`, `npm test` (web) and the MCP test suite
pass after every task.
