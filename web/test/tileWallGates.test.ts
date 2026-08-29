// web/test/tileWallGates.test.ts
//
// Task 7 (2026-08-29 wall-tile-slice-a): the CLOSE gates that keep a wall
// (`measure_role: "surface_area"`) shape out of the PLAN-space tile overlay
// (it solves in strip-local elevation coords, not the plan ring), stop a
// wall-only condition from opening an empty tile-shop page, and admit walls
// to the QA feeder (tileQA.ts) instead of a silent floor-only drop. Three
// surfaces, three risk areas:
//  (1) markedset.js overlay loop — a wall with a tile summary must draw
//      ZERO quads at its plan ring, and must never contribute a title-block
//      room entry, while a floor sharing the same sheet still renders.
//  (2) markedset.js page-creation gate — a wall-ONLY sheet must never open
//      a "TILE LAYOUT" page (it would render with an empty grid/title
//      block — pure noise); a floor-only sheet is unaffected (no
//      regression).
//  (3) tileQA.ts / dxf.ts — a wall shape is admitted to tileWarnings
//      (generic checks apply, floor-ring-specific rules skip warn-only, no
//      throw) and dxf.ts's tile-grid emission stays floor_area-gated.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as zlib from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { buildMarkedSetPdf } from "../src/lib/markedset.js";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { tileWarnings } from "../src/lib/tileQA.ts";
import { buildSheetDxf } from "../src/lib/dxf.ts";

// ── markedset.js fixtures/helpers — same conventions as markedset.tile.test.ts ──

function mockPage(wPt: number, hPt: number) {
  return {
    rotate: 0,
    getViewport({ scale }: { scale: number }) {
      return { width: wPt * scale, height: hPt * scale, transform: [scale, 0, 0, -scale, 0, hPt * scale] };
    },
  };
}

async function makeSourcePdf(pageCount = 1) {
  const src = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) src.addPage([612, 792]);
  return src.save();
}

