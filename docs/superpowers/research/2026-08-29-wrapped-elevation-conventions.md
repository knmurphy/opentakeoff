# How a multi-wall tiled elevation is conventionally drawn — corners

**Date:** 2026-08-29
**Question:** For a 2D "wrapped" view meant to show a tile pattern turning corners, how do real practice and prior art represent the corners between adjacent walls? Our current naive true-angle fold overlaps at inside corners; is that ever done?

**Bottom line up front:** Neither prior art nor drafting convention ever draws walls folded flat at true angle in 2D. The universal convention is **separate, side-by-side wall panels, each drawn front-on (flat, at true length), sequenced around the room and keyed to the plan, with the join at each corner shown as a terminating vertical break line / borderline — not as bent-together geometry.** The corner is a *boundary between panels*, not a place where one continuous figure folds. Option (a) is the best-supported representation. Option (b) (the true-angle 2D fold we currently do) has **zero** instances in any source examined. Option (d) (small 3D wrap) is the runner-up — it is what two of the three prior-art apps actually do for multi-wall.

---

## Citation tiers

- **Tier 1 — verified code (primary, read directly):** the three cloned repos, file:line below.
- **Tier 2 — reachable authoritative web primary source:** NKBA *Professional Resource Library*, Chapter 12 (2023) — a standards body for exactly the room type that gets tiled (kitchen/bath). General architecture-school / drafting references for corroboration.
- **Could not verify (excluded, not cited as fact):** *Architectural Graphic Standards* (not on the open web); the *TCNA Handbook* full text (paywalled — only secondary summaries were reachable).

---

## Part 1 — Prior art (read the actual code)

**None of the three apps draws a folded 2D multi-wall figure.** Each either (i) keeps walls as separate flat single-surface panels, or (ii) places walls as real 3D planes at true world angle. Overlap-at-inside-corners cannot arise in either, because neither ever bends multiple walls into one 2D figure.

### TileSim (React + three.js; a room → floor/ceiling/walls; per-surface tile editor)

- `refs/TileSim/src/model/geometry.ts:101-141` — `wallSurfaces(room)` makes **one `Surface` per floor-polygon edge**. Each wall gets its own `SurfaceTransform` = `{ origin (at the edge's start, on the floor), uAxis (along the edge), vAxis = (0,1,0) up, normal (inward) }`. Walls exist as independent planes placed at their true world position/orientation; they only coexist in 3D.
- `refs/TileSim/src/views/PlanView.tsx:7-19` — the 2D "plan" view is a straight **orthographic top-down floor plan** (camera looking down −Y). No wall elevations here.
- `refs/TileSim/src/views/SurfaceEditor.tsx:65,67` — the flat tile-pattern editor operates on **exactly one surface at a time** (`editingSurfaceId`, singular, read at line 67). Its own doc-comment at line 65 (Hungarian) calls it "a felület **kiterített** 2D nézete" — *the surface's unfolded/laid-out 2D view*. Note: TileSim uses the word "unfolded" for a **single flat panel**, never for a multi-wall fold.
- `refs/TileSim/src/model/types.ts:96` — `SurfaceKind = 'floor' | 'ceiling' | 'wall' | 'box-face'`; walls are first-class independent surfaces.
- **Verdict:** multi-wall is shown only in the 3D scene (real planes). 2D is either a top-down plan or a single flat wall panel. It never folds walls together in 2D, so it never overlaps.

### tiletakeoff (React; plan-based takeoff + a three.js 3D preview)

- `refs/tiletakeoff/src/three/scene3d.js:104-114` — walls are built by extruding the room perimeter: for each polygon edge, a `PlaneGeometry(len, h)` rotated `wall.rotation.y = -atan2(b.y−a.y, b.x−a.x)` and positioned at the edge midpoint. Walls are **real 3D planes at true angle**; corners resolve naturally in world space.
- `refs/tiletakeoff/src/engine/types.js:40` — a room carries only `wallHeight` ("ft, for wall-tile coverage proxy"). There is **no per-wall elevation geometry** anywhere; walls are a coverage/area proxy plus the 3D extrusion. The 2D canvas is plan-only.
- **Verdict:** multi-wall = 3D planes at true angle. No 2D wall elevation, folded or otherwise.

