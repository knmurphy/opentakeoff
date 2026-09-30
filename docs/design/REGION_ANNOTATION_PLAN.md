# Region annotation — implementation plan, piece 2a: title block vs drawing area (vector)

Design: [REGION_ANNOTATION.md](REGION_ANNOTATION.md). Piece 1 (the region map
module, `web/src/lib/regions.ts`) is done.

Status: revision 2, after review round 1 (4 reviewers, all FAIL). Fork only.

## Scope

Piece 2 is split:

- **2a (this plan):** detect the title block and drawing area on vector sheets
  (text layer + vector lines), group sheets by title block, stable group ids,
  a real-set evaluation, and one end-to-end use: MCP `find_text` hits carry a
  `region`.
- **2b (next plan):** raster long-line extraction, the raster line-path test,
  and OCR tokens once the OCR branch is merged. Until 2b, nothing claims
  vector/raster parity.

Also moved out of 2a, to the pieces that need them: moving the existing
lower-right and 6% guesses onto the map (after 2a is measured on real sets),
the correction UI, title-block parts, detail viewports, cover-sheet handling.
The design doc's piece list is updated to match.

## Changes to piece 1 first (task 0)

Found in review:

1. **Stable group ids.** A group id is a content hash, not "first sheet key":
   `g:` + short hash of (edge, d rounded to 1%, aspect bucket, the group's
   sorted distinctive static strings). Adding, removing or reordering sheets,
   or bumping the detector version, does not change it unless the title
   block itself changes.
2. **Re-attaching templates.** `SheetRegions` gets `group_sig`
   (edge, d, aspect bucket, distinctive static strings). A stored template
   keeps the `group_sig` it was made for. If its group id no longer exists,
   it re-attaches to the group with the same edge and the best string overlap
   (Jaccard ≥ 0.5). No match → the template stays stored and is reported as
   unattached, never applied to a guess.
3. **`applyOverrides` recomputes the drawing area** when a template replaces
   the title block: the detected drawing area is trimmed so it does not
   overlap the template's strip (trimmed on the side the strip touches). A
   test covers a template on a different edge than the detected one.
4. **Top-level regions are clamped to the sheet** `[0,w]×[0,h]` in
   `cleanRegions` when `w`/`h` are known.

Detector-version policy: a bump drops the cached map; group ids and stored
corrections survive because ids are content-derived.

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
  candidates: { edge: Edge; d: number; frame: boolean; density: number; sheetno: boolean; repeat: boolean; accepted: boolean; reason: string }[];
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

