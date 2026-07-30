// F1 — the min-passage fall-through cliff.
//
// A3's fix put the seal ladder's two sanity gates (room-size cap, ≥75%-real
// boundary) on the min-passage DILATION path. Applied unconditionally that was a
// regression: a refused min-passage region fell through to the RAW flood, which
// was returned bare — no minPassPx/minPassDelta, no sealedPx/virtualFrac — so
// nothing downstream could see that the rule had run and been overruled, and
// confidence scored the answer 1.00.
//
// THE SCENE is `web/test/minPassGate.test.ts`'s, verbatim: a ~64 SF room whose
// wall is drawn as a picket/dashed run (2 px dashes, `slotPx` gaps) sitting
// inside a solidly walled 128 SF suite. 911x756 image px at 30 px/ft, mask built
// at maxDim 700 so the working raster lands at 23.05 px/ft (minPassPx 6) — the
// shape a >3000 px sheet takes under MASK_MAX_DIM. Every slot swept is narrower
// than MIN_PASS_FT, so "these dashes do not connect two spaces" is the correct
// verdict and the raw flood into the suite is the wrong answer.
//
// `suite: false` is the same picket room alone on the sheet: the verbatim flood
// is then UNBOUNDED, the rule is CREATING boundedness rather than trimming, and
// both gates are supposed to run unchanged. Reported so the fix can be shown to
// be a scoping, not a removal.
//
// Runs on all three states. `floodSignals` exists only after b277662, so the
// ConfidenceInput is hand-composed from whatever fields the state's FloodResult
// carries — the union of both states' fields; a state that does not set one
// leaves it undefined, which is exactly the defect being measured.
import {
  buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, MIN_PASS_FT, DETERMINISM_MIN_MPPF, SENS_BALANCED,
  traceRegion, ringArea,
} from "../src/lib/oneclick.ts";
import { traceConfidence } from "../src/lib/confidence.ts";

const W = 911, H = 756, PXFT = 30, MAXDIM = 700;
const SEED: [number, number] = [190, 210];
const ROOM_SF = (220 / PXFT) * (260 / PXFT);        // 63.6 SF — the room's footprint
const SUITE_SF = (320 / PXFT) * (360 / PXFT);       // 128.0 SF — what the raw flood reaches

const L = (s: number[], x0: number, y0: number, x1: number, y1: number) => s.push(x0, y0, x1, y1);
function picketRoom(slotPx: number, suite: boolean, dashPx = 2): number[] {
  const s: number[] = [];
  L(s, 2, 2, W - 2, 2); L(s, W - 2, 2, W - 2, H - 2); L(s, W - 2, H - 2, 2, H - 2); L(s, 2, H - 2, 2, 2);
  if (suite) { L(s, 40, 40, 360, 40); L(s, 360, 40, 360, 400); L(s, 360, 400, 40, 400); L(s, 40, 400, 40, 40); }
  const run = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let t = 0; t < len; t += dashPx + slotPx) {
      const e = Math.min(t + dashPx, len);
      L(s, x0 + ux * t, y0 + uy * t, x0 + ux * e, y0 + uy * e);
    }
  };
  run(80, 80, 300, 80); run(300, 80, 300, 340); run(300, 340, 80, 340); run(80, 340, 80, 80);
  return s;
}

