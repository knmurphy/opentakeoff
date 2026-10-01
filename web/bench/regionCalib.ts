// The calibration rule of task 6b (pre-registered in the plan, "Metrics" →
// calibration): per constant, sweep a range one value at a time on the tune
// set; keep the plan's value unless the tune result there is worse than
// elsewhere in the range, in which case take the midpoint of the best plateau.
// Pure; tested in test/regionCalib.test.ts.

/** The tune-set result one detector run is judged by: passes and correct
 * edges against the mean label (higher is better), grouping errors (same-
 * family sheet pairs split + cross-family sheet pairs merged) and abstains
 * (lower is better). */
export interface TuneResult { pass: number; edgeOk: number; groupErr: number; abstain: number }

/** > 0 when a is better than b, lexicographically: pass, edgeOk, −groupErr, −abstain. */
export function compareTune(a: TuneResult, b: TuneResult): number {
  return a.pass - b.pass || a.edgeOk - b.edgeOk || b.groupErr - a.groupErr || b.abstain - a.abstain;
}

/** [first, last] value of the contiguous run around index i whose results equal results[i]. */
export function plateauAround(values: readonly number[], results: readonly TuneResult[], i: number): [number, number] {
  let lo = i, hi = i;
  while (lo > 0 && compareTune(results[lo - 1], results[i]) === 0) lo--;
  while (hi < values.length - 1 && compareTune(results[hi + 1], results[i]) === 0) hi++;
  return [values[lo], values[hi]];
}

export interface Choice { chosen: number; changed: boolean; planPlateau: [number, number]; bestPlateau: [number, number] }

/** `values` ascending, `results` aligned, `plan` one of the values. Best
 * plateau among several: the widest in value span, then the one nearest the
 * plan value. Integer constants round the midpoint toward the plan value. */
export function chooseValue(values: readonly number[], results: readonly TuneResult[], plan: number, integer: boolean): Choice {
  const ip = values.indexOf(plan);
  if (ip < 0) throw new Error(`chooseValue: plan value ${plan} is not in the swept range`);
  let best = results[0];
  for (const r of results) if (compareTune(r, best) > 0) best = r;
  const planPlateau = plateauAround(values, results, ip);
  if (compareTune(results[ip], best) === 0) return { chosen: plan, changed: false, planPlateau, bestPlateau: planPlateau };
  const plateaus: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    if (compareTune(results[i], best) !== 0) continue;
    const p = plateauAround(values, results, i);
    if (!plateaus.some((q) => q[0] === p[0])) plateaus.push(p);
  }
  const dist = (p: [number, number]) => Math.min(Math.abs(p[0] - plan), Math.abs(p[1] - plan));
  plateaus.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]) || dist(a) - dist(b));
  const bp = plateaus[0];
  let mid = (bp[0] + bp[1]) / 2;
  if (integer && !Number.isInteger(mid)) mid = mid > plan ? Math.floor(mid) : Math.ceil(mid);
  return { chosen: mid, changed: mid !== plan, planPlateau, bestPlateau: bp };
}

/** The held-out run's guard: allowed only when the constants were frozen
 * (a date and a hash) and the current defaults hash to the frozen value. */
export function heldOutAllowed(frozen: unknown, frozenHash: unknown, currentHash: string): { ok: boolean; reason: string } {
  if (typeof frozen !== "string" || !frozen || typeof frozenHash !== "string" || !frozenHash) {
    return { ok: false, reason: "detector constants are not frozen (REGION_CONSTANTS_FROZEN)" };
  }
  if (currentHash !== frozenHash) {
    return { ok: false, reason: `detector constants differ from the frozen set of ${frozen} (hash ${currentHash} ≠ ${frozenHash})` };
  }
  return { ok: true, reason: `constants frozen ${frozen}, hash ${frozenHash}` };
}
