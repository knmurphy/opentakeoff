// Column-selection library: profiles, prefs, getters, and the column-driven
// CSV. The default-CSV assertion here deliberately overlaps the golden test —
// it locks CSV_PROFILE itself (defaults + order + headers) to the same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conditionTotals, sheetTotals, totalsToCsv, round2 } from "../src/lib/totals.js";
import {
  GETTERS, CSV_PROFILE, TABLE_PROFILE, customColProfile,
  loadColPrefs, saveColPrefs, visibleCols, floorPerimeterLf,
} from "../src/lib/reportColumns.js";
import { conditions, shapes, projectName, sheetLabel } from "./fixtures/report.fixture.ts";

const rows = conditionTotals(conditions, shapes).filter((r: any) => r.shape_count > 0);
const golden = readFileSync(new URL("./fixtures/report.golden.csv", import.meta.url), "utf8");

test("default-visible CSV_PROFILE columns reproduce the golden CSV byte-for-byte", () => {
  const defaults = visibleCols(CSV_PROFILE, {});
  assert.equal(defaults.length, 13);
  // cols passed explicitly (the default-visible set) — same bytes as cols=null
  const csv = totalsToCsv(rows, projectName, sheetTotals(conditions, shapes), sheetLabel, defaults);
  assert.equal(csv, golden);
  assert.equal(totalsToCsv(rows, projectName, sheetTotals(conditions, shapes), sheetLabel), golden);
});

test("visibleCols: overrides flip defaults both ways; unknown keys ignored", () => {
  const on = visibleCols(CSV_PROFILE, { waste_sf: true, sy_net: false, bogus_key: true });
  const keys = on.map((c: any) => c.key);
  assert.ok(keys.includes("waste_sf"));          // default-off flipped on
  assert.ok(!keys.includes("sy_net"));           // default-on flipped off
  assert.ok(!keys.includes("bogus_key"));        // unknown pref key: no column invented
  assert.equal(on.length, 13);                   // +1 −1 against the 13 defaults
  // no prefs → defaults exactly, in profile order
  assert.deepEqual(visibleCols(TABLE_PROFILE, {}).map((c: any) => c.key),
    TABLE_PROFILE.filter((c: any) => c.defaultVisible).map((c: any) => c.key));
});

test("waste_sf / waste_lf getters: order minus base, rounded", () => {
  const r = { total_sf: 100.004, total_sf_net: 110.01, lf: 10, lf_net: 10.5 };
  assert.equal(GETTERS.waste_sf(r), 10.01);      // 110.01 − 100.004 = 10.006 → 10.01
  assert.equal(GETTERS.waste_lf(r), 0.5);
});

test("floorPerimeterLf: sums only floor_area shapes per condition, unrounded", () => {
  const m = floorPerimeterLf(shapes);
  assert.equal(m.get("ct1"), 44.4 + 90.12);      // deduct shape s3 excluded
  assert.equal(m.get("lvt2"), 61.7);
  assert.equal(m.has("rb1"), false);             // linear
  assert.equal(m.has("wt1"), false);             // surface_area
  assert.equal(m.has("cnt"), false);             // count
  // unrounded accumulation — raw float sum survives
  const raw = floorPerimeterLf([
    { condition_id: "x", measure_role: "floor_area", computed: { perimeter_lf: 0.1 } },
    { condition_id: "x", measure_role: "floor_area", computed: { perimeter_lf: 0.2 } },
  ]);
  assert.equal(raw.get("x"), 0.1 + 0.2);         // 0.30000000000000004, not 0.3
});

test("perimeter_ref getter reads the ctx map, 0 when absent", () => {
  const r = { id: "ct1" };
  assert.equal(GETTERS.perimeter_ref(r, { perimByCond: floorPerimeterLf(shapes) }), 134.52);
  assert.equal(GETTERS.perimeter_ref(r, { perimByCond: new Map() }), 0);
  assert.equal(GETTERS.perimeter_ref(r), 0);     // no ctx at all
});

test("perimeter_ref applies the condition multiplier (the verticalWallSf convention)", () => {
  const ctx = { perimByCond: new Map([["c", 40.1]]) };
  assert.equal(GETTERS.perimeter_ref({ id: "c", multiplier: 3 }, ctx), 120.3);
  assert.equal(GETTERS.perimeter_ref({ id: "c" }, ctx), 40.1);   // missing multiplier → 1
});

test("locked finish column survives a hand-corrupted pref", () => {
  const cols = visibleCols(TABLE_PROFILE, { finish: false });
  assert.equal(cols[0].key, "finish");
  const csvCols = visibleCols(CSV_PROFILE, { finish: false });
  assert.equal(csvCols[0].key, "finish");
});

test("locked columns are exactly [finish] in both profiles (the picker filters on locked)", () => {
  // ReportPanel's column picker hides `locked` columns — a new locked column
  // must be a deliberate picker change, not a silent one
  for (const profile of [TABLE_PROFILE, CSV_PROFILE]) {
    assert.deepEqual(profile.filter((c: any) => c.locked).map((c: any) => c.key), ["finish"]);
  }
});

