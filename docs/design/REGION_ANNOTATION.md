# Region-aware text: where on the sheet a hit came from

Status: draft on the fork. Not proposed upstream yet.

Built so far: the region map module (`web/src/lib/regions.ts`, tests in
`web/test/regions.test.ts`): types, lookup, storage rules and corrections.
Not yet wired into search, the MCP or the takeoff document, and no detector
yet.

## Problem

Search and the MCP text tools return a sheet and a position. They don't say
what part of the sheet the text is in. An estimator wants to know whether a
hit for "CPT-1" is in:

- detail 3, "Enlarged Toilet Plan", at 1/4" = 1'-0"
- the finish schedule
- general notes
- the title block (and which part: architect, project info, sheet ID)

Without that, a search for the project name or the architect matches every
sheet, and a hit in a keynote looks the same as a hit in the drawing.

The code already guesses regions in four separate places, each with its own
rule:

- The sheet number is read from the lower-right corner (`web/src/lib/sheets.ts:126`).
- Room detection treats the outer 6% of the sheet as title block and border
  (`sheetBounds`, `web/src/lib/detectRooms.ts:185`), and keeps a title-block
  word list to block fake room tags (`:73`). This came from the 847 SF "title
  block room" in #184.
- CAD layer names `TTLB`, `TITLEBLOCK`, `LEGEND` are recognized (`web/src/lib/layers.ts:42`).
- The sheet graph records a bounding box for each schedule table
  (`TablePart.region`, `web/src/lib/sheetgraph.ts:297`).

This feature replaces those guesses with one region map per sheet.

## Decisions so far

1. **"Exhibit" means detail viewports.** A sheet with several drawings on it,
   each with its own detail title. Detail viewports are the core of the
   feature, not a later phase.
2. **Three uses, one data source:** labels on search hits, search filters,
   and a `region` field on MCP `find_text` / `read_sheet_text` results.
3. **Automatic by default, user can correct.** A title-block correction
   applies to every sheet in the same detected title-block group (see
   "Title-block groups"). A detail-viewport correction applies to that sheet
   only.
4. **Vector and raster together.** The point of OCR is to remove the gap
   between the two. The detector must give the same regions on a raster
   sheet (after OCR) as on the vector original, within a tolerance.
5. **Everything is built on the fork first.** It gets cleaned up into an
   upstream issue and PR once it works.

## Region model

Regions nest:

```
sheet
├─ title block
│   ├─ firm            (architect, consultants; can be several)
│   ├─ project info    (name, address, owner, project no.)
│   ├─ sheet id        (number, title, date, scale)
│   ├─ revisions
│   ├─ seal / stamp
│   └─ key plan
└─ drawing area
    ├─ detail viewport (label from its detail title)
    ├─ schedule
    ├─ legend
    ├─ general notes / keynotes
    ├─ sheet index           (cover / G-series sheets)
    ├─ project directory     (cover; firm entries, same kind as title-block firm)
    ├─ code analysis / vicinity map / abbreviations / symbols legend
    └─ unclassified
```

Each region records:

| Field | Meaning |
|---|---|
| `id` | stable within the sheet |
| `kind` | from the tree above |
| `bbox` | image px at `RENDER_SCALE` in the displayed orientation (after /Rotate), the same frame as text tokens |
| `parent` | parent region id |
| `label` | e.g. `3 – ENLARGED TOILET PLAN`, with `detail_no`, `sheet_ref`, `scale` when read |
| `evidence` | which signals found it |
| `confidence` | 0..1 |
| `source` | `vector` \| `ocr` \| `layer` \| `user` |

"Unclassified" is a valid answer. The map never forces a guess, the same way
OCR text is always marked as OCR.

A hit gets the deepest region that contains its anchor, and a path such as
`A-501 › Detail 3 – Enlarged Toilet Plan` or
`A-101 › Title block › Project info`.

## Inputs: source-neutral

The detector reads only two things:

