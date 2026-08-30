// web/test/wallElevationSheetIntegration.test.ts
//
// Task 4 (2026-08-29 wall-tile-slice-b) — VERIFY-ONLY: a generated
// wall-elevation sheet (Task 1's buildWallElevationPdf, stored under Task 2's
// wallElevationSheetName key) must flow through the export and
// sheet-adjacent subsystems without breaking. Covers:
//   1. DXF export (dxf.ts buildSheetDxf) — a shape on the elevation sheet
//      emits real CAD entities, geometry round-trips through dims/upp.
//   2. Regeneration determinism at the store contract level — the SAME wall
//      hashes identically twice (store.js addPdf's compare, :186-238, would
//      return {unchanged:true}, never archive a spurious revision); a
//      CHANGED wall (different height -> different wallStripRing) hashes
//      differently (one deliberate revision).
//   3. sheetKey.ts — parseSheetKey treats the elevation key as an ordinary
//      page-1 sheet; a listSheets-shaped [{name}] list is well-formed.
//   4. Sheet-adjacent subsystems (sheetLevels.js, sheetGroups.ts,
//      sheetgraph.ts) don't choke on the elevation key form.
//
// None of these spot-checks found a real break (see task-4-report.md), so
// this file stands entirely as regression guards — no source changes.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSheetDxf, type DxfShape, type DxfCondition } from "../src/lib/dxf.ts";
import {
  buildWallElevationPdf,
  wallElevationSheetName,
  type WallElevationPdf,
} from "../src/lib/wallElevationPdf.ts";
import { RENDER_SCALE } from "../src/lib/sheets.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { parseSheetKey, compareSheetKeys } from "../src/lib/sheetKey.ts";
import { sanitizeSheetLevels, groupSheetsByLevel, sortGalleryGroups } from "../src/lib/sheetLevels.js";
import { normalizeLoadedGroups } from "../src/lib/sheetGroups.ts";
import { classifySheetRole, sheetBuilding, buildSheetGraph } from "../src/lib/sheetgraph.ts";

const TAG = "WT-1";
const SHAPE_ID = "b7e2c8a0-1234-4dcd-9abc-1122334455aa"; // realistic UUID-shaped shape id (provenance.js mints these; never contains '#')
const SHEET_KEY = wallElevationSheetName(TAG, SHAPE_ID);

// Same fixture wallElevationPdf.test.ts uses: 12x12in tiles, zero joint, so a
// whole-foot wall (18x8) solves to an EXACT width_ft/height_ft with no
// rounding slop — keeps the geometry assertions below exact, not approximate.
function wallSetup() {
  return { ...mintTileSetup(), skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#3b82f6" }], joint: { width_in: 0 } };
}

async function buildWall(widthFt: number, heightFt: number): Promise<WallElevationPdf> {
  const layout = solveTileLayout({ tile_setup: wallSetup(), ring_ft: wallStripRing(widthFt, heightFt) });
  return buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: TAG, name: SHEET_KEY });
}

/** Page size in PDF points, read back off the generated file (pdf-lib). */
async function ptSize(file: File): Promise<{ width: number; height: number }> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(0).getSize();
}

// Mirrors store.js's own sha256Hex (store.js:186-189) exactly — the identity
// addPdf's compare is keyed on (store.js:207-238: same hash -> {unchanged:
// true}, no revision archived; different hash -> exactly one revision
// archived, rev bumped).
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── 1. DXF export ────────────────────────────────────────────────────────