function measure(slotPx: number, suite: boolean, maxDim = MAXDIM) {
  const segs = picketRoom(slotPx, suite);
  const mo: any = buildMask(segs, W, H, maxDim, null, PXFT);
  const mppf = mo.mppf ?? 0;
  const minPassPx = minPassRadiusFor(mppf);
  const raw: any = floodRegion(mo, SEED[0], SEED[1], SENS_BALANCED);
  const f: any = floodRegionSealed(mo, SEED[0], SEED[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassPx);
  const row: any = {
    slotPx, slotFt: +(slotPx / PXFT).toFixed(4), subMinPass: slotPx / PXFT <= MIN_PASS_FT,
    mppf: +mppf.toFixed(4), aboveDeterminismFloor: mppf >= DETERMINISM_MIN_MPPF, minPassPx,
    rawStatus: raw.status, rawCellSF: raw.status === "ok" ? +(raw.count / (mppf * mppf)).toFixed(2) : null,
    status: f.status,
  };
  if (f.status !== "ok") return row;
  const ringSF = ringArea(traceRegion(f)) / (PXFT * PXFT);
  row.cellSF = +(f.count / (mppf * mppf)).toFixed(2);
  row.ringSF = +ringSF.toFixed(2);
  // provenance the result carries — the whole point of F1
  row.minPassPx_out = f.minPassPx ?? null;
  row.minPassDelta = f.minPassDelta != null ? +f.minPassDelta.toFixed(4) : null;
  row.sealedPx = f.sealedPx ?? null;
  row.virtualFrac = f.virtualFrac != null ? +f.virtualFrac.toFixed(4) : null;
  row.provenanceAbsent = row.minPassPx_out == null && row.minPassDelta == null && row.sealedPx == null;
  // hand-composed ConfidenceInput: the union of both states' fields
  const c = traceConfidence({
    raster: false, hatchFiltered: f.hatchFiltered, hatchTier: f.hatchTier,
    sealedPx: f.sealedPx, virtualFrac: f.virtualFrac, wedges: f.wedges, wedgeGrowth: f.wedgeGrowth,
    curveFrac: f.curveFrac, minPassPx: f.minPassPx, minPassDelta: f.minPassDelta,
    areaSF: ringSF, mppf: f.mppf ?? mppf,
  } as any);
  row.conf = c.score; row.factors = c.factors;
  row.answeredTheSuite = row.cellSF > SUITE_SF * 0.75;
  return row;
}

const SLOTS = [8, 10, 11, 12, 13, 14, 15, 16];
const out: any = {
  probe: "F1", roomSF: +ROOM_SF.toFixed(2), suiteSF: +SUITE_SF.toFixed(2),
  minPassFt: MIN_PASS_FT, trimming: [], creating: [], f2b: [],
};
for (const s of SLOTS) out.trimming.push(measure(s, true));
for (const s of SLOTS) out.creating.push(measure(s, false));

// KNOWN LIMIT F2b, measured rather than taken on trust: the same drawing, the
// same decisively sub-MIN_PASS_FT 0.333 ft slot, on the CREATING path, is a room
// at a coarse working raster and a refusal at a fine one — because
// virtualBoundaryFrac's hug margin is a fixed 3 cells while the dilation radius
// it judges grows with the raster. Pinned by minPassGate.test.ts; reproduced here
// independently, and unchanged by every fix in this wave.
for (const maxDim of [700, 800, W]) out.f2b.push({ maxDim, ...measure(10, false, maxDim) });

// the cliff, as one number: the largest jump in answer between adjacent slots
const cliff = (rows: any[]) => {
  let worst: any = null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.cellSF == null || b.cellSF == null) continue;
    const d = Math.abs(b.cellSF - a.cellSF);
    if (!worst || d > worst.deltaSF) worst = { fromSlotPx: a.slotPx, toSlotPx: b.slotPx, fromSF: a.cellSF, toSF: b.cellSF, deltaSF: +d.toFixed(2), fromConf: a.conf, toConf: b.conf };
  }
  return worst;
};
const ok = out.trimming.filter((r: any) => r.cellSF != null).map((r: any) => r.cellSF);
out.summary = {
  trimmingWorstAdjacentJump: cliff(out.trimming),
  trimmingSpreadSF: ok.length ? +(Math.max(...ok) - Math.min(...ok)).toFixed(2) : null,
  trimmingRowsAnsweringTheSuite: out.trimming.filter((r: any) => r.answeredTheSuite).length,
  trimmingRowsWithNoProvenance: out.trimming.filter((r: any) => r.status === "ok" && r.provenanceAbsent).length,
  trimmingRowsAtConf1: out.trimming.filter((r: any) => r.conf === 1).length,
  creatingStatuses: out.creating.map((r: any) => `${r.slotPx}:${r.status}`),
  f2bFlip: out.f2b.map((r: any) => `maxDim ${r.maxDim} → mppf ${r.mppf}, minPassPx ${r.minPassPx}: ${r.status}${r.conf != null ? ` @ ${r.conf}` : ""}`),
};
console.log(JSON.stringify(out, null, 1));
