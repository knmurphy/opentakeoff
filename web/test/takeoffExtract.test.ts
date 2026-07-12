// Takeoff-markup extractor — pure geometry + legend reconciliation for issue #127
// (batch-detection validation corpus). No DOM, no pdf.js: the tested surface is
// fed already-decoded path ops / text rows, so it runs straight under node.
// Run with: npm test  (node --import tsx --test test/*.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconstructRings,
  parseLegend,
  parseScaleK,
  parseQuantityColumn,
  reconcile,
  nearestRoomNumber,
  buildGroundTruth,
} from "../src/lib/takeoffExtract.ts";

// text items as pdf.js getTextContent returns them: {str, transform:[a,b,c,d,e,f]}
// where (e,f) is the item origin. We only use str + the y origin (transform[5]).
function ti(str: string, x: number, y: number) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

// pdf.js constructPath op codes we consume (moveTo/lineTo/close/rect). The real
// OPS table assigns different numbers; the module takes them as an argument so
// the unit is table-agnostic.
const OPS = { moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19 };

test("reconstructRings: a moveTo starts a NEW ring — two touching sub-paths stay two rings, never merged", () => {
  // two unit squares sharing the edge x=1 — a single constructPath with two
  // sub-paths. The prior spike over-merged adjacent sub-paths into one ring and
  // inflated area; a moveTo MUST split.
  const ops = [
    OPS.moveTo, OPS.lineTo, OPS.lineTo, OPS.lineTo, OPS.closePath,   // square A
    OPS.moveTo, OPS.lineTo, OPS.lineTo, OPS.lineTo, OPS.closePath,   // square B
  ];
  const coords = [
    0, 0, 1, 0, 1, 1, 0, 1,   // A
    1, 0, 2, 0, 2, 1, 1, 1,   // B
  ];
  const rings = reconstructRings(ops, coords, OPS);
  assert.equal(rings.length, 2, "two moveTo sub-paths => two rings");
  assert.deepEqual(rings[0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.deepEqual(rings[1], [[1, 0], [2, 0], [2, 1], [1, 1]]);
});

test("reconstructRings: a rectangle op is a self-contained ring; a curve contributes its endpoint", () => {
  // one rect + one moveTo/curve/close sub-path in a single constructPath.
  const ops = [
    OPS.rectangle,                                   // rect ring (x,y,w,h)
    OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.closePath,   // triangle-ish w/ a curved edge
  ];
  const coords = [
    10, 10, 5, 5,                                    // rect: 10,10 → 15,15
    0, 0, 4, 0, /*curveTo cp1*/ 4, 2, /*cp2*/ 2, 4, /*end*/ 0, 4,
  ];
  const rings = reconstructRings(ops, coords, OPS);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings[0], [[10, 10], [15, 10], [15, 15], [10, 15]], "rect corners CCW from origin");
  // the curve appends only its endpoint (chord approximation is fine for area here)
  assert.deepEqual(rings[1], [[0, 0], [4, 0], [0, 4]]);
});

test("parseLegend: pairs a material code with the SF/LF quantity on its row (83 King legend)", () => {
  // real 83 King legend layout: code at x≈184, quantity at x≈707, SAME y.
  const items = [
    ti("CPT-3 [INTERFACE C551 WHITE ]", 184, 233),
    ti("2,674.32 SF", 707, 233),
    ti("FT-1 [ TILEBAR HEXART 8X8 GRIS HEX MATTE]", 184, 181),
    ti("72.13 SF", 707, 181),
    ti("VCT-1 [ ARMSTRONG EXCELEON GRAY 12X12]", 184, 75),
    ti("430.50 SF", 707, 75),
    ti("358.79 LF", 707, 207),                 // an LF row whose code sits elsewhere / is a base
    ti("2,454.25 LF", 707, 101),
    ti("1 EA", 707, 128),
    ti("LVT/VCT IS NOT CALLED OUT. CONFIRM FINAL INTENT WITH ARCHITECT.", 155, 362), // prose, not a row
  ];
  const rows = parseLegend(items);
  const byMat = Object.fromEntries(rows.map((r) => [r.material, r]));
  assert.equal(byMat["CPT-3"].qty, 2674.32);
  assert.equal(byMat["CPT-3"].unit, "SF");
  assert.equal(byMat["FT-1"].qty, 72.13);
  assert.equal(byMat["VCT-1"].qty, 430.50);
  assert.equal(byMat["VCT-1"].unit, "SF");
  // prose line must not become a material row
  assert.ok(!rows.some((r) => /CALLED OUT/.test(r.material)));
});

test("parseLegend: reports whether ANY SF/LF quantity is present — the marked-file gate", () => {
  const marked = parseLegend([ti("CPT-2 [INTERFACE C551 ]", 184, 260), ti("1,504.86 SF", 707, 260)]);
  assert.ok(marked.length > 0, "SF legend present => rows found");
  // an architect phasing plan (VMC-Kent-Station) has colored fills but NO SF/LF
  // legend text — parseLegend must return no rows so the file is rejected as unmarked.
  const unmarked = parseLegend([ti("PHASE 1", 100, 100), ti("LEVEL 2 PLAN", 100, 80)]);
  assert.equal(unmarked.length, 0, "no SF/LF text => no rows => not a marked takeoff");
});

// The killer validation: on marked 83 King, summing each fill color's shoelace
// ring area (device px) and dividing by ONE per-sheet k reproduces the legend
// to the decimal. These colorArea px sums are the REAL extractor output from
// the marked PDF (verified by spike against the file). reconcile must recover
// k≈81 by consensus and assign every material color to its legend row.
const KING_COLOR_AREAS_PX = {
  "130,191,134": 743017,   // → CPT-1 9,173.05
  "0,55,90":     216620,   // → CPT-3 2,674.32
  "0,94,3":      121893,   // → CPT-2 1,504.86
  "127,210,219":  34870,   // → VCT-1   430.50
  "238,62,62":     5843,   // → FT-1     72.13
  // decoys that must NOT reconcile:
  "255,255,127": 905557,   // native/phasing yellow — largest fill, matches no row
  "152,152,152": 271801,   // base linework gray poché
  "255,255,0":    39023,   // stray annotation yellow
};
const KING_LEGEND = [
  { material: "CPT-1", qty: 9173.05, unit: "SF" as const },
  { material: "CPT-2", qty: 1504.86, unit: "SF" as const },
  { material: "CPT-3", qty: 2674.32, unit: "SF" as const },
  { material: "VCT-1", qty: 430.50,  unit: "SF" as const },
  { material: "FT-1",  qty: 72.13,   unit: "SF" as const },
];

test("reconcile: 83 King checksum — one consensus k reproduces the legend to the decimal", () => {
  const r = reconcile(KING_COLOR_AREAS_PX, KING_LEGEND);
  // ONE scale, physically meaningful (1/8\"=1'-0\" ⇒ 81 px²/SF at scale=1)
  assert.ok(Math.abs(r.k - 81) < 0.5, `consensus k≈81, got ${r.k}`);
  const acc = Object.fromEntries(r.assignments.filter((a) => a.accept).map((a) => [a.material, a]));
  // every material reproduced to ≤0.1%
  for (const { material, qty } of KING_LEGEND) {
    assert.ok(acc[material], `${material} accepted`);
    assert.ok(Math.abs(acc[material].extractedSF - qty) / qty < 0.001, `${material} reproduced to ≤0.1%`);
  }
  // the decoys are flagged, not assigned
  assert.ok(r.unmatchedColors.includes("255,255,127"), "native yellow rejected");
  assert.ok(r.unmatchedColors.includes("152,152,152"), "base gray rejected");
  assert.equal(r.verdict, "marked", "a reproducing multi-material sheet is a marked takeoff");
});

test("reconcile: DD-GMP is a LINEAR takeoff — EA rows present + <2 area matches ⇒ 'linear', no rings", () => {
  // Real DD-GMP page-1 legend: wall-protection WLP in SF (but it's wall area,
  // not floor) + corner-guard CG in EA counts. A single gray fill coincidentally
  // equals WLP-7 44.25 SF — a DEGENERATE 1-pair match (k forced to make residual
  // 0, proving nothing). With EA rows present and <2 area matches, the sheet is a
  // linear takeoff; NO room polygons must be emitted.
  const legend = [
    { material: "WLP-1", qty: 1809.2, unit: "SF" as const },
    { material: "WLP-7", qty: 44.25,  unit: "SF" as const },
    { material: "CG-1",  qty: 2,      unit: "EA" as const },
    { material: "CG-2",  qty: 2,      unit: "EA" as const },
  ];
  const r = reconcile({ "229,229,229": 90.13 /* ×2.04 ≈ nothing; only 1 spurious hit */, "0,0,0": 5000 }, legend);
  assert.notEqual(r.verdict, "marked", "one degenerate match is not a marked takeoff");
  assert.equal(r.verdict, "linear", "EA rows present + <2 area matches ⇒ linear takeoff");
});

test("reconcile: LF/EA-only legend (no SF rows at all) ⇒ 'linear'", () => {
  const legend = [
    { material: "WP-1", qty: 2454.25, unit: "LF" as const },
    { material: "CG-1", qty: 12,      unit: "EA" as const },
  ];
  const r = reconcile({ "241,0,255": 999, "0,142,74": 500 }, legend);
  assert.equal(r.verdict, "linear");
  assert.equal(r.assignments.filter((a) => a.accept).length, 0, "no area polygons emitted");
});

test("reconcile: colored fills with NO legend at all ⇒ 'unmarked' (VMC phasing-plan rejection)", () => {
  // VMC-Kent-Station: native blue phasing fills, zero takeoff legend. Fills
  // alone must not read as marked.
  const r = reconcile({ "0,55,90": 216620, "255,255,127": 905557 }, []);
  assert.equal(r.verdict, "unmarked");
  assert.equal(r.assignments.filter((a) => a.accept).length, 0);
});

test("nearestRoomNumber: a ring gets the room-number label whose seed falls inside it; none if outside", () => {
  const room = [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][];
  const seeds = [
    { str: "701", seed: [50, 50] as [number, number] },     // inside this room
    { str: "702", seed: [500, 500] as [number, number] },    // elsewhere
  ];
  assert.equal(nearestRoomNumber(room, seeds), "701");
  const elsewhere = [[200, 200], [260, 200], [260, 260], [200, 260]] as [number, number][];
  assert.equal(nearestRoomNumber(elsewhere, seeds), undefined, "no seed inside ⇒ unlabeled");
});

test("buildGroundTruth: assembles per-ring ground-truth records for accepted materials + a reconciliation report", () => {
  // per-color rings in device px (two CPT-3 rooms + one VCT-1 room), scaled so
  // shoelace/k lands on the legend. Use k=1 for a clean unit test: areas ARE SF.
  const cpt3a: [number, number][] = [[0, 0], [40, 0], [40, 40], [0, 40]];        // 1600
  const cpt3b: [number, number][] = [[100, 0], [130, 0], [130, 30], [100, 30]];  // 900 → Σ 2500
  const vct: [number, number][]   = [[0, 100], [30, 100], [30, 30], [0, 30]];    // 30×70=2100... make it 500
  const vctRing: [number, number][] = [[0, 100], [25, 100], [25, 80], [0, 80]];  // 25×20=500
  const ringsByColor = {
    "0,55,90": [cpt3a, cpt3b],
    "127,210,219": [vctRing],
    "152,152,152": [[[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][]],  // gray decoy 100, no match
  };
  const legend = [
    { material: "CPT-3", qty: 2500, unit: "SF" as const },
    { material: "VCT-1", qty: 500,  unit: "SF" as const },
  ];
  const seeds = [{ str: "701", seed: [20, 20] as [number, number] }];  // inside cpt3a
  // areas ARE SF here (k=1), a synthetic convenience — supply it as the scale
  // hint so this test exercises ground-truth assembly, not the scale-prior gate
  // (which now, by design, rejects a non-standard k that has no scale text).
  const gt = buildGroundTruth("83 King", ringsByColor, legend, seeds, 1);
  // report
  assert.ok(Math.abs(gt.report.k - 1) < 0.01, "k≈1 for unit test");
  assert.equal(gt.report.verdict, "marked");
  // three accepted rings (2 CPT-3 + 1 VCT-1); gray decoy dropped
  assert.equal(gt.rows.length, 3);
  const cpt3rows = gt.rows.filter((r) => r.material === "CPT-3");
  assert.equal(cpt3rows.length, 2);
  // per-room area is per-RING (geometry), not the material total
  const areas = cpt3rows.map((r) => r.area_sf).sort((a, b) => a - b);
  assert.deepEqual(areas, [900, 1600]);
  // plan + poly + room number threaded through
  assert.equal(gt.rows[0].plan, "83 King");
  const labeled = gt.rows.find((r) => r.roomNumber === "701");
  assert.ok(labeled && labeled.area_sf === 1600, "seed 701 lands in the 1600-SF ring");
  assert.ok(Array.isArray(gt.rows[0].poly) && gt.rows[0].poly.length >= 3, "poly carried in device px");
  // scope-partial: output is confirmed rooms, flagged as partial recall
  assert.equal(gt.report.recall, "partial");
});

// ── BUG 1: scale prior ──────────────────────────────────────────────────────
// consensusK used to blindly pick the LARGEST cluster of area/SF ratios, so a
// dense sheet reconciled at a low, physically-impossible k (2.59, 20.17, 40.26)
// and emitted phantom rings. The fix: derive an expected k from the sheet's own
// "Scale:" text and constrain the cluster choice to the physically plausible k.

test("parseScaleK: reads '1/8\"=1'-0\"' → k≈81 device-px²/SF (k=(72/n)^2)", () => {
  // the real corpus scale strings, incl. spacing variants seen on PNB and AKMS
  assert.ok(Math.abs(parseScaleK([ti("Scale: 1/8\" = 1'-0\"", 0, 0)])! - 81) < 0.5);
  assert.ok(Math.abs(parseScaleK([ti("1/8\" = 1' - 0\"", 0, 0)])! - 81) < 0.5, "spaces around the dash tolerated");
  assert.ok(Math.abs(parseScaleK([ti("1/4\" = 1'-0\"", 0, 0)])! - 324) < 1, "1/4\" ⇒ 324");
  assert.ok(Math.abs(parseScaleK([ti("1/16\" = 1'-0\"", 0, 0)])! - 20.25) < 0.2, "1/16\" ⇒ 20.25");
  // AKMS splits it across two items — the fraction alone still resolves
  assert.ok(Math.abs(parseScaleK([ti("SCALE:", 0, 0), ti("1/8\" = 1'-0\"", 0, 0)])! - 81) < 0.5);
  // no scale text ⇒ undefined (fall back to the standard-snap prior)
  assert.equal(parseScaleK([ti("LEVEL 2 FINISH PLAN", 0, 0)]), undefined);
});

test("reconcile with a scale hint: prefers the genuine k≈81 cluster over a LARGER spurious low-k cluster (AKMS p6 hazard)", () => {
  // Synthesize AKMS-p6's failure mode: a dense sheet whose bogus 20.25 cluster
  // (near-standard 1/16\") has MORE members than the genuine 81 cluster. Without
  // the hint, consensusK picks 20.25 and marks phantoms; WITH the hint it must
  // pick 81. Two SF rows so 81 can reconcile ≥2 materials.
  const legend = [
    { material: "CPTT-3", qty: 1000, unit: "SF" as const },
    { material: "LIN-1", qty: 500, unit: "SF" as const },
  ];
  // real fills reconcile at 81: 1000·81 = 81000, 500·81 = 40500.
  const colorAreas: Record<string, number> = {
    "89,221,208": 81000,   // → CPTT-3 at k=81
    "206,224,174": 40500,  // → LIN-1  at k=81
    // a crowd of tiny hatch specks whose pairwise ratios cluster tightly at ~20.25
    "1,1,1": 20250, "2,2,2": 20250, "3,3,3": 10125, "4,4,4": 10125, "5,5,5": 5062,
  };
  // WITHOUT hint: the largest tight cluster wins → NOT 81 (regression witness)
  const noHint = reconcile(colorAreas, legend);
  assert.ok(Math.abs(noHint.k - 81) > 5, `sanity: without a hint consensus drifts off 81 (got ${noHint.k})`);
  // WITH hint: pick the cluster nearest the text-derived k → 81, both mats reconcile
  const hinted = reconcile(colorAreas, legend, 81);
  assert.ok(Math.abs(hinted.k - 81) < 1, `hinted k≈81, got ${hinted.k}`);
  assert.equal(hinted.verdict, "marked");
  assert.equal(hinted.assignments.filter((a) => a.accept).length, 2);
});

test("reconcile: a wrong-k sheet with NO scale text is rejected (not 'marked') when its only cluster is physically implausible", () => {
  // No scale hint. Fills reconcile ONLY at a non-standard low k (~2.6) against a
  // legend — the phantom-ring case (REBID p3). With no plausible standard k and
  // rings that are specks at any standard k, the sheet must NOT be "marked".
  const legend = [
    { material: "CPT-1", qty: 1000, unit: "SF" as const },
    { material: "CONC-2", qty: 50, unit: "SF" as const },
  ];
  // areas that ONLY cluster at k≈2.6 (2600, 130); at k=81 they'd be 32 SF / 1.6 SF
  const colorAreas = { "0,0,0": 2600, "245,245,245": 130 };
  const r = reconcile(colorAreas, legend);
  assert.notEqual(r.verdict, "marked", "a sheet that only reconciles at implausible low k is not a marked takeoff");
});

// ── BUG 2: split-column legend (PNB-SoDo) ───────────────────────────────────
// PNB-SoDo's Mithun titleblock stacks the code column and the quantity column
// hundreds of px apart in y, so parseLegend pairs 0 rows and the plan is lost.
// parseQuantityColumn recovers the SF values from the vertical quantity column
// independently so reconcile can still mark the sheet.

test("parseQuantityColumn: recovers a vertical run of SF quantities sharing an x-band (PNB-SoDo)", () => {
  // PNB-SoDo's real quantity column: 4 SF + 1 LF at x≈980, evenly stepped in y.
  const items = [
    ti("892.92 SF", 980, 261),
    ti("967.11 SF", 980, 386),
    ti("95.06 SF", 980, 510),
    ti("21.52 SF", 980, 635),
    ti("351.73 LF", 980, 760),
  ];
  const col = parseQuantityColumn(items);
  const sf = col.filter((r) => r.unit === "SF").map((r) => r.qty).sort((a, b) => a - b);
  assert.deepEqual(sf, [21.52, 95.06, 892.92, 967.11], "the four SF values recovered");
  // synthetic placeholder material names, one per row (bijection for reconcile)
  assert.equal(new Set(col.map((r) => r.material)).size, col.length, "each row a distinct synthetic name");
});

test("parseQuantityColumn: scattered SF callouts (Mercy) do NOT form a column ⇒ no rows (no false-positive)", () => {
  // Mercy's SF texts are architect room callouts scattered across x — the widest
  // tight x-band holds only 3 items, below the vertical-run threshold.
  const items = [
    ti("67 SF", 924, 399), ti("228 SF", 932, 318), ti("164 SF", 943, 480),
    ti("48 SF", 1061, 253), ti("147 SF", 1124, 297), ti("666 SF", 1152, 404),
    ti("198 SF", 1211, 488), ti("163 SF", 1432, 484), ti("242 SF", 1452, 417),
    // a 3-item incidental x-alignment (the worst case) must still be rejected
    ti("203 SF", 571, 2281), ti("164 SF", 571, 2179), ti("134 SF", 571, 2080),
  ];
  assert.equal(parseQuantityColumn(items).length, 0, "scattered callouts are not a quantity column");
});

test("split-column PNB-SoDo reconciles via the quantity column: fills reproduce the SF values at k=81 ⇒ 'marked'", () => {
  // The proven PNB numbers: 238,62,62 → 892.92 and 189,149,212 → 21.52 at k=81.
  const colItems = [
    ti("892.92 SF", 980, 261), ti("967.11 SF", 980, 386),
    ti("95.06 SF", 980, 510), ti("21.52 SF", 980, 635), ti("351.73 LF", 980, 760),
  ];
  const legend = parseQuantityColumn(colItems);  // synthetic SF rows
  const colorAreas = {
    "238,62,62": 892.92 * 81,     // → 892.92 SF at k=81
    "189,149,212": 21.52 * 81,    // → 21.52 SF
    "0,0,0": 40000,               // native linework — reconciles to nothing
  };
  const r = reconcile(colorAreas, legend, 81);
  assert.equal(r.verdict, "marked");
  assert.ok(r.assignments.filter((a) => a.accept).length >= 2, "≥2 fills reproduce distinct SF values");
});
