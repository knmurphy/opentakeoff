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
  formatFeetInches,
  wallElevationSheetName,
  wallElevationScaleRow,
} from "../src/lib/wallElevationPdf.ts";
import { RENDER_SCALE } from "../src/lib/sheets.ts";
import { solveTileLayout } from "../src/lib/tileSolve.ts";
import { wallStripRing } from "../src/lib/tileWall/unwrap.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { wallElevationLayout } from "../src/lib/tileWallElevation.ts";
import { developedElevationLayout } from "../src/lib/developedElevation.ts";

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
  // Compare CONTENT, not just byte length: under object-stream compression
  // two different content streams can compress to coincidentally-equal
  // lengths, so a length-only check doesn't actually prove the fold changed
  // the output.
  assert.notDeepEqual([...a], [...b], "the fold's line + label add real content, not a no-op");
});

// The two determinism tests above (and the one below) only exercise the
// NO-FOLDS path (folds:[]). Task 2+ regenerates real walls that always have
// at least one fold, so determinism has to hold on THAT path too — e.g. a
// future refactor that iterates a Map/Set for fold labels (insertion order
// is stable per-process but a Map keyed by object identity or rebuilt from
// an unordered structure would not be) would silently break cross-session
// regen determinism while every folds:[] test kept passing.
test("is DETERMINISTIC with a NON-EMPTY folds array — same real 2-fold wall yields byte-identical output", async () => {
  const foldedLayout = solveTileLayout({ tile_setup: setup, ring_ft: wallStripRing(18, 8) });
  const folds = [
    { u_ft: 6, kind: "inside" as const, vertexIndex: 1 },
    { u_ft: 12, kind: "outside" as const, vertexIndex: 2 },
  ];
  const a = await buildWallElevationPdf({ wallStrips: [foldedLayout], folds, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const b = await buildWallElevationPdf({ wallStrips: [foldedLayout], folds, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const ba = new Uint8Array(await a.file.arrayBuffer()), bb = new Uint8Array(await b.file.arrayBuffer());
  assert.deepEqual([...ba], [...bb]); // the fold-drawing branch must be just as deterministic as the folds:[] path
});

// ── Task 3 v2 (2026-08-29 wall-tile-slice-c) — the generated SHEET now
// draws the DEVELOPED elevation (developedElevationLayout's per-wall
// panels, gap-separated) instead of one continuous strip. The returned
// width_ft/upp contract Slice B's handler depends on must survive: upp is
// a per-foot constant (unchanged), width_ft is now the DRAWN width
// (dev.total_width_ft, wider than the raw run whenever a fold splits it
// into more than one panel). ──

const L_RUN_FOLDS = [{ u_ft: 6, kind: "inside" as const, vertexIndex: 1 }];

test("an L-run's returned width_ft equals the developed total_width_ft (wider than the raw run); a straight run's width is unchanged", async () => {
  const straight = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  assert.equal(straight.width_ft, 18, "one panel, no gap — same as the raw run width");

  const lRun = await buildWallElevationPdf({ wallStrips: [layout], folds: L_RUN_FOLDS, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  // Recompute the expected developed layout independently (same inputs,
  // same pipeline buildWallElevationPdf itself runs) rather than hardcode a
  // literal, so this test pins the CONTRACT (returned width_ft ==
  // developedElevationLayout's total_width_ft) and not a magic number tied
  // to today's default gap.
  const elev = wallElevationLayout([layout], L_RUN_FOLDS, () => "#3b82f6");
  const dev = developedElevationLayout({
    tiles: elev.tiles,
    foldsU: elev.folds.map((f) => f.x),
    foldKinds: elev.folds.map((f) => f.kind),
    width_ft: elev.width_ft,
    height_ft: elev.height_ft,
  });
  assert.equal(lRun.width_ft, dev.total_width_ft);
  assert.ok(lRun.width_ft > 18, `expected the developed width (raw 18ft run + a corner gap) to exceed the raw run, got ${lRun.width_ft}`);
});

// The width_ft test above only pins the RETURNED value; it doesn't prove the
// PAGE was actually drawn that wide. Without this, `pageW` could regress to
// `elev.width_ft * P + MARGIN*2` (the pre-Task-3v2 formula) while `width_ft`
// still reported `dev.total_width_ft` — every other test in this file would
// stay green, but every shape measured on a folded wall's stored sheet would
// be silently misplaced (the same failure mode the straight-run round-trip
// test below already guards, which only exercises the unchanged single-panel
// path and can't catch a page-width/width_ft divergence on the panel path).
test("an L-run's drawn PAGE width round-trips to width_ft via upp+RENDER_SCALE too (not just the straight-run page)", async () => {
  const lRun = await buildWallElevationPdf({ wallStrips: [layout], folds: L_RUN_FOLDS, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await lRun.file.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  const { width } = doc.getPage(0).getSize();
  const MARGIN = 24; // pt: matches wallElevationPdf.ts's own left/right margin
  const stripWidthPt = width - MARGIN * 2;
  assert.ok(Math.abs(stripWidthPt * RENDER_SCALE * lRun.upp - lRun.width_ft) < 1e-6);
});

test("upp is IDENTICAL for a straight run and an L-run — a per-foot constant, unaffected by the page growing wider for panel gaps", async () => {
  const straight = await buildWallElevationPdf({ wallStrips: [layout], folds: [], skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const lRun = await buildWallElevationPdf({ wallStrips: [layout], folds: L_RUN_FOLDS, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  assert.equal(straight.upp, lRun.upp);
  assert.ok(Math.abs(lRun.upp - 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE)) < 1e-9);
});

test("is DETERMINISTIC with PANELS — an L-run (gap-separated panels + a break-line) built twice is byte-identical", async () => {
  const a = await buildWallElevationPdf({ wallStrips: [layout], folds: L_RUN_FOLDS, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const b = await buildWallElevationPdf({ wallStrips: [layout], folds: L_RUN_FOLDS, skuColor: () => "#3b82f6", tag: "WT-1", name: "WT-1-elevation.pdf" });
  const ba = new Uint8Array(await a.file.arrayBuffer()), bb = new Uint8Array(await b.file.arrayBuffer());
  assert.deepEqual([...ba], [...bb]); // regen-on-demand safety must hold on the panel-drawing path too, not just the old single-strip path
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

// ── formatFeetInches — the header's feet value is fractional (e.g. an L-run
// panel's real width isn't always a whole foot), so the header needs real
// feet-inches formatting instead of the old `${ft}'-0"` literal, which
// printed nonsense like "17.5'-0\"" for a 17.5ft run. ──

test("formatFeetInches: whole feet", () => {
  assert.equal(formatFeetInches(18), "18'-0\"");
});

test("formatFeetInches: fractional feet round to the nearest inch", () => {
  assert.equal(formatFeetInches(17.5), "17'-6\"");
  assert.equal(formatFeetInches(10.25), "10'-3\"");
});

test("formatFeetInches: carries into the next foot instead of overflowing to 12 inches", () => {
  assert.equal(formatFeetInches(11.98), "12'-0\"");
});

test("formatFeetInches: zero", () => {
  assert.equal(formatFeetInches(0), "0'-0\"");
});

test("wallElevationScaleRow: carries the exact upp and a source string, no scale_confirmed field", () => {
  const upp = 1 / (ELEV_POINTS_PER_FT * RENDER_SCALE);
  const row = wallElevationScaleRow(upp);
  assert.equal(row.units_per_px, upp);
  assert.equal(typeof row.scale_source, "string");
  assert.ok(row.scale_source.length > 0);
  assert.equal("scale_confirmed" in row, false, "a generated elevation PDF is a known scale, not an unconfirmed agent guess");
});
