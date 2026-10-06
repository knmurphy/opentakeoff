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
  // OCR read one row's maker and color as one box across the MFG | COLOR boundary: the
  // renamed read would put both in manufacturer and leave color empty, so the first read stands
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

test("sameRead: the alias read keeps the first read's rows and their code checks", () => {
  const row = (finish_tag: string, o: Record<string, unknown> = {}) => ({ finish_tag, section: "", category: "unassigned", category_source: "none", description: "", manufacturer: "", style: "", spec_color: "", size: "", remarks: "", suggested: true, ...o }) as ScheduleRead["rows"][number];
  const first: ScheduleRead = { rows: [row("A-1", { spec_color: "VENDOR-A GRAY" }), row("B-1", { spec_color: "BLUE" })] };
  const moved = [row("A-1", { manufacturer: "VENDOR-A", spec_color: "GRAY" }), row("B-1", { spec_color: "BLUE" })];
  assert.ok(sameRead(first, first), "equal");
  assert.ok(sameRead(first, { rows: moved }), "text moved between fields (the cells are checked against the page)");
  assert.ok(!sameRead(first, { rows: [moved[0]] }), "a row lost");
  assert.ok(!sameRead(first, { rows: [moved[0], row("C-1", { spec_color: "BLUE" })] }), "a different code");
  assert.ok(!sameRead(first, { rows: [moved[0], row("B-1", { spec_color: "BLUE", section: "BASE" })] }), "same codes, another section");
  assert.ok(!sameRead(first, { rows: [], refused: "no-table" }), "a refusal");
  const checks = [{ first: "FL-1", second: "FL-I" }];
  assert.ok(!sameRead({ rows: [row("A-1", { spec_color: "GRAY", code_checks: checks })] }, { rows: [row("A-1", { spec_color: "GRAY" })] }), "code_checks differ");
  assert.ok(!sameRead({ rows: [row("A-1", { spec_color: "GRAY", ocr_code: true, read_as: "A-l" })] }, { rows: [row("A-1", { spec_color: "GRAY", ocr_code: true })] }), "read_as differs");
  // a code the first read skipped
  const skipped: ScheduleRead = { rows: first.rows, skipped: ["EPOX"] };
  const withEpox = [moved[0], row("EPOX", { manufacturer: "VENDOR-E" }), moved[1]];
  assert.ok(sameRead(skipped, { rows: withEpox }), "a skipped code reads as a row");
  assert.ok(sameRead(skipped, { rows: moved, skipped: ["EPOX"] }), "still skipped");
  assert.ok(!sameRead(first, { rows: withEpox }), "an extra row first didn't skip");
  assert.ok(!sameRead(skipped, { rows: moved }), "a skipped code vanished");
  assert.ok(!sameRead(skipped, { rows: moved, skipped: ["EPOX", "SEAL"] }), "a new code skipped");
  assert.ok(!sameRead(skipped, { rows: withEpox, skipped: ["EPOX"] }), "a skipped code read and still skipped");
});

