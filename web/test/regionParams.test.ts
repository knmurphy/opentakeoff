// Region detector constants as an overridable parameter set (task 6b
// calibration): the defaults are the named constants, passing nothing, {} or
// the defaults themselves gives the same output, an override takes effect,
// and the frozen hash matches the defaults.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as RD from "../src/lib/regionDetect.ts";
import * as Synth from "./fixtures/regionSynth.ts";

const { DEFAULT_REGION_PARAMS: P, detectSetRegions } = RD;

const sets = [Synth.uniformSet24(), Synth.mixedSet(), Synth.smallConsultantsSet(), Synth.borderlessSet(), Synth.topEdgeSet(), Synth.singleSheetSet()];
const plain = (r: ReturnType<typeof detectSetRegions>) => ({ regions: [...r.regions], diag: [...r.diag] });

describe("DEFAULT_REGION_PARAMS", () => {
  test("equals the named constants", () => {
    assert.deepEqual({ ...P }, {
      borderMinSpan: RD.BORDER_MIN_SPAN, borderMaxFrac: RD.BORDER_MAX_FRAC, chainGapFrac: RD.CHAIN_GAP_FRAC,
      minChainCover: RD.MIN_CHAIN_COVER, stripDMin: RD.STRIP_D_MIN, stripDMax: RD.STRIP_D_MAX, touchFrac: RD.TOUCH_FRAC,
      minStripTokens: RD.MIN_STRIP_TOKENS, sheetnoOuter: RD.SHEETNO_OUTER, sheetnoFarFrom: RD.SHEETNO_FAR_FROM,
      repeatPosTol: RD.REPEAT_POS_TOL, staticMinSheets: RD.STATIC_MIN_SHEETS, bandGap: RD.BAND_GAP,
      frameBandRatio: RD.FRAME_BAND_RATIO, groupMinJaccard: RD.GROUP_MIN_JACCARD, groupDTol: RD.GROUP_D_TOL,
      bandMinCover: RD.BAND_MIN_COVER,
    });
    assert.ok(Object.isFrozen(P));
  });

  test("no params, {} and the defaults spelled out give identical output", () => {
    for (const s of sets) {
      const sheets = s.sheets.map((x) => x.sheet);
      const base = plain(detectSetRegions(sheets));
      assert.deepEqual(plain(detectSetRegions(sheets, {})), base, s.name);
      assert.deepEqual(plain(detectSetRegions(sheets, { ...P })), base, s.name);
    }
  });

  test("an override takes effect: an unreachable token floor abstains everywhere", () => {
    const sheets = Synth.uniformSet24().sheets.map((x) => x.sheet);
    const r = detectSetRegions(sheets, { minStripTokens: 1e9 });
    for (const d of r.diag.values()) assert.equal(d.edge, null);
    // and the defaults are untouched afterwards
    assert.equal(P.minStripTokens, RD.MIN_STRIP_TOKENS);
    assert.ok([...detectSetRegions(sheets).diag.values()].some((d) => d.edge !== null));
  });

  test("an unknown or non-finite override is refused", () => {
    assert.throws(() => detectSetRegions([], { nope: 1 } as unknown as Partial<RD.RegionParams>));
    assert.throws(() => detectSetRegions([], { bandGap: NaN }));
  });
});

describe("frozen constants", () => {
  test("REGION_CONSTANTS_HASH is the sha256 of the defaults' canonical JSON", () => {
    assert.match(RD.REGION_CONSTANTS_FROZEN, /^\d{4}-\d{2}-\d{2}$/);
    const hex = createHash("sha256").update(RD.regionParamsCanonical(P)).digest("hex");
    assert.equal(RD.REGION_CONSTANTS_HASH, hex);
  });
  test("canonical JSON sorts keys", () => {
    assert.equal(RD.regionParamsCanonical({ ...P }), RD.regionParamsCanonical(Object.fromEntries(Object.entries(P).reverse()) as unknown as RD.RegionParams));
    assert.ok(RD.regionParamsCanonical(P).startsWith('{"bandGap":'));
  });
});
