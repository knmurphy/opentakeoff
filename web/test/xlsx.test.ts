// Excel export — the pure part builder (buildXlsxParts) is asserted directly,
// and one test round-trips through fflate's unzip to prove the zip layer
// produces a readable package with the same parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { xmlEsc, colRef, safeSheetName, worksheetXml, buildXlsxParts, xlsxBytes, takeoffWorkbook } from "../src/lib/xlsx.js";
import { sheetTotals } from "../src/lib/totals.js";

const cond = (over: Record<string, unknown> = {}) => ({
  id: "c1", finish_tag: "CPT-1", color: "#123456", multiplier: 1, waste_pct: 10, materials: [], ...over,
});
const shape = (over: Record<string, unknown> = {}) => ({
  id: "s1", sheet_id: "plan.pdf", condition_id: "c1", measure_role: "floor_area", computed: { area_sf: 100 }, ...over,
});

// ── XML plumbing ────────────────────────────────────────────────────────────

test("xmlEsc escapes markup and strips XML-illegal control chars", () => {
  assert.equal(xmlEsc('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;");
  assert.equal(xmlEsc("a\x00b\x0Bc\x7Fd"), "abcd");
  assert.equal(xmlEsc("keep\ttab\nand newline"), "keep\ttab\nand newline");
});

test("colRef produces spreadsheet letters past Z", () => {
  assert.equal(colRef(0), "A");
  assert.equal(colRef(25), "Z");
  assert.equal(colRef(26), "AA");
  assert.equal(colRef(26 + 26 * 26 - 1), "ZZ");
});

test("safeSheetName enforces Excel's rules and dedupes", () => {
  const used = new Set<string>();
  assert.equal(safeSheetName("Summary", used), "Summary");
  assert.equal(safeSheetName("summary", used), "summary (2)");           // case-insensitive collision
  assert.equal(safeSheetName("a/b:c*d?e[f]g\\h", used), "a b c d e f g h");
  assert.equal(safeSheetName("x".repeat(40), used).length, 31);
  assert.equal(safeSheetName("", used), "Sheet");
  assert.equal(safeSheetName("History", used), "History_");              // reserved by Excel
});

test("worksheetXml: numbers as <v>, strings inline, blanks skipped, refs explicit", () => {
  const xml = worksheetXml({ rows: [["Finish", "SF"], ["CPT-1", 270.5], ["", 3]] });
  assert.match(xml, /<c r="A1" t="inlineStr"><is><t>Finish<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="B2"><v>270.5<\/v><\/c>/);
  assert.ok(!xml.includes('r="A3" t')) ;                                  // blank skipped entirely
  assert.match(xml, /<c r="B3"><v>3<\/v><\/c>/);                          // neighbour keeps its ref
  assert.ok(!xml.includes("<f>"), "no formulas, ever");
});

test("worksheetXml: formula-shaped text stays inert inline text", () => {
  const xml = worksheetXml({ rows: [["=HYPERLINK(\"http://x\")", "+SUM(A1)", "-2+3", "@cmd"]] });
  assert.match(xml, /t="inlineStr"><is><t>=HYPERLINK\(&quot;http:\/\/x&quot;\)<\/t>/);
  assert.match(xml, /<t>\+SUM\(A1\)<\/t>/);
  assert.ok(!xml.includes("<f>"));
});

test("worksheetXml: freeze pane, column widths, autoFilter over data rows only", () => {
  const xml = worksheetXml({
    rows: [["Finish", "SF"], ["CPT-1", 1], ["TOTAL", 1]],
    freezeTop: true, autoFilter: { cols: 2, rows: 2 },
  });
  assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(xml, /<cols><col min="1" max="1" width="\d+(\.\d+)?" customWidth="1"\/>/);
  assert.match(xml, /<autoFilter ref="A1:B2"\/>/);                        // TOTAL row excluded
  assert.ok(xml.indexOf("<autoFilter") > xml.indexOf("</sheetData>"), "autoFilter after sheetData");
});

test("worksheetXml: styled cells carry s= indices; NaN written as blank", () => {
  const xml = worksheetXml({ rows: [[{ v: "Finish", s: "th" }, { v: 12.5, s: "qty" }, { v: NaN, s: "qty" }]] });
  assert.match(xml, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(xml, /<c r="B1" s="2"><v>12.5<\/v><\/c>/);
  assert.ok(!xml.includes('r="C1"'), "NaN cell skipped");
});

// ── package assembly ────────────────────────────────────────────────────────

test("buildXlsxParts: complete package with one part per sheet, names deduped", () => {
  const parts = buildXlsxParts([{ name: "Summary", rows: [["a"]] }, { name: "Summary", rows: [["b"]] }]);
  for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(parts.has(p), `missing ${p}`);
  }
  const wb = parts.get("xl/workbook.xml")!;
  assert.match(wb, /<sheet name="Summary" sheetId="1" r:id="rId1"\/>/);
  assert.match(wb, /<sheet name="Summary \(2\)" sheetId="2" r:id="rId2"\/>/);
  assert.match(parts.get("xl/styles.xml")!, /formatCode="#,##0\.0"/);
});

test("xlsxBytes round-trips through fflate unzip", async () => {
  const bytes = await xlsxBytes([{ name: "Summary", rows: [["Finish", "SF"], ["CPT-1", 270.5]] }]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);            // PK zip magic
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(bytes);
  const ws = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(ws, /<t>CPT-1<\/t>/);
  assert.match(strFromU8(files["xl/workbook.xml"]), /name="Summary"/);
});

// ── the report as a workbook ────────────────────────────────────────────────

test("takeoffWorkbook: four tabs, report numbers, waste only on order quantities", () => {
  const conditions = [cond({ materials: [{ name: "Adhesive", unit: "pail", per: 40, basis: "area" }] })];
  const shapes = [shape(), shape({ id: "s2", measure_role: "deduct", computed: { area_sf: 20 } })];
  const sheets = takeoffWorkbook({ projectName: "Job", units: "imperial", conditions, shapes });
  assert.deepEqual(sheets.map((s) => s.name), ["Summary", "By sheet", "Materials", "Shapes"]);

  const summary = sheets[0].rows;
  const data = summary[1].map((c: any) => (c && typeof c === "object" ? c.v : c));
  assert.equal(data[0], "CPT-1");
  assert.equal(data[4], 80);          // floor: 100 − 20 deduct
  assert.equal(data[7], 80);          // total measured — waste NOT applied
  assert.equal(data[10], 88);         // ordered: 80 × 1.10
  const totalRow = summary[2].map((c: any) => (c && typeof c === "object" ? c.v : c));
  assert.equal(totalRow[0], "TOTAL");

  const shapesTab = sheets[3].rows;
  const deductRow = shapesTab.find((r: any[]) => r.some((c: any) => c && c.v === -20));
  assert.ok(deductRow, "deduct row carries its sign in the audit tab");
});

test("takeoffWorkbook: metric converts areas/lengths and drops the SY column", () => {
  const sheets = takeoffWorkbook({ units: "metric", conditions: [cond()], shapes: [shape()] });
  const header = sheets[0].rows[0].map((c: any) => c.v);
  assert.ok(header.includes("Floor m²"));
  assert.ok(!header.some((h: string) => /SY/.test(h)));
  const data = sheets[0].rows[1].map((c: any) => (c && typeof c === "object" ? c.v : c));
  assert.equal(data[4], 9.290304);    // 100 SF → m², full precision (the #,##0.0 style rounds the DISPLAY)
});

test("takeoffWorkbook: no materials -> no Materials tab; empty takeoff still builds", () => {
  const sheets = takeoffWorkbook({ conditions: [cond()], shapes: [shape()] });
  assert.deepEqual(sheets.map((s) => s.name), ["Summary", "By sheet", "Shapes"]);
  const empty = takeoffWorkbook({ conditions: [], shapes: [] });
  assert.ok(empty.length >= 2);
});

// ── sheetTotals (lives in totals.js, feeds the By-sheet tab) ────────────────

test("sheetTotals: base quantities per sheet×condition — no multiplier, no waste", () => {
  const conditions = [cond({ multiplier: 3, waste_pct: 25 })];
  const shapes = [
    shape(),                                                                      // plan.pdf: +100
    shape({ id: "s2", sheet_id: "plan.pdf", measure_role: "deduct", computed: { area_sf: 10 } }),
    shape({ id: "s3", sheet_id: "plan.pdf#2", computed: { area_sf: 50 } }),
    shape({ id: "s4", sheet_id: "plan.pdf#2", measure_role: "linear", computed: { perimeter_lf: 12, area_sf: 4 } }),
  ];
  const rows = sheetTotals(conditions, shapes);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.sheet_id), ["plan.pdf", "plan.pdf#2"]);
  assert.equal(rows[0].floor_sf, 90);                                             // 100 − 10, multiplier NOT applied
  assert.equal(rows[1].floor_sf, 50);
  assert.equal(rows[1].lf, 12);
  assert.equal(rows[1].border_sf, 4);
});

test("sheetTotals: orphan shapes (deleted condition) are skipped", () => {
  const rows = sheetTotals([cond()], [shape({ condition_id: "ghost" })]);
  assert.equal(rows.length, 0);
});
