// Region detection through the MCP (docs/design/REGION_ANNOTATION_PLAN.md,
// tasks 8 and 9): the adapter that turns a loaded page into the detector's
// source-neutral DetectSheet, and find_text's sheet_region. Real pdf.js parses
// of the committed sheets the plan names; the expected edges come from the
// plan's own end-to-end list (and the sheets' drawings), not from this code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { Session } from "../src/session.ts";
import { extractPageTokens } from "../../web/src/lib/sheets.ts";
import { parseSheetKey } from "../../web/src/lib/sheetKey.ts";
import { detectSetRegions } from "../../web/src/lib/regionDetect.ts";
import { RENDER_SCALE } from "../../web/src/lib/sheets.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const A601 = here("../../evals/four-asks-2026-09-02/sheets/va-dublin-bldg9a-finish-plan-A601.pdf");
const C300 = here("../../evals/four-asks-2026-09-02/sheets/va-shreveport-fisher-house-site-utility-C300.pdf");
const PORTERVILLE = here("../../evals/mcp-workflow-bench/plan-set/porterville/porterville-adu-a1-101.pdf");
const MB_SET = here("./fixtures/multibuilding-set.pdf");

async function loaded(file: string): Promise<Session> {
  const s = new Session();
  await s.loadPlan(file);
  return s;
}
const keyOf = (file: string) => path.basename(file);
// the session's own page handle (private); tests read it to compare against the web adapter
const pageOf = (s: Session, key: string) => (s as unknown as { sheet(k: string): { page: { textContent: never; viewport: never } } }).sheet(key).page;

// ── task 8: the adapter ─────────────────────────────────────────────────────

test("detectSheet: displayed orientation on a /Rotate 90 page (Dublin A601)", async () => {
  // the unrotated page, read independently of pdf.js: pdf-lib's MediaBox and /Rotate
  const raw = (await PDFDocument.load(await readFile(A601))).getPage(0);
  assert.equal(raw.getRotation().angle, 90);
  const { width: mw, height: mh } = raw.getSize();
  assert.ok(mw < mh, `A601's MediaBox is portrait (${mw}×${mh}); it displays landscape`);

  const s = await loaded(A601);
  const d = await s.detectSheet(keyOf(A601));
  assert.equal(d.key, keyOf(A601));
  // w/h swapped against the unrotated page: the detector sees what the canvas shows
  assert.equal(d.w, mh * RENDER_SCALE);
  assert.equal(d.h, mw * RENDER_SCALE);
  assert.deepEqual(d.pageIn, [mh / 72, mw / 72]);
  assert.equal(d.source, "vector");
  assert.ok(d.tokens.length > 100, `text layer read (${d.tokens.length} tokens)`);
  assert.ok(d.lines.length > 4, `long rules read (${d.lines.length})`);
  // every token and rule lies on the displayed page
  for (const t of d.tokens) assert.ok(t.x >= -1 && t.x <= d.w + 1 && t.y >= -1 && t.y <= d.h + 1, JSON.stringify(t));
  for (const l of d.lines) assert.ok(l.x0 >= -1 && l.x1 <= d.w + 1 && l.y0 >= -1 && l.y1 <= d.h + 1, JSON.stringify(l));
});