async function decodedContentStream(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const out = await PDFDocument.load(bytes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdf-lib internal Page/Contents/Resources have no public type surface for this walk
  const page = out.getPages()[pageIndex] as any;
  const contentsRef = page.node.Contents();
  const refs = contentsRef && typeof contentsRef.asArray === "function" ? contentsRef.asArray() : [contentsRef];
  let raw = "";
  for (const ref of refs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    const stream = out.context.lookup(ref) as any;
    if (!stream) continue;
    const filter = stream.dict && stream.dict.lookup(PDFName.of("Filter"));
    let data: Uint8Array = stream.contents;
    if (filter && String(filter) === "/FlateDecode") data = zlib.inflateSync(Buffer.from(data));
    raw += Buffer.from(data).toString("latin1");
  }
  return raw;
}

function tjText(raw: string): string {
  const hexTokens = raw.match(/<[0-9A-Fa-f]+>/g) || [];
  return hexTokens.map((h) => Buffer.from(h.slice(1, -1), "hex").toString("latin1")).join("");
}

// One "h" (closepath) per closed 4-corner tile cell drawn via drawSvgPath —
// same structural proxy markedset.tile.test.ts uses.
function closedPathCount(raw: string): number {
  let n = 0;
  for (const tok of raw.split(/\s+/)) if (tok === "h") n++;
  return n;
}

// pdf-lib mints a fresh random numeric suffix on every ExtGState ("/GS-...")
// and embedded-font resource name ("/Helvetica-Bold-...") each time a
// document is built — even from byte-identical inputs, two SEPARATE
// buildMarkedSetPdf() calls never share those names. Stripping just the
// digit run glued directly onto a letter (never a bare coordinate — a
// negative coordinate's "-" is always preceded by whitespace, not a
// letter) leaves the actual drawn geometry/paint operators intact for a
// true structural comparison across two builds.
function normalizeRandomIds(raw: string): string {
  return raw.replace(/(?<=[A-Za-z])-\d{6,}\b/g, "");
}

function makeTileCondition(id = "tileCond") {
  const tile_setup = mintTileSetup();
  tile_setup.skus[0].w_in = 12;
  tile_setup.skus[0].h_in = 12;
  tile_setup.skus[0].per_box = 8;
  tile_setup.joint.width_in = 0;
  return { id, finish_tag: "CT-1", color: "#2e7d32", multiplier: 1, tile_setup };
}

// A 4ft x 4ft room (same fixture markedset.tile.test.ts / tileTakeoff.test.ts
// use): solves to exactly 16 full tiles, no partial cuts.
function makeFloorShape(condId: string, sheetId: string, id = "floorShape") {
  return {
    id,
    sheet_id: sheetId,
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
}

// An L-run wall (3 verts, one inside fold) — the SAME shape of fixture
// tileWallTakeoff.test.ts's makeLRunWallShape uses, so it's known to solve
// through summarizeWallShape without an ok:false reject. Deliberately 3+
// verts (not the minimal 2-point straight run): the markedset overlay loop
// ALREADY has a pre-existing `if (ring.length < 3) continue;` guard, so a
// 2-vert wall would get skipped by that old guard alone and never actually
// exercise the NEW `measure_role === "surface_area"` guard this task adds.
// Positioned off in a corner of the sheet's [0,1] frame so it never
// spatially coincides with the floor's own ring — if the overlay skip ever
// regressed, this position would show up as EXTRA drawn cells, not a
// coincidental overlap with the floor's own count.
function makeWallShape(condId: string, sheetId: string, id = "wallShape") {
  return {
    id,
    sheet_id: sheetId,
    condition_id: condId,
    measure_role: "surface_area",
    verts_norm: [[0.6, 0.05], [0.95, 0.05], [0.95, 0.3]],
    face_side: "left",
    height_ft: 8,
  };
}

async function build(srcBytes: Uint8Array, sheets: unknown[], shapes: unknown[], conditions: unknown[], extra: Record<string, unknown> = {}) {
  return buildMarkedSetPdf({
    projectName: "Test", dark: false, units: "imperial",
    sheets, shapes, markups: [], approvals: [], rfis: [], conditions,
    company: undefined, clientInfo: undefined,
    getPage: async () => mockPage(612, 792),
    loadPdfData: async () => srcBytes,
    ...extra,
  });
}

// ── (1) overlay loop: a surface_area shape with a tile summary is skipped ──

test("markedset overlay: a floor+wall sheet renders its tile page BYTE-IDENTICAL to floor-only — the wall draws zero quads and no title-block room", async () => {
  const srcBytes = await makeSourcePdf();
  const tileCond = makeTileCondition();
  const sheets = [{ key: "S1", file: "plan.pdf", page: 1, label: "Sheet 1" }];
  const uppFor = (key: string) => (key === "S1" ? 0.04 : null);

  const floorOnly = await build(srcBytes, sheets, [makeFloorShape(tileCond.id, "S1")], [tileCond], { uppFor });
  const floorPlusWall = await build(
    srcBytes, sheets,
    [makeFloorShape(tileCond.id, "S1"), makeWallShape(tileCond.id, "S1")],
    [tileCond], { uppFor },
  );

  const outFloorOnly = await PDFDocument.load(floorOnly.bytes);
  const outFloorPlusWall = await PDFDocument.load(floorPlusWall.bytes);
  // The wall still solves into tileByShape (Task 6) and the floor still
  // renders, so both builds earn exactly one tile page — page count itself
  // doesn't move.
  assert.equal(outFloorOnly.getPageCount(), 3);
  assert.equal(outFloorPlusWall.getPageCount(), 3);

  const rawFloorOnly = await decodedContentStream(floorOnly.bytes, 2);
  const rawFloorPlusWall = await decodedContentStream(floorPlusWall.bytes, 2);
  assert.match(tjText(rawFloorOnly), /TILE LAYOUT/);

  // The wall's `if (s.measure_role === "surface_area") continue;` fires
  // before it can draw a single quad, push a trim/joint stroke, or add a
  // title-block room entry — so the tile page's drawn content stream is
  // structurally IDENTICAL whether or not the wall shares the sheet with
  // the floor (modulo pdf-lib's own per-build random resource-name
  // suffixes, stripped by normalizeRandomIds). A magic cell-count number
  // would be fragile here (this room's real footprint is the full mock
  // sheet, not a tidy 4x4ft square), so this structural equality is the
  // strongest and most robust proof available.
  assert.equal(
    normalizeRandomIds(rawFloorPlusWall),
    normalizeRandomIds(rawFloorOnly),
    "a surface_area shape must draw nothing on the plan-space tile page",
  );

  assert.equal((tjText(rawFloorOnly).match(/FIELD/g) || []).length, 1, "sanity: exactly one title-block room for the floor");
});

// ── (2) page-creation gate: wall-only never opens an empty tile-shop page ──

test("markedset page gate: a wall-only sheet never opens a tile-shop page", async () => {
  const srcBytes = await makeSourcePdf();
  const tileCond = makeTileCondition();
  const sheets = [{ key: "S1", file: "plan.pdf", page: 1, label: "Sheet 1" }];
  const shapes = [makeWallShape(tileCond.id, "S1")];
  const { bytes } = await build(srcBytes, sheets, shapes, [tileCond], { uppFor: (key: string) => (key === "S1" ? 0.04 : null) });

  const out = await PDFDocument.load(bytes);
  // cover + S1 marked-up ONLY — no empty "TILE LAYOUT" page.
  assert.equal(out.getPageCount(), 2);
  for (let i = 0; i < out.getPageCount(); i++) {
    assert.doesNotMatch(tjText(await decodedContentStream(bytes, i)), /TILE LAYOUT/);
  }
});

test("markedset page gate: a floor-only sheet is unaffected (no regression) — still gets exactly one tile page, drawn cells intact", async () => {
  const srcBytes = await makeSourcePdf();
  const tileCond = makeTileCondition();
  const sheets = [{ key: "S1", file: "plan.pdf", page: 1, label: "Sheet 1" }];
  const shapes = [makeFloorShape(tileCond.id, "S1")];
  const { bytes } = await build(srcBytes, sheets, shapes, [tileCond], { uppFor: (key: string) => (key === "S1" ? 0.04 : null) });

  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3); // cover, S1, S1 tile page
  const raw = await decodedContentStream(bytes, 2);
  const tileText = tjText(raw);
  assert.match(tileText, /TILE LAYOUT/);
  assert.match(tileText, /LEGEND/);
  assert.match(tileText, /FIELD/);
  assert.ok(closedPathCount(raw) > 0, "the floor's own grid cells are still drawn");
});

// ── (3a) tileQA.ts: a wall is admitted, not silently dropped ──

const QA_DIMS = { w: 1000, h: 1000 };
const QA_UPP = 0.01;
const qaDimsFor = (sheetId: string | undefined) => (sheetId === "sheet1" ? QA_DIMS : null);
const qaUppFor = (sheetId: string | undefined) => (sheetId === "sheet1" ? QA_UPP : null);

function makeQaWallCondition(id = "cWall") {
  return { id, finish_tag: "CT-W", tile_setup: mintTileSetup() };
}

test("tileQA: a project containing a wall shape does not throw and returns a warnings array", () => {
  const cond = makeQaWallCondition();
  const wall = { id: "w1", condition_id: cond.id, sheet_id: "sheet1", measure_role: "surface_area", verts_norm: [[0, 0], [0.3, 0]] as [number, number][] };
  assert.doesNotThrow(() => tileWarnings([cond], [wall], qaDimsFor, qaUppFor));
  const warnings = tileWarnings([cond], [wall], qaDimsFor, qaUppFor);
  assert.ok(Array.isArray(warnings));
});

test("tileQA: a wall shape is admitted (generic checks apply) rather than silently dropped by a floor-only filter", () => {
  const cond = makeQaWallCondition();
  // sheet2 is unscaled (dimsFor/uppFor both return null for it) — a wall
  // admitted into the loop surfaces the SAME "unscaled" warning a floor
  // would, proving it reached the generic checks instead of being filtered
  // out at the role gate.
  const wall = { id: "w1", condition_id: cond.id, sheet_id: "sheet2", measure_role: "surface_area", verts_norm: [[0, 0], [0.3, 0]] as [number, number][] };
  const warnings = tileWarnings([cond], [wall], () => null, () => null);
  assert.ok(
    warnings.some((w) => w.kind === "unscaled" && w.shape_id === "w1"),
    `expected an unscaled warning for the wall, got ${JSON.stringify(warnings)}`,
  );
});

test("tileQA: a wall shape never throws through the floor-ring-specific rules (band/solve/per-cell) — those are skipped warn-only", () => {
  const cond = makeQaWallCondition();
  const wall = { id: "w1", condition_id: cond.id, sheet_id: "sheet1", measure_role: "surface_area", verts_norm: [[0, 0], [0.3, 0]] as [number, number][] };
  const warnings = tileWarnings([cond], [wall], qaDimsFor, qaUppFor);
  // On a scaled sheet with a clean tile_setup, a wall generates no
  // floor-ring-specific warnings (no band/sliver/hole_cut/size_mismatch
  // kinds) — it simply passes through without throwing.
  assert.ok(warnings.every((w) => w.shape_id !== "w1" || ["unscaled", "layout", "seam_crossing"].includes(w.kind)));
});

test("tileQA: a degenerate wall (fewer than 2 verts) is excluded, same as computeTileTakeoff's own gate", () => {
  const cond = makeQaWallCondition();
  const wall = { id: "w1", condition_id: cond.id, sheet_id: "sheet1", measure_role: "surface_area", verts_norm: [[0, 0]] as [number, number][] };
  const warnings = tileWarnings([cond], [wall], qaDimsFor, qaUppFor);
  assert.equal(warnings.filter((w) => w.shape_id === "w1").length, 0);
});

// ── (3b) dxf.ts: already floor_area-gated — assert, don't change ──

const DXF_SHEET = "plan.pdf#1";
const DXF_DIMS = { w: 3000, h: 2000 };
const DXF_UPP = 0.05;
const DXF_CONDS = [{ id: "c1", finish_tag: "CT-W" }];

test("dxf: a wall (surface_area) shape emits its own -WALL layer but never a -TILEGRID layer, even if it carried tile_cells", () => {
  const wall = {
    id: "w1", sheet_id: DXF_SHEET, condition_id: "c1", measure_role: "surface_area",
    verts_norm: [[0, 0], [0.1, 0]] as [number, number][],
    // Slice A never actually attaches tile_cells to a wall shape — this
    // proves the gate holds structurally even if a future caller did.
    tile_cells: [{ cls: "full", pts_ft: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][] }],
  };
  const b = buildSheetDxf({ sheet_id: DXF_SHEET, dims: DXF_DIMS, upp: DXF_UPP, shapes: [wall], conditions: DXF_CONDS });
  assert.ok(!b.layers.some((l) => l.endsWith("-TILEGRID")), `expected no -TILEGRID layer, got ${b.layers.join(", ")}`);
  assert.ok(b.layers.some((l) => l.endsWith("-WALL")), `expected a -WALL layer, got ${b.layers.join(", ")}`);
});
