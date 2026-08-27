# T4 docs patch — roll-good lanes on the 3D slabs (DRAFT, not applied)

Written by T4 ahead of T3 landing. **Do not apply to the live docs yet** — the
`Rolls` checkbox label and the disclosure-note wording below are sourced
verbatim from the spec (`docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md`,
addendum 2026-08-26c r3, "Disclosed limits") and the plan
(`docs/superpowers/plans/2026-08-26-roll-lanes.md`, T3), not from the shipped
UI string. Every place that needs a byte-for-byte check against T3's actual
panel copy before merge is marked `[VERIFY …]`.

Each hunk below is a standard unified diff against the file's current content
on this branch (paths relative to repo root). Apply with `git apply` or by
hand once T3's `View3D.jsx` panel copy is final and confirmed to match (or
this patch is edited to match what T3 actually shipped).

## 1. `docs/USER_GUIDE.md` — new "The Rolls checkbox" paragraph in §18

Inserted between the existing "**Controls.**" paragraph and the
"**Limitations, always on screen.**" paragraph (§18. 3D view), same place the
spec's Docs sync note calls out: "Rolls checkbox; bands = coverage/material
palette; seams = coverage boundaries; the coverage-vs-cut-piece and holes
disclosures."

```diff
--- a/docs/USER_GUIDE.md
+++ b/docs/USER_GUIDE.md
@@ -1032,9 +1032,23 @@
 reframes on the current visible content. **Export** renders the current view to a PNG
 with a footer—sheet label, the sheet's scale, today's date, and a caveat line ("schematic
 — not as-built; openings deducted, not shown; verify in field")—with the plan underlay
 baked in exactly as shown.
 
+**The Rolls checkbox.** Beside the Plan controls, a **Rolls** checkbox (on by default)
+bands roll-goods floors—broadloom carpet, sheet vinyl, sheet rubber—in the roll
+material's own palette, with a seam line drawn at every lane boundary in ink chosen to
+read against that slab's color. It's the same figured cuts and seams the roll layout
+already computes for the 2D cut overlay, read straight off the floor. Toggling it only
+shows or hides the bands and seams—never a camera reframe. While it's on, a note
+discloses three simplifications: roll cuts ignore slab holes, so a band still stripes
+across one; a band is the coverage slab (finished goods), while the 2D cut overlay is
+the physical cut piece (which overlaps its neighbor by the seam allowance and tucks past
+the walls)—both correct, different questions; and a seam crossing a concave notch clips
+to the room, so the drawn seam can be shorter than the seam length the Report prices.
+Rolls carry into the **Export** PNG as shown, and when they're visible the export footer
+picks up the same drawn-vs-priced seam caveat.
+
 **Limitations, always on screen.** A persistent, non-dismissible label states what this
 view is not: no wall thickness, no door frames, no casework, flat single-elevation
 floors, a generic base profile, and openings deducted from quantities but not modeled as
 gaps. This is a schematic quantity check, not a BIM model or a construction drawing.
```

`[VERIFY the checkbox label "Rolls" and the wording of the three disclosures against
View3D.jsx's actual panel copy — this paragraph currently quotes the spec's "Disclosed
limits" wording, not a rendered string. If T3 phrases the note differently, this
paragraph must be re-wordsmithed to match, not left as spec paraphrase next to a
different on-screen string.]`

## 2. `README.md` — extend the "3D view" Features bullet

```diff
--- a/README.md
+++ b/README.md
@@ -130,5 +130,6 @@
 - **3D view**—press `W` (or the **3D** toolbar button) on a scaled sheet to extrude the
   committed takeoff into a schematic, feet-true three.js scene: floors, walls, and base
   as their real heights, a dimmed plan underlay (the sheet's own page, on by default at
-  40% opacity, with Show plan / Tint / opacity controls) under the geometry, legend
-  toggles, explode, section cut, and a PNG export with a scale/date footer
+  40% opacity, with Show plan / Tint / opacity controls) under the geometry, roll-goods
+  lane bands and seams on their floor slabs (**Rolls** checkbox, on by default), legend
+  toggles, explode, section cut, and a PNG export with a scale/date footer
```

`[VERIFY the "**Rolls** checkbox, on by default" phrase reads correctly once T3's panel
label is confirmed — same source risk as USER_GUIDE §18 above.]`

## 3. `FEATURES.md` — extend the "3D view" row

The current row's code-reference column is already truncated mid-path in the live file
(ends `` `web/src/l...` `` — a pre-existing issue, not introduced by roll-lanes; flagging
it here rather than silently leaving it broken, but NOT fixing it as part of this patch
since it's outside T4's assigned scope). This hunk only extends the prose column; whoever
applies it should also decide whether to repair the code-ref column in the same pass and
append `web/src/lib/rollgoods.js`, `web/src/lib/rollTakeoff.js`, `web/src/lib/scene3d.js`
to it.