### TileCalculator (deck / patio tile calculator; perimeter trim = "fascia")

- Not a wall-elevation app, but it is the one that reasons explicitly about **corners of a wrapping trim**. `refs/TileCalculator/src/calc/borders.ts:53-82` — linear runs accumulate per side (`linearLength`, `pieces`), and **each corner is a discrete counted element** with its own `type: 'outside' | 'inside'` (`outsideCorners` / `insideCorners`, and `hasCornerPieces` for border types that ship dedicated corner pieces). Corners are treated as their own items joining two runs — **not** as continuous geometry bent around a vertex.
- **Verdict:** even where a pattern must "wrap" a perimeter, the corner is modeled as a distinct junction element between two straight runs, not a fold.

**Empirical negative:** across all three repos, instances of a true-angle 2D fold of multiple walls = **0**. Instances of splay/fan-by-angle = **0**. Multi-wall is either separate flat panels (TileSim) or true-angle 3D planes (TileSim, tiletakeoff).

---

## Part 2 — Drafting / architectural convention

### Interior elevations are separate, one-per-wall, keyed to the plan

The dominant convention for showing the vertical faces of a room is a set of **interior elevations**: each wall drawn **flat, front-on, orthographic, at true length**, as its own panel, arranged in plan sequence and cross-referenced to the floor plan by elevation markers.

Primary source (Tier 2), **NKBA Professional Resource Library, Ch. 12, "Interior Elevations for Kitchens & Baths"** (National Kitchen & Bath Association, © 2023) — directly relevant because kitchen/bath walls are the tiled walls (backsplashes, wet walls):

- Elevations are "drawn as flattened, straight-on with no distortion or perspective." Each elevation "is drawn to scale with the limits of the ceiling, floor, **adjacent walls** or other interior assembly obstacles **with a borderline**." → the *adjacent wall is where the panel ends*; the corner is the panel's boundary.
- **Sequence & keying:** "The first elevation view should be the north wall… Elevations move **clockwise around the room**." Elevation markers on the plan are "cross-referenced to the elevation title marker" (Fig. 12.5). "Typically **one interior elevation per ANSI B (11" x 17") drawing sheet** will be prepared so that it may be posted on the wall on-site during installation." → walls are separated, ordered around the room, and tied back to the plan by markers — not merged. (Note the *per-sheet* reason; see caveat in Part 3.)
- **Corners:** "the designer should consider how each of the mouldings will **project, return, or dive around corners**" — i.e. continuity across a corner is shown by moulding *returns*, wall by wall, not by bending the drawing. And explicitly, where a wall continues out of scope: "adjoining spaces with interior walls that continue… would be **terminated with a vertical break line**" (Fig. 12.10).

Corroborating general references (Tier 2, reachable):

- **Iowa State Univ., *Visual Graphic Communication for Interior Design*, Ch. 4** (open textbook): interior elevations are "projected *out* from the edges of the room" (contrast with exterior elevations projected down), each wall its own orthographic view. (`iastate.pressbooks.pub/visualgraphiccomm/chapter/chapter-4-draw-elevation-and-sections/`)
- **First In Architecture, "Technical Drawing – Elevations and Sections":** interior elevations are labelled by the direction faced / by number and shown at 1:50 or 1:20; each is a separate orthographic view keyed to the plan. (`firstinarchitecture.co.uk/technical-drawing-elevations-and-sections/`)
- **CUNY City Tech, Arch1101 Lesson 3:** an elevation is a flat orthographic view of one vertical surface; interior elevations depict the vertical surfaces of a room, one face at a time. (`openlab.citytech.cuny.edu/architecture-oer/course-by-week/lesson-3-introduction-to-architectural-drawings-elevations/`)

### The "developed elevation" term of art = unfold to a single plane **at true length**, never overlapping

