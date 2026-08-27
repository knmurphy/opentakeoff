# Plan — Room membership for selection isolation (spec r5 rev 2)

Spec: `docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md`, final
addendum (2026-08-26e, r5 rev 2) — the authority; every ruling below
traces to it.

## T1 — Pure: extend isolate3D (scene3dScope.js + web/test/scene3d.test.ts)

TDD: extend the isolate3D suite FIRST (red), then implement. All logic in
`isolate3D(selectedId, shapes)` — signature unchanged, sole call site
(TakeoffCanvas ~1187) untouched.

Implementation outline (per spec):
1. **Room resolution — a SET**: selected `floor_area` → itself; else all
   floors reachable via `origin.derived` (`from_shape_id` + every id in
   `between_shape_ids`, one hop, floor_area only). No room → return
   today's semantics wholesale.
2. **Re-rooted walk**: derived links + label-equality walk FROM the
   resolved room floors (not selectedId); graph-admitted shapes join
   before membership is consulted (precedence — membership only governs
   shapes the graph does not admit).
3. **Outset rings**: per resolved room, `insetRing(ring, -eps)`,
   eps = 1% of the ring bbox min dim (normalized space). <3-vertex or
   degenerate ring → that room contributes no ring (degrade, no throw).
   Hole test RAW: in-outer AND in-no-hole (`verts_norm_holes`).
   Build outset rings for ALL other floor_area shapes too (membership
   triage needs them).
4. **Point shapes** (count verts[0]) and **closed rings** (deduct +
   unlinked unlabeled floor_area; representative = centroid2, fallback to
   vertex supermajority when the centroid is outside the shape's own
   raw ring; tested against every floor's outset ring EXCLUDING the
   shape's own ring): exactly one resolved room contains → join; exactly one
   other room (and no resolved room) → drop; else stay.
5. **Runs** (undecorated linear + surface_area): samples = every vertex
   + ≈8 evenly spaced interior points per segment; ≥60% inside resolved
   rooms' outsets → join; else ≥60% inside other rooms' outsets → drop;
   else stay. Zero samples → stay.
6. **Defaults**: graph-unadmitted shapes outside the membership
   buckets (labeled-other-room floors, derived-elsewhere) keep today's
   DROP; the existing test at scene3d.test.ts ~283 stays byte-identical.
7. Imports: `pointInPoly` from geometry.js; `insetRing`, `centroid2`
   from scene3d.js. No new primitives.

Tests = the spec's full list (20 assertions incl. precedence,
transition set, concave fallback, hole exclusion, degradation cases).

## T2 — Docs

USER_GUIDE §18 isolation paragraph (shapes strictly inside a room follow
it; shared-wall runs join both rooms; straddles and unattributable stay
visible), FEATURES.md row 47 parenthetical (replaces the superseded
"unlinked shapes stay visible"), CHANGELOG bullet. No README, no MCP.

## Order & gates

T1 (red→green) → `node --import tsx --test test/scene3d.test.ts` (41 +
new, all green) → T2 → `npm run check`
(PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH") → headed smoke
(select shapes whose rooms have unlinked members; verify isolation
hides/drops per rules and the camera never rebuilds on selection) →
diff code-review.

## Headed smoke checklist

Fixture `3d-view-test.otk`: select the L-room floor → its bands/seams
(shapeId-linked, graph-admitted) + anything inside it stays; the other
rooms' contents drop — including unlabeled/unlinked shapes inside them.
Select a hand-traced wall run (WT-1 ribbon) directly → fallback (today's
semantics). Select a transition (TR-1) → both adjoining floors' families
isolate. Selection changes never rebuild/refit (canvas-region pixels
differ only by visibility toggles).