// ── split, never relocate (diff review of the alias look) ────────────────────
// Renaming MFG makes it a column anchor, and a wide column's left-aligned cells
// beside it can move into it with every word kept. The alias read is used only
// when the cells under the alias header's printed text are all that moved.
/** Columns [header, left x, width]: headers centered, cells left-aligned 4 px in, rows 24 px apart. */
const ruled = (cols: [string, number, number][], rows: string[][]) => [
  cell("FINISH SCHEDULE", 40, 30),
  ...cols.map(([s, x, w]) => cell(s, x + (w - s.length * 7) / 2, 70)),
  ...rows.flatMap((r, j) => r.flatMap((v, i) => (v ? [cell(v, cols[i][1] + 4, 100 + j * 24)] : []))),
];
const at = (a: [string, number, number][]) => a.map(([s, x, y]) => cell(s, x, y));
const RULED: [string, number, number][] = [["CODE", 40, 80], ["MATERIAL", 120, 260], ["MFG", 380, 120], ["COLOR", 500, 260], ["REMARKS", 760, 200]];
const R = {
  // MFG printed, every cell under it blank: the first read is right
  blankMfg: ruled(RULED, [["FL-1", "RESILIENT FLOOR", "", "GRAY", "ZONE-A"], ["TL-2", "CERAMIC TILE", "", "BLUE", "ZONE-B"]]),
  // one maker under MFG, read into MATERIAL on the first read; COLOR cells sit nearer the MFG header than the COLOR one
  oneMaker: ruled(RULED, [["FL-1", "RESILIENT FLOOR", "", "GRAY", "ZONE-A"], ["TL-2", "CERAMIC TILE", "VENDOR-B", "BLUE", "ZONE-B"]]),
  // seeded layouts from the review's fuzz run (left-aligned and mixed cells)
  mfrBeforeWideColor: at([["FINISH SCHEDULE", 40, 30], ["CODE", 66.8, 70], ["MATERIAL", 162.2, 70], ["MFR", 340.9, 70], ["COLOR", 577.4, 70], ["REMARKS", 868.8, 70],
    ["TL-1", 44, 100], ["RESILIENT FLOOR", 125.6, 100], ["GRAY", 448.2, 100], ["ALL FLOORS", 749.5, 100], ["TL-2", 44, 124], ["SEALED CONCRETE", 125.6, 124], ["GRAY", 448.2, 124]]),
  mfgLast: at([["FINISH SCHEDULE", 40, 30], ["CODE", 74.5, 70], ["MATERIAL", 186, 70], ["COLOR", 351, 70], ["REMARKS", 562.2, 70], ["MFG", 767.5, 70],
    ["TL-1", 44, 100], ["RUBBER BASE", 140.9, 100], ["GRAY", 295.1, 100], ["ALL FLOORS", 449.8, 100],
    ["CPT-2", 44, 124], ["CERAMIC TILE", 140.9, 124], ["GRAY", 295.1, 124], ["ZONE-A", 449.8, 124], ["VENDOR-A", 731.7, 124]]),
  mfrAfterColor: at([["FINISH SCHEDULE", 40, 30], ["CODE", 65.5, 70], ["MATERIAL", 159.8, 70], ["COLOR", 328, 70], ["MFR", 561.5, 70], ["REMARKS", 803.9, 70],
    ["RB-1", 44, 100], ["CERAMIC TILE", 123, 100], ["BLACK", 328, 100], ["VENDOR-T", 544, 100],
    ["CPT-2", 62, 124], ["RESILIENT FLOOR", 123, 124], ["GRAY", 260.5, 124], ["ALL FLOORS", 713.5, 124],
    ["FL-3", 44, 148], ["CARPET TILE", 123, 148], ["BLACK", 328, 148], ["VENDOR-B", 438.5, 148]]),
};
const fields4 = (r: Read) => r.rows.map((x) => [x.finish_tag, x.description, x.manufacturer, x.spec_color, x.remarks]);

