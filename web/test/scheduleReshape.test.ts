// #483 rows 1 and 4: header aliases, the key column printed second, and a
// legend with no header row, read by Import from schedule's second look
// (scheduleReshape.ts). Invented codes and products only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readScheduleSpans, readScheduleDebug, sameRead, type ScheduleRead } from "../src/lib/scheduleRead.ts";
import { reshapeBox } from "../src/lib/scheduleReshape.ts";

const span = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 7, h: 14 });
const ROWS = [
  { CODE: "FL-1", MATERIAL: "RESILIENT FLOOR", MANUFACTURER: "VENDOR-A", DESCRIPTION: "SERIES-A", REMARKS: "ZONE-A" },
  { CODE: "TL-2", MATERIAL: "CERAMIC TILE", MANUFACTURER: "VENDOR-B", DESCRIPTION: "SERIES-B", REMARKS: "ZONE-B" },
  { CODE: "RB-3", MATERIAL: "RUBBER BASE", MANUFACTURER: "VENDOR-C", DESCRIPTION: "SERIES-C", REMARKS: "ZONE-C" },
];
const ALIAS: Record<string, string> = { MFG: "MANUFACTURER", SPECIFICATION: "DESCRIPTION", NOTES: "REMARKS" };
const table = (cols: string[], title = "FINISH SCHEDULE") => [
  span(title, 40, 20),
  ...cols.map((c, i) => span(c, 40 + i * 260, 70)),
  ...ROWS.flatMap((row, j) => cols.map((c, i) => span((row as Record<string, string>)[ALIAS[c] ?? c] ?? "", 40 + i * 260, 110 + j * 42))),
];
const legend = (title: string) => [span(title, 40, 20), ...ROWS.flatMap((r, j) => [span(r.CODE, 40, 70 + j * 42), span(r.MATERIAL, 260, 70 + j * 42)])];
const fields = (spans: ReturnType<typeof table>, ocr = false) =>
  readScheduleSpans(spans, { ocr }).rows.map((r) => [r.finish_tag, r.description, r.manufacturer, r.remarks]);

const FULL = [
  ["FL-1", "RESILIENT FLOOR — SERIES-A", "VENDOR-A", "ZONE-A"],
  ["TL-2", "CERAMIC TILE — SERIES-B", "VENDOR-B", "ZONE-B"],
  ["RB-3", "RUBBER BASE — SERIES-C", "VENDOR-C", "ZONE-C"],
];

test("MFG / SPECIFICATION / NOTES headers read as manufacturer, description and remarks", () => {
  for (const ocr of [false, true]) assert.deepEqual(fields(table(["CODE", "MATERIAL", "MFG", "SPECIFICATION", "NOTES"]), ocr), FULL, `ocr=${ocr}`);
});

test("a key column printed second reads, with or without the aliases", () => {
  for (const ocr of [false, true]) {
    assert.deepEqual(fields(table(["MATERIAL", "CODE", "MANUFACTURER", "DESCRIPTION", "REMARKS"]), ocr), FULL, `canonical ocr=${ocr}`);
    assert.deepEqual(fields(table(["MATERIAL", "CODE", "MFG", "SPECIFICATION", "NOTES"]), ocr), FULL, `aliases ocr=${ocr}`);
  }
});

test("a finish legend with no header row reads as code and description", () => {
  for (const ocr of [false, true]) {
    assert.deepEqual(fields(legend("FINISH LEGEND"), ocr), [
      ["FL-1", "RESILIENT FLOOR", "", ""], ["TL-2", "CERAMIC TILE", "", ""], ["RB-3", "RUBBER BASE", "", ""],
    ], `ocr=${ocr}`);
  }
});

test("a box printed in the reader's own headers is never reshaped, and a legend gets no alias look", () => {
  const canonical = table(["CODE", "MATERIAL", "MANUFACTURER", "DESCRIPTION", "REMARKS"]);
  assert.equal(reshapeBox(canonical), null, "nothing to rename or move");
  assert.equal(reshapeBox(canonical, { aliasesOnly: true }), null, "nothing to rename");
  assert.deepEqual(fields(canonical), FULL);
  assert.ok(reshapeBox(legend("FINISH LEGEND")), "a legend gets a header on the no-rows look");
  assert.equal(reshapeBox(legend("FINISH LEGEND"), { aliasesOnly: true }), null, "but not on the alias look");
});

