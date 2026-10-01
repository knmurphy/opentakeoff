// Guard for the one held-out run of bench:regions: refused until the detector
// constants are frozen (task 6b) and unchanged since.
export function heldOutGuard(): { ok: boolean; reason: string } {
  return { ok: false, reason: "detector constants are not frozen yet (task 6b calibration)" };
}