for (const ocr of [false, true]) {
  test(`a blank MFG column takes no color (ocr=${ocr})`, () => {
    assert.deepEqual(fields4(read(R.blankMfg, ocr)), [["FL-1", "RESILIENT FLOOR", "", "GRAY", "ZONE-A"], ["TL-2", "CERAMIC TILE", "", "BLUE", "ZONE-B"]]);
  });

  test(`a row with no maker keeps its color when another row's maker is renamed (ocr=${ocr})`, () => {
    // the first read stands: TL-2's maker stays in its description, as before
    assert.deepEqual(fields4(read(R.oneMaker, ocr)), [["FL-1", "RESILIENT FLOOR", "", "GRAY", "ZONE-A"], ["TL-2", "CERAMIC TILE VENDOR-B", "", "BLUE", "ZONE-B"]]);
  });

  test(`a wide neighbour's cells don't move into the renamed column (ocr=${ocr})`, () => {
    assert.deepEqual(fields4(read(R.mfrBeforeWideColor, ocr)), [["TL-1", "RESILIENT FLOOR", "", "GRAY", "ALL FLOORS"], ["TL-2", "SEALED CONCRETE", "", "GRAY", ""]]);
    const last = read(R.mfgLast, ocr).rows[1];
    assert.deepEqual([last.finish_tag, last.spec_color], ["CPT-2", "GRAY"]);
    const after = read(R.mfrAfterColor, ocr).rows[1];
    assert.deepEqual([after.finish_tag, after.description, after.spec_color], ["CPT-2", "RESILIENT FLOOR", "GRAY"]);
  });

  test(`an OCR box glued across MFG | COLOR keeps the first read (ocr=${ocr})`, () => {
    assert.deepEqual(read(A.T12, ocr).rows.map((x) => [x.manufacturer, x.spec_color]), [["", "VENDOR-A GRAY"], ["", "VENDOR-B BLUE"], ["", "VENDOR-C BLACK"]]);
  });
}

test("a box with no code line gets no alias look", () => {
  // letters-only keys: no line shows a finish code, so no header line is chosen
  const lettered = grid(T1_ALIASES, ["C", "M", "V", "K", "N"], { rows: R3.map((r, i) => ({ ...r, C: "ABC"[i] })) });
  assert.equal(reshapeBox(lettered, { aliasesOnly: true }), null);
});

test("sameRead: a row's key rule must not change", () => {
  const row = (o: Record<string, unknown> = {}) => ({ finish_tag: "A-1", section: "", category: "unassigned", category_source: "none", description: "", manufacturer: "", style: "", spec_color: "GRAY", size: "", remarks: "", suggested: true, ...o }) as ScheduleRead["rows"][number];
  assert.ok(!sameRead({ rows: [row()] }, { rows: [row({ key_rule: "extended" })] }));
});

