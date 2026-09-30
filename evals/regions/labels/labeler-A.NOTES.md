# Labeler A notes (definition v1)

## Method
- Rendered every page with `pdftoppm` (displayed orientation, /Rotate applied): 40 dpi PNG for viewing, 100 dpi grayscale for measuring (`dpi_used` = 100). Files in `r/`.
- Looked at every page (6-up contact sheets `r/m_*.png` per file, plus full-page views and 100 dpi close-up crops of the title-block areas for each design) to find the border frame and the title-block inner rule, and to decide the title-block design (family).
- Measured positions from pixel rows and columns (`tools/prof.py` prints rows/cols with long dark runs in a band; `tools/measure.py` takes the edge and the approximate inner position I identified by eye, snaps to the longest dark run within +/-0.008 of it, and finds the outermost long frame line (run >= 60% of the page) on each side). Every page was measured individually (`tools/meas.json`). The two outliers were checked by hand (see below). Values are the first pixel row/col of the rule (rules are 1-2 px at 100 dpi, so +/-0.0005).
- Took about 25 minutes.

## Families
- VA-Dublin-SpeesDesignBuild-bottom (59): all dublin-part*.pdf + va-dublin-bldg9a-finish-plan-A601.pdf. VA form 08-6231 block of separate cells. There is no single continuous rule, so inner = top of the cell row (y=0.880).
- VA-StCloud-Anderson-bottom (2): sample-finish-plan.pdf. Same VA form, but a different cell layout (Dunham/AST consultant, Anderson A/E, VA seal at right). Inner 0.880.
- VA-Shreveport-Apogee-civil-bottom (17): shreveport-combined pp1-16 + the standalone C300. Continuous rule at 0.881.
- VA-Shreveport-Apogee-elec-bottom (8): shreveport-combined pp17-24. Visibly different cell layout (ARCHITECT/ENGINEER OF RECORD, BICSI and PE seals). Same rule at 0.881.
- VA-Roseburg-bottom (1): va-roseburg-a03a.pdf (/Rotate 270). Rule at 0.860.
- Porterville-right (1): porterville-adu-a1-101.pdf, a right-side strip.

## Ambiguous pages
- porterville-adu-a1-101 (medium confidence): the frame's top and bottom lines end at the vertical rule x=0.889, and no frame line closes the right side of the title strip (only a partial box, x 0.903-0.986, around the lower half). I took x1 = page edge 1.0 per the rule. If the box edge 0.986 were used as the border instead, d would be 0.105 rather than 0.118.
- Shreveport (both families): a continuous rule at 0.881 closes the drawing area and the cells begin at 0.883. I took 0.881. The "100% CONSTRUCTION DOCUMENTS" and "FULLY SPRINKLERED" lines sit above it in the drawing area, so they are excluded.
- dublin-part1 p4: a drawing-area box bottom at 0.878 lies just above the title cells. The inner rule was set by hand to the cell-row top, 0.880.
- dublin-part7 p4: a page-edge line at x=0.9986 was caught by the snapping step. The right frame was set by hand to x=0.9805.
- Roseburg: the full-height general-notes column on the right is part of the drawing area, not the title block.
- The cover sheets (dublin-part1 p1, shreveport p1) carry the standard bottom block, so no page has a null title block.
