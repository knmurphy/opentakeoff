# Wall Tile — Slice B (Elevation Sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn a wall tile shape's unwrapped elevation into a real, generated **sheet** — viewable on the canvas, listed in the sheet gallery, annotatable, and exported by marked-PDF/DXF — created on demand as a static snapshot the user regenerates.

**Architecture:** Draw the tiled elevation strip (reusing `wallElevationLayout` from Slice A) into a **real one-page PDF** via pdf-lib, `store.addPdf` it as an ordinary sheet, and set that sheet's scale directly to the exactly-known feet-per-pixel. Because the canvas render path is hard-bound to pdf.js (investigation §3), a generated PDF is the low-risk seam that flows through render, gallery, thumbnails, marked-PDF, and DXF **with zero new branches**. Generation is **user-initiated (static snapshot)**; deterministic bytes (`updateMetadata:false`, no timestamps) mean regenerating an *unchanged* wall is a byte-identical no-op (no revision), and a *changed* wall makes exactly one deliberate, user-asked-for revision.

**Tech Stack:** pdf-lib (already a dep, used by `ingest.js`), the `store` IndexedDB adapter, `node:test`+tsx, React (`TilePanel.jsx`/`TakeoffCanvas.jsx`).

**Spec:** `docs/superpowers/specs/2026-08-29-wall-tile-patterning-design.md` §6 (approved). Investigation: `docs/superpowers/research/2026-08-29-wall-elevation-sheet-investigation.md`.

## Global Constraints

