// Unit-system display layer. ALL takeoff math stays in feet internally (shapes,
// scales, totals) — these helpers convert at the edges only: readouts, chips,
// the report, exports, and the calibration input. Toggling systems never
// rewrites stored data.
//
// NOTE (this fork): the metric display mode itself (upstream ee3c2ad) is not
// ported yet — the canvas runs imperial-only, so the metric-only exports here
// (areaVal/areaUnit/lenVal/lenUnit/calInputToFeet in their "metric" branches)
// sit unused until that port lands. They're kept whole so the metric port is a
// drop-in and the check-a-dimension helpers below stay byte-identical to
// upstream.
export type UnitSystem = "imperial" | "metric";

export const M_PER_FT = 0.3048;
export const M2_PER_SF = 0.09290304;

/** area for display: SF in, SF or m² out */
export const areaVal = (sf: number, units: UnitSystem): number =>
  units === "metric" ? sf * M2_PER_SF : sf;
export const areaUnit = (units: UnitSystem): string => (units === "metric" ? "m²" : "SF");

/** length for display: LF in, LF or m out */
export const lenVal = (lf: number, units: UnitSystem): number =>
  units === "metric" ? lf * M_PER_FT : lf;
export const lenUnit = (units: UnitSystem): string => (units === "metric" ? "m" : "LF");

/** calibration input → internal feet (metric users type meters) */
export const calInputToFeet = (v: number, units: UnitSystem): number =>
  units === "metric" ? v / M_PER_FT : v;

/** Feet → drawing-style feet-and-inches: 12.51 → "12′ 6″". Rounds to the
 *  nearest inch; 12″ rolls up to the next foot. */
export function ftIn(feet: number): string {
  if (!Number.isFinite(feet)) return "";
  const sign = feet < 0 ? "-" : "";
  let ft = Math.floor(Math.abs(feet) + 1e-9);
  let inch = Math.round((Math.abs(feet) - ft) * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return `${sign}${ft}′ ${inch}″`;
}

/** length readout for the check tool: ft-in in imperial, meters in metric */
export const fmtCheckLen = (feet: number, units: UnitSystem): string =>
  units === "metric" ? `${(feet * M_PER_FT).toFixed(2)} m` : ftIn(feet);

/** Parse a typed dimension into internal feet. Imperial accepts decimal feet
 *  ("12.5") and feet-inches forms ("12'6", "12' 6\"", "12-6"); metric users
 *  type meters. Returns NaN when it can't read the input. */
export function parseLenInput(raw: string, units: UnitSystem): number {
  const s = (raw || "").trim();
  if (!s) return NaN;
  if (units === "metric") {
    const m = Number(s.replace(/m$/i, "").trim());
    return m > 0 || m === 0 ? m / M_PER_FT : NaN;
  }
  // feet-inches: 12'6, 12' 6", 12-6, 12ft 6in
  const fi = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|ft)\s*(?:-|\s)?\s*(\d+(?:\.\d+)?)?\s*(?:"|″|in)?$/i)
    || s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (fi) {
    const ft = Number(fi[1]);
    const inch = fi[2] != null ? Number(fi[2]) : 0;
    if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return NaN;
    return ft + inch / 12;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}
