# Toolbar redesign — design exploration (2026-07)

The takeoff toolbar interleaves six concerns (session, file/sheets, drawing tools,
drawing aids, scale/render, outputs) in one wrapping row of ~25 controls. This
exploration audited the problem and produced four alternatives as interactive
mockups, built with the app's own tokens.

**Open `toolbar-redesign-options.html` in a browser** — every dropdown, toggle,
and popover in the mockups works. The PNGs below are static captures for quick
reference (and for embedding in issues).

| File | What it shows |
| --- | --- |
| `current-audit.png` | Today's toolbar, each control underlined by concern — the grouping problem made visible |
| `option-a-two-decks.png` | **A** — project bar over work bar; everything visible, everything homed |
| `option-b-one-row.png` | **B** — one consolidated row; Aids menu + single scale chip; ~11 visible controls |
| `option-c-left-rail.png` | **C** — Bluebeam-style vertical tool rail; tracked as future work in issue #62 |
| `recommended-blend.png` | **R** — A's structure with B's best consolidations; chosen direction, spec'd in issue #61 |
| `recommended-blend-scale-open.png` | R with the scale popover open (detected scale, standards, calibrate) |
| `comparison.png` | Criteria table: control count, chrome, clicks-to-Snap, stability, effort |

## Where the decisions live

- **Issue #61** — the chosen "R blend" spec: two decks, account chip, scale status
  chip with popover, render menu (Hi-Res + fill), reserved transient-action slot.
- **Issue #62** — the deferred left-rail direction and its open design questions.

Three principles from the exercise apply to any future toolbar work:

1. **One home per concern** — a control's position tells you what it is.
2. **State changes never move other controls** — conditional UI gets reserved
   space or lives inside a menu.
3. **Menu faces carry state** — armed tool, aids count, scale value — so
   consolidation never hides what's on.

Relevant code: the toolbar block in `web/src/pages/TakeoffCanvas.jsx` (search for
`toolbar — open/sheets`) and `web/src/components/ToolMenu.jsx`.
