// Callout cross-check core tests — pure, DOM-free, pdfjs-free. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAreaCallouts, nearbyText, clusterAreas, sweepOffsets, checkCallouts, summarize } from "../bench/callouts.ts";

test("parseAreaCallouts: the drawing's own area annotations, and only those", () => {
  const items = [
    { str: "557 SF", x: 10, y: 10 },
    { str: "1,718 SF", x: 20, y: 20 },      // thousands separator
    { str: "250 S.F.", x: 30, y: 30 },      // punctuated
    { str: "40 sf", x: 40, y: 40 },         // lowercase
    { str: "12.5 SQ FT", x: 50, y: 50 },    // fractional, spelled out
    { str: "137", x: 60, y: 60 },           // room tag — a bare number is not a callout
    { str: "CPT-1", x: 70, y: 70 },         // finish tag
    { str: "CARPET 557 SF", x: 80, y: 80 }, // schedule row — anchor is in the schedule, not the room
    { str: "SF", x: 90, y: 90 },            // unit alone
    { str: "0 SF", x: 100, y: 100 },        // degenerate
  ];
  assert.deepEqual(parseAreaCallouts(items).map((c) => [c.sf, c.x]), [
    [557, 10], [1718, 20], [250, 30], [40, 40], [12.5, 50],
  ]);
});

test("nearbyText: nearest-first context within the radius, excluding the anchor itself", () => {
  const items = [
    { str: "557 SF", x: 0, y: 0 },
    { str: "CPT-1", x: 3, y: 0 },
    { str: "OFFICE 101", x: 10, y: 0 },
    { str: "FAR AWAY", x: 500, y: 0 },
  ];
  assert.deepEqual(nearbyText(items, 0, 0, 50), ["CPT-1", "OFFICE 101"]);
  assert.deepEqual(nearbyText(items, 0, 0, 50, 1), ["CPT-1"]);
});

test("clusterAreas: the modal region wins, ties break to the larger area", () => {
  // 619-ish three times, 15-ish twice
  const g = clusterAreas([619, 620.1, 15, 618.5, 15.2]);
  assert.equal(g.length, 2);
  assert.equal(g[0].members, 3);
  assert.ok(Math.abs(g[0].sf - 619.2) < 0.5, `modal ≈ 619, got ${g[0].sf}`);
  assert.equal(g[1].members, 2);

  assert.deepEqual(clusterAreas([]), []);
  const tie = clusterAreas([100, 200]);              // one member each — larger first
  assert.deepEqual(tie.map((x) => x.sf), [200, 100]);
});

test("sweepOffsets: a feet-true grid around the anchor, scaled by the sheet", () => {
  const offs = sweepOffsets(18, [-2, 0, 2]);
  assert.equal(offs.length, 9);
  assert.deepEqual(offs[0], [-36, -36]);
  assert.ok(offs.some(([dx, dy]) => dx === 0 && dy === 0), "the anchor itself is always swept");
  assert.deepEqual(sweepOffsets(9, [-2, 0, 2])[0], [-18, -18], "coarser sheet ⇒ same distance in feet");
});

test("checkCallouts: modal region, agreement count and seed sensitivity per callout", () => {
  const callouts = parseAreaCallouts([{ str: "500 SF", x: 0, y: 0 }]);
  // a stubbed engine: the anchor lands in stroke text (2 SF), the ring around
  // it reads the room (450 SF), and one seed leaks somewhere huge
  const measure = (x: number, y: number) => (x === 0 && y === 0 ? 2 : x > 0 && y > 0 ? 5000 : 450);
  const [row] = checkCallouts(callouts, measure, sweepOffsets(1, [-1, 0, 1]));
  assert.equal(row.printed_sf, 500);
  assert.equal(row.engine_sf, 450, "the modal region, not the glyph interior the anchor landed in");
  assert.ok(Math.abs(row.err! + 0.10) < 1e-9, "−10% vs the drawing");
  assert.equal(row.agreement, 7);
  assert.equal(row.seeds, 9);
  assert.equal(row.regions, 3, "glyph, room and leak are three distinct answers");
});

test("checkCallouts: a callout no seed can measure reports null, never zero", () => {
  const callouts = parseAreaCallouts([{ str: "500 SF", x: 0, y: 0 }]);
  const [row] = checkCallouts(callouts, () => null, sweepOffsets(1, [0]));
  assert.equal(row.engine_sf, null);
  assert.equal(row.err, null);
  assert.equal(row.refused, 1);
  assert.equal(row.agreement, 0);
});

test("summarize: mixed signs rule out a scale error; a uniform tight sign does not", () => {
  const row = (printed: number, engine: number, stable = true) => ({
    raw: `${printed} SF`, printed_sf: printed, engine_sf: engine,
    err: (engine - printed) / printed, agreement: 1, seeds: 1, regions: 1, refused: 0, stable, context: [],
  });
  const mixed = summarize([row(100, 111), row(100, 92), row(100, 56)]);
  assert.equal(mixed.matched, 3);
  assert.equal(mixed.uniformSign, false);
  assert.match(mixed.verdict, /mixed signs/);
  assert.ok(Math.abs(mixed.minErr + 0.44) < 1e-9 && Math.abs(mixed.maxErr - 0.11) < 1e-9);

  const scale = summarize([row(100, 96), row(100, 95), row(100, 94)]);
  assert.equal(scale.uniformSign, true);
  assert.match(scale.verdict, /wrong sheet scale/);

  const biased = summarize([row(100, 96), row(100, 70), row(100, 60)]);
  assert.equal(biased.uniformSign, true);
  assert.match(biased.verdict, /not a scale error/);

  assert.match(summarize([]).verdict, /no callout produced a measurable region/);
});

test("summarize: a seed-unstable row is reported but never averaged", () => {
  const row = (printed: number, engine: number, stable: boolean) => ({
    raw: `${printed} SF`, printed_sf: printed, engine_sf: engine,
    err: (engine - printed) / printed, agreement: stable ? 9 : 2, seeds: 10, regions: stable ? 1 : 7,
    refused: 0, stable, context: [],
  });
  // one honest −10% reading plus a glyph-interior artifact that would drag any
  // average into nonsense
  const s = summarize([row(100, 90, true), row(100, 1, false)]);
  assert.equal(s.matched, 1);
  assert.equal(s.unstable, 1);
  assert.equal(s.total, 2);
  assert.ok(Math.abs(s.meanAbsErr - 0.10) < 1e-9, "the −99% artifact is excluded");
  assert.ok(Math.abs(s.medianAbsErr - 0.10) < 1e-9);

  const allBad = summarize([row(100, 1, false)]);
  assert.equal(allBad.matched, 0);
  assert.match(allBad.verdict, /every sweep was seed-sensitive/);
});

test("checkCallouts: stability is the modal region's share of the seeds", () => {
  const callouts = parseAreaCallouts([{ str: "500 SF", x: 0, y: 0 }]);
  // 8 of 9 seeds agree — stable
  const steady = checkCallouts(callouts, (x, y) => (x === 0 && y === 0 ? 2 : 450), sweepOffsets(1, [-1, 0, 1]));
  assert.equal(steady[0].stable, true);
  // every seed a different answer — no measurement, just sensitivity
  let n = 0;
  const scattered = checkCallouts(callouts, () => 100 * ++n, sweepOffsets(1, [-1, 0, 1]));
  assert.equal(scattered[0].stable, false);
  assert.equal(scattered[0].regions, 9);
});