test("negative controls stay unread", () => {
  // another family by title, whatever the column order
  assert.equal(readScheduleSpans(table(["CODE", "MATERIAL", "MANUFACTURER", "DESCRIPTION", "REMARKS"], "DOOR SCHEDULE")).rows.length, 0);
  assert.equal(readScheduleSpans(table(["MATERIAL", "CODE", "MANUFACTURER", "DESCRIPTION", "REMARKS"], "DOOR SCHEDULE")).rows.length, 0);
  // a legend titled as another family
  assert.equal(readScheduleSpans(legend("EQUIPMENT LEGEND")).rows.length, 0);
  // keynotes: numbers, not finish codes
  assert.equal(readScheduleSpans([span("KEYNOTES", 40, 20), span("1", 40, 70), span("SEE DETAIL 3", 260, 70), span("2", 40, 112), span("PATCH WALL", 260, 112)]).rows.length, 0);
  // a door table with no title, MARK second, door columns
  const door = [span("WIDTH", 40, 70), span("MARK", 300, 70), span("HEIGHT", 560, 70), span("HARDWARE", 820, 70),
    span("3'-0\"", 40, 110), span("D-1", 300, 110), span("7'-0\"", 560, 110), span("HW-1", 820, 110),
    span("3'-0\"", 40, 152), span("D-2", 300, 152), span("7'-0\"", 560, 152), span("HW-2", 820, 152)];
  assert.equal(readScheduleSpans(door).rows.length, 0);
  // general notes
  assert.equal(readScheduleSpans([span("GENERAL NOTES", 40, 20), span("1. ALL FINISHES PER SPEC", 40, 70), span("2. VERIFY IN FIELD", 40, 112)]).rows.length, 0);
});

// Layouts from @knmurphy's review of #518 (invented codes and vendors).
const rowsAt = (cols: string[], xs: number[], rows: string[][], y0 = 70) => [
  ...cols.map((c, i) => span(c, xs[i], y0)),
  ...rows.flatMap((r, j) => r.map((v, i) => v && span(v, i === 0 && r.length === 1 ? 40 : xs[i], y0 + 40 + j * 30)).filter(Boolean)),
] as ReturnType<typeof span>[];
const box = (a: [string, number, number, number, number][]) => a.map(([str, x, y, w, h]) => ({ str, x, y, w, h }));

test("section headings at the left edge of a MATERIAL | CODE table keep their sections", () => {
  const spans = [span("FINISH SCHEDULE", 40, 20), ...rowsAt(["MATERIAL", "CODE", "MANUFACTURER", "COLOR"], [40, 260, 380, 600],
    [["FLOORING"], ["CARPET TILE", "CPT-1", "VENDOR-A", "GREY"], ["BASE"], ["RUBBER BASE", "RB-1", "VENDOR-B", "BLACK"], ["CEILINGS"], ["ACOUSTICAL TILE", "ACT-1", "VENDOR-D", "WHITE"]])];
  for (const ocr of [false, true]) {
    const rows = readScheduleSpans(spans, { ocr }).rows;
    assert.deepEqual(rows.map((r) => [r.finish_tag, r.section, r.suggested]), [["CPT-1", "FLOORING", true], ["RB-1", "BASE", true], ["ACT-1", "CEILINGS", false]], `ocr=${ocr}`);
  }
});

test("a header naming MARK and CODE keys on CODE", () => {
  const spans = [span("FINISH SCHEDULE", 40, 20), ...rowsAt(["MATERIAL", "MARK", "CODE", "MANUFACTURER"], [40, 260, 340, 460],
    [["CARPET TILE", "A", "CPT-1", "VENDOR-A"], ["RUBBER BASE", "B", "RB-1", "VENDOR-B"], ["PAINT", "C", "PT-1", "VENDOR-C"]])];
  assert.deepEqual(readScheduleSpans(spans).rows.map((r) => [r.finish_tag, r.manufacturer]), [["CPT-1", "VENDOR-A"], ["RB-1", "VENDOR-B"], ["PT-1", "VENDOR-C"]]);
});

test("a legend with a note beside some lines keeps every row, the note as remarks", () => {
  const L5: [string, string][] = [["CPT-1", "CARPET TILE"], ["LVT-1", "LUXURY VINYL TILE"], ["RB-1", "RUBBER BASE"], ["PT-1", "PAINT EGGSHELL"], ["CT-1", "CERAMIC TILE"]];
  const spans = [span("FINISH LEGEND", 40, 20), ...L5.flatMap(([c, d], j) => [span(c, 40, 70 + j * 30), span(d, 130, 70 + j * 30)]),
    span("NOTE: ALL FLOORING BY OWNER", 330, 70), span("SEE SPECIFICATIONS", 330, 100)];
  for (const ocr of [false, true]) {
    const rows = readScheduleSpans(spans, { ocr }).rows;
    assert.deepEqual(rows.map((r) => r.finish_tag), ["CPT-1", "LVT-1", "RB-1", "PT-1", "CT-1"], `ocr=${ocr}`);
    assert.equal(rows[0].description, "CARPET TILE");
    assert.equal(rows[0].remarks, "NOTE: ALL FLOORING BY OWNER");
  }
});