1. **Tokens:** positioned words `{str, x, y, h}` (plus `w` when present),
   plus a text direction `rot`. The text layer and on-device OCR (`OcrWord`,
   `web/src/lib/ocr/types.ts` on `feat/ocr-engine-469`) already share the
   base shape. Neither web path carries `rot` today: `sheets.ts` keeps only
   the anchor and glyph height, and `OcrWord` boxes are axis-aligned. The MCP
   already has it (`mcp/src/pdf.ts:240-256`).
2. **Line segments:** long horizontal and vertical lines.
   - Vector: from the page's operator list, which the One-Click path already reads.
   - Raster: new work. `rastermask.ts` builds a binary mask for flooding but
     does not extract line segments. A long-run line detector over that mask
     (or the OCR render) is needed.

The detector never checks which source a token or line came from. That is
what makes the vector/raster parity test meaningful.

## Detection signals

Most reliable first:

1. **Repetition across sheets.** The title block is the same on every sheet.
   Text at the same normalized position on most sheets is title block. Text
   that changes at a fixed position is a field (sheet number, title, date).
   Needs no model, and works on raster sheets once they have been OCR'd.
2. **User template and corrections.** See decision 3.
3. **CAD layer names**, when the PDF keeps its layers.
4. **Linework.** The title-block strip's frame lines. Viewport frames, when drawn.
5. **Detail titles.** A circled number over a sheet reference, a title, and a
   `SCALE:` line, usually under the drawing's lower-left corner.
6. **Keyword headers.** `GENERAL NOTES`, `KEYNOTES`, `LEGEND`, `KEY PLAN`,
   `REVISIONS`, schedule headers. Schedule extents come from the sheet
   graph's existing `TablePart.region`.
7. **Content inside the title block.** Address, phone, license number and
   firm name mark a firm block. A `PROJECT` label marks project info. The
   sheet-number pattern marks the sheet ID.

### Detail viewport extent

- Frame lines around the drawing, when present.
- Otherwise whitespace gutters between drawings, with each drawing assigned
  to its nearest detail title.
- Text between two drawings that can't be assigned stays in the drawing
  area as unclassified.

## Outputs

- **Search hits** carry `region` (kind, label, path).
- **Search filters:** only in details, only schedules, only notes, exclude
  title block.
- **MCP:** `find_text` and `read_sheet_text` return `region` per hit / per run.
- **Existing callers** (sheet number, scale, room-tag gate) read the map
  instead of their own guesses.

## Storage

Beside the plan index, not inside it. Two stores:

- **Detected map (derived cache).** IndexedDB meta store, key
  `regions:<project>` next to `planindex:<project>` (fork
  `TakeoffCanvas.jsx:1491`; the meta store has no keyPath, so no DB version
  bump, `web/src/lib/store.js:34`). Own schema `opentakeoff.region_map.v1`
  plus a detector version. Entries keyed by sheet key (`sheetKey.ts`).
  Invalidated by a signature of the whole set (sorted files + builtAt), not
  per file, because cross-sheet repetition makes every sheet depend on the
  set. Re-OCR rebuilds regions from the new tokens.
- **User corrections (user data).** A new additive key in the takeoff
  document, e.g. `region_overrides` (group templates + per-sheet viewport
  edits), next to `layer_overrides`, `sheet_levels` and `scale_source`
  (`web/src/lib/takeoffDocument.js:29-76`). That document is shared with the
  MCP (`mcp/src/session.ts:77`) and travels in `.otk` archives
  (`web/src/lib/projectArchive.js:9-21`).

Why not inside the index:

- The index is built once per sheet and dropped per file (fork
  `planIndex.ts:269-275`); regions need set-level invalidation.
- The index is a loss-tolerant cache: a schema mismatch drops everything
  (fork `planIndex.ts:305-322`). Corrections can't live there.
- The index keeps only term origins and 8 anchors per term; the detector
  needs full tokens and lines.
