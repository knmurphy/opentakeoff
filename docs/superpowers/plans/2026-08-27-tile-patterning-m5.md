# Tile Patterning — M5: canvas overlay + focus flow + undo + hatch coexistence + multi-room QA

**Status:** planned. **Branch:** `feat/tile-patterning` (PR #207). **Worktree:**
`/Users/knmurphy/Documents/PROJECTS/opentakeoff/.claude/worktrees/tile-patterning` — run ALL commands there.

M5 is the **first UI surface** for tile patterning. M1–M4 shipped the pure engine
(solve, counts, grout, order, cut sheet, edges, joints) + the MCP `export_report`
`tile_goods` seam. M5 makes that engine **visually auditable on the canvas**: select a
tiled floor shape, zoom in, see the tile grid drawn to scale, drive origin / rotation /
edge-trim / wet-tag from a docked panel with one undoable command per gesture, and get a
cross-room sliver/warning list so a 40-room job isn't audited one zoom at a time. Plus the
MCP `export_takeoff` layout snapshot.

Authoritative spec: `docs/TILE_PATTERNING_DESIGN.md` §2.C, §2.I, §3.7, §4.1, §4.2, §4.4,
and §5 milestone 5. This plan resolves the §6 open decisions M5 owns (#4, #5, #6).

## What M5 is NOT (scope fence — keep implementers honest)
- **NOT the report/export seam** (M8): no web Report `ctx.tileByCond`/`laborRomByCond`
  maps, no `tile:*`/`laborRom:*` columns, no labor ROM, no PDF/DXF layout sheet. M4's
  `tileEdges`/`borders`/`joints` stay OFF the report seam until M8. M5 may DRAW trim/joint
  edges on the overlay (they are geometry), but figures still land only through the
  existing M3 `tile_goods` path.
- **NOT reuse** (M6) or **interior bands** (M7) — they land after the overlay by design.
- **NOT wall / wet-area / curb / 3D** (M10+). M5's wet-tag gesture only STORES
  `shape.tile_layout.wet_tags`; nothing consumes it yet.
- **NO new MCP tool.** Tool count stays "forty". `export_takeoff` gains a snapshot field
  additively.

## §6 decisions M5 resolves (grounded in shipped doctrine, conservative)
- **#6 Hatch ↔ overlay LOD swap — content-aware cell-size threshold, not a fixed zoom.**
  A `tile_setup` condition's hatch is the overview/print fill; the grid replaces it for a
  shape once the installed cell's on-screen size clears a legibility floor:
  `min(cellW_ft, cellH_ft) / upp * tf.scale >= TILE_OVERLAY_MIN_CELL_PX` (≈ 6 px). Below
  it, draw the hatch; at/above, draw the grid and suppress the hatch for that shape. This
  makes a 2″ mosaic and a 24″ plank swap at the zoom each becomes legible, instead of one
  arbitrary zoom for all. New constant `TILE_OVERLAY_MIN_CELL_PX` in `canvasConstants.js`.
  The overlay is **always-on SVG** (not `DETAIL_ENGAGE`-gated — #86 retired that); only the
  hatch↔grid swap is thresholded. A `tileShow` toggle (mirrors `rollShow`) lets the user
  force-hide the grid.
- **#4 Exposure / wet-tag auto-suggest — suggest, never auto-confirm.** M4's
  `edgeExposures` already returns `suggested:true/confirmed:false` for machine guesses. The
  overlay inks suggested trim/threshold edges as GHOST (dashed, low-opacity); an edge click
  cycles the exposure and sets `confirmed:true` (stored in `shape.tile_layout.edge_overrides`).
  Nothing a machine suggested inflates a figure until confirmed (M4 `trimTallies`/
  `cornerTallies` already gate on `confirmed`). Wet-tag is a **manual** edge/shape gesture
  only — no auto-suggest in M5 (the `tileWetArea` engine is M11).
- **#5 Match-line origin-offset — none in M5.** Layout stops at a sheet boundary (§3.7);
  a seam-crossing stitched room is surfaced in the multi-room QA list as "needs a human
  seam" (existing stitch doctrine — never auto-joined). Per-stitch origin-offset UX defers
  to the milestone that exercises stitched tiling.

## Data model (design §4.1, §3.7)
- **`condition.tile_setup`** (already minted by M1) — pattern, joint, skus, grout, purchase,
  edge_strategy, and the DEFAULT origin/rotation. Edited via the existing `updateCondById`
  path (plain `setConditions`, autosaved, NOT on the shape-undo stack — exactly the
  `roll_setup` precedent). The Tile panel writes here.
- **`shape.tile_layout`** (NEW, per-room override) — `{ origin?, rotation?, cut_sides?,
  edge_overrides?, wet_tags? }`. Lives on the SHAPE, so per-room gestures are undoable
  through `dispatchShape`. `origin`/`rotation` override the condition default for that room;
  `edge_overrides` is a map edgeIndex→`{exposure, confirmed}`; `cut_sides` a set of edge
  indices; `wet_tags` a set of edge indices (or `"floor"`). Absent = inherit condition
  defaults. Serialized additively into `takeoff_canvas.v1`.
- **Layout lifecycle (§3.7):** `shape.tile_layout` PERSISTS across pure zoom; RESETS when
  the layout's identity hash changes — `verts_norm`, `tile_setup`, or `stitchLayoutSig`
  change. A small pure `tileLayoutSig(shape, tile_setup)` helper computes the persist/reset
  hash; the canvas invalidates a room's cached solved layout on hash change.

## Engine APIs M5 consumes (all shipped M1–M4, `web/src/lib/`)
`solveTileLayout({tile_setup, ring_ft, holes_ft?})→{config,bounds,quads,classified}`;
`hasTileSetup(c)`, `tileConfig(ts)`; `getPattern`, `layoutWarning(setup)`;
`classifyLayout`; `optimizeOrigin(...)`; `edgeExposures(...)`; `computeTileTakeoff(...)`,
`tileReportRows(...)`; `tilePitch` (`installedFace` for drawn cell size). **Carry-forward
guard (from M4 estimator review):** read `byCond` for purchase totals; NEVER sum
`byShape.order.boxes`/`byShape.grout.bags` across a condition's shapes (over-orders).

## Tasks (SDD, TDD red-first; fresh implementer per task; task-scoped review; fix loop)

Ordering: pure helpers first (parallelizable, unit-tested), then the canvas integration
(serial — one owner for `TakeoffCanvas.jsx`), then MCP snapshot, then browser verification.

### Task 1 — `tileLayout` shape-command type (PURE, parallel-safe)
`web/src/lib/shapeCommands.js`. Add a `tileLayout` command: patches `shape.tile_layout`
presence-aware, NO provenance stamp (a layout override is not a geometry edit — the `label`
no-stamp precedent), inverse restores the prior `tile_layout` verbatim (present-aware: a
shape that had no `tile_layout` undoes to no key). Add the PROVENANCE_POLICY row + doc
comment. Tests in `web/test/shapeCommands*.test.ts` (or the existing shapeCommands test):
apply sets/merges tile_layout; inverse round-trips to exact prior (including absence);
throws-on-missing-policy invariant still holds.

### Task 2 — `tileLayoutSig` lifecycle hash + solved-layout cache key (PURE, parallel-safe)
New `web/src/lib/tileLayoutSig.ts`: `tileLayoutSig(shape, tile_setup) → string` over the
§3.7 persist/reset inputs (verts_norm rounded, holes, tile_setup identity, tile_layout
origin/rotation/edge_overrides, scale-independent). Pure + tested: same inputs → same sig;
a verts_norm/tile_setup/origin change flips it; pure zoom does NOT (no scale in the sig).
This is the memo key the canvas uses to invalidate a room's solved layout.

### Task 3 — overlay geometry → SVG projection (PURE, parallel-safe)
New `web/src/lib/tileOverlay.ts`: given a solved layout (`quads`+`classified` from
`solveTileLayout`) + the shape ring in feet + `upp` + panel img dims, produce
render-ready primitives in PANEL px (norm×img space, matching the roll overlay frame):
per-tile `{x,y,w,h,rot,cls,skuColor}`, the origin crosshair point, and edge segments with
exposure. NO React/DOM. Also `overlayCellPx(config, upp, scale)` → the on-screen cell size
for the #6 LOD test, and `shouldShowGrid(config, upp, scale)` → boolean. Tests: a known
room + config yields the expected tile count/positions; LOD boolean flips at the threshold;
cut/full/corner/hole classes map to the documented tint. Reuse `tilePitch.installedFace`
for the drawn cell (grout gap shows), never the pitch cell.

### Task 4 — multi-room batch QA aggregator (PURE, parallel-safe)
New `web/src/lib/tileQA.ts`: `tileWarnings(conditions, shapes, dimsFor, uppFor) →
[{condition_id, shape_id, finish_tag, sheet_id, kind, detail, at_norm?}]` over every tiled
floor shape — surfaces `layoutWarning(setup)` results, sub-½ slivers (from `classified`
cut dimensions vs tile size), holes straddling tiles, unscaled sheets, and
seam-crossing/stitched rooms flagged "needs a human seam" (§5 decision). `at_norm` is a
click-to-focus target. Pure + tested: a room with a forced sliver origin yields a sliver
warning; a balanced origin does not; an unscaled sheet yields the scale warning.

### Task 5 — `TilePanel` component (React, parallel-safe from the canvas)
New `web/src/components/TilePanel.jsx`, modeled on `RollPanel.jsx` (docked desk, same
chrome/tokens, close button, `Z` ladder). Props: the tiled-condition layouts (built by the
canvas from `tileByCond` + `condById`), the selected shape's effective config, and edit
callbacks. Controls: pattern select, tile size / joint, per-condition default origin
(numeric) + rotation, edge_strategy, SKU list (name/size/color; images deferred per §6 #1),
`tileShow` toggle, and — when a shape is selected — its per-room override fields + a "follow
condition default" reset. Also renders the multi-room QA list (Task 4 output) with
click-to-focus rows. All condition-level edits call an `onTileSetup(condId, patch)` prop;
per-room edits call `onTileLayout(shapeId, patch)`. Text inputs must not trip window
shortcuts — the existing `INPUT/SELECT/TEXTAREA` guard covers this; verify. No engine math
in the component — it only reads figured data and dispatches patches.

### Task 6 — canvas integration (SERIAL — single owner of `TakeoffCanvas.jsx`)
Wire everything into `web/src/pages/TakeoffCanvas.jsx`, mirroring the roll-goods wiring:
1. `tileTakeoff` useMemo (parallel to `rollTakeoff`, line ~1083): `computeTileTakeoff(...)`;
   derive `tileByCond` and a `tileCutsByPanel`-equivalent (per-panel overlay primitives via
   Task 3), memoized on the Task-2 sig set so pure zoom doesn't re-solve.
2. State: `tileShow` (default true), `tilePanelOpen`, `tileEdit` (edge/origin gesture mode),
   a `tileDragRef` for the origin-drag gesture. Mirror the roll state block (~515).
3. Overlay render: a new `<g>` block beside the roll overlay (~8321) inside each panel's
   translate group — draw tiles (full solid / cut tinted / corner marked / hole flagged),
   the origin crosshair, and suggested (ghost) + confirmed (inked) trim/wet edges. Gate the
   hatch↔grid swap per shape on Task 3 `shouldShowGrid`; when the grid shows, suppress that
   shape's hatch fill (find the hatch render site and add the condition on
   `hasTileSetup && shouldShowGrid`).
4. Focus-on-a-shape: selecting a tiled floor shape (existing `selectShape`) auto-opens the
   Tile panel context to that shape (no forced zoom — the user zooms; the grid appears at
   the LOD threshold). Reuse the existing `flyToCondition`/fit path for a "focus" affordance
   on a QA row (click → pan/zoom to `at_norm`).
5. Gestures, each ONE undoable command (Task 1 `tileLayout` via `dispatchShape`):
   origin-drag (crosshair drag → `tile_layout.origin`, moveCrosshair/`toImage` coord flow,
   commit on pointerup), rotation (panel numeric or a rotate handle), edge click →
   cycle/confirm exposure into `edge_overrides`, mark cut-side, wet-tag toggle. Condition-
   level tile_setup edits go through `updateCondById` (NOT undoable — roll_setup precedent).
6. Panel mount + toolbar button gated on `tileByCond.size > 0` (mirror line 8879/8915).
7. Keyboard: no NEW single-letter shortcut unless it's free (check the map in
   `docs/USER_GUIDE.md` §15); panel inputs already guarded.
8. **Grep new identifiers after editing** (Vite won't flag undefined JSX identifiers) and
   load the app once — AGENTS.md rule.

### Task 7 — `export_takeoff` layout snapshot (MCP, parallel-safe after Task 2/3)
`mcp/src/session.ts` + `mcp/src/outputs.ts` (+ tests): the `export_takeoff` document
additively carries each tiled shape's solved layout snapshot (config + classified summary
+ tile_layout override), so a headless agent can read what the canvas would draw. Additive
only — a tile-less export stays byte-identical. Update the `export_takeoff` description in
`mcp/README.md`/`docs/MCP.md` ONLY if the snapshot shape is user-facing; NO tool-count
change. `cd mcp && npm test` + `npx tsc --noEmit`.

### Task 8 — docs sync
`docs/USER_GUIDE.md` (new tile section: focus-on-a-shape, the grid overlay, the panel,
origin/rotation/edge/wet-tag gestures, the QA list, the LOD swap; shortcuts if any added),
`README.md` (Features — tile patterning now has a canvas UI), `CHANGELOG.md`. House style
(Apple), interface text quoted verbatim from code.

## Verification (M5 is UI → deliverable-proof is browser-drive, not just unit tests)
1. Per-task: the task's own unit tests (Tasks 1–4, 7) red→green; task-scoped review.
2. **Browser verification against the running canvas** (the required proof):
   `cd web && npm run dev`; load the bundled sample plan (`web/public/demo/`, "Load sample
   plan"); press `A`, trace a room; assign it to the seeded `CT-1` (carries a `tile_setup`);
   confirm: (a) the tile grid overlay renders to scale when zoomed in, hatch at overview,
   and the swap happens at the cell-size threshold; (b) the Tile panel opens, edits to
   pattern/origin/rotation redraw the grid; (c) an origin drag is ONE undo (`⌘Z` restores);
   (d) an edge click confirms a suggested exposure and inks it; (e) the multi-room QA list
   lists a forced-sliver room and click-to-focus pans to it. Drive with the `browser` tool;
   visual confirmation is the proof.
3. Full gate before push: `cd web && npm run check` (typecheck+lint+test+bench+build) +
   `cd mcp && npm test` + `cd mcp && npx tsc --noEmit`.
4. **Adversarial reviewer gate** (architect + estimator; fact if doc-heavy) on the M5 range
   after browser proof. Proceed to push only on READY.

## Cadence
Add commits to PR #207 (or a follow-up PR per the branch cadence). **Merge to `main` =
production deploy → human-authorized only.** Warn every implementer about the worktree
write-quirk (new files can land in the sibling main repo — use worktree-absolute paths,
verify with `stat`) and the lint rules (`ts-no-any`, `ts-no-return-type`,
`ts-no-tiny-functions`, `ts-set-map`).
