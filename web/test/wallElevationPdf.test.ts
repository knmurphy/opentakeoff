// web/test/wallElevationPdf.test.ts
//
// Task 1 (2026-08-29 wall-tile-slice-b) — buildWallElevationPdf: renders a
// wall's tiled elevation strip (Slice A's wallElevationLayout) into a real,
// deterministic one-page PDF so it can be stored as an ordinary sheet.
// Determinism is the whole safety story here: contribute.js content-hashes
// every stored PDF, so regenerating the SAME wall on demand must reproduce
// byte-identical output or every regen would look like a changed sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWallElevationPdf,
  ELEV_POINTS_PER_FT,
  wallElevationSheetName,
  wallElevationScaleRow,
} from "../src/lib/wallElevationPdf.ts";
import { RENDER_SCALE } from "../src/lib/sheets.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

const setup = { ...mintTileSetup(), skus: [{ id: "a", name: "A", w_in: 12, h_in: 12, color: "#3b82f6" }], joint: { width_in: 0 } };
const layout = solveTileLayout({ tile_setup: setup, ring_ft: wallStripRing(18, 8) });

test("builds a valid one-page PDF with correct point dims and upp", async () => {
  const r = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  assert.equal(r.width_ft, 18);
  assert.equal(r.height_ft, 8);
  assert.ok(Math.abs(r.upp - 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE)) < 1e-9);
  const bytes = new Uint8Array(await r.file.arrayBuffer());
  assert.ok(bytes.length > 500);
  // PDF magic
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.match(r.file.name, /\.pdf$/);
});

test("is DETERMINISTIC — identical input yields byte-identical output (no timestamps)", async () => {
  const a = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const b = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const ba = new Uint8Array(await a.file.arrayBuffer()), bb = new Uint8Array(await b.file.arrayBuffer());
  assert.deepEqual([...ba], [...bb]); // determinism is what makes regen-on-demand safe
});

// The magic-bytes/length checks above don't pin the thing that actually
// matters: that the page geometry (drawn at ELEV_POINTS_PER_FT pt/ft) and
// the reported `upp` describe the SAME scale. If a future edit changed the
// drawing scale (e.g. `P` accidentally became ELEV_POINTS_PER_FT*RENDER_SCALE)
// without updating `upp` to match, every prior assertion would still pass
// while every downstream measurement on the stored sheet silently broke.
test("the drawn page is really one page, and its point width round-trips to width_ft via upp+RENDER_SCALE", async () => {
  const r = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await r.file.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width } = doc.getPage(0).getSize();
  const MARGIN = 24; // pt: matches wallElevationPdf.ts's own left/right margin
  const stripWidthPt = width - MARGIN * 2;
  // stripWidthPt is feet*ELEV_POINTS_PER_FT by construction; upp is feet/px
  // at RENDER_SCALE px/pt, so stripWidthPt*RENDER_SCALE*upp must equal width_ft.
  assert.ok(Math.abs(stripWidthPt * RENDER_SCALE * r.upp - r.width_ft) < 1e-6);
});

// Both prior builds pass folds:[] — the fold-drawing branch (drawLine with a
// dashArray, drawText(f.kind)) never runs. Task 2+ calls this with REAL
// folds (every wrap/reset wall run produces at least one), so a fold that
// throws at runtime — e.g. Helvetica's WinAnsi encoding rejecting a
// character in "inside"/"outside" — would only surface there. Assert the
// call doesn't throw AND that it actually emits different bytes than the
// no-folds build, proving the branch isn't a silent no-op.
test("a real fold draws without throwing and changes the output bytes", async () => {
  const withFold = await buildWallElevationPdf({
    wallStrips: [layout],
    folds: [{ u_ft: 10.5, kind: "inside", vertexIndex: 1 }],
    skuColor: () => "#3b82f6",
    tag: "WT-1",
    name: "WT-1-elevation.pdf",
  });
  const noFold = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const a = new Uint8Array(await withFold.file.arrayBuffer());
  const b = new Uint8Array(await noFold.file.arrayBuffer());
  assert.notEqual(a.length, b.length, "the fold's line + label add real content, not a no-op");
});

// ── wallElevationSheetName — later tasks store the generated PDF under a
// stable, collision-free sheet key (the FULL shapeId, never truncated, so
// two walls sharing a tag never collide on a shortened id). ──

test("wallElevationSheetName: two shapeIds under the same tag produce distinct names", () => {
  const n1 = wallElevationSheetName("WT-1", "shape-aaaa-1111");
  const n2 = wallElevationSheetName("WT-1", "shape-bbbb-2222");
  assert.notEqual(n1, n2);
  assert.match(n1, /\.pdf$/);
  assert.match(n2, /\.pdf$/);
});

test("wallElevationSheetName: embeds the tag and the FULL shape id, never truncated", () => {
  const shapeId = "shape-0123456789abcdef0123456789abcdef";
  const name = wallElevationSheetName("WT-1", shapeId);
  assert.equal(name, `WT-1-elev-${shapeId}.pdf`);
  assert.ok(name.includes(shapeId), "the full id survives in the name, not a prefix/suffix of it");
});

// ── wallElevationScaleRow — the scale-provenance row the sheet registry
// records for a generated elevation PDF. It is a KNOWN scale (we drew it),
// not an agent guess, so unlike agent-set scale rows elsewhere in the app
// it carries no scale_confirmed field/gate. ──

test("wallElevationScaleRow: carries the exact upp and a source string, no scale_confirmed field", () => {
  const upp = 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE);
  const row = wallElevationScaleRow(upp);
  assert.equal(row.units_per_px, upp);
  assert.equal(typeof row.scale_source, "string");
  assert.ok(row.scale_source.length > 0);
  assert.equal("scale_confirmed" in row, false, "a generated elevation PDF is a known scale, not an unconfirmed agent guess");
});