test("ambiguous boxes read nothing rather than rows in the wrong fields", () => {
  // a headed table with too few known header words isn't a legend
  const threeCol = [span("FINISH SCHEDULE", 40, 20), span("CODE", 40, 70), span("SECTION", 110, 70), span("DESCRIPTION", 190, 70), span("FLOORS", 40, 100),
    ...[["CPT-1", "09 68 13", "CARPET TILE"], ["LVT-1", "09 65 19", "LUXURY VINYL TILE"], ["RB-1", "09 65 13", "RUBBER BASE"]].flatMap((r, j) => r.map((v, i) => span(v, [40, 110, 190][i], 130 + j * 30)))];
  // OCR read the CODE and MFG headers as one box
  const oneBox = box([["FINISH SCHEDULE", 42, 42, 104, 5], ["MATERIAL", 41, 76, 55, 5], ["CODE MFG", 165, 75, 61, 7], ["SPECIFICATION", 280, 76, 90, 5], ["NOTES", 385, 76, 34, 5],
    ["RESILIENT FLOOR", 42, 102, 106, 5], ["FL-1", 164, 102, 26, 6], ["VENDOR-A", 207, 102, 56, 6], ["SERIES-A", 279, 102, 54, 6], ["ZONE-A", 388, 102, 39, 7],
    ["CERAMIC TILE", 42, 124, 83, 5], ["TL-2", 164, 123, 27, 7], ["VENDOR-B SERIES-B", 207, 124, 126, 6], ["ZONE-B", 388, 124, 39, 7],
    ["RUBBER BASE", 42, 146, 74, 6], ["RB-3", 164, 146, 37, 7], ["VENDOR-C SERIES-C", 206, 146, 126, 6], ["ZONE-C", 388, 146, 39, 7]]);
  // OCR glued two codes to their vendors: a read of FL-1 alone would hide two rows
  const glued = box([["MATERIAL", 42, 93, 72, 7], ["CODE", 207, 92, 35, 10], ["MFG", 246, 91, 42, 11], ["SPECIFICATION", 361, 93, 122, 7], ["NOTES", 500, 93, 44, 8],
    ["RESILIENT FLOOR", 43, 127, 141, 7], ["FL-1", 203, 126, 36, 9], ["VENDOR-A", 262, 127, 73, 8], ["SERIES-A", 359, 127, 72, 7], ["ZONE-A", 504, 127, 52, 10],
    ["CERAMIC TILE", 44, 157, 108, 8], ["TL-2 VENDOR-B", 207, 156, 129, 10], ["SERIES-B", 360, 157, 70, 8], ["ZONE-B", 505, 157, 50, 11],
    ["RUBBER BASE", 43, 185, 100, 7], ["RB-3 VENDOR-C", 206, 184, 130, 10], ["SERIES-C", 358, 185, 73, 7], ["ZONE-C", 504, 184, 51, 13]]);
  for (const ocr of [false, true]) assert.equal(readScheduleSpans(threeCol, { ocr }).rows.length, 0, `threeCol ocr=${ocr}`);
  assert.equal(readScheduleSpans(oneBox, { ocr: true }).rows.length, 0, "one header box");
  assert.equal(readScheduleSpans(glued, { ocr: true }).rows.length, 0, "glued codes");
});

