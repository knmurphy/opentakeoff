# Region-aware text: where on the sheet a hit came from

Status: draft on the fork. Not proposed upstream yet.

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
   applies to every sheet in the set (or every sheet of the same size). A
   detail-viewport correction applies to that sheet only.
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
    └─ unclassified
```

Each region records:

| Field | Meaning |
|---|---|
| `id` | stable within the sheet |
| `kind` | from the tree above |
| `bbox` | image px at `RENDER_SCALE`, the same frame as text tokens |
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

1. **Tokens:** positioned words `{str, x, y, h}` (plus `w` when present).
   The text layer and on-device OCR (`OcrWord`, `web/src/lib/ocr/types.ts` on
   `feat/ocr-engine-469`) already share this shape.
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

Storage: alongside the plan index, versioned. The plan index schema
(`opentakeoff.plan_index.v1` on `claude/client-side-ocr-search-index-n699t0`)
gets a region map per sheet, or a sibling store keyed the same way.

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

## Open questions

- Store regions inside the plan index, or beside it?
- How to group sheets for a title-block template: by page size, by
  discipline prefix, or by detected title-block match?
- Rotated sheets and sheets with the title block along the bottom instead of
  the right edge: handle both from the start?
- Cover sheets and sheet indexes: skip them, or treat them as one "drawing
  area" with no details?
