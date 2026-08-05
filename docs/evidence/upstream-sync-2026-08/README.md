# Browser verification — upstream sync 2026-08-04

`TakeoffCanvas.jsx` took 20 conflict hunks in this merge and no test renders it,
so the merged canvas was driven for real: `npm run dev`, Chromium via the
Playwright MCP server, the bundled VA finish plan (`demo/sample-finish-plan.pdf`),
scale set from the sheet's own title block (1/8" = 1'-0").

**Zero console errors or warnings** across the whole session (9 messages, all info).

## sync-05-room.png — One-Click measures, and both sides' receipts are in one string

A One-Click in the north-wing ward room reads **235.3 SF**, which is the bench
corpus golden for `va-finish-plan / ward-room` (235.26 SF) — the engine measures
in the browser exactly what the corpus says it measures.

The commit-message strip underneath is the merged H15 branch carrying BOTH sides
of that hunk: upstream's stage-time receipt lead-in and this fork's F7(g)
ring-interior correction —

> Measured through the drawn door to the wall opening — the swing area is
> included. It also includes the floor inside a closed ring (a round column or
> callout bubble), which is not a door swing; ⌥-click carves one out if it
> should be deducted. ⏎ creates.

## sync-07-created.png — Create commits, and both sides' post-create behaviour holds

"Created 1 takeoff — 235.3 SF CPT-1." The shape commits, and **upstream's #189**
selects it (handles are live on the new ring, so ⌫ still reaches it). The ACTION
slot hands back to **this fork's Detect rooms**. Running total 235.3 SF · 26.1 SY.

## sync-08-takeoffs.png — the merged Takeoffs panel

CPT-1 with its roll-goods setup, the condition **duplicate** control (upstream's
condition twins, #204), and **⟂ Transitions…** (#208) present and correctly
DISABLED — a transition needs two finishes with committed rooms, and there is
one.

Also verified, not screenshotted here: the in-app manual (#193) opens on `?` and
lists the merged tool set — upstream's tools alongside this fork's Curved Line
(Q) and push-to-talk dictation.