// ── aliases on a box that already reads ──────────────────────────────────────
// A box with a CODE column reads rows on the first look even when one of its
// headers is an alias, and the alias column's cells join a known column beside
// it (MFG | COLOR → color "VENDOR-A GRAY"). The rename-only second look fixes
// that, and is used only when it moved text between the fields of the same rows.
type Cell = { str: string; x: number; y: number; w: number; h: number };
const cell = (str: string, x: number, y: number, w = str.length * 7, h = 14): Cell => ({ str, x, y, w, h });
const R3: Record<string, string>[] = [
  { C: "FL-1", M: "RESILIENT FLOOR", V: "VENDOR-A", K: "GRAY", N: "ZONE-A" },
  { C: "TL-2", M: "CERAMIC TILE", V: "VENDOR-B", K: "BLUE", N: "ZONE-B" },
  { C: "RB-3", M: "RUBBER BASE", V: "TRANSITIONS INC", K: "BLACK", N: "ZONE-C" },
];
const EPOX = { C: "EPOX", V: "VENDOR-E", K: "CLEAR" };
/** A table, columns 200 px apart; `keys` pick each column's text from the row ("S": a spec section). */
const grid = (cols: string[], keys: string[], { rows = R3, extra = [] as Cell[] } = {}): Cell[] => [
  cell("FINISH SCHEDULE", 40, 20),
  ...cols.map((c, i) => cell(c, 40 + i * 200, 70)),
  ...rows.flatMap((r, j) => keys.flatMap((k, i) => {
    const v = k === "S" ? "09 65 13" : r[k];
    return v ? [cell(v, 40 + i * 200, 110 + j * 42)] : [];
  })),
  ...extra,
];
const CANON: Record<string, string> = { MFG: "MANUFACTURER", MFR: "MANUFACTURER", NOTES: "REMARKS", SPEC: "PRODUCT" };
/** The same box with the reader's own header words printed. */
const canonOf = (s: Cell[]) => s.map((t) => (CANON[t.str] ? { ...t, str: CANON[t.str] } : t));
const ocrBox = (a: [string, number, number, number, number][]): Cell[] => a.map(([str, x, y, w, h]) => ({ str, x, y, w, h }));
const small = (str: string, x: number, y: number) => cell(str, x, y, str.length * 8, 9);
const smallGrid = (cols: string[], rows: string[][]) => [small("FINISH SCHEDULE", 40, 30), ...cols.map((c, i) => small(c, 40 + i * 150, 70)),
  ...rows.flatMap((r, j) => r.flatMap((v, i) => (v ? [small(v, 40 + i * 150, 100 + j * 24)] : [])))];
const notesBlock = (head: string, x: number, lines: [string, number][]) => [cell(head, x, 70), ...lines.map(([s, y]) => cell(s, x, y))];
const dist = R3.map((r) => ({ ...r, X: "DIST-" + r.C }));
const owner = R3.map((r) => ({ ...r, X: "OWNER-" + r.C }));

// the OCR words of a CODE | MATERIAL | MFG | COLOR | REMARKS table: jittered boxes, real widths
const T1_OCR = ocrBox([["FINISH SCHEDULE", 42, 40, 140, 9], ["CODE", 41, 76, 38, 8], ["MATERIAL", 128, 75, 74, 9], ["MFG", 262, 76, 33, 8], ["COLOR", 360, 77, 50, 8], ["REMARKS", 470, 75, 70, 9],
  ["FL-1", 42, 102, 33, 9], ["RESILIENT FLOOR", 127, 103, 131, 8], ["VENDOR-A", 261, 102, 71, 9], ["GRAY", 361, 103, 37, 8], ["ZONE-A", 471, 101, 52, 10],
  ["TL-2", 43, 125, 35, 10], ["CERAMIC TILE", 128, 126, 104, 8], ["VENDOR-B", 262, 124, 72, 10], ["BLUE", 360, 125, 36, 9], ["ZONE-B", 470, 126, 51, 8],
  ["RB-3", 41, 148, 35, 9], ["RUBBER BASE", 129, 148, 98, 9], ["VENDOR-C", 263, 149, 72, 8], ["BLACK", 361, 149, 46, 8], ["ZONE-C", 472, 148, 52, 9]]);
