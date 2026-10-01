// bench/regionCalib.ts — the pre-registered calibration choice: keep the
// plan's value unless the tune result there is worse than elsewhere in the
// swept range; then the midpoint of the best plateau.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareTune, plateauAround, chooseValue, type TuneResult } from "../bench/regionCalib.ts";

const R = (pass: number, edgeOk = 24, groupErr = 0, abstain = 0): TuneResult => ({ pass, edgeOk, groupErr, abstain });

describe("compareTune (lexicographic: pass ↑, edge ↑, grouping errors ↓, abstains ↓)", () => {
  test("orders by each key in turn; equal is 0", () => {
    assert.ok(compareTune(R(24), R(23)) > 0);
    assert.ok(compareTune(R(24, 24), R(24, 23)) > 0);
    assert.ok(compareTune(R(24, 24, 0), R(24, 24, 3)) > 0);
    assert.ok(compareTune(R(24, 24, 0, 0), R(24, 24, 0, 1)) > 0);
    assert.equal(compareTune(R(20, 22, 1, 2), R(20, 22, 1, 2)), 0);
  });
});

describe("plateauAround", () => {
  test("the contiguous run of values with the same result as index i", () => {
    const rs = [R(1), R(2), R(2), R(2), R(1), R(2)];
    assert.deepEqual(plateauAround([1, 2, 3, 4, 5, 6], rs, 2), [2, 4]);
    assert.deepEqual(plateauAround([1, 2, 3, 4, 5, 6], rs, 5), [6, 6]);
  });
});

describe("chooseValue", () => {
  test("plan value already best (ties elsewhere allowed) → kept", () => {
    const c = chooseValue([1, 2, 3, 4, 5], [R(20), R(24), R(24), R(24), R(22)], 3, false);
    assert.deepEqual(c, { chosen: 3, changed: false, planPlateau: [2, 4], bestPlateau: [2, 4] });
  });
  test("plan value worse → midpoint of the best plateau", () => {
    const c = chooseValue([1, 2, 3, 4, 5], [R(20), R(20), R(24), R(24), R(24)], 1, false);
    assert.deepEqual(c, { chosen: 4, changed: true, planPlateau: [1, 2], bestPlateau: [3, 5] });
  });
  test("two best plateaus → the wider one (in value span)", () => {
    const vs = [1, 2, 3, 4, 5, 6, 7];
    const c = chooseValue(vs, [R(24), R(24), R(20), R(20), R(24), R(24), R(24)], 3, false);
    assert.equal(c.chosen, 6);
    assert.deepEqual(c.bestPlateau, [5, 7]);
  });
  test("equally wide best plateaus → the one nearer the plan value", () => {
    const c = chooseValue([1, 2, 3, 4, 5], [R(24), R(20), R(20), R(20), R(24)], 4, false);
    assert.deepEqual(c.bestPlateau, [5, 5]);
    assert.equal(c.chosen, 5);
  });
  test("integer constants: the midpoint rounds toward the plan value", () => {
    const c = chooseValue([1, 2, 3, 4], [R(20), R(24), R(24), R(20)], 1, true);
    assert.equal(c.chosen, 2);           // 2.5 → toward 1
    const d = chooseValue([1, 2, 3, 4], [R(20), R(24), R(24), R(20)], 4, true);
    assert.equal(d.chosen, 3);           // 2.5 → toward 4
  });
  test("the plan value must be in the swept range", () => {
    assert.throws(() => chooseValue([1, 2], [R(1), R(1)], 3, false));
  });
});