// ── page positions: an alias column's own cells ───────────────────────────────
// Layouts from the review's word- and cell-span fuzz runs (invented values). In
// each, a cell of a neighbouring column sits nearer the renamed header than its
// own, or the alias header's text doesn't reach over its cells: the first read stands.
const at5 = (a: [string, number, number, number, number][]) => a.map(([str, x, y, w, h]) => ({ str, x, y, w, h }));
const P = {
  seed143: at5([["FINISH",39.3,30.2,41.8,9.9],["SCHEDULE",90.9,28.9,56.6,9.9],["CODE",72,68.7,28.4,11.8],["MATERIAL",173.1,70.5,57.4,11],["COLOR",316.5,70.2,34.9,10.7],["MFG",447.9,68.3,21.2,8.8],["REMARKS",586.5,71,47,9.1],["TL-1",44.2,100.7,26.2,10],["LVT",187.3,100,19.3,8.7],["GRAY",270.2,100.1,27.4,11.2],["ALL",516.6,100.2,20.1,9.1],["FLOORS",542.3,101.9,43,9.1],["CPT-2",70.1,123.1,33.2,10.5],["RUBBER",159.9,125.3,42.9,8.8],["BASE",208.9,124.4,28.1,8.8],["GRAY",267.2,125.7,29.2,11.9],["ALL",516,124.6,20.3,11.9],["FLOORS",541.2,125.2,41.2,11.9]]),
  seed442: at5([["FINISH",41.7,31.4,37.7,9.2],["SCHEDULE",84.6,29.7,51.3,9.2],["CODE",57.5,68.9,25.4,9.5],["MATERIAL",154.5,68.1,51,8],["COLOR",320.9,70.1,30.1,8.4],["NOTES",449.2,68.5,30.7,8.7],["FL-1",43.2,98.7,26.5,10.1],["CARPET",108.9,101.9,38.2,8.8],["TILE",151.7,98.1,23.1,8.8],["COOL",264.5,98.3,26.4,11.4],["GRAY",295.7,98,23.4,11.4],["2",324.5,98.6,6.2,11.4],["TL-2",44.6,123.8,25.6,8],["RESILIENT",107,125.2,56.9,10.8],["FLOOR",168.1,125.3,29.2,10.8],["SLATE",263,122.9,30.3,8.6],["CPT-3",56,148.9,31.4,10.7],["CERAMIC",105.4,147.6,42.1,9.6],["TILE",152.2,147.5,25.1,9.6],["COOL",300,149.9,24.4,11.6],["GRAY",334,147,24.4,11.6],["2",362.4,147.6,4.8,11.6],["TL-4",61.1,172.4,24.5,10.4],["RESILIENT",108.4,172.5,56.6,8.4],["FLOOR",170,172.8,29.9,8.4],["GRAY",261.8,170.4,24.6,8.8],["NOT",441,172.6,19.7,11.9],["USED",462.2,171.1,25.4,11.9]]),
  seed333: at5([["FINISH",39.9,28.4,40.9,8.8],["SCHEDULE",87.6,30.1,51.9,8.8],["CODE",64.7,68,26.2,8.9],["MATERIAL",238.9,70.5,54.3,10.9],["COLOR",516.9,68.6,33.4,8.7],["MFG",703.5,71,19.9,10.4],["FL-1",42.6,100.8,24.7,9.8],["PORCELAIN",216.2,100.6,59.2,10.5],["TILE",280.4,99.1,26.7,10.5],["WARM",500.8,101.5,25.8,11.9],["WHITE",531.6,98.7,31.7,11.9],["FL-2",65,125.7,25.7,9.1],["CARPET",123.5,122.8,38.6,11.5],["TILE",169.7,124.9,28.6,11.5],["COOL",413.1,122.5,26.5,11.8],["GRAY",443.4,125.9,27.9,11.8],["2",478,125.6,7.3,11.8],["RB-3",45.3,149.3,25.2,10.8],["PORCELAIN",216.6,146.8,59.1,10.9],["TILE",281.4,148.1,28.2,10.9],["SLATE",411.4,147.4,34,10.5],["VENDOR-T",685.4,147.6,55,10.3],["FL-4",65.2,172.7,25,10],["RUBBER",226.8,170.2,40.6,8.2],["BASE",269.6,173,27.8,8.2],["WARM",502.4,171.8,28.3,8.6],["WHITE",530,172.5,31.6,8.6]]),
  seed121: at5([["FINISH",40.6,32,32.4,11.6],["SCHEDULE",76.2,31.7,45.2,11.6],["CODE",64.8,71.3,22.1,10.1],["MATERIAL",189.9,71.8,45.9,11.6],["COLOR",444.6,71,29.5,9.1],["MFG",646.7,71,16,8.9],["NOTES",821.9,71.5,26.3,8.5],["RB-1",42.5,98.1,23.5,8.6],["CERAMIC",120.4,99.7,38.3,10.2],["TILE",165.8,101.7,22.3,10.2],["BLUE",310.7,98,21.7,9.1],["TL-2",43.8,123.7,24,9.3],["PORCELAIN",118.6,122.5,49.2,10],["TILE",173,124.6,21.1,10],["WARM",312.9,125.5,21.7,11.2],["WHITE",341,122,27.2,11.2],["TRANSITIONS",611,125.1,59.8,10.2],["INC",675.6,122.7,15.8,10.2],["CPT-3",45,146.7,26.6,11.3],["RUBBER",120.8,149.2,35.5,9.2],["BASE",157.3,147.8,21.3,9.2],["BLUE",311.3,146.2,23.7,9.4],["TRANSITIONS",611.4,147.3,63.1,11.7],["INC",673.2,147.6,18.6,11.7]]),
  seed197: at5([["FINISH",38.2,28.1,32.8,8.5],["SCHEDULE",77.4,30.4,40.7,8.5],["CODE",72.5,71.6,21.8,11.4],["MATERIAL",255.1,68.5,42.7,8.5],["COLOR",473.3,70.7,26.6,10.4],["MFR",606,70.2,17.5,11.9],["NOTES",714.9,70.7,24.7,10],["TL-1",45.3,99.3,20.2,10.1],["CARPET",127.4,99.6,32.5,10.1],["TILE",162.6,100.1,20.4,10.1],["GRAY",429.2,101.2,21.1,11.2],["RB-2",42.3,125.3,21.3,8.8],["SEALED",130.3,125.3,30.4,11.8],["CONCRETE",166.6,123.2,41.9,11.8],["BLACK",427,122.2,24.4,9.6],["BLUE",556.9,122.3,22.7,10.7],["PEAK",581.9,125.4,24.2,10.7],["TILE",611.9,125.8,22.8,10.7],["CO",637.5,123.1,10.8,10.7],["RB-3",42.5,147.8,22.1,11.5],["RUBBER",130.9,149.4,30.4,10.3],["BASE",164.2,147.5,21,10.3],["GRAY",428,147.4,20.9,8.6],["BLUE",554.2,146.3,21.2,9.1],["PEAK",579.5,149.4,24.8,9.1],["TILE",610.1,148,22,9.1],["CO",638.8,147.3,9.5,9.1]]),
  seed35: at5([["FINISH SCHEDULE",40.9,28.2,86.3,8.2],["CODE",59,69.3,21.7,8],["MATERIAL",174.7,68.3,48.4,8.5],["COLOR",358.3,69.4,28.5,9],["MFG",590,71.4,16.2,11.8],["NOTES",806.3,70.6,28.3,9.9],["TL-1",45.6,101.5,24.5,9],["CERAMIC TILE",109.2,98.3,69.3,10.2],["COOL GRAY 2",296,98.8,63.2,8.7],["BLUE PEAK TILE CO",461,99.7,105.6,8.9],["CPT-2",44.4,122.5,30.1,9.2],["CERAMIC TILE",111,125.1,71.9,11.7],["COOL GRAY 2",295.2,123.1,65.9,10.3],["VENDOR A",464.1,125.5,47.1,8]]),
  seed321: at5([["FINISH",41.8,31.4,39.6,8.5],["SCHEDULE",82.4,29.6,52,8.5],["CODE",75.3,69,25.2,9.4],["SPEC",178.8,68.4,24.8,10.3],["MATERIAL",268.2,71.3,52.1,8.3],["COLOR",383.7,72,32.4,9.7],["CPT-1",73.8,100.6,29.7,11.7],["09",143.9,98.8,13.9,9.7],["30",159.3,99,14.3,9.7],["00",180.3,101.7,11.6,9.7],["PORCELAIN",247.9,101.2,57.6,10.3],["TILE",306.9,99,25.7,10.3],["SLATE",347.8,98,33.2,11.4],["CPT-2",74.1,124.7,30.6,11.2],["09",167,122.9,12.4,8.7],["30",184.9,125.5,14.2,8.7],["00",201.3,122.7,14.1,8.7],["BLUE",347.5,126,25.2,9.2],["TL-3",77.1,147.2,27,8.9],["096813",171.5,147.8,36.7,8.9],["PORCELAIN",248.6,149.6,58,12],["TILE",313.7,149.9,26,12],["WARM",348.2,146.4,24.8,10.3],["WHITE",376.7,149.9,31.6,10.3],["CPT-4",45.4,171.6,31.8,8.2],["09",163.9,172.4,13.6,8.8],["30",181.9,172.6,11.4,8.8],["00",199.1,173.8,13.8,8.8],["BLUE",347.3,172.5,24.5,10.4]]),
  seed180: at5([["FINISH SCHEDULE",41,29.6,103.7,10.6],["CODE",61.7,71,29,12],["SPEC",181,69.1,25.3,8.5],["MATERIAL",385.3,70.1,52.9,9.3],["COLOR",621.5,71.4,34.6,11.3],["CPT-1",42.4,101.2,34.7,11.5],["09 30 00",168.2,101.7,53.3,8],["LVT",403.9,100.8,20.9,9.6],["BLUE",550.7,99.1,25.9,8.7],["TL-2",60.6,124,29.1,11.3],["09 65 13",167.4,125.3,54.8,9.3],["RUBBER BASE",285.1,125.7,74.4,11.5],["GRAY",553.1,124.2,25.5,11.5],["RB-3",61.7,149.2,27.1,11.6],["LVT",402.2,149,19.5,8.5],["SLATE",552.9,148.2,33.8,9.3]]),
  seed34: at5([["FINISH",41.6,31.7,37.7,8.1],["SCHEDULE",78.6,29.8,49.1,8.1],["CODE",65.7,70.2,26.1,9],["MATERIAL",145.5,69.8,47.3,8.3],["MFR",274.7,71.7,19.2,11.3],["SPECIFICATION",425,70.8,78.8,10.3],["COLOR",614.2,70,31.2,8.2],["FL-1",43,98.2,23.1,11.6],["RUBBER",121.8,99.4,36.2,11.7],["BASE",162.6,100.9,24.9,11.7],["09",357.8,98.7,10.3,8.8],["30",375.7,99,11.3,8.8],["00",393.3,99,13,8.8],["WARM",584.7,99.6,24.9,10.5],["WHITE",616,100.2,31.8,10.5],["FL-2",42.2,125.6,22.8,9.4],["PORCELAIN",123.4,125.3,53.7,10.1],["TILE",182.8,124.1,26.4,10.1],["09",356.4,124.9,12.5,9.7],["65",374.9,124.8,11,9.7],["13",389.4,124.9,12.8,9.7],["BLACK",582,125.7,29.1,10.6],["FL-3",42.2,149,23.9,11.9],["RESILIENT",122.8,146.7,53.7,12],["FLOOR",181.7,146.1,31,12],["09",355,146.8,10.3,11.3],["30",373,147.4,12.9,11.3],["00",390.4,149.2,13.5,11.3],["COOL",583.7,146.7,23.2,10.7],["GRAY",614.2,149.2,23.9,10.7],["2",641.8,148.7,5,10.7]]),
  seed189: at5([["FINISH SCHEDULE",40.9,31.8,101.3,9.7],["CODE",70.5,68.1,24.8,10.6],["MATERIAL",163.6,69.4,52.2,10.5],["MFR",313.9,70.4,21.2,11.1],["SPEC",508.8,70.2,24.6,9.4],["COLOR",747.4,69.8,32.2,9.8],["FL-1",45.8,98.9,24.7,10.8],["CERAMIC TILE",150.2,99.7,81.4,10.5],["09 30 00",396.9,98.2,52.2,8.6],["SLATE",653.3,98.8,34.3,10],["FL-2",43.6,122.7,28.5,9],["CARPET TILE",135.2,123.3,71.8,11.7],["GRAY CO",298.8,124.7,45.2,9],["09 65 13",497.8,125.2,53,8.2],["WARM WHITE",654.1,124.8,67.2,9.2],["FL-3",42.6,149.5,28.4,11.9],["CERAMIC TILE",132.1,149,79.7,11.9],["VENDOR-T",297.3,148.9,54.4,8.1],["09 30 00",396.8,148.3,52.2,9.2],["BLACK",748.8,148.7,31.4,9.3],["RB-4",44.9,172.6,25.9,9],["LVT",180.7,170.7,21.1,9.3],["VENDOR A",295,170.8,51.4,11.5],["096813",502.6,172.8,41.9,8.8],["WARM WHITE",732.1,173.7,67,10.3]]),
};
const firstRead: Record<keyof typeof P, (string | boolean)[][]> = {
  seed143: [["TL-1","LVT","","GRAY","ALL FLOORS","unassigned",true],["CPT-2","RUBBER BASE","","GRAY","ALL FLOORS","base",true]],
  seed442: [["FL-1","TILE CARPET","","COOL GRAY 2","","unassigned",true],["TL-2","RESILIENT FLOOR","","SLATE","","unassigned",true],["CPT-3","CERAMIC TILE","","COOL GRAY 2","","unassigned",true],["TL-4","RESILIENT FLOOR","","GRAY NOT USED","","unassigned",true]],
  seed333: [["FL-1","PORCELAIN","","TILE WARM WHITE","","unassigned",true],["FL-2","","","COOL GRAY 2","","unassigned",true],["RB-3","PORCELAIN","","TILE SLATE VENDOR-T","","unassigned",true],["FL-4","RUBBER BASE","","WARM WHITE","","base",true]],
  seed121: [["RB-1","CERAMIC TILE","","BLUE","","unassigned",true],["TL-2","PORCELAIN TILE","","WARM WHITE TRANSITIONS INC","","unassigned",true],["CPT-3","RUBBER BASE","","BLUE TRANSITIONS INC","","base",true]],
  seed197: [["TL-1","CARPET TILE","","GRAY","","unassigned",true],["RB-2","SEALED CONCRETE","","BLACK BLUE PEAK TILE CO","","unassigned",true],["RB-3","RUBBER BASE","","GRAY BLUE PEAK TILE CO","","base",true]],
  seed35: [["TL-1","CERAMIC TILE","","COOL GRAY 2 BLUE PEAK TILE CO","","unassigned",true],["CPT-2","CERAMIC TILE","","COOL GRAY 2 VENDOR A","","unassigned",true]],
  seed321: [["CPT-1","30 00 PORCELAIN TILE","","SLATE","","unassigned",true],["CPT-2","09 30 00","","BLUE","","unassigned",true],["TL-3","096813 PORCELAIN TILE","","WARM WHITE","","unassigned",true],["CPT-4","09 30 00","","BLUE","","unassigned",true]],
  seed180: [["CPT-1","09 30 00 LVT","","BLUE","","unassigned",true],["TL-2","09 65 13 RUBBER BASE","","GRAY","","base",true],["RB-3","LVT","","SLATE","","unassigned",true]],
  seed34: [["FL-1","RUBBER BASE","","09 30 00 WARM WHITE","","base",true],["FL-2","PORCELAIN","","TILE 09 65 13 BLACK","","unassigned",true],["FL-3","RESILIENT","","FLOOR 09 30 00 COOL GRAY 2","","unassigned",true]],
  seed189: [["FL-1","","","CERAMIC TILE 09 30 00 SLATE","","unassigned",true],["FL-2","CARPET TILE","","GRAY CO 09 65 13 WARM WHITE","","unassigned",true],["FL-3","CERAMIC TILE","","VENDOR-T 09 30 00 BLACK","","unassigned",true],["RB-4","","","LVT VENDOR A 096813 WARM WHITE","","unassigned",true]],
};
// MFG centred over a wide column, its vendors left-aligned: they never reach under the header text
const centredMfg = at5([["FINISH SCHEDULE",41.7,28.1,105.5,8.7],["CODE",60.5,68.1,27.8,9.7],["MFG",187.7,68.5,22.5,10.8],["MATERIAL",397.2,69,54.4,11.7],["COLOR",676.3,68.9,34.7,12],["FL-1",42,98.2,28.7,8.1],["BLUE PEAK TILE CO",111.7,100.3,124.1,9.4],["SEALED CONCRETE",293.3,102,106.4,11.3],["BLACK",562.9,99.8,34.7,10.9],["RB-2",45.7,125.7,27.2,8.6],["VENDOR-A",111.8,125.6,57.3,11.2],["SEALED CONCRETE",294.6,125.8,106.2,11.8],["GRAY",562.7,125.4,27.3,9.5]]);
const cols7 = (r: Read) => r.rows.map((x) => [x.finish_tag, x.description, x.manufacturer, x.spec_color, x.remarks, x.category, x.suggested]);
// two text-layer runs in one COLOR cell (pdf.js split), MFG printed with nothing under it
const twoRuns = (() => {
  const C: [string, number, number][] = [["CODE", 40, 80], ["MATERIAL", 120, 200], ["MFG", 320, 120], ["COLOR", 440, 300], ["REMARKS", 740, 200]];
  const c12 = (str: string, x: number, y: number) => cell(str, x, y, str.length * 7, 12);
  return [c12("FINISH SCHEDULE", 40, 30), ...C.map(([s, x, w]) => c12(s, x + (w - s.length * 7) / 2, 70)),
    ...[["FL-1", "CARPET TILE"], ["FL-2", "RUBBER BASE"]].flatMap(([c, m], j) => [c12(c, 40 + (80 - c.length * 7) / 2, 100 + j * 24), c12(m, 120 + (200 - m.length * 7) / 2, 100 + j * 24)]),
    c12("WARM", 444, 100), c12("WHITE", 444 + 28 + 5, 100), c12("COOL GRAY", 444, 124), c12("2", 444 + 63 + 5, 124)];
})();