const T1_ALIASES = ["CODE", "MATERIAL", "MFG", "COLOR", "REMARKS"];
const A = {
  T1: grid(T1_ALIASES, ["C", "M", "V", "K", "N"]),
  T2: grid(["CODE", "MATERIAL", "MFR", "COLOR", "NOTES"], ["C", "M", "V", "K", "N"]),
  T3: grid(["CODE", "MATERIAL", "MANUFACTURER", "COLOR", "NOTES"], ["C", "M", "V", "K", "N"]),
  T4: grid(["CODE", "MFG", "MATERIAL", "COLOR"], ["C", "V", "M", "K"]),
  T5: grid(["CODE", "MATERIAL", "SPEC", "MANUFACTURER"], ["C", "M", "S", "V"]),
  T7: grid(T1_ALIASES, ["C", "M", "V", "K", "N"], { rows: [R3[0], EPOX, R3[1], R3[2]] }),
  T8: grid(["CODE", "MATERIAL", "MANUFACTURER", "COLOR", "NOTES"], ["C", "M", "V", "K", "N"], { rows: [R3[0], { ...R3[1], N: "NOT USED" }, R3[2]] }),
  T9: smallGrid(["TAG", "CODE", "MATERIAL", "MFG", "COLOR"], [["T-1", "FL-1", "RESILIENT FLOOR", "VENDOR-A", "GRAY"], ["T-2", "TL-2", "CERAMIC TILE", "VENDOR-B", "BLUE"], ["T-3", "RB-3", "RUBBER BASE", "VENDOR-C", "BLACK"]]),
  // a line above the table that names three columns and a key, one word per box
  T10: [cell("SEE", 40, 45), cell("SPEC", 80, 45), cell("NOTES", 130, 45), cell("FOR", 190, 45), cell("TAG", 230, 45), ...grid(T1_ALIASES, ["C", "M", "V", "K", "N"])],
  T11: grid(["CODE", "MATERIAL", "MFG", "STYLE / COLOR"], ["C", "M", "V", "K"]),
  // OCR read one row's maker and color as one box across the MFG | COLOR boundary
  T12: T1_OCR.filter((t) => t.str !== "VENDOR-B" && t.str !== "BLUE").concat(ocrBox([["VENDOR-B BLUE", 262, 125, 134, 9]])),
  F1: grid(["CODE", "MATERIAL", "MANUFACTURER", "COLOR"], ["C", "M", "V", "K"], { extra: notesBlock("GENERAL NOTES", 1100, [["1. ALL FLOORING PER MFR.", 110], ["2. SEE SPECS.", 152]]) }),
  F1k: grid(["CODE", "MATERIAL", "MANUFACTURER", "COLOR"], ["C", "M", "V", "K"], { extra: notesBlock("KEYED NOTES", 1000, [["1. PATCH SUBSTRATE", 110], ["2. MATCH EXISTING", 194]]) }),
  F2a: grid(["CODE", "MATERIAL", "COLOR", "NOTES", "COMMENTS"], ["C", "M", "K", "N", "X"], { rows: owner }),
  F2b: grid(["CODE", "MATERIAL", "COLOR", "COMMENTS", "NOTES"], ["C", "M", "K", "X", "N"], { rows: owner }),
  F3: smallGrid(["CODE", "MATERIAL", "MFG", "COLOR"], [["", "", "FLOORING", ""], ["FL-1", "RESILIENT FLOOR", "VENDOR-A", "GRAY"], ["", "", "BASE", ""], ["RB-3", "RUBBER BASE", "VENDOR-C", "BLACK"]]),
  F4a: grid(["CODE", "MATERIAL", "MFG", "MANUFACTURER", "COLOR"], ["C", "M", "X", "V", "K"], { rows: dist }),
  F4b: grid(["CODE", "MATERIAL", "NOTES", "REMARKS", "COLOR"], ["C", "M", "X", "N", "K"], { rows: dist }),
  F4c: grid(["CODE", "MATERIAL", "MFG", "MANUF.", "COLOR"], ["C", "M", "X", "V", "K"], { rows: dist }),
  F4d: grid(["CODE", "MATERIAL", "NOTES", "REMARK", "COLOR"], ["C", "M", "X", "N", "K"], { rows: dist }),
  F4e: grid(["CODE", "MATERIAL", "MFR", "MANUFACTURERS", "COLOR"], ["C", "M", "X", "V", "K"], { rows: dist }),
  // EPOX (skipped today) carries the only text under a far GENERAL NOTES heading
  F5: grid(["CODE", "MATERIAL", "MFG", "COLOR"], ["C", "M", "V", "K"], { rows: [R3[0], EPOX, R3[1], R3[2]], extra: notesBlock("GENERAL NOTES", 1200, [["1. SEAL ALL JOINTS", 152]]) }),
};
type Read = ReturnType<typeof readScheduleSpans>;
const read = (s: Cell[], ocr: boolean) => readScheduleSpans(s, { ocr });
const cols = (r: Read) => r.rows.map((x) => [x.finish_tag, x.description, x.manufacturer, x.spec_color, x.remarks, x.category, x.category_source, x.suggested]);
const ROW: Record<string, (string | boolean)[]> = {
  "FL-1": ["FL-1", "RESILIENT FLOOR", "VENDOR-A", "GRAY", "ZONE-A", "unassigned", "none", true],
  "TL-2": ["TL-2", "CERAMIC TILE", "VENDOR-B", "BLUE", "ZONE-B", "unassigned", "none", true],
  "RB-3": ["RB-3", "RUBBER BASE", "TRANSITIONS INC", "BLACK", "ZONE-C", "base", "text", true],
};
const rowsWith = (edit: (r: (string | boolean)[]) => (string | boolean)[] = (r) => r) => ["FL-1", "TL-2", "RB-3"].map((c) => edit([...ROW[c]]));
/** The alias read reached and fell back: the renamed box reads differently, the box reads as `base`. */
const fellBack = (s: Cell[], ocr: boolean, base: unknown, label: string) => {
  const r = reshapeBox(s, { aliasesOnly: true });
  assert.ok(r, `${label}: reaches the alias read`);
  const final = read(s, ocr);
  assert.notDeepEqual(read(r.spans, ocr), final, `${label}: the alias read was not used`);
  assert.deepEqual(final.rows.map((x) => [x.finish_tag, x.section, x.manufacturer, x.spec_color, x.remarks]), base, label);
};

