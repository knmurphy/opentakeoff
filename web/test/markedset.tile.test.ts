// Marked-set tile layout sheet (M8, report/export integration) — a deterministic
// node integration test of the real buildMarkedSetPdf (no browser: mock pdf.js
// pages + a real source PDF, same harness as markedset.image.test.ts). Proves:
// a sheet carrying a tiled floor_area shape (under a tile_setup condition) plus
// a non-tiled room gains exactly one NEW "Tile layout" page, drawn to scale from
// the shape's own SOLVED grid — and that omitting the new `uppFor` scale input
// (every caller today) exports byte-identical (no tile page, no behavior change).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as zlib from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { buildMarkedSetPdf } from "../src/lib/markedset.js";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

function mockPage(wPt: number, hPt: number) {
  return {
    rotate: 0,
    getViewport({ scale }: { scale: number }) {
      return { width: wPt * scale, height: hPt * scale, transform: [scale, 0, 0, -scale, 0, hPt * scale] };
    },
  };
}

async function makeSourcePdf() {
  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  return src.save();
}

// pdf-lib's low-level dict/stream classes have protected constructors and no
// public-API surface for walking a page's raw Contents streams (the same
// constraint markedset.image.test.ts's imageXObjectsPerPage/pageText document)
// — this decodes a page's content stream(s) to a plain-text search string.
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

// Decodes a page's Tj hex operands to plain text (drawn strings) — the same
// recovery markedset.image.test.ts uses to prove a drawn STRING landed.
function tjText(raw: string): string {
  const hexTokens = raw.match(/<[0-9A-Fa-f]+>/g) || [];
  return hexTokens.map((h) => Buffer.from(h.slice(1, -1), "hex").toString("latin1")).join("");
}

// Counts path-construction "closepath" (h) operators — one per closed
// 4-corner tile cell this feature draws via drawSvgPath (M l l l h, then a
// paint op). A structural proxy for "how many grid cells actually got
// drawn" that doesn't depend on pdf-lib's exact fill/stroke paint-op choice.
function closedPathCount(raw: string): number {
  let n = 0;
  for (const tok of raw.split(/\s+/)) if (tok === "h") n++;
  return n;
}

// A 4ft x 4ft room: verts_norm in [0,1] against a 100x100px sheet at
// upp=0.04 ft/px (same fixture convention as tileTakeoff.test.ts), tiled
// 12x12in with zero joint — solves to exactly 16 full tiles, no partial cuts.
function makeTiledRoom(condId: string) {
  return {
    id: "tiled-room",
    sheet_id: "S1",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
}

// A second, non-tiled room on its OWN sheet — a plain VCT/paint condition
// with no tile_setup at all; proves a non-tiled sheet never gains a page.
function makeNonTiledRoom(condId: string) {
  return {
    id: "plain-room",
    sheet_id: "S2",
    condition_id: condId,
    measure_role: "floor_area",
    verts_norm: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
}

function makeTileCondition() {
  const tile_setup = mintTileSetup();
  tile_setup.skus[0].w_in = 12;
  tile_setup.skus[0].h_in = 12;
  tile_setup.skus[0].per_box = 8;
  tile_setup.joint.width_in = 0;
  return { id: "tileCond", finish_tag: "CT-1", color: "#2e7d32", multiplier: 1, tile_setup };
}

function baseArgs() {
  const tileCond = makeTileCondition();
  const plainCond = { id: "plainCond", finish_tag: "VCT-1", color: "#8888aa", multiplier: 1 };
  const conditions = [tileCond, plainCond];
  const shapes = [makeTiledRoom(tileCond.id), makeNonTiledRoom(plainCond.id)];
  const sheets = [
    { key: "S1", file: "plan.pdf", page: 1, label: "Sheet 1" },
    { key: "S2", file: "plan.pdf", page: 1, label: "Sheet 2" },
  ];
  return { conditions, shapes, sheets };
}

async function build(srcBytes: Uint8Array, extra: Record<string, unknown> = {}) {
  const { conditions, shapes, sheets } = baseArgs();
  return buildMarkedSetPdf({
    projectName: "Test", dark: false, units: "imperial",
    sheets, shapes, markups: [], approvals: [], rfis: [], conditions,
    company: undefined, clientInfo: undefined,
    getPage: async () => mockPage(612, 792),
    loadPdfData: async () => srcBytes,
    ...extra,
  });
}

test("marked set: no uppFor (every caller today) exports byte-identical — no tile page", async () => {
  const srcBytes = await makeSourcePdf();
  const { bytes } = await build(srcBytes);
  const out = await PDFDocument.load(bytes);
  // cover + sheet S1 + sheet S2, no RFI page, no tile page
  assert.equal(out.getPageCount(), 3);
  for (let i = 0; i < 3; i++) {
    assert.doesNotMatch(tjText(await decodedContentStream(bytes, i)), /Tile layout/);
  }
});

test("marked set: a tiled sheet gains exactly one new 'Tile layout' page, scaled from the solved grid", async () => {
  const srcBytes = await makeSourcePdf();
  const baseline = await build(srcBytes);
  const tiled = await build(srcBytes, { uppFor: (key: string) => (key === "S1" ? 0.04 : null) });

  const baseOut = await PDFDocument.load(baseline.bytes);
  const tiledOut = await PDFDocument.load(tiled.bytes);

  // (a) non-empty PDF bytes with the %PDF header
  assert.ok(tiled.bytes.length > 0);
  assert.equal(Buffer.from(tiled.bytes.slice(0, 5)).toString("latin1"), "%PDF-");

  // (b) page count is +1 vs the same build without a usable scale — S2's
  // room has no tile_setup at all, so it never gains a tile page regardless.
  assert.equal(tiledOut.getPageCount(), baseOut.getPageCount() + 1);
  assert.equal(tiledOut.getPageCount(), 4); // cover, S1, S1's tile layout, S2

  // the tile page is appended right after S1's own marked-up page (index 1)
  const tileText = tjText(await decodedContentStream(tiled.bytes, 2));
  assert.match(tileText, /Tile layout/);
  assert.match(tileText, /Sheet 1/);
  // S2 carries no tile work — no second "Tile layout" page anywhere
  const allText = await Promise.all([0, 1, 2, 3].map(async (i) => tjText(await decodedContentStream(tiled.bytes, i))));
  assert.equal(allText.filter((t) => /Tile layout/.test(t)).length, 1);

  // (c) the tile page draws at least the 16 full-tile grid cells a 4x4ft
  // room tiled 12x12in (0 joint) solves to (matches tileTakeoff.test.ts's
  // own assertion on the identical fixture: counts.full === 16).
  const cellCount = closedPathCount(await decodedContentStream(tiled.bytes, 2));
  assert.ok(cellCount >= 16, `expected >= 16 drawn tile cells, got ${cellCount}`);
});

test("marked set: an unscaled sheet (uppFor returns null) never gets a tile page even with tile work", async () => {
  const srcBytes = await makeSourcePdf();
  const { bytes } = await build(srcBytes, { uppFor: () => null });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 3);
});
