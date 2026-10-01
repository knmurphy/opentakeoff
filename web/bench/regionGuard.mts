// Guard for the one held-out run of bench:regions: refused unless the
// detector constants are frozen (task 6b) and the defaults still hash to the
// frozen value (rule: bench/regionCalib.ts heldOutAllowed).
import { createHash } from "crypto";
import * as RD from "../src/lib/regionDetect.ts";
import { heldOutAllowed } from "./regionCalib.ts";

export function currentConstantsHash(): string {
  return createHash("sha256").update(RD.regionParamsCanonical(RD.DEFAULT_REGION_PARAMS)).digest("hex");
}

export function heldOutGuard(): { ok: boolean; reason: string } {
  const rd = RD as Record<string, unknown>;
  return heldOutAllowed(rd.REGION_CONSTANTS_FROZEN, rd.REGION_CONSTANTS_HASH, currentConstantsHash());
}