test("1. buildSheetDxf: a shape on the elevation sheet emits real CAD entities, geometry round-trips via dims/upp", async () => {
  const r = await buildWall(18, 8);
  const { width, height } = await ptSize(r.file);
  // DxfSheetInput.dims is the pdf.js-viewport pixel frame at RENDER_SCALE
  // (dxf.ts:71) — the same frame the sheet registry stores for any PDF page.
  const dims = { w: width * RENDER_SCALE, h: height * RENDER_SCALE };
  const conditions: DxfCondition[] = [{ id: "c1", finish_tag: TAG }];
  // a full-sheet floor_area ring stands in for a shape a user measures on
  // the generated elevation sheet exactly like any other stored PDF page
  const shapes: DxfShape[] = [
    { id: "s1", sheet_id: SHEET_KEY, condition_id: "c1", measure_role: "floor_area", verts_norm: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  ];

  const out = buildSheetDxf({ sheet_id: SHEET_KEY, dims, upp: r.upp, shapes, conditions });

  assert.ok(out.entities > 0, "at least one CAD entity written");
  assert.equal(out.shapes, 1);
  assert.deepEqual(out.skipped, [], "the shape must not be silently dropped");
  assert.ok(out.layers.includes(`OT-${TAG}`), `expected an OT-${TAG} layer, got ${out.layers.join(", ")}`);
  assert.ok(out.extents, "extents computed from real geometry");

  // The full-page ring's extents must equal the elevation PDF's OWN page
  // size converted back to feet (pt / ELEV_POINTS_PER_FT) — this is the real
  // scale round-trip, not just "didn't throw": dims (px) and upp (ft/px)
  // agree with each other and with the page pdf-lib actually drew.
  const ELEV_POINTS_PER_FT = 36; // wallElevationPdf.ts's own constant, re-derived here (not imported) so this assertion doesn't trivially pass by reusing the module's math
  const expectedW = width / ELEV_POINTS_PER_FT;
  const expectedH = height / ELEV_POINTS_PER_FT;
  const [minX, minY] = out.extents!.min;
  const [maxX, maxY] = out.extents!.max;
  assert.ok(Math.abs(maxX - minX - expectedW) < 1e-6, `width extent ${maxX - minX} !~ ${expectedW}`);
  assert.ok(Math.abs(maxY - minY - expectedH) < 1e-6, `height extent ${maxY - minY} !~ ${expectedH}`);
});

test("1b. buildSheetDxf: an empty-shapes elevation sheet still validates dims/upp and writes a well-formed (empty) DXF, no throw", async () => {
  const r = await buildWall(18, 8);
  const { width, height } = await ptSize(r.file);
  const dims = { w: width * RENDER_SCALE, h: height * RENDER_SCALE };
  const out = buildSheetDxf({ sheet_id: SHEET_KEY, dims, upp: r.upp, shapes: [], conditions: [] });
  assert.equal(out.entities, 0);
  assert.equal(out.shapes, 0);
  assert.equal(out.extents, null);
  assert.match(out.dxf, /^999\n/, "still a well-formed DXF stream with the authorship stamp first");
});

// ── 2. Regeneration determinism (the safety story) at the store contract level ──

test("2a. regen determinism — the SAME wall built twice hashes identically -> store.addPdf would return {unchanged:true}, no revision archived", async () => {
  const a = await buildWall(18, 8);
  const b = await buildWall(18, 8);
  const ha = await sha256Hex(new Uint8Array(await a.file.arrayBuffer()));
  const hb = await sha256Hex(new Uint8Array(await b.file.arrayBuffer()));
  assert.equal(ha, hb, "identical wall regenerated on demand must never look like a changed sheet to addPdf's SHA-256 compare");
});

test("2b. a CHANGED wall (different height -> different wallStripRing) hashes differently -> store.addPdf archives exactly one deliberate revision", async () => {
  const a = await buildWall(18, 8);
  const b = await buildWall(18, 10); // height change -> wallElevationLayout's solved strip differs -> different drawn bytes
  const ha = await sha256Hex(new Uint8Array(await a.file.arrayBuffer()));
  const hb = await sha256Hex(new Uint8Array(await b.file.arrayBuffer()));
  assert.notEqual(ha, hb, "a real wall change must not hash the same as the prior sheet, or the revision would be silently swallowed");
});

// ── 3. Sheet key parses cleanly ──────────────────────────────────────────

test("3a. parseSheetKey treats the elevation sheet key as an ordinary page-1 sheet — no #page split, no throw", () => {
  const parsed = parseSheetKey(SHEET_KEY);
  assert.deepEqual(parsed, { file: SHEET_KEY, page: 1 });
});

test("3b. a listSheets-shaped [{name: key}] list is well-formed and sorts via compareSheetKeys without throwing", () => {
  const list = [{ name: SHEET_KEY }, { name: "floor-plan.pdf" }, { name: "floor-plan.pdf#2" }];
  assert.ok(list.every((s) => typeof s.name === "string" && s.name.length > 0));
  const sorted = [...list].sort((x, y) => compareSheetKeys(x.name, y.name));
  assert.equal(sorted.length, 3);
  // file-then-page order: "floor-plan.pdf" (page1) < "floor-plan.pdf#2" (page2) < "WT-1-elev-..." (localeCompare on file name)
  assert.deepEqual(sorted.map((s) => s.name), ["floor-plan.pdf", "floor-plan.pdf#2", SHEET_KEY]);
});

// ── 4. Sheet-adjacent subsystems don't choke on the key ─────────────────

test("4a. sheetLevels — sanitizeSheetLevels/groupSheetsByLevel/sortGalleryGroups handle the elevation key like any other sheet", () => {
  const allKeys = [SHEET_KEY, "floor-plan.pdf"];
  const levels = sanitizeSheetLevels({ [SHEET_KEY]: "L1", "floor-plan.pdf": "L1", junk: 42 });
  assert.deepEqual(levels, { [SHEET_KEY]: "L1", "floor-plan.pdf": "L1" });

  const grouped = groupSheetsByLevel(allKeys, levels);
  assert.deepEqual(grouped, [{ level: "L1", keys: allKeys }]);

  const sorted = sortGalleryGroups(grouped, (k: string) => k);
  assert.equal(sorted[0].keys.length, 2);
  assert.ok(sorted[0].keys.includes(SHEET_KEY));
});

test("4a2. sheetLevels — an ungrouped elevation sheet lands in its own trailing Unassigned group, not dropped", () => {
  const allKeys = [SHEET_KEY, "floor-plan.pdf"];
  const levels = sanitizeSheetLevels({ "floor-plan.pdf": "L1" }); // elevation sheet has no level assigned yet
  const grouped = groupSheetsByLevel(allKeys, levels);
  assert.deepEqual(grouped, [
    { level: "L1", keys: ["floor-plan.pdf"] },
    { level: "", keys: [SHEET_KEY] },
  ]);
});

test("4b. sheetGroups — normalizeLoadedGroups accepts the elevation key in sheet_group, shares the lastGroup array instance", () => {
  const { sheetGroup, lastGroup } = normalizeLoadedGroups({ sheet_group: [SHEET_KEY, "floor-plan.pdf"], last_group: [] }, 8);
  assert.deepEqual(sheetGroup, [SHEET_KEY, "floor-plan.pdf"]);
  assert.strictEqual(lastGroup, sheetGroup, "a real (>=2) group shares sheetGroup's own array instance (the reducer's no-op-setState invariant)");
});

test("4b2. sheetGroups — a solo elevation sheet (soloOk) keeps its own single-element group", () => {
  const soloOk = (k: string) => k === SHEET_KEY;
  const { sheetGroup, lastGroup } = normalizeLoadedGroups({ sheet_group: [SHEET_KEY], last_group: [] }, 8, soloOk);
  assert.deepEqual(sheetGroup, [SHEET_KEY]);
  assert.strictEqual(lastGroup, sheetGroup);
});

test("4c. sheetgraph — classifySheetRole reads the elevation sheet's own drawn header as role 'elevation', evidence keyed to the elevation sheet name", async () => {
  const r = await buildWall(18, 8);
  // exact header text buildWallElevationPdf draws (wallElevationPdf.ts:115)
  const header = `${TAG} — ${r.width_ft}'-0" × ${r.height_ft}'-0" elevation`;
  const role = classifySheetRole({ key: SHEET_KEY, spans: [{ str: header, x: 0, y: 0, w: 200, h: 12 }] });
  assert.equal(role.role, "elevation");
  assert.equal(role.confidence, 0.7);
  assert.equal(role.evidence?.sheet, SHEET_KEY);
});

test("4c2. sheetgraph — a text-less elevation sheet degrades gracefully (unknown role, no building), never throws", () => {
  const role = classifySheetRole({ key: SHEET_KEY, spans: [] });
  assert.deepEqual(role, { role: "unknown", confidence: 0, evidence: null });
  assert.equal(sheetBuilding({ key: SHEET_KEY, spans: [] }), null);
});

test("4c3. sheetgraph — buildSheetGraph indexes the elevation sheet by its own key without throwing", async () => {
  const r = await buildWall(18, 8);
  const header = `${TAG} — ${r.width_ft}'-0" × ${r.height_ft}'-0" elevation`;
  const graph = buildSheetGraph([{ key: SHEET_KEY, spans: [{ str: header, x: 0, y: 0, w: 200, h: 12 }] }]);
  assert.equal(graph.available, true);
  assert.equal(graph.sheets.length, 1);
  assert.equal(graph.sheets[0].key, SHEET_KEY);
  assert.equal(graph.sheets[0].role, "elevation");
  assert.deepEqual(graph.rooms, []);
  assert.deepEqual(graph.unmatched_tags, []);
});