```diff
--- a/FEATURES.md
+++ b/FEATURES.md
@@ -47,1 +47,1 @@
-| **3D view** | Lazy overlay: `W` (or the **3D** toolbar button) on a scaled sheet extrudes the committed takeoff into a schematic, feet-true three.js scene — floors/base/counts at their real heights, deducts as translucent volumes, per-condition legend toggles, explode, section cut, PNG export with a scale/date footer, and a persistent limitations label. A dimmed plan underlay (the sheet's own fresh white-background page render) sits under the geometry as a ground plane, on by default at 40% opacity, with panel controls for Show plan / Tint (light-cobalt wash) / opacity — none persisted, and included in the PNG export; stitched sheet groups show no underlay. Selecting a shape first isolates its room via `isolate3D` (itself + derived shapes + label-equal siblings; unlinked shapes stay visible) | `web/src/l...
+| **3D view** | Lazy overlay: `W` (or the **3D** toolbar button) on a scaled sheet extrudes the committed takeoff into a schematic, feet-true three.js scene — floors/base/counts at their real heights, deducts as translucent volumes, per-condition legend toggles, explode, section cut, PNG export with a scale/date footer, and a persistent limitations label. A dimmed plan underlay (the sheet's own fresh white-background page render) sits under the geometry as a ground plane, on by default at 40% opacity, with panel controls for Show plan / Tint (light-cobalt wash) / opacity — none persisted, and included in the PNG export; stitched sheet groups show no underlay. Selecting a shape first isolates its room via `isolate3D` (itself + derived shapes + label-equal siblings; unlinked shapes stay visible). Roll-goods conditions (`roll_setup` present) render lane bands (material palette, odd-lane parity, single-lane exception) and seam lines (luminance-aware ink) on their floor slabs from the same figured layout the 2D cut overlay uses, via a **Rolls** checkbox (on by default, visibility-only toggle); a disclosure note covers the slab-hole, coverage-vs-cut-piece, and concave-notch caveats, and PNG export carries the same drawn-vs-priced seam caveat when rolls are visible | `web/src/l...
```

`[VERIFY the same checkbox-label/disclosure wording as above, and separately decide
whether to repair the pre-existing truncated code-ref column while this row is touched.]`

## 4. `CHANGELOG.md` — new bullet under "## 2026-08-26 — 3D takeoff view" → "### Added"

Appended after the existing "Plan underlay in 3D." bullet, same release entry (the
roll-lanes addendum is dated the same day as the rest of the 3D view work).

```diff
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -21,8 +21,17 @@
 - **Plan underlay in 3D.** A dimmed ground plane sits under the geometry — the sheet's own
   page, rendered fresh on a white background, laid flat at reduced opacity (on by default,
   40%). The dark theme never inverts it: the underlay is always the white page, optionally
   tinted. A **Plan** panel block controls it — **Show plan** toggles it, **Tint** washes it
   in a light cobalt rather than the raw white, and an opacity slider dials it — none of
   which persist between sessions. The underlay is baked into the **Export** PNG exactly as
   shown. Side-by-side stitched sheet groups show no underlay, by design: there's no single
   source page for a joined surface.
+- **Roll-good lanes in 3D.** Roll-goods floors (broadloom carpet, sheet vinyl, sheet rubber)
+  render the same figured cut layout the 2D roll panel already computes straight onto their
+  slabs — alternating lane bands in the roll material's own palette, with a seam line at
+  every lane boundary in ink chosen for contrast against that slab's color. A **Rolls**
+  checkbox beside the Plan controls (on by default) toggles visibility only — never a camera
+  reframe — and a note discloses three simplifications while it's on: cuts ignore slab
+  holes, so bands still stripe across one; a band is the coverage slab while the 2D cut
+  overlay is the physical cut piece — both correct, different questions; and a seam crossing
+  a concave notch clips to the room, so it can draw shorter than the seam length the Report
+  prices. Rolls carry into the Export PNG, whose footer picks up the same drawn-vs-priced
+  seam caveat when they're visible.
```

`[VERIFY checkbox label / disclosure wording as above before merging this entry.]`

## Not touched (out of scope per plan T4)

- `docs/USER_GUIDE.md` §15 (guideParity.test.ts gates its key tables only).
- No MCP surface changes — roll-goods has no new MCP tool/verb.
- `docs/AGENT_GUIDE.md` — not named in the plan's T4 scope; the agent tool surface is
  unaffected (roll-goods rendering is 3D-view-only, no new `agentTools.js` verb).