test("detectSheet: session sheet keys round-trip through parseSheetKey (multi-page, merged, '#' in a file name)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "regions-key-"));
  try {
    const hashName = path.join(dir, "plan#2.pdf");
    await copyFile(MB_SET, hashName);
    const s = new Session();
    const first = (await s.loadPlan(MB_SET)).page_count;
    await s.loadPlan(hashName, { merge: true });
    const sheets = s.sheetList();
    assert.ok(first >= 2 && sheets.length === 2 * first, "two multi-page documents");
    for (const sh of sheets) {
      const p = parseSheetKey(sh.key);
      assert.equal(p.file, sh.ord <= first ? path.basename(MB_SET) : "plan#2.pdf", sh.key);
      assert.equal(p.page, sh.pageNum, sh.key);
      // the session's own inverse agrees with the web codec
      assert.equal(s.fileFor(sh.key), p.file, sh.key);
      assert.equal((await s.detectSheet(sh.key)).key, sh.key);
    }
    assert.ok(sheets.some((sh) => sh.key === "plan#2.pdf#2"), "page 2 of a file whose name holds '#'");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Pair each web token with the MCP token that starts at the same baseline
 * point. Runs the text layer joined (textjoin.ts: "WB" + "-" + "01") have no
 * start of their own in the MCP list; they must lie on the joined token. */
function compareTokens(web: { str: string; x: number; y: number; w: number; h: number; rot: number }[], mine: { str: string; x: number; y: number; w?: number; h: number; rot?: number }[]) {
  const TOL = 0.2; // the MCP rounds run origins to 0.1 px
  let paired = 0, joined = 0;
  const unmatched: string[] = [];
  const hRatio: number[] = [];
  const wDiff: number[] = [];
  const used = new Set<number>();
  for (const t of web) {
    const at = (i: number) => {
      const u = mine[i];
      return !used.has(i) && Math.abs(u.x - t.x) <= TOL && Math.abs(u.y - t.y) <= TOL && (u.rot ?? 0) === t.rot && u.str.startsWith(t.str);
    };
    const i = mine.findIndex((_, k) => at(k));
    if (i >= 0) {
      const m = mine[i];
      used.add(i);
      paired++;
      hRatio.push(m.h / t.h);
      if (m.str === t.str) wDiff.push(Math.abs((m.w ?? 0) - t.w));
      continue;
    }
    if (mine.some((u) => u.str.includes(t.str) && u.str !== t.str)) { joined++; continue; }
    unmatched.push(t.str);
  }
  return { paired, joined, unmatched, hRatio, wDiff };
}

for (const [name, file] of [["Dublin A601", A601], ["Porterville", PORTERVILLE], ["Shreveport C300", C300]] as const) {
  test(`detectSheet tokens agree with the web's extractPageTokens on ${name}`, async () => {
    const s = await loaded(file);
    const ph = pageOf(s, keyOf(file));
    const web = extractPageTokens(ph.textContent, ph.viewport);
    const mine = (await s.detectSheet(keyOf(file))).tokens;
    const r = compareTokens(web, mine);
    assert.deepEqual(r.unmatched, [], "every web token is an MCP token, or a run joined into one");
    assert.equal(r.paired + r.joined, web.length);
    assert.equal(mine.length, r.paired, "each MCP token starts where a web token starts");
    // same glyph height convention (the composed transform's column norm)
    for (const k of r.hRatio) assert.ok(Math.abs(k - 1) < 1e-3, `h ratio ${k}`);
    // unjoined runs: same advance width, to rounding
    for (const d of r.wDiff) assert.ok(d <= 0.2, `w differs by ${d}`);
  });
}

// ── end to end: the plan's three committed sheets ───────────────────────────

const titleBlockEdge = async (file: string) => {
  const s = await loaded(file);
  const d = await s.detectSheet(keyOf(file));
  const { regions } = detectSetRegions([d]);
  const m = regions.get(d.key)!;
  return { m, edge: m.group_sig?.edge ?? null };
};

test("end to end: Porterville → right strip", async () => {
  const { m, edge } = await titleBlockEdge(PORTERVILLE);
  assert.equal(edge, "right");
  const tb = m.regions.find((r) => r.kind === "title_block")!;
  assert.ok(tb.bbox[0] > m.w * 0.75, `strip starts in the right quarter (${tb.bbox[0]} of ${m.w})`);
});

test("end to end: Shreveport C300 → bottom strip, not the right legend column", async () => {
  const { m, edge } = await titleBlockEdge(C300);
  assert.equal(edge, "bottom");
  const tb = m.regions.find((r) => r.kind === "title_block")!;
  assert.ok(tb.bbox[1] > m.h * 0.75, `strip starts in the bottom quarter (${tb.bbox[1]} of ${m.h})`);
  assert.ok(tb.bbox[2] - tb.bbox[0] > m.w * 0.9, "border to border along the bottom");
});

test("end to end: Dublin A601 (/Rotate 90) → bottom strip of the displayed page", async () => {
  const { m, edge } = await titleBlockEdge(A601);
  assert.equal(edge, "bottom");
  assert.ok(m.w > m.h, "displayed landscape");
});

// ── task 9: find_text's sheet_region ────────────────────────────────────────

type Hit = { str: string; center: [number, number]; sheet_region?: { kind: string; source: string; label: string; path: string[] } | null };
type Found = { hits: Hit[]; regions_unavailable?: string };
const find = async (s: Session, sheet: string, q: string): Promise<Found> =>
  (await s.findTextWithRegions(sheet, q, { limit: 500 })) as Found;

test("find_text: the sheet's own number sits in the title block (Dublin A601)", async () => {
  const s = await loaded(A601);
  const r = await find(s, keyOf(A601), "A-601");
  assert.equal(r.regions_unavailable, undefined);
  assert.ok(r.hits.length >= 1);
  assert.ok(r.hits.some((h) => h.str.trim() === "A-601" && h.sheet_region?.kind === "title_block"), JSON.stringify(r.hits));
  const tb = r.hits.find((h) => h.sheet_region?.kind === "title_block")!.sheet_region!;
  assert.equal(tb.source, "vector");
  assert.equal(tb.label, "Title block");
});

test("find_text: room names on the plan are in the drawing area (Dublin A601)", async () => {
  const s = await loaded(A601);
  // STORAGE labels a room on the plan and a row in the finish schedule above it; both are drawing
  const r = await find(s, keyOf(A601), "STORAGE");
  assert.ok(r.hits.length >= 2, JSON.stringify(r.hits));
  for (const h of r.hits) assert.equal(h.sheet_region?.kind, "drawing_area", JSON.stringify(h));
  const mech = await find(s, keyOf(A601), "MECHANICAL");
  assert.ok(mech.hits.length >= 2);
  for (const h of mech.hits) assert.equal(h.sheet_region?.kind, "drawing_area", JSON.stringify(h));
});

test("find_text: Porterville's own number in the right strip; its detail references in the drawing area", async () => {
  const s = await loaded(PORTERVILLE);
  const r = await find(s, keyOf(PORTERVILLE), "A1-101");
  const own = r.hits.filter((h) => h.str.trim() === "A1-101");
  assert.equal(own.length, 1);
  assert.equal(own[0].sheet_region?.kind, "title_block");
  const refs = r.hits.filter((h) => h.str.trim() !== "A1-101");
  assert.ok(refs.length >= 3, "detail callouts reference the sheet");
  for (const h of refs) assert.equal(h.sheet_region?.kind, "drawing_area", JSON.stringify(h));
});

/** A synthetic sheet with a border and no title block: a 1224×792 pt page,
 * one ruled border 36 pt in, a room label inside it and a grid label in the
 * margin outside it. */
async function noTitleBlockPdf(file: string) {
  const { StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([1224, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 36, y: 36, width: 1152, height: 720, borderWidth: 1.5 });
  page.drawText("OFFICE 101", { x: 600, y: 400, size: 12, font });
  page.drawText("LOBBY 102", { x: 300, y: 600, size: 12, font });
  page.drawText("GRID 7", { x: 4, y: 400, size: 8, font });   // left margin, outside the border
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, await doc.save());
}

test("find_text: a sheet with no title block → drawing_area only; margin text → null", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "regions-notb-"));
  try {
    const file = path.join(dir, "no-title-block.pdf");
    await noTitleBlockPdf(file);
    const s = await loaded(file);
    const key = keyOf(file);
    const d = await s.detectSheet(key);
    assert.ok(d.lines.length >= 4, `the border's rules are read (${d.lines.length})`);
    for (const q of ["OFFICE 101", "LOBBY 102"]) {
      const r = await find(s, key, q);
      assert.equal(r.hits.length, 1, q);
      assert.equal(r.hits[0].sheet_region?.kind, "drawing_area", q);
    }
    const margin = await find(s, key, "GRID 7");
    assert.equal(margin.hits.length, 1);
    assert.equal(margin.hits[0].sheet_region, null, "border margin text falls in no region");
    assert.ok("sheet_region" in margin.hits[0], "null is stated, not omitted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("find_text: past the cap, hits carry no sheet_region and the result says why", async () => {
  const s = await loaded(A601);
  s.regionCap = { sheets: 0, ms: 20_000 };
  const r = await find(s, keyOf(A601), "A-601");
  assert.ok(r.hits.length >= 1);
  for (const h of r.hits) assert.ok(!("sheet_region" in h));
  assert.match(r.regions_unavailable ?? "", /1 sheet.*0-sheet/);

  const t = await loaded(A601);
  t.regionCap = { sheets: 60, ms: 0 };
  const rt = await find(t, keyOf(A601), "A-601");
  for (const h of rt.hits) assert.ok(!("sheet_region" in h));
  assert.match(rt.regions_unavailable ?? "", /0 s/);
});

test("find_text: concurrent first calls share one detection; the result is cached for the set", async () => {
  const s = await loaded(A601);
  const p1 = s.regionSet(), p2 = s.regionSet();
  assert.equal(p1, p2, "one in-flight promise");
  const [a, b] = await Promise.all([find(s, keyOf(A601), "STORAGE"), find(s, keyOf(A601), "A-601")]);
  assert.ok(a.hits[0].sheet_region && b.hits[0].sheet_region);
  assert.equal(s.regionDetections, 1);
  await find(s, keyOf(A601), "MECHANICAL");
  assert.equal(s.regionDetections, 1, "a later call reuses the map");
  assert.equal(s.regionSet(), p1);
});

test("find_text: load_plan clears the region cache (replace and merge)", async () => {
  const s = await loaded(A601);
  const first = s.regionSet();
  await first;
  await s.loadPlan(A601);                      // same file, replaced session
  const second = s.regionSet();
  assert.notEqual(second, first);
  await find(s, keyOf(A601), "A-601");
  assert.equal(s.regionDetections, 2);
  await s.loadPlan(PORTERVILLE, { merge: true });
  const third = s.regionSet();
  assert.notEqual(third, second);
  const r = await third;
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([...r.map.keys()].sort(), [keyOf(A601), keyOf(PORTERVILLE)].sort(), "the merged set is detected together");
  assert.equal(s.regionDetections, 3);
  // the merged set: each sheet keeps its own strip
  assert.equal((await find(s, keyOf(PORTERVILLE), "A1-101")).hits.find((h) => h.str.trim() === "A1-101")?.sheet_region?.kind, "title_block");
  assert.equal((await find(s, keyOf(A601), "A-601")).hits[0].sheet_region?.kind, "title_block");
});

test("find_text: region overrides on an imported takeoff apply in memory and are never written", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "regions-ov-"));
  try {
    const s = await loaded(A601);
    const key = keyOf(A601);
    const before = await find(s, key, "STORAGE");
    const plan = before.hits.find((h) => h.center[1] > 1500)!;   // the room label on the plan, not the schedule row
    const { w, h } = await s.detectSheet(key);
    const [cx, cy] = plan.center;
    const doc = {
      ...s.exportPayload(),
      region_overrides: {
        sheets: {
          [key]: {
            regions: [{ id: "u:legend", kind: "legend", parent: "drawing_area", bbox: [(cx - 50) / w, (cy - 50) / h, (cx + 50) / w, (cy + 50) / h], evidence: [], confidence: 0.2, source: "vector" }],
            removed: ["title_block"],
          },
        },
        junk: 42,
      },
    };
    const file = path.join(dir, "takeoff.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify(doc));
    const { importTakeoff } = await import("../src/importing.ts");
    await importTakeoff(s, file);

    const after = await find(s, key, "STORAGE");
    const moved = after.hits.find((x) => x.center[0] === cx && x.center[1] === cy)!;
    assert.equal(moved.sheet_region?.kind, "legend");
    assert.equal(moved.sheet_region?.source, "user", "a correction is the user's");
    assert.deepEqual(moved.sheet_region?.path, ["Legend"]);
    // the removed title block: the sheet number now falls outside every region
    assert.equal((await find(s, key, "A-601")).hits[0].sheet_region, null);
    assert.equal(s.regionDetections, 1, "overrides re-apply to the cached map, no re-detection");
    // read-only: nothing writes them back
    assert.ok(!("region_overrides" in s.exportPayload()));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