for (const ocr of [false, true]) {
  test(`MFG | COLOR on a box that reads: maker and color in place (ocr=${ocr})`, () => {
    assert.deepEqual(cols(read(A.T1, ocr)), rowsWith());
    assert.deepEqual(read(T1_OCR, ocr).rows.map((x) => [x.manufacturer, x.spec_color, x.remarks]),
      [["VENDOR-A", "GRAY", "ZONE-A"], ["VENDOR-B", "BLUE", "ZONE-B"], ["VENDOR-C", "BLACK", "ZONE-C"]], "OCR-shaped words");
  });

  test(`MFR and NOTES on a box that reads (ocr=${ocr})`, () => {
    assert.deepEqual(cols(read(A.T2, ocr)), rowsWith());
  });

  test(`NOTES printed last on a box that reads (ocr=${ocr})`, () => {
    assert.deepEqual(cols(read(A.T3, ocr)), rowsWith());
  });

  test(`MFG before MATERIAL: the maker leaves the description, and the base row is a base (ocr=${ocr})`, () => {
    assert.deepEqual(cols(read(A.T4, ocr)), rowsWith((r) => { r[4] = ""; return r; }));
  });

  test(`SPEC beside MANUFACTURER: the section joins the description, not the maker (ocr=${ocr})`, () => {
    assert.deepEqual(cols(read(A.T5, ocr)), rowsWith((r) => { r[1] += " — 09 65 13"; r[3] = ""; r[4] = ""; return r; }));
  });

  test(`an alias header reads as the reader's own header word would (ocr=${ocr})`, () => {
    for (const [n, s] of Object.entries({ T1: A.T1, T1_OCR, T2: A.T2, T3: A.T3, T4: A.T4, T5: A.T5 })) assert.deepEqual(read(s, ocr), read(canonOf(s), ocr), n);
  });

  test(`a four-letter code skipped today reads as a row once its maker has a column (ocr=${ocr})`, () => {
    // on the OCR read the reader folds EPOX into the row above, with or without the alias (not this change)
    if (ocr) return assert.deepEqual(read(A.T7, ocr), read(canonOf(A.T7), ocr));
    const r = read(A.T7, ocr);
    assert.deepEqual(r.rows.map((x) => [x.finish_tag, x.manufacturer, x.spec_color, x.remarks]),
      [["FL-1", "VENDOR-A", "GRAY", "ZONE-A"], ["EPOX", "VENDOR-E", "CLEAR", ""], ["TL-2", "VENDOR-B", "BLUE", "ZONE-B"], ["RB-3", "TRANSITIONS INC", "BLACK", "ZONE-C"]]);
    assert.equal("skipped" in r ? r.skipped : undefined, undefined, "nothing left skipped");
  });

  test(`NOT USED under NOTES unticks its row, as under REMARKS (ocr=${ocr})`, () => {
    const r = read(A.T8, ocr).rows[1];
    assert.deepEqual([r.finish_tag, r.spec_color, r.remarks, r.suggested, r.unticked_reason], ["TL-2", "BLUE", "NOT USED", false, "not-used"]);
  });

  test(`no column moves on a box that reads: TAG before CODE stays put (ocr=${ocr})`, () => {
    assert.deepEqual(read(A.T9, ocr).rows.map((x) => [x.finish_tag, x.manufacturer, x.spec_color]),
      [["T-1", "VENDOR-A", "GRAY"], ["T-2", "VENDOR-B", "BLUE"], ["T-3", "VENDOR-C", "BLACK"]]);
  });

  test(`the header is the line nearest the data, not a note above it (ocr=${ocr})`, () => {
    assert.deepEqual(cols(read(A.T10, ocr)), rowsWith());
  });

  test(`a header cell naming two columns doesn't stop the rename (ocr=${ocr})`, () => {
    assert.deepEqual(read(A.T11, ocr).rows.map((x) => x.manufacturer), ["VENDOR-A", "VENDOR-B", "TRANSITIONS INC"]);
  });

  test(`a box glued across MFG | COLOR reads as it would under MANUFACTURER (ocr=${ocr})`, () => {
    assert.deepEqual(read(A.T12, ocr), read(canonOf(A.T12), ocr));
    assert.deepEqual(read(A.T12, ocr).rows[1].manufacturer, "VENDOR-B BLUE");
  });

  test(`a far notes block beside the header line adds nothing to remarks (ocr=${ocr})`, () => {
    const base = [["FL-1", "", "VENDOR-A", "GRAY", ""], ["TL-2", "", "VENDOR-B", "BLUE", ""], ["RB-3", "", "TRANSITIONS INC", "BLACK", ""]];
    fellBack(A.F1, ocr, base, "GENERAL NOTES");
    fellBack(A.F1k, ocr, base, "KEYED NOTES");
  });

  test(`NOTES beside COMMENTS: no comment is lost (ocr=${ocr})`, () => {
    for (const s of [A.F2a, A.F2b]) {
      assert.equal(reshapeBox(s, { aliasesOnly: true }), null);
      assert.ok(read(s, ocr).rows.every((r) => /OWNER-/.test(r.remarks) && /ZONE-/.test(r.remarks)));
    }
  });

  test(`a section heading inside the MFG column falls back to today's read (ocr=${ocr})`, () => {
    fellBack(A.F3, ocr, [["FL-1", "", "", "VENDOR-A GRAY", ""], ["RB-3", "", "", "VENDOR-C BLACK", ""]], "heading in MFG");
  });

  test(`an alias beside the column it names is not renamed (ocr=${ocr})`, () => {
    const maker = [["FL-1", "", "DIST-FL-1 VENDOR-A", "GRAY", ""], ["TL-2", "", "DIST-TL-2 VENDOR-B", "BLUE", ""], ["RB-3", "", "DIST-RB-3 TRANSITIONS INC", "BLACK", ""]];
    const notes = [["FL-1", "", "", "GRAY", "DIST-FL-1 ZONE-A"], ["TL-2", "", "", "BLUE", "DIST-TL-2 ZONE-B"], ["RB-3", "", "", "BLACK", "DIST-RB-3 ZONE-C"]];
    for (const [n, s, base] of [["MFG|MANUFACTURER", A.F4a, maker], ["NOTES|REMARKS", A.F4b, notes], ["MFG|MANUF.", A.F4c, maker], ["NOTES|REMARK", A.F4d, notes], ["MFR|MANUFACTURERS", A.F4e, maker]] as const) {
      assert.equal(reshapeBox(s, { aliasesOnly: true }), null, n);
      assert.deepEqual(read(s, ocr).rows.map((x) => [x.finish_tag, x.section, x.manufacturer, x.spec_color, x.remarks]), base, n);
    }
  });

  test(`a skipped code that would be the only home of a renamed column's text falls back (ocr=${ocr})`, () => {
    const r = reshapeBox(A.F5, { aliasesOnly: true });
    assert.ok(r, "reaches the alias read");
    const final = read(A.F5, ocr);
    assert.notDeepEqual(read(r.spans, ocr), final, "the alias read was not used");
    if (ocr) assert.deepEqual(final.rows.map((x) => [x.finish_tag, x.spec_color]), [["FL-1", "VENDOR-A GRAY VENDOR-E CLEAR"], ["TL-2", "VENDOR-B BLUE"], ["RB-3", "TRANSITIONS INC BLACK"]]);
    else {
      assert.deepEqual(final.rows.map((x) => [x.finish_tag, x.manufacturer, x.spec_color, x.remarks]),
        [["FL-1", "", "VENDOR-A GRAY", ""], ["TL-2", "", "VENDOR-B BLUE", ""], ["RB-3", "", "TRANSITIONS INC BLACK", ""]]);
      assert.deepEqual("skipped" in final ? final.skipped : null, ["EPOX"]);
    }
  });

  test(`the debug trace makes the same choice as the read (ocr=${ocr})`, () => {
    // fixtures with no numeric-code recovery, where the trace (before recovery) and the read are like for like
    for (const [n, s] of Object.entries({ T1: A.T1, T7: A.T7, F3: A.F3, F5: A.F5 })) assert.deepEqual(readScheduleDebug(s, { ocr }).read, read(s, ocr), n);
  });
}