- The MCP never uses the index (`find_text` / `read_sheet_text` scan runs
  directly, `mcp/src/session.ts:5160-5193`). The detector is a pure module
  the MCP runs itself; it only needs the stored corrections.

The map at read time = detected map with overrides applied. Search hits look
up their anchor in the map at query time; `SheetIndex` doesn't change.

## Title-block groups

A template applies to a group of sheets whose title blocks actually match.
Page size and discipline prefix are hints only, never the key:

- Consultants hired by the architect usually use the architect's title
  block; owner-hired consultants don't
  ([4specs forum](https://forum.4specs.com/t/owners-consultants-specs-in-the-project-manual/1075)).
  One prefix can span two templates.
- Sizes differ by discipline (civil ANSI D vs architectural ARCH D;
  [Salem](https://cityofsalem.net/home/showpublisheddocument/24787/638652003206830000)).
  Addenda sketches (SK/ASK) are often letter size with their own format
  ([Newforma](https://projectcenter.help.newforma.com/overviews/sketches_overview)).
- Half-size prints scale uniformly, so compare normalized coordinates.

How:

1. Per-sheet signature: aspect ratio and orientation, title-block frame
   lines as sheet fractions, static tokens at fixed normalized positions,
   page size in inches (not stored today; add it).
2. Cluster by signature similarity (line overlap + shared static tokens such
   as firm and project name). Aspect ratio is a hard pre-filter; prefix and
   source PDF only break ties.
3. One template per group. A correction is stored on the group with its
   source sheet and re-projected to every member. Members whose static
   tokens then don't line up are flagged, not changed.
4. A sheet that matches no group is its own group, low confidence, listed as
   "unmatched title block". The user can correct it or say "same as group X".
   A one-sheet group (cover, sketch) is valid.
5. New PDFs are re-clustered and inherit matching templates. A user "move
   to group" choice is saved per sheet and outranks detection.

## Orientation and title-block position

v1 handles both right-edge and bottom-edge title blocks. Bottom strips are
the common case in the repo's own real sheets:

| Sheet | /Rotate | Title block |
|---|---|---|
| four-asks A601 (VA) | 90 | bottom |
| roseburg a03a (VA) | 270 | bottom; no text layer, OCR only |
| four-asks C300 | 0 | bottom |
| demo AF101 (VA) | 0 | bottom |
| porterville A1-101 | 0 | right edge, vertical text |

Right-edge strips are common in architectural practice
([learnarchitecture.net](https://learnarchitecture.net/articles/39295-architectural-title-block.html));
NRCS uses a right strip on large sheets and a bottom strip on page-size
sheets ([NRCS 210-NEM 541.3](https://directives.nrcs.usda.gov/sites/default/files2/1712932931/26684.pdf)).

v1:

1. Work in the displayed orientation. pdf.js viewports already apply
   /Rotate (`mcp/src/pdf.ts:115-120`, `web/src/pdfTile.worker.ts:193`,
   fork `ocr/rasterize.ts:78`).
2. Score all four edge bands for the title-block strip: repetition across
   sheets, long parallel frame lines, text density, sheet-number position.
   Right and bottom are the priors.
3. Carry `rot` on every token, vector and OCR, and join sheet-number
   fragments along the text direction.
4. Move the hard-coded gates onto the detected strip: `sheets.ts:127`
   (sheet number), `sheets.ts:223` (scale), `detectRooms.ts:185` (6% inset,
   which is thinner than the ~8-10% VA bottom strips).

Deferred:

- Scanned pages that are sideways with no /Rotate (check: OCR a thumbnail
  at 0° and 90° and compare confidence).
- Top-to-bottom vertical OCR text. ppu-paddle-ocr rotates tall crops 90°
  CCW, so bottom-to-top text reads; top-to-bottom likely doesn't.
- L-shaped title blocks.

## Cover sheets and sheet indexes

Map them like any other sheet. The repo has no cover or general-sheet
handling today; sheetgraph likely classes a cover as "plan" because index
rows like "FIRST FLOOR PLAN" match the plan signal
(`web/src/lib/sheetgraph.ts:67-76`).

What covers hold: sheet index, project directory (owner, architect,
consultants), code analysis, vicinity map, rendering
([VDCI](https://vdci.edu/learn/blueprint-reading/understanding-the-cover-sheet-in-construction-documents-key-information-and-project-directory),
[archtoolbox](https://archtoolbox.com/construction-document-sheet-numbers)).
A title sheet often uses a different title-block format
([Autodesk](https://help.autodesk.com/cloudhelp/2014/ENU/Revit/files/GUID-DCB653C1-5B51-4E88-92F5-73F0A1875E2E.htm)),
so repetition may miss it; it can be a one-sheet group.

- **Detect:** first page, or sheet number starting G / T / CS; a header like
  SHEET INDEX / DRAWING LIST; strongest: most of the set's sheet numbers
  appear on the page in one column paired with titles. Add a `cover` /
  `general` sheet role that outranks plan/detail.
- **Regions:** `sheet_index`, `project_directory`, `code_analysis`,
  `vicinity_map`, `abbreviations`, `symbols_legend`, `general_notes`.
- **Search:** label as `G-001 › Sheet index`. For a sheet-number query, rank
  the sheet whose own title block carries the number first, and show index
  hits as "listed in index". Keep index rows out of `sheetCodes`.
- **Use the index:** parse it into (number, title, issue). Check title-block
  sheet numbers against it and flag missing, extra and misread numbers
  (e.g. "A1O1"). Supply sheet titles, which nothing extracts today. Feed
  `sheetNumbers`. When index and title block disagree, flag it and keep the
  title block's number.

## Measurement

- **Labeled fixtures:** public sheets with regions drawn by hand, stored as
  JSON next to the PDF.
- **Scores:**
  - Region match (IoU per region, per kind).
  - Share of text runs given the right region kind.
  - Detail labels read exactly (number, sheet ref, title, scale).
- **Parity:** each fixture also runs as an image-only PDF through OCR. Regions
  must match the vector run within a set IoU.
- Fixtures must be shareable. The private corpus in #437 can be used for
  extra numbers under its agreement, but not committed.

## Planned pieces

For the upstream issue later, following the #466 layout:

1. Region map schema and storage; labels on search hits and MCP tools.
2. Title block vs drawing area: repetition across sheets, user template,
   corrections. Move the 6% inset and lower-right guesses onto the map.
3. Detail viewports: find titles, find extents, apply labels.
4. Title-block parts, schedule, legend and notes regions.
5. Raster line segments, labeled fixtures, and the vector/raster parity test.

## Depends on

- On-device OCR engine: `feat/ocr-engine-469` (#469).
- Plan-set search and index: `claude/client-side-ocr-search-index-n699t0` (#471).

## Problems found along the way

Not region work, but found while researching it:

- **Search ranks the cover first for a sheet number.** On the fork search
  branch, "A-101" scores the same on the index page and on A-101's own
  title block, and ties break on sheet order, so the cover wins (fork
  `planIndex.ts:206-237`). "A101" doesn't match "A-101" (`:95`). 1-2 digit
  sheet numbers ("A1", "G-01") show up as finish tags in `sheetCodes`
  (`:69`, `:281`).
- **`SHEET_NO_RE` rejects "A1-101"** (`web/src/lib/sheets.ts:106`), the
  Porterville fixture's sheet number.
- **The 6% inset is thinner than the VA bottom title-block strips**
  (`web/src/lib/detectRooms.ts:185`), so part of the title block counts as
  drawing area for room detection.

## Fixtures to label first

- A VA bottom-strip sheet (four-asks A601 or demo AF101).
- Porterville A1-101 (right strip, vertical text).
- Roseburg a03a: OCR only, /Rotate 270. The natural vector/raster parity case.
- A multi-sheet set with a cover and sheet index, for grouping and index checks.
