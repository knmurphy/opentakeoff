# Region annotation — implementation plan, piece 2: title block vs drawing area

Design: [REGION_ANNOTATION.md](REGION_ANNOTATION.md). Piece 1 (the region map
module, `web/src/lib/regions.ts`) is done. This plan covers piece 2 only.

Status: draft, under review. Fork only.

## Goal

For every sheet in a plan set, produce a `SheetRegions` with:

- one `title_block` region (the strip along one edge), or none when the
  sheet has none we can find;
- one `drawing_area` region (the rest of the sheet, inside the border);
- a `group` id: sheets whose title blocks match share a group.

It must work the same on vector sheets and on raster sheets after OCR, and on
any of the four edges, in the displayed orientation.

Out of scope for this piece: parts of the title block (firm, sheet ID…),
detail viewports, schedules/notes, cover-sheet handling, wiring into search
/ MCP / the canvas, the correction UI. Those are later pieces.

## Inputs (source-neutral)

A new pure module `web/src/lib/regionDetect.ts`. It never checks where its
inputs came from.

```ts
interface DetectToken { str: string; x: number; y: number; w?: number; h: number; rot?: number }
interface DetectLine  { x0: number; y0: number; x1: number; y1: number } // axis-aligned, long
interface DetectSheet {
  key: string;
  w: number; h: number;            // image px at RENDER_SCALE, displayed orientation
  tokens: DetectToken[];
  lines: DetectLine[];             // may be empty (raster sheet without line extraction)
  source: "vector" | "ocr";        // copied onto regions, never used for decisions
}
detectSetRegions(sheets: DetectSheet[]): Map<string, SheetRegions>
```

Token convention: the existing `{str,x,y,h}` (x left, y baseline/bottom, y
down), plus optional `w` and `rot` (degrees clockwise, device space, as
`mcp/src/pdf.ts` `TextSpan.rot`).

### Adapters (thin, tested separately)

1. **Vector lines:** from `extractVectorGeometry` (`web/src/lib/oneclick.ts:403`)
   segments → keep axis-aligned segments (within 0.5°) longer than 15% of the
   sheet's shorter side; merge collinear pieces with gaps ≤ 0.5% of the side.
   New pure function `longAxisLines(segs, w, h)` in `regionDetect.ts`.
2. **Raster lines:** `rasterLongLines(gray: Uint8Array, w, h, opts)`: threshold,
   then horizontal and vertical run-length scan; a run ≥ 15% of the shorter
   side (with gaps ≤ 0.3% bridged) is a line; merge adjacent rows/columns
   into one line. Pure, no canvas.
3. **Vector tokens:** MCP already has `textSpans` with `rot`
   (`mcp/src/pdf.ts:261`). Web: add `rot` to `extractRegionText` tokens
   (`web/src/lib/sheets.ts:276`) as an optional field; existing callers
   ignore it.
4. **OCR tokens:** `OcrWord` → `DetectToken` (no `rot`; the OCR box is
   axis-aligned). Only on top of the OCR branch; see "Dependencies".

## Algorithm

### Step 1 — per-sheet edge scores

For each edge E in {right, bottom, left, top}, look for the strip boundary:
a line parallel to E at offset d from E, with d between 4% and 30% of the
sheet dimension perpendicular to E, spanning ≥ 70% of E's length.

Score each candidate strip [edge … d] from:

- `frame`: a qualifying line exists (1) or not (0);
- `density`: text tokens per unit area inside the strip ÷ in the rest of the
  sheet (title blocks are text-dense);
- `sheetno`: a token matching the sheet-number pattern (`SHEET_NO_RE`,
  widened to accept `A1-101`) lies in the strip, at the far end along the
  edge (bottom-right corner area for right/bottom strips);
- `prior`: right 1.0, bottom 0.9, left 0.3, top 0.2.

Without a frame line (raster sheet with no line extraction, or a borderless
title block), candidate offsets come from the token distribution instead: the
largest empty gutter parallel to E between the strip-shaped dense band and
the rest.

Per-sheet result: best edge, offset d, per-edge scores kept for step 3.

### Step 2 — repetition across the set