test("the alias reshape renames headers only: no span moves", () => {
  const r = reshapeBox(A.T9, { aliasesOnly: true });
  assert.ok(r);
  assert.deepEqual(r.spans.map((t) => [t.x, t.y]), A.T9.map((t) => [t.x, t.y]));
  assert.deepEqual(r.spans.filter((t, i) => t.str !== A.T9[i].str).map((t) => t.str), ["MANUFACTURER"]);
});

test("sameRead: the alias read is used only when it just moved text between the fields of the same rows", () => {
  const row = (finish_tag: string, o: Record<string, unknown> = {}) => ({ finish_tag, section: "", category: "unassigned", category_source: "none", description: "", manufacturer: "", style: "", spec_color: "", size: "", remarks: "", suggested: true, ...o }) as ScheduleRead["rows"][number];
  const first: ScheduleRead = { rows: [row("A-1", { spec_color: "VENDOR-A GRAY" }), row("B-1", { spec_color: "BLUE" })] };
  const moved = [row("A-1", { manufacturer: "VENDOR-A", spec_color: "GRAY" }), row("B-1", { spec_color: "BLUE" })];
  assert.ok(sameRead(first, first), "equal");
  assert.ok(sameRead(first, { rows: moved }), "a word moved between fields");
  assert.ok(sameRead(first, { rows: moved }, ["MANUFACTURER"]), "the renamed column earned its words");
  assert.ok(!sameRead(first, { rows: [moved[0]] }), "a row lost");
  assert.ok(!sameRead(first, { rows: [moved[0], row("C-1", { spec_color: "BLUE" })] }), "a different code");
  assert.ok(!sameRead(first, { rows: [moved[0], row("B-1", { spec_color: "BLUE", section: "BASE" })] }), "same codes, another section");
  assert.ok(!sameRead(first, { rows: [moved[0], row("B-1", { spec_color: "BLUE", remarks: "1. SEE SPECS" })] }), "a word added");
  assert.ok(!sameRead(first, { rows: [row("A-1", { manufacturer: "VENDOR-A" }), moved[1]] }), "a word dropped");
  assert.ok(!sameRead(first, { rows: [row("A-1", { manufacturer: "VENDOR-A GRAY GRAY" }), moved[1]] }), "a word doubled");
  assert.ok(!sameRead(first, { rows: [], refused: "no-table" }), "a refusal");
  const checks = [{ first: "FL-1", second: "FL-I" }];
  assert.ok(!sameRead({ rows: [row("A-1", { spec_color: "GRAY", code_checks: checks })] }, { rows: [row("A-1", { spec_color: "GRAY" })] }), "code_checks differ");
  assert.ok(!sameRead({ rows: [row("A-1", { spec_color: "GRAY", ocr_code: true, read_as: "A-l" })] }, { rows: [row("A-1", { spec_color: "GRAY", ocr_code: true })] }), "read_as differs");
  // a code the first read skipped
  const skipped: ScheduleRead = { rows: first.rows, skipped: ["EPOX"] };
  const withEpox = [moved[0], row("EPOX", { manufacturer: "VENDOR-E" }), moved[1]];
  assert.ok(sameRead(skipped, { rows: withEpox }, ["MANUFACTURER"]), "a skipped code reads as a row");
  assert.ok(sameRead(skipped, { rows: moved, skipped: ["EPOX"] }), "still skipped");
  assert.ok(!sameRead(first, { rows: withEpox }), "an extra row first didn't skip");
  assert.ok(!sameRead(skipped, { rows: moved }), "a skipped code vanished");
  assert.ok(!sameRead(skipped, { rows: moved, skipped: ["EPOX", "SEAL"] }), "a new code skipped");
  assert.ok(!sameRead(skipped, { rows: withEpox, skipped: ["EPOX"] }), "a skipped code read and still skipped");
  // each renamed column earns words in a row the first read has
  assert.ok(!sameRead(first, { rows: moved }, ["MANUFACTURER", "REMARKS"]), "REMARKS put words nowhere");
  assert.ok(!sameRead(skipped, { rows: [moved[0], row("EPOX", { remarks: "1. SEAL" }), moved[1]] }, ["MANUFACTURER", "REMARKS"]), "REMARKS put words only in the extra row");
});