test("CSV with a base column toggled off drops it end-to-end", () => {
  const cols = visibleCols(CSV_PROFILE, { sy_net: false });
  const csv = totalsToCsv(rows, projectName, null, null, cols);
  const header = csv.split("\n")[1];
  assert.ok(!header.includes("SY (w/ waste)"));
  assert.ok(header.endsWith("LF (w/ waste)"));   // neighbours intact, order kept
});

test("CSV with opt-ins: appended at the end, base 13 untouched, TOTAL blank under perimeter_ref", () => {
  const cols = visibleCols(CSV_PROFILE, { waste_sf: true, waste_lf: true, perimeter_ref: true });
  const ctx = { perimByCond: floorPerimeterLf(shapes) };
  const csv = totalsToCsv(rows, projectName, sheetTotals(conditions, shapes), sheetLabel, cols, ctx);
  const lines = csv.split("\n");
  const goldenHeader = golden.split("\n")[1];    // line 0 is the title comment
  // existing 13 header cells unchanged, opt-ins appended verbatim at the end
  assert.equal(lines[1],
    goldenHeader + ',Waste SF,Waste LF,"Perimeter LF (ref, incl. openings)"');
  // CT-1 row: waste_sf = 601.59 − 546.9, waste_lf = 0, perimeter = 44.4 + 90.12
  const ct1 = lines[2].split(",");
  assert.deepEqual(ct1.slice(-3).map(Number), [54.69, 0, 134.52]);
  // TOTAL row: derived waste feet present, perimeter_ref blank (reference only)
  const totalLine = lines.find((l) => l.startsWith("TOTAL"))!;
  const totalCells = totalLine.split(",");
  assert.equal(totalCells.length, 16);
  assert.equal(Number(totalCells[13]), round2(1373.76 - 1316.91));
  assert.equal(Number(totalCells[14]), round2(136.34 - 129.85));
  assert.equal(totalCells[15], "");
});

// ── custom (user-defined) condition columns (issue #34) ─────────────────────

test("customColProfile: descriptors from definitions; get reads ctx and coerces non-strings", () => {
  const cols = customColProfile([
    { id: "c9", name: "CSI Division", values: ["09 68 00"] },
    { id: "c0", name: "", values: [] },              // empty name → display fallback
  ]);
  assert.deepEqual(cols.map((c: any) => [c.key, c.header, c.defaultVisible, c.custom]), [
    ["custom:c9", "CSI Division", false, true],
    ["custom:c0", "Untitled", false, true],
  ]);
  const ctx = { attrsByCond: new Map([["ct1", { c9: "09 68 00", c0: 42 }]]) };
  assert.equal(cols[0].get({ id: "ct1" }, ctx), "09 68 00");
  assert.equal(cols[1].get({ id: "ct1" }, ctx), "");   // non-string coerced to ""
  assert.equal(cols[0].get({ id: "zz" }, ctx), "");    // unassigned condition
  assert.equal(cols[0].get({ id: "ct1" }), "");        // no ctx at all
  assert.deepEqual(customColProfile(null), []);
  assert.deepEqual(customColProfile(undefined), []);
});

test("CSV with custom columns: hostile headers escaped, values per row, TOTAL blank, frozen 13 untouched", () => {
  const defs = [
    { id: "div", name: "CSI Division, 2020", values: ["09 68 00", "09 65 00"] },  // comma → quoted
    { id: "inj", name: "=SUM(A1:A9)", values: [] },                               // formula → ' guard
  ];
  const cols = [...visibleCols(CSV_PROFILE, {}), ...customColProfile(defs)];
  const ctx = {
    attrsByCond: new Map([
      ["ct1", { div: "09 68 00" }],
      ["lvt2", { div: "09 65 00", inj: "=HYPERLINK" }],  // formula-shaped VALUE guarded too
    ]),
  };
  const csv = totalsToCsv(rows, projectName, sheetTotals(conditions, shapes), sheetLabel, cols, ctx);
  const lines = csv.split("\n");
  const goldenLines = golden.split("\n");
  // frozen 13 header cells byte-identical, custom headers appended escaped
  assert.equal(lines[1], goldenLines[1] + ',"CSI Division, 2020",\'=SUM(A1:A9)');
  // CT-1 body row = golden row + assigned value + blank (no inj assignment)
  assert.equal(lines[2], goldenLines[2] + ",09 68 00,");
  assert.deepEqual(lines[3].split(",").slice(-2), ["09 65 00", "'=HYPERLINK"]);
  // TOTAL row: custom keys absent from grandTotals → both cells blank
  const totalCells = lines.find((l) => l.startsWith("TOTAL"))!.split(",");
  assert.equal(totalCells.length, 15);
  assert.deepEqual(totalCells.slice(-2), ["", ""]);
});

test("loadColPrefs returns {} without localStorage; saveColPrefs swallows too", () => {
  assert.equal(typeof globalThis.localStorage, "undefined"); // node test env
  assert.deepEqual(loadColPrefs(), {});
  assert.doesNotThrow(() => saveColPrefs({ waste_sf: true }));
});
