// Reads every public input through ONE checkout's reader and writes the result
// as JSON, so two checkouts (base and PR head) can be diffed field by field.
//
//   cd <CHECKOUT>/mcp && node --import tsx <repro>/measure.mts <CHECKOUT> <PDF_ROOT> <OUT.json> [BOXES.json]
//
// CHECKOUT  the tree whose reader is measured (its web/src/lib + mcp/src/pdf.ts)
// PDF_ROOT  the PR-head checkout: the inputs (bundled demo, mcp/test/fixtures/*.pdf)
//           come from here for both runs. Every PDF except reader483-set.pdf (new
//           in the PR) is byte-identical at base and head.
// BOXES     optional: the drawn boxes for the sweep (section e). Without it the
//           script lists this checkout's own table regions and page boxes.
//
// Public data only: the bundled demo, tracked fixtures, synthetic twins.
// For (c) the checkout must hold the PR's web/test/fixtures/reader483Fixtures.ts
// (copy it into a base checkout; it imports only exports base already has).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const [ROOT, PDF_ROOT, OUT, BOXES] = process.argv.slice(2).map((p, i) => (i < 3 || p ? resolve(p) : p));
if (!ROOT || !PDF_ROOT || !OUT) throw new Error("usage: measure.mts <CHECKOUT> <PDF_ROOT> <OUT.json> [BOXES.json]");

const { openPdf, textSpans } = await import(join(ROOT, "mcp/src/pdf.ts"));
const { pageSpans, spansInRect, graphSpans } = await import(join(ROOT, "web/src/lib/pageSpans.ts"));
const { readScheduleSpans } = await import(join(ROOT, "web/src/lib/scheduleRead.ts"));
const { buildSheetGraph, readFinishTable } = await import(join(ROOT, "web/src/lib/sheetgraph.ts"));
const { extractSheetNumber } = await import(join(ROOT, "web/src/lib/sheets.ts"));
const { RENDER_SCALE } = await import(join(ROOT, "web/src/lib/takeoffConstants.ts"));

type Rect = { x0: number; y0: number; x1: number; y1: number };
const SHEET: Rect = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
const rt = (v: unknown) => JSON.parse(JSON.stringify(v));

const DEMO = join(PDF_ROOT, "web/public/demo/sample-finish-plan.pdf");
const FIX = join(PDF_ROOT, "mcp/test/fixtures");
const PDFS: Record<string, string> = { "sample-finish-plan.pdf (demo)": DEMO };
for (const f of readdirSync(FIX).filter((f) => f.endsWith(".pdf")).sort()) PDFS[f] = join(FIX, f);

const docs = new Map<string, Awaited<ReturnType<typeof openPdf>>>();
const doc = async (f: string) => { if (!docs.has(f)) docs.set(f, await openPdf(f)); return docs.get(f)!; };
/** The canvas's marquee read of a box (the MCP's render scale), as scheduleImport.test.ts reads it. */
async function marquee(file: string, page: number, rect: Rect) {
  const ph = await (await doc(file)).page(page);
  const spans = graphSpans(spansInRect(pageSpans(ph.textContent.items, ph.viewport.transform, RENDER_SCALE), rect));
  const f = readFinishTable({ key: "crop", spans }, { marquee: true });
  return { spanCount: spans.length, readScheduleSpans: rt(readScheduleSpans(spans)), finishRows: f ? rt({ otherFamily: "refused" in f, rows: f.table.rows }) : null };
}

const out: Record<string, unknown> = { checkout: process.env.CHECKOUT_LABEL ?? "checkout" }; // a label, not a local path

// (a) the demo's MATERIAL SCHEDULE: the table box scheduleImport.test.ts reads, and the page box
out.a = {
  table: await marquee(DEMO, 2, { x0: 2950, y0: 250, x1: 4720, y1: 1900 }),
  page: await marquee(DEMO, 2, SHEET),
};

// (b) the tracked fixture reader483-set.pdf, the boxes scheduleImport.test.ts reads (PR-only input)
const R483 = join(FIX, "reader483-set.pdf");
const boxes483: Record<number, Rect> = { 1: { x0: 80, y0: 60, x1: 1150, y1: 940 }, 2: { x0: 80, y0: 60, x1: 1150, y1: 330 }, 3: { x0: 80, y0: 60, x1: 1150, y1: 370 } };
out.b = {} as Record<string, unknown>;
for (const n of [1, 2, 3]) (out.b as Record<string, unknown>)[`p${n}`] = { table: await marquee(R483, n, boxes483[n]), page: await marquee(R483, n, SHEET) };

// (c) the synthetic characterization twins, through the PR's own fixture module
const fxPath = join(ROOT, "web/test/fixtures/reader483Fixtures.ts");
if (existsSync(fxPath)) {
  const { TWINS, liveTwin, liveControls } = await import(fxPath);
  out.c = { twins: Object.fromEntries(TWINS.map((t: { name: string }) => [t.name, rt(liveTwin(t as never))])), controls: rt(liveControls()) };
}

// (d) whole-sheet reads: every page of each PDF into one graph, as mcp/src/session.ts builds it
// (textSpans → {x: x0, y: y0, w, h, rot}; sheet_number via extractSheetNumber). segs (the
// drawn-delta linework) are left out in both checkouts; they feed only revision markers.
out.d = {} as Record<string, unknown>;
const regions: Array<{ file: string; page: number; box: string; rect: Rect }> = [];
for (const [name, file] of Object.entries(PDFS)) {
  const d = await doc(file);
  const inputs = [];
  for (let n = 1; n <= d.numPages; n++) {
    const ph = await d.page(n);
    const spans = textSpans(ph).map((t: { str: string; x0: number; y0: number; x1: number; y1: number; rot?: number }) => ({ str: t.str, x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0, ...(t.rot ? { rot: t.rot } : {}) }));
    inputs.push({ key: `p${n}`, sheet_number: extractSheetNumber(ph.textContent, ph.viewport), spans });
    regions.push({ file: name, page: n, box: "page", rect: SHEET });
  }
  const g = buildSheetGraph(inputs);
  (out.d as Record<string, unknown>)[name] = { pages: d.numPages, graph: rt(g) };
  for (const t of g.tables) for (const part of t.parts?.length ? t.parts : [t]) {
    const [x0, y0, x1, y1] = part.region; const pad = 12; // Bbox = [x0, y0, x1, y1]
    regions.push({ file: name, page: Number(String(part.sheet).slice(1)), box: `${t.kind} table "${t.title?.text ?? ""}" region`, rect: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } });
  }
}
out.regions = regions;

// (e) the drawn-box sweep: each box read as a marquee
const sweep = BOXES ? JSON.parse(readFileSync(BOXES, "utf8")) : regions;
out.e = [];
for (const b of sweep) (out.e as unknown[]).push({ ...b, ...(await marquee(PDFS[b.file], b.page, b.rect)) });

writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${OUT}`);