"Developed elevation" (a.k.a. unfolded / rolled-out elevation) is the CAD/drafting term for taking a **path on the plan** (typically a curved or faceted single run — a bay, a curved storefront, a cylindrical or faceted wall) and **developing it onto one flat plane at its true developed length**, so it can be measured and set out. The defining property is *true length preserved, laid out straight* — the surface is unrolled, not projected at an angle and never made to overlap. Reachable evidence for the term and its meaning (Tier 3, corroborating only): the Autodesk community "flattened curved elevations/sections" idea page (`forums.autodesk.com/t5/revit-ideas/flattened-curved-elevations-sections/idi-p/6255768`) and web-search summaries characterizing "developed elevation" as wanting "the flattened version of a curved wall in elevation so one can measure on it" and "developing/elevating a drawn path on plan." (A `revitforum.org` thread on the same term surfaced in search but returned HTTP 403 and was not read.) This is the roll-out convention for curved/cylindrical surfaces; for a room of straight walls it degenerates to the separate-panels-with-break-lines convention above.

### Tile-specific (TCNA-style shop drawings)

Reachable secondary summaries (Tier 2/3; the TCNA Handbook itself is paywalled and was **not** read directly) describe tile set-out / shop drawings as: front-on **wall elevations**, one per wall, showing grid lines at tile pitch, control lines, start point and cut fall, with corners/junctions handled by separate **detail drawings** rather than a folded composite. (`prospecllc.com/tcna-drawings/`, `mclinestudios.com/guide-to-tile-shop-drawings/`, `wyatt.nsw.edu.au/blog/how-to-read-tile-layout-plan`.) No reachable primary tile source showed a folded multi-wall figure; **could not find any tile convention that folds walls at true angle.** The tile trade rides on the general interior-elevation convention: separate keyed wall elevations.

---

## Part 3 — Synthesis: what representation the evidence supports

Our feature is an **in-panel takeoff/preview view** whose job is "show the pattern turning corners." Evaluated against the evidence:

- **(a) Separate side-by-side wall panels, in plan order, labeled, corner shown as a break line / borderline — BEST SUPPORTED.** This is the interior-elevation convention (NKBA Ch. 12: panels bounded by borderlines at adjacent walls, sequenced clockwise, keyed to the plan by markers, wall continuity across corners shown by returns and by vertical break lines). It is also what TileSim effectively does (one flat panel per wall) and what tile shop-drawing summaries describe. It cannot overlap. Pattern continuity is read *across the break line* (panel N's right edge = panel N+1's left edge), the same way a tiler reads a set-out set. **Recommended representation.**
- **(b) True-angle 2D fold (our current approach).** Found in **zero** sources and **zero** prior-art repos. Overlap at inside corners is not a patchable bug — it is intrinsic to folding solid walls into a shared 2D plane. **Not supported by any evidence.**
- **(c) Fan-outward-by-true-angle (splay so panels don't overlap).** Also found in **zero** sources. It avoids overlap but distorts the very thing the view exists to show (true-length, front-on pattern), and no convention or prior art does it. Plausible-looking but unsupported; do not adopt on aesthetic grounds.
- **(d) Small 3D / isometric wrap.** Genuine prior-art support: TileSim's 3D scene (`geometry.ts:101-141` real wall planes) and tiletakeoff's extruded 3D walls (`scene3d.js:104-114`) are exactly this. It is how both apps let you "see the pattern turn corners." It reads as a preview, not a measurable drawing, and it is heavier to build. **Legitimate runner-up** — the honest fallback if a flat panel strip proves insufficient, but it is a preview idiom, not the drafting-document idiom.

**Recommendation grounded in the evidence:** build **(a)** — a strip of separate, flat, true-length wall panels in plan order, each labeled and (ideally) keyed to the source polygon edge, with the corner drawn as a terminating **vertical break line / borderline** between abutting panels (per NKBA Ch. 12). Read pattern continuity across the break, do not fold across it. If a spatial/"you are standing in the room" feel is later wanted, (d) the small 3D wrap is the evidenced alternative; (b) and (c) are unsupported and should be dropped.

**One caveat worth carrying into design:** in construction documents the panels are separated partly for *sheet-layout* reasons (one elevation per B-size sheet so it can be posted on-site — NKBA Ch. 12). Our target is a single scrollable in-app panel, so we are free to place the wall panels adjacent in one strip; but the *substance* of the convention — flat, true-length, front-on, corner = break line, keyed to plan — is what transfers, and that substance argues directly against the fold.