- **User decision (Kevin, 2026-08-29): STATIC SNAPSHOT, regenerate on demand.** The sheet does NOT auto-update when the wall changes; a "Generate / Regenerate elevation sheet" action rebuilds it. No automatic regeneration anywhere.
- **Deterministic generation:** the pdf-lib doc uses `{ updateMetadata: false }` and embeds NO timestamps/wall-clock/random ids, so identical wall input → byte-identical PDF → `store.addPdf` sees the same SHA-256 hash → NO false revision (investigation §obstacle-5, `ingest.js:122-124`). This is what makes "regenerate on demand" safe.
- **Scale is known exactly** (investigation §4): `upp = 1 / (P · RENDER_SCALE)` where `P` = points-per-foot the strip is drawn at, `RENDER_SCALE = 2.0`. The generated sheet lands **scale-confirmed with a provenance** (`scale_source`, `scale_confirmed: true`) so measurement is NOT gated behind a human confirmation the frame doesn't need (investigation §4).
- **Do NOT change floor/existing-sheet behavior**, the Slice A wall engine, or the plan-overlay closure (Task-7). This slice only ADDS a generation path + a sheet.
- **TEST CONVENTION (repo has NO vitest):** `node:test` + `node:assert/strict`, FLAT `web/test/*.test.ts`, `.ts` imports. Model on `web/test/tileSolve.test.ts`. No AI-attribution commit trailers.
- Reuse the `imageToPdf` idiom (`ingest.js:116-140`) for the pdf-lib doc→File flow and `store.addPdf(File)` for insertion (`store.js` addPdf; returns `{revised, rev, prev_rev}`).
- **Per-shape sheet key — ALWAYS `` `${tag}-elev-${shape.id}.pdf` `` with the FULL shape id** (`shp-<uuid>`), never the bare tag, never a truncated id. *(plan-review C1: a condition tag is shared by many wall runs — `tileTakeoff.js:307` — so a tag-keyed name collides; a `slice(0,6)` id has only ~256 buckets → 50% collision at ~20 shapes/tag.)* Full-id key is unique per shape AND stable across regens (so regenerate replaces that shape's sheet in place). `parseSheetKey` treats it as an ordinary page-1 file name (verified).
- **Annotation drift on a dimension-changing regen (accepted + guarded, plan-review I1):** a length/height edit changes the sheet's pixel dims, and shapes are NOT re-paired across a dims change (`revisions.js:1-8`), so any marks a user placed on the elevation sheet would land wrong. A SKU/color-only regen (same dims) is safe. Slice A behavior: if a regenerate changes `width_ft`/`height_ft` AND the elevation sheet already has user shapes bound to its key, **confirm before proceeding** ("this wall's size changed — marks on its elevation sheet may shift; regenerate anyway?"); otherwise regenerate silently. Same-dims regen never warns.

---

## File Structure

**New:**
- `web/src/lib/wallElevationPdf.ts` — pure(ish) generator: wall summary → elevation PDF bytes + scale. pdf-lib dynamic import; reuses `wallElevationLayout`.
- `web/test/wallElevationPdf.test.ts` — generator tests (valid 1-page PDF, correct pt dims, determinism, upp formula).

**Modified:**
- `web/src/pages/TakeoffCanvas.jsx` — a `generateWallElevationSheet(shape)` handler: build File → `store.addPdf` → set `scales[key]` (+ provenance, persisted) → `refreshSheets` → open the tab; thread it to the panel.
- `web/src/components/TilePanel.jsx` — a "Generate / Regenerate elevation sheet" button in the wall card (the RoomOverride/selected-wall area from Slice A Task 8), enabled when a wall shape with `wallStrips` is selected; shows "regenerate" if a sheet for this shape already exists.

**Verify-only (assert, don't change):** `web/src/lib/dxf.ts` (dims+upp path), `web/src/lib/markedset.js` (PDF-backed light path), `web/src/components/PlanNavigator.jsx` (gallery/thumbnail — PDF-backed gets it free).

---

### Task 1: Elevation PDF generator — `wallElevationPdf.ts`

**Files:** Create `web/src/lib/wallElevationPdf.ts`; Test `web/test/wallElevationPdf.test.ts`.

**Interfaces:**
- Consumes: the Slice-A per-shape wall summary (`{ wallStrips: TileLayout[], folds: Fold[] }`), the condition's `skus` (for per-SKU color), `tag`, `height_ft`, and a `skuColor(skuId)=>hex`. `wallElevationLayout` from `./tileWallElevation.ts` for the tile rects (feet). pdf-lib via `await import("pdf-lib")`.
- Produces:
  ```ts
  export const ELEV_POINTS_PER_FT = 36;   // 1/2" = 1'-0" (P=36 → upp = 1/(36*2) = 0.013888… matches arch(0.5))
  export type WallElevationPdf = { file: File; upp: number; width_ft: number; height_ft: number };
  export async function buildWallElevationPdf(args: {
    wallStrips: TileLayout[]; folds: Fold[]; skuColor: (id: string) => string;
    tag: string; name: string;   // stable file name, e.g. `${tag}-elevation.pdf`
  }): Promise<WallElevationPdf>;
  ```
- The page: width = `width_ft·P` pt (+ margins), height = `height_ft·P` pt (+ header). Draw, bottom-origin (pdf-lib y-up = elevation up, floor at bottom — no V-flip needed since pdf-lib is y-up): each tile rect (fill per-SKU color, thin grout stroke); each fold as a vertical line + a small `inside`/`outside` text label; a floor datum line; a header text line `${tag} — ${width_ft}'-0" × ${height_ft}'-0" elevation`. `updateMetadata:false`; no Date/random.
- `upp = 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE)` (import `RENDER_SCALE` from `./sheets`).

- [ ] **Step 1: Write failing tests**

```ts
// web/test/wallElevationPdf.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWallElevationPdf, ELEV_POINTS_PER_FT } from "../src/lib/wallElevationPdf.ts";
import { RENDER_SCALE } from "../src/lib/sheets.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

const setup = { ...mintTileSetup(), skus: [{ id:"a", name:"A", w_in:12, h_in:12, color:"#3b82f6" }], joint:{width_in:0} };
const layout = solveTileLayout({ tile_setup: setup, ring_ft: wallStripRing(18, 8) });

test("builds a valid one-page PDF with correct point dims and upp", async () => {
  const r = await buildWallElevationPdf({ wallStrips:[layout], folds:[], skuColor:()=>"#3b82f6", tag:"WT-1", name:"WT-1-elevation.pdf" });
  assert.equal(r.width_ft, 18); assert.equal(r.height_ft, 8);
  assert.ok(Math.abs(r.upp - 1/(ELEV_POINTS_PER_FT*RENDER_SCALE)) < 1e-9);
  const bytes = new Uint8Array(await r.file.arrayBuffer());
  assert.ok(bytes.length > 500);
  // PDF magic
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)), "%PDF-");
  assert.match(r.file.name, /\.pdf$/);
});

test("is DETERMINISTIC — identical input yields byte-identical output (no timestamps)", async () => {
  const a = await buildWallElevationPdf({ wallStrips:[layout], folds:[], skuColor:()=>"#3b82f6", tag:"WT-1", name:"WT-1-elevation.pdf" });
  const b = await buildWallElevationPdf({ wallStrips:[layout], folds:[], skuColor:()=>"#3b82f6", tag:"WT-1", name:"WT-1-elevation.pdf" });
  const ba = new Uint8Array(await a.file.arrayBuffer()), bb = new Uint8Array(await b.file.arrayBuffer());
  assert.deepEqual([...ba], [...bb]);   // determinism is what makes regen-on-demand safe
});
```

- [ ] **Step 2: Run, verify fail** (`cd web && node --import tsx --test test/wallElevationPdf.test.ts`).
- [ ] **Step 3: Implement `wallElevationPdf.ts`** per the interface. Use `PDFDocument.create({ updateMetadata:false })`, `doc.addPage([wPt,hPt])`, `page.drawRectangle`/`drawLine`/`drawText` (embed a standard font once), colors via `pdf-lib` `rgb()` parsed from the hex `skuColor`. Reuse `wallElevationLayout` for the tile rects (multiply feet by `ELEV_POINTS_PER_FT`). `doc.save()` → `new File([bytes], name, {type:"application/pdf"})`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(tile-wall): elevation-strip PDF generator (deterministic, known scale)`

---

### Task 2: Sheet creation + scale/provenance — `generateWallElevationSheet` in TakeoffCanvas

**Files:** Modify `web/src/pages/TakeoffCanvas.jsx`.

**Interfaces:**
- Produces a handler `generateWallElevationSheet(shape)` that: (1) looks up the shape's wall summary from `tileTakeoff.byShape.get(shape.id)` (has `wallStrips`+`folds`) — the SAME synchronous value the Slice A panel reads (`TakeoffCanvas.jsx:10269`), no async/staleness; (2) resolves `tag` + a **pure** `skuColor` from the condition — `skuColor(id)` is a plain lookup of `cond.tile_setup.skus.find(s=>s.id===id)?.color` and NOTHING else (no palette allocator / next-color counter), so an unchanged wall regenerates byte-identically *(plan-review M4)*; (3) `await buildWallElevationPdf(...)` (Task 1) with the **full-id key** `wallElevationSheetName(tag, shape.id)` = `` `${tag}-elev-${shape.id}.pdf` ``; (4) **dims-change guard (I1):** if the key already exists in `sheets` and its persisted dims differ from the new `width_ft/height_ft` AND shapes are bound to that `sheet_id`, `confirm(...)` before proceeding; (5) `await store.addPdf(file)`; (6) **scale (M1 — idiomatic path):** `setScales(m=>({...m,[key]:r.upp}))` + `setScaleSources(m=>({...m,[key]:"wall-elevation-generated"}))`, and **leave `scaleUnconfirmed` untouched** (absence = confirmed; the gate is `scaleUnconfirmed[key]===false` at `:8062`, so never writing it reads as confirmed) — persisted per sheet as `units_per_px`/`scale_source` (`TakeoffCanvas.jsx:2005-2019,2681`); (7) **cache reset on revision (M2):** on `{revised:true}` run the proven `handleFiles` reset — `evictDoc` + **`forgetPages(name)`** (which calls `forgetThumbs`, keeping gallery thumbs from outliving the new bytes — `thumbs.js:13-18`) + `setDocEpoch`; (8) **open (M2):** use the proven sequence `await refreshSheets()` → `setOpenTabs(...)` → `goToSheet(name)` (`TakeoffCanvas.jsx:~1838-1842`), NOT `openSheets`/`setSheetGroup` (a `[sheets]` effect can prune a tab opened before `sheets` reflects the new key).

- [ ] **Step 1: Write failing tests** — the pure/extractable parts (in `wallElevationPdf.ts`): `wallElevationSheetName(tag, shapeId)` (always `` `${tag}-elev-${shapeId}.pdf` ``; two different shapeIds → different names; test the C1 case — same tag, two shapes, distinct keys) and a `wallElevationScaleRow(upp)` → `{ units_per_px, scale_source }` (NO `scale_confirmed` field; exact upp). node:test/flat/.ts. (The handler is UI-glue: assert the helpers; verify wiring via the browser smoke.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the helpers + wire the handler in TakeoffCanvas per the interface above (full-id key; pure skuColor; idiomatic scale via setScales/setScaleSources; forgetPages on revision; refreshSheets→setOpenTabs→goToSheet; the dims-change confirm). Keep the handler thin; logic in the tested helpers.
- [ ] **Step 4: Run, verify pass** + full `npm test` green + `tsc`/`eslint` clean.
- [ ] **Step 5: Commit** — `feat(tile-wall): generate a wall-elevation sheet (addPdf + known-scale, confirmed provenance)`

---

### Task 3: Panel action — Generate / Regenerate button

**Files:** Modify `web/src/components/TilePanel.jsx` (the selected-wall card from Slice A Task 8) + thread the handler from `TakeoffCanvas.jsx`.

- [ ] **Step 1: Write failing tests** — a pure `elevationButtonState({ selectedWall, existingSheetKeys, tag, shapeId })` helper → `{ enabled, label }` (`enabled` only when a wall shape with `wallStrips` is selected; `label` = "Generate elevation sheet" if `wallElevationSheetName(tag,shapeId)` is NOT in `existingSheetKeys`, "Regenerate elevation sheet" if it IS). It reuses `wallElevationSheetName` (full-id key from Task 2) — do NOT re-derive the key. Test both states + disabled-on-floor + that two shapes under one tag get independent enabled/label state. Put the helper in `wallElevationPdf.ts`; node:test.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — render the button in the wall card wired to `onGenerateElevation(shape)`; use `elevationButtonState` for enabled/label. Floor/no-wall selection: button absent. Do not alter existing panel behavior.
- [ ] **Step 4: Run, verify pass** (component harness absent → helper-tested, per Slice A precedent).
- [ ] **Step 5: Commit** — `feat(tile-wall): panel action to generate/regenerate the elevation sheet`

---

### Task 4: Export + subsystem spot-checks (verify-only + guards)

**Files:** Test `web/test/wallElevationSheet.integration.test.ts`; only touch source if a real leak is found.

- [ ] **Step 1: Write tests** — using a generated elevation PDF's `{dims, upp, shapes, conditions}`: (a) **DXF** — `buildSheetDxf` emits entities for a shape on the elevation sheet (dims+upp only, `dxf.ts:161-197`) — assert non-empty CAD output, no throw. (b) **revisions determinism** — building the elevation PDF twice for the same wall yields identical bytes (so `store.addPdf` would NOT create a spurious revision); a changed wall (different height) yields different bytes (one deliberate revision). (c) **gallery/sheet-list** — a sheet whose name is the elevation key appears in the `listSheets`-shaped list and parses via `parseSheetKey` without error. (d) Spot-check `sheetLevels`/`sheetGroups`/`sheetgraph` do not throw on a sheet key of the elevation form (call each with the key; assert graceful).
- [ ] **Step 2: Run, verify fail** (or pass-by-construction where already correct — then it's a guard/regression test).
- [ ] **Step 3: Implement** — only if a spot-check reveals a real break (e.g., a sheetgraph parser chokes on the name), add the minimal guard. Otherwise the tests stand as regression guards. Document any subsystem that needs a follow-up as a ledger minor.
- [ ] **Step 4: Run, verify pass** + full `npm test` green.
- [ ] **Step 5: Commit** — `test(tile-wall): elevation sheet flows through DXF/marked-PDF/gallery; determinism guards`

---

## Self-Review
- **Spec coverage:** §6 "unwrapped elevation → a real synthetic sheet" → T1 (generator) + T2 (sheet creation) + T3 (action); export (marked-PDF/DXF) → T4; static-snapshot/regen-on-demand (Kevin) → T2/T3 determinism + button label; scale provenance (investigation §4) → T2. Slice C (wrapped view) is a separate plan.
- **Risk register:** the investigation's obstacle-5 (revision churn) is neutralized by determinism (T1 test) + user-initiated regen (T3). Flagged-unchecked subsystems (revisions/sheetLevels/sheetGroups/sheetgraph/projectArchive/cloud-sync) get spot-check guards in T4; projectArchive/cloud-sync are noted for a follow-up if T4 surfaces anything.
- **No placeholders:** T1 carries real generator code + determinism test; T2-T4 give exact seams (store.addPdf, scales persist at :2008-2017, dxf.ts:161-197) + tested pure helpers around the UI glue.

## Revision log — plan review folded (v1 → v2)
Review: `docs/superpowers/research/2026-08-29-wall-tile-slice-b-plan-review.md` (REVISE, 1 Crit + 1 Imp + minors; the high-risk claims — pdf-lib determinism, y-flip, scale formula, wide pages, render path, byShape — all verified SOUND).
- **C1 (key collision):** always key `` `${tag}-elev-${shape.id}.pdf` `` with the FULL shape id (a tag is shared by many runs; truncated ids collide). Global Constraints + T2 + T3 now agree on one `wallElevationSheetName(tag, shapeId)`.
- **I1 (annotation drift):** a dims-changing regen would drift marks bound to the sheet (`revisions.js` doesn't re-pair across a dims change). Guard: confirm before a dims-changing regen when the sheet already has shapes; same-dims regen is silent.
- **M1 (scale persist):** use `setScales`+`setScaleSources`, leave `scaleUnconfirmed` untouched (absence=confirmed; gate is `===false`) — no literal `scale_confirmed:true`.
- **M2 (cache reset + open):** name `forgetPages` (thumbnail freshness) explicitly; use the proven `refreshSheets→setOpenTabs→goToSheet` order, not `openSheets/setSheetGroup`.
- **M4 (pure skuColor):** the handler's `skuColor` is a plain `skus[].color` lookup only — no allocator/counter — so determinism holds in the real path, not just T1's stub.
- **M3 (deferred minor):** extreme aspect-ratio (long thin wall) thumbnail/panel legibility — cosmetic, revisit if it reads poorly in the browser smoke.
