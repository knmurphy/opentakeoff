// traceConfidence — the RFC item-D adapter over engine signals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { traceConfidence, CONF_RASTER, CONF_HATCH, CONF_WEDGE } from "../src/lib/confidence.ts";

test("verbatim vector trace scores 1.0 with no factors", () => {
  assert.deepEqual(traceConfidence({}), { score: 1, factors: [] });
});

test("each signal deducts once, with a named factor", () => {
  assert.equal(traceConfidence({ raster: true }).score, CONF_RASTER);
  assert.equal(traceConfidence({ hatchFiltered: true }).score, CONF_HATCH);
  assert.equal(traceConfidence({ wedges: 1 }).score, CONF_WEDGE);
  const sealed = traceConfidence({ sealedPx: 8, virtualFrac: 0.07 });
  assert.equal(sealed.score, 0.93);
  assert.match(sealed.factors[0], /sealed-opening\(7% synthetic boundary\)/);
});

test("deductions compose multiplicatively and clamp the virtual fraction", () => {
  const c = traceConfidence({ raster: true, sealedPx: 4, virtualFrac: 0.9 });   // junk fraction clamps to 0.25
  assert.equal(c.score, +(0.9 * 0.75).toFixed(2));
  assert.equal(c.factors.length, 2);
});

test("a sealed result missing its fraction assumes a door's worth, not zero", () => {
  assert.equal(traceConfidence({ sealedPx: 4 }).score, 0.9);
});
