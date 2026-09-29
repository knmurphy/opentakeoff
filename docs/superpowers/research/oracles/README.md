# Herringbone/basketweave verification oracles

Reference scripts (Python) used during the origin-honoring research. Committed so a
future implementing session can reproduce them — the originals lived in an
ephemeral session scratchpad.

**Important caveat (adversarial review, 2026-08-28):** `hb2.py`/`hb3.py` verify the
**abstract textbook** herringbone (single, 2-plank motif, `v1=(L,L)`, `v2=(W,−W)`),
which tiles gap-free at any plank ratio. The **shipped** `web/src/lib/tilePatterns/herringbone.ts`
implements a **different, double** herringbone (4 planks per `periodX×bandH` cell,
period `⟨(2,2),(2W,−2W)⟩`) that is gap-free **only at 2:1** — 3:1 and 1.5:1 leave
gaps, which is why the `tilePatterns/index.ts:17-22` non-2:1 warning is **correct
and must stay**. So these oracles are lattice-math references, NOT a validator of
the shipped generator.

**What the Slice-1 JS test must actually do** (self-contained, no external path):
the origin-honoring change only *translates* the existing generator output, so the
test asserts **translation invariance of coverage**, not absolute gap-freeness:
1. Run the real generator at `origin=[0,0]` over a fixed window; record the set of
   covered (sub-cell) samples and their tile assignment.
2. Run it at several origins (fractional, and > 1 lattice cell). Assert the covered
   region is the same window minus boundary clipping, i.e. the field is the
   origin=0 field translated by the **raw `origin`**. Do NOT reduce the expected
   shift mod `bandH`: herringbone's odd bands are glide-shifted `periodX/2`, so its
   pure-y translation period is **`2·bandH`** — reducing mod `bandH` would wrongly
   fail a correct generator at e.g. `origin.y = 1.5·bandH`.
3. Assert `origin=[0,0]` output is byte-identical to today (no regression).

`hb.py` — coverage counter (samples a window, flags cells covered ≠ once).
`hb2.py` — coverage across ratios for the abstract motif.
`hb3.py` — ASCII render (single herringbone) for visual sanity.