for (const ocr of [false, true]) {
  test(`a cell split into two runs keeps its words when MFG has none (ocr=${ocr})`, () => {
    assert.deepEqual(read(twoRuns, ocr).rows.map((x) => [x.finish_tag, x.manufacturer, x.spec_color]), [["FL-1", "", "WARM WHITE"], ["FL-2", "", "COOL GRAY 2"]]);
  });

  for (const n of Object.keys(P) as (keyof typeof P)[]) {
    test(`a neighbour's cell nearer the renamed header keeps the first read: ${n} (ocr=${ocr})`, () => {
      assert.deepEqual(cols7(read(P[n], ocr)), firstRead[n]);
    });
  }

  test(`a mark under MFG between two rows keeps the first read (ocr=${ocr})`, () => {
    // REV sits under the MFG header but in neither row: which row it belongs to isn't known
    assert.deepEqual(read([...A.T1, cell("REV", 440, 131)], ocr).rows.map((x) => [x.finish_tag, x.manufacturer, x.spec_color]),
      [["FL-1", "", "VENDOR-A GRAY"], ["TL-2", "", "VENDOR-B BLUE"], ["RB-3", "", "TRANSITIONS INC BLACK"]]);
  });

  test(`a word the first read dropped doesn't join the renamed column (ocr=${ocr})`, () => {
    // CO sits right of MFG (printed last), under no header: the first read drops it, the renamed read
    // would add it to FL-1's maker, so the first read stands
    const s = grid(["CODE", "MATERIAL", "COLOR", "MFG"], ["C", "M", "K", "V"], { rows: R3.map((r) => ({ ...r, V: r.V.split(" ")[0] })), extra: [cell("CO", 730, 110)] });
    assert.deepEqual(read(s, ocr).rows.map((x) => [x.finish_tag, x.manufacturer, x.spec_color]),
      [["FL-1", "", "GRAY VENDOR-A"], ["TL-2", "", "BLUE VENDOR-B"], ["RB-3", "", "BLACK TRANSITIONS"]]);
  });

  test(`vendors that don't reach under a centred MFG header keep the first read (ocr=${ocr})`, () => {
    assert.deepEqual(cols7(read(centredMfg, ocr)), [["FL-1","BLUE PEAK TILE CO SEALED CONCRETE","","BLACK","","unassigned",true],["RB-2","VENDOR-A SEALED CONCRETE","","GRAY","","unassigned",true]]);
  });
}