The border is the outermost pair of long rules per axis (span ≥ 90% of the
other axis) within 8% of each page edge. Measured on the real sheets: 1.5–5.6%
(Porterville's left border is 5.6%). A side with no such rule uses the page
edge. Border rules never count as strip boundaries.

### Step 2 — strip candidates per edge

For each edge, a candidate boundary is a rule parallel to the edge at depth d
from the border, where:

- d is between 6% and 30% (measured real strips: 11.1–18.5%);
- the rule runs **border to border**: both ends within 1% of the border (or
  ≥ 95% of the border-to-border length);
- the rule does not end on another candidate rule (a T-junction means it lies
  inside the drawing area — Shreveport's right legend column, x=0.886, and
  Roseburg's, x=0.763, end on the bottom title-block rule and are rejected).

Per edge, candidates are tried from the **smallest d outward**; the first one
that passes the acceptance rule wins. A wider strip that swallows notes
columns (Porterville: 0.889 real, 0.722 notes column) is only considered if
the narrower one fails.

Without any rule on an edge (borderless title block), a candidate comes from
repetition (step 3) only.

### Step 3 — repetition across the set

Token **centers** normalized to the border box. A token is static if the same
normalized text is within 2% (per axis) of the same position on ≥ 50% of the
sheets considered (minimum 3). A fixed position whose text changes on ≥ 50%
of sheets is a field. Strings that are static in **every** group (e.g. an
agency form number such as "VA FORM 08-6231") are not distinctive and are
left out of grouping.

The repetition band for an edge: the box of static + field tokens within 32%
of that edge. A candidate is `repeat: true` when the band lies inside the
candidate strip and covers ≥ 50% of its length.

### Step 4 — acceptance rule (decides title block vs abstain)

A candidate strip is accepted if **any** of:

- A: `frame` and `sheetno` (a `TB_SHEETNO_RE` token inside the strip, in its
  far-end third along the edge);
- B: `frame` and `repeat`;
- C: `repeat` and `density ≥ 2.0` (tokens per area in the strip ÷ in the rest).

One signal alone never accepts. If no edge has an accepted candidate: no
title block; the drawing area is the border box, confidence 0.3.

Between edges with accepted candidates: the one satisfying more of A/B/C
wins; ties go right, bottom, left, top. (No weighted priors.)

Confidence is by rule, not a weighted score: A+B+C 0.95, two rules 0.85,
one rule 0.7. `evidence` lists the rules and signals that fired
(`rule:A`, `frame-line`, `sheet-number`, `repetition`, `text-density`).

### Step 5 — grouping

Sheets with distinctive static strings: same aspect bucket (w/h to 0.02) and
edge, |Δd| ≤ 1.5%, Jaccard(distinctive statics) ≥ 0.5 → same group.
A sheet **without** distinctive statics does not join a group by geometry
alone; it is its own group, unless the whole set has fewer than 3 sheets,
in which case sheets with the same page size in inches, edge and |Δd| ≤ 1.5%
share a group. Steps 3 and 5 iterate once (statics per aspect bucket →
cluster → statics per group).

### Step 6 — output

Regions via `regions.ts` types, validated by `cleanRegions`:

- `title_block`: the accepted strip, border to border along its edge.
- `drawing_area`: the border box minus the strip.
- Tokens in the border margin fall in no region (`hitRegion` → null). That
  is correct: margin text is border numerals and grid labels.

Named constants at the top of the module; each comment names the data it was
calibrated on (task 6).

## Evaluation data

### Real sets (not committed; fetched)

Public VA solicitations on SAM.gov (same source class as the committed
sheets, `evals/four-asks-2026-09-02/sheets/SOURCE.md`):

| Set | Sheets | Role |
|---|---|---|
| Shreveport Fisher House, "Combined Drawings" (36C25625R0108) | 24 | **tune** |
| Dublin Bldg 9A, Drawings Parts 1 and 4 (36C77626R0031) | 24 | **held out** |

`evals/regions/fetch.mjs` downloads them by SAM.gov resource id and checks
sha256; `evals/regions/SOURCE.md` records ids, hashes and dates. The PDFs are
not committed; the evaluation skips (with a message) when they are absent.
The single committed sheets (Dublin A601, Shreveport C300, sample finish
plan, Porterville, Roseburg) are also held out.

### Labels (answer keys)

- Definition: the title block is the strip between the border and the
  inner rule that separates it from the drawing, including everything in
  that strip (vertical text included); the border margin is excluded.
  Stored as edge + d (normalized) per sheet, plus "none" when a sheet has no
  title block.
- **Two independent labelers** (separate agent sessions, each given only
  renders and the definition, never detector output), measuring the rule
  from pixel rows/columns. Disagreements > 1% are resolved by the maintainer
  from the render. Inter-labeler agreement is reported.
- **Labels are committed before any detector code** (task 2 before task 4).
  The evaluation prints the label files' commit, so the order is checkable.
- No tuning on held-out sets. Constants are fitted on Shreveport only.

### Synthetic sets (unit tests)

Built as `DetectSheet` objects in code by a seeded generator
(`web/test/fixtures/regionSynth.ts`), frozen in a commit before detector code:

- varied layout independent of the detector's features: random d in 8–25%,
  border 1–7%, random edge, random token counts, text noise;
- decoys: legend/notes columns ending in T-junctions, wide schedule tables,
  viewport frames, sheet-number-like text inside the drawing, agency-form
  boilerplate shared across firms;
- sets: one firm right strip (6 sheets); one firm bottom strip (5); mixed
  (3 + 2 different firms + 1 letter sketch → 3 groups); 2+2 small consultants
  with different bottom blocks (must not merge); single sheet; 2-sheet set;
  no title block; borderless.

Results on synthetic sets are reported as **self-consistency**, never as
accuracy. Left/top edges are covered only here; the docs say so.

### Negatives

Real sheets without a standard title block, if the tune/held-out sets have
any (cover or index sheets), are labeled "none". If there are fewer than 2,
the evaluation reports "real negatives: n" honestly, and synthetic negatives
cover the rest.

## Metrics (`web/bench/regions.mts`, script `bench:regions`, not in `check`)

Per set and overall, with `n` on every row, commit, fixture hashes:

- edge correct (incl. "none" correct);
- |d error| median and max, in % of dimension;
- pass = edge correct and |d error| ≤ max(2 × inter-labeler spread, 0.5%);
- abstain rate; false-positive rate (title block reported where the label
  says none);
- group check on real sets: sheets the labelers put in one title-block
  family (same firm block) share a group id; different families don't;
- reliability: share correct per confidence tier.

Headline numbers are the held-out rows.

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
- grouping: all synthetic sets above, 2+2 not merged, content-hash ids
  stable under reorder/add/remove;
- output passes `cleanRegions` unchanged; margin text → no region.

Adapter tests:

- web: new `extractPageTokens(textContent, viewport)` in `sheets.ts`
  returning `{str,x,y,w,h,rot}` (existing functions unchanged); tested on
  hand-built text items incl. 90° text.
- web: `longAxisLines(segs, w, h)` in `regionDetect.ts`: axis tolerance,
  collinear merge, 1-px duplicate dedupe.
- MCP (`mcp/test/`, which already loads PDFs): builds `DetectSheet`s from
  `textSpans` + `extractVectorGeometry`; checks displayed orientation on a
  /Rotate page (w/h swapped, Dublin A601) and that MCP sheet keys equal
  `sheetKey.ts` keys.

## Tasks (each: failing test → code → pass → commit)

0. Piece 1 changes (group_sig, re-attach, drawing-area recompute, clamp).
1. `evals/regions/fetch.mjs` + SOURCE.md; synthetic generator frozen.
2. Labels: two blind labelers, reconciliation, committed.
3. `extractPageTokens`, `longAxisLines`.
4. Border + candidates.
5. Signals + acceptance rule + confidence.
6. Statics/fields + grouping + content-hash ids; calibration sweep on the
   tune set only, chosen values and sensitivity recorded in the bench output.
7. Output + `bench:regions` with held-out numbers.
8. MCP adapter + key-parity test.
9. MCP `find_text`: optional `region` on each hit (computed for the loaded
   set on first use, cached per session). Tool description, generated tool
   index and wiki updated (`check:tool-count`, `check:wiki`).
10. Design doc status + measured numbers.

`npm run typecheck`, `npm run lint`, `npm test` (web) and the MCP test suite
pass after every task.
