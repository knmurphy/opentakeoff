# Manual testing log — tile patterning (and adjacent)

Running checklist of what needs a **human** pass after automated/agent work. The
gate (typecheck + lint + tests + bench + build) and the browser smoke test prove
structure; they can't prove an estimator's eye. Check items off as you verify;
each build adds rows, and the unmerged branch is the thing under test.

**How:** `cd web && npm run dev` (port 5199), load the sample plan or a real
plan, trace a room under `CT-1`, open the Tile panel and Report. For the perf
items, watch the DevTools Performance tab long-task list (the dev build logs
long tasks to console).

---

## M1–M7 + perf + main-merge (on `feat/tile-patterning` now, unmerged)

### Visual / gesture (tile canvas)
- [ ] Grid draws **to scale** over a traced CT-1 room (full tiles solid, cut
      tiles lighter + dashed, corners marked, straddled holes red).
- [ ] LOD swap: zoom out → grid gives way to the condition hatch; zoom in →
      grid returns. Swap feels natural, not flickery.
- [ ] Origin drag: grab the crosshair, drag — pattern re-solves live under the
      cursor, snaps on release. Responsive (no multi-second freeze).
- [ ] Rotation: set a rotation in the panel — grid rotates, counts change.
- [ ] Edge click (edit mode): cycle trim → threshold → bullnose → cove → plain;
      confirmed edge inks, suggested edge ghosts dashed.
- [ ] Geometry drag: move/reshape a tiled room — grid **hides during the drag**,
      redraws once on release (not per-frame).
- [ ] Per-room origin/rotation override in the panel + one-click reset to the
      condition default.

### Panel + QA
- [ ] Tile panel: pattern / tile size / joint / edge strategy / SKU list all
      edit and re-solve.
- [ ] Multi-room QA list: click a warning row → view flies to the flagged room.
- [ ] Reuse (M6): enable "Reuse offcuts", set sliver threshold → "with reuse"
      second count appears and is ≤ Safe; "reuse n/a" for diagonal/herringbone.
- [ ] Interior band (M7): enable band, pick SKU/width/offset → inset ring draws,
      field stops at band, band shows its own line; too-big band skips with a
      warning.

### Perf (measured, but re-confirm feel on a real plan)
- [ ] Pan/zoom a large tiled plan: no jank (long tasks near 0 during pan).
- [ ] Pattern switch (grid ↔ herringbone ↔ basketweave): fast enough to feel
      instant; no frozen UI.
- [ ] Edit one room in a many-room job: only the edited room re-solves (no
      whole-plan hitch).

### Numbers vs hand takeoff (the real check)
- [ ] A 4×4 ft room in 12×12″ = 16 full tiles (matches the golden tests).
- [ ] Take a real room, hand-count full/cut/corner, compare against Report.
- [ ] Safe = full + one-per-cut; order = boxes on one dye lot + breakage/attic.
- [ ] Grout bags, cut sheet rows look right for a real cut pattern.

### Merge coexistence (main's features + tile, on the branch)
- [ ] Image annotations: capture/upload + place an image; source-trace (◎) back
      to its origin sheet — works alongside a tiled room, no cross-feature crash.
- [ ] Readout tally: MEASUREMENTS under the condition total still lists
      runs/walls correctly.
- [ ] Project switch / snapshot restore: no stale tile grid or wrong room
      (cross-project cache bleed fix `b668696`).

### MCP round-trip
- [ ] `export_takeoff` carries the tile layout snapshot; `import_takeoff` reloads
      it unchanged (counts byte-identical after round-trip).

---

## M8 — report / export / labor (in progress)

- [ ] Report panel shows tile columns (full/cut/corner/safe/boxes/grout) per
      tiled condition.
- [ ] Cut sheet surfaces in CSV / XLSX export (consolidated rows, not per-tile).
- [ ] Scale-accurate layout sheet: PDF and DXF draw the grid + cuts + trim at
      true scale, dimensioned, correct on a real room.
- [ ] Labor ROM: weighted labor SF + driver counts (cut EA, corner EA, trim LF,
      movement-joint LF) appear, **dollar-free**, with the "excludes demo / prep
      / mobilization" note. Pattern/size factors look sane (diagonal ~1.2×,
      herringbone ~1.6×, large-format ~1.3×).

---

## Later milestones (M9–M15) — rows added as each lands