Normalize token positions to [0..1]. A token is **static** if the same
normalized text (upper-case, whitespace-collapsed) appears within 1% (of the
sheet's diagonal) of the same normalized position on ≥ 50% of sheets in its
group candidate (minimum 3 sheets). A token at a fixed position whose text
**changes** across sheets, on ≥ 50% of sheets, is a **field** (sheet number,
title, date).

The repetition band for an edge is the bounding box of static + field
tokens that lie within 35% of that edge. It adds a `repeat` score to that
edge's candidate and can supply d when no frame line exists.

Sets with fewer than 3 sheets skip step 2; per-sheet signals decide.

### Step 3 — grouping

Signature per sheet: aspect ratio (w/h, rounded to 0.02), chosen edge, d
(normalized), and the set of static-token strings from step 2.

Greedy clustering in sheet order: a sheet joins the first group with the same
aspect bucket and edge, |Δd| ≤ 1.5%, and Jaccard(static strings) ≥ 0.5 (when
both have static strings). Otherwise it starts a new group. Group id =
`g:<first sheet key>`.

Steps 2 and 3 iterate once: compute static tokens over all sheets with the
same aspect bucket, cluster, then recompute static tokens per group and
re-score.

### Step 4 — regions

- `title_block`: the strip [edge … d], confidence from combined score,
  evidence names each signal that fired (`frame-line`, `text-density`,
  `sheet-number`, `repetition`), `source` = the sheet's source.
- `drawing_area`: the sheet minus the strip, inset by the border when an
  outer border frame is found (a line within 4% of each edge), otherwise
  the whole remainder.
- No title block when the best combined score is below a threshold: emit only
  `drawing_area` covering the sheet (confidence low). Never guess.

Thresholds are named constants at the top of the module, each with a comment
saying where the value came from.

## Fixtures and tests (TDD)

Every step is written test-first.

### Synthetic sets (generated, deterministic)

A generator script `web/scripts/make-region-fixtures.mjs` (same pattern as
`mcp/scripts/make-sheetgraph-fixture.mjs`) writes small vector PDFs plus a
`.regions.json` answer key per page:

1. **right-strip set**, 5 sheets, ARCH D aspect, frame line, static firm and
   project text, changing sheet number/title.
2. **bottom-strip set**, 4 sheets, same idea along the bottom.
3. **mixed set**: 3 architect sheets (right strip) + 2 consultant sheets with
   a different title block (bottom strip) + 1 letter-size sketch sheet. Must
   produce 3 groups.
4. **rotated set**: the right-strip set with `/Rotate 90` on two pages (the
   displayed orientation must still yield a right strip).
5. **borderless**: title block with no frame line (text only).
6. **no title block**: a sheet with only drawing content.

Unit tests can also build `DetectSheet` objects directly in code (no PDF)
for the step-level tests; the PDFs are for the adapter and end-to-end tests.

### Real sheets (single sheets, hand-labeled answer keys)

- `evals/four-asks-2026-09-02/sheets/va-dublin-bldg9a-finish-plan-A601.pdf` (bottom, /Rotate 90)
- `evals/four-asks-2026-09-02/sheets/va-shreveport-fisher-house-site-utility-C300.pdf` (bottom)
- `web/public/demo/sample-finish-plan.pdf` (bottom; 2 pages — the only real multi-sheet case)
- `evals/mcp-workflow-bench/plan-set/porterville/porterville-adu-a1-101.pdf` (right, vertical text)

Answer keys: `web/test/fixtures/regions/<name>.regions.json` with the
title-block bbox labeled by hand from a render, normalized [0..1].

Roseburg (`va-roseburg-a03a.pdf`, no text layer) needs OCR tokens. It is
tested with lines only (raster line extraction) in this piece; its OCR
token fixture is recorded later, once the OCR branch is merged in.

### Scores

- Title-block IoU vs the answer key: pass ≥ 0.90 per sheet.
- Edge correct: 100% on fixtures.
- Groups: exact match on synthetic sets.
- Vector/raster parity: for each fixture, render the page to gray pixels
  (MCP `renderPng`, `@napi-rs/canvas`), run `rasterLongLines` + text-layer
  tokens, and require title-block IoU ≥ 0.95 against the vector run. This
  tests the line path; OCR-token parity comes with the OCR branch.

Results are written to `web/bench/regions.mts` output (same style as the
existing bench scripts) so numbers are reproducible.

### Known gap

There is no real multi-sheet set in the repo. The public VA sets these
sheets come from (SAM.gov, see `evals/four-asks-2026-09-02/sheets/SOURCE.md`)
are the obvious source for one; fetching and committing more sheets is a
decision for the maintainer, so this piece relies on synthetic sets for
repetition and grouping and says so.

## Dependencies

- Piece 1 (`regions.ts`) — done.
- The OCR engine branch (`feat/ocr-engine-469`) is based on current
  `main` and merges cleanly; it is needed only for OCR-token adapters and
  is not merged in this piece.
- The search branch (`claude/client-side-ocr-search-index-n699t0`) shares no
  history with current `main`; not needed for this piece.

## Tasks (each: failing test → code → pass → commit)

1. Token/line types; `longAxisLines` (vector segments → long lines).
2. `rasterLongLines` (gray pixels → long lines).
3. Step 1: edge candidates and per-sheet scores.
4. Step 2: static / field tokens across a set.
5. Step 3: grouping.
6. Step 4: region output via `regions.ts` types (validated by `cleanRegions`).
7. Fixture generator + synthetic answer keys; end-to-end tests.
8. Real-sheet answer keys; end-to-end tests on real sheets (node, pdf.js
   text + `extractVectorGeometry`).
9. Parity test (render → raster lines).
10. Bench script with the score table; update the design doc status.

`npm run typecheck`, `npm run lint` and `npm test` in `web/` pass after every
task.
