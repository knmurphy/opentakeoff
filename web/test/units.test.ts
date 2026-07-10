// Unit-system display layer (lib/units.ts) — pure conversions only.
//
// Carried from upstream's units.test.ts minus two cases that need the metric
// display port (upstream ee3c2ad) this fork hasn't taken yet:
//   - "metric ratio scales produce correct feet-per-pixel" (needs the 1:20–1:500
//     presets in sheets.ts STANDARD_SCALES)
//   - "metric CSV converts measured columns and drops SY" (needs the units
//     parameter on totalsToCsv)
// Restore both wholesale when the metric port lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { areaVal, areaUnit, lenVal, lenUnit, calInputToFeet, M_PER_FT, M2_PER_SF, ftIn, fmtCheckLen, parseLenInput } from "../src/lib/units.js";

test("area/length convert only in metric", () => {
  assert.equal(areaVal(1000, "imperial"), 1000);
  assert.ok(Math.abs(areaVal(1000, "metric") - 92.90304) < 1e-9);
  assert.equal(lenVal(100, "imperial"), 100);
  assert.ok(Math.abs(lenVal(100, "metric") - 30.48) < 1e-9);
  assert.equal(areaUnit("imperial"), "SF");
  assert.equal(areaUnit("metric"), "m²");
  assert.equal(lenUnit("metric"), "m");
});

test("calibration input converts meters to internal feet", () => {
  assert.equal(calInputToFeet(10, "imperial"), 10);
  assert.ok(Math.abs(calInputToFeet(3.048, "metric") - 10) < 1e-9);
  assert.ok(Math.abs(M_PER_FT * M_PER_FT - M2_PER_SF) < 1e-12);
});

// ── Check-a-dimension helpers (ftIn / fmtCheckLen / parseLenInput) ──────────

test("ftIn renders drawing-style feet-and-inches", () => {
  assert.equal(ftIn(12.5), "12′ 6″");
  assert.equal(ftIn(11.999), "12′ 0″");   // 12″ rolls up
  assert.equal(ftIn(0.49), "0′ 6″");      // rounds to nearest inch
  assert.equal(ftIn(0), "0′ 0″");
  assert.equal(ftIn(-3.25), "-3′ 3″");
  assert.equal(ftIn(NaN), "");
});

test("fmtCheckLen: ft-in imperial, meters metric", () => {
  assert.equal(fmtCheckLen(12.5, "imperial"), "12′ 6″");
  assert.equal(fmtCheckLen(10, "metric"), "3.05 m");
});

test("parseLenInput reads decimal feet, feet-inches forms, and meters", () => {
  assert.equal(parseLenInput("12.5", "imperial"), 12.5);
  assert.equal(parseLenInput("12'6", "imperial"), 12.5);
  assert.equal(parseLenInput(`12' 6"`, "imperial"), 12.5);
  assert.equal(parseLenInput("12-6", "imperial"), 12.5);
  assert.equal(parseLenInput("12′ 6″", "imperial"), 12.5);
  assert.ok(Math.abs(parseLenInput("3.81", "metric") - 3.81 / M_PER_FT) < 1e-9);
  assert.ok(Number.isNaN(parseLenInput("", "imperial")));
  assert.ok(Number.isNaN(parseLenInput("banana", "imperial")));
  assert.ok(Number.isNaN(parseLenInput("12'14", "imperial")));  // 14 inches is not a dimension
});
