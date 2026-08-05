# Drafts for Kentucky-ai/opentakeoff — NOT SENT

Nothing here has been posted. This repo's rule is that upstream is read-only
and the exact wording gets approved before anything goes out. Four drafts,
ranked by what they're worth to upstream.

All findings came out of adversarial review of the 2026-08-04 sync and were
reproduced from the production path on the bundled `demo/sample-finish-plan.pdf`.

---

## Draft 1 — issue: two clicks can return the same floor twice

**Title:** `one_click: a door sector can be annexed by both the room and the corridor`

> On `demo/sample-finish-plan.pdf`, two ordinary clicks return overlapping
> rings:
>
> | clicks | result | shared |
> |---|---|---|
> | corridor CE-5 + room 158 | 640.11 SF + 208.98 SF | 16.17 SF |
> | room 140 + the CPT-1/P-1-tagged lobe south of it | 155.02 SF + 14.01 SF | 14.06 SF (100% of the lobe) |
>
> Bisected by running each engine against the same seeds:
>
> - CE-5 × 158 is 0.00 SF at 126ca36 and at 2d6ef50 (#188). It appears at
>   f649b1f (#191). The door sector at room 158's east doorway is annexed by
>   both sides — the room gains +16.57 SF, the corridor +15.88, and 16.18 of
>   that is the same floor. The sheet prints 557 SF for that corridor and the
>   engine returns 640.
> - 140 × lobe is 0.47 SF before #188 and 13.99 SF after. The lobe carries its
>   own CPT-1 floor tag and P-1 wall tag, so it is a separate finish cell on
>   the sheet, and it now sits entirely inside room 140.
>
> We don't think this argues against #188 or #191 — measured against the
> sheet's own printed areas, `bench:callouts` improves across both (mean
> absolute error 35.6% → 33.8%). It looks like a policy gap rather than a
> regression in the geometry: when a door sector sits between a room and a
> corridor, something has to decide which one owns it.
>
> One note on the bench, in case it's useful: `pairwiseOverlapFrac` reports
> 0.000% here. It compares a case's pinned probes against each other, and both
> of these are between a room `detect_rooms` finds and a space it never
> reaches, because those spaces carry no room number. `detect_rooms`' own
> output is internally clean — every pair of its 27 rings overlaps by 0.00 SF.
> We ended up gating it from the workflow side instead (sweep, then click what
> the sweep couldn't commit, then check the union); happy to share that if
> it's wanted.

---

## Draft 2 — issue: the `elevator-e01` golden is stale after #191

**Title:** `bench: elevator-e01's golden still holds the pre-#191 ring`

> #191's commit message records elevator-e01 gaining 0.80 SF from a real leaf
> sector, but `web/bench/corpus/va-finish-plan.json` still holds the
> 21-vertex, 142.63 SF ring. The bench passes because IoU lands at 0.994,
> above the gate — so the corpus describes a ring the engine no longer
> returns. Re-pinning through `pin-goldens.mts` gives 17 verts / 143.43 SF
> (+0.56%, IoU 0.997); the four dropped vertices are the notch the leaf sector
> fills. No other probe moves on either real-plan case.
>
> One thing the SF band can't see, which may be the more interesting half:
> confidence on that probe drops 0.97 → 0.92, because #191's leaf retry
> propagates `r2.hatchFiltered` (`web/src/lib/oneclick.ts`, around the leaf
> pass). The trace ends up stamped `hatch-filtered(bounded)` — "this came from
> a hatch escalation" — when there is no hatch anywhere in it. The square
> footage is better and the provenance is wrong.

---

## Draft 3 — PR: two documentation corrections

**Title:** `docs: strike the ?hatchqa claim, dedupe three FEATURES rows`

> Two small things, happy to split them.
>
> `FEATURES.md` advertises a `?hatchqa` QA wall on the Conditions row. The
> string appears in no commit of `web/src` in either repository's history —
> the retuned patterns themselves did ship, only the QA wall is unaccounted
> for. We struck the claim on our fork in July and this is the same edit.
>
> `FEATURES.md` also carries three rows twice: **Sheet graph**, **Approval
> stamps** and **Symbol sweep**. Each pair is an older row and a newer one
> that supersedes it (the Approval stamps pair is the clearest — the stale one
> still says "no UI or MCP tool mints one yet"). This keeps the fuller row of
> each pair.
>
> Also noticed while syncing, not included here: `mcp/package-lock.json` reads
> 0.9.30 while `mcp/package.json` reads 0.9.33.

---

## Draft 4 — the detect_rooms guards, offered as a contribution

**Title:** `detect_rooms: five ownership guards for tag-box and neighbour floods`

This one is a code contribution, not a bug report, so it wants a PR rather
than an issue — and it's the largest ask, so it probably goes last.

> Running `detect_rooms --assign_from_schedule` against
> `demo/sample-finish-plan.pdf` here, five of the committed rooms look
> questionable to us:
>
> - 170 (8.44 SF), 150 (5.61 SF) and 167 (7.14 SF) are the drawn tag boxes.
>   They clear `BUBBLE_RATIO` because the bubble test runs on the *snapped*
>   ring, and vertex snap pulls the box ring onto nearby wall endpoints.
> - 134A (93.07 SF) is office 136's floor. The plan prints 16 SF for 134A's
>   storage room; the ladder steps across the wall into 136.
>
> …and the reported list includes a 70,497 SF region seeded from the numeral
> `10`, plus several floods off drawing numbers and title-block text.
>
> Our fork carries five guards for this, and we'd be glad to open a PR if
> you'd take it: the shared `roomLabelSeeds` textual filters applied to every
> span, the drawing-extent gate on every ladder rung rather than the anchor
> only, below-box-first seeding, the bubble test on the **pre-snap** trace,
> and a label-ownership test (centre-in-ring OR the flood's region surrounding
> the label box, for tag boxes tied to a wall by their leader).
>
> On that sheet it gives 4 committed rooms, each under its own schedule row,
> and 23 reported.
>
> Two honest caveats. The guards also stop `detect_rooms` reaching the
> corridors, which carry no room number (the sheet prints CORRIDOR / CE-4 /
> 250 SF), so we added a pass that traces and *reports* those separately
> rather than committing them under a printed area — 1,786 SF on this sheet.
> And the title-block cell `Building Number / 28` still comes through as a
> reported room, narrowed from 91 SF to 51 SF but not gone.
