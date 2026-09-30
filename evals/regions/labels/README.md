# Title-block labels (answer keys)

Two independent agent labelers, in separate sessions, labeled all 88 pages
(the in-sample and held-out sets in `../SOURCE.md` plus the committed single
sheets) on 2026-09-30. Each saw only the PDFs and the definition below, never
the other's output, the design docs or any detector (none existed). Labeler A
ran on Opus, labeler B on Sonnet, to reduce shared bias. Both measured rule
positions from pixel rows/columns at 100 dpi after identifying each rule by eye.

These files are committed **before any detector code** (plan task 2); the
evaluation checks that order.

## Definition (v1)

- Displayed orientation (after /Rotate). Normalized page coordinates, x right,
  y down.
- Border: the outer frame line; a side with no frame line uses the page edge.
- Title block: the strip along one side between the border and the inner rule
  (or row/column of cell lines) separating it from the drawing, full length of
  that side, including everything in it. `inner` = the rule's page coordinate;
  `d` = depth as a fraction of the border box perpendicular to the edge.
- `null` when a sheet has no standard title-block strip. `family` = the
  title-block design.

## Agreement (A vs B, 88 pages)

| Measure | Result |
|---|---|
| Edge | 88/88 same |
| `inner` difference | median 0.000, p90 0.001, max 0.001 |
| Border difference (max side) | median 0.001, p90 0.001, max 0.014 |
| `d` difference | median 0.000, p90 0.001, max 0.014 |
| Family partition | identical (0 of 3,828 page pairs differ) |
| Null title blocks | none from either labeler |

Families: VA Dublin (59 pages), Shreveport civil (17), Shreveport electrical
(8), St. Cloud sample plan (2), Roseburg (1), Porterville (1).

**Disagreements over 1%:** one, `porterville-adu-a1-101.pdf`. Same edge and
inner rule (x = 0.889); the right side has no frame line. A used the page edge
(x1 = 1.000, d = 0.118) per the definition; B used a partial box edge
(x1 = 0.986, d = 0.104). A definition gap, not a measuring error. Pending
reconciliation (see the plan: by the maintainer, without detector output).

Caveats: the two labelers agree very closely, and both are models; their
agreement is not a human noise floor. Labeler A's NOTES says the job took
~25 minutes; its own report says ~6 minutes of wall-clock time.
